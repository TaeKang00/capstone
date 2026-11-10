"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { initialState, applyOperation } = require("../server/operations.cjs");
const { applyWorkforce, leaveBalance } = require("../server/workforce.cjs");
const { applyCommerce, getReport } = require("../server/commerce.cjs");
const { getProfit } = require("../server/finance.cjs");
const { createApp } = require("../server/app.cjs");
const { hashPassword } = require("../server/auth.cjs");
const { readState, writeState } = require("../server/db.cjs");

const owner = { id: "u-owner", name: "원장", role: "owner", staffId: "s1" };
const designer = {
  id: "u-designer",
  name: "디자이너",
  role: "designer",
  staffId: "s2",
};
const ctx = (actor = owner, now = "2026-11-10T00:30:00Z") => ({
  actor,
  today: "2026-11-10",
  now,
  requestId: randomUUID(),
});
function fixture() {
  let d = initialState({
    storeName: "테스트 살롱",
    ownerName: "원장",
    ownerStaffId: "s1",
  });
  d = applyOperation(
    d,
    "staff.save",
    {
      name: "디자이너",
      phone: "",
      role: "designer",
      status: "active",
      workingDays: [1, 2, 3, 4, 5],
      startMinutes: 600,
      endMinutes: 1200,
      breakStart: 780,
      breakEnd: 840,
      hireDate: "2024-03-02",
      annualLeave: 2,
    },
    ctx(),
  );
  d.staff[1].id = "s2";
  d.staffHistory.forEach((row) => (row.staffId = "s2"));
  d = applyOperation(
    d,
    "service.save",
    { name: "커트", price: 30000, duration: 60, materials: [], active: true },
    ctx(),
  );
  return d;
}
const work = (d, type, payload, actor = owner, now) =>
  applyWorkforce(d, type, payload, ctx(actor, now));

test("clock in/out records the actor's own Seoul time once per day", () => {
  let d = fixture();
  d = work(d, "attendance.clock", { kind: "in" }, designer); // 09:30 KST
  assert.equal(d.attendance[0].staffId, "s2");
  assert.equal(d.attendance[0].clockIn, 570);
  assert.throws(
    () => work(d, "attendance.clock", { kind: "in" }, designer),
    /이미 출근/,
  );
  d = work(
    d,
    "attendance.clock",
    { kind: "out" },
    designer,
    "2026-11-10T10:05:00Z",
  );
  assert.equal(d.attendance[0].clockOut, 1145);
  assert.throws(
    () => work(d, "attendance.clock", { kind: "out" }, designer),
    /이미 퇴근/,
  );
  assert.throws(
    () =>
      work(d, "attendance.save", {
        staffId: "s2",
        date: "2026-11-10",
        clockIn: 600,
        clockOut: 1100,
        reason: "누락",
      }),
    /같은 날짜/,
  );
  d = work(d, "attendance.save", {
    id: d.attendance[0].id,
    staffId: "s2",
    date: "2026-11-10",
    clockIn: 600,
    clockOut: 1100,
    reason: "지문 오류",
  });
  assert.equal(d.attendance[0].changes.at(-1).before.clockIn, 570);
  assert.throws(
    () =>
      work(
        d,
        "attendance.save",
        {
          staffId: "s2",
          date: "2026-11-09",
          clockIn: 600,
          clockOut: 1100,
          reason: "x",
        },
        designer,
      ),
    /권한/,
  );
});

