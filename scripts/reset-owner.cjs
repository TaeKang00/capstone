"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { Writable } = require("node:stream");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require("../server/auth.cjs");
const {
  transaction,
  readState,
  writeState,
  audit,
} = require("../server/db.cjs");

async function main() {
  if (process.argv.length > 2)
    throw new Error(
      "인자를 사용하지 마세요. 이메일과 비밀번호는 실행 후 표준 입력으로 입력합니다.",
    );
  const filename = path.resolve(process.env.DB_PATH || "data/salon.sqlite");
  if (!fs.existsSync(filename))
    throw new Error(
      "데이터베이스를 찾을 수 없습니다. DB_PATH를 확인해 주세요.",
    );
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const reader = readline.createInterface({
    input: process.stdin,
    output,
    terminal,
  });
  const lines = reader[Symbol.asyncIterator]();
  async function ask(label, secret = false) {
    process.stdout.write(label);
    muted = secret;
    const { value, done } = await lines.next();
    muted = false;
    if (secret || !terminal) process.stdout.write("\n");
    if (done) throw new Error("입력이 종료되어 복구를 취소했습니다.");
    return value;
  }
  let db;
  try {
    db = new DatabaseSync(filename);
    db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    console.log(
      "서버 운영자가 기존 원장 계정을 복구하는 도구입니다. 해당 원장의 모든 기기 로그인이 종료됩니다.",
    );
    const email = (await ask("원장 이메일: ")).trim().toLowerCase();
    const user = db
      .prepare("SELECT * FROM users WHERE email=? AND role='owner'")
      .get(email);
    if (!user)
      throw new Error(
        "해당 이메일의 원장 계정이 없습니다. 일반 직원을 원장으로 승격하지 않습니다.",
      );
    const password = await ask(
      "새 비밀번호 (12~128자, 화면에 표시되지 않음): ",
      true,
    );
    const repeated = await ask("새 비밀번호 다시 입력: ", true);
    if (password !== repeated)
      throw new Error("비밀번호가 서로 다릅니다. 변경하지 않았습니다.");
    const hash = await hashPassword(password);
    if ((await ask("복구하려면 RESET을 입력하세요: ")).trim() !== "RESET")
      throw new Error("복구를 취소했습니다.");
    transaction(db, () => {
      const currentUser = db
        .prepare("SELECT * FROM users WHERE id=? AND role='owner'")
        .get(user.id);
      if (!currentUser)
        throw new Error("계정 권한이 변경되었습니다. 다시 확인해 주세요.");
      const current = readState(db);
      const staff = current?.data.staff.find(
        (item) => item.id === currentUser.staff_id,
      );
      if (!staff)
        throw new Error(
          "연결된 원장 직원 정보가 없습니다. 백업 복구 상태를 확인해 주세요.",
        );
      db.prepare(
        "UPDATE users SET password_hash=?,active=1,must_change_password=0 WHERE id=?",
      ).run(hash, user.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      staff.status = "active";
      staff.role = "owner";
      writeState(db, current.data, current.version + 1);
      audit(
        db,
        { id: user.id, name: "서버 운영자" },
        "auth.owner_recovery",
        `${user.name} 원장 계정 복구 및 세션 종료`,
      );
    });
    console.log("원장 계정을 복구했습니다. 새 비밀번호로 로그인해 주세요.");
  } finally {
    reader.close();
    output.end();
    db?.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
