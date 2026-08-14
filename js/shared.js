/* Shared site chrome + cart logic, used by every page.
   Injects the navbar, drawers, overlay, toast, cookie banner,
   discount button/modal and footer, so each page only contains
   its own main content. The cart is stored in localStorage so it
   carries across pages. */

"use strict";

const FREE_SHIPPING_THRESHOLD = 150;
const CART_STORAGE_KEY = "aura-cart-v2";

// Faint placeholder icon shown until a real product photo is added.
const PLACEHOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#4B82E8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

// Small inline SVG icon set (stroke style matches the rest of the site).
// Use like: ICONS.gift — colored via CSS `color` (stroke:currentColor).
const ICONS = {
  gift: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  returns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 4v5h5"/><path d="M12 7v5l3 3"/></svg>',
  check: '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>'
};

// Prices live in USD internally; these render them in whatever currency
// the shopper is browsing in (see js/currency.js).
function fmtPrice(usd){ return formatUsd(usd); }
function fmtMoney(usd){ return formatUsd(usd); }

function el(tag, cls, html){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(html !== undefined) e.innerHTML = html;
  return e;
}

// Builds a 5-star row: filled (yellow) stars up to the rounded rating,
// the rest stay gray. Reads straight from a product's rating/reviews
// fields, so it updates on its own once a review system sets those.
function starsMarkup(rating, reviewCount){
  const filledCount = Math.round(rating || 0);
  let stars = "";
  for(let i = 1; i <= 5; i++){
    stars += '<span class="star' + (i <= filledCount ? " filled" : "") + '">★</span>';
  }
  return '<span class="stars">' + stars + '</span><span class="review-count">(' + (reviewCount || 0) + ')</span>';
}

function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), 2400);
}

/* ---------- Inject shared chrome ---------- */

const CHROME_HEADER = `
<header>
  <div class="header-inner">
    <div class="nav-left">
      <a class="brand" href="index.html">Aura</a>
      <button class="shop-btn" id="shopBtn" type="button" aria-expanded="false">
        SHOP <span class="caret">▾</span>
      </button>
      <button class="nav-tab" type="button">Tab1</button>
      <button class="nav-tab" type="button">Tab2</button>
      <button class="nav-tab" type="button">Tab 3</button>
    </div>

    <div class="nav-right">
      <button class="icon-btn" id="accountBtn" type="button" aria-label="Account">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      </button>
      <button class="cart-btn" id="cartBtn" type="button" aria-label="Cart">
        Cart <span id="cartCount">0</span>
      </button>
    </div>
  </div>

  <div class="mega-menu" id="megaMenu">
    <div class="mega-inner">
      <div class="mega-col">
        <h3>Shop</h3>
        <ul>
          <li><a href="index.html">All Products</a></li>
          <li><a href="#">Home</a></li>
          <li><a href="#">Kitchen</a></li>
          <li><a href="#">Wellness</a></li>
          <li><a href="#">Stationery</a></li>
          <li><a href="#">Bags</a></li>
        </ul>
      </div>
      <div class="mega-col mega-products">
        <h3>Products</h3>
        <ul id="megaProductList"></ul>
        <a class="mega-view-all" href="index.html">View all products →</a>
      </div>
      <div class="mega-col">
        <h3>Featured</h3>
        <a class="mega-feature" href="index.html">
          <div class="mega-image">${PLACEHOLDER_ICON}</div>
          <span class="mega-feature-title">New arrivals</span>
          <span class="mega-feature-sub">Fresh picks for your setup</span>
        </a>
      </div>
      <div class="mega-col">
        <h3>Deals</h3>
        <a class="mega-feature" href="index.html">
          <div class="mega-image">${PLACEHOLDER_ICON}</div>
          <span class="mega-feature-title">Save up to 15%</span>
          <span class="mega-feature-sub">Follow us on TikTok &amp; Youtube</span>
        </a>
      </div>
    </div>
  </div>
</header>`;

