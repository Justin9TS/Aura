/* Works out which country a visitor is in, so the store can show prices
   in their currency.

   Order of preference:
     1. A country header from the host's CDN/proxy (instant, free,
        no third party). Cloudflare, Vercel and Fly all set one.
     2. A lookup against ipapi.co, cached in memory so each IP is only
        asked once per hour.
     3. Give up and let the caller fall back to the default currency.

   Nothing here ever blocks a page: the lookup has a short timeout and
   any failure just means the default currency, which the shopper can
   change with the footer picker. */

"use strict";

const https = require("https");

let proxyAgent;
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if(proxyUrl){
  try {
    const { HttpsProxyAgent } = require("https-proxy-agent");
    proxyAgent = new HttpsProxyAgent(proxyUrl);
  } catch(e){ /* direct connection */ }
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 1500;
const cache = new Map(); // ip -> { country, at }

const COUNTRY_RE = /^[A-Z]{2}$/;

function headerCountry(req){
  const candidates = [
    req.headers["cf-ipcountry"],          // Cloudflare
    req.headers["x-vercel-ip-country"],   // Vercel
    req.headers["x-country-code"],        // some proxies
    req.headers["fly-region"] && null     // region ≠ country, ignore
  ];
  for(const raw of candidates){
    const code = String(raw || "").toUpperCase();
    if(COUNTRY_RE.test(code) && code !== "XX") return code;
  }
  return null;
}

function clientIp(req){
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "";
}

// Localhost and LAN addresses can't be geolocated — skip the lookup.
function isPrivateIp(ip){
  return !ip ||
    ip === "::1" || ip.startsWith("127.") ||
    ip.startsWith("10.") || ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith("::ffff:127.") || ip.startsWith("fe80:");
}

function lookupIp(ip){
  return new Promise(resolve => {
    const req = https.get({
      hostname: "ipapi.co",
      path: "/" + encodeURIComponent(ip) + "/country/",
      agent: proxyAgent,
      headers: { "User-Agent": "aura-store" }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        const code = data.trim().toUpperCase();
        resolve(COUNTRY_RE.test(code) ? code : null);
      });
    });
    req.setTimeout(LOOKUP_TIMEOUT_MS, () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

async function countryForRequest(req){
  const fromHeader = headerCountry(req);
  if(fromHeader) return fromHeader;

  const ip = clientIp(req);
  if(isPrivateIp(ip)) return null;

  const hit = cache.get(ip);
  if(hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.country;

  const country = await lookupIp(ip);
  cache.set(ip, { country, at: Date.now() });
  if(cache.size > 5000) cache.clear(); // crude bound; fine at this scale
  return country;
}

module.exports = { countryForRequest };
