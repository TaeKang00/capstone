"use strict";
const { DatabaseSync, backup } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

function openDatabase(filename) {
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(path.resolve(filename)), {
      recursive: true,
      mode: 0o700,
    });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','manager','designer','reception')), staff_id TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, summary TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (actor_id TEXT NOT NULL, request_id TEXT NOT NULL, signature TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(actor_id,request_id));
    PRAGMA user_version=2;`);
  const sessionColumns = new Set(
    db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((column) => column.name),
  );
  if (!sessionColumns.has("mode"))
    db.exec(
      "ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'work'",
    );
  if (!sessionColumns.has("idle_expires_at"))
    db.exec(
      "ALTER TABLE sessions ADD COLUMN idle_expires_at INTEGER NOT NULL DEFAULT 0",
    );
  if (filename !== ":memory:") {
    try {
      fs.chmodSync(filename, 0o600);
    } catch {}
  }
  return db;
}
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function readState(db) {
  const row = db.prepare("SELECT version,data FROM app_state WHERE id=1").get();
  return row ? { version: row.version, data: JSON.parse(row.data) } : null;
}
function writeState(db, data, version) {
  db.prepare(
    "INSERT INTO app_state(id,version,data) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data",
  ).run(version, JSON.stringify(data));
}
function audit(db, actor, action, summary) {
  db.prepare(
    "INSERT INTO audit(at,actor_id,actor_name,action,summary) VALUES(?,?,?,?,?)",
  ).run(
    new Date().toISOString(),
    actor?.id || null,
    actor?.name || "시스템",
    action,
    summary,
  );
}
module.exports = {
  openDatabase,
  transaction,
  readState,
  writeState,
  audit,
  backup,
};
