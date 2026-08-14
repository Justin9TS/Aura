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

  CREATE TABLE IF NOT EXISTS email_codes (
    email      TEXT NOT NULL,
    purpose    TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
    code_hash  TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (email, purpose)
  );
`);

// Upgrade older databases in place: add columns the orders table gained
// when payments/accounts arrived. ALTER ADD COLUMN is a no-op-safe way
// to migrate without losing existing rows.
const orderCols = db.prepare("SELECT name FROM pragma_table_info('orders')").all().map(c => c.name);
if(!orderCols.includes("user_id"))            db.exec("ALTER TABLE orders ADD COLUMN user_id INTEGER");
if(!orderCols.includes("status"))             db.exec("ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'demo'");
if(!orderCols.includes("stripe_session_id"))  db.exec("ALTER TABLE orders ADD COLUMN stripe_session_id TEXT");
if(!orderCols.includes("customer_email"))     db.exec("ALTER TABLE orders ADD COLUMN customer_email TEXT");
if(!orderCols.includes("shipping_json"))      db.exec("ALTER TABLE orders ADD COLUMN shipping_json TEXT");

// Existing users predate email verification — keep them valid.
const userCols = db.prepare("SELECT name FROM pragma_table_info('users')").all().map(c => c.name);
if(!userCols.includes("verified"))            db.exec("ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 1");

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
const orderByIdStmt = db.prepare("SELECT * FROM orders WHERE id = ?");
const orderMarkPaidStmt = db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status != 'paid'");
const orderCustomerStmt = db.prepare("UPDATE orders SET customer_email = ?, shipping_json = ? WHERE id = ?");
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
function getOrderById(orderId){ return orderByIdStmt.get(orderId) || null; }

// Returns true only on the transition to paid, so callers can fire
// one-time side effects (Discord log) without duplicates when both the
// webhook and the success page confirm the same order.
function markOrderPaid(orderId){
  return orderMarkPaidStmt.run(orderId).changes > 0;
}

function setOrderCustomer(orderId, email, shipping){
  orderCustomerStmt.run(email || null, shipping ? JSON.stringify(shipping) : null, orderId);
}

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
const userInsertStmt = db.prepare("INSERT INTO users (email, password_hash, verified) VALUES (?, ?, ?)");
const userByEmailStmt = db.prepare("SELECT * FROM users WHERE email = ?");
const userVerifyStmt = db.prepare("UPDATE users SET verified = 1 WHERE email = ?");
const userPasswordStmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
const sessionsForUserStmt = db.prepare("DELETE FROM sessions WHERE user_id = ?");
const sessionInsertStmt = db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)");
const sessionGetStmt = db.prepare(`
  SELECT s.token_hash, s.expires_at, u.id AS user_id, u.email
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?
`);
const sessionDeleteStmt = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const sessionPruneStmt = db.prepare("DELETE FROM sessions WHERE expires_at < ?");

function createUser(email, passwordHash, verified){
  const result = userInsertStmt.run(email, passwordHash, verified ? 1 : 0);
  return Number(result.lastInsertRowid);
}

function getUserByEmail(email){ return userByEmailStmt.get(email) || null; }
function markUserVerified(email){ userVerifyStmt.run(email); }
function updateUserPassword(userId, passwordHash){ userPasswordStmt.run(passwordHash, userId); }
function deleteSessionsForUser(userId){ sessionsForUserStmt.run(userId); }

/* ---------- email verification / reset codes ---------- */
const codeUpsertStmt = db.prepare(`
  INSERT INTO email_codes (email, purpose, code_hash, expires_at, attempts)
  VALUES (?, ?, ?, ?, 0)
  ON CONFLICT(email, purpose) DO UPDATE SET code_hash = excluded.code_hash,
    expires_at = excluded.expires_at, attempts = 0
`);
const codeGetStmt = db.prepare("SELECT * FROM email_codes WHERE email = ? AND purpose = ?");
const codeAttemptStmt = db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?");
const codeDeleteStmt = db.prepare("DELETE FROM email_codes WHERE email = ? AND purpose = ?");

function saveEmailCode(email, purpose, codeHash, expiresAt){
  codeUpsertStmt.run(email, purpose, codeHash, expiresAt);
}
function getEmailCode(email, purpose){ return codeGetStmt.get(email, purpose) || null; }
function bumpCodeAttempts(email, purpose){ codeAttemptStmt.run(email, purpose); }
function deleteEmailCode(email, purpose){ codeDeleteStmt.run(email, purpose); }

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
  createOrder, getOrderByStripeSession, getOrderById, markOrderPaid, setOrderCustomer, listOrdersForUser,
  createUser, getUserByEmail, markUserVerified, updateUserPassword, deleteSessionsForUser,
  createSession, getSession, deleteSession, pruneExpiredSessions,
  saveEmailCode, getEmailCode, bumpCodeAttempts, deleteEmailCode
};
