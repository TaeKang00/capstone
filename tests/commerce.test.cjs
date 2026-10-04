'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCommerce, getReport } = require('../server/commerce.cjs');

const ctx = { actor: { id: 'user-owner', name: '원장', role: 'owner', staffId: 's1' }, today: '2026-10-05', now: '2026-10-05T01:15:00.000Z', requestId: 'request-1' };
function fixture() {
  return {
    schemaVersion: 2, seq: {}, store: { name: '테스트 헤어' },
    staff: [{ id: 's1', name: '원장', role: 'owner', status: 'active' }, { id: 's2', name: '디자이너', role: 'designer', status: 'active' }, { id: 's3', name: '퇴사 직원', role: 'designer', status: 'inactive' }],
    customers: [{ id: 'c1', name: '고객', archived: false }],
    services: [{ id: 'sv1', name: '염색', price: 50000, duration: 90, active: true, materials: [{ itemId: 'dye', quantity: 60 }] }, { id: 'sv2', name: '커트', price: 20000, duration: 30, active: true, materials: [] }],
    appointments: [{ id: 'a1', date: '2026-10-05', start: 600, duration: 90, customerId: 'c1', staffId: 's1', serviceIds: ['sv1'], status: 'in_service', transactionId: null, changes: [] }],
    items: [{ id: 'dye', name: '염색약', kind: '시술 재료', qty: 200, min: 100, price: 0, unit: 'g', active: true }, { id: 'shampoo', name: '샴푸', kind: '판매 상품', qty: 10, min: 3, price: 10000, unit: '개', active: true }, { id: 'bulk', name: '소분 트리트먼트', kind: '판매 상품', qty: 200, min: 20, price: 10, unit: 'ml', active: true }],
    transactions: [], refunds: [], receipts: [], inventoryOperations: [], logs: [],
  };
}
function pay(overrides = {}) {
  return { customerId: 'c1', staffId: 's1', lines: [{ type: 'service', refId: 'sv1', quantity: 1 }, { type: 'product', refId: 'shampoo', quantity: 2 }], discount: 1000, method: 'card', reference: 'terminal-reference', notes: '', ...overrides };
}
function apply(data, type, payload, context = ctx) { return applyCommerce(data, type, payload, context); }
function sale(data = fixture(), overrides = {}) { return apply(data, 'payment.create', pay(overrides)); }
function refund(data, lines, overrides = {}, context = ctx) {
  return apply(data, 'payment.refund', { transactionId: data.transactions[0].id, lines, method: 'card', reference: 'refund-reference', reason: '고객 요청', ...overrides }, context);
}
function frozen(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(frozen); } return value; }

test('payment atomically saves immutable snapshots, consumes materials/products and completes its appointment', () => {
  const before = frozen(fixture());
  const result = sale(before, { appointmentId: 'a1' });
  const tx = result.transactions[0];
  assert.equal(before.items[0].qty, 200);
  assert.equal(result.items[0].qty, 140);
  assert.equal(result.items[1].qty, 8);
  assert.equal(tx.total, 69000);
  assert.equal(tx.subtotal, 70000);
  assert.equal(tx.lines.reduce((sum, line) => sum + line.discount, 0), 1000);
  assert.equal(tx.lines.reduce((sum, line) => sum + line.total, 0), tx.total);
  assert.equal(tx.customerName, '고객');
  assert.equal(tx.time, '10:15');
  assert.equal(tx.actorId, ctx.actor.id);
  assert.equal(result.appointments[0].transactionId, tx.id);
  assert.equal(result.appointments[0].status, 'completed');
  assert.equal(result.logs.length, 2);
  assert.equal(result.logs[0].dt, '2026-10-05 10:15');
  assert.equal(result.logs[0].actorName, '원장');
  assert.throws(() => sale(result, { appointmentId: 'a1' }), { code: 'ALREADY_PAID', status: 409 });
});

test('shortage considers repeated lines together and does not partially commit any changes', () => {
  const before = frozen(fixture());
  assert.throws(() => sale(before, { lines: [{ type: 'product', refId: 'shampoo', quantity: 6 }, { type: 'product', refId: 'shampoo', quantity: 5 }], discount: 0 }), { code: 'INSUFFICIENT_STOCK', status: 409 });
  assert.equal(before.transactions.length, 0);
  assert.equal(before.items[1].qty, 10);
  assert.equal(before.logs.length, 0);
  assert.throws(() => sale(before, { lines: [{ type: 'service', refId: 'sv1', quantity: 4 }] }), /염색약 재고가 부족/);
});

