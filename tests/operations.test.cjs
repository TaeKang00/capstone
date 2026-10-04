'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, applyOperation } = require('../server/operations.cjs');

const owner = { actor: { id: 'user-owner', name: '원장', role: 'owner', staffId: 'staff-owner' }, today: '2026-10-05', now: '2026-10-05T03:00:00.000Z', requestId: 'request' };
const designer = { ...owner, actor: { id: 'user-designer', name: '디자이너', role: 'designer', staffId: 'staff-designer' } };
const call = (data, type, payload, ctx = owner) => applyOperation(data, type, payload, ctx);
function base() {
  const data = initialState({ storeName: '테스트 미용실', ownerName: '원장', ownerStaffId: 'staff-owner' });
  data.staff.push({ ...data.staff[0], id: 'staff-designer', name: '디자이너', role: 'designer' });
  data.services.push({ id: 'cut', name: '커트', price: 20000, duration: 30, materials: [], active: true });
  data.items.push({ id: 'dye', name: '염모제', kind: '시술 재료', unit: 'g', qty: 100, min: 20, price: 0, active: true });
  return data;
}
function appointment(extra = {}) { return { date: '2026-10-05', start: 600, staffId: 'staff-designer', serviceIds: ['cut'], guestName: '방문 고객', guestPhone: '', notes: '', ...extra }; }
function registered(data = base(), extra = {}) { return call(data, 'appointment.save', appointment(extra)); }
function legacy() {
  return {
    store: { name: '이전 매장', open: 600, close: 1200 },
    staff: [{ id: 's1', name: '기존 원장', role: '원장', status: '재직', phone: '010-1234-5678' }],
    items: [{ id: 'i1', name: '약제', kind: '시술 재료', unit: 'g', qty: 72.5, min: 20, price: 0 }, { id: 'i2', name: '샴푸', kind: '판매 상품', unit: '개', qty: 3, min: 1, price: 10000 }],
    services: [{ id: 'v1', name: '염색', price: 20000, dur: 30, mats: [{ itemId: 'i1', amt: 10 }] }],
    customers: [{ id: 'c1', name: '고객', phone: '010-1234-9876', memo: '기존 차트', since: '2026-01-01' }],
    resv: [{ id: 'r1', date: '2026-09-01', start: 600, dur: 30, custId: 'c1', guest: '', phone: '', staffId: 's1', svc: ['v1'], status: '완료', txnId: 'T1', memo: '' }],
    txns: [{ id: 'T1', date: '2026-09-01', time: '10:30', resvId: 'r1', customerId: 'c1', customerName: '고객', staffId: 's1', items: [{ type: 'service', refId: 'v1', name: '염색', price: 20000, alloc: 2000, net: 18000 }, { type: 'product', refId: 'i2', name: '샴푸', price: 10000, alloc: 1000, net: 9000 }], subtotal: 30000, discount: 3000, total: 27000, method: '카드', status: '취소', cancel: { dt: '2026-09-03 11:20', reason: '일부 시술 불만으로 전액 환불', mode: 'refund', restock: true } }],
    orders: [{ id: 'O1', itemId: 'i1', qty: 50, date: '2026-08-01', recvDate: '2026-08-02', status: '입고 완료', memo: '' }, { id: 'O2', itemId: 'i2', qty: 2, date: '2026-08-03', recvDate: '', status: '발주 중', memo: '담당자에게 확인' }],
    logs: [{ id: 'L1', dt: '2026-08-02 10:00', itemId: 'i1', delta: 50, after: 82.5, kind: '입고', ref: 'O1' }], seq: { t: 2, l: 2, o: 3 },
  };
}
const empty = () => initialState({ storeName: '새 매장', ownerName: '원장', ownerStaffId: 'staff-owner' });

