# Aura

A small web store: static frontend (plain HTML/CSS/JS) plus a Node.js
backend with a SQLite database.

## Run it

Requires [Node.js](https://nodejs.org) 22 or newer (the database uses
Node's built-in SQLite).

```bash
npm install
npm start
```

Then open http://localhost:3000.

The database is a single file, `data/aura.sqlite`, created and seeded
automatically from `js/data.js` on first start. Delete the file to reset
everything.

The frontend also still works without the backend (open `index.html`
directly) — it falls back to the static product list, and checkout tells
you the backend isn't running.

## Adding products

Add an object to the `PRODUCTS` array in `js/data.js` — the shop grid,
mega menu, and product detail pages all pick it up automatically. If the
database has already been created, delete `data/aura.sqlite` so it
re-seeds with your new product.

## Layout

| Path              | What it is                                                   |
|-------------------|--------------------------------------------------------------|
| `index.html`      | Shop page (hero banner + product grid)                       |
| `product.html`    | Product detail page (`?p=<slug>`)                            |
| `styles.css`      | All styling                                                  |
| `js/data.js`      | Product catalog (also seeds the database)                    |
| `js/api.js`       | Loads the catalog from the API, falls back to `js/data.js`   |
| `js/shared.js`    | Navbar/drawers/footer injection, cart (localStorage), panels |
| `js/home.js`      | Shop grid                                                    |
| `js/product.js`   | Product detail page                                          |
| `server/server.js`| Express server: static files + JSON API                      |
| `server/db.js`    | SQLite layer (`node:sqlite`), schema + seeding               |
| `server/pricing.js`| Pack options/discounts — checkout's source of truth         |

## API

- `GET /api/products` — full catalog
- `GET /api/products/:slug` — one product
- `POST /api/checkout` — `{ items: [{ slug, option, qty }] }`; validates
  everything, prices the cart from the database (client prices are
  ignored), records the order, returns `{ orderId, subtotal }`

## Security

- Strict security headers via helmet, including a Content-Security-Policy
  that blocks all external scripts
- Rate limiting on the API (tighter on checkout)
- JSON bodies capped at 10kb
- All inputs validated against whitelists; all SQL uses prepared
  statements
- Prices always recomputed server-side

Payments, accounts, and an admin panel are not built yet.