const CHROME_FOOTER = `
<footer>
  <div class="country-picker-wrap">
    <button class="country-picker-btn" id="countryPickerBtn" type="button" aria-expanded="false">
      <span id="countryPickerLabel">Loading…</span>
      <span class="caret">▾</span>
    </button>
    <div class="country-menu" id="countryMenu" role="listbox"></div>
  </div>
  <div class="copy">©2026, Aura</div>
  <div class="foot-links">
    <a href="https://based.com/pages/privacy-policy">Privacy Notice</a>
    <a href="https://based.com/pages/accessibility-statement">Accessibility Statement</a>
    <a href="https://based.com/pages/terms-of-service">Terms of Service</a>
    <a href="https://dsar.cptn.co/dsar/b20b8b7f-800f-408d-a028-702bd42da3a7">DSR Portal</a>
  </div>
</footer>

<div class="toast" id="toast"></div>

<div class="ui-overlay" id="uiOverlay"></div>

<aside class="cart-drawer" id="cartDrawer" aria-hidden="true">
  <div class="cart-head">
    <h2 id="cartHeadText">0 items in cart</h2>
    <button class="cart-close" id="cartCloseBtn" type="button" aria-label="Close cart">✕</button>
  </div>

  <div class="cart-shipping">
    <p id="shipText">Add $150 to unlock FREE SHIPPING</p>
    <div class="ship-track"><div class="ship-fill" id="shipFill"></div></div>
  </div>

  <div class="cart-items" id="cartItems"></div>

  <div class="cart-foot">
    <button class="checkout-btn" id="checkoutBtn" type="button">Continue to checkout</button>
  </div>
</aside>

<aside class="account-drawer" id="accountDrawer" aria-hidden="true">
  <div class="cart-head">
    <h2>Account</h2>
    <button class="cart-close" id="accountCloseBtn" type="button" aria-label="Close account panel">✕</button>
  </div>
  <div class="account-body" id="accountBody"></div>
</aside>

<button class="discount-btn" id="discountBtn" type="button">Claim 15% Discount</button>

<div class="discount-modal" id="discountModal" aria-hidden="true">
  <div class="discount-head">
    <h2>Discount</h2>
    <button class="cart-close" id="discountCloseBtn" type="button" aria-label="Close discount panel">✕</button>
  </div>
  <div class="discount-body">This is the discount tab — empty for now.</div>
</div>

<div class="cookie-banner" id="cookieBanner">
  <p><strong>We use cookies.</strong> Aura uses cookies to remember your cart and improve your shopping experience. You can allow all cookies, reject non-essential ones, or manage your settings.</p>
  <div class="cookie-actions">
    <button class="reject" id="cookieReject" type="button">Reject</button>
    <button id="cookieSettings" type="button">Cookie settings</button>
    <button class="allow" id="cookieAllow" type="button">Allow all</button>
  </div>
</div>`;

document.body.insertAdjacentHTML("afterbegin", CHROME_HEADER);
document.body.insertAdjacentHTML("beforeend", CHROME_FOOTER);

/* ---------- Cart (persisted in localStorage) ---------- */

// cart: array of { id, slug, option, name, price, qty, addedAt }
// `slug` + `option` are what the backend uses to re-price everything at
// checkout — the client-side `price` is only for display.
let cart = loadCart();

function loadCart(){
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch(e){
    return [];
  }
}

function saveCart(){
  try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch(e){ /* private mode etc. */ }
}

// Adds a line to the cart. `entry` needs { slug, option, name, price }.
function addToCart(entry, qty){
  qty = qty || 1;
  const id = entry.slug + ":" + entry.option;
  const existing = cart.find(item => item.id === id);
  if(existing){
    existing.qty += qty;
    existing.addedAt = Date.now();
  } else {
    cart.push({
      id: id,
      slug: entry.slug,
      option: entry.option,
      name: entry.name,
      price: entry.price,
      qty: qty,
      addedAt: Date.now()
    });
  }
  saveCart();
  renderCart();
}

