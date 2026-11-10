"use strict";
const { randomUUID } = require("node:crypto");
const {
  test, expect, setupOwner, state, action, session, adminAction, adminHeaders,
  adminState, goTo, unlockOwner, openPersonal, today, OWNER_EMAIL, OWNER_PASSWORD,
} = require("./ux-fixture.cjs");

async function addEmployee(page, browser, { name, email, role = "reception" }) {
  const saved = await adminAction(page, "staff.save", {
    name, phone: "010-8181-9191", role, status: "active",
    workingDays: [0, 1, 2, 3, 4, 5, 6], startMinutes: 600, endMinutes: 1200,
    breakStart: null, breakEnd: null,
  });
  const staff = saved.data.staff.find(row => row.name === name);
  const created = await page.request.post("/api/users", {
    headers: await adminHeaders(page),
    data: { name, email, role, staffId: staff.id, password: "Temporary-worker-2026!" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const separate = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const password = "Worker-private-password-2026!";
  try {
    const login = await separate.request.post("/api/auth/login", { data: { email, password: "Temporary-worker-2026!" } });
    expect(login.ok(), await login.text()).toBeTruthy();
    const { csrfToken } = await login.json();
    const changed = await separate.request.post("/api/auth/password", {
      headers: { "X-CSRF-Token": csrfToken },
      data: { currentPassword: "Temporary-worker-2026!", newPassword: password },
    });
    expect(changed.ok(), await changed.text()).toBeTruthy();
  } finally {
    await separate.close();
  }
  return { ...staff, email, password };
}
async function payslip(page, staffId, { finalized = true, basePay = 2100000, month = today().slice(0, 7), notes = "" } = {}) {
  const saved = await adminAction(page, "payroll.save", {
    staffId, month, payDate: today(), basePay, commissionRate: 0,
    allowances: [], deductions: [], workDays: "", workHours: "", overtimeHours: "",
    basis: "검증용 월 정액 급여", notes,
  });
  const row = saved.data.payroll.find(record => record.staffId === staffId && record.month === month);
  if (finalized) await adminAction(page, "payroll.finalize", { id: row.id });
  return row;
}
async function workerLogin(page, employee) {
  await page.getByRole("button", { name: "작업자 로그인", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "작업자 로그인", exact: true });
  await gate.getByLabel("아이디", { exact: true }).fill(employee.email);
  await gate.getByLabel("비밀번호", { exact: true }).fill(employee.password);
  await gate.getByRole("button", { name: "작업자 로그인", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
}

test("원장으로 로그인해도 급여는 별도 인증하고 잠금·뒤로가기로 노출되지 않는다", async ({ page }) => {
  await setupOwner(page);
  const { data } = await adminState(page);
  await payslip(page, data.staff[0].id, { basePay: 9876543, notes: "원장전용급여메모" });
  const work = await state(page);
  expect(work.data.payroll).toEqual([]);
  expect(JSON.stringify(work)).not.toContain("원장전용급여메모");
  expect((await page.request.get("/api/admin/state")).status()).toBe(403);
  expect((await page.request.get("/api/users")).status()).toBe(403);
  await goTo(page, "고객 관리");
  await page.getByRole("button", { name: "원장 관리", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "원장 관리 열기", exact: true });
  await gate.getByLabel("원장 아이디", { exact: true }).fill(OWNER_EMAIL);
  await gate.getByLabel("비밀번호", { exact: true }).fill("incorrect-password");
  await gate.getByRole("button", { name: "열기", exact: true }).click();
  await expect(gate.getByRole("alert")).toBeVisible();
  await expect(page.locator(".private-workspace")).toHaveCount(0);
  await gate.getByLabel("비밀번호", { exact: true }).fill(OWNER_PASSWORD);
  await gate.getByRole("button", { name: "열기", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "원장 관리 메뉴" })).toBeVisible();
  await goTo(page, "급여명세");
  await expect(page.locator(".private-workspace")).toContainText("9,876,543");
  const headers = await adminHeaders(page);
  await page.getByRole("button", { name: "지금 잠그기", exact: true }).click();
  await expect(page.locator(".private-workspace")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("9,876,543");
  expect((await page.request.get("/api/admin/state", { headers })).status()).toBe(403);
  await page.goBack();
  await page.goForward();
  await expect(page.locator("body")).not.toContainText("9,876,543");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(headers["X-Private-Token"]);
});

test("공용 화면은 예약을 가리고 수정은 작업자 인증 후 실제 입력자로 기록한다", async ({ page, browser }) => {
  await setupOwner(page);
  const employee = await addEmployee(page, browser, { name: "공용 접수 직원", email: "shared.reception@example.test" });
  const catalog = await adminAction(page, "service.save", { name: "공용 커트", price: 20000, duration: 30, active: true, materials: [] });
  const service = catalog.data.services.find(row => row.name === "공용 커트");
  await action(page, "appointment.save", { date: today(), start: 600, staffId: catalog.data.staff.find(row => row.role === "owner").id, serviceIds: [service.id], guestName: "민감고객실명", guestPhone: "010-7777-9999", notes: "민감상담메모" });
  await page.reload();
  await page.getByRole("button", { name: "공용 화면 잠금", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘 예약", level: 1, exact: true })).toBeVisible();
  const shared = await state(page);
  expect(shared.session.mode).toBe("shared");
  expect(shared.data.appointments).toHaveLength(1);
  expect(JSON.stringify(shared)).not.toMatch(/민감고객실명|7777-9999|민감상담메모|8181-9191/);
  expect(shared.data.customers).toEqual([]);
  expect(shared.data.payroll).toEqual([]);
  await expect(page.locator("body")).not.toContainText("민감고객실명");
  const { csrfToken } = await session(page);
  const blocked = await page.request.post("/api/actions/customer.save", {
    headers: { "X-CSRF-Token": csrfToken },
    data: { version: shared.version, requestId: randomUUID(), payload: { name: "인증없는수정", phone: "", memo: "", warning: "" } },
  });
  expect(blocked.status()).toBe(423);
  expect((await blocked.json()).error.code).toBe("WORK_LOCKED");
  await workerLogin(page, employee);
  await goTo(page, "고객 관리");
  await page.getByRole("button", { name: "+ 고객 등록", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "고객 등록", exact: true });
  await dialog.getByLabel("이름", { exact: true }).fill("입력자확인고객");
  await dialog.getByRole("button", { name: "고객 저장", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "입력자확인고객" })).toBeVisible();
  const log = await page.request.get("/api/audit", { headers: await adminHeaders(page) });
  expect(log.ok(), await log.text()).toBeTruthy();
  expect(await log.text()).toContain("공용 접수 직원");
  expect((await page.request.get("/api/users")).status()).toBe(403);
});

test("개인 급여는 본인 재인증 후 본인의 확정 명세만 보이고 다른 계정을 대입할 수 없다", async ({ page, browser }) => {
  await setupOwner(page);
  const employee = await addEmployee(page, browser, { name: "본인 명세 직원", email: "own.payslip@example.test" });
  const owner = (await adminState(page)).data.staff.find(row => row.role === "owner");
  const own = await payslip(page, employee.id, { basePay: 2134567 });
  await payslip(page, owner.id, { basePay: 9999999 });
  await payslip(page, employee.id, { finalized: false, basePay: 1234567, month: "2000-01" });
  await page.getByRole("button", { name: "공용 화면 잠금", exact: true }).click();
  await workerLogin(page, employee);
  const { csrfToken } = await session(page);
  const substituted = await page.request.post("/api/auth/private/unlock", { headers: { "X-CSRF-Token": csrfToken }, data: { scope: "personal", email: OWNER_EMAIL, password: OWNER_PASSWORD } });
  expect(substituted.status()).toBe(403);
  const unlocked = page.waitForResponse(response => response.url().endsWith("/api/auth/private/unlock") && response.ok());
  await openPersonal(page, employee.email, employee.password);
  const grant = await (await unlocked).json();
  await expect(page.locator(".private-workspace")).toContainText("2,134,567");
  await expect(page.locator(".private-workspace")).not.toContainText("9,999,999");
  const personal = await page.request.get("/api/personal/state", { headers: { "X-Private-Token": grant.accessToken } });
  expect(personal.ok(), await personal.text()).toBeTruthy();
  expect((await personal.json()).data.payroll.map(row => row.id)).toEqual([own.id]);
  expect((await page.request.get("/api/admin/state", { headers: { "X-Private-Token": grant.accessToken } })).status()).toBe(403);
  expect((await state(page)).data.payroll).toEqual([]);
  await page.reload();
  await expect(page.locator(".private-workspace")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("2,134,567");
});

test("서버의 원장 인증 유효시간이 지나면 새 요청을 거절하고 화면을 잠근다", async ({ page, privacyClock }) => {
  await setupOwner(page);
  await goTo(page, "매장 설정");
  const headers = await adminHeaders(page);
  privacyClock.advance(180001);
  const expired = await page.request.get("/api/admin/state", { headers });
  expect(expired.status()).toBe(403);
  await page.getByRole("navigation", { name: "원장 관리 메뉴" }).getByRole("button", { name: "매출", exact: true }).click();
  await expect(page.locator(".private-workspace")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
});

test("다른 탭의 공용 잠금 뒤 민감한 응답이 늦게 도착해도 급여 화면을 복원하지 않는다", async ({ page }) => {
  await setupOwner(page);
  const owner = (await adminState(page)).data.staff[0];
  await payslip(page, owner.id, { basePay: 8765432 });
  const otherTab = await page.context().newPage();
  await otherTab.goto(new URL("/", page.url()).href);
  await expect(otherTab.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  await page.bringToFront();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let observed;
  const received = new Promise(resolve => { observed = resolve; });
  const lateResponse = page.waitForResponse(response => response.url().endsWith("/api/admin/state"));
  await page.route("**/api/admin/state", async route => {
    const response = await route.fetch();
    observed();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await unlockOwner(page);
    await received;
    await otherTab.getByRole("button", { name: "공용 화면 잠금", exact: true }).evaluate(button => button.click());
    await expect(page.getByRole("heading", { name: "오늘 예약", level: 1, exact: true })).toBeVisible();
    await expect(page.locator(".private-workspace")).toHaveCount(0);
  } finally {
    release();
  }
  expect((await lateResponse).status()).toBe(200);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  await expect(page.getByRole("heading", { name: "오늘 예약", level: 1, exact: true })).toBeVisible();
  await expect(page.locator(".private-workspace")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("8,765,432");
  await page.reload();
  await expect(page.locator(".private-workspace")).toHaveCount(0);
});


test("원장 화면을 연 채 새 탭으로 이동해도 인증 토큰과 민감한 자료를 넘기지 않는다", async ({ page }) => {
  await setupOwner(page);
  const owner = (await adminState(page)).data.staff[0];
  await payslip(page, owner.id, { basePay: 7654321 });
  await goTo(page, "급여명세");
  await expect(page.locator(".private-workspace")).toContainText("7,654,321");
  const token = (await adminHeaders(page))["X-Private-Token"];
  const tab = await page.context().newPage();
  await tab.goto(new URL("/", page.url()).href);
  await expect(tab.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  await expect(tab.locator(".private-workspace")).toHaveCount(0);
  await expect(tab.locator("body")).not.toContainText("7,654,321");
  expect((await tab.request.get("/api/admin/state")).status()).toBe(403);
  expect(await tab.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(token);
  await tab.close();
});


test("매니저도 원장 비밀번호 인증 없이 계정 권한이나 전체 급여에 접근할 수 없다", async ({ page, browser }) => {
  await setupOwner(page);
  const manager = await addEmployee(page, browser, { name: "업무 매니저", email: "work.manager@example.test", role: "manager" });
  await page.getByRole("button", { name: "공용 화면 잠금", exact: true }).click();
  await workerLogin(page, manager);
  await expect(page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: /^(급여명세|직원 관리|매장 설정)$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "원장 관리", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "원장 관리 열기", exact: true });
  await gate.getByLabel("원장 아이디", { exact: true }).fill(manager.email);
  await gate.getByLabel("비밀번호", { exact: true }).fill(manager.password);
  await gate.getByRole("button", { name: "열기", exact: true }).click();
  await expect(gate.getByRole("alert")).toBeVisible();
  await expect(page.locator(".private-workspace")).toHaveCount(0);
  expect((await page.request.get("/api/users")).status()).toBe(403);
  expect((await page.request.get("/api/admin/state")).status()).toBe(403);
  expect((await state(page)).data.payroll).toEqual([]);
});

test("작업자 유휴시간이 지나면 입력 중인 고객 정보도 지우고 공용 화면으로 돌아간다", async ({ page, privacyClock }) => {
  await page.clock.install();
  await setupOwner(page);
  // Auto-lock is off by default; this store turns it on.
  const current = await state(page);
  await adminAction(page, "store.save", { ...current.data.store, autoLockMinutes: 5 });
  await page.reload();
  await goTo(page, "고객 관리");
  await page.getByRole("button", { name: "+ 고객 등록", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "고객 등록", exact: true });
  await dialog.getByLabel("이름", { exact: true }).fill("자리를비운뒤남으면안되는이름");
  privacyClock.advance(301000);
  await page.clock.fastForward(301000);
  await expect(page.getByRole("heading", { name: "오늘 예약", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("자리를비운뒤남으면안되는이름");
  expect((await state(page)).session.mode).toBe("shared");
});


test("두 탭에서 동시에 공용 잠금을 눌러도 두 화면 모두 잠금 상태로 수렴한다", async ({ page }) => {
  await setupOwner(page);
  const [peer] = await Promise.all([
    page.waitForEvent("popup"),
    page.evaluate(() => { window.__sharedLockPeer = window.open("/", "salon-lock-peer"); }),
  ]);
  await expect(peer.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let arrivals = 0;
  let bothArrived;
  const received = new Promise(resolve => { bothArrived = resolve; });
  await page.context().route("**/api/auth/lock", async route => {
    arrivals++;
    if (arrivals === 2) bothArrived();
    await held;
    await route.continue();
  });
  try {
    await page.evaluate(() => {
      const buttonIn = document => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "공용 화면 잠금");
      const local = buttonIn(document);
      const remote = buttonIn(window.__sharedLockPeer.document);
      local.click();
      remote.click();
    });
    await received;
  } finally {
    release();
  }
  await expect(page.getByRole("heading", { name: "오늘 예약", level: 1, exact: true })).toBeVisible();
  await expect(peer.getByRole("heading", { name: "오늘 예약", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "잠금 상태 다시 확인", exact: true })).toHaveCount(0);
  await expect(peer.getByRole("button", { name: "잠금 상태 다시 확인", exact: true })).toHaveCount(0);
  expect((await state(page)).session.mode).toBe("shared");
});

test("화면 이탈 후 도착한 원장 인증 응답으로 보호 화면을 다시 열지 않는다", async ({ page }) => {
  await setupOwner(page);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let observed;
  const received = new Promise(resolve => { observed = resolve; });
  const lateResponse = page.waitForResponse(response => response.url().endsWith("/api/auth/private/unlock"));
  await page.route("**/api/auth/private/unlock", async route => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    observed();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  await page.getByRole("button", { name: "원장 관리", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "원장 관리 열기", exact: true });
  await gate.getByLabel("원장 아이디", { exact: true }).fill(OWNER_EMAIL);
  await gate.getByLabel("비밀번호", { exact: true }).fill(OWNER_PASSWORD);
  try {
    await gate.getByRole("button", { name: "열기", exact: true }).click();
    await received;
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect(gate).toHaveCount(0);
  } finally {
    release();
  }
  expect((await lateResponse).status()).toBe(200);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  await expect(page.locator(".private-workspace")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  expect((await page.request.get("/api/admin/state")).status()).toBe(403);
});

test("admin 아이디와 admin 비밀번호로 초기 설정·로그인·원장 재인증을 한다", async ({page}) => {
  await page.goto('/');
  await page.getByLabel('매장 이름',{exact:true}).fill('아이디 시연 매장');
  await page.getByLabel('원장 이름',{exact:true}).fill('시연 원장');
  await expect(page.getByLabel('아이디',{exact:true})).toHaveValue('admin');
  await page.getByLabel('비밀번호',{exact:true}).fill('admin');
  await page.getByLabel('비밀번호 확인',{exact:true}).fill('admin');
  await page.getByRole('button',{name:'매장 만들고 시작하기',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'주 메뉴'})).toBeVisible();
  await page.getByRole('button',{name:'원장 관리',exact:true}).click();
  const gate=page.getByRole('dialog',{name:'원장 관리 열기',exact:true});
  await gate.getByLabel('원장 아이디',{exact:true}).fill('admin');
  await gate.getByLabel('비밀번호',{exact:true}).fill('admin');
  await gate.getByRole('button',{name:'열기',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'원장 관리 메뉴'})).toBeVisible();
  await page.getByRole('button',{name:'지금 잠그기',exact:true}).click();
  await page.getByRole('button', { name: /내 메뉴$/ }).click();
  await page.getByRole('menuitem', { name: '로그아웃', exact: true }).click();
  await page.getByRole('dialog',{name:'로그아웃할까요?',exact:true}).getByRole('button',{name:'로그아웃',exact:true}).click();
  await expect(page.getByRole('heading',{name:'로그인',exact:true})).toBeVisible();
  await page.getByLabel('아이디',{exact:true}).fill('admin');
  await page.getByLabel('비밀번호',{exact:true}).fill('admin');
  await page.getByRole('button',{name:'로그인',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'주 메뉴'})).toBeVisible();
});
