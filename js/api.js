/* Loads the product catalog from the backend API, falling back to the
   static PRODUCTS list in js/data.js when no backend is running (e.g.
   when the site is opened straight from the filesystem). Every page
   script awaits `productsReady` instead of reading PRODUCTS directly.
   Also holds the small fetch helpers for auth + checkout. */

"use strict";

const productsReady = (async () => {
  try {
    const res = await fetch("/api/products");
    if(!res.ok) throw new Error("API responded " + res.status);
    const data = await res.json();
    if(!Array.isArray(data)) throw new Error("Unexpected API payload");
    return data;
  } catch(e){
    // Static fallback: derive slugs so the rest of the site can rely on them.
    return PRODUCTS.map(p => Object.assign({ slug: slugify(p.name) }, p));
  }
})();

// Shared fetch helper: JSON in/out, throws Error(message) on failure.
async function apiRequest(method, url, body){
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

function apiCheckout(items){ return apiRequest("POST", "/api/checkout", { items }); }
function apiConfirm(sessionId){ return apiRequest("GET", "/api/checkout/confirm?session_id=" + encodeURIComponent(sessionId)); }

function apiRegister(email, password){ return apiRequest("POST", "/api/auth/register", { email, password }); }
function apiLogin(email, password){ return apiRequest("POST", "/api/auth/login", { email, password }); }
function apiLogout(){ return apiRequest("POST", "/api/auth/logout"); }
function apiMe(){ return apiRequest("GET", "/api/auth/me"); }
function apiOrders(){ return apiRequest("GET", "/api/orders"); }
