"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { initialState, applyOperation } = require("../server/operations.cjs");
const { applyCommerce, getReport } = require("../server/commerce.cjs");
const { applyProcurement } = require("../server/procurement.cjs");
const {
  status,
  received,
  pending,
  total,
  paidAmount,
  balance,
} = require("../src/procurement.js");
const {
  openDatabase,
  transaction,
  readState,
  writeState,
} = require("../server/db.cjs");
const ctx = {
  actor: { id: "u1", name: "원장", role: "owner", staffId: "s1" },
  today: "2026-10-12",
  now: "2026-10-12T03:00:00Z",
};
const commerce = (d, t, p) =>
  applyCommerce(d, t, p, { ...ctx, requestId: randomUUID() });
const op = (d, t, p) => applyOperation(d, t, p, ctx);
const purchase = (d, t, p) =>
  applyProcurement(d, t, p, { ...ctx, requestId: randomUUID() });
function fixture() {
  let d = initialState({
    storeName: "검증",
    ownerName: "원장",
    ownerStaffId: "s1",
  });
  d = commerce(d, "inventory.item", {
    name: "케어",
    kind: "시술 재료",
    unit: "ml",
    packSize: 500,
    purchasePrice: 20000,
    price: 0,
    min: 100,
    active: true,
  });
  d = commerce(d, "inventory.receipt", {
    itemId: d.items[0].id,
    packQty: 3,
    date: ctx.today,
  });
  d = op(d, "service.save", {
    name: "케어 시술",
    price: 50000,
    duration: 30,
    active: true,
    materials: [{ itemId: d.items[0].id, quantity: 100 }],
  });
  d = op(d, "appointment.save", {
    date: ctx.today,
    start: 600,
    staffId: "s1",
    guestName: "고객",
    serviceIds: [d.services[0].id],
  });
  return d;
}
function pay(d, extra = {}) {
  return commerce(d, "payment.create", {
    appointmentId: d.appointments[0].id,
    staffId: "s1",
    lines: [{ type: "service", refId: d.services[0].id, quantity: 1 }],
    discount: 0,
    method: "card",
    ...extra,
  });
}
function ordered(qty = 3) {
  let d = fixture();
  d = purchase(d, "supplier.save", {
    name: "공급사",
    active: true,
    contact: "",
    phone: "",
    note: "",
  });
  return purchase(d, "purchase.create", {
    supplierId: d.suppliers[0].id,
    date: ctx.today,
    lines: [{ itemId: d.items[0].id, quantity: qty, unitCost: 20000 }],
  });
}
function receive(d, quantity) {
  return purchase(d, "purchase.receive", {
    id: d.purchaseOrders[0].id,
    date: ctx.today,
    lines: [{ lineId: d.purchaseOrders[0].lines[0].id, quantity }],
  });
}
function settle(d, amount, kind = "payment") {
  return purchase(d, "purchase.settlement", {
    id: d.purchaseOrders[0].id,
    kind,
    amount,
    date: ctx.today,
    reason: "은행 결과 확인",
  });
}

