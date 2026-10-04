const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const inventory = require('../src/inventory.js');

const ctx = { today: '2026-10-05', at: '2026-10-05T01:15:00.000Z', actorId: 's1', actorName: '김민지' };
function fixture() {
  return {
    items: [
      { id: 'shampoo', name: '샴푸', qty: 2, min: 3, unit: '개' },
      { id: 'dye', name: '염색 약제', qty: 200, min: 150, unit: 'g' },
      { id: 'perm', name: '펌 약제', qty: 0.2, min: 0.3, unit: 'ml' }
    ],
    logs: [], orders: [], seq: { l: 1, t: 20 }, customers: [{ id: 'customer1', name: '기존 고객' }]
  };
}
function receiptForm(overrides) {
  return Object.assign({ itemId: 'shampoo', qty: '10', date: '2026-10-05', memo: '직접 구매', token: 'receipt-1' }, overrides);
}
function withReceipt(data = fixture(), overrides) { return inventory.addReceipt(data, receiptForm(overrides), ctx); }
function deepFreeze(value) {
  Object.freeze(value);
  Object.values(value).forEach(child => { if (child && typeof child === 'object') deepFreeze(child); });
  return value;
}

test('browser and CommonJS expose the same inventory API without runtime dependencies', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/inventory.js'), 'utf8'), sandbox);
  assert.deepEqual(Object.keys(sandbox.SalonInventory).sort(), Object.keys(inventory).sort());
  assert.equal(sandbox.SalonInventory.stockStatus({ qty: 3, min: 3 }), '보충 필요');
});

test('alerts include equality, and zero stock is sold out even with a zero threshold', () => {
  assert.equal(inventory.stockStatus({ qty: 4, min: 3 }), '정상');
  assert.equal(inventory.stockStatus({ qty: 3, min: 3 }), '보충 필요');
  assert.equal(inventory.stockStatus({ qty: 2, min: 3 }), '보충 필요');
  assert.equal(inventory.stockStatus({ qty: 0, min: 3 }), '품절');
  assert.equal(inventory.stockStatus({ qty: 0, min: 0 }), '품절');
  assert.equal(inventory.stockStatus({ qty: 1, min: 0 }), '정상');
});

test('quantity validation preserves allowed decimals and rejects ambiguous, negative and nonfinite inputs', () => {
  const bottle = { unit: '개' }, grams = { unit: 'g' };
  assert.equal(inventory.parseQuantity('10', bottle), 10);
  assert.equal(inventory.parseQuantity(' 0.125 ', grams), 0.125);
  assert.equal(inventory.parseQuantity(0.001, { unit: 'ml' }), 0.001);
  assert.equal(inventory.parseQuantity('0', grams, { allowZero: true }), 0);
  for (const input of ['', ' ', '-1', '+1', '10개', '1,000', '1e2', 'NaN', 'Infinity', Infinity, NaN, null, undefined, true, {}, '1000000001']) {
    assert.throws(() => inventory.parseQuantity(input, grams), Error, String(input));
  }
  assert.throws(() => inventory.parseQuantity('0', grams), /0보다/);
  assert.throws(() => inventory.parseQuantity('1.2', bottle), /정수/);
  assert.throws(() => inventory.parseQuantity('1.0001', grams), /셋째/);
  assert.equal(inventory.parseQuantity('1000000000', bottle), 1000000000);
});

test('manual receipt adds 10 to 2, clears the alert and preserves the input and unrelated data', () => {
  const original = deepFreeze(fixture());
  const result = withReceipt(original);
  assert.equal(original.items[0].qty, 2);
  assert.equal(result.items[0].qty, 12);
  assert.equal(inventory.stockStatus(result.items[0]), '정상');
  assert.deepEqual(result.customers, original.customers);
  assert.equal(result.seq.t, 20);
  assert.equal(result.receipts.length, 1);
  const receipt = result.receipts[0];
  assert.equal(receipt.qty, 10);
  assert.equal(receipt.date, ctx.today);
  assert.equal(receipt.actorId, 's1');
  assert.equal(receipt.actorName, '김민지');
  assert.equal(receipt.status, 'active');
  assert.equal(receipt.revision, 0);
  assert.equal(receipt.changes[0].beforeStock, 2);
  assert.equal(receipt.changes[0].afterStock, 12);
  assert.equal(result.logs[0].delta, 10);
  assert.equal(result.logs[0].after, 12);
  assert.equal(result.logs[0].receiptId, receipt.id);
  assert.equal(result.logs[0].actorName, ctx.actorName);
});

