/* Aura backend: serves the static site + a small JSON API.

   Products:
     GET  /api/products             -> full catalog
     GET  /api/products/:slug       -> one product

   Accounts (session cookie, 30 days):
     POST /api/auth/register        -> { email, password }
     POST /api/auth/login           -> { email, password }
     POST /api/auth/logout
     GET  /api/auth/me              -> { user: { email } | null }
     GET  /api/orders               -> signed-in user's order history

   Checkout:
     POST /api/checkout             -> validates the cart, prices it from
                                       the database. With Stripe configured
                                       it returns { url } to Stripe's hosted
                                       payment page; without it, it records
                                       a demo order directly.
     GET  /api/checkout/confirm     -> verifies a Stripe session after the
                                       customer returns, marks the order paid
     POST /api/stripe/webhook       -> production-grade payment confirmation
                                       (needs STRIPE_WEBHOOK_SECRET)

   Configuration comes from a .env file (see .env.example). Without a
   STRIPE_SECRET_KEY everything still works in demo mode.

   Security posture:
   - helmet security headers incl. a strict Content-Security-Policy
   - rate limiting on all API routes, tighter on checkout and auth
   - JSON bodies capped at 10kb
   - every input validated against a whitelist before touching the DB
   - all SQL goes through prepared statements (no injection)
   - prices recomputed server-side — the client's prices are ignored
   - scrypt password hashes, constant-time comparisons, hashed session
     tokens in httpOnly SameSite cookies */

"use strict";

// Load .env if present (Node 22 built-in; fine if the file doesn't exist).
try { process.loadEnvFile(); } catch(e){ /* no .env — demo mode */ }

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const crypto = require("crypto");
const db = require("./db.js");
const { PACK_OPTIONS, linePriceCents } = require("./pricing.js");
const { hashPassword, verifyPassword, DUMMY_HASH, newSessionToken, hashToken } = require("./auth.js");
const { notifyOrderDiscord, emailEnabled, sendCodeEmail } = require("./notify.js");

// On networks that require an outbound proxy (corporate/cloud), route
// Stripe API calls through it. No-op when HTTPS_PROXY isn't set.
let stripeHttpAgent;
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if(proxyUrl){
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    stripeHttpAgent = new HttpsProxyAgent(proxyUrl);
  } catch(e){ /* https-proxy-agent not installed — direct connection */ }
}

const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY, stripeHttpAgent ? { httpAgent: stripeHttpAgent } : {})
  : null;

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const IS_PROD = process.env.NODE_ENV === "production";

const SESSION_COOKIE = "aura_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // 'unsafe-inline' is needed for style="" attributes (animation
      // delays, progress bar width). Scripts stay fully locked down.
      styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));

/* Stripe webhook needs the RAW request body to verify the signature, so
   this route is registered before the JSON body parser. */
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if(!stripe || !process.env.STRIPE_WEBHOOK_SECRET){
    return res.status(400).json({ error: "Webhook not configured." });
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch(e){
    return res.status(400).json({ error: "Invalid signature." });
  }
  if(event.type === "checkout.session.completed"){
    const session = event.data.object;
    if(session.payment_status === "paid") finalizePaidSession(session);
  }
  res.json({ received: true });
});

// Shared by the webhook and the success-page confirm endpoint: stores
// customer email + shipping address on the order, marks it paid, and
// posts the Discord log exactly once (markOrderPaid returns true only
// on the actual transition).
function finalizePaidSession(session){
  const order = db.getOrderByStripeSession(session.id);
  if(!order) return null;

  const customerEmail = (session.customer_details && session.customer_details.email) || null;
  const shipping =
    (session.collected_information && session.collected_information.shipping_details) ||
    session.shipping_details || null;

  db.setOrderCustomer(order.id, customerEmail, shipping);
  const justPaid = db.markOrderPaid(order.id);
  if(justPaid){
    notifyOrderDiscord({
      id: order.id,
      status: "paid",
      subtotal_cents: order.subtotal_cents,
      items: JSON.parse(order.items_json),
      customerEmail,
      shipping
    });
  }
  return db.getOrderById(order.id);
}

app.use(express.json({ limit: "10kb" }));

