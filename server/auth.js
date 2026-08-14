/* Password hashing + session token helpers, using only Node's built-in
   crypto module.

   Passwords are hashed with scrypt (memory-hard, brute-force resistant)
   and a per-user random salt; comparisons are constant-time. Session
   tokens are 256-bit random values — the browser cookie holds the raw
   token, the database only stores its SHA-256 hash, so a leaked
   database can't be used to hijack live sessions. */

"use strict";

const crypto = require("crypto");

const SCRYPT_KEYLEN = 64;

function hashPassword(password){
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return salt + ":" + hash;
}

function verifyPassword(password, stored){
  const parts = String(stored || "").split(":");
  if(parts.length !== 2) return false;
  const [salt, hex] = parts;
  const expected = Buffer.from(hex, "hex");
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

// Used to make login take the same time whether or not the email exists,
// so response timing can't be used to probe which emails are registered.
const DUMMY_HASH = hashPassword("definitely-not-a-real-password");

function newSessionToken(){
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token){
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, newSessionToken, hashToken };