test('existing reservations remain payable after their catalog service and material are discontinued', () => {
  const input = fixture();
  input.services[0].active = false;
  input.items[0].active = false;
  assert.throws(() => sale(input), /시술 또는 판매 상품/);
  const result = sale(input, { appointmentId: 'a1' });
  assert.equal(result.items[0].qty, 140);
  assert.equal(result.appointments[0].status, 'completed');
  input.appointments[0].serviceIds = ['sv2'];
  assert.throws(() => sale(input, { appointmentId: 'a1' }), /시술 또는 판매 상품/);
});

test('metadata correction preserves line snapshots, material consumption and original payment event date', () => {
  const original = frozen(sale());
  const corrected = apply(original, 'payment.correct', { id: original.transactions[0].id, staffId: 's2', method: 'cash', reference: '', reason: '담당 직원과 결제 수단 오기입' }, { ...ctx, today: '2026-10-06', now: '2026-10-06T02:00:00Z' });
  assert.deepEqual(corrected.items, original.items);
  assert.deepEqual(corrected.logs, original.logs);
  assert.deepEqual(corrected.transactions[0].lines, original.transactions[0].lines);
  assert.equal(corrected.transactions[0].date, '2026-10-05');
  assert.equal(corrected.transactions[0].staffId, 's2');
  assert.equal(corrected.transactions[0].changes.length, 1);
  assert.throws(() => apply(original, 'payment.correct', { id: original.transactions[0].id, total: 0, reason: '금액 변경' }), /담당 직원·결제 수단/);
  assert.throws(() => apply(original, 'payment.correct', { id: original.transactions[0].id, method: 'cash' }), /정정 사유/);
});

test('successive partial refunds apportion discounts and add to the exact original total', () => {
  const sold = sale(fixture(), { lines: [{ type: 'product', refId: 'shampoo', quantity: 3, unitPrice: 1000 }], discount: 1000 });
  const lineId = sold.transactions[0].lines[0].id;
  const first = refund(sold, [{ lineId, quantity: 1, restock: true }]);
  const second = refund(first, [{ lineId, quantity: 1, restock: false }]);
  const final = refund(second, [{ lineId, quantity: 1, restock: true }]);
  assert.deepEqual(final.refunds.map((entry) => entry.amount), [666, 667, 667]);
  assert.equal(first.transactions[0].status, 'partially_refunded');
  assert.equal(final.transactions[0].status, 'refunded');
  assert.equal(final.items[1].qty, 9);
  assert.equal(final.refunds.reduce((sum, entry) => sum + entry.amount, 0), sold.transactions[0].total);
  assert.throws(() => refund(final, [{ lineId, quantity: 1, restock: true }]), { code: 'ALREADY_REFUNDED', status: 409 });
});

test('refund remaining limits and duplicate lines are enforced without restoring consumed service materials', () => {
  const sold = sale();
  const [serviceLine, productLine] = sold.transactions[0].lines;
  const first = refund(sold, [{ lineId: serviceLine.id, quantity: 1, restock: false }]);
  assert.equal(first.items[0].qty, 140);
  assert.equal(first.logs.length, sold.logs.length);
  assert.throws(() => refund(first, [{ lineId: serviceLine.id, quantity: 1 }]), { code: 'REFUND_EXCEEDS_REMAINING', status: 409 });
  assert.throws(() => refund(sold, [{ lineId: productLine.id, quantity: 1 }, { lineId: productLine.id, quantity: 1 }]), /중복/);
  assert.throws(() => refund(sold, [{ lineId: serviceLine.id, quantity: 1, restock: true }]), /자동 복원/);
  assert.throws(() => refund(sold, [{ lineId: productLine.id, quantity: 0 }]), /0보다/);
  assert.equal(sold.items[0].qty, 140);
});

