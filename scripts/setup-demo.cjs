"use strict";
const path = require("node:path");
const { openDatabase } = require("../server/db.cjs");
const { configureDemoAccount } = require("../server/demo.cjs");
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "시연 계정 설정은 로컬에서 사용하세요. 운영 계정은 원장 복구 도구로 설정해 주세요.",
    );
  const db = openDatabase(
    path.resolve(process.env.DB_PATH || "data/salon.sqlite"),
  );
  try {
    await configureDemoAccount(db, { resetExisting: true });
    console.log("시연 계정을 설정했습니다. 아이디: admin / 비밀번호: admin");
    console.log(
      "고객·예약·수납·재고·급여 데이터는 유지됩니다. 서버를 다시 실행해 주세요.",
    );
  } finally {
    db.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
