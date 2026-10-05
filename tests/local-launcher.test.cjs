"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { startLocal } = require("../scripts/start-local.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "살롱 실행 테스트 "));
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "dist/index.html"), "<!doctype html><title>Salon's home</title>");
  const instances = [];
  t.after(async () => {
    for (const instance of instances) await instance.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    async launch(extra = {}) {
      const instance = await startLocal({ root, dbPath: "data/salon.sqlite", port: 0, prepare: async () => {}, ...extra });
      instances.push(instance);
      return instance;
    },
  };
}
const request = (url, options = {}) => fetch(url, { ...options, headers: { Connection: "close", ...options.headers } });
const portOf = (instance) => Number(new URL(instance.url).port);

test("local launcher serves the homepage and API, preserving owner data across restarts in a Korean path", async (t) => {
  const f = fixture(t);
  const first = await f.launch();
  assert.equal(first.reused, false);
  assert.deepEqual(await (await request(first.url + "/api/health")).json(), { status: "ok" });
  assert.match(await (await request(first.url)).text(), /Salon's home/);
  assert.equal((await (await request(first.url + "/api/bootstrap")).json()).needsSetup, true);
  const owner = { storeName: "저장 확인 미용실", name: "원장", email: "owner@example.com", password: "test-owner-password-2026" };
  const setup = await request(first.url + "/api/bootstrap", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: first.url }, body: JSON.stringify(owner),
  });
  assert.equal(setup.status, 201);
  await setup.json();
  const port = portOf(first);
  await first.stop();
  const second = await f.launch({ port });
  assert.equal((await (await request(second.url + "/api/bootstrap")).json()).needsSetup, false);
  const login = await request(second.url + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: second.url },
    body: JSON.stringify({ email: owner.email, password: owner.password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  await login.json();
  const state = await (await request(second.url + "/api/state", { headers: { Cookie: cookie } })).json();
  assert.equal(state.data.store.name, owner.storeName);
});

test("opening a second launcher reuses the running server without preparing or stopping it", async (t) => {
  const f = fixture(t);
  const first = await f.launch();
  const second = await f.launch({ port: portOf(first), prepare: async () => assert.fail("must not install or build twice") });
  assert.equal(second.reused, true);
  assert.equal(second.url, first.url);
  await second.stop();
  assert.equal((await request(first.url + "/api/health")).status, 200);
  await assert.rejects(f.launch({ port: portOf(first), dbPath: "another.sqlite" }), /다른 프로그램이나 다른 ERP 폴더/);
  assert.equal(fs.existsSync(path.join(f.root, "another.sqlite")), false);
});

test("a conflicting program is left running and dependency installation never starts", async (t) => {
  const f = fixture(t);
  const other = http.createServer((req, res) => res.end("another program"));
  other.listen(0, "127.0.0.1");
  await once(other, "listening");
  t.after(() => new Promise((resolve) => other.close(resolve)));
  const port = other.address().port;
  await assert.rejects(f.launch({ port, prepare: async () => assert.fail("must not modify dependencies") }), /다른 프로그램이나 다른 ERP 폴더/);
  assert.equal(await (await request(`http://127.0.0.1:${port}`)).text(), "another program");
  assert.equal(fs.existsSync(path.join(f.root, "data")), false);
});

test("failed preparation releases its port and leaves existing saved data untouched", async (t) => {
  const f = fixture(t);
  const first = await f.launch();
  const port = portOf(first);
  await first.stop();
  const dbPath = path.join(f.root, "data/salon.sqlite");
  const original = fs.readFileSync(dbPath);
  await assert.rejects(f.launch({ port, prepare: async () => { throw new Error("Build failed"); } }), /Build failed/);
  assert.deepEqual(fs.readFileSync(dbPath), original);
  const retry = await f.launch({ port });
  assert.equal((await request(retry.url + "/api/health")).status, 200);
});

test("a second launch during preparation waits for readiness and cancellation releases the listener", async (t) => {
  const f = fixture(t);
  const temporary = await f.launch();
  const port = portOf(temporary);
  await temporary.stop();
  const preparing = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const firstPending = f.launch({ port, prepare: async () => { preparing.resolve(); await finish.promise; } });
  await preparing.promise;
  const url = `http://127.0.0.1:${port}`;
  assert.equal((await request(url)).status, 503);
  let secondReady = false;
  const secondPending = f.launch({ port }).then((result) => { secondReady = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(secondReady, false);
  finish.resolve();
  const [first, second] = await Promise.all([firstPending, secondPending]);
  assert.equal(second.reused, true);
  await first.stop();

  const controller = new AbortController();
  await assert.rejects(f.launch({ port, signal: controller.signal, prepare: async () => controller.abort() }), { name: "AbortError" });
  const retry = await f.launch({ port });
  assert.equal((await request(retry.url + "/api/health")).status, 200);
});
