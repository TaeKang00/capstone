'use strict';
const { test, expect, setupOwner, adminAction, adminState, adminHeaders, openPersonal, state, action, goTo, today } = require('./ux-fixture.cjs');

async function addStaff(page, name) {
  const result = await adminAction(page, 'staff.save', {
    name, phone: '', role: 'designer', status: 'active', workingDays: [0, 1, 2, 3, 4, 5, 6],
    startMinutes: 600, endMinutes: 1200, breakStart: null, breakEnd: null,
  });
  return result.data.staff.find(staff => staff.name === name);
}

function priorMonth() {
  const [year, month] = today().split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

async function priorPayroll(page, staff) {
  const result = await adminAction(page, 'payroll.save', {
    staffId: staff.id, month: priorMonth(), payDate: today(), basePay: 2400000, commissionRate: 10,
    allowances: [{ name: '식대', amount: 200000 }], deductions: [{ name: '확인한 보험료', amount: 100000 }],
    workDays: 20, workHours: 160, overtimeHours: 8, basis: '월 기본급과 확인한 공제', notes: '지난달에만 해당하는 메모',
  });
  const record = result.data.payroll.find(row => row.staffId === staff.id);
  await adminAction(page, 'payroll.finalize', { id: record.id });
  return record;
}

test('직원 정보와 로그인 권한을 구분해 계정을 발급하고 급여로 이동한다', async ({ page }) => {
  await setupOwner(page);
  await goTo(page, '직원 관리');
  await page.getByRole('button', { name: '직원 등록', exact: true }).click();
  const form = page.getByRole('dialog', { name: '직원 등록', exact: true });
  await form.getByLabel('이름', { exact: true }).fill('연속 등록 직원');
  await expect(form.getByRole('button', { name: '저장하고 계정 발급', exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: '직원 저장', exact: true }).click();
  await expect(form).toBeHidden();
  await page.locator('.staff-card').filter({ hasText: '연속 등록 직원' }).getByRole('button', { name: '계정 발급', exact: true }).click();
  const account = page.getByRole('dialog', { name: '계정 발급', exact: true });
  await expect(account).toBeVisible();
  await account.getByLabel('로그인 아이디', { exact: true }).fill('staff.ux@example.test');
  await account.getByLabel('임시 비밀번호', { exact: true }).fill('Staff-temporary-2026!');
  await account.getByRole('button', { name: '계정 발급', exact: true }).click();
  await expect(account).toBeHidden();
  await page.getByLabel('직원 검색', { exact: true }).fill('staff.ux@example.test');
  await expect(page.locator('.staff-card')).toHaveCount(1);
  const staff = (await state(page)).data.staff.find(row => row.name === '연속 등록 직원');
  await page.locator('.staff-card').getByRole('button', { name: '급여 보기', exact: true }).click();
  await expect(page.getByLabel('직원', { exact: true })).toHaveValue(staff.id);
  await page.getByRole('button', { name: '명세서 작성', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('직원', { exact: true })).toHaveValue(staff.id);
});

test('이전 급여 조건을 재사용하되 근태와 메모를 비우고 이번 달 인센티브를 계산한다', async ({ page }) => {
  await setupOwner(page);
  const staff = await addStaff(page, '반복 급여 직원');
  await priorPayroll(page, staff);
  let result = await adminAction(page, 'service.save', { name: '당월 시술', price: 20000, duration: 30, materials: [], active: true });
  const service = result.data.services.find(row => row.name === '당월 시술');
  await action(page, 'payment.create', { guestName: '당월 고객', staffId: staff.id, lines: [{ type: 'service', refId: service.id, quantity: 1 }], discount: 0, method: 'cash', reference: '', notes: '' });
  await page.reload();
  await goTo(page, '급여명세');
  await page.getByRole('button', { name: '명세서 작성', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '명세서 작성', exact: true });
  await dialog.getByLabel('직원', { exact: true }).selectOption(staff.id);
  await dialog.getByLabel('기본급', { exact: true }).fill('100');
  await dialog.getByLabel('명세서 메모', { exact: true }).fill('입력 중 메모');
  await dialog.getByRole('button', { name: '이전 명세서 조건 불러오기', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '이전 급여 조건을 불러올까요?', exact: true });
  await expect(confirm).toContainText('근무일수, 근로시간, 메모는 비워요');
  await confirm.getByRole('button', { name: '조건 불러오기', exact: true }).click();
  await expect(dialog.getByLabel('기본급', { exact: true })).toHaveValue('2400000');
  await expect(dialog.getByLabel('근무일', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('근무 시간', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('명세서 메모', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('추가 지급 1 항목명', { exact: true })).toHaveValue('식대');
  await expect(dialog.getByLabel('공제 1 항목명', { exact: true })).toHaveValue('확인한 보험료');
  await expect(dialog.locator('.payroll-preview')).toContainText('2,502,000');
  await dialog.getByRole('button', { name: '임시 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  result = await adminState(page);
  const record = result.data.payroll.find(row => row.staffId === staff.id && row.month === today().slice(0, 7));
  expect(record.netPay).toBe(2502000);
  expect(record.commission).toBe(2000);
  expect(record.workDays).toBeNull();
  expect(record.notes).toBe('');
  await page.getByRole('button', { name: '명세서 작성', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('직원', { exact: true }).locator(`option[value="${staff.id}"]`)).toBeDisabled();
});

test('직원은 이번 달이 비어 있어도 가장 최근 확정 명세서를 바로 확인한다', async ({ page }) => {
  const session = await setupOwner(page);
  const staff = await addStaff(page, '지난달 명세 조회 직원');
  await priorPayroll(page, staff);
  const created = await page.request.post('/api/users', {
    headers: await adminHeaders(page),
    data: { name: staff.name, email: 'payslip.ux@example.test', role: 'designer', staffId: staff.id, password: 'Staff-temporary-2026!' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': session.csrfToken } });
  const login = await page.request.post('/api/auth/login', { data: { email: 'payslip.ux@example.test', password: 'Staff-temporary-2026!' } });
  const employeeSession = await login.json();
  const changed = await page.request.post('/api/auth/password', { headers: { 'X-CSRF-Token': employeeSession.csrfToken }, data: { currentPassword: 'Staff-temporary-2026!', newPassword: 'Staff-final-password-2026!' } });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  await page.reload();
  await openPersonal(page, 'payslip.ux@example.test', 'Staff-final-password-2026!');
  await expect(page.getByLabel('귀속월', { exact: true })).toHaveValue(priorMonth());
  await expect(page.getByRole('button', { name: `${staff.name} ${priorMonth()} 급여명세서 보기`, exact: true })).toBeVisible();
});

test('매장 설정 충돌은 양쪽 값을 보여주고 최신 설정을 불러와 안전하게 취소할 수 있다', async ({ page }) => {
  await setupOwner(page);
  await goTo(page, '매장 설정');
  await page.getByLabel('매장 주소', { exact: true }).fill('내가 수정 중인 주소');
  const snapshot = await state(page);
  await adminAction(page, 'store.save', { ...snapshot.data.store, address: '다른 직원이 저장한 최신 주소' });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('다른 직원이 매장 설정을 변경했습니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '다른 직원이 저장한 최신 주소', exact: true })).toBeVisible();
  await expect(page.getByLabel('매장 주소', { exact: true })).toHaveValue('내가 수정 중인 주소');
  await page.getByRole('button', { name: '최신 설정 불러오기', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '저장된 설정 불러오기', exact: true }).click();
  await expect(page.getByLabel('매장 주소', { exact: true })).toHaveValue('다른 직원이 저장한 최신 주소');
  await expect(page.getByRole('button', { name: '저장', exact: true })).toBeDisabled();
  expect((await state(page)).data.store.address).toBe('다른 직원이 저장한 최신 주소');
});

test('급여 지급 저장 중에는 닫기를 막고 지급일 입력을 고정한다', async ({ page }) => {
  await setupOwner(page);
  const staff = await addStaff(page, '지급 중 이동 보호 직원');
  const record = await priorPayroll(page, staff);
  await page.reload();
  await goTo(page, '급여명세');
  await page.getByLabel('귀속월', { exact: true }).fill(priorMonth());
  await page.getByRole('button', { name: `${staff.name} ${priorMonth()} 급여명세서 보기`, exact: true }).click();
  await page.getByRole('button', { name: '지급 완료 기록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '실제 급여 지급 기록', exact: true });
  const paidDate = `${priorMonth()}-28`;
  await dialog.getByLabel('실제 지급일', { exact: true }).fill(paidDate);
  let release, intercepted;
  const pending = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { intercepted = resolve; });
  await page.route('**/api/actions/payroll.paid', async route => {
    intercepted();
    await pending;
    await route.continue();
  });
  try {
    await dialog.getByRole('checkbox', { name: /계좌로 보냈어요/ }).check();
    await dialog.getByRole('button', { name: '지급 완료로 기록', exact: true }).click();
    await requested;
    await expect(dialog).toHaveAttribute('data-busy', 'true');
    await expect(dialog.getByLabel('실제 지급일', { exact: true })).toBeDisabled();
    await expect(page.getByRole('navigation', { name: '원장 관리 메뉴' })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('dialog', { name: '저장하지 않은 내용이 있어요', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '작성 중인 내용을 닫을까요?', exact: true })).toHaveCount(0);
    await expect(dialog).toBeVisible();
  } finally {
    release();
  }
  await expect(dialog).toBeHidden();
  const saved = (await adminState(page)).data.payroll.find(row => row.id === record.id);
  expect(saved.status).toBe('paid');
  expect(saved.paidDate).toBe(paidDate);
  expect(saved.changes.filter(change => change.kind === 'paid')).toHaveLength(1);
});
