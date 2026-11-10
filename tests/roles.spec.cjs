"use strict";
// Role matrix: what each work login sees and may change. 403 means the server refused;
// anything else (200, or a 409/422 business rule) means the role was allowed to try.
const { test, expect, setupOwner, adminAction, adminHeaders, action, today, state } = require("./ux-fixture.cjs");

test("역할마다 메뉴, 자료, 동작 권한이 표대로 적용된다", async ({ page, browser }) => {
  test.setTimeout(240000);
  await setupOwner(page);
  // Seed a little of everything as the owner.
  let r = await adminAction(page, "service.save", { name: "커트", price: 20000, duration: 30, materials: [], active: true });
  const service = r.data.services[0];
  const owner = r.data.staff[0];
  const accounts = {};
  for (const role of ["manager", "reception", "designer"]) {
    r = await adminAction(page, "staff.save", { name: `${role} 직원`, phone: "", role, status: "active", workingDays: [0, 1, 2, 3, 4, 5, 6], startMinutes: 0, endMinutes: 1440, breakStart: null, breakEnd: null });
    const staff = r.data.staff.find((s) => s.name === `${role} 직원`);
    const email = `${role}@example.test`;
    const created = await page.request.post("/api/users", { headers: await adminHeaders(page), data: { name: staff.name, email, role, staffId: staff.id, password: "Temporary-worker-2026!" } });
    if (!created.ok()) throw new Error(await created.text());
    accounts[role] = { staff, email };
  }
  r = await action(page, "supplier.save", { name: "공급사", contact: "", phone: "", note: "", active: true });
  const supplierId = r.data.suppliers[0].id;
  r = await action(page, "inventory.item", { name: "샴푸", kind: "판매 상품", unit: "개", min: 5, price: 10000, purchasePrice: 5000, supplierId, active: true });
  const item = r.data.items[0];
  await action(page, "inventory.receipt", { itemId: item.id, qty: 2, date: today(), memo: "" });
  r = await action(page, "customer.save", { name: "김손님", phone: "010-1234-5678", memo: "", warning: "" });
  const customer = r.data.customers[0];
  await action(page, "payment.create", { customerId: customer.id, staffId: owner.id, lines: [{ type: "service", refId: service.id, quantity: 1 }], discount: 0, method: "card", reference: "", notes: "" });
  await action(page, "appointment.save", { date: today(), start: 1080, duration: 30, staffId: owner.id, serviceIds: [service.id], customerId: customer.id, notes: "" }).catch(() => {});
  await action(page, "purchase.create", { supplierId, date: today(), lines: [{ itemId: item.id, quantity: 1, unitCost: 5000 }] });
  const ownerState = await state(page);
  const order = ownerState.data.purchaseOrders[0];

  const report = {};
  for (const role of ["owner", "manager", "reception", "designer"]) {
    let context = null, p = page;
    if (role !== "owner") {
      context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1440, height: 900 } });
      p = await context.newPage();
      const login = await p.request.post("/api/auth/login", { data: { loginId: accounts[role].email, password: "Temporary-worker-2026!" } });
      const s = await login.json();
      await p.request.post("/api/auth/password", { headers: { "X-CSRF-Token": s.csrfToken }, data: { currentPassword: "Temporary-worker-2026!", newPassword: "Worker-final-password-2026!" } });
      await p.goto("/");
    } else {
      await p.reload();
    }
    await p.waitForTimeout(1200);
    const me = await (await p.request.get("/api/auth/me")).json();
    const csrf = me.csrfToken;
    const st = await (await p.request.get("/api/state")).json();
    const d = st.data || {};
    const counts = Object.fromEntries(["customers", "appointments", "transactions", "refunds", "items", "receipts", "suppliers", "purchaseOrders", "purchaseRequests", "attendance", "staffRequests", "payroll", "expenses", "certificates", "staffHistory"].map((k) => [k, Array.isArray(d[k]) ? d[k].length : String(d[k])]));
    const staffFields = Object.keys((d.staff || [])[0] || {});
    const nav = await p.getByRole("navigation", { name: "주 메뉴" }).getByRole("button").allTextContents();
    const headerCta = await p.getByRole("button", { name: "＋ 예약 등록", exact: true }).count();
    const sideProtected = await p.getByRole("region", { name: "보호 영역" }).getByRole("button").allTextContents().catch(() => []);
    const stats = await p.locator(".home-stat-label").allTextContents();
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(300);
    const bottom = await p.getByRole("navigation", { name: "빠른 메뉴" }).getByRole("button").allTextContents();
    const ownerPhone = await p.locator(".owner-phone").count();
    await p.setViewportSize({ width: 1440, height: 900 });
    const act = async (type, payload) => {
      const v = (await (await p.request.get("/api/state")).json()).version;
      const res = await p.request.post(`/api/actions/${type}`, { headers: { "X-CSRF-Token": csrf }, data: { version: v, requestId: require("node:crypto").randomUUID(), payload } });
      return res.status();
    };
    const other = role === "owner" ? accounts.designer.staff.id : owner.id;
    const actions = {
      "customer.save": await act("customer.save", { name: `${role} 고객`, phone: "", memo: "", warning: "" }),
      "appointment.save(other staff)": await act("appointment.save", { date: today(), start: 1140, duration: 30, staffId: other, serviceIds: [service.id], guestName: "권한 확인", guestPhone: "", notes: "" }),
      "payment.create": await act("payment.create", { guestName: "권한 손님", staffId: owner.id, lines: [{ type: "service", refId: service.id, quantity: 1 }], discount: 0, method: "cash", reference: "", notes: "" }),
      "inventory.item": await act("inventory.item", { name: `${role} 품목`, kind: "판매 상품", unit: "개", min: 1, price: 1000, active: true }),
      "inventory.receipt": await act("inventory.receipt", { itemId: item.id, qty: 1, date: today(), memo: "" }),
      "supplier.save": await act("supplier.save", { name: `${role} 공급사`, contact: "", phone: "", note: "", active: true }),
      "purchase.create": await act("purchase.create", { supplierId, date: today(), lines: [{ itemId: item.id, quantity: 1, unitCost: 5000 }] }),
      "purchase.payment": await act("purchase.payment", { id: order.id, paid: true, paidDate: today(), reference: "", reason: "권한 확인" }),
      "attendance.clock(self)": await act("attendance.clock", { kind: "in" }),
      "attendance.clock(other)": await act("attendance.clock", { kind: "in", staffId: accounts.reception.staff.id === me.user?.staffId ? owner.id : accounts.reception.staff.id }),
      "store.save (no owner unlock)": await act("store.save", { ...ownerState.data.store }),
      "staff.save (no owner unlock)": await act("staff.save", { name: "몰래 직원", phone: "", role: "designer", status: "active", workingDays: [1], startMinutes: 600, endMinutes: 1200, breakStart: null, breakEnd: null }),
    };
    const endpoints = {};
    for (const url of ["/api/reports?from=" + today() + "&to=" + today(), "/api/reports/breakdown?from=" + today() + "&to=" + today(), "/api/users", "/api/admin/state", "/api/audit"])
      endpoints[url.split("?")[0]] = (await p.request.get(url)).status();
    report[role] = { counts, staffFields, nav, headerCta, sideProtected, stats, bottom, ownerPhone, actions, endpoints };
    if (context) await context.close();
  }
  const allowed = (role, name) => report[role].actions[name] !== 403;
  const expected = {
    "customer.save": ["owner", "manager", "reception", "designer"],
    "appointment.save(other staff)": ["owner", "manager", "reception"],
    "payment.create": ["owner", "manager", "reception"],
    "inventory.item": ["owner", "manager"],
    "inventory.receipt": ["owner", "manager", "reception"],
    "supplier.save": ["owner", "manager"],
    "purchase.create": ["owner", "manager"],
    "purchase.payment": ["owner", "manager"],
    "attendance.clock(self)": ["owner", "manager", "reception", "designer"],
    "attendance.clock(other)": ["owner", "manager"],
    "store.save (no owner unlock)": [],
    "staff.save (no owner unlock)": [],
  };
  for (const [name, roles] of Object.entries(expected))
    for (const role of ["owner", "manager", "reception", "designer"])
      expect(allowed(role, name), `${role} ${name}`).toBe(roles.includes(role));
  for (const role of ["owner", "manager", "reception", "designer"])
    for (const [url, status] of Object.entries(report[role].endpoints))
      expect(status, `${role} ${url} needs the owner area`).toBe(403);
  expect(report.designer.nav).toEqual(["오늘", "예약", "고객", "근태"]);
  for (const role of ["owner", "manager", "reception"]) expect(report[role].nav.map((n) => n.replace(/\d+$/, ""))).toEqual(["오늘", "예약", "고객", "수납", "재고", "발주", "근태"]);
  expect(report.owner.bottom).toContain("승인");
  for (const role of ["manager", "reception", "designer"]) expect(report[role].bottom).not.toContain("승인");
  expect(report.designer.counts.transactions).toBe(0);
  expect(report.designer.counts.suppliers).toBe(0);
  expect(report.designer.counts.purchaseOrders).toBe(0);
  for (const role of ["owner", "manager", "reception", "designer"]) {
    expect(report[role].counts.payroll).toBe(0);
    expect(report[role].staffFields).not.toContain("phone");
  }
});