test('receipt at exactly the threshold keeps the replenishment alert', () => {
  const result = withReceipt(fixture(), { qty: '1' });
  assert.equal(result.items[0].qty, 3);
  assert.equal(inventory.stockStatus(result.items[0]), '보충 필요');
});

test('g/ml receipt arithmetic rounds to supported precision', () => {
  const result = withReceipt(fixture(), { itemId: 'perm', qty: '0.1' });
  assert.equal(result.items[2].qty, 0.3);
  assert.equal(inventory.stockStatus(result.items[2]), '보충 필요');
  const next = inventory.correctReceipt(result, {
    receiptId: result.receipts[0].id, qty: '0.101', reason: '실측 정정', expectedRevision: 0, token: 'correct-decimal'
  }, ctx);
  assert.equal(next.items[2].qty, 0.301);
  assert.equal(next.logs[1].delta, 0.001);
});

test('receipt validates calendar dates, future dates, actor, item and operation token', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-10-06', '2026-1-5', '', '2026-00-01']) {
    assert.throws(() => withReceipt(fixture(), { date }), /입고일/, date);
  }
  assert.equal(withReceipt(fixture(), { date: '2024-02-29' }).receipts[0].date, '2024-02-29');
  assert.throws(() => withReceipt(fixture(), { itemId: 'missing' }), /품목/);
  assert.throws(() => withReceipt(fixture(), { token: '' }), /요청/);
  assert.throws(() => inventory.addReceipt(fixture(), receiptForm(), { ...ctx, actorName: '' }), /직원/);
  assert.throws(() => inventory.addReceipt(fixture(), receiptForm(), { ...ctx, today: '2026-02-29' }), /날짜/);
  assert.throws(() => inventory.addReceipt(fixture(), receiptForm(), { ...ctx, at: 'not a date' }), /날짜/);
});

test('receipt correction applies only the delta after stock has been consumed', () => {
  const prior = withReceipt();
  prior.items[0].qty = 9; // 3 were used since the 10-unit receipt.
  deepFreeze(prior);
  const result = inventory.correctReceipt(prior, {
    receiptId: prior.receipts[0].id, qty: '8', reason: '실제 입고는 8개', expectedRevision: 0, token: 'correct-1'
  }, ctx);
  assert.equal(prior.items[0].qty, 9);
  assert.equal(result.items[0].qty, 7);
  assert.equal(result.receipts[0].qty, 8);
  assert.equal(result.receipts[0].revision, 1);
  assert.equal(result.receipts[0].actorName, ctx.actorName);
  assert.equal(result.receipts[0].changes.length, 2);
  assert.equal(result.receipts[0].changes[1].beforeQty, 10);
  assert.equal(result.receipts[0].changes[1].afterQty, 8);
  assert.equal(result.receipts[0].changes[1].delta, -2);
  assert.equal(result.logs[1].after, 7);
  assert.equal(result.logs[1].kind, '입고 정정');
});

test('correction rejects stale edits, absent reasons, no changes and unavailable stock', () => {
  const prior = withReceipt();
  const form = { receiptId: prior.receipts[0].id, qty: '8', reason: '수량 정정', expectedRevision: 0, token: 'correct-1' };
  assert.throws(() => inventory.correctReceipt(prior, { ...form, expectedRevision: 1 }, ctx), /변경되었습니다/);
  assert.throws(() => inventory.correctReceipt(prior, { ...form, expectedRevision: undefined }, ctx), /변경되었습니다/);
  assert.throws(() => inventory.correctReceipt(prior, { ...form, reason: ' ' }, ctx), /사유/);
  assert.throws(() => inventory.correctReceipt(prior, { ...form, qty: '10' }, ctx), /같습니다/);
  assert.throws(() => inventory.correctReceipt(prior, { ...form, qty: '0' }, ctx), /0보다/);
  assert.throws(() => inventory.correctReceipt(prior, { ...form, receiptId: 'missing' }, ctx), /내역/);
  prior.items[0].qty = 1;
  const snapshot = structuredClone(prior);
  assert.throws(() => inventory.correctReceipt(prior, form, ctx), /음수/);
  assert.deepEqual(prior, snapshot);
});

