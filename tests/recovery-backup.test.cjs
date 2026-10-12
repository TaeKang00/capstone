"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const { createApp } = require("../server/app.cjs");
const { openDatabase, readState, writeState } = require("../server/db.cjs");
const { configureDemoAccount } = require("../server/demo.cjs");
const recovery = require("../server/recovery.cjs");
const { digest, hashPassword, verifyPassword } = require("../server/auth.cjs");
const { createAutomaticBackup } = require("../server/automatic-backup.cjs");
async function fixture(t) {
  const env = createApp({
    dbPath: ":memory:",
    production: false,
    origin: "",
    bootstrapToken: "",
  });
  await configureDemoAccount(env.db);
  const server = env.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await env.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    ...env,
    async request(route, body, headers = {}) {
      const response = await fetch(url + "/api" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: url,
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        headers: response.headers,
        data: response.status === 204 ? null : await response.json(),
      };
    },
  };
}
test("owner reauthentication is required for recovery code; anonymous code redemption returns ID, changes password and revokes sessions exactly once", async (t) => {
  const f = await fixture(t),
    login = await f.request("/auth/login", {
      loginId: "admin",
      password: "admin",
    });
  const headers = {
    Cookie: login.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": login.data.csrfToken,
  };
  assert.equal((await f.request("/admin/recovery", {}, headers)).status, 403);
  assert.equal(
    (await f.request("/admin/backup-status", undefined, headers)).status,
    403,
  );
  const unlock = await f.request(
    "/auth/private/unlock",
    { scope: "owner", loginId: "admin", password: "admin" },
    headers,
  );
  const privateHeaders = {
    ...headers,
    "X-Private-Token": unlock.data.accessToken,
  };
  const issued = await f.request("/admin/recovery", {}, privateHeaders);
  assert.equal(issued.status, 200);
  assert.match(issued.data.code, /^[\w-]{43}$/);
  const row = f.db.prepare("SELECT * FROM recovery_codes").get();
  assert.equal(row.token_hash, digest(issued.data.code));
  assert.ok(!Object.values(row).includes(issued.data.code));
  assert.equal(
    (
      await f.request("/auth/recover", {
        code: "a".repeat(43),
        newPassword: "New-owner-password-2026",
      })
    ).status,
    400,
  );
  const before = readState(f.db);
  const recovered = await f.request("/auth/recover", {
    code: issued.data.code,
    newPassword: "New-owner-password-2026",
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.loginId, "admin");
  assert.deepEqual(readState(f.db), before);
  assert.equal((await f.request("/auth/me", undefined, headers)).status, 401);
  assert.equal(
    (
      await f.request("/auth/recover", {
        code: issued.data.code,
        newPassword: "Other-password-2026",
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request("/auth/login", { loginId: "admin", password: "admin" }))
      .status,
    401,
  );
  assert.equal(
    (
      await f.request("/auth/login", {
        loginId: "admin",
        password: "New-owner-password-2026",
      })
    ).status,
    200,
  );
});
test("code rotation, concurrent reuse, password changes and disabled owners invalidate recovery credentials", async () => {
  const db = openDatabase(":memory:");
  try {
    await configureDemoAccount(db);
    const user = db.prepare("SELECT * FROM users").get();
    const old = recovery.issue(db, user.id),
      fresh = recovery.issue(db, user.id);
    await assert.rejects(
      recovery.recover(db, {
        code: old.code,
        newPassword: "New-password-2026",
      }),
      /유효하지/,
    );
    const results = await Promise.allSettled([
      recovery.recover(db, {
        code: fresh.code,
        newPassword: "New-password-2026",
      }),
      recovery.recover(db, {
        code: fresh.code,
        newPassword: "Other-password-2026",
      }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const code = recovery.issue(db, user.id);
    db.prepare("UPDATE users SET active=0 WHERE id=?").run(user.id);
    await assert.rejects(
      recovery.recover(db, {
        code: code.code,
        newPassword: "Next-password-2026",
      }),
      /유효하지/,
    );
    db.prepare("UPDATE users SET active=1,password_hash=? WHERE id=?").run(
      await hashPassword("Changed-password-2026"),
      user.id,
    );
    assert.equal(recovery.available(db, user.id), false);
    await assert.rejects(
      recovery.recover(db, {
        code: code.code,
        newPassword: "Next-password-2026",
      }),
      /유효하지/,
    );
    assert.equal(
      await verifyPassword(
        "Changed-password-2026",
        db.prepare("SELECT password_hash FROM users").get().password_hash,
      ),
      true,
    );
  } finally {
    db.close();
  }
});
test("automatic backup uses SQLite snapshots, retention and persisted status; never removes unrelated files", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "salon-backup-review-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(path.join(dir, "source.sqlite"));
  await configureDemoAccount(db);
  const folder = path.join(dir, "backups");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "manual-backup.sqlite"), "keep");
  let now = Date.parse("2026-10-12T03:00:00Z");
  const worker = createAutomaticBackup(db, {
    enabled: true,
    directory: folder,
    schedule: false,
    keep: 2,
    now: () => now,
  });
  try {
    for (let i = 0; i < 3; i++) {
      const result = await worker.run();
      assert.equal(result.lastError, null);
      now += 86400000;
    }
    const files = fs
      .readdirSync(folder)
      .filter((f) => f.startsWith("salon-auto-"));
    assert.equal(files.length, 2);
    assert.equal(
      fs.readFileSync(path.join(folder, "manual-backup.sqlite"), "utf8"),
      "keep",
    );
    const copy = new DatabaseSync(path.join(folder, files[1]), {
      readOnly: true,
    });
    try {
      assert.equal(
        copy.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
      assert.equal(copy.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
    } finally {
      copy.close();
    }
    const next = createAutomaticBackup(db, {
      enabled: true,
      directory: folder,
      schedule: false,
      keep: 2,
      now: () => now - 1000,
    });
    assert.equal(next.status().lastSuccess, worker.status().lastSuccess);
    await next.stop();
  } finally {
    await worker.stop();
    db.close();
  }
});
test("backup failure is visible and retry clears the failure without touching the live database", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "salon-backup-failure-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(":memory:");
  await configureDemoAccount(db);
  const target = path.join(dir, "blocked");
  fs.writeFileSync(target, "not a directory");
  const worker = createAutomaticBackup(db, {
    enabled: true,
    directory: target,
    schedule: false,
  });
  try {
    const failed = await worker.run({ force: true });
    assert.match(failed.lastError, /백업 실패/);
    assert.equal(failed.lastSuccess, null);
    fs.unlinkSync(target);
    const result = await worker.run({ force: true });
    assert.equal(result.lastError, null);
    assert.ok(result.lastSuccess);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
  } finally {
    await worker.stop();
    db.close();
  }
});

test("restoring a current backup preserves business data and discards sessions and recovery codes", async (t) => {
  const { backup } = require("node:sqlite"),
    { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "salon-restore-review-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source.sqlite"),
    snapshot = path.join(dir, "backup.sqlite"),
    target = path.join(dir, "restored.sqlite");
  const db = openDatabase(source);
  await configureDemoAccount(db);
  const user = db.prepare("SELECT * FROM users").get();
  recovery.issue(db, user.id);
  const before = readState(db);
  before.data.customers.push({
    id: "restore-customer",
    name: "복구 확인 고객",
    phone: "",
    memo: "보존할 기록",
    warning: "",
    archived: false,
  });
  writeState(db, before.data, before.version + 1);
  const expected = readState(db).data;
  await backup(db, snapshot);
  db.close();
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "../scripts/restore.cjs"),
      snapshot,
      "--confirm-stopped",
    ],
    { env: { ...process.env, DB_PATH: target }, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const restored = openDatabase(target);
  try {
    assert.deepEqual(readState(restored).data, expected);
    assert.equal(
      restored.prepare("SELECT COUNT(*) n FROM recovery_codes").get().n,
      0,
    );
    assert.equal(
      restored.prepare("SELECT COUNT(*) n FROM sessions").get().n,
      0,
    );
  } finally {
    restored.close();
  }
});
