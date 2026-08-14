# Aura

A small web store: static frontend (plain HTML/CSS/JS) plus a Node.js
backend with a SQLite database, accounts, and Stripe payments.

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

Without a Stripe key the store runs in **demo mode**: checkout validates
and records orders but takes no payment.

## Enabling real payments (Stripe)

1. Create a free account at https://stripe.com
2. In the Stripe dashboard (Test mode), copy your **Secret key**
   (starts with `sk_test_`) from Developers → API keys
3. Copy `.env.example` to `.env` and paste the key into
   `STRIPE_SECRET_KEY=`
4. Restart the server (`npm start`)

Checkout now redirects to Stripe's hosted payment page. In test mode,
pay with card number `4242 4242 4242 4242`, any future expiry date, any
CVC. No real money moves until you swap in a live key.

For production, also create a webhook endpoint in Stripe pointing at
`https://yourdomain.com/api/stripe/webhook` (event:
`checkout.session.completed`) and put its signing secret in
`STRIPE_WEBHOOK_SECRET`.

## Accounts

Sign up / sign in lives in the account drawer (person icon in the
navbar). Passwords are hashed with scrypt; sessions are 30-day httpOnly
cookies (only a hash of the token is stored server-side). Signed-in
customers get their order history in the drawer and a pre-filled email
at Stripe checkout.

With email configured (see below), new accounts must enter a 6-digit
code sent to their address before they can sign in, and there's a
"Forgot password?" flow that resets via emailed code (and logs out all
existing sessions). Codes expire after 15 minutes and allow 5 attempts.
Without email configured, accounts activate instantly and reset is
disabled.

## Email (verification + password reset)

Fill in `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` /
`MAIL_FROM` in `.env` — any SMTP provider works (Resend, Mailgun,
Gmail app password, …). For local testing without a provider, set
`EMAIL_DEBUG=1` and codes are printed in the server console instead.

## Discord order log

Set `DISCORD_WEBHOOK_URL` in `.env` (Discord channel → Settings →
Integrations → Webhooks) and every order — demo or paid — is posted to
that channel as an embed with items, total, customer email, and the
shipping address collected by Stripe.

## Currency

Prices are stored once, in USD, and converted for display and for
Stripe. A visitor's country is detected from their IP (via a CDN header
when the host provides one, otherwise a cached ipapi.co lookup) and
mapped to a currency; the picker in the footer lets anyone override it,
remembered in a cookie for a year. Rates and the country→currency map
live in `server/currency.js` — **update the rates there every few
months**. Orders record the currency and exact amount charged, so old
orders always display what was really paid.

## Launch page

`launch.html` is a standalone black coming-soon screen with a split-flap
countdown. Set the date at the top of `js/launch.js`:

```js
const LAUNCH_DATE = "2026-09-01T18:00:00+02:00";
```

When it hits zero it swaps to "We're live" with a button into the store.
To use it as the front page at launch time, rename `index.html` to
`shop.html` and `launch.html` to `index.html` (and point `STORE_URL` at
`shop.html`), then swap back when you go live.

## Admin

`admin.html` is a private dashboard: revenue, order count, customers,
setup status, and every order with items, shipping address and status.

Access is a single account: set `ADMIN_EMAIL` in `.env`, register that
email on the store like a normal customer, and sign in. Everyone else —
signed in or not — gets a "Not found" page, and the admin API returns
404 rather than admitting it exists.

## Shipping

Stripe's payment page collects the shipping address during checkout
(the allowed-countries list lives in `server/server.js`). Once payment
is confirmed, the address is stored on the order in the database and
included in the Discord log. It's also visible per-payment in the
Stripe dashboard.

## Adding products

Add an object to the `PRODUCTS` array in `js/data.js` — the shop grid,
mega menu, and product detail pages all pick it up automatically. If the
database has already been created, delete `data/aura.sqlite` so it
re-seeds with your new product.

## Layout

| Path                  | What it is                                                   |
|-----------------------|--------------------------------------------------------------|
| `index.html`          | Shop page (hero banner + product grid)                       |
| `product.html`        | Product detail page (`?p=<slug>`)                            |
| `checkout-success.html`| Post-payment landing page (verifies the Stripe session)     |
| `styles.css`          | All styling                                                  |
| `js/data.js`          | Product catalog (also seeds the database)                    |
| `js/api.js`           | Fetch helpers: catalog, auth, checkout                       |
| `js/shared.js`        | Navbar/drawers/footer injection, cart, account panel         |
| `js/home.js`          | Shop grid                                                    |
| `js/product.js`       | Product detail page                                          |
| `js/success.js`       | Payment confirmation page logic                              |
| `server/server.js`    | Express server: static files + JSON API                      |
| `server/db.js`        | SQLite layer (`node:sqlite`), schema + seeding + migration   |
| `server/auth.js`      | scrypt password hashing + session tokens                     |
| `server/pricing.js`   | Pack options/discounts — checkout's source of truth          |

## API

- `GET /api/products` — full catalog
- `GET /api/products/:slug` — one product
- `POST /api/auth/register` / `login` / `logout`, `GET /api/auth/me`
- `GET /api/orders` — signed-in user's order history
- `POST /api/checkout` — `{ items: [{ slug, option, qty }] }`; validates
  everything, prices the cart from the database (client prices are
  ignored). Returns a Stripe payment URL, or records a demo order when
  Stripe isn't configured
- `GET /api/checkout/confirm?session_id=` — verifies payment after Stripe
  redirects back
- `POST /api/stripe/webhook` — server-to-server payment confirmation

## Security

- Strict security headers via helmet, including a Content-Security-Policy
  that blocks all external scripts
- Rate limiting on the API (tighter on checkout and auth)
- JSON bodies capped at 10kb
- All inputs validated against whitelists; all SQL uses prepared
  statements
- Prices always recomputed server-side; payment status verified with
  Stripe server-to-server, never trusted from the browser
- scrypt password hashes with per-user salts, constant-time comparisons,
  login timing equalized so account existence can't be probed
- Session cookies are httpOnly + SameSite=Lax (secure in production);
  the database stores only SHA-256 hashes of session tokens
- Card numbers never touch this server — Stripe's hosted page handles them
