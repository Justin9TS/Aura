/* Outbound notifications: Discord order logs + verification/reset emails.

   Discord: set DISCORD_WEBHOOK_URL in .env and every order gets posted
   to that channel as an embed. Failures are logged, never fatal — a
   Discord outage must not break checkout.

   Email: set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM
   in .env to send real mail through any provider. With EMAIL_DEBUG=1
   instead, codes are printed to the server console — handy in
   development before an email provider exists. */

"use strict";

const https = require("https");

// Same optional proxy support as the Stripe client.
let proxyAgent;
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if(proxyUrl){
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    proxyAgent = new HttpsProxyAgent(proxyUrl);
  } catch(e){ /* direct connection */ }
}

function postJson(urlString, payload){
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      agent: proxyAgent,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        if(res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error("HTTP " + res.statusCode + ": " + data.slice(0, 200)));
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

/* ---------- Discord ---------- */

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

function fmtCents(cents){ return "$" + (cents / 100).toFixed(2); }

function formatShipping(shipping){
  if(!shipping || !shipping.address) return null;
  const a = shipping.address;
  return [shipping.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.state, a.country]
    .filter(Boolean).join("\n");
}

// order: { id, status, subtotal_cents, items: [{name, qty, unit_price_cents}],
//          customerEmail?, shipping? }
async function notifyOrderDiscord(order){
  if(!DISCORD_WEBHOOK_URL) return;

  const itemLines = order.items.map(i =>
    i.qty + "× " + i.name + " — " + fmtCents(i.unit_price_cents * i.qty)).join("\n");

  const fields = [
    { name: "Items", value: itemLines.slice(0, 1024) || "—" },
    { name: "Total", value: fmtCents(order.subtotal_cents), inline: true },
    { name: "Status", value: order.status.toUpperCase(), inline: true }
  ];
  if(order.customerEmail) fields.push({ name: "Customer", value: order.customerEmail, inline: true });
  const ship = formatShipping(order.shipping);
  if(ship) fields.push({ name: "Ship to", value: ship.slice(0, 1024) });

  const payload = {
    username: "Aura Orders",
    embeds: [{
      title: "🛒 Order #" + order.id,
      color: order.status === "paid" ? 0x4B82E8 : 0x99AAC4,
      fields,
      timestamp: new Date().toISOString()
    }]
  };

  try {
    await postJson(DISCORD_WEBHOOK_URL, payload);
  } catch(e){
    console.error("Discord notify failed:", e.message);
  }
}

/* ---------- Email (verification / password reset codes) ---------- */

const EMAIL_DEBUG = process.env.EMAIL_DEBUG === "1";
const SMTP_CONFIGURED = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

// Whether the account system should require email codes at all.
function emailEnabled(){
  return SMTP_CONFIGURED || EMAIL_DEBUG;
}

let transporter = null;
if(SMTP_CONFIGURED){
  const nodemailer = require("nodemailer");
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendCodeEmail(to, code, purpose){
  const subject = purpose === "reset"
    ? "Your Aura password reset code"
    : "Your Aura verification code";
  const text = subject.replace("Your", "Here is your") + ": " + code +
    "\n\nIt expires in 15 minutes. If you didn't request this, you can ignore this email.";

  if(transporter){
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to, subject, text
    });
  } else if(EMAIL_DEBUG){
    console.log(`[EMAIL_DEBUG] ${purpose} code for ${to}: ${code}`);
  } else {
    throw new Error("Email is not configured.");
  }
}

// Emails the 10-minute discount verification link.
async function sendDiscountLink(to, link){
  const subject = "Verify your email — 15% off at Aura";
  const text = "Click to verify your email and unlock 15% off:\n\n" + link +
    "\n\nThe link expires in 10 minutes. If you didn't request this, ignore this email.";

  if(transporter){
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to, subject, text
    });
  } else if(EMAIL_DEBUG){
    console.log(`[EMAIL_DEBUG] discount link for ${to}: ${link}`);
  } else {
    throw new Error("Email is not configured.");
  }
}

module.exports = { notifyOrderDiscord, emailEnabled, sendCodeEmail, sendDiscountLink };
