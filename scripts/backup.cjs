"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-"))
    throw new Error(
      "사용법: npm run backup -- backups/새로운파일.sqlite (원본 경로는 DB_PATH 환경 변수)",
    );
  const source = path.resolve(process.env.DB_PATH || "data/salon.sqlite");
  const target = path.resolve(args[0]);
  if (!fs.existsSync(source))
    throw new Error(
      "원본 데이터베이스를 찾을 수 없습니다. DB_PATH를 확인해 주세요.",
    );
  if (source === target)
    throw new Error("원본 데이터베이스를 백업 파일로 지정할 수 없습니다.");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  // Reserve destination exclusively: never overwrite an existing backup.
  const fd = fs.openSync(target, "wx", 0o600);
  fs.closeSync(fd);
  let db;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error("원본 데이터베이스 무결성 검사에 실패했습니다.");
    await backup(db, target);
    const copied = new DatabaseSync(target, { readOnly: true });
    try {
      if (
        copied.prepare("PRAGMA integrity_check").get().integrity_check !== "ok"
      )
        throw new Error("백업 데이터베이스 무결성 검사에 실패했습니다.");
    } finally {
      copied.close();
    }
    console.log(`백업 완료: ${target}`);
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw error;
  } finally {
    db?.close();
  }
}
main().catch((error) => {
  console.error(
    error.code === "EEXIST"
      ? "같은 이름의 파일이 이미 있습니다. 새 백업 파일명을 입력해 주세요."
      : error.message,
  );
  process.exitCode = 1;
});
