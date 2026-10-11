"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { applyProcurement } = require("../server/procurement.cjs");
const { applyCommerce } = require("../server/commerce.cjs");
const { initialState } = require("../server/operations.cjs");
const {
  openDatabase,
  readState,
  writeState,
  transaction,
} = require("../server/db.cjs");
const { status, received, total } = require("../src/procurement.js");
const ctx = {
  actor: { id: "owner", name: "원장", role: "owner", staffId: "s1" },
  today: "2026-10-12",
  now: "2026-10-12T03:00:00Z",
};
const apply = (data, type, p, role = "owner") =>
  applyProcurement(data, type, p, {
    ...ctx,
    actor: { ...ctx.actor, role },
    requestId: randomUUID(),
  });
function fixture() {
  const d = initialState({
    storeName: "테스트",
    ownerName: "원장",
    ownerStaffId: "s1",
  });
  d.suppliers = [
    {
      id: "sup",
      name: "테스트 공급사",
      contact: "담당자",
      phone: "",
      note: "",
      active: true,
    },
  ];
  d.itemCategories = [{ id: "cat-service", name: "시술 제품", active: true }];
  d.purchaseOrders = [];
  return applyCommerce(
    d,
    "inventory.item",
    {
      name: "트리트먼트",
      kind: "시술 재료",
      unit: "ml",
      packSize: 500,
      purchasePrice: 20000,
      supplierId: "sup",
      categoryId: "cat-service",
      price: 0,
      min: 600,
      active: true,
    },
    { ...ctx, requestId: randomUUID() },
  );
}
function order(d = fixture(), qty = 3) {
  return apply(d, "purchase.create", {
    supplierId: "sup",
    date: ctx.today,
    deliveryDate: "2026-10-13",
    lines: [{ itemId: d.items[0].id, quantity: qty, unitCost: 20000 }],
    notes: "",
  });
}
function receive(d, qty = 1) {
  const o = d.purchaseOrders[0];
  return apply(d, "purchase.receive", {
    id: o.id,
    date: ctx.today,
    lines: [{ lineId: o.lines[0].id, quantity: qty }],
    memo: "검수 완료",
  });
}

