"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync, backup } = require("node:sqlite");
function createAutomaticBackup(
  db,
  {
    enabled = false,
    directory,
    intervalMs = 24 * 60 * 60 * 1000,
    keep = 14,
    now = Date.now,
    schedule = true,
  } = {},
) {
  if (
    enabled &&
    (!directory ||
      !Number.isInteger(keep) ||
      keep < 1 ||
      !Number.isFinite(intervalMs) ||
      intervalMs < 1000)
  )
    throw new Error("자동 백업 설정을 확인해 주세요.");
  const state = {
    enabled,
    lastSuccess: null,
    lastError: null,
    lastAttempt: null,
  };
  const statusFile = directory && path.join(directory, "backup-status.json");
  if (enabled) {
    try {
      const saved = JSON.parse(fs.readFileSync(statusFile, "utf8"));
      for (const k of ["lastSuccess", "lastError", "lastAttempt"])
        if (typeof saved[k] === "string" || saved[k] === null)
          state[k] = saved[k];
    } catch {}
  }
  let pending = null,
    stopped = false,
    timer,
    initial;
  const persist = () => {
    const temp = statusFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, statusFile);
  };
  function run({ force = false } = {}) {
    if (stopped || !enabled) return Promise.resolve({ ...state });
    if (pending) return pending;
    if (
      !force &&
      state.lastSuccess &&
      now() - Date.parse(state.lastSuccess) < intervalMs
    )
      return Promise.resolve({ ...state });
    if (!db.prepare("SELECT 1 FROM app_state WHERE id=1").get())
      return Promise.resolve({ ...state });
    pending = (async () => {
      const at = new Date(now()).toISOString();
      state.lastAttempt = at;
      let incomplete;
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const name = `salon-auto-${at.replace(/[:.]/g, "-")}-${randomUUID()}.sqlite`;
        const target = path.join(directory, name);
        incomplete = target + ".partial";
        const fd = fs.openSync(incomplete, "wx", 0o600);
        fs.closeSync(fd);
        await backup(db, incomplete);
        const copy = new DatabaseSync(incomplete);
        try {
          if (
            copy.prepare("PRAGMA integrity_check").get().integrity_check !==
            "ok"
          )
            throw new Error("무결성 검사 실패");
          copy.exec(
            "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;",
          );
        } finally {
          copy.close();
        }
        fs.renameSync(incomplete, target);
        incomplete = null;
        state.lastSuccess = at;
        state.lastError = null;
        const files = fs
          .readdirSync(directory)
          .filter((n) =>
            /^salon-auto-\d{4}-\d{2}-\d{2}T[\w-]+\.sqlite$/.test(n),
          )
          .sort()
          .reverse();
        for (const file of files.slice(keep))
          fs.unlinkSync(path.join(directory, file));
        persist();
      } catch (error) {
        state.lastError = error.code
          ? `백업 실패 (${error.code}). 백업 폴더 권한과 디스크 여유 공간을 확인하세요.`
          : "백업 또는 보관 기록 저장에 실패했습니다. 디스크와 백업 파일을 확인하세요.";
        if (incomplete) {
          try {
            fs.unlinkSync(incomplete);
          } catch {}
        }
        try {
          persist();
        } catch {}
        console.error(state.lastError);
      }
      return { ...state };
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  if (enabled && schedule) {
    initial = setTimeout(() => run(), 10000);
    timer = setInterval(() => run(), Math.min(intervalMs, 60 * 60 * 1000));
    initial.unref();
    timer.unref();
  }
  return {
    run,
    status: () => ({
      ...state,
      retention: keep,
      directory: enabled ? directory : null,
    }),
    stop: () => {
      stopped = true;
      clearTimeout(initial);
      clearInterval(timer);
      return pending;
    },
  };
}
module.exports = { createAutomaticBackup };
