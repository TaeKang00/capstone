"use strict";
// Fills the local store database with realistic sample data (staff, services, customers,
// six weeks of bookings and payments, stock, purchase orders, attendance, leave, payroll).
// Every record goes through the same action functions the server uses, with the clock set
// to the day being simulated, so stock, totals and histories stay consistent.
//
//   npm run seed:demo            add sample data to data/salon.sqlite
//   npm run seed:demo -- --again add another round even if sample data already exists
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { openDatabase, transaction, readState, writeState } = require("../server/db.cjs");
const { applyOperation } = require("../server/operations.cjs");
const { applyCommerce } = require("../server/commerce.cjs");
const { applyWorkforce, WORKFORCE_ACTIONS } = require("../server/workforce.cjs");
const { applyProcurement } = require("../server/procurement.cjs");
const { applyPayroll } = require("../server/payroll.cjs");

const MARK = "예시 데이터";
const DAY = 86400000;
const seoulToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const shift = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const at = (date, minutes) => {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return new Date(`${date}T${h}:${m}:00+09:00`).toISOString();
};
// Small deterministic random so a run always produces the same shape of data.
let seed = 20261110;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];

function dispatch(data, type, payload, ctx) {
  if (WORKFORCE_ACTIONS.includes(type)) return applyWorkforce(data, type, payload, ctx);
  if (/^(supplier|category|purchase)\./.test(type)) return applyProcurement(data, type, payload, ctx);
  if (/^(payment|inventory)\./.test(type)) return applyCommerce(data, type, payload, ctx);
  if (type.startsWith("payroll.")) return applyPayroll(data, type, payload, ctx);
  return applyOperation(data, type, payload, ctx);
}

