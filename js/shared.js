/* Shared site chrome + cart logic, used by every page.
   Injects the navbar, drawers, overlay, toast, cookie banner,
   discount button/modal and footer, so each page only contains
   its own main content. The cart is stored in localStorage so it
   carries across pages. */

"use strict";

const FREE_SHIPPING_THRESHOLD = 150;
const CART_STORAGE_KEY = "aura-cart-v1";

// Faint placeholder icon shown until a real product photo is added.
const PLACEHOLDER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#4B82E8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';

function fmtPrice(n){ return "$" + n.toFixed(2); }
function fmtMoney(n){
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? "$" + rounded.toFixed(0) : "$" + rounded.toFixed(2);
}

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
  showToast._t = setTimeout(() => t.classList.remove("show"), 2000);
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

      <div class="mega-menu" id="megaMenu">
        <div class="mega-inner">
          <div class="mega-col">
            <h3>Shop</h3>
            <ul>
              <li><a href="#">Shop 1</a></li>
              <li><a href="#">Shop 2</a></li>
              <li><a href="#">Shop 3</a></li>
              <li><a href="#">Shop 4</a></li>
            </ul>
          </div>
          <div class="mega-col mega-products">
            <h3>Products</h3>
            <ul id="megaProductList"></ul>
          </div>
          <div class="mega-col">
            <div class="mega-image">${PLACEHOLDER_ICON}</div>
          </div>
        </div>
      </div>
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
</header>`;

const CHROME_FOOTER = `
<footer>
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
  <div class="account-body">
    <div class="icon-circle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
    </div>
    <h3>Sign in or create an account</h3>
    <p>Account creation and sign-in aren't wired up yet — this panel is a placeholder for that flow.</p>
  </div>
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

// cart: array of { id, name, price, qty, addedAt }
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

// Adds a line to the cart. `entry` needs { id, name, price }; qty defaults to 1.
function addToCart(entry, qty){
  qty = qty || 1;
  const existing = cart.find(item => item.id === entry.id);
  if(existing){
    existing.qty += qty;
    existing.addedAt = Date.now();
  } else {
    cart.push({
      id: entry.id,
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
    shipText.textContent = "You've unlocked FREE SHIPPING 🎉";
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

document.getElementById("accountBtn").addEventListener("click", () => openPanel("account"));
document.getElementById("accountCloseBtn").addEventListener("click", closeAllPanels);

document.getElementById("discountBtn").addEventListener("click", () => openPanel("discount"));
document.getElementById("discountCloseBtn").addEventListener("click", closeAllPanels);

overlay.addEventListener("click", closeAllPanels);
document.addEventListener("keydown", (e) => { if(e.key === "Escape") closeAllPanels(); });

document.getElementById("checkoutBtn").addEventListener("click", () => {
  if(cart.length === 0) return;
  showToast("Heading to checkout — " + fmtPrice(cartTotals().subtotal) + " total.");
});

/* ---------- Shop mega-menu ---------- */
const shopBtn = document.getElementById("shopBtn");
const megaMenu = document.getElementById("megaMenu");

const megaProductList = document.getElementById("megaProductList");
PRODUCTS.slice()
  .sort((a, b) => a.name.localeCompare(b.name))
  .forEach(p => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "product.html?p=" + slugify(p.name);
    a.textContent = p.name;
    li.appendChild(a);
    megaProductList.appendChild(li);
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

renderCart();
