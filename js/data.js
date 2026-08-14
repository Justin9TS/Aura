/* =========================================================
   HOW TO ADD YOUR OWN PRODUCTS
   ---------------------------------------------------------
   Add an object to the PRODUCTS array below. That's it —
   the shop page sorts everything alphabetically by name and
   every product automatically gets its own detail page at
   product.html?p=<slug>. No other code needs to change.

   Shape of each object:
     {
       name:     string   -> product name, required
       category: string   -> short label, shown on the detail page
       price:    number   -> in dollars, e.g. 24.00
       rating:   number   -> average star rating, 0-5 (0 until reviews exist)
       reviews:  number   -> total number of reviews (0 for now)
       size:     string   -> optional, e.g. "0.1 oz | 2.5g", shown next to the title
       blurb:    string   -> optional, short description for the detail page
       benefits: string[] -> optional, up to 3 bullet points for the detail page
     }

   Example — adding a new product:
     { name: "Cloud Pillow", category: "Home", price: 32.00, rating: 0, reviews: 0 }

   Rating and reviews are left at 0 until a verified-purchase review
   system is built — the stars and count are already wired up to
   these fields, so they'll update automatically once that exists.
   ========================================================= */

const PRODUCTS = [
  { name: "Halo Desk Lamp",         category: "Home",       price: 48.00, rating: 0, reviews: 0 },
  { name: "Mist Diffuser",          category: "Home",       price: 36.00, rating: 0, reviews: 0 },
  { name: "Cloud Throw Blanket",    category: "Home",       price: 54.00, rating: 0, reviews: 0 },
  { name: "Aura Tote Bag",          category: "Bags",       price: 28.00, rating: 0, reviews: 0 },
  { name: "Wave Ceramic Mug",       category: "Kitchen",    price: 18.00, rating: 0, reviews: 0 },
  { name: "Linen Table Runner",     category: "Kitchen",    price: 22.00, rating: 0, reviews: 0 },
  { name: "Drift Candle",           category: "Wellness",   price: 24.00, rating: 0, reviews: 0 },
  { name: "Calm Weighted Eye Mask", category: "Wellness",   price: 19.00, rating: 0, reviews: 0 },
  { name: "Soft Focus Notebook",    category: "Stationery", price: 14.00, rating: 0, reviews: 0 },
  { name: "Pale Blue Pen Set",      category: "Stationery", price: 12.00, rating: 0, reviews: 0 },
];

// Turns a product name into a URL-safe slug: "Wave Ceramic Mug" -> "wave-ceramic-mug"
function slugify(name){
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function findProductBySlug(slug){
  return PRODUCTS.find(p => slugify(p.name) === slug) || null;
}

// Lets the Node backend reuse this same file to seed the database.
if(typeof module !== "undefined" && module.exports){
  module.exports = { PRODUCTS, slugify };
}