test("leave consumes working days, respects the annual balance and blocks bookings once approved", () => {
  let d = fixture();
  // Mon 11-16 .. Sun 11-22 → 5 working days, more than the 2-day allowance.
  assert.throws(
    () =>
      work(
        d,
        "request.create",
        { kind: "leave", type: "annual", from: "2026-11-16", to: "2026-11-22" },
        designer,
      ),
    /남은 연차/,
  );
  d = work(
    d,
    "request.create",
    { kind: "leave", type: "annual", from: "2026-11-16", to: "2026-11-16" },
    designer,
  );
  d = work(
    d,
    "request.create",
    { kind: "leave", type: "half_pm", from: "2026-11-17" },
    designer,
  );
  const [full, half] = d.staffRequests;
  assert.equal(full.days, 1);
  assert.deepEqual([half.days, half.start, half.end], [0.5, 840, 1200]);
  assert.deepEqual(leaveBalance(d, "s2", 2026), {
    allowance: 2,
    used: 0,
    reserved: 1.5,
    remaining: 0.5,
  });
  assert.throws(
    () =>
      work(
        d,
        "request.create",
        { kind: "leave", type: "sick", from: "2026-11-16" },
        designer,
      ),
    /같은 기간/,
  );
  // A booking made before approval must be moved first.
  d = applyOperation(
    d,
    "appointment.save",
    {
      date: "2026-11-17",
      start: 900,
      guestName: "손님",
      staffId: "s2",
      serviceIds: [d.services[0].id],
    },
    ctx(),
  );
  assert.throws(
    () => work(d, "request.decide", { id: half.id, decision: "approved" }),
    /예약 1건/,
  );
  d = applyOperation(
    d,
    "appointment.save",
    { ...d.appointments[0], start: 600 },
    ctx(),
  );
  d = work(d, "request.decide", { id: half.id, decision: "approved" });
  d = work(d, "request.decide", { id: full.id, decision: "approved" });
  assert.throws(
    () =>
      applyOperation(
        d,
        "appointment.save",
        {
          date: "2026-11-16",
          start: 600,
          guestName: "손님",
          staffId: "s2",
          serviceIds: [d.services[0].id],
        },
        ctx(),
      ),
    /휴가/,
  );
  // Morning slots on the half-day remain bookable.
  applyOperation(
    d,
    "appointment.save",
    {
      date: "2026-11-17",
      start: 690,
      guestName: "손님2",
      staffId: "s2",
      serviceIds: [d.services[0].id],
    },
    ctx(),
  );
  assert.throws(
    () => work(d, "request.decide", { id: full.id, decision: "rejected" }),
    /승인 대기/,
  );
  assert.throws(
    () => work(d, "request.cancel", { id: full.id }, owner),
    /본인/,
  );
  d = work(d, "request.cancel", { id: full.id }, designer);
  assert.equal(d.staffRequests[0].status, "cancelled");
  assert.equal(leaveBalance(d, "s2", 2026).remaining, 1.5);
});

test("overtime requests need a valid window and personnel changes are kept as history", () => {
  let d = fixture();
  d = work(
    d,
    "request.create",
    {
      kind: "overtime",
      type: "night",
      from: "2026-11-10",
      start: 1200,
      end: 1320,
      reason: "웨딩 준비",
    },
    designer,
  );
  assert.equal(d.staffRequests[0].minutes, 120);
  assert.throws(
    () =>
      work(
        d,
        "request.create",
        { kind: "overtime", type: "night", from: "2026-11-10", start: 1260, end: 1300 },
        designer,
      ),
    /같은 시간대/,
  );
  const staff = d.staff.find((row) => row.id === "s2");
  d = applyOperation(
    d,
    "staff.save",
    { ...staff, title: "실장", team: "1팀" },
    ctx(),
  );
  const history = d.staffHistory.filter((row) => row.staffId === "s2");
  assert.deepEqual(
    history.map((row) => [row.kind, row.field, row.after]),
    [
      ["hire", "status", "active"],
      ["transfer", "team", "1팀"],
      ["promotion", "title", "실장"],
    ],
  );
});