/* ---------- rate limits ---------- */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 300,
  standardHeaders: "draft-7", legacyHeaders: false
});
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many checkout attempts, try again later." }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many attempts, try again in a few minutes." }
});
app.use("/api/", apiLimiter);
app.use("/api/auth/", authLimiter);

/* ---------- session handling ---------- */
function getCookie(req, name){
  const header = req.headers.cookie || "";
  for(const part of header.split(";")){
    const idx = part.indexOf("=");
    if(idx === -1) continue;
    if(part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

// Sets req.user = { userId, email } when a valid session cookie is present.
app.use((req, res, next) => {
  req.user = null;
  const token = getCookie(req, SESSION_COOKIE);
  if(token && /^[a-f0-9]{64}$/.test(token)){
    req.user = db.getSession(hashToken(token));
  }
  next();
});

function setSessionCookie(res, token){
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PROD,
    maxAge: SESSION_TTL_MS,
    path: "/"
  });
}

function startSession(res, userId){
  const token = newSessionToken();
  db.createSession(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
  setSessionCookie(res, token);
}

function requireAuth(req, res, next){
  if(!req.user) return res.status(401).json({ error: "Sign in required." });
  next();
}

/* ---------- validation helpers ---------- */
const SLUG_RE = /^[a-z0-9-]{1,100}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$/;

function normalizeEmail(raw){
  const email = String(raw || "").trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

function validPassword(raw){
  return typeof raw === "string" && raw.length >= 8 && raw.length <= 128;
}

/* ---------- email codes (verification + password reset) ---------- */
const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RE = /^\d{6}$/;

function issueCode(email, purpose){
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  db.saveEmailCode(email, purpose, hashToken(code), Date.now() + CODE_TTL_MS);
  return sendCodeEmail(email, code, purpose);
}

// Constant-time check; counts attempts so codes can't be brute-forced.
function checkCode(email, purpose, submitted){
  if(!CODE_RE.test(String(submitted || ""))) return false;
  const row = db.getEmailCode(email, purpose);
  if(!row || row.expires_at < Date.now() || row.attempts >= CODE_MAX_ATTEMPTS) return false;
  db.bumpCodeAttempts(email, purpose);
  const a = Buffer.from(hashToken(String(submitted)));
  const b = Buffer.from(row.code_hash);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if(ok) db.deleteEmailCode(email, purpose);
  return ok;
}

/* ---------- auth routes ---------- */
app.post("/api/auth/register", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if(!email) return res.status(400).json({ error: "Enter a valid email address." });
  if(!validPassword(req.body.password)){
    return res.status(400).json({ error: "Password must be 8–128 characters." });
  }
  if(db.getUserByEmail(email)){
    return res.status(409).json({ error: "That email is already registered — sign in instead." });
  }

  // With email configured, accounts start unverified and must enter a
  // code; without it (plain local dev), they're active immediately.
  const needsVerification = emailEnabled();
  const userId = db.createUser(email, hashPassword(req.body.password), !needsVerification);

  if(needsVerification){
    try { await issueCode(email, "verify"); }
    catch(e){
      console.error("Verification email failed:", e.message);
      return res.status(502).json({ error: "Couldn't send the verification email, try again." });
    }
    return res.status(201).json({ verifyRequired: true, email });
  }

  startSession(res, userId);
  res.status(201).json({ user: { email } });
});

app.post("/api/auth/verify", (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if(!email) return res.status(400).json({ error: "Enter a valid email address." });
  const user = db.getUserByEmail(email);
  if(!user) return res.status(400).json({ error: "Invalid or expired code." });
  if(!checkCode(email, "verify", req.body.code)){
    return res.status(400).json({ error: "Invalid or expired code." });
  }
  db.markUserVerified(email);
  startSession(res, user.id);
  res.json({ user: { email } });
});

app.post("/api/auth/resend", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if(!email) return res.status(400).json({ error: "Enter a valid email address." });
  const user = db.getUserByEmail(email);
  // Same response either way — no account probing.
  if(user && !user.verified && emailEnabled()){
    try { await issueCode(email, "verify"); } catch(e){ console.error("Verification email failed:", e.message); }
  }
  res.json({ ok: true });
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  const user = email ? db.getUserByEmail(email) : null;
  // Always run the hash comparison so timing doesn't reveal which emails exist.
  const ok = verifyPassword(String(password || ""), user ? user.password_hash : DUMMY_HASH);
  if(!user || !ok){
    return res.status(401).json({ error: "Invalid email or password." });
  }
  if(!user.verified && emailEnabled()){
    // Correct password but unverified — send a fresh code and bounce
    // them to the code screen.
    try { await issueCode(email, "verify"); } catch(e){ console.error("Verification email failed:", e.message); }
    return res.status(403).json({ verifyRequired: true, email, error: "Check your email for a verification code." });
  }
  startSession(res, user.id);
  res.json({ user: { email: user.email } });
});

app.post("/api/auth/forgot", async (req, res) => {
  if(!emailEnabled()){
    return res.status(400).json({ error: "Password reset requires email to be configured on the server." });
  }
  const email = normalizeEmail(req.body && req.body.email);
  if(!email) return res.status(400).json({ error: "Enter a valid email address." });
  // Same response whether or not the account exists — no probing.
  if(db.getUserByEmail(email)){
    try { await issueCode(email, "reset"); } catch(e){ console.error("Reset email failed:", e.message); }
  }
  res.json({ ok: true, message: "If that email has an account, a reset code is on its way." });
});

app.post("/api/auth/reset", (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if(!email) return res.status(400).json({ error: "Enter a valid email address." });
  if(!validPassword(req.body.newPassword)){
    return res.status(400).json({ error: "Password must be 8–128 characters." });
  }
  const user = db.getUserByEmail(email);
  if(!user || !checkCode(email, "reset", req.body.code)){
    return res.status(400).json({ error: "Invalid or expired code." });
  }
  db.updateUserPassword(user.id, hashPassword(req.body.newPassword));
  db.markUserVerified(email);          // proving email ownership verifies too
  db.deleteSessionsForUser(user.id);   // log out any stolen/old sessions
  startSession(res, user.id);
  res.json({ user: { email } });
});

app.post("/api/auth/logout", (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);
  if(token && /^[a-f0-9]{64}$/.test(token)) db.deleteSession(hashToken(token));
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.user ? { email: req.user.email } : null });
});