test('settlement records refunds on refund date and original sale survives in historical reports', () => {
  const sold = sale(fixture(), { lines: [{ type: 'product', refId: 'shampoo', quantity: 1 }], discount: 0 });
  const result = refund(sold, [{ lineId: sold.transactions[0].lines[0].id, quantity: 1, restock: false }], { method: 'transfer' }, { ...ctx, today: '2026-10-08', now: '2026-10-08T03:00:00Z' });
  const saleReport = getReport(result, { from: '2026-10-05', to: '2026-10-05' });
  assert.deepEqual([saleReport.gross, saleReport.refunds, saleReport.net, saleReport.count], [10000, 0, 10000, 1]);
  const refundReport = getReport(result, { from: '2026-10-08', to: '2026-10-08' });
  assert.deepEqual([refundReport.gross, refundReport.refunds, refundReport.net, refundReport.count], [0, 10000, -10000, 0]);
  assert.equal(refundReport.byMethod.find((entry) => entry.method === 'transfer').net, -10000);
  assert.equal(refundReport.byStaff[0].total, -10000);
  const all = getReport(result, { from: '2026-10-05', to: '2026-10-08' });
  assert.equal(all.net, 0);
  assert.equal(all.daily.length, 4);
  assert.equal(all.daily[1].net, 0);
  assert.equal(getReport(result, { from: '2026-10-05', to: '2026-10-08', staffId: 's2' }).net, 0);
});

test('service date is separate from payment date and invalid/future appointment settlements are rejected', () => {
  const input = fixture();
  input.appointments[0].date = '2026-10-01';
  input.staff[0].status = 'inactive';
  const result = sale(input, { appointmentId: 'a1' });
  assert.equal(result.transactions[0].serviceDate, '2026-10-01');
  assert.equal(result.transactions[0].date, ctx.today);
  assert.throws(() => sale(fixture(), { serviceDate: '2026-10-06' }), /오늘 또는 이전/);
  assert.throws(() => sale(fixture(), { serviceDate: '2026-02-30' }), /시술일/);
  assert.throws(() => sale(fixture(), { appointmentId: 'a1', staffId: 's2' }), /담당 직원/);
  input.appointments[0].status = 'cancelled';
  assert.throws(() => sale(input, { appointmentId: 'a1' }), /취소 또는 노쇼/);
});

test('discount allocation is deterministic on ties, handles zero totals and large exact won arithmetic', () => {
  let sold = sale(fixture(), { lines: [{ type: 'service', refId: 'sv2', quantity: 1, unitPrice: 1 }, { type: 'service', refId: 'sv2', quantity: 1, unitPrice: 1 }, { type: 'service', refId: 'sv2', quantity: 1, unitPrice: 1 }], discount: 2 });
  assert.deepEqual(sold.transactions[0].lines.map((line) => line.discount), [1, 1, 0]);
  sold = sale(fixture(), { lines: [{ type: 'service', refId: 'sv2', quantity: 1, unitPrice: 0 }], discount: 0 });
  assert.equal(sold.transactions[0].total, 0);
  const refunded = refund(sold, [{ lineId: sold.transactions[0].lines[0].id, quantity: 1 }]);
  assert.equal(refunded.transactions[0].status, 'refunded');
  sold = sale(fixture(), { lines: [{ type: 'service', refId: 'sv2', quantity: 1, unitPrice: 499999999999 }, { type: 'service', refId: 'sv2', quantity: 1, unitPrice: 500000000000 }], discount: 333333333333 });
  assert.equal(sold.transactions[0].lines.reduce((sum, line) => sum + line.discount, 0), 333333333333);
  assert.equal(sold.transactions[0].total, 666666666666);
});

test('invalid money, quantity, kind, catalog, method and privilege inputs cannot write commerce data', () => {
  const data = frozen(fixture());
  for (const discount of [-1, 0.2, Infinity, NaN, true, '1e3', {}, 1_000_000_000_001, 70001]) assert.throws(() => sale(data, { discount }));
  for (const count of [-1, 0, 0.1, '1e3', true]) assert.throws(() => sale(data, { lines: [{ type: 'product', refId: 'shampoo', quantity: count }] }));
  assert.throws(() => sale(data, { method: 'credit' }), /결제 수단/);
  assert.throws(() => sale(data, { lines: [{ type: 'product', refId: 'dye', quantity: 1 }] }), /판매 상품/);
  assert.throws(() => apply(data, 'payment.create', pay(), { ...ctx, actor: { ...ctx.actor, role: 'designer' } }), { code: 'FORBIDDEN', status: 403 });
  assert.throws(() => apply(data, 'inventory.item', { name: '품목' }, { ...ctx, actor: { ...ctx.actor, role: 'reception' } }), { code: 'FORBIDDEN', status: 403 });
  assert.throws(() => apply(data, 'payment.unknown', {}, ctx), { code: 'UNKNOWN_ACTION', status: 400 });
  assert.equal(data.transactions.length, 0);
});