test("notices, expenses, card import, certificates and purchase requests validate their owners", () => {
  let d = fixture();
  assert.throws(
    () => work(d, "notice.save", { title: "x", body: "y" }, designer),
    /권한/,
  );
  d = work(d, "notice.save", { title: "휴무 안내", body: "다음 주 월요일 휴무", pinned: true });
  d = work(d, "notice.archive", { id: d.notices[0].id });
  assert.equal(d.notices[0].archived, true);

  d = work(d, "expense.save", {
    date: "2026-11-01",
    category: "임대료·관리비",
    amount: 1500000,
    vendor: "건물주",
    method: "transfer",
  });
  assert.throws(
    () =>
      work(d, "expense.save", {
        date: "2026-12-01",
        category: "공과금",
        amount: 1,
        vendor: "x",
        method: "cash",
      }),
    /미래/,
  );
  const rows = [
    { date: "2026-11-02", vendor: "다이소", amount: 12000, reference: "A1" },
    { date: "2026-11-03", vendor: "쿠팡", amount: 45000, reference: "A2" },
  ];
  d = work(d, "expense.import", {
    rows,
    category: "소모품·비품",
    method: "corporate_card",
  });
  assert.equal(d.expenses.length, 3);
  assert.throws(
    () =>
      work(d, "expense.import", {
        rows,
        category: "소모품·비품",
        method: "corporate_card",
      }),
    /이미 가져온/,
  );
  d = work(d, "expense.void", { id: d.expenses[1].id, reason: "중복" });

  assert.throws(
    () =>
      work(d, "certificate.issue", {
        staffId: "s1",
        type: "employment",
        purpose: "은행 제출",
      }),
    /입사일/,
  );
  d = work(d, "certificate.issue", {
    staffId: "s2",
    type: "employment",
    purpose: "은행 제출",
  });
  d = work(d, "certificate.issue", {
    staffId: "s2",
    type: "career",
    purpose: "이직",
  });
  assert.deepEqual(
    d.certificates.map((row) => row.number),
    ["2026-0001", "2026-0002"],
  );
  assert.equal(d.certificates[0].snapshot.hireDate, "2024-03-02");

  d = applyCommerce(
    d,
    "inventory.item",
    {
      name: "샴푸",
      kind: "판매 상품",
      unit: "개",
      min: 1,
      price: 20000,
      purchasePrice: 9000,
      barcode: "8801234567890",
      spec: "500ml",
    },
    ctx(),
  );
  assert.equal(d.items[0].barcode, "8801234567890");
  assert.throws(
    () =>
      applyCommerce(
        d,
        "inventory.item",
        { name: "린스", kind: "판매 상품", unit: "개", min: 1, price: 1, barcode: "8801234567890" },
        ctx(),
      ),
    /바코드/,
  );
  d = work(d, "purchase.request", { itemId: d.items[0].id, quantity: 3 }, designer);
  assert.throws(
    () => work(d, "purchase.request", { itemId: d.items[0].id, quantity: 1 }, designer),
    /이미 구매 요청/,
  );
  assert.throws(
    () => work(d, "purchase.requestDecide", { id: d.purchaseRequests[0].id, status: "ordered" }, designer),
    /권한/,
  );
  d = work(d, "purchase.requestDecide", { id: d.purchaseRequests[0].id, status: "ordered" });
  assert.equal(d.purchaseRequests[0].status, "ordered");
});