function changeQty(id, delta){
  const item = cart.find(i => i.id === id);
  if(!item) return;
  item.qty = Math.max(1, item.qty + delta);
  saveCart();
  renderCart();
}

function removeItem(id){
  cart = cart.filter(i => i.id !== id);
  saveCart();
  renderCart();
}

function clearCart(){
  cart = [];
  saveCart();
  renderCart();
}

function cartTotals(){
  const totalQty = cart.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = cart.reduce((sum, i) => sum + i.qty * i.price, 0);
  return { totalQty, subtotal };
}

function bumpCartButton(){
  const cartBtn = document.getElementById("cartBtn");
  cartBtn.classList.remove("bump"); void cartBtn.offsetWidth; cartBtn.classList.add("bump");
}

function renderCart(){
  const { totalQty, subtotal } = cartTotals();

  document.getElementById("cartCount").textContent = totalQty;

  document.getElementById("cartHeadText").textContent =
    totalQty === 1 ? "1 item in cart" : totalQty + " items in cart";

  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const pct = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);
  const shipText = document.getElementById("shipText");
  if(remaining <= 0){
    shipText.innerHTML = "You've unlocked FREE SHIPPING " + ICONS.check;
    shipText.classList.add("unlocked");
  } else {
    shipText.textContent = "Add " + fmtMoney(remaining) + " to unlock FREE SHIPPING";
    shipText.classList.remove("unlocked");
  }
  document.getElementById("shipFill").style.width = pct + "%";

  const itemsBox = document.getElementById("cartItems");
  itemsBox.innerHTML = "";

  if(cart.length === 0){
    itemsBox.appendChild(el("div", "cart-empty", "Your cart is empty."));
    document.getElementById("checkoutBtn").disabled = true;
    return;
  }
  document.getElementById("checkoutBtn").disabled = false;

  // Latest added shown on top.
  const sorted = cart.slice().sort((a, b) => b.addedAt - a.addedAt);

  sorted.forEach(item => {
    const row = el("div", "cart-item");

    const img = el("div", "cart-item-img", PLACEHOLDER_ICON);
    row.appendChild(img);

    const info = el("div", "cart-item-info");

    const top = el("div", "cart-item-top");
    top.appendChild(el("div", "cart-item-name", item.name));
    top.appendChild(el("div", "cart-item-price", fmtPrice(item.price)));
    info.appendChild(top);

    const qty = el("div", "qty-control");
    const minus = el("button", "", "−");
    minus.type = "button";
    minus.setAttribute("aria-label", "Decrease quantity");
    minus.addEventListener("click", () => changeQty(item.id, -1));
    const count = el("span", "", String(item.qty));
    const plus = el("button", "", "+");
    plus.type = "button";
    plus.setAttribute("aria-label", "Increase quantity");
    plus.addEventListener("click", () => changeQty(item.id, 1));
    qty.appendChild(minus); qty.appendChild(count); qty.appendChild(plus);
    info.appendChild(qty);

    row.appendChild(info);

    const remove = el("button", "cart-item-remove", "✕");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + item.name);
    remove.addEventListener("click", () => removeItem(item.id));
    row.appendChild(remove);

    itemsBox.appendChild(row);
  });
}

/* ---------- Shared overlay + panel management ---------- */
// Only one of cart / account / discount is ever open at a time; they
// all share the same dimmed overlay behind them.
const overlay = document.getElementById("uiOverlay");
const panels = {
  cart: document.getElementById("cartDrawer"),
  account: document.getElementById("accountDrawer"),
  discount: document.getElementById("discountModal")
};

function closeAllPanels(){
  Object.values(panels).forEach(p => {
    p.classList.remove("show");
    p.setAttribute("aria-hidden", "true");
  });
  overlay.classList.remove("show");
}

