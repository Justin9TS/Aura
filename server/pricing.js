/* Pack options and their discounts — the single source of truth for
   pricing at checkout. js/product.js mirrors this table for display,
   but whatever the browser sends, prices are always recomputed here. */

"use strict";

const PACK_OPTIONS = {
  single: { label: "Single",    packOf: 1, discount: 0    },
  two:    { label: "Two Pack",  packOf: 2, discount: 0.10 },
  trio:   { label: "Trio Pack", packOf: 3, discount: 0.15 }
};

// Price of one cart line in cents, from the product's base price.
function linePriceCents(basePriceCents, optionKey){
  const opt = PACK_OPTIONS[optionKey];
  if(!opt) return null;
  return Math.round(basePriceCents * opt.packOf * (1 - opt.discount));
}

module.exports = { PACK_OPTIONS, linePriceCents };
