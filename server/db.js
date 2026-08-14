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

  CREATE TABLE IF NOT EXISTS subscribers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    phone         TEXT,
    verified      INTEGER NOT NULL DEFAULT 0,
    token_hash    TEXT,
    token_expires INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_slug TEXT NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body         TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (product_slug, user_id)
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
if(!orderCols.includes("currency"))           db.exec("ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'");
if(!orderCols.includes("charged_minor"))      db.exec("ALTER TABLE orders ADD COLUMN charged_minor INTEGER");

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
  INSERT INTO orders (subtotal_cents, items_json, user_id, status, stripe_session_id, currency, charged_minor)
  VALUES (?, ?, ?, ?, ?, ?, ?)
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
    opts.stripeSessionId || null,
    opts.currency || "USD",
    opts.chargedMinor || null
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
    currency: row.currency || "USD",
    chargedMinor: row.charged_minor,
    status: row.status,
    items: JSON.parse(row.items_json).map(i => ({ name: i.name, qty: i.qty }))
  }));
}

/* ---------- admin ---------- */
const adminOrdersStmt = db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT ?");
const adminStatsStmt = db.prepare(`
  SELECT
    COUNT(*) AS total_orders,
    COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_orders,
    COALESCE(SUM(CASE WHEN status = 'paid' THEN subtotal_cents ELSE 0 END), 0) AS paid_cents
  FROM orders
`);
const adminUsersStmt = db.prepare("SELECT COUNT(*) AS n FROM users");

function listAllOrders(limit){
  return adminOrdersStmt.all(limit || 100).map(row => ({
    id: row.id,
    createdAt: row.created_at,
    subtotal: row.subtotal_cents / 100,
    currency: row.currency || "USD",
    chargedMinor: row.charged_minor,
    status: row.status,
    customerEmail: row.customer_email,
    shipping: row.shipping_json ? JSON.parse(row.shipping_json) : null,
    items: JSON.parse(row.items_json)
  }));
}

function adminStats(){
  const s = adminStatsStmt.get();
  return {
    totalOrders: s.total_orders,
    paidOrders: s.paid_orders,
    revenueUsd: s.paid_cents / 100,
    users: adminUsersStmt.get().n
  };
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

/* ---------- discount subscribers ---------- */
const subUpsertStmt = db.prepare(`
  INSERT INTO subscribers (email, phone, token_hash, token_expires)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET phone = excluded.phone,
    token_hash = excluded.token_hash, token_expires = excluded.token_expires
`);
const subByEmailStmt = db.prepare("SELECT * FROM subscribers WHERE email = ?");
const subByTokenStmt = db.prepare("SELECT * FROM subscribers WHERE token_hash = ?");
const subVerifyStmt = db.prepare("UPDATE subscribers SET verified = 1, token_hash = NULL, token_expires = NULL WHERE id = ?");

function upsertSubscriber(email, phone, tokenHash, tokenExpires){
  subUpsertStmt.run(email, phone || null, tokenHash, tokenExpires);
}
function getSubscriber(email){ return subByEmailStmt.get(email) || null; }

// Returns the subscriber's email when the token is valid, else null.
function verifySubscriberToken(tokenHash){
  const row = subByTokenStmt.get(tokenHash);
  if(!row || !row.token_expires || row.token_expires < Date.now()) return null;
  subVerifyStmt.run(row.id);
  return row.email;
}

/* ---------- reviews ---------- */
const reviewListStmt = db.prepare(`
  SELECT r.rating, r.body, r.created_at, u.email
  FROM reviews r JOIN users u ON u.id = r.user_id
  WHERE r.product_slug = ? ORDER BY r.id DESC LIMIT 100
`);
const reviewMineStmt = db.prepare("SELECT rating, body FROM reviews WHERE product_slug = ? AND user_id = ?");
const reviewUpsertStmt = db.prepare(`
  INSERT INTO reviews (product_slug, user_id, rating, body) VALUES (?, ?, ?, ?)
  ON CONFLICT(product_slug, user_id) DO UPDATE SET rating = excluded.rating,
    body = excluded.body, created_at = datetime('now')
`);
const reviewRollupStmt = db.prepare(`
  UPDATE products SET
    rating  = COALESCE((SELECT AVG(rating) FROM reviews WHERE product_slug = ?), 0),
    reviews = (SELECT COUNT(*) FROM reviews WHERE product_slug = ?)
  WHERE slug = ?
`);
const purchasesStmt = db.prepare("SELECT items_json FROM orders WHERE user_id = ? AND status IN ('paid','demo')");

function maskEmail(email){
  const at = email.indexOf("@");
  return email.slice(0, Math.min(2, at)) + "***" + email.slice(at);
}

function listReviews(slug){
  return reviewListStmt.all(slug).map(r => ({
    rating: r.rating,
    body: r.body,
    createdAt: r.created_at,
    author: maskEmail(r.email)
  }));
}

function getOwnReview(slug, userId){ return reviewMineStmt.get(slug, userId) || null; }

// Verified purchase = the user has an order (paid, or demo in dev mode)
// containing this product.
function userHasPurchased(userId, slug){
  return purchasesStmt.all(userId).some(row => {
    try { return JSON.parse(row.items_json).some(i => i.slug === slug); }
    catch(e){ return false; }
  });
}

// Saves the review and rolls the average/count up onto the product, so
// the stars everywhere update from real reviews.
function saveReview(slug, userId, rating, body){
  reviewUpsertStmt.run(slug, userId, rating, body);
  reviewRollupStmt.run(slug, slug, slug);
  const p = getProductRow(slug);
  return { rating: p.rating, reviews: p.reviews };
}

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
  listAllOrders, adminStats,
  createUser, getUserByEmail, markUserVerified, updateUserPassword, deleteSessionsForUser,
  createSession, getSession, deleteSession, pruneExpiredSessions,
  saveEmailCode, getEmailCode, bumpCodeAttempts, deleteEmailCode,
  upsertSubscriber, getSubscriber, verifySubscriberToken,
  listReviews, getOwnReview, userHasPurchased, saveReview
};