function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("예시 데이터는 로컬에서만 넣을 수 있어요.");
  const again = process.argv.includes("--again");
  const db = openDatabase(path.resolve(process.env.DB_PATH || "data/salon.sqlite"));
  try {
    const ownerRow = db
      .prepare("SELECT id,name,role,staff_id FROM users WHERE role='owner' AND active=1 ORDER BY created_at LIMIT 1")
      .get();
    const state = readState(db);
    if (!ownerRow || !state)
      throw new Error("먼저 앱을 켜고 매장 초기 설정을 마친 뒤 다시 실행해 주세요.");
    if (!again && state.data.customers.some((c) => (c.memo || "").includes(MARK)))
      throw new Error("이미 예시 데이터가 들어 있어요. 한 번 더 넣으려면 --again을 붙여 주세요.");

    const owner = { id: ownerRow.id, name: ownerRow.name, role: "owner", staffId: ownerRow.staff_id };
    const today = seoulToday();
    let data = state.data;
    let version = state.version;
    const failures = [];
    const run = (type, payload, date = today, minutes = 9 * 60, actor = owner) => {
      try {
        data = dispatch(data, type, payload, {
          actor,
          today: date,
          now: at(date, minutes),
          requestId: randomUUID(),
        });
        version += 1;
        return true;
      } catch (error) {
        failures.push(`${type} (${date}): ${error.message}`);
        return false;
      }
    };
    const last = (list) => list[list.length - 1];

    // Store: open 10:00-20:00, closed on Mondays, 30-minute slots.
    run("store.save", {
      ...data.store,
      name: data.store.name || "오늘 헤어",
      phone: data.store.phone || "02-555-0123",
      address: data.store.address || "서울시 마포구 연남로 12, 2층",
      open: 600,
      close: 1200,
      slotMinutes: 30,
      closedWeekdays: [1],
    });

    // Staff
    const staffSpec = [
      ["박서윤", "designer", "실장", "010-2345-1001"],
      ["최유나", "designer", "디자이너", "010-2345-1002"],
      ["한지민", "designer", "디자이너", "010-2345-1003"],
      ["오다인", "manager", "매니저", "010-2345-1004"],
      ["정하늘", "reception", "데스크", "010-2345-1005"],
    ];
    const staffIds = {};
    for (const [name, role, title, phone] of staffSpec) {
      const existing = data.staff.find((s) => s.name === name);
      if (existing) { staffIds[name] = existing.id; continue; }
      if (run("staff.save", {
        name, phone, role, status: "active", title, team: role === "designer" ? "디자인팀" : "운영팀",
        workingDays: [0, 2, 3, 4, 5, 6], startMinutes: 600, endMinutes: 1200,
        breakStart: 780, breakEnd: 840, hireDate: shift(today, -400 - Math.floor(rand() * 600)), annualLeave: 15,
      })) staffIds[name] = last(data.staff).id;
    }
    const designers = ["박서윤", "최유나", "한지민"].map((n) => staffIds[n]).filter(Boolean);
    designers.push(owner.staffId);

    // Suppliers, categories, items, opening stock
    const supplierIds = {};
    for (const [name, contact, phone] of [["뷰티플러스", "김대리", "02-333-1200"], ["헤어라인 유통", "이과장", "031-777-4500"]]) {
      const existing = (data.suppliers || []).find((s) => s.name === name);
      if (existing) supplierIds[name] = existing.id;
      else if (run("supplier.save", { name, contact, phone, note: MARK, active: true }))
        supplierIds[name] = last(data.suppliers).id;
    }
    const categoryIds = {};
    for (const name of ["염색 제품", "펌 제품", "판매 상품", "소모품"]) {
      const existing = (data.itemCategories || []).find((c) => c.name === name);
      if (existing) categoryIds[name] = existing.id;
      else if (run("category.save", { name, active: true })) categoryIds[name] = last(data.itemCategories).id;
    }
    const itemSpec = [
      ["염색약 7호", "시술 재료", "g", 100, 400, 9000, 0, "뷰티플러스", "염색 제품", 2400],
      ["산화제 6%", "시술 재료", "ml", 1000, 2000, 12000, 0, "뷰티플러스", "염색 제품", 5000],
      ["디지털 펌제", "시술 재료", "ml", 500, 3000, 18000, 0, "헤어라인 유통", "펌 제품", 1500],
      ["클리닉 앰플", "시술 재료", "ml", 500, 500, 22000, 0, "헤어라인 유통", "펌 제품", 1500],
      ["두피 샴푸 500ml", "판매 상품", "개", 1, 5, 14000, 28000, "뷰티플러스", "판매 상품", 24],
      ["헤어 오일 100ml", "판매 상품", "개", 1, 4, 11000, 24000, "헤어라인 유통", "판매 상품", 14],
      ["일회용 장갑", "시술 재료", "개", 100, 200, 6000, 0, "뷰티플러스", "소모품", 600],
    ];
    const itemIds = {};
    for (const [name, kind, unit, packSize, min, purchasePrice, price, supplier, category, opening] of itemSpec) {
      const existing = data.items.find((i) => i.name === name);
      if (existing) { itemIds[name] = existing.id; continue; }
      if (!run("inventory.item", {
        name, kind, unit, packSize: unit === "개" ? 1 : packSize, min, purchasePrice, price,
        supplierId: supplierIds[supplier], categoryId: categoryIds[category], active: true,
      }, shift(today, -45))) continue;
      itemIds[name] = last(data.items).id;
      run("inventory.receipt", { itemId: itemIds[name], qty: opening, date: shift(today, -45), memo: "처음 재고" }, shift(today, -45));
    }

    // Services (with materials so payments use stock)
    const serviceSpec = [
      ["커트", 25000, 40, []],
      ["드라이", 20000, 30, []],
      ["뿌리 염색", 70000, 90, [["염색약 7호", 60], ["산화제 6%", 60]]],
      ["전체 염색", 110000, 120, [["염색약 7호", 120], ["산화제 6%", 120]]],
      ["디지털 펌", 120000, 150, [["디지털 펌제", 80]]],
      ["클리닉", 50000, 60, [["클리닉 앰플", 30]]],
      ["두피 케어", 45000, 50, []],
    ];
    const serviceIds = {};
    for (const [name, price, duration, materials] of serviceSpec) {
      const existing = data.services.find((s) => s.name === name);
      if (existing) { serviceIds[name] = existing.id; continue; }
      if (run("service.save", {
        name, price, duration, active: true,
        materials: materials.filter(([item]) => itemIds[item]).map(([item, quantity]) => ({ itemId: itemIds[item], quantity })),
      }, shift(today, -45))) serviceIds[name] = last(data.services).id;
    }
    const services = Object.entries(serviceIds);
    const weightOf = { 커트: 6, 드라이: 3, "뿌리 염색": 4, "전체 염색": 2, "디지털 펌": 2, 클리닉: 3, "두피 케어": 1 };
    const weighted = services.flatMap(([name, id]) => Array(weightOf[name] || 1).fill([name, id]));

    // Customers
    const customerSpec = [
      ["한지우", "010-4821-3302", "", "디지털 펌 선호, 컬 크게"],
      ["정다은", "010-5512-8841", "", "앞머리 짧게"],
      ["오세린", "010-7745-1029", "두피 민감, 약한 약제 사용", ""],
      ["이수민", "010-3390-4471", "", "뿌리 염색 6주마다"],
      ["김하은", "010-6623-9054", "", ""],
      ["박지호", "010-8834-2217", "", "투블럭"],
      ["윤채원", "010-2219-6630", "임신 중, 염색 상담 먼저", ""],
      ["서민재", "010-9902-1184", "", ""],
      ["강보람", "010-4478-5519", "", "클리닉 정기"],
      ["문서진", "010-3156-7728", "", ""],
      ["백소율", "010-6680-3391", "", "레이어드 컷"],
      ["임도현", "010-7721-0046", "", ""],
      ["조예린", "010-5039-8812", "", "애쉬 계열 선호"],
      ["신유찬", "010-2287-4405", "", ""],
      ["황나연", "010-8145-6673", "", ""],
    ];
    const customerIds = [];
    for (const [name, phone, warning, memo] of customerSpec) {
      const existing = data.customers.find((c) => c.phone === phone);
      if (existing) { customerIds.push(existing.id); continue; }
      if (run("customer.save", { name, phone, warning, memo: memo ? `${memo}\n${MARK}` : MARK }, shift(today, -44)))
        customerIds.push(last(data.customers).id);
    }

    // Six weeks of past days: bookings, check-in, payment; a few no-shows and one refund.
    const methods = ["card", "card", "card", "card", "transfer", "cash"];
    let refunded = false;
    // Weekly restock of colour and perm materials; the last week is left short on purpose
    // so the 보충 필요 alert has something to show.
    const restock = [["염색약 7호", 700], ["산화제 6%", 1200], ["디지털 펌제", 250], ["클리닉 앰플", 120]];
    for (let offset = -42; offset <= -1; offset++) {
      const date = shift(today, offset);
      if (offset % 7 === 0 && offset <= -8)
        for (const [item, qty] of restock)
          if (itemIds[item]) run("inventory.receipt", { itemId: itemIds[item], qty, date, memo: "정기 입고" }, date, 570);
      if (data.store.closedWeekdays.includes(weekday(date))) continue;
      const perDay = 3 + Math.floor(rand() * 4);
      const used = new Map();
      for (let n = 0; n < perDay; n++) {
        const staffId = pick(designers);
        const [serviceName, serviceId] = pick(weighted);
        const duration = serviceSpec.find(([s]) => s === serviceName)[2];
        let start = used.get(staffId) ?? 600 + 30 * Math.floor(rand() * 4);
        // Keep clear of the 13:00-14:00 break.
        if (start < 840 && start + duration > 780) start = 840;
        if (start + duration > 1200) continue;
        used.set(staffId, start + duration + 30 * Math.floor(rand() * 2));
        const customerId = rand() < 0.85 ? pick(customerIds) : null;
        const booked = run("appointment.save", {
          date, start, duration, staffId, serviceIds: [serviceId],
          ...(customerId ? { customerId } : { guestName: pick(["방문 손님", "워크인 손님"]), guestPhone: "" }),
          notes: "",
        }, date, 540);
        if (!booked) continue;
        const appointment = last(data.appointments);
        if (rand() < 0.06) { run("appointment.status", { id: appointment.id, status: "no_show", reason: "연락 없이 오지 않음" }, date, start + 60); continue; }
        run("appointment.status", { id: appointment.id, status: "checked_in" }, date, start);
        run("appointment.status", { id: appointment.id, status: "in_service" }, date, start + 5);
        const lines = [{ type: "service", refId: serviceId, quantity: 1 }];
        if (rand() < 0.2 && itemIds["두피 샴푸 500ml"]) lines.push({ type: "product", refId: pick([itemIds["두피 샴푸 500ml"], itemIds["헤어 오일 100ml"]]), quantity: 1 });
        const paid = run("payment.create", {
          appointmentId: appointment.id, staffId, lines,
          discount: rand() < 0.15 ? 5000 : 0, method: pick(methods),
          reference: `A-${date.replaceAll("-", "").slice(2)}-${n + 1}`, notes: "",
        }, date, start + duration);
        if (paid && !refunded && offset >= -10) {
          const tx = last(data.transactions);
          refunded = run("payment.refund", {
            transactionId: tx.id, lines: [{ lineId: tx.lines[0].id, amount: Math.min(10000, tx.lines[0].total) }],
            method: tx.method, reference: "R-0001", reason: "시술 후 일부 불만으로 일부 환불",
          }, date, start + duration + 30);
        }
      }
    }

    // Today: a mix of states. Tomorrow and the week ahead: bookings.
    const todaySlots = [[600, "박서윤", "뿌리 염색", "completed"], [660, "최유나", "커트", "completed"], [720, "한지민", "클리닉", "in_service"], [840, "박서윤", "디지털 펌", "checked_in"], [900, "최유나", "드라이", "booked"], [960, "한지민", "전체 염색", "booked"], [1020, "박서윤", "커트", "booked"]];
    if (!data.store.closedWeekdays.includes(weekday(today))) {
      for (const [start, staffName, serviceName, status] of todaySlots) {
        const staffId = staffIds[staffName]; const serviceId = serviceIds[serviceName];
        if (!staffId || !serviceId) continue;
        if (!run("appointment.save", { date: today, start, duration: serviceSpec.find(([s]) => s === serviceName)[2], staffId, serviceIds: [serviceId], customerId: pick(customerIds), notes: "" }, today, 540)) continue;
        const a = last(data.appointments);
        if (status === "booked") continue;
        run("appointment.status", { id: a.id, status: "checked_in" }, today, start);
        if (status === "checked_in") continue;
        run("appointment.status", { id: a.id, status: "in_service" }, today, start + 5);
        if (status === "completed")
          run("payment.create", { appointmentId: a.id, staffId, lines: [{ type: "service", refId: serviceId, quantity: 1 }], discount: 0, method: "card", reference: "", notes: "" }, today, start + 60);
      }
    }
    for (let offset = 1; offset <= 7; offset++) {
      const date = shift(today, offset);
      if (data.store.closedWeekdays.includes(weekday(date))) continue;
      for (let n = 0; n < 3; n++) {
        const [serviceName, serviceId] = pick(weighted);
        run("appointment.save", { date, start: [600, 840, 960][n], duration: serviceSpec.find(([s]) => s === serviceName)[2], staffId: designers[n % designers.length], serviceIds: [serviceId], customerId: pick(customerIds), notes: "" }, today, 540);
      }
    }

    // Purchases: one delivered and paid, one partly received, one just ordered; a purchase request.
    const orderSpec = [
      [-20, "뷰티플러스", [["염색약 7호", 4], ["산화제 6%", 2]], "all", true],
      [-6, "헤어라인 유통", [["디지털 펌제", 3], ["클리닉 앰플", 2]], "part", false],
      [-1, "뷰티플러스", [["두피 샴푸 500ml", 6], ["일회용 장갑", 2]], "none", false],
    ];
    for (const [offset, supplier, lines, received, paid] of orderSpec) {
      const date = shift(today, offset);
      const orderLines = lines.filter(([item]) => itemIds[item]).map(([item, quantity]) => ({
        itemId: itemIds[item], quantity, unitCost: itemSpec.find(([n]) => n === item)[5],
      }));
      if (!supplierIds[supplier] || !orderLines.length) continue;
      if (!run("purchase.create", { supplierId: supplierIds[supplier], date, expectedDate: shift(date, 3), lines: orderLines, notes: MARK }, date, 600)) continue;
      const order = last(data.purchaseOrders);
      if (received !== "none") {
        const receiveDate = shift(date, 2);
        run("purchase.receive", {
          id: order.id, date: receiveDate,
          lines: order.lines.map((line, i) => ({ lineId: line.id, quantity: received === "all" || i === 0 ? line.quantity : 0 })).filter((l) => l.quantity > 0),
        }, receiveDate, 660);
      }
      if (paid) run("purchase.payment", { id: order.id, paid: true, paidDate: shift(date, 5), reference: "BANK-2026", reason: "거래처 계좌 이체" }, shift(date, 5), 900);
    }
    if (itemIds["헤어 오일 100ml"] && staffIds["최유나"])
      run("purchase.request", { itemId: itemIds["헤어 오일 100ml"], quantity: 4, note: "손님 문의가 많아요" }, today, 600, { id: "seed-designer", name: "최유나", role: "designer", staffId: staffIds["최유나"] });

    // Attendance for the last two weeks, plus leave requests.
    const attendanceStaff = ["박서윤", "최유나", "한지민", "오다인", "정하늘"].filter((n) => staffIds[n]);
    for (let offset = -14; offset <= -1; offset++) {
      const date = shift(today, offset);
      if (data.store.closedWeekdays.includes(weekday(date))) continue;
      for (const name of attendanceStaff) {
        const late = rand() < 0.08;
        run("attendance.save", {
          staffId: staffIds[name], date,
          clockIn: late ? 615 + Math.floor(rand() * 20) : 590 + Math.floor(rand() * 10),
          clockOut: 1200 + Math.floor(rand() * 20), reason: MARK,
        }, today, 600);
      }
    }
    const asStaff = (name) => ({ id: `seed-${name}`, name, role: "designer", staffId: staffIds[name] });
    if (staffIds["한지민"]) {
      run("request.create", { kind: "leave", type: "annual", from: shift(today, -10), to: shift(today, -10), reason: "가족 행사" }, shift(today, -20), 600, asStaff("한지민"));
      const approvedLeave = last(data.staffRequests);
      if (approvedLeave) run("request.decide", { id: approvedLeave.id, decision: "approved" }, shift(today, -19), 600);
    }
    if (staffIds["박서윤"]) {
      let leaveDate = shift(today, 8);
      while (data.store.closedWeekdays.includes(weekday(leaveDate))) leaveDate = shift(leaveDate, 1);
      run("request.create", { kind: "leave", type: "annual", from: leaveDate, to: leaveDate, reason: "병원 예약" }, today, 600, asStaff("박서윤"));
    }
    if (staffIds["최유나"])
      run("request.create", { kind: "overtime", type: "overtime", from: shift(today, 2), start: 1200, end: 1320, reason: "웨딩 리허설" }, today, 610, asStaff("최유나"));

    // Last month's payroll: finalized and paid for the designers.
    const lastMonth = shift(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    for (const [name, basePay, rate] of [["박서윤", 2600000, 10], ["최유나", 2300000, 8], ["한지민", 2300000, 8]]) {
      if (!staffIds[name]) continue;
      if (data.payroll?.some((p) => p.staffId === staffIds[name] && p.month === lastMonth)) continue;
      if (!run("payroll.save", {
        staffId: staffIds[name], month: lastMonth, payDate: `${today.slice(0, 7)}-05`, basePay, commissionRate: rate,
        allowances: [{ name: "식대", amount: 200000 }], deductions: [{ name: "4대보험 근로자 부담", amount: Math.round(basePay * 0.094) }],
        workDays: 22, workHours: 176, overtimeHours: 0, basis: "월 기본급과 시술 매출 인센티브", notes: "",
      }, `${today.slice(0, 7)}-03`, 600)) continue;
      const record = last(data.payroll);
      if (run("payroll.finalize", { id: record.id }, `${today.slice(0, 7)}-03`, 660))
        run("payroll.paid", { id: record.id, paidDate: `${today.slice(0, 7)}-05` }, `${today.slice(0, 7)}-05`, 600);
    }

    transaction(db, () => writeState(db, data, version));
    console.log("예시 데이터를 넣었어요.");
    console.log(`직원 ${data.staff.length}명, 고객 ${data.customers.length}명, 예약 ${data.appointments.length}건, 수납 ${data.transactions.length}건, 발주 ${(data.purchaseOrders || []).length}건`);
    if (failures.length) {
      console.log(`건너뛴 항목 ${failures.length}개 (규칙에 맞지 않아 넣지 않았어요):`);
      for (const line of failures.slice(0, 30)) console.log(`  ${line}`);
    }
    console.log("브라우저를 새로고침하면 보여요.");
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { main };