app.get("/api/orders", requireAuth, (req, res) => {
  res.json(db.listOrdersForUser(req.user.userId));
});

/* ---------- product routes ---------- */
app.get("/api/products", (req, res) => {
  res.json(db.listProducts());
});

app.get("/api/products/:slug", (req, res) => {
  const slug = String(req.params.slug || "");
  if(!SLUG_RE.test(slug)) return res.status(400).json({ error: "Invalid product id." });
  const row = db.getProductRow(slug);
  if(!row) return res.status(404).json({ error: "Product not found." });
  res.json(db.toApiProduct(row));
});

/* ---------- checkout ---------- */
function validateCart(items){
  if(!Array.isArray(items) || items.length === 0 || items.length > 50){
    return { error: "Cart must contain between 1 and 50 lines." };
  }
  let subtotalCents = 0;
  const validated = [];
  for(const raw of items){
    if(typeof raw !== "object" || raw === null) return { error: "Malformed cart line." };
    const slug = String(raw.slug || "");
    const option = String(raw.option || "");
    const qty = raw.qty;
    if(!SLUG_RE.test(slug)) return { error: "Invalid product id." };
    if(!Object.prototype.hasOwnProperty.call(PACK_OPTIONS, option)) return { error: "Unknown pack option." };
    if(!Number.isInteger(qty) || qty < 1 || qty > 99){
      return { error: "Quantity must be a whole number between 1 and 99." };
    }
    const product = db.getProductRow(slug);
    if(!product) return { error: "Unknown product: " + slug };

    const opt = PACK_OPTIONS[option];
    const lineCents = linePriceCents(product.price_cents, option);
    subtotalCents += lineCents * qty;
    validated.push({
      slug, option, qty,
      name: product.name + (opt.packOf > 1 ? " (" + opt.label + ")" : ""),
      unit_price_cents: lineCents
    });
  }
  return { subtotalCents, validated };
}

