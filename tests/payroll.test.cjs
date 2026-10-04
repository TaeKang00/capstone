const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPayroll, getPayrollRevenue } = require('../server/payroll.cjs');
const ctx = { actor: { id: 'owner', name: '원장', role: 'owner', staffId: 's1' }, today: '2026-10-05', now: '2026-10-05T00:00:00Z' };
function data() {
  return { store: { name: '살롱', phone: '02-123-4567', address: '서울' }, staff: [{ id: 's1', name: '민지', role: 'designer' }], payroll: [], transactions: [
    { id: 't1', date: '2026-09-01', staffId: 's1', lines: [{ id: 'service1', type: 'service', total: 90000 }, { id: 'product1', type: 'product', total: 50000 }] },
    { id: 't2', date: '2026-08-30', staffId: 's1', lines: [{ id: 'service2', type: 'service', total: 60000 }] },
    { id: 't3', date: '2026-09-01', staffId: 's2', lines: [{ id: 'service3', type: 'service', total: 500000 }] },
  ], refunds: [
    { id: 'r1', transactionId: 't1', date: '2026-09-04', lines: [{ lineId: 'service1', amount: 10000 }, { lineId: 'product1', amount: 50000 }] },
    { id: 'r2', transactionId: 't2', date: '2026-09-04', lines: [{ lineId: 'service2', amount: 20000 }] },
    { id: 'r3', transactionId: 't1', date: '2026-10-01', lines: [{ lineId: 'service1', amount: 10000 }] },
  ] };
}
const form = { staffId: 's1', month: '2026-09', payDate: '2026-10-05', basePay: 2000000, commissionRate: 10, allowances: [{ name: '식대', amount: 100000 }], deductions: [{ name: '수동 공제', amount: 80000 }], workDays: 20, workHours: 160, overtimeHours: 2, basis: '기본급 월 정액, 식대 월 정액', notes: '' };
function saved() { return applyPayroll(data(), 'payroll.save', form, ctx); }
test('시술만 포함하고 할인 후 매출과 환불 발생 월을 반영한다', () => {
  const revenue = getPayrollRevenue(data(), 's1', '2026-09');
  assert.equal(revenue.gross, 90000); assert.equal(revenue.refunded, 30000); assert.equal(revenue.net, 60000);
  assert.equal(revenue.sales.length, 1); assert.equal(revenue.refunds.length, 2);
});
test('급여를 정수 원으로 산출하며 원본 상태를 변경하지 않는다', () => {
  const original = data(), result = applyPayroll(original, 'payroll.save', form, ctx), record = result.payroll[0];
  assert.equal(original.payroll.length, 0); assert.equal(record.commission, 6000); assert.equal(record.earningsTotal, 2106000); assert.equal(record.netPay, 2026000);
  assert.equal(record.staffSnapshot.name, '민지'); assert.equal(record.status, 'draft');
});
test('직원·귀속월 중복 생성과 초과 공제를 거부한다', () => {
  assert.throws(() => applyPayroll(saved(), 'payroll.save', form, ctx), error => error.status === 409);
  assert.throws(() => applyPayroll(data(), 'payroll.save', { ...form, deductions: [{ name: '공제', amount: 9999999 }] }, ctx), /공제 합계/);
});
test('미래 월 확정, 잘못된 날짜, 음수와 과도한 비율·시간을 거부한다', () => {
  for (const patch of [{ month: '2026-13' }, { payDate: '2026-02-30' }, { basePay: -1 }, { commissionRate: 100.01 }, { commissionRate: 0.001 }, { workDays: 32 }, { workHours: 1, overtimeHours: 2 }]) {
    assert.throws(() => applyPayroll(data(), 'payroll.save', { ...form, ...patch }, ctx));
  }
  const future = applyPayroll(data(), 'payroll.save', { ...form, month: '2026-11', payDate: '2026-12-05' }, ctx);
  assert.throws(() => applyPayroll(future, 'payroll.finalize', { id: future.payroll[0].id }, ctx), /미래 월/);
});
test('확정 시 최신 매출을 다시 계산하고 지급 후 금액은 고정한다', () => {
  const draft = saved(), id = draft.payroll[0].id;
  draft.transactions[0].lines[0].total = 190000;
  const finalized = applyPayroll(draft, 'payroll.finalize', { id }, ctx);
  assert.equal(finalized.payroll[0].commission, 16000);
  assert.throws(() => applyPayroll(finalized, 'payroll.save', { ...form, id }, ctx), /수정할 수 없습니다/);
  finalized.transactions[0].lines[0].total = 900000;
  finalized.staff[0].name = '변경된 이름';
  const paid = applyPayroll(finalized, 'payroll.paid', { id, paidDate: '2026-10-05' }, ctx);
  assert.equal(paid.payroll[0].commission, 16000); assert.equal(paid.payroll[0].staffSnapshot.name, '민지'); assert.equal(paid.payroll[0].status, 'paid');
  assert.throws(() => applyPayroll(paid, 'payroll.reopen', { id, reason: '수정' }, ctx), /지급 전/);
});
test('사유 있는 확정 취소가 감사 스냅샷을 보존한다', () => {
  const draft = saved(), id = draft.payroll[0].id, final = applyPayroll(draft, 'payroll.finalize', { id }, ctx);
  assert.throws(() => applyPayroll(final, 'payroll.reopen', { id, reason: '' }, ctx));
  const reopened = applyPayroll(final, 'payroll.reopen', { id, reason: '식대 수정' }, ctx);
  const edited = applyPayroll(reopened, 'payroll.save', { ...form, id, allowances: [] }, ctx);
  assert.equal(edited.payroll[0].status, 'draft'); assert.equal(edited.payroll[0].changes.find(change => change.kind === 'finalized').snapshot.allowanceTotal, 100000);
});
test('미래 지급일과 초안 지급을 차단한다', () => {
  const draft = saved(), id = draft.payroll[0].id;
  assert.throws(() => applyPayroll(draft, 'payroll.paid', { id, paidDate: '2026-10-05' }, ctx));
  const final = applyPayroll(draft, 'payroll.finalize', { id }, ctx);
  assert.throws(() => applyPayroll(final, 'payroll.paid', { id, paidDate: '2026-10-06' }, ctx), /실제 지급일/);
});
test('매출보다 많은 당월 환불은 인센티브 0원으로 계산한다', () => {
  const next = applyPayroll(data(), 'payroll.save', { ...form, month: '2026-10', payDate: '2026-10-05' }, ctx);
  assert.equal(next.payroll[0].revenue.net, -10000); assert.equal(next.payroll[0].commission, 0);
});
test('권한 없는 직원의 모든 급여 변경을 거부한다', () => {
  for (const role of ['designer', 'reception']) assert.throws(() => applyPayroll(data(), 'payroll.save', form, { ...ctx, actor: { ...ctx.actor, role } }), error => error.status === 403);
});
test('정밀도를 잃을 금액 합계는 거부한다', () => {
  assert.throws(() => applyPayroll(data(), 'payroll.save', { ...form, basePay: Number.MAX_SAFE_INTEGER }, ctx), /합계 금액/);
});

test('확정 이력이 있는 명세서의 직원 변경으로 이전 직원 급여가 유출되지 않는다', () => {
  const draft = saved(), id = draft.payroll[0].id;
  draft.staff.push({ id: 's2', name: '수진', role: 'designer' });
  const final = applyPayroll(draft, 'payroll.finalize', { id }, ctx);
  const reopened = applyPayroll(final, 'payroll.reopen', { id, reason: '공제 수정' }, ctx);
  assert.throws(() => applyPayroll(reopened, 'payroll.save', { ...form, id, staffId: 's2' }, ctx), error => error.code === 'PAYROLL_IDENTITY_LOCKED');
  assert.throws(() => applyPayroll(reopened, 'payroll.save', { ...form, id, month: '2026-08' }, ctx), error => error.code === 'PAYROLL_IDENTITY_LOCKED');
});