test('fractional ml product sale and refunds preserve thousandths and exact paid won', () => {
  const sold = sale(fixture(), { lines: [{ type: 'product', refId: 'bulk', quantity: 0.333, unitPrice: 1000 }], discount: 1 });
  assert.equal(sold.transactions[0].total, 332);
  assert.equal(sold.items[2].qty, 199.667);
  const lineId = sold.transactions[0].lines[0].id;
  const partial = refund(sold, [{ lineId, quantity: 0.1, restock: true }]);
  const complete = refund(partial, [{ lineId, quantity: 0.233, restock: true }]);
  assert.deepEqual(complete.refunds.map((entry) => entry.amount), [99, 233]);
  assert.equal(complete.items[2].qty, 200);
});

test('inventory commands authenticate actor, namespace retries, and show Seoul times independent of host timezone', () => {
  const input = frozen(fixture());
  const payload = { itemId: 'shampoo', qty: 3, date: '2026-10-04', memo: '수동 입고', token: 'spoofed-client-token', actorId: 'spoofed' };
  const result = apply(input, 'inventory.receipt', payload);
  assert.equal(result.items[1].qty, 13);
  assert.equal(result.receipts[0].actorId, ctx.actor.id);
  assert.equal(result.receipts[0].token, `${ctx.actor.id}:${ctx.requestId}`);
  assert.equal(result.logs[0].dt, '2026-10-04 10:15');
  assert.deepEqual(apply(result, 'inventory.receipt', payload), result);
  const other = apply(result, 'inventory.receipt', payload, { ...ctx, actor: { ...ctx.actor, id: 'other-user' } });
  assert.equal(other.items[1].qty, 16);
  const corrected = apply(result, 'inventory.correct', { receiptId: result.receipts[0].id, qty: 4, expectedRevision: 0, reason: '수량 정정' }, { ...ctx, requestId: 'request-2' });
  assert.equal(corrected.items[1].qty, 14);
  assert.equal(corrected.receipts[0].revision, 1);
  assert.throws(() => apply(corrected, 'inventory.cancel', { receiptId: result.receipts[0].id, expectedRevision: 0, reason: '취소' }, { ...ctx, requestId: 'request-3' }), /변경되었습니다/);
  const cancelled = apply(corrected, 'inventory.cancel', { receiptId: result.receipts[0].id, expectedRevision: 1, reason: '취소' }, { ...ctx, requestId: 'request-3' });
  assert.equal(cancelled.items[1].qty, 10);
});

test('catalog creation starts at zero and blocks accidental unit conversions, duplicate names and linked material deactivation', () => {
  const data = fixture();
  const payload = { name: '새 상품', kind: '판매 상품', unit: '개', min: 3, price: 10000, active: true };
  const added = apply(data, 'inventory.item', payload);
  assert.equal(added.items.at(-1).qty, 0);
  assert.throws(() => apply(data, 'inventory.item', { ...payload, qty: 100 }), /현재 재고/);
  assert.throws(() => apply(added, 'inventory.item', payload), /이미 등록된/);
  assert.throws(() => apply(data, 'inventory.item', { ...data.items[1], qty: undefined, unit: 'g' }), /현재 재고/);
  const { qty, ...item } = data.items[1];
  assert.throws(() => apply(data, 'inventory.item', { ...item, unit: 'g' }), /분류·단위/);
  const threshold = apply(data, 'inventory.item', { ...item, min: 5 });
  assert.equal(threshold.items[1].qty, qty);
  assert.equal(threshold.logs.at(-1).beforeMin, 3);
  assert.equal(threshold.logs.at(-1).afterMin, 5);
  const { qty: oldQty, ...material } = data.items[0];
  assert.throws(() => apply(data, 'inventory.item', { ...material, active: false }), /시술의 재료 설정/);
});

test('reports reject invalid ranges and return copies safe for downstream consumers', () => {
  const data = sale();
  assert.throws(() => getReport(data, { from: '2026-02-30', to: '2026-10-05' }), /시작일/);
  assert.throws(() => getReport(data, { from: '2026-10-06', to: '2026-10-05' }), /늦을 수/);
  assert.throws(() => getReport(data, { from: '2020-01-01', to: '2026-10-05' }), /367일/);
  const report = getReport(data, { from: '2026-10-05', to: '2026-10-05' });
  report.transactions[0].total = 0;
  assert.equal(data.transactions[0].total, 69000);
});