function openPanel(name){
  closeAllPanels();
  panels[name].classList.add("show");
  panels[name].setAttribute("aria-hidden", "false");
  overlay.classList.add("show");
}

document.getElementById("cartBtn").addEventListener("click", () => openPanel("cart"));
document.getElementById("cartCloseBtn").addEventListener("click", closeAllPanels);

document.getElementById("accountBtn").addEventListener("click", () => {
  openPanel("account");
  refreshAccountPanel();
});
document.getElementById("accountCloseBtn").addEventListener("click", closeAllPanels);

document.getElementById("discountBtn").addEventListener("click", () => openPanel("discount"));
document.getElementById("discountCloseBtn").addEventListener("click", closeAllPanels);

overlay.addEventListener("click", closeAllPanels);
document.addEventListener("keydown", (e) => { if(e.key === "Escape") closeAllPanels(); });

/* ---------- Checkout ---------- */
// Sends only { slug, option, qty } — the server looks prices up in the
// database, so tampering with client-side prices changes nothing.
// With Stripe configured the server answers with a payment page URL and
// the cart is cleared on the success page after payment; without Stripe
// it records a demo order right away.
document.getElementById("checkoutBtn").addEventListener("click", async () => {
  if(cart.length === 0) return;
  const btn = document.getElementById("checkoutBtn");
  btn.disabled = true;
  btn.textContent = "Processing…";
  try {
    const order = await apiCheckout(cart.map(i => ({ slug: i.slug, option: i.option, qty: i.qty })));
    if(order.url){
      window.location.href = order.url;
      return;
    }
    clearCart();
    closeAllPanels();
    showToast("Order #" + order.orderId + " recorded — " + fmtPrice(order.subtotal) + " total. (Demo: payments not configured.)");
  } catch(e){
    showToast(e instanceof TypeError
      ? "No backend running — start it with: npm start"
      : e.message);
  } finally {
    btn.textContent = "Continue to checkout";
    renderCart();
  }
});

/* ---------- Shop mega-menu ---------- */
const shopBtn = document.getElementById("shopBtn");
const megaMenu = document.getElementById("megaMenu");

productsReady.then(products => {
  const megaProductList = document.getElementById("megaProductList");
  products.slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(p => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "product.html?p=" + p.slug;
      a.textContent = p.name;
      li.appendChild(a);
      megaProductList.appendChild(li);
    });
});

function toggleMegaMenu(force){
  const show = force !== undefined ? force : !megaMenu.classList.contains("show");
  megaMenu.classList.toggle("show", show);
  shopBtn.classList.toggle("open", show);
  shopBtn.setAttribute("aria-expanded", String(show));
}
shopBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleMegaMenu(); });
document.addEventListener("click", (e) => {
  if(!megaMenu.contains(e.target) && e.target !== shopBtn){
    toggleMegaMenu(false);
  }
});
document.addEventListener("keydown", (e) => { if(e.key === "Escape") toggleMegaMenu(false); });

/* ---------- Account panel ---------- */
// Modes: login, register, verify (enter emailed code), forgot (reset
// password with emailed code). `pendingEmail` carries the address
// between the register/login step and the code step.
const ACCOUNT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
let authMode = "login";
let pendingEmail = "";

async function refreshAccountPanel(){
  const body = document.getElementById("accountBody");
  let me = null;
  try {
    me = await apiMe();
  } catch(e){
    body.innerHTML = "";
    body.appendChild(el("div", "icon-circle", ACCOUNT_ICON));
    body.appendChild(el("h3", "", "Accounts need the backend"));
    body.appendChild(el("p", "", "Start the server with <code>npm start</code> and open the site at localhost:3000 to sign in."));
    return;
  }
  if(me.user){
    authMode = "login"; // after signing out, the form starts on "Sign in"
    renderLoggedIn(body, me.user);
  } else {
    renderAuthForm(body);
  }
}

