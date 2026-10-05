"use strict";
const {
  randomBytes,
  createHash,
  timingSafeEqual,
  scrypt,
} = require("node:crypto");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
const COOKIE_NAME = "salon_session";
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  staffId: u.staff_id,
  active: !!u.active,
  mustChangePassword: !!u.must_change_password,
});
function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
function validPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw problem(
      422,
      "INVALID_PASSWORD",
      "비밀번호는 12~128자로 입력해 주세요.",
    );
}
async function hashPassword(password) {
  validPassword(password);
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt}$${key.toString("hex")}`;
}
async function verifyPassword(password, hash) {
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    typeof hash !== "string"
  )
    return false;
  const [scheme, salt, expected] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = await derive(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const compare = Buffer.from(expected, "hex");
  return compare.length === actual.length && timingSafeEqual(actual, compare);
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
function cookieToken(req) {
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return null;
  const token = raw.slice(COOKIE_NAME.length + 1);
  return /^[\w-]{43}$/.test(token) ? token : null;
}
function setSessionCookie(res, token, production, hours) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    path: "/",
    maxAge: hours * 60 * 60 * 1000,
  });
}
function createSession(
  db,
  userId,
  hours,
  { now = Date.now(), idleMs = 300000 } = {},
) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare(
    "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at,mode,idle_expires_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    digest(token),
    userId,
    csrfToken,
    now + hours * 60 * 60 * 1000,
    new Date(now).toISOString(),
    "work",
    now + idleMs,
  );
  return { token, csrfToken, mode: "work", idleExpiresAt: now + idleMs };
}
function getSession(db, req, now = Date.now()) {
  const token = cookieToken(req);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.*,s.csrf_token,s.token_hash,s.expires_at,s.mode,s.idle_expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`,
    )
    .get(digest(token), now);
  return row || null;
}
function constantEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
module.exports = {
  COOKIE_NAME,
  publicUser,
  problem,
  validPassword,
  hashPassword,
  verifyPassword,
  digest,
  cookieToken,
  setSessionCookie,
  createSession,
  getSession,
  constantEqual,
};