test("sales report ranks services and products; profit subtracts purchases, payroll and expenses", () => {
  let d = fixture();
  d = applyCommerce(
    d,
    "inventory.item",
    { name: "샴푸", kind: "판매 상품", unit: "개", min: 0, price: 20000, purchasePrice: 9000 },
    ctx(),
  );
  d = applyCommerce(
    d,
    "inventory.adjust",
    { itemId: d.items[0].id, qty: 10, reason: "시작 재고" },
    ctx(),
  );
  d = applyCommerce(
    d,
    "inventory.receipt",
    { itemId: d.items[0].id, packQty: 2, date: "2026-11-10", memo: "" },
    ctx(),
  );
  d = applyCommerce(
    d,
    "payment.create",
    {
      guestName: "손님",
      staffId: "s2",
      lines: [
        { type: "service", refId: d.services[0].id, quantity: 1 },
        { type: "product", refId: d.items[0].id, quantity: 2 },
      ],
      discount: 0,
      method: "card",
      reference: "",
      notes: "",
    },
    ctx(),
  );
  const report = getReport(d, { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(
    report.byProduct.map((row) => [row.name, row.quantity, row.net]),
    [["샴푸", 2, 40000]],
  );
  assert.deepEqual(
    report.byService.map((row) => [row.name, row.net]),
    [["커트", 30000]],
  );
  d.payroll.push({ id: "p", staffId: "s2", month: "2026-11", status: "finalized", earningsTotal: 25000 });
  d = work(d, "expense.save", {
    date: "2026-11-05",
    category: "공과금",
    amount: 7000,
    vendor: "한전",
    method: "auto",
  });
  const profit = getProfit(d, { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(profit.totals.sales, 70000);
  assert.equal(profit.totals.purchases, 18000);
  assert.equal(profit.estimatedPurchases, 18000);
  assert.equal(profit.totals.payroll, 25000);
  assert.equal(profit.totals.expenses, 7000);
  assert.equal(profit.totals.operatingProfit, 20000);
  assert.deepEqual(profit.expensesByCategory, [{ category: "공과금", amount: 7000 }]);
});

test("store settings keep logo, alerts and insurance rates validated", () => {
  const d = fixture();
  const base = { ...d.store };
  const saved = applyOperation(
    d,
    "store.save",
    {
      ...base,
      logo: "data:image/png;base64,iVBORw0KGgo=",
      businessNumber: "123-45-67890",
      representative: "원장",
      alerts: { lowStock: false },
    },
    ctx(),
  );
  assert.equal(saved.store.alerts.lowStock, false);
  assert.equal(saved.store.alerts.unreadNotices, true);
  assert.equal(saved.store.payrollRates.pension, 4.75);
  assert.throws(
    () => applyOperation(d, "store.save", { ...base, logo: "javascript:alert(1)" }, ctx()),
    /로고/,
  );
  assert.throws(
    () => applyOperation(d, "store.save", { ...base, businessNumber: "12" }, ctx()),
    /사업자등록번호/,
  );
});

test("HTTP: projections hide private HR/finance data, notice reads do not bump the version, failed logins are logged", async (t) => {
  const PASSWORD = "workforce-test-password!";
  const service = createApp({ dbPath: ":memory:", distPath: "/nonexistent" });
  const server = service.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    service.close();
  });
  async function request(route, session, body) {
    const response = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrfToken } : {}),
        ...(session?.accessToken ? { "X-Private-Token": session.accessToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json().catch(() => null),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const setup = await request("/bootstrap", null, {
    name: "원장",
    storeName: "근태 테스트",
    loginId: "owner01",
    password: PASSWORD,
  });
  assert.equal(setup.status, 201);
  const ownerSession = { ...setup.data, cookie: setup.cookie };
  const envelope = readState(service.db);
  envelope.data.staff.push({
    ...envelope.data.staff[0],
    id: "s-designer",
    name: "디자이너",
    role: "designer",
  });
  envelope.data.expenses = [{ id: "e", amount: 1, status: "active" }];
  envelope.data.certificates = [{ id: "c", staffId: "s-designer" }];
  writeState(service.db, envelope.data, envelope.version + 1);
  service.db
    .prepare(
      "INSERT INTO users(id,name,email,password_hash,role,staff_id,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run("u-d", "디자이너", "designer01", await hashPassword(PASSWORD), "designer", "s-designer", new Date().toISOString());
  const failed = await request("/auth/login", null, { loginId: "designer01", password: "wrong-password-123" });
  assert.equal(failed.status, 401);
  const login = await request("/auth/login", null, { loginId: "designer01", password: PASSWORD });
  const designerSession = { ...login.data, cookie: login.cookie };
  const act = async (session, type, payload) =>
    request(`/actions/${type}`, session, {
      payload,
      version: readState(service.db).version,
      requestId: randomUUID(),
    });
  assert.equal((await act(designerSession, "attendance.clock", { kind: "in" })).status, 200);
  assert.equal((await act(designerSession, "notice.save", { title: "a", body: "b" })).status, 403);
  assert.equal((await act(ownerSession, "notice.save", { title: "공지", body: "내용" })).status, 200);
  // Private HR actions need the owner re-authentication, not a work login.
  assert.equal(
    (await act(ownerSession, "expense.save", { date: "2026-01-01", category: "기타", amount: 1, vendor: "x", method: "cash" })).status,
    403,
  );
  const state = await request("/state", designerSession);
  assert.deepEqual(state.data.data.expenses, []);
  assert.deepEqual(state.data.data.certificates, []);
  assert.equal(state.data.data.attendance.length, 1);
  const version = readState(service.db).version;
  const noticeId = state.data.data.notices[0].id;
  const read = await request(`/notices/${noticeId}/read`, designerSession, {});
  assert.equal(read.status, 200);
  assert.equal(read.data.reads[0].userId, "u-d");
  assert.equal(readState(service.db).version, version);

  const unlock = await request("/auth/private/unlock", ownerSession, {
    scope: "owner",
    loginId: "owner01",
    password: PASSWORD,
  });
  const privateSession = { ...ownerSession, ...unlock.data };
  const access = await request("/audit?kind=auth", privateSession);
  assert.ok(access.data.entries.some((row) => row.action === "auth.failed"));
  const changes = await request("/audit", privateSession);
  assert.ok(changes.data.entries.every((row) => !row.action.startsWith("auth.")));
  const profit = await request("/reports/profit?from=2026-01-01&to=2026-12-31", privateSession);
  assert.equal(profit.status, 200);
  assert.equal(profit.data.totals.expenses, 0);
  const personalUnlock = await request("/auth/private/unlock", designerSession, {
    scope: "personal",
    loginId: "designer01",
    password: PASSWORD,
  });
  const personal = await request("/personal/state", { ...designerSession, ...personalUnlock.data });
  assert.deepEqual(personal.data.data.certificates.map((row) => row.id), ["c"]);
});