function authInput(type, placeholder, autocomplete){
  const i = el("input", "auth-input");
  i.type = type; i.placeholder = placeholder;
  if(autocomplete) i.autocomplete = autocomplete;
  i.required = true; i.maxLength = type === "password" ? 128 : 254;
  return i;
}

function authHeader(body, title, sub){
  body.innerHTML = "";
  body.classList.remove("logged-in");
  body.appendChild(el("div", "icon-circle", ACCOUNT_ICON));
  body.appendChild(el("h3", "", title));
  const p = el("p");
  p.textContent = sub;
  body.appendChild(p);
}

function authToggle(body, html, onClick){
  const t = el("button", "auth-toggle", html);
  t.type = "button";
  t.addEventListener("click", onClick);
  body.appendChild(t);
}

function wireSubmit(form, error, submit, action){
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    try {
      await action();
    } catch(err){
      // A 403 login on an unverified account carries verifyRequired —
      // jump straight to the code screen instead of showing an error.
      if(err.data && err.data.verifyRequired){
        pendingEmail = err.data.email;
        authMode = "verify";
        renderAuthForm(document.getElementById("accountBody"));
        return;
      }
      error.textContent = err instanceof TypeError ? "No backend running." : err.message;
      submit.disabled = false;
    }
  });
}

function renderAuthForm(body){
  const form = el("form", "auth-form");
  form.noValidate = true;
  const error = el("div", "auth-error");
  const submit = el("button", "auth-submit");
  submit.type = "submit";

  if(authMode === "verify"){
    authHeader(body, "Check your email",
      "We sent a 6-digit code to " + pendingEmail + ". Enter it below to activate your account.");
    const code = authInput("text", "6-digit code", "one-time-code");
    code.inputMode = "numeric"; code.maxLength = 6;
    submit.textContent = "Verify";
    form.appendChild(code); form.appendChild(error); form.appendChild(submit);
    wireSubmit(form, error, submit, async () => {
      const result = await apiVerify(pendingEmail, code.value.trim());
      showToast("Welcome to Aura, " + result.user.email);
      refreshAccountPanel();
    });
    body.appendChild(form);
    authToggle(body, "Didn't get it? <strong>Send a new code</strong>", async () => {
      try { await apiResend(pendingEmail); } catch(e){ /* rate limited or offline */ }
      showToast("If the address is right, a new code is on its way.");
    });
    authToggle(body, "<strong>Back to sign in</strong>", () => { authMode = "login"; renderAuthForm(body); });
    return;
  }

  if(authMode === "forgot"){
    authHeader(body, "Reset your password",
      "Enter your email — we'll send a 6-digit code. Then set a new password below.");
    const email = authInput("email", "Email", "email");
    if(pendingEmail) email.value = pendingEmail;
    const sendBtn = el("button", "auth-submit secondary", "Send code");
    sendBtn.type = "button";
    const code = authInput("text", "6-digit code", "one-time-code");
    code.inputMode = "numeric"; code.maxLength = 6;
    const newPass = authInput("password", "New password (8+ characters)", "new-password");
    submit.textContent = "Set new password";
    form.appendChild(email); form.appendChild(sendBtn);
    form.appendChild(code); form.appendChild(newPass);
    form.appendChild(error); form.appendChild(submit);
    sendBtn.addEventListener("click", async () => {
      error.textContent = "";
      sendBtn.disabled = true;
      try {
        const r = await apiForgot(email.value.trim());
        showToast(r.message || "Code sent.");
      } catch(err){
        error.textContent = err instanceof TypeError ? "No backend running." : err.message;
      }
      sendBtn.disabled = false;
    });
    wireSubmit(form, error, submit, async () => {
      const result = await apiReset(email.value.trim(), code.value.trim(), newPass.value);
      showToast("Password updated — signed in as " + result.user.email);
      refreshAccountPanel();
    });
    body.appendChild(form);
    authToggle(body, "<strong>Back to sign in</strong>", () => { authMode = "login"; renderAuthForm(body); });
    return;
  }

  const isLogin = authMode === "login";
  authHeader(body, isLogin ? "Sign in" : "Create an account",
    isLogin ? "Welcome back — your orders are waiting." : "Track your orders and check out faster.");

  const email = authInput("email", "Email", "email");
  const password = authInput("password", "Password (8+ characters)", isLogin ? "current-password" : "new-password");
  // Invisible honeypot field — humans never see it, form-filling bots
  // fill it, and the server rejects any request where it has a value.
  const trap = el("input", "hp-field");
  trap.type = "text"; trap.name = "website"; trap.tabIndex = -1;
  trap.autocomplete = "off"; trap.setAttribute("aria-hidden", "true");
  submit.textContent = isLogin ? "Sign in" : "Create account";
  form.appendChild(email); form.appendChild(password); form.appendChild(trap);
  form.appendChild(error); form.appendChild(submit);

  wireSubmit(form, error, submit, async () => {
    const call = isLogin ? apiLogin : apiRegister;
    const result = await call(email.value.trim(), password.value, trap.value);
    if(result.verifyRequired){
      pendingEmail = result.email;
      authMode = "verify";
      renderAuthForm(body);
      return;
    }
    showToast(isLogin ? "Signed in as " + result.user.email : "Welcome to Aura, " + result.user.email);
    refreshAccountPanel();
  });
  body.appendChild(form);

  if(isLogin){
    authToggle(body, "<strong>Forgot password?</strong>", () => {
      pendingEmail = email.value.trim();
      authMode = "forgot"; renderAuthForm(body);
    });
  }
  authToggle(body, isLogin
    ? "New here? <strong>Create an account</strong>"
    : "Already have an account? <strong>Sign in</strong>", () => {
    authMode = isLogin ? "register" : "login";
    renderAuthForm(body);
  });
}

