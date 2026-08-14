/* Multi-currency support.

   Product prices are stored in the database in USD cents — that's the
   base. Everything shown to a shopper, and everything charged by
   Stripe, is converted from that base with the rates below.

   TO UPDATE RATES: edit RATES and bump RATES_UPDATED. They don't need
   to be perfect — round numbers are normal in retail — but check them
   every few months so you're not selling at a loss when a rate moves. */

"use strict";

const RATES_UPDATED = "2026-08";

// 1 USD = X of this currency.
const CURRENCIES = {
  USD: { symbol: "$",   rate: 1,     decimals: 2, position: "before", label: "US Dollar" },
  SEK: { symbol: "kr",  rate: 10.5,  decimals: 2, position: "after",  label: "Swedish Krona" },
  NOK: { symbol: "kr",  rate: 10.8,  decimals: 2, position: "after",  label: "Norwegian Krone" },
  DKK: { symbol: "kr",  rate: 6.9,   decimals: 2, position: "after",  label: "Danish Krone" },
  EUR: { symbol: "€",   rate: 0.92,  decimals: 2, position: "before", label: "Euro" },
  GBP: { symbol: "£",   rate: 0.79,  decimals: 2, position: "before", label: "British Pound" },
  CAD: { symbol: "CA$", rate: 1.36,  decimals: 2, position: "before", label: "Canadian Dollar" },
  AUD: { symbol: "A$",  rate: 1.52,  decimals: 2, position: "before", label: "Australian Dollar" },
  NZD: { symbol: "NZ$", rate: 1.64,  decimals: 2, position: "before", label: "New Zealand Dollar" },
  PLN: { symbol: "zł",  rate: 3.95,  decimals: 2, position: "after",  label: "Polish Złoty" },
  CHF: { symbol: "CHF", rate: 0.88,  decimals: 2, position: "before", label: "Swiss Franc" },
  // Zero-decimal currency: Stripe expects whole yen, not "cents".
  JPY: { symbol: "¥",   rate: 152,   decimals: 0, position: "before", label: "Japanese Yen" }
};

const DEFAULT_CURRENCY = "USD";

// Country -> currency. Countries not listed fall back to USD, and the
// shopper can always override with the picker in the footer.
const COUNTRY_CURRENCY = {
  SE: "SEK", NO: "NOK", DK: "DKK", IS: "DKK",
  FI: "EUR", DE: "EUR", FR: "EUR", NL: "EUR", BE: "EUR", AT: "EUR",
  ES: "EUR", IT: "EUR", PT: "EUR", IE: "EUR", GR: "EUR", EE: "EUR",
  LV: "EUR", LT: "EUR", SK: "EUR", SI: "EUR", LU: "EUR", MT: "EUR", CY: "EUR",
  GB: "GBP", CH: "CHF", PL: "PLN",
  US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY"
};

// Countries offered in the footer picker, grouped for a tidy list.
const COUNTRIES = [
  { code: "SE", name: "Sweden" },        { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },       { code: "FI", name: "Finland" },
  { code: "IS", name: "Iceland" },       { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },        { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },       { code: "AT", name: "Austria" },
  { code: "ES", name: "Spain" },         { code: "IT", name: "Italy" },
  { code: "PT", name: "Portugal" },      { code: "IE", name: "Ireland" },
  { code: "PL", name: "Poland" },        { code: "CH", name: "Switzerland" },
  { code: "GB", name: "United Kingdom" },{ code: "US", name: "United States" },
  { code: "CA", name: "Canada" },        { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },   { code: "JP", name: "Japan" }
];

function isValidCurrency(code){
  return Object.prototype.hasOwnProperty.call(CURRENCIES, String(code || "").toUpperCase());
}

function currencyForCountry(countryCode){
  return COUNTRY_CURRENCY[String(countryCode || "").toUpperCase()] || DEFAULT_CURRENCY;
}

/* Converts USD cents to the smallest unit of the target currency —
   what Stripe wants as `unit_amount`. Rounded to a tidy retail value:
   two-decimal currencies land on whole units (kr 189, not kr 188.47),
   zero-decimal ones on tens. */
function convertAmount(usdCents, currencyCode){
  const cur = CURRENCIES[currencyCode] || CURRENCIES[DEFAULT_CURRENCY];
  const converted = (usdCents / 100) * cur.rate;
  if(cur.decimals === 0) return Math.round(converted / 10) * 10;
  if(currencyCode === DEFAULT_CURRENCY) return Math.round(converted * 100);
  return Math.round(converted) * 100; // whole units, expressed in cents
}

function formatAmount(minorUnits, currencyCode){
  const cur = CURRENCIES[currencyCode] || CURRENCIES[DEFAULT_CURRENCY];
  const value = cur.decimals === 0 ? minorUnits : minorUnits / 100;
  const text = value.toFixed(cur.decimals);
  return cur.position === "before" ? cur.symbol + text : text + " " + cur.symbol;
}

module.exports = {
  CURRENCIES, COUNTRIES, COUNTRY_CURRENCY, DEFAULT_CURRENCY, RATES_UPDATED,
  isValidCurrency, currencyForCountry, convertAmount, formatAmount
};
