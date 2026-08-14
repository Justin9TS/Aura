/* Aura backend: serves the static site + a small JSON API.
     GET  /api/products        -> full catalog
     GET  /api/products/:slug  -> one product
     POST /api/checkout        -> validates the cart, prices it from the
                                  database and records an order

   Security posture (the "stop hackers" part):
   - helmet sets security headers incl. a strict Content-Security-Policy
   - rate limiting on all API routes, tighter on checkout
   - JSON bodies capped at 10kb
   - every input validated against a whitelist before touching the DB
   - all SQL goes through prepared statements (no injection)
   - prices are recomputed server-side — the client's prices are ignored */

"use strict";

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { listProducts, getProductRow, createOrder } = require("./db.js");
const { PACK_OPTIONS, linePriceCents } = require("./pricing.js");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");

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

app.use(express.json({ limit: "10kb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many checkout attempts, try again later." }
});
app.use("/api/", apiLimiter);

const SLUG_RE = /^[a-z0-9-]{1,100}$/;

app.get("/api/products", (req, res) => {
  res.json(listProducts());
});

app.get("/api/products/:slug", (req, res) => {
  const slug = String(req.params.slug || "");
  if(!SLUG_RE.test(slug)){
    return res.status(400).json({ error: "Invalid product id." });
  }
  const row = getProductRow(slug);
  if(!row) return res.status(404).json({ error: "Product not found." });
  res.json(require("./db.js").toApiProduct(row));
});

app.post("/api/checkout", checkoutLimiter, (req, res) => {
  const body = req.body;
  if(!body || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50){
    return res.status(400).json({ error: "Cart must contain between 1 and 50 lines." });
  }

  let subtotalCents = 0;
  const validated = [];

  for(const raw of body.items){
    if(typeof raw !== "object" || raw === null){
      return res.status(400).json({ error: "Malformed cart line." });
    }
    const slug = String(raw.slug || "");
    const option = String(raw.option || "");
    const qty = raw.qty;

    if(!SLUG_RE.test(slug)){
      return res.status(400).json({ error: "Invalid product id." });
    }
    if(!Object.prototype.hasOwnProperty.call(PACK_OPTIONS, option)){
      return res.status(400).json({ error: "Unknown pack option." });
    }
    if(!Number.isInteger(qty) || qty < 1 || qty > 99){
      return res.status(400).json({ error: "Quantity must be a whole number between 1 and 99." });
    }

    const product = getProductRow(slug);
    if(!product){
      return res.status(400).json({ error: "Unknown product: " + slug });
    }

    const lineCents = linePriceCents(product.price_cents, option);
    subtotalCents += lineCents * qty;
    validated.push({
      slug,
      option,
      qty,
      name: product.name,
      unit_price_cents: lineCents
    });
  }

  const orderId = createOrder(subtotalCents, validated);
  res.status(201).json({
    orderId,
    subtotalCents,
    subtotal: subtotalCents / 100
  });
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
});