async function renderLoggedIn(body, user){
  body.innerHTML = "";
  body.classList.add("logged-in");

  body.appendChild(el("div", "icon-circle", ACCOUNT_ICON));
  // textContent, not innerHTML — the email is user-controlled input.
  const who = el("h3");
  who.textContent = user.email;
  body.appendChild(who);

  const ordersBox = el("div", "orders-box");
  ordersBox.appendChild(el("h4", "", "Your orders"));
  const list = el("div", "orders-list", "Loading…");
  ordersBox.appendChild(list);
  body.appendChild(ordersBox);

  const signOut = el("button", "auth-signout", "Sign out");
  signOut.type = "button";
  signOut.addEventListener("click", async () => {
    try { await apiLogout(); } catch(e){ /* session cookie cleared server-side anyway */ }
    showToast("Signed out.");
    refreshAccountPanel();
  });
  body.appendChild(signOut);

  try {
    const orders = await apiOrders();
    list.innerHTML = "";
    if(orders.length === 0){
      list.appendChild(el("div", "orders-empty", "No orders yet — your first one will show up here."));
      return;
    }
    orders.forEach(o => {
      const row = el("div", "order-row");
      const names = o.items.map(i => i.name + (i.qty > 1 ? " ×" + i.qty : "")).join(", ");
      row.appendChild(el("div", "order-row-top",
        "<span>Order #" + o.id + "</span><span class='order-status " + o.status + "'>" + o.status + "</span>"));
      const nameDiv = el("div", "order-names");
      nameDiv.textContent = names;
      row.appendChild(nameDiv);
      // Show what was actually charged when we know it, so an old order
      // doesn't get re-quoted at today's rate in a different currency.
      const amount = o.chargedMinor
        ? formatMinor(o.chargedMinor, o.currency)
        : fmtPrice(o.subtotal);
      row.appendChild(el("div", "order-row-bottom",
        "<span>" + o.createdAt.split(" ")[0] + "</span><span>" + amount + "</span>"));
      list.appendChild(row);
    });
  } catch(e){
    list.textContent = "Couldn't load orders.";
  }
}

