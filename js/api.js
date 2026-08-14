/* Loads the product catalog from the backend API, falling back to the
   static PRODUCTS list in js/data.js when no backend is running (e.g.
   when the site is opened straight from the filesystem). Every page
   script awaits `productsReady` instead of reading PRODUCTS directly. */

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

// POST helper used by checkout. Throws on network/validation errors.
async function apiCheckout(items){
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error || "Checkout failed (" + res.status + ")");
  return data;
}