test('cancellation removes the corrected receipt quantity, retains its record and appends audit history', () => {
  const prior = withReceipt();
  const corrected = inventory.correctReceipt(prior, {
    receiptId: prior.receipts[0].id, qty: '8', reason: '수량 정정', expectedRevision: 0, token: 'correct-1'
  }, ctx);
  corrected.items[0].qty = 9; // 1 used, leaving original 2 + receipt 8 - use 1.
  const form = { receiptId: corrected.receipts[0].id, reason: '잘못 등록한 입고', expectedRevision: 1, token: 'cancel-1' };
  const result = inventory.cancelReceipt(corrected, form, { ...ctx, actorId: 's2', actorName: '박지수' });
  assert.equal(result.items[0].qty, 1);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0].qty, 8);
  assert.equal(result.receipts[0].status, 'cancelled');
  assert.equal(result.receipts[0].revision, 2);
  assert.equal(result.receipts[0].changes.length, 3);
  assert.equal(result.receipts[0].changes[2].actorName, '박지수');
  assert.equal(result.logs[2].delta, -8);
  assert.equal(result.logs[2].kind, '입고 취소');
  assert.throws(() => inventory.cancelReceipt(result, { ...form, expectedRevision: 2, token: 'cancel-again' }, ctx), /취소된/);
  assert.throws(() => inventory.correctReceipt(result, { ...form, qty: '5', expectedRevision: 2, token: 'correct-after-cancel' }, ctx), /취소된/);
});

test('cancellation is rejected if the removed receipt would make current stock negative', () => {
  const prior = withReceipt();
  prior.items[0].qty = 9;
  const snapshot = structuredClone(prior);
  assert.throws(() => inventory.cancelReceipt(prior, {
    receiptId: prior.receipts[0].id, reason: '입력 오류', expectedRevision: 0, token: 'cancel-1'
  }, ctx), /음수/);
  assert.deepEqual(prior, snapshot);
});

test('threshold changes preserve stock, allow zero and record old and new thresholds', () => {
  const original = deepFreeze(fixture());
  const result = inventory.setThreshold(original, { itemId: 'shampoo', qty: '0', token: 'threshold-1' }, ctx);
  assert.equal(result.items[0].qty, 2);
  assert.equal(result.items[0].min, 0);
  assert.equal(inventory.stockStatus(result.items[0]), '정상');
  assert.equal(result.logs[0].delta, 0);
  assert.equal(result.logs[0].beforeMin, 3);
  assert.equal(result.logs[0].afterMin, 0);
  assert.equal(result.logs[0].kind, '기준 변경');
  const raised = inventory.setThreshold(result, { itemId: 'shampoo', qty: '2', token: 'threshold-2' }, ctx);
  assert.equal(inventory.stockStatus(raised.items[0]), '보충 필요');
  assert.throws(() => inventory.setThreshold(result, { itemId: 'shampoo', qty: '-1', token: 'threshold-invalid' }, ctx), /수량/);
});

test('stock adjustment uses the counted total, accepts zero and requires a reason', () => {
  const form = { itemId: 'shampoo', qty: '0', reason: '실사 재고 불일치', token: 'adjust-1' };
  const prior = withReceipt();
  const result = inventory.adjustStock(prior, form, ctx);
  assert.equal(result.items[0].qty, 0);
  assert.equal(result.logs[1].delta, -12);
  assert.equal(result.logs[1].reason, form.reason);
  assert.equal(result.receipts[0].qty, 10);
  assert.throws(() => inventory.adjustStock(prior, { ...form, reason: '' }, ctx), /사유/);
  assert.throws(() => inventory.adjustStock(prior, { ...form, qty: '-1' }, ctx), /수량/);
  assert.throws(() => inventory.adjustStock(prior, { ...form, qty: '12' }, ctx), /같습니다/);
});

test('receipt retries do not double stock or history; tokens cannot be reused for a different payload', () => {
  const prior = withReceipt();
  const result = inventory.addReceipt(deepFreeze(prior), receiptForm(), ctx);
  assert.deepEqual(result, prior);
  assert.notEqual(result, prior);
  assert.throws(() => inventory.addReceipt(prior, receiptForm({ qty: '20' }), ctx), /이미 사용한/);
  assert.throws(() => inventory.adjustStock(prior, { itemId: 'shampoo', qty: '0', reason: '실사', token: 'receipt-1' }, ctx), /이미 사용한/);
});

