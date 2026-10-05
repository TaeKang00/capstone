"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../server/app.cjs");
const { hashPassword } = require("../server/auth.cjs");
const { readState, writeState } = require("../server/db.cjs");
const PASSWORD = "private-test-password-2026!";

async function fixture(t, options = {}) {
  let clock = Date.now();
  const failures = [];
  const service = createApp({
    dbPath: ":memory:",
    distPath: "/nonexistent",
    now: () => clock,
    onError: (e) => failures.push(e),
    ...options,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    service.close();
    assert.deepEqual(failures, []);
  });
  async function request(
    route,
    session,
    body,
    method = body === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken }
          : {}),
        ...(session?.accessToken
          ? { "X-Private-Token": session.accessToken }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data =
      response.status === 204
        ? null
        : response.headers.get("content-type")?.includes("json")
          ? await response.json()
          : await response.text();
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const setup = await request("/bootstrap", null, {
    name: "원장",
    storeName: "개인정보 테스트",
    email: "owner@example.test",
    password: PASSWORD,
  });
  assert.equal(setup.status, 201);
  const owner = { ...setup.data, cookie: setup.cookie };
  function seed(fn) {
    const envelope = readState(service.db);
    fn(envelope.data);
    writeState(service.db, envelope.data, envelope.version + 1);
  }
  async function account(role = "reception") {
    const id = randomUUID();
    const staffId = randomUUID();
    const email = `${id}@example.test`;
    const passwordHash = await hashPassword(PASSWORD);
    service.db
      .prepare(
        "INSERT INTO users(id,name,email,password_hash,role,staff_id,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        role,
        email,
        passwordHash,
        role,
        staffId,
        new Date().toISOString(),
      );
    seed((data) =>
      data.staff.push({
        ...data.staff[0],
        id: staffId,
        name: role,
        role,
        phone: "01099998888",
      }),
    );
    const login = await request("/auth/login", null, {
      email,
      password: PASSWORD,
    });
    assert.equal(login.status, 200);
    return { ...login.data, cookie: login.cookie };
  }
  async function unlock(session, scope = "owner", identity = owner) {
    const response = await request("/auth/private/unlock", session, {
      scope,
      email: identity.user.email,
      password: PASSWORD,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return { ...session, ...response.data, user: session.user };
  }
  async function action(session, type, payload, body = {}) {
    return request(`/actions/${type}`, session, {
      payload,
      version: readState(service.db).version,
      requestId: randomUUID(),
      ...body,
    });
  }
  return {
    ...service,
    request,
    owner,
    seed,
    account,
    unlock,
    action,
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
  };
}

test("owner login alone cannot read admin data, manage accounts, or retrieve wages through work mutation and replay", async (t) => {
  const f = await fixture(t);
  f.seed((data) => {
    data.payroll = [
      {
        id: "salary-secret",
        staffId: f.owner.user.staffId,
        status: "paid",
        netPay: 7777777,
      },
    ];
    data.payrolls = structuredClone(data.payroll);
    data.legacyArchive = { salary: "legacy-secret" };
    data.logs = [{ note: "salary-secret" }];
    data.staff[0].phone = "01012345678";
  });
  const state = await f.request("/state", f.owner);
  assert.equal(state.data.session.mode, "work");
  assert.deepEqual(state.data.data.payroll, []);
  assert.deepEqual(state.data.data.payrolls, []);
  assert.deepEqual(state.data.data.logs, []);
  assert.equal(state.data.data.staff[0].phone, undefined);
  assert.equal(state.data.data.legacyArchive, undefined);
  for (const route of [
    "/admin/state",
    "/personal/state",
    "/users",
    "/audit",
    "/reports",
    "/export",
    "/backup",
  ])
    assert.equal((await f.request(route, f.owner)).status, 403, route);
  for (const type of [
    "staff.save",
    "service.save",
    "store.save",
    "legacy.import",
    "payroll.save",
    "payroll.finalize",
    "payroll.reopen",
    "payroll.paid",
  ])
    assert.equal((await f.action(f.owner, type, {})).status, 403, type);
  assert.equal((await f.request("/users", f.owner, {})).status, 403);
  assert.equal(
    (
      await f.request(
        `/users/${f.owner.user.id}`,
        f.owner,
        { role: "reception" },
        "PATCH",
      )
    ).status,
    403,
  );
  const ownerAccess = await f.unlock(f.owner);
  const payload = { name: "작업 고객" };
  const requestId = randomUUID();
  const first = await f.action(ownerAccess, "customer.save", payload, {
    requestId,
  });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.data.payroll, []);
  await f.request("/auth/private/lock", ownerAccess, {});
  const replay = await f.action(f.owner, "customer.save", payload, {
    requestId,
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.data.data.payroll, []);
  assert.equal(replay.data.data.customers.length, 1);
  assert.equal((await f.request("/admin/state", ownerAccess)).status, 403);
  const adminAccess = await f.unlock(f.owner);
  const privateRequestId = randomUUID();
  const privatePayload = { ...readState(f.db).data.store, name: "원장 설정" };
  const saved = await f.action(adminAccess, "store.save", privatePayload, {
    requestId: privateRequestId,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.data.payroll[0].id, "salary-secret");
  await f.request("/auth/private/lock", adminAccess, {});
  const privateReplay = await f.action(
    adminAccess,
    "store.save",
    privatePayload,
    { requestId: privateRequestId },
  );
  assert.equal(
    privateReplay.status,
    403,
    "a previously successful admin request cannot bypass reauthentication",
  );
});

test("shared lock removes sensitive records, masks today's agenda and rejects every operational mutation", async (t) => {
  const f = await fixture(t);
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  f.seed((data) => {
    data.customers = [
      {
        id: "customer-secret",
        name: "고객실명",
        phone: "01012345678",
        memo: "민감 메모",
      },
    ];
    data.appointments = [
      {
        id: "agenda",
        date,
        start: 600,
        duration: 30,
        staffId: f.owner.user.staffId,
        serviceIds: [],
        status: "booked",
        customerId: "customer-secret",
        guestName: "고객실명",
        guestPhone: "01012345678",
        notes: "민감 메모",
        changes: [{ name: "고객실명" }],
      },
      { id: "past", date: "2000-01-01" },
    ];
    data.transactions = [{ id: "private-sale" }];
    data.payroll = [{ id: "private-salary" }];
    data.logs = [{ secret: true }];
  });
  const access = await f.unlock(f.owner);
  const locked = await f.request("/auth/lock", f.owner, {});
  assert.equal(locked.data.mode, "shared");
  assert.equal(locked.data.user.role, "shared");
  assert.equal(locked.data.user.staffId, null);
  const state = await f.request("/state", f.owner);
  assert.equal(state.data.session.mode, "shared");
  assert.deepEqual(
    state.data.data.appointments.map((a) => a.id),
    ["agenda"],
  );
  assert.equal(state.data.data.appointments[0].guestName, "예약 고객");
  for (const field of ["customers", "transactions", "payroll", "logs", "items"])
    assert.deepEqual(state.data.data[field], [], field);
  assert.doesNotMatch(
    JSON.stringify(state.data),
    /고객실명|01012345678|민감 메모|private-salary/,
  );
  assert.equal((await f.request("/admin/state", access)).status, 403);
  for (const type of [
    "customer.save",
    "appointment.save",
    "appointment.status",
    "payment.create",
    "inventory.receipt",
    "inventory.adjust",
  ])
    assert.equal((await f.action(f.owner, type, {})).status, 423, type);
  assert.equal((await f.request("/auth/activity", f.owner, {})).status, 423);
});

test("background reads do not extend the work timer; activity extends it and expiry demotes the cookie", async (t) => {
  const f = await fixture(t, { workIdleMs: 1000 });
  const access = await f.unlock(f.owner);
  f.advance(800);
  assert.equal((await f.request("/state", f.owner)).data.session.mode, "work");
  const activity = await f.request("/auth/activity", f.owner, {});
  assert.equal(activity.data.idleExpiresAt, f.now() + 1000);
  f.advance(800);
  assert.equal((await f.request("/auth/me", f.owner)).data.mode, "work");
  f.advance(201);
  const action = await f.action(f.owner, "customer.save", {
    name: "잠금 우회",
  });
  assert.equal(action.status, 423);
  assert.equal(action.data.error.code, "WORK_LOCKED");
  assert.equal(action.data.error.session.mode, "shared");
  assert.equal(
    (await f.request("/state", f.owner)).data.session.mode,
    "shared",
  );
  assert.equal((await f.request("/admin/state", access)).status, 403);
});

test("owner reauthentication is independent from the work operator and private actions audit the actual owner", async (t) => {
  const f = await fixture(t);
  const desk = await f.account();
  const failed = await f.request("/auth/private/unlock", desk, {
    scope: "owner",
    email: desk.user.email,
    password: PASSWORD,
  });
  assert.equal(failed.status, 403);
  const access = await f.unlock(desk);
  assert.equal((await f.request("/admin/state", access)).status, 200);
  assert.equal(
    (
      await f.request("/admin/state", {
        ...f.owner,
        accessToken: access.accessToken,
      })
    ).status,
    403,
    "grant must be cookie-bound",
  );
  const store = readState(f.db).data.store;
  assert.equal(
    (await f.action(access, "store.save", { ...store, name: "원장이 수정" }))
      .status,
    200,
  );
  assert.equal(
    f.db.prepare("SELECT actor_id FROM audit WHERE action='store.save'").get()
      .actor_id,
    f.owner.user.id,
  );
  assert.equal(
    (await f.action(access, "customer.save", { name: "접수 고객" })).status,
    200,
  );
  assert.equal(
    f.db
      .prepare("SELECT actor_id FROM audit WHERE action='customer.save'")
      .get().actor_id,
    desk.user.id,
  );
  await f.request("/auth/lock", desk, {});
  const fromShared = await f.unlock(desk);
  assert.equal((await f.request("/admin/state", fromShared)).status, 200);
  assert.equal(
    (
      await f.action(fromShared, "store.save", {
        ...store,
        name: "공용에서 원장 설정",
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.action(fromShared, "customer.save", { name: "공용 입력" })).status,
    423,
  );
});

test("personal reauthentication only exposes that work operator's finalized or paid slips", async (t) => {
  const f = await fixture(t);
  const desk = await f.account();
  f.seed((data) => {
    data.payroll = [
      { id: "own-final", staffId: desk.user.staffId, status: "finalized" },
      { id: "own-paid", staffId: desk.user.staffId, status: "paid" },
      { id: "own-draft", staffId: desk.user.staffId, status: "draft" },
      { id: "other-final", staffId: f.owner.user.staffId, status: "finalized" },
    ];
    data.transactions = [{ customerName: "비공개 고객" }];
  });
  const crossAccount = await f.request("/auth/private/unlock", desk, {
    scope: "personal",
    email: f.owner.user.email,
    password: PASSWORD,
  });
  assert.equal(crossAccount.status, 403);
  const access = await f.unlock(desk, "personal", desk);
  const state = await f.request("/personal/state", access);
  assert.equal(state.status, 200);
  assert.deepEqual(
    state.data.data.payroll.map((p) => p.id),
    ["own-final", "own-paid"],
  );
  assert.deepEqual(state.data.data.transactions, []);
  assert.deepEqual(
    state.data.data.staff.map((s) => s.id),
    [desk.user.staffId],
  );
  assert.equal((await f.request("/admin/state", access)).status, 403);
  assert.equal((await f.action(access, "payroll.save", {})).status, 403);
  await f.request("/auth/lock", desk, {});
  assert.equal((await f.request("/personal/state", access)).status, 403);
});

test("private idle and absolute deadlines cannot be prolonged by reads or by repeated private activity", async (t) => {
  const f = await fixture(t, { privateIdleMs: 1000, privateAbsoluteMs: 2500 });
  let access = await f.unlock(f.owner);
  f.advance(1001);
  const expired = await f.request("/admin/state", access);
  assert.equal(expired.status, 403);
  assert.equal(expired.data.error.code, "PRIVATE_SESSION_EXPIRED");
  access = await f.unlock(f.owner);
  f.advance(900);
  assert.equal(
    (await f.request("/auth/private/activity", access, {})).status,
    200,
  );
  f.advance(900);
  const extended = await f.request("/auth/private/activity", access, {});
  assert.equal(extended.data.idleExpiresAt, access.expiresAt);
  assert.equal((await f.request("/admin/state", access)).status, 200);
  f.advance(701);
  assert.equal(
    (await f.request("/auth/private/activity", access, {})).status,
    403,
  );
  assert.equal((await f.request("/auth/me", f.owner)).data.mode, "work");
});

test("password, account role and activation changes revoke grants carried by a different base operator", async (t) => {
  const f = await fixture(t);
  const desk = await f.account();
  const secondOwner = await f.account("owner");
  let access = await f.unlock(desk, "owner", secondOwner);
  const ownerAccess = await f.unlock(f.owner);
  const changed = await f.request(
    `/users/${secondOwner.user.id}`,
    ownerAccess,
    { role: "manager" },
    "PATCH",
  );
  assert.equal(changed.status, 200);
  assert.equal((await f.request("/admin/state", access)).status, 403);
  const thirdOwner = await f.account("owner");
  access = await f.unlock(desk, "owner", thirdOwner);
  const disabled = await f.request(
    `/users/${thirdOwner.user.id}`,
    ownerAccess,
    { active: false },
    "PATCH",
  );
  assert.equal(disabled.status, 200);
  assert.equal((await f.request("/admin/state", access)).status, 403);
  const fourthOwner = await f.account("owner");
  access = await f.unlock(desk, "owner", fourthOwner);
  assert.equal(
    (
      await f.request("/auth/password", fourthOwner, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD + "-new",
      })
    ).status,
    200,
  );
  assert.equal((await f.request("/admin/state", access)).status, 403);
});

test("login switching, logout and explicit private lock invalidate earlier grants", async (t) => {
  const f = await fixture(t);
  let access = await f.unlock(f.owner);
  const secondLogin = await f.request("/auth/login", f.owner, {
    email: f.owner.user.email,
    password: PASSWORD,
  });
  assert.equal(secondLogin.status, 200);
  assert.equal((await f.request("/admin/state", access)).status, 401);
  const session = { ...secondLogin.data, cookie: secondLogin.cookie };
  access = await f.unlock(session);
  assert.equal((await f.request("/auth/private/lock", access, {})).status, 204);
  assert.equal((await f.request("/admin/state", access)).status, 403);
  access = await f.unlock(session);
  assert.equal((await f.request("/auth/logout", session, {})).status, 204);
  assert.equal((await f.request("/admin/state", access)).status, 401);
});

test("a delayed private lock only revokes its supplied grant, never a newer or another cookie's grant", async (t) => {
  const f = await fixture(t);
  const oldAccess = await f.unlock(f.owner);
  const newAccess = await f.unlock(f.owner);
  assert.notEqual(oldAccess.accessToken, newAccess.accessToken);
  for (const stale of [oldAccess, oldAccess, f.owner]) {
    assert.equal(
      (await f.request("/auth/private/lock", stale, {})).status,
      204,
    );
    assert.equal((await f.request("/admin/state", newAccess)).status, 200);
  }
  const desk = await f.account();
  assert.equal(
    (
      await f.request(
        "/auth/private/lock",
        { ...desk, accessToken: newAccess.accessToken },
        {},
      )
    ).status,
    204,
  );
  assert.equal((await f.request("/admin/state", newAccess)).status, 200);
  assert.equal(
    (await f.request("/auth/private/lock", newAccess, {})).status,
    204,
  );
  assert.equal((await f.request("/admin/state", newAccess)).status, 403);
  assert.equal(
    (await f.request("/auth/private/lock", newAccess, {})).status,
    204,
  );
});

test("an account revoked while password verification is pending cannot receive a private grant", async (t) => {
  const f = await fixture(t);
  const secondOwner = await f.account("owner");
  const originalPrepare = f.db.prepare.bind(f.db);
  let revoked = false;
  f.db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (sql === "SELECT * FROM users WHERE email=?") {
      const get = statement.get.bind(statement);
      statement.get = (email) => {
        const row = get(email);
        if (email === secondOwner.user.email && !revoked) {
          revoked = true;
          queueMicrotask(() =>
            originalPrepare("UPDATE users SET active=0 WHERE id=?").run(
              secondOwner.user.id,
            ),
          );
        }
        return row;
      };
    }
    return statement;
  };
  const result = await f.request("/auth/private/unlock", f.owner, {
    scope: "owner",
    email: secondOwner.user.email,
    password: PASSWORD,
  });
  assert.equal(revoked, true);
  assert.equal(result.status, 403);
  assert.equal(result.data.error.code, "PRIVATE_LOGIN_FAILED");
  assert.equal(result.data.accessToken, undefined);
});

test("owner authorization is rechecked after asynchronous account password hashing", async (t) => {
  const f = await fixture(t);
  const desk = await f.account();
  const access = await f.unlock(desk);
  const originalPrepare = f.db.prepare.bind(f.db);
  let revoked = false;
  f.db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (sql === "SELECT * FROM users WHERE id=? AND active=1") {
      const get = statement.get.bind(statement);
      statement.get = (id) => {
        const row = get(id);
        if (id === f.owner.user.id && !revoked) {
          revoked = true;
          queueMicrotask(() =>
            originalPrepare("UPDATE users SET role='manager' WHERE id=?").run(
              id,
            ),
          );
        }
        return row;
      };
    }
    return statement;
  };
  const result = await f.request("/users", access, {
    name: "레이스 신규 계정",
    email: "race@example.test",
    role: "reception",
    staffId: desk.user.staffId,
    password: PASSWORD,
  });
  assert.equal(revoked, true);
  assert.equal(result.status, 403);
  assert.equal(result.data.error.code, "PRIVATE_SESSION_EXPIRED");
  assert.equal(
    originalPrepare("SELECT 1 FROM users WHERE email=?").get(
      "race@example.test",
    ),
    undefined,
  );
});

test("existing databases retain business data and migrate previous sessions into a locked state", async (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { DatabaseSync } = require("node:sqlite");
  const { openDatabase } = require("../server/db.cjs");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "salon-privacy-migration-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE app_state(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,data TEXT NOT NULL);
    INSERT INTO sessions VALUES('legacy-token','legacy-user','legacy-csrf',9999999999999,'2026-01-01');
    INSERT INTO app_state VALUES(1,17,'{"customers":[{"id":"preserved"}]}');
    PRAGMA user_version=1;`);
  legacy.close();
  const upgraded = openDatabase(filename);
  try {
    assert.deepEqual(readState(upgraded), {
      version: 17,
      data: { customers: [{ id: "preserved" }] },
    });
    const session = upgraded.prepare("SELECT * FROM sessions").get();
    assert.equal(session.token_hash, "legacy-token");
    assert.equal(
      session.idle_expires_at,
      0,
      "legacy session has no implicit private access or fresh work idle interval",
    );
    const { createPrivacy } = require("../server/privacy.cjs");
    createPrivacy(upgraded).refreshMode(session);
    assert.equal(
      upgraded.prepare("SELECT mode FROM sessions").get().mode,
      "shared",
    );
    assert.equal(upgraded.prepare("PRAGMA user_version").get().user_version, 2);
  } finally {
    upgraded.close();
  }
});
