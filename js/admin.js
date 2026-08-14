/* Admin dashboard.

   Access is decided by the server: the session must belong to the
   account whose email matches ADMIN_EMAIL in .env. This page just asks
   /api/admin/check first; everything sensitive lives behind
   /api/admin/summary, which returns 404 to anyone else — so there is
   nothing to find by poking at this URL. */

"use strict";

const root = document.getElementById("adminRoot");

function el(tag, cls, html){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(html !== undefined) e.innerHTML = html;
  return e;
}

function lockedOut(message){
  root.innerHTML = "";
  const box = el("div", "admin-locked");
  box.appendChild(el("h1", "", "Not found"));
  const p = el("p");
  p.textContent = message;
  box.appendChild(p);
  const back = el("a", "admin-back", "Back to the shop");
  back.href = "index.html";
  box.appendChild(back);
  root.appendChild(box);
}

function statusChip(status){
  return "<span class='order-status " + status + "'>" + status + "</span>";
}

function shippingText(shipping){
  if(!shipping || !shipping.address) return "—";
  const a = shipping.address;
  return [shipping.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.country]
    .filter(Boolean).join(", ");
}

function render(data){
  const { stats, orders, productCount, config } = data;
  root.innerHTML = "";

  const head = el("div", "admin-head");
  head.appendChild(el("h1", "", "Admin"));
  const backLink = el("a", "admin-back", "View store →");
  backLink.href = "index.html";
  head.appendChild(backLink);
  root.appendChild(head);

  // Stat tiles
  const tiles = el("div", "admin-tiles");
  [
    ["Revenue (paid)", "$" + stats.revenueUsd.toFixed(2), "in USD base prices"],
    ["Paid orders", String(stats.paidOrders), stats.totalOrders + " total incl. pending"],
    ["Customers", String(stats.users), "registered accounts"],
    ["Products", String(productCount), "live in the shop"]
  ].forEach(([label, value, sub]) => {
    const tile = el("div", "admin-tile");
    tile.appendChild(el("div", "admin-tile-label", label));
    tile.appendChild(el("div", "admin-tile-value", value));
    tile.appendChild(el("div", "admin-tile-sub", sub));
    tiles.appendChild(tile);
  });
  root.appendChild(tiles);

  // Configuration status
  const cfg = el("div", "admin-config");
  cfg.appendChild(el("h2", "", "Setup"));
  const cfgList = el("div", "admin-config-list");
  [
    ["Payments", config.stripe, config.stripe ? (config.liveMode ? "Stripe LIVE — real money" : "Stripe test mode") : "Not configured"],
    ["Discord log", config.discord, config.discord ? "Orders posting to your channel" : "Not configured"],
    ["Email", config.email, config.email ? "Verification + reset active" : "Accounts activate instantly"],
    ["Exchange rates", true, "Last updated " + config.ratesUpdated]
  ].forEach(([label, ok, detail]) => {
    const row = el("div", "admin-config-row");
    row.appendChild(el("span", "admin-dot " + (ok ? "on" : "off")));
    row.appendChild(el("span", "admin-config-label", label));
    const d = el("span", "admin-config-detail");
    d.textContent = detail;
    row.appendChild(d);
    cfgList.appendChild(row);
  });
  cfg.appendChild(cfgList);
  if(config.stripe && config.liveMode){
    cfg.appendChild(el("div", "admin-warn", "Live mode is on — every checkout charges a real card."));
  }
  root.appendChild(cfg);

  // Orders
  const ordersBox = el("div", "admin-orders");
  ordersBox.appendChild(el("h2", "", "Orders"));
  if(orders.length === 0){
    ordersBox.appendChild(el("div", "empty-note", "No orders yet."));
    root.appendChild(ordersBox);
    return;
  }

  const table = el("div", "admin-table");
  const header = el("div", "admin-row admin-row-head",
    "<span>#</span><span>Date</span><span>Items</span><span>Ship to</span><span>Total</span><span>Status</span>");
  table.appendChild(header);

  orders.forEach(o => {
    const row = el("div", "admin-row");
    row.appendChild(el("span", "admin-cell-id", "#" + o.id));

    const date = el("span");
    date.textContent = o.createdAt;
    row.appendChild(date);

    const items = el("span", "admin-cell-items");
    items.textContent = o.items.map(i => i.qty + "× " + i.name).join(", ");
    row.appendChild(items);

    const ship = el("span", "admin-cell-ship");
    ship.textContent = shippingText(o.shipping);
    ship.title = o.customerEmail || "";
    row.appendChild(ship);

    const total = el("span", "admin-cell-total");
    total.textContent = o.chargedMinor
      ? formatMinor(o.chargedMinor, o.currency)
      : "$" + o.subtotal.toFixed(2);
    row.appendChild(total);

    row.appendChild(el("span", "", statusChip(o.status)));
    table.appendChild(row);
  });
  ordersBox.appendChild(table);
  root.appendChild(ordersBox);
}

(async function(){
  let check;
  try {
    check = await (await fetch("/api/admin/check")).json();
  } catch(e){
    lockedOut("The store's backend isn't running.");
    return;
  }
  if(!check.admin){
    lockedOut("This page doesn't exist, or you're not signed in as the store owner.");
    return;
  }
  try {
    const res = await fetch("/api/admin/summary");
    if(!res.ok) throw new Error("denied");
    await currencyReady;
    render(await res.json());
  } catch(e){
    lockedOut("Couldn't load the dashboard.");
  }
})();