test("price correction atomically refunds and replaces payment without consuming stock twice; preserves appointment and report", () => {
  const d = pay(fixture()),
    before = structuredClone(d),
    tx = d.transactions[0];
  const p = {
    id: tx.id,
    lines: tx.lines.map((l) => ({ lineId: l.id, unitPrice: 30000 })),
    discount: 0,
    method: "card",
    reason: "단가 오류",
    reference: "NEW",
    refundReference: "VOID",
  };
  const corrected = commerce(d, "payment.reprice", p),
    replacement = corrected.transactions[1];
  assert.deepEqual(d, before);
  assert.deepEqual(corrected.items, d.items);
  assert.deepEqual(corrected.logs, d.logs);
  assert.equal(corrected.transactions[0].status, "refunded");
  assert.equal(corrected.transactions[0].replacedBy, replacement.id);
  assert.equal(replacement.correctsTransactionId, tx.id);
  assert.equal(corrected.appointments[0].transactionId, replacement.id);
  assert.equal(
    getReport(corrected, { from: ctx.today, to: ctx.today }).net,
    30000,
  );
  assert.throws(() => commerce(corrected, "payment.reprice", p), /환불 이력/);
  const next = commerce(corrected, "payment.reprice", {
    ...p,
    id: replacement.id,
    lines: replacement.lines.map((l) => ({ lineId: l.id, unitPrice: 35000 })),
  });
  assert.equal(next.items[0].qty, 1400);
  assert.equal(getReport(next, { from: ctx.today, to: ctx.today }).net, 35000);
});
test("service amount refunds support successive refunds and mixing quantity while rejecting over-refunds and product amount refunds", () => {
  const d = pay(fixture()),
    tx = d.transactions[0],
    lineId = tx.lines[0].id;
  const refund = (data, line) =>
    commerce(data, "payment.refund", {
      transactionId: tx.id,
      lines: [{ lineId, ...line }],
      method: "card",
      reason: "금액 일부 환불",
    });
  const first = refund(d, { amount: 10000 });
  assert.equal(first.refunds[0].amount, 10000);
  assert.equal(first.transactions[0].status, "partially_refunded");
  assert.equal(first.items[0].qty, 1400);
  assert.throws(() => refund(first, { amount: 40001 }), /남은 결제액/);
  assert.throws(() => refund(first, { amount: 0 }), /남은 결제액/);
  assert.throws(() => refund(first, { amount: 1, quantity: 1 }), /함께 입력/);
  const last = refund(first, { quantity: 1 });
  assert.equal(last.refunds[1].amount, 40000);
  assert.equal(last.transactions[0].status, "refunded");
  assert.equal(getReport(last, { from: ctx.today, to: ctx.today }).net, 0);
  const remaining = refund(first, { amount: 40000 });
  assert.equal(remaining.transactions[0].status, "refunded");
  const product = structuredClone(d);
  product.transactions[0].lines[0].type = "product";
  assert.throws(() => refund(product, { amount: 100 }), /시술 항목/);
});
test("actual material quantity uses supported units, reason and snapshot without allowing unrelated stock override", () => {
  const d = fixture(),
    id = d.items[0].id;
  assert.throws(
    () => pay(d, { materialUsage: [{ itemId: id, quantity: 150 }] }),
    /이유/,
  );
  const paid = pay(d, {
    materialUsage: [{ itemId: id, quantity: 150 }],
    materialReason: "긴 머리",
  });
  assert.equal(paid.items[0].qty, 1350);
  assert.equal(paid.transactions[0].materialUsage[0].standard, 100);
  assert.equal(paid.transactions[0].materialUsage[0].quantity, 150);
  assert.equal(
    pay(d, {
      materialUsage: [{ itemId: id, quantity: 0 }],
      materialReason: "고객 지참 재료",
    }).items[0].qty,
    1500,
  );
  assert.throws(
    () =>
      pay(d, {
        materialUsage: [{ itemId: "unrelated", quantity: 1 }],
        materialReason: "오류",
      }),
    /해당 시술/,
  );
  assert.throws(
    () =>
      pay(d, {
        materialUsage: [{ itemId: id, quantity: 1501 }],
        materialReason: "잘못 입력",
      }),
    /부족/,
  );
  assert.equal(d.items[0].qty, 1500);
});
test("future bookings cannot check in or start service; changing the booking date enables normal work", () => {
  let d = fixture();
  d.appointments[0].date = "2026-10-13";
  for (const state of ["checked_in", "in_service"])
    assert.throws(
      () =>
        op(d, "appointment.status", {
          id: d.appointments[0].id,
          status: state,
        }),
      /미래 예약/,
    );
  d = op(d, "appointment.save", { ...d.appointments[0], date: ctx.today });
  d = op(d, "appointment.status", {
    id: d.appointments[0].id,
    status: "checked_in",
  });
  assert.equal(d.appointments[0].status, "checked_in");
});
test("partial delivery can close just the outstanding quantity without reversing received stock or legacy payment", () => {
  let d = receive(ordered(10), 5),
    o = d.purchaseOrders[0];
  d = purchase(d, "purchase.payment", {
    id: o.id,
    paid: true,
    paidDate: ctx.today,
    reason: "전액 지급",
  });
  const before = d.items[0].qty;
  d = purchase(d, "purchase.closeRemaining", {
    id: o.id,
    date: ctx.today,
    lines: [{ lineId: o.lines[0].id, quantity: 5 }],
    reason: "공급사 품절",
  });
  o = d.purchaseOrders[0];
  assert.equal(d.items[0].qty, before);
  assert.equal(received(o.lines[0], d.receipts), 5);
  assert.equal(pending(o, o.lines[0], d.receipts), 0);
  assert.equal(status(o, d.receipts), "delivered");
  assert.equal(total(o), 100000);
  assert.equal(paidAmount(o), 200000);
  assert.equal(balance(o), -100000);
  assert.throws(() => receive(d, 1), /미입고/);
  d = settle(d, 100000, "refund");
  assert.equal(balance(d.purchaseOrders[0]), 0);
});
test("partial supplier payments, return and actual refund persist as separate audited events", () => {
  let d = receive(ordered(), 3),
    o = d.purchaseOrders[0];
  d = settle(d, 20000);
  assert.equal(d.purchaseOrders[0].paid, false);
  assert.equal(balance(d.purchaseOrders[0]), 40000);
  d = settle(d, 40000);
  assert.equal(d.purchaseOrders[0].paid, true);
  d = purchase(d, "purchase.return", {
    id: o.id,
    date: ctx.today,
    lines: [{ lineId: o.lines[0].id, quantity: 1 }],
    reason: "불량 제품 실제 반품",
  });
  o = d.purchaseOrders[0];
  assert.equal(d.items[0].qty, 2500);
  assert.equal(total(o), 40000);
  assert.equal(balance(o), -20000);
  assert.throws(() => settle(d, 20001, "refund"), /돌려받을/);
  d = settle(d, 20000, "refund");
  assert.equal(balance(d.purchaseOrders[0]), 0);
  assert.throws(
    () =>
      purchase(d, "purchase.receiptCancel", {
        id: o.id,
        receiptId: d.receipts.at(-1).id,
        reason: "입고 삭제",
      }),
    /반품 이력/,
  );
  const db = openDatabase(":memory:");
  try {
    transaction(db, () => writeState(db, d, 1));
    const restored = readState(db).data;
    assert.deepEqual(restored.purchaseOrders, d.purchaseOrders);
    assert.equal(balance(restored.purchaseOrders[0]), 0);
  } finally {
    db.close();
  }
  const entry = d.purchaseOrders[0].changes.find(
    (c) => c.paymentDelta === -20000,
  );
  d = purchase(d, "purchase.settlement", {
    id: o.id,
    kind: "void",
    paymentId: entry.paymentId,
    date: ctx.today,
    reason: "환급 오입력",
  });
  assert.equal(balance(d.purchaseOrders[0]), -20000);
  assert.throws(
    () =>
      purchase(d, "purchase.settlement", {
        id: o.id,
        kind: "void",
        paymentId: entry.paymentId,
        date: ctx.today,
        reason: "중복 정정",
      }),
    /정정할 지급 기록/,
  );
});

test("deposit cannot be hidden by cancelling an unreceived order; closing its outstanding quantity preserves the refund due", () => {
  let d = settle(ordered(), 20000);
  const o = d.purchaseOrders[0];
  assert.throws(
    () => purchase(d, "purchase.cancel", { id: o.id, reason: "입고 전 취소" }),
    /입고나 지급 기록/,
  );
  d = purchase(d, "purchase.closeRemaining", {
    id: o.id,
    date: ctx.today,
    lines: [{ lineId: o.lines[0].id, quantity: 3 }],
    reason: "주문 전체 잔량 취소",
  });
  assert.equal(status(d.purchaseOrders[0], d.receipts), "cancelled");
  assert.equal(balance(d.purchaseOrders[0]), -20000);
  d = settle(d, 20000, "refund");
  assert.equal(balance(d.purchaseOrders[0]), 0);
});
