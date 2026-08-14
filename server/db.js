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

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);

// Upgrade older databases in place: add columns the orders table gained
// when payments/accounts arrived. ALTER ADD COLUMN is a no-op-safe way
// to migrate without losing existing rows.
const orderCols = db.prepare("SELECT name FROM pragma_table_info('orders')").all().map(c => c.name);
if(!orderCols.includes("user_id"))            db.exec("ALTER TABLE orders ADD COLUMN user_id INTEGER");
if(!orderCols.includes("status"))             db.exec("ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'demo'");
if(!orderCols.includes("stripe_session_id"))  db.exec("ALTER TABLE orders ADD COLUMN stripe_session_id TEXT");

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

/* ---------- products ---------- */
const listStmt = db.prepare("SELECT * FROM products ORDER BY name");
const getStmt = db.prepare("SELECT * FROM products WHERE slug = ?");

function listProducts(){ return listStmt.all().map(toApiProduct); }
function getProductRow(slug){ return getStmt.get(slug) || null; }

/* ---------- orders ---------- */
const orderInsertStmt = db.prepare(`
  INSERT INTO orders (subtotal_cents, items_json, user_id, status, stripe_session_id)
  VALUES (?, ?, ?, ?, ?)
`);
const orderBySessionStmt = db.prepare("SELECT * FROM orders WHERE stripe_session_id = ?");
const orderMarkPaidStmt = db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status != 'paid'");
const ordersForUserStmt = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50");

function createOrder(subtotalCents, items, opts){
  opts = opts || {};
  const result = orderInsertStmt.run(
    subtotalCents,
    JSON.stringify(items),
    opts.userId || null,
    opts.status || "demo",
    opts.stripeSessionId || null
  );
  return Number(result.lastInsertRowid);
}

function getOrderByStripeSession(sessionId){ return orderBySessionStmt.get(sessionId) || null; }
function markOrderPaid(orderId){ orderMarkPaidStmt.run(orderId); }

function listOrdersForUser(userId){
  return ordersForUserStmt.all(userId).map(row => ({
    id: row.id,
    createdAt: row.created_at,
    subtotal: row.subtotal_cents / 100,
    status: row.status,
    items: JSON.parse(row.items_json).map(i => ({ name: i.name, qty: i.qty }))
  }));
}

/* ---------- users & sessions ---------- */
const userInsertStmt = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)");
const userByEmailStmt = db.prepare("SELECT * FROM users WHERE email = ?");
const sessionInsertStmt = db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)");
const sessionGetStmt = db.prepare(`
  SELECT s.token_hash, s.expires_at, u.id AS user_id, u.email
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?
`);
const sessionDeleteStmt = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const sessionPruneStmt = db.prepare("DELETE FROM sessions WHERE expires_at < ?");

function createUser(email, passwordHash){
  const result = userInsertStmt.run(email, passwordHash);
  return Number(result.lastInsertRowid);
}

function getUserByEmail(email){ return userByEmailStmt.get(email) || null; }

function createSession(tokenHash, userId, expiresAt){
  sessionInsertStmt.run(tokenHash, userId, expiresAt);
}

function getSession(tokenHash){
  const row = sessionGetStmt.get(tokenHash);
  if(!row) return null;
  if(row.expires_at < Date.now()){
    sessionDeleteStmt.run(tokenHash);
    return null;
  }
  return { userId: row.user_id, email: row.email };
}

function deleteSession(tokenHash){ sessionDeleteStmt.run(tokenHash); }
function pruneExpiredSessions(){ sessionPruneStmt.run(Date.now()); }

pruneExpiredSessions();

module.exports = {
  listProducts, getProductRow, toApiProduct,
  createOrder, getOrderByStripeSession, markOrderPaid, listOrdersForUser,
  createUser, getUserByEmail,
  createSession, getSession, deleteSession, pruneExpiredSessions
};
