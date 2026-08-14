/* Frontend currency state.

   Product prices from the API are in USD. This module converts them for
   display using the rate table the server sends, and remembers the
   shopper's pick. It resolves before anything renders, so no page ever
   flashes the wrong currency. */

"use strict";

const FALLBACK_CURRENCY = {
  code: "USD",
  rates: { USD: { symbol: "$", rate: 1, decimals: 2, position: "before", label: "US Dollar" } },
  countries: [],
  countryCurrency: {}
};

let CURRENCY = FALLBACK_CURRENCY.code;
let RATES = FALLBACK_CURRENCY.rates;
let COUNTRY_LIST = [];
let COUNTRY_CURRENCY = {};
let DETECTED_COUNTRY = null;
let CURRENCY_CHOSEN = false;

const currencyReady = (async () => {
  try {
    const res = await fetch("/api/currency");
    if(!res.ok) throw new Error("no currency api");
    const data = await res.json();
    CURRENCY = data.currency;
    RATES = data.rates;
    COUNTRY_LIST = data.countries || [];
    COUNTRY_CURRENCY = data.countryCurrency || {};
    DETECTED_COUNTRY = data.country;
    CURRENCY_CHOSEN = data.chosen;
  } catch(e){
    // Offline / no backend: everything stays in USD.
  }
  return CURRENCY;
})();

function activeCurrency(){ return CURRENCY; }
function currencyInfo(code){ return RATES[code || CURRENCY] || FALLBACK_CURRENCY.rates.USD; }

// Same rounding the server uses, so displayed prices match what Stripe
// charges: whole units for non-USD, tens for zero-decimal currencies.
function convertFromUsd(usdAmount){
  const cur = currencyInfo();
  const converted = usdAmount * cur.rate;
  if(cur.decimals === 0) return Math.round(converted / 10) * 10;
  if(CURRENCY === "USD") return Math.round(converted * 100) / 100;
  return Math.round(converted);
}

// Formats a USD amount in the active currency.
function formatUsd(usdAmount){
  const cur = currencyInfo();
  const value = convertFromUsd(usdAmount);
  const text = value.toFixed(cur.decimals);
  return cur.position === "before" ? cur.symbol + text : text + " " + cur.symbol;
}

// Formats an amount already in a currency's minor units (from the API).
function formatMinor(minorUnits, code){
  const cur = currencyInfo(code);
  const value = cur.decimals === 0 ? minorUnits : minorUnits / 100;
  const text = value.toFixed(cur.decimals);
  return cur.position === "before" ? cur.symbol + text : text + " " + cur.symbol;
}

async function setCurrency(code){
  const res = await fetch("/api/currency", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currency: code })
  });
  if(!res.ok) throw new Error("Could not change currency.");
  CURRENCY = code;
  CURRENCY_CHOSEN = true;
  return code;
}
