"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function verify(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("백업 무결성 검사에 실패했습니다.");
    const state = db
      .prepare("SELECT data,version FROM app_state WHERE id=1")
      .get();
    if (
      !state ||
      JSON.parse(state.data).schemaVersion !== 2 ||
      !db.prepare("SELECT 1 FROM users WHERE role='owner' LIMIT 1").get()
    )
      throw new Error("지원하는 ERP 백업이 아니거나 원장 계정이 없습니다.");
  } finally {
    db.close();
  }
}
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[1] !== "--confirm-stopped")
    throw new Error(
      "ERP 서버를 먼저 종료하세요. 사용법: node scripts/restore.cjs 백업.sqlite --confirm-stopped",
    );
  const source = path.resolve(args[0]);
  const target = path.resolve(process.env.DB_PATH || "data/salon.sqlite");
  if (!fs.existsSync(source) || source === target)
    throw new Error("별도의 백업 파일을 지정해 주세요.");
  verify(source);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Build a checked, logged-out replacement before touching current database files.
  const staging = fs.mkdtempSync(path.join(directory, ".restore-"));
  const replacement = path.join(staging, "salon.sqlite");
  let archive;
  try {
    fs.copyFileSync(source, replacement);
    fs.chmodSync(replacement, 0o600);
    const restored = new DatabaseSync(replacement);
    try {
      if (
        restored
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='recovery_codes'",
          )
          .get()
      )
        restored.exec("DELETE FROM recovery_codes");
      restored.exec(
        "DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;",
      );
    } finally {
      restored.close();
    }
    verify(replacement);
    archive = fs.mkdtempSync(path.join(directory, "before-restore-"));
    const moved = [];
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        const current = target + suffix;
        if (fs.existsSync(current)) {
          const saved = path.join(archive, path.basename(current));
          fs.renameSync(current, saved);
          moved.push({ current, saved });
        }
      }
      fs.renameSync(replacement, target);
    } catch (error) {
      if (!fs.existsSync(target))
        for (const entry of moved) fs.renameSync(entry.saved, entry.current);
      throw error;
    }
    console.log(
      `복구 완료: ${target}\n교체 전 파일 보관: ${archive}\n모든 기기의 기존 로그인이 해제되었습니다. 서버를 시작하고 다시 로그인해 주세요.`,
    );
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