/* ---------- Country / currency picker ---------- */
// Shows the country we detected (or the one matching the chosen
// currency) and lets the shopper switch. Changing it reloads so every
// price on the page is re-rendered from the new rate.
const FLAGS = {
  SE:"🇸🇪", NO:"🇳🇴", DK:"🇩🇰", FI:"🇫🇮", IS:"🇮🇸", DE:"🇩🇪", FR:"🇫🇷", NL:"🇳🇱",
  BE:"🇧🇪", AT:"🇦🇹", ES:"🇪🇸", IT:"🇮🇹", PT:"🇵🇹", IE:"🇮🇪", PL:"🇵🇱", CH:"🇨🇭",
  GB:"🇬🇧", US:"🇺🇸", CA:"🇨🇦", AU:"🇦🇺", NZ:"🇳🇿", JP:"🇯🇵"
};

currencyReady.then(() => {
  const btn = document.getElementById("countryPickerBtn");
  const menu = document.getElementById("countryMenu");
  const label = document.getElementById("countryPickerLabel");
  if(!btn || !COUNTRY_LIST.length){
    if(label) label.textContent = activeCurrency();
    return;
  }

  // Which country to show as current: the detected one when it matches
  // the active currency, otherwise the first country using it.
  const current = (DETECTED_COUNTRY && COUNTRY_CURRENCY[DETECTED_COUNTRY] === activeCurrency())
    ? DETECTED_COUNTRY
    : (COUNTRY_LIST.find(c => COUNTRY_CURRENCY[c.code] === activeCurrency()) || {}).code;

  function renderLabel(){
    const country = COUNTRY_LIST.find(c => c.code === current);
    const flag = current ? (FLAGS[current] || "") : "";
    label.textContent = (flag ? flag + " " : "") +
      (country ? country.name : "International") + " · " + activeCurrency();
  }
  renderLabel();

  COUNTRY_LIST.forEach(c => {
    const code = COUNTRY_CURRENCY[c.code] || "USD";
    const item = el("button", "country-item" + (c.code === current ? " active" : ""),
      "<span class='country-flag'>" + (FLAGS[c.code] || "") + "</span>" +
      "<span class='country-name'></span>" +
      "<span class='country-cur'>" + code + "</span>");
    item.type = "button";
    item.setAttribute("role", "option");
    item.querySelector(".country-name").textContent = c.name;
    item.addEventListener("click", async () => {
      try {
        await setCurrency(code);
        window.location.reload();
      } catch(e){
        showToast("Couldn't change currency.");
      }
    });
    menu.appendChild(item);
  });

  function toggleMenu(force){
    const show = force !== undefined ? force : !menu.classList.contains("show");
    menu.classList.toggle("show", show);
    btn.setAttribute("aria-expanded", String(show));
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener("click", (e) => {
    if(!menu.contains(e.target) && e.target !== btn) toggleMenu(false);
  });
  document.addEventListener("keydown", (e) => { if(e.key === "Escape") toggleMenu(false); });
});

/* ---------- Cookie notice ---------- */
const cookieBanner = document.getElementById("cookieBanner");
function dismissCookies(message){
  cookieBanner.classList.remove("show");
  showToast(message);
}
document.getElementById("cookieAllow").addEventListener("click", () => dismissCookies("All cookies allowed."));
document.getElementById("cookieReject").addEventListener("click", () => dismissCookies("Non-essential cookies rejected."));
document.getElementById("cookieSettings").addEventListener("click", () => dismissCookies("Cookie preferences saved."));
setTimeout(() => cookieBanner.classList.add("show"), 400);

// Wait for the currency so the cart never flashes the wrong prices.
currencyReady.then(renderCart);
