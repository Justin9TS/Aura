/* Database layer. Uses Node's built-in SQLite (node:sqlite, Node 22+),
   so there is nothing extra to install and the whole "temporary
   database" is a single file: data/aura.sqlite. Delete that file to
   reset everything; it re-seeds from js/data.js on next start.
   Swapping to Postgres later only means rewriting this file. */

"use strict";

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const { PRODUCTS, slugify } = require("../js/data.js");

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "aura.sqlite"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    rating      REAL NOT NULL DEFAULT 0,
    reviews     INTEGER NOT NULL DEFAULT 0,
    size        TEXT,
    blurb       TEXT,
    benefits    TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
    items_json     TEXT NOT NULL
  );
`);

// Seed once from js/data.js when the products table is empty.
const productCount = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
if(productCount === 0){
  const insert = db.prepare(`
    INSERT INTO products (slug, name, category, price_cents, rating, reviews, size, blurb, benefits)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for(const p of PRODUCTS){
    insert.run(
      slugify(p.name),
      p.name,
      p.category || "",
      Math.round(p.price * 100),
      p.rating || 0,
      p.reviews || 0,
      p.size || null,
      p.blurb || null,
      p.benefits ? JSON.stringify(p.benefits) : null
    );
  }
  console.log(`Seeded ${PRODUCTS.length} products into data/aura.sqlite`);
}

// Row -> API shape (price back in dollars for the frontend).
function toApiProduct(row){
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    price: row.price_cents / 100,
    rating: row.rating,
    reviews: row.reviews,
    size: row.size || undefined,
    blurb: row.blurb || undefined,
    benefits: row.benefits ? JSON.parse(row.benefits) : undefined
  };
}

const listStmt = db.prepare("SELECT * FROM products ORDER BY name");
const getStmt = db.prepare("SELECT * FROM products WHERE slug = ?");
const orderStmt = db.prepare("INSERT INTO orders (subtotal_cents, items_json) VALUES (?, ?)");

function listProducts(){
  return listStmt.all().map(toApiProduct);
}

function getProductRow(slug){
  return getStmt.get(slug) || null;
}

function createOrder(subtotalCents, items){
  const result = orderStmt.run(subtotalCents, JSON.stringify(items));
  return Number(result.lastInsertRowid);
}

module.exports = { listProducts, getProductRow, createOrder, toApiProduct };
