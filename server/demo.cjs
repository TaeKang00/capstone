"use strict";
const { randomUUID } = require("node:crypto");
const { hashPassword } = require("./auth.cjs");
const { transaction, readState, writeState, audit } = require("./db.cjs");
const { initialState } = require("./operations.cjs");

// Called explicitly by the local launcher/CLI, never by the hosted server.
async function configureDemoAccount(db, { resetExisting = false } = {}) {
  if (!resetExisting && db.prepare("SELECT 1 FROM users LIMIT 1").get())
    return { changed: false };
  const hash = await hashPassword("admin", { allowDemo: true });
  return transaction(db, () => {
    // Recheck after password hashing so a concurrent setup cannot be overwritten.
    const occupied = db.prepare("SELECT 1 FROM users LIMIT 1").get();
    if (occupied && !resetExisting) return { changed: false };
    const reserved = db
      .prepare("SELECT * FROM users WHERE email=?")
      .get("admin");
    if (reserved && reserved.role !== "owner")
      throw new Error(
        "admin 아이디가 다른 직원에게 연결되어 있습니다. 계정 정보를 먼저 확인해 주세요.",
      );
    let owner =
      reserved ||
      db
        .prepare(
          "SELECT * FROM users WHERE role='owner' ORDER BY created_at,id LIMIT 1",
        )
        .get();
    let current = readState(db);
    if (occupied && !owner)
      throw new Error(
        "기존 원장 계정을 찾을 수 없습니다. 계정 권한을 확인해 주세요.",
      );
    if (owner) {
      const staff = current?.data.staff.find(
        (row) => row.id === owner.staff_id,
      );
      if (!staff)
        throw new Error(
          "원장과 연결된 직원 정보가 없습니다. 데이터는 변경하지 않았습니다.",
        );
      db.prepare(
        "UPDATE users SET email=?,password_hash=?,active=1,must_change_password=0 WHERE id=?",
      ).run("admin", hash, owner.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(owner.id);
      staff.status = "active";
      staff.role = "owner";
      writeState(db, current.data, current.version + 1);
    } else {
      const id = randomUUID(),
        staffId = randomUUID();
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,role,staff_id,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        id,
        "원장",
        "admin",
        hash,
        "owner",
        staffId,
        new Date().toISOString(),
      );
      current = {
        data: initialState({
          storeName: "살롱 데스크",
          ownerName: "원장",
          ownerStaffId: staffId,
        }),
        version: 1,
      };
      current.data.payroll ||= [];
      writeState(db, current.data, 1);
      owner = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    }
    audit(
      db,
      { id: owner.id, name: "로컬 시연 설정" },
      "auth.demo_setup",
      "원장 로그인 아이디를 admin으로 설정하고 해당 계정의 기존 세션 종료",
    );
    return { changed: true, created: !occupied, userId: owner.id };
  });
}
module.exports = { configureDemoAccount };