test('initial installation contains only owner and no fictional business data', () => {
  const data = empty();
  for (const key of ['appointments', 'services', 'customers', 'transactions', 'refunds', 'items', 'payroll']) assert.deepEqual(data[key], []);
  assert.equal(data.staff[0].role, 'owner');
  assert.equal(data.store.timeZone, 'Asia/Seoul');
});
test('customer changes return a new state and duplicate contact checks use normalized digits', () => {
  const before = base();
  const saved = call(before, 'customer.save', { name: '고객', phone: '010-1234-5678', memo: '메모', warning: '주의' });
  assert.equal(before.customers.length, 0);
  assert.equal(saved.customers[0].warning, '주의');
  assert.throws(() => call(saved, 'customer.save', { name: '다른 이름', phone: '01012345678' }), { code: 'DUPLICATE_PHONE' });
  assert.throws(() => call(before, 'customer.save', { name: '고객', phone: '<script>' }), { status: 422 });
});
test('appointment validates Gregorian date, required guest and service references', () => {
  for (const invalid of [{ date: '2026-02-30' }, { guestName: '' }, { serviceIds: ['missing'] }, { serviceIds: ['cut', 'cut'] }, { duration: -1 }, { start: 1440 }]) assert.throws(() => registered(base(), invalid));
});
test('adjacent appointments are allowed but overlap is rejected without mutating state', () => {
  const first = registered();
  const snapshot = structuredClone(first);
  assert.throws(() => registered(first, { start: 615 }), { code: 'APPOINTMENT_CONFLICT' });
  assert.deepEqual(first, snapshot);
  const adjacent = registered(first, { start: 630 });
  assert.equal(adjacent.appointments.length, 2);
});
test('store days, employee schedules and breaks all constrain bookings', () => {
  const closed = base(); closed.store.closedWeekdays = [1];
  assert.throws(() => registered(closed), /휴무/);
  const off = base(); off.staff[1].workingDays = [2];
  assert.throws(() => registered(off), /근무시간/);
  const pause = base(); pause.staff[1].breakStart = 610; pause.staff[1].breakEnd = 650;
  assert.throws(() => registered(pause), /휴게시간/);
  assert.throws(() => registered(base(), { start: 1190 }), /영업시간/);
});
test('designer cannot assign or modify another designer appointment even by changing staffId', () => {
  assert.equal(call(base(), 'appointment.save', appointment(), designer).appointments.length, 1);
  assert.throws(() => call(base(), 'appointment.save', appointment({ staffId: 'staff-owner' }), designer), { status: 403 });
  const other = registered(base(), { staffId: 'staff-owner' });
  assert.throws(() => call(other, 'appointment.save', appointment({ id: other.appointments[0].id }), designer), { status: 403 });
  assert.throws(() => call(other, 'appointment.status', { id: other.appointments[0].id, status: 'checked_in' }, designer), { status: 403 });
});
test('past unprocessed appointment can progress; future no-show is forbidden', () => {
  const past = registered(base(), { date: '2026-10-04' });
  const advanced = call(past, 'appointment.status', { id: past.appointments[0].id, status: 'in_service' });
  assert.equal(advanced.appointments[0].status, 'in_service');
  const future = registered(base(), { date: '2026-10-06' });
  assert.throws(() => call(future, 'appointment.status', { id: future.appointments[0].id, status: 'no_show', reason: '미방문' }), /미래/);
});
test('cancellations and status reversals require a reason and append actor-stamped audit history', () => {
  const first = registered(), id = first.appointments[0].id;
  assert.throws(() => call(first, 'appointment.status', { id, status: 'cancelled' }), /사유/);
  const cancelled = call(first, 'appointment.status', { id, status: 'cancelled', reason: '고객 요청' });
  assert.equal(cancelled.appointments[0].changes.at(-1).actorId, owner.actor.id);
  assert.throws(() => call(cancelled, 'appointment.status', { id, status: 'booked' }), /사유/);
  const restored = call(cancelled, 'appointment.status', { id, status: 'booked', reason: '고객 재요청' });
  assert.equal(restored.appointments[0].status, 'booked');
});
test('restoring cancelled appointment rechecks collisions and payment cannot be bypassed', () => {
  let data = registered(); const id = data.appointments[0].id;
  data = call(data, 'appointment.status', { id, status: 'cancelled', reason: '요청' });
  data = registered(data);
  assert.throws(() => call(data, 'appointment.status', { id, status: 'booked', reason: '복구' }), { code: 'APPOINTMENT_CONFLICT' });
  assert.throws(() => call(data, 'appointment.status', { id: data.appointments[1].id, status: 'completed' }), { code: 'PAYMENT_REQUIRED' });
  data.appointments[1].transactionId = 'paid-record';
  assert.throws(() => call(data, 'appointment.status', { id: data.appointments[1].id, status: 'cancelled', reason: '취소' }), { code: 'LOCKED' });
  assert.throws(() => call(data, 'appointment.save', appointment({ id: data.appointments[1].id })), { code: 'LOCKED' });
});
test('customer archive retains records but blocks while appointment is open', () => {
  let data = call(base(), 'customer.save', { name: '등록고객' });
  const customerId = data.customers[0].id;
  data = registered(data, { customerId });
  assert.throws(() => call(data, 'customer.archive', { id: customerId, archived: true }), { code: 'ACTIVE_APPOINTMENTS' });
  data = call(data, 'appointment.status', { id: data.appointments[0].id, status: 'cancelled', reason: '고객 요청' });
  data = call(data, 'customer.archive', { id: customerId, archived: true });
  assert.equal(data.customers[0].archived, true);
  assert.equal(data.appointments[0].customerId, customerId);
  assert.throws(() => registered(data, { customerId }), /보관/);
});
test('staff inactivation and schedule changes cannot hide future reserved work', () => {
  const data = registered();
  assert.throws(() => call(data, 'staff.save', { ...data.staff[1], status: 'inactive' }), { code: 'EXISTING_APPOINTMENTS' });
  assert.throws(() => call(data, 'staff.save', { ...data.staff[1], startMinutes: 700 }), { code: 'EXISTING_APPOINTMENTS' });
  const historical = registered(base(), { date: '2026-10-01' });
  const saved = call(historical, 'staff.save', { ...historical.staff[1], status: 'inactive' });
  assert.equal(saved.appointments.length, 1);
  assert.equal(saved.staff[1].status, 'inactive');
});
test('staff configuration rejects invalid breaks, last owner disable, unauthorized promotion', () => {
  const data = base();
  assert.throws(() => call(data, 'staff.save', { ...data.staff[1], breakStart: 660 }), /휴게시간/);
  assert.throws(() => call(data, 'staff.save', { ...data.staff[1], workingDays: [1, 1] }), /중복/);
  assert.throws(() => call(data, 'staff.save', { ...data.staff[0], status: 'inactive' }), { code: 'LAST_OWNER' });
  assert.throws(() => call(data, 'staff.save', { ...data.staff[1], role: 'owner' }, { ...owner, actor: { ...owner.actor, role: 'manager' } }), { status: 403 });
});
test('store changes preserve existing appointments and enforce Seoul timezone', () => {
  const data = registered();
  assert.throws(() => call(data, 'store.save', { ...data.store, open: 660 }), { code: 'EXISTING_APPOINTMENTS' });
  assert.throws(() => call(data, 'store.save', { ...data.store, timeZone: 'UTC' }), { status: 422 });
  assert.equal(call(data, 'store.save', { ...data.store, name: '새 이름' }).store.name, '새 이름');
});
test('service usage validates inventory unit precision and preserves captured appointment duration', () => {
  const data = registered();
  const payload = { ...data.services[0], duration: 60, materials: [{ itemId: 'dye', quantity: 2.123 }] };
  const saved = call(data, 'service.save', payload);
  assert.equal(saved.appointments[0].duration, 30);
  assert.equal(saved.services[0].duration, 60);
  assert.throws(() => call(data, 'service.save', { ...payload, materials: [{ itemId: 'dye', quantity: 2.1234 }] }), { status: 422 });
  assert.throws(() => call(data, 'service.save', { ...payload, price: 1.5 }), { status: 422 });
  assert.throws(() => call(data, 'service.save', payload, designer), { status: 403 });
});
test('legacy import preserves stock exactly, migrates metadata once, and dates refunds correctly', () => {
  const source = legacy(), unchanged = structuredClone(source);
  const data = call(empty(), 'legacy.import', { data: { savedAt: owner.now, data: source } });
  assert.deepEqual(source, unchanged);
  assert.deepEqual(data.items.map(item => item.qty), [72.5, 3]);
  assert.equal(data.receipts.length, 1);
  assert.equal(data.receipts[0].legacyOrderId, 'O1');
  assert.equal(data.refunds[0].date, '2026-09-03');
  assert.equal(data.transactions[0].date, '2026-09-01');
  assert.equal(data.refunds[0].amount, 27000);
  assert.equal(data.refunds[0].lines[0].restock, false);
  assert.equal(data.refunds[0].lines[1].restock, true);
  assert.deepEqual(data.legacyArchive, source);
  assert.equal(data.staff[0].id, 'staff-owner');
  assert.throws(() => call(data, 'legacy.import', { data: source }), { code: 'IMPORT_NOT_EMPTY' });
});
test('legacy import is all-or-nothing and rejects broken financial totals, dates, references and duplicates', () => {
  const original = empty();
  const variants = [
    source => { source.txns[0].total++; },
    source => { source.txns[0].cancel.dt = '2026-02-30 11:20'; },
    source => { source.resv[0].txnId = 'missing'; },
    source => { source.items.push(source.items[0]); },
    source => { source.items[0].qty = -1; },
    source => { source.txns[0].cancel = null; },
    source => { source.resv[0].status = 'unknown'; },
  ];
  for (const mutate of variants) {
    const source = legacy(); mutate(source);
    assert.throws(() => call(original, 'legacy.import', { data: source }));
    assert.deepEqual(original, empty());
  }
  assert.throws(() => call(original, 'legacy.import', { data: legacy() }, designer), { status: 403 });
});
test('unknown action and malformed payload fail without changing source state', () => {
  assert.throws(() => call(base(), 'customer.delete', {}), { status: 400 });
  assert.throws(() => call(base(), 'customer.save', null), { status: 422 });
});
test('legacy pending re-payment is rejected instead of allowing duplicate material usage', () => {
  const source = legacy(); source.txns[0].cancel.mode = 'redo'; source.resv[0].txnId = null; source.resv[0].status = '시술 중';
  assert.throws(() => call(empty(), 'legacy.import', { data: source }), { code: 'LEGACY_PENDING_CORRECTION' });
});
