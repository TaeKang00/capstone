"use strict";
const { randomBytes } = require("node:crypto");
const { digest, hashPassword, problem } = require("./auth.cjs");
const transaction = (...a) => require("./db.cjs").transaction(...a);
const readState = (...a) => require("./db.cjs").readState(...a);
const audit = (...a) => require("./db.cjs").audit(...a);
function initialize(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_codes (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    password_tag TEXT NOT NULL, created_at TEXT NOT NULL
  ); PRAGMA user_version=4;`);
}
function issue(db, userId) {
  return transaction(db, () => {
    const user = db
      .prepare("SELECT * FROM users WHERE id=? AND role='owner' AND active=1")
      .get(userId);
    if (!user) throw problem(403, "FORBIDDEN", "원장 인증이 필요합니다.");
    const code = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM recovery_codes WHERE user_id=?").run(userId);
    db.prepare("INSERT INTO recovery_codes VALUES(?,?,?,?)").run(
      digest(code),
      userId,
      digest(user.password_hash),
      new Date().toISOString(),
    );
    audit(
      db,
      user,
      "auth.recovery.issue",
      "기존 복구 코드를 폐기하고 일회용 원장 복구 코드 발급",
    );
    return { code, loginId: user.email };
  });
}
function available(db, userId) {
  const row = db
    .prepare(
      "SELECT r.password_tag,u.password_hash FROM recovery_codes r JOIN users u ON r.user_id=u.id WHERE r.user_id=?",
    )
    .get(userId);
  return !!row && row.password_tag === digest(row.password_hash);
}
async function recover(db, payload) {
  const invalid = () =>
    problem(
      400,
      "INVALID_RECOVERY",
      "복구 코드가 유효하지 않습니다. 사용 여부 또는 새 코드 발급 여부를 확인해 주세요.",
    );
  if (
    !payload ||
    typeof payload.code !== "string" ||
    !/^[\w-]{43}$/.test(payload.code.trim())
  )
    throw invalid();
  const token = digest(payload.code.trim());
  const read = () =>
    db
      .prepare(
        "SELECT r.password_tag,u.* FROM recovery_codes r JOIN users u ON r.user_id=u.id WHERE r.token_hash=? AND u.role='owner' AND u.active=1",
      )
      .get(token);
  const valid = (u) =>
    u &&
    u.password_tag === digest(u.password_hash) &&
    readState(db)?.data.staff.some(
      (s) => s.id === u.staff_id && s.status === "active" && s.role === "owner",
    );
  const initial = read();
  if (!valid(initial)) throw invalid();
  const hash = await hashPassword(payload.newPassword);
  return transaction(db, () => {
    const user = read();
    if (!valid(user) || user.password_hash !== initial.password_hash)
      throw invalid();
    db.prepare(
      "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?",
    ).run(hash, user.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    db.prepare("DELETE FROM recovery_codes WHERE user_id=?").run(user.id);
    audit(
      db,
      user,
      "auth.recovery.complete",
      "일회용 코드로 원장 비밀번호 재설정 및 모든 기존 세션 종료",
    );
    return {
      loginId: user.email,
      message:
        "비밀번호를 재설정했습니다. 새 비밀번호로 로그인하고 새 복구 코드를 발급받으세요.",
    };
  });
}
module.exports = { initialize, issue, available, recover };