app.post("/api/checkout", checkoutLimiter, async (req, res) => {
  const result = validateCart(req.body && req.body.items);
  if(result.error) return res.status(400).json({ error: result.error });
  const { subtotalCents, validated } = result;

  // No Stripe key configured -> record a demo order, no payment.
  if(!stripe){
    const orderId = db.createOrder(subtotalCents, validated, {
      userId: req.user ? req.user.userId : null,
      status: "demo"
    });
    notifyOrderDiscord({
      id: orderId, status: "demo", subtotal_cents: subtotalCents,
      items: validated, customerEmail: req.user ? req.user.email : null
    });
    return res.status(201).json({ orderId, subtotal: subtotalCents / 100, demo: true });
  }

  try {
    const origin = req.protocol + "://" + req.get("host");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // Newer Stripe accounts enable "Managed Payments" by default, which
      // only allows a narrow list of product tax categories. This store
      // uses standard payments (you are the merchant), so opt out here.
      managed_payments: { enabled: false },
      line_items: validated.map(item => ({
        quantity: item.qty,
        price_data: {
          currency: "usd",
          unit_amount: item.unit_price_cents,
          product_data: { name: item.name }
        }
      })),
      customer_email: req.user ? req.user.email : undefined,
      // Stripe collects the shipping address on its payment page; it's
      // saved onto the order once the payment is confirmed. Add/remove
      // countries here to control where you ship.
      shipping_address_collection: {
        allowed_countries: [
          "SE", "NO", "DK", "FI", "IS",
          "US", "CA", "GB", "IE", "AU", "NZ",
          "DE", "FR", "NL", "BE", "AT", "CH", "ES", "IT", "PT",
          "PL", "CZ", "EE", "LV", "LT", "JP"
        ]
      },
      success_url: origin + "/checkout-success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: origin + "/index.html"
    });
    db.createOrder(subtotalCents, validated, {
      userId: req.user ? req.user.userId : null,
      status: "pending",
      stripeSessionId: session.id
    });
    res.status(201).json({ url: session.url });
  } catch(e){
    console.error("Stripe checkout error:", e.message);
    res.status(502).json({ error: "Payment service unavailable, try again shortly." });
  }
});

// The customer lands back on checkout-success.html with a session_id;
// this verifies with Stripe that the session was actually paid. (The
// webhook above does the same job server-to-server in production.)
app.get("/api/checkout/confirm", async (req, res) => {
  if(!stripe) return res.status(400).json({ error: "Payments are not configured." });
  const sessionId = String(req.query.session_id || "");
  if(!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)){
    return res.status(400).json({ error: "Invalid session id." });
  }
  const order = db.getOrderByStripeSession(sessionId);
  if(!order) return res.status(404).json({ error: "Order not found." });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if(session.payment_status === "paid"){
      finalizePaidSession(session);
      return res.json({ orderId: order.id, subtotal: order.subtotal_cents / 100, status: "paid" });
    }
    res.json({ orderId: order.id, subtotal: order.subtotal_cents / 100, status: order.status });
  } catch(e){
    console.error("Stripe confirm error:", e.message);
    res.status(502).json({ error: "Could not verify payment, contact support." });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Static site: index.html, product.html, styles.css, js/
app.use(express.static(ROOT, {
  extensions: ["html"],
  index: "index.html",
  dotfiles: "ignore"
}));

app.listen(PORT, () => {
  console.log(`Aura store running at http://localhost:${PORT}`);
  console.log(stripe
    ? "Stripe payments: ENABLED"
    : "Stripe payments: not configured (demo checkout) — add STRIPE_SECRET_KEY to .env to enable");
  console.log(process.env.DISCORD_WEBHOOK_URL
    ? "Discord order log: ENABLED"
    : "Discord order log: not configured — add DISCORD_WEBHOOK_URL to .env to enable");
  console.log(emailEnabled()
    ? "Email verification: ENABLED" + (process.env.SMTP_HOST ? " (SMTP)" : " (EMAIL_DEBUG — codes print here)")
    : "Email verification: off — accounts activate instantly (configure SMTP_* or EMAIL_DEBUG=1 in .env)");
});
