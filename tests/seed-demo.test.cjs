"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createApp } = require("../server/app.cjs");
const { openDatabase, readState } = require("../server/db.cjs");

test("seed:demo fills a fresh store through the real action rules and refuses to run twice", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "seed-demo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "salon.sqlite");
  const { app, close } = createApp({ production: false, dbPath, distPath: dir, origin: "http://127.0.0.1", bootstrapToken: "" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1" },
    body: JSON.stringify({ storeName: "예시 매장", name: "예시 원장", loginId: "admin", password: "admin", confirm: "admin" }),
  });
  assert.equal(response.status, 201, await response.text());
  await new Promise((resolve) => server.close(resolve));
  close();

  process.env.DB_PATH = dbPath;
  t.after(() => delete process.env.DB_PATH);
  const { main } = require("../scripts/seed-demo.cjs");
  const log = t.mock.method(console, "log", () => {});
  main();
  assert.ok(log.mock.calls.some((call) => String(call.arguments[0]).includes("예시 데이터를 넣었어요")));
  assert.ok(!log.mock.calls.some((call) => String(call.arguments[0]).includes("건너뛴 항목")), "every sample record follows the rules");

  const db = openDatabase(dbPath);
  const { data } = readState(db);
  db.close();
  assert.equal(data.staff.length, 6);
  assert.equal(data.customers.length, 15);
  assert.ok(data.transactions.length > 100);
  assert.equal(data.refunds.length, 1);
  assert.equal(data.purchaseOrders.length, 3);
  assert.ok(data.items.some((item) => item.qty <= item.min), "one item is left below its reorder point");
  assert.ok(data.items.every((item) => item.qty >= 0));
  assert.deepEqual(data.payroll.map((row) => row.status), ["paid", "paid", "paid"]);
  assert.throws(() => main(), /이미 예시 데이터/);
});