test("full cycle preserves cost and package snapshots, receives partially, pays and consumes 100ml on service settlement", () => {
  let d = order();
  let o = d.purchaseOrders[0];
  assert.equal(d.items[0].qty, 0);
  assert.equal(total(o), 60000);
  d = apply(d, "purchase.ship", { id: o.id });
  assert.equal(status(d.purchaseOrders[0], d.receipts), "shipping");
  d = receive(d, 1);
  assert.equal(d.items[0].qty, 500);
  assert.equal(status(d.purchaseOrders[0], d.receipts), "waiting");
  d.items[0].packSize = 1000;
  d.items[0].purchasePrice = 30000; // New catalog values must not alter historical order.
  d = receive(d, 2);
  o = d.purchaseOrders[0];
  assert.equal(d.items[0].qty, 1500);
  assert.equal(status(o, d.receipts), "delivered");
  assert.equal(total(o), 60000);
  d = apply(d, "purchase.payment", {
    id: o.id,
    paid: true,
    paidDate: ctx.today,
    reference: "BANK-001",
    reason: "거래처 이체 확인",
  });
  assert.equal(d.purchaseOrders[0].paid, true);
  d.services = [
    {
      id: "svc",
      name: "헤어 케어",
      price: 30000,
      duration: 30,
      active: true,
      materials: [{ itemId: d.items[0].id, quantity: 100 }],
    },
  ];
  d = applyCommerce(
    d,
    "payment.create",
    {
      staffId: "s1",
      guestName: "방문 고객",
      lines: [{ type: "service", refId: "svc", quantity: 1 }],
      discount: 0,
      method: "card",
      notes: "",
    },
    { ...ctx, requestId: randomUUID() },
  );
  assert.equal(d.items[0].qty, 1400);
  assert.equal(d.transactions[0].total, 30000);
  assert.equal(d.logs.at(-1).delta, -100);
});
test("100 ordered and 50 received is waiting with remaining 50, not delivered", () => {
  const d = receive(order(fixture(), 100), 50),
    o = d.purchaseOrders[0];
  assert.equal(received(o.lines[0], d.receipts), 50);
  assert.equal(status(o, d.receipts), "waiting");
  assert.throws(() => receive(d, 51), /미입고 수량/);
  assert.equal(d.items[0].qty, 25000);
});
test("multi-line invalid receipt is atomic; duplicate lines, zero, decimals and wrong dates are rejected", () => {
  let d = fixture();
  d.items.push({ ...d.items[0], id: "second", name: "두 번째 재료" });
  d = apply(d, "purchase.create", {
    supplierId: "sup",
    date: ctx.today,
    lines: d.items.map((i) => ({ itemId: i.id, quantity: 3, unitCost: 5000 })),
  });
  const o = d.purchaseOrders[0];
  const before = structuredClone(d);
  assert.throws(
    () =>
      apply(d, "purchase.receive", {
        id: o.id,
        date: ctx.today,
        lines: [
          { lineId: o.lines[0].id, quantity: 1 },
          { lineId: o.lines[1].id, quantity: 4 },
        ],
      }),
    /미입고 수량/,
  );
  assert.deepEqual(d, before);
  for (const qty of [0, -1, 0.5, NaN]) assert.throws(() => receive(d, qty));
  assert.throws(
    () =>
      apply(d, "purchase.receive", {
        id: o.id,
        date: ctx.today,
        lines: [
          { lineId: o.lines[0].id, quantity: 1 },
          { lineId: o.lines[0].id, quantity: 1 },
        ],
      }),
    /중복/,
  );
  for (const date of ["2026-10-13", "2026-10-11", "2026-02-30"])
    assert.throws(() =>
      apply(d, "purchase.receive", {
        id: o.id,
        date,
        lines: [{ lineId: o.lines[0].id, quantity: 1 }],
      }),
    );
});
test("cancel receipt reopens order and restores stock; cannot cancel consumed stock or bypass linked receipt handling", () => {
  let d = receive(order(), 3),
    o = d.purchaseOrders[0],
    r = d.receipts[0];
  assert.throws(
    () =>
      applyCommerce(
        d,
        "inventory.cancel",
        { receiptId: r.id, expectedRevision: r.revision, reason: "중복 입력" },
        { ...ctx, requestId: randomUUID() },
      ),
    /발주에 연결/,
  );
  const cancelled = apply(d, "purchase.receiptCancel", {
    id: o.id,
    receiptId: r.id,
    reason: "수량 오기입",
  });
  assert.equal(cancelled.items[0].qty, 0);
  assert.equal(
    status(cancelled.purchaseOrders[0], cancelled.receipts),
    "waiting",
  );
  assert.equal(receive(cancelled, 3).items[0].qty, 1500);
  d.items[0].qty = 1400;
  assert.throws(
    () =>
      apply(d, "purchase.receiptCancel", {
        id: o.id,
        receiptId: r.id,
        reason: "오기입",
      }),
    /음수/,
  );
});
test("inactive master data blocks new orders but allows fulfilment of existing commitments", () => {
  let d = order();
  const o = d.purchaseOrders[0];
  d = apply(d, "supplier.save", { ...d.suppliers[0], active: false });
  d.items[0].active = false;
  assert.throws(() => order(d), /사용 중인 거래처/);
  d = receive(d, 3);
  assert.equal(status(d.purchaseOrders[0], d.receipts), "delivered");
  assert.throws(
    () => apply(d, "purchase.cancel", { id: o.id, reason: "취소" }),
    /입고나 지급/,
  );
  const c = apply(fixture(), "category.save", {
    name: "염색 제품",
    active: true,
  });
  assert.equal(c.itemCategories.length, 2);
  assert.throws(
    () => apply(c, "category.save", { name: "염색 제품", active: true }),
    /이미 등록/,
  );
});
test("payment and order cancellation retain history and enforce role restrictions", () => {
  let d = order(),
    id = d.purchaseOrders[0].id;
  for (const role of ["designer", "reception"])
    for (const type of [
      "purchase.create",
      "purchase.ship",
      "purchase.cancel",
      "purchase.payment",
      "supplier.save",
      "category.save",
    ])
      assert.throws(() => apply(d, type, { id }, role), { status: 403 });
  assert.equal(
    apply(
      d,
      "purchase.receive",
      {
        id,
        date: ctx.today,
        lines: [{ lineId: d.purchaseOrders[0].lines[0].id, quantity: 1 }],
      },
      "reception",
    ).items[0].qty,
    500,
  );
  d = apply(d, "purchase.payment", {
    id,
    paid: true,
    paidDate: ctx.today,
    reason: "이체 완료",
  });
  assert.throws(
    () => apply(d, "purchase.cancel", { id, reason: "취소" }),
    /지급 기록/,
  );
  d = apply(d, "purchase.payment", {
    id,
    paid: false,
    reason: "이체 실패 확인",
  });
  d = apply(d, "purchase.cancel", { id, reason: "재발주 예정" });
  assert.equal(status(d.purchaseOrders[0], d.receipts), "cancelled");
  assert.equal(d.purchaseOrders[0].changes.length, 4);
  assert.throws(() => receive(d), /취소된 발주/);
});
test("manual packages convert to capacity and SQLite tables persist order lines separately from app_state", () => {
  let d = fixture();
  d = applyCommerce(
    d,
    "inventory.receipt",
    { itemId: d.items[0].id, packQty: 3, date: ctx.today },
    { ...ctx, requestId: randomUUID() },
  );
  assert.equal(d.items[0].qty, 1500);
  d = order(d);
  const db = openDatabase(":memory:");
  try {
    transaction(db, () => writeState(db, d, 1));
    const raw = JSON.parse(db.prepare("SELECT data FROM app_state").get().data);
    assert.equal(raw.purchaseOrders, undefined);
    assert.equal(raw.suppliers, undefined);
    assert.equal(raw.itemCategories, undefined);
    assert.equal(
      db.prepare("SELECT pack_size FROM purchase_order_lines").get().pack_size,
      500,
    );
    assert.equal(
      db.prepare("SELECT name FROM suppliers").get().name,
      "테스트 공급사",
    );
    assert.deepEqual(readState(db).data.purchaseOrders, d.purchaseOrders);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const bad = structuredClone(d);
    bad.purchaseOrders[0].supplierId = "absent";
    bad.purchaseOrders[0].id = "bad";
    assert.throws(() => transaction(db, () => writeState(db, bad, 2)));
    assert.equal(readState(db).version, 1);
    assert.equal(
      db.prepare("SELECT count(*) n FROM purchase_orders").get().n,
      1,
    );
  } finally {
    db.close();
  }
});