test('all inventory mutations are idempotent, including stale retry revisions after successful saves', () => {
  let data = withReceipt();
  const receiptId = data.receipts[0].id;
  const operations = [
    ['correctReceipt', { receiptId, qty: '9', reason: '입력 정정', expectedRevision: 0, token: 'correct-1' }],
    ['setThreshold', { itemId: 'shampoo', qty: '0', token: 'threshold-1' }],
    ['adjustStock', { itemId: 'shampoo', qty: '20', reason: '실사', token: 'adjust-1' }],
    ['cancelReceipt', { receiptId, reason: '중복 입력 취소', expectedRevision: 1, token: 'cancel-1' }]
  ];
  for (const [name, form] of operations) {
    data = inventory[name](data, form, ctx);
    const retry = inventory[name](deepFreeze(data), form, ctx);
    assert.deepEqual(retry, data, name);
  }
  assert.equal(data.inventoryOperations.length, 5);
  assert.equal(data.logs.length, 5);
});

test('completed legacy orders migrate once without replaying stock or logs; pending orders stay separate', () => {
  const prior = fixture();
  prior.orders = [
    { id: 'O0001', itemId: 'shampoo', qty: 10, date: '2026-09-28', recvDate: '2026-10-01', status: '입고 완료', memo: '기존 완료' },
    { id: 'O0002', itemId: 'dye', qty: 500, date: '2026-10-03', recvDate: '', status: '발주 중' }
  ];
  prior.logs = [{ id: 'L1', dt: '2026-10-01 11:00', itemId: 'shampoo', kind: '입고', delta: 10, after: 12, ref: 'O0001' }];
  const snapshot = structuredClone(prior);
  const result = inventory.normalize(deepFreeze(prior));
  assert.deepEqual(prior, snapshot);
  assert.deepEqual(result.items, prior.items);
  assert.deepEqual(result.logs, prior.logs);
  assert.deepEqual(result.orders, prior.orders);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0].date, '2026-10-01');
  assert.equal(result.receipts[0].legacyOrderId, 'O0001');
  assert.equal(result.receipts[0].status, 'active');
  assert.equal(result.receipts[0].actorName, '기존 기록 (담당자 미기록)');
  assert.deepEqual(inventory.normalize(result), result);
  const receiptId = result.receipts[0].id;
  result.items[0].qty = 20;
  const cancelled = inventory.cancelReceipt(result, { receiptId, expectedRevision: 0, reason: '기존 입력 취소', token: 'legacy-cancel' }, ctx);
  assert.equal(inventory.normalize(cancelled).receipts.length, 1);
  assert.equal(inventory.normalize(cancelled).receipts[0].status, 'cancelled');
  assert.equal(inventory.normalize(cancelled).items[0].qty, 10);
});

test('receipt and log IDs do not collide with existing records or stale counters', () => {
  const prior = withReceipt();
  prior.seq.receipt = 1;
  prior.seq.l = 1;
  const result = withReceipt(prior, { token: 'receipt-2' });
  assert.equal(new Set(result.receipts.map(row => row.id)).size, 2);
  assert.equal(new Set(result.logs.map(row => row.id)).size, 2);
});

test('receipt addition rejects overflow without modifying the original data', () => {
  const prior = fixture();
  prior.items[0].qty = 1000000000;
  const snapshot = structuredClone(prior);
  assert.throws(() => withReceipt(prior, { qty: '1' }), /10억/);
  assert.deepEqual(prior, snapshot);
});


test('numeric legacy stock fields are converted before addition, preventing string concatenation', () => {
  const prior = fixture();
  prior.items[0].qty = '2';
  prior.items[0].min = '10';
  assert.equal(inventory.stockStatus(prior.items[0]), '보충 필요');
  const result = withReceipt(prior);
  assert.equal(result.items[0].qty, 12);
  assert.equal(prior.items[0].qty, '2');
});


test('legacy receipt audit retains the recorded incoming time and does not invent a time when absent', () => {
  const prior = fixture();
  prior.orders = [
    { id: 'O1', itemId: 'shampoo', qty: 10, recvDate: '2026-10-01', status: '입고 완료' },
    { id: 'O2', itemId: 'dye', qty: 500, recvDate: '2026-10-02', status: '입고 완료' }
  ];
  prior.logs = [{ id: 'L1', dt: '2026-10-01 15:42', itemId: 'shampoo', kind: '입고', delta: 10, after: 12, ref: 'O1' }];
  const result = inventory.normalize(prior);
  assert.equal(result.receipts[0].changes[0].at, '2026-10-01T15:42');
  assert.equal(result.receipts[1].changes[0].at, '2026-10-02');
  assert.deepEqual(result.logs, prior.logs);
});
