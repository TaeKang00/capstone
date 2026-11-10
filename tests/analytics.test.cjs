"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { getBreakdown } = require("../server/analytics.cjs");

const data = {
  staff: [{ id: "s1", name: "박서윤" }, { id: "s2", name: "최유나" }],
  services: [{ id: "cut", name: "커트" }, { id: "perm", name: "디지털 펌" }],
  items: [],
  transactions: [
    { id: "t1", date: "2026-11-02", staffId: "s1", method: "card", total: 30000, lines: [{ id: "l1", type: "service", refId: "cut", quantity: 1, total: 30000 }] },
    { id: "t2", date: "2026-11-03", staffId: "s1", method: "cash", total: 120000, lines: [{ id: "l2", type: "service", refId: "perm", quantity: 1, total: 120000 }] },
    { id: "t3", date: "2026-11-03", staffId: "s2", method: "card", total: 60000, lines: [{ id: "l3", type: "service", refId: "cut", quantity: 2, total: 60000 }] },
    { id: "t0", date: "2026-10-30", staffId: "s1", method: "card", total: 50000, lines: [{ id: "l0", type: "service", refId: "cut", quantity: 1, total: 50000 }] },
  ],
  refunds: [
    { id: "r1", transactionId: "t3", date: "2026-11-04", method: "card", amount: 30000, lines: [{ lineId: "l3", quantity: 1, amount: 30000 }] },
  ],
};

test("breakdown groups by designer, service and method with daily series", () => {
  const r = getBreakdown(data, { from: "2026-11-01", to: "2026-11-04" });
  assert.deepEqual(r.days, ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
  assert.equal(r.total.net, 180000);
  assert.equal(r.total.count, 3);
  const [first, second] = r.dims.staff;
  assert.equal(first.name, "박서윤");
  assert.equal(first.net, 150000);
  assert.deepEqual(first.series, [0, 30000, 120000, 0]);
  assert.equal(second.net, 30000);
  assert.deepEqual(second.series, [0, 0, 60000, -30000]);
  const cut = r.dims.service.find((row) => row.name === "커트");
  assert.equal(cut.net, 60000);
  assert.equal(cut.count, 3);
  assert.deepEqual(cut.top.map((x) => x.name), ["최유나", "박서윤"]);
  const card = r.dims.method.find((row) => row.key === "card");
  assert.equal(card.name, "카드");
  assert.equal(card.net, 60000);
  // Previous period is the 4 days before: Oct 28-31.
  assert.equal(r.previousFrom, "2026-10-28");
  assert.equal(first.prevNet, 50000);
  assert.equal(r.total.prevNet, 50000);
});

test("breakdown rejects bad ranges", () => {
  assert.throws(() => getBreakdown(data, { from: "2026-11-05", to: "2026-11-01" }));
  assert.throws(() => getBreakdown(data, { from: "2025-01-01", to: "2026-11-01" }));
  assert.throws(() => getBreakdown(data, { from: "x", to: "2026-11-01" }));
});
