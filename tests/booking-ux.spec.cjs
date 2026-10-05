'use strict';
const { test, expect, setupOwner, adminAction, state, action, goTo, today } = require('./ux-fixture.cjs');

async function prepare(page) {
  await setupOwner(page);
  let result = await adminAction(page, 'staff.save', { name: '시간 확인 디자이너', role: 'designer', phone: '', status: 'active', workingDays: [0, 1, 2, 3, 4, 5, 6], startMinutes: 600, endMinutes: 1200, breakStart: 720, breakEnd: 780 });
  const staff = result.data.staff.find(item => item.name === '시간 확인 디자이너');
  await adminAction(page, 'staff.save', { name: '예약 불가 접수 직원', role: 'reception', phone: '', status: 'active', workingDays: [0, 1, 2, 3, 4, 5, 6], startMinutes: 600, endMinutes: 1200, breakStart: null, breakEnd: null });
  result = await adminAction(page, 'service.save', { name: '한시간 상담 시술', price: 50000, duration: 60, materials: [], active: true });
  const service = result.data.services.find(item => item.name === '한시간 상담 시술');
  await action(page, 'appointment.save', { date: today(), start: 600, duration: 60, staffId: staff.id, serviceIds: [service.id], guestName: '기존 예약', guestPhone: '', notes: '' });
  await page.reload();
  return { staff, service };
}

test('예약 작성 중 신규 고객을 등록해도 시술·시간·메모를 유지하고 빈 시간으로 예약한다', async ({ page }) => {
  const { staff, service } = await prepare(page);
  await page.getByRole('button', { name: '＋ 예약 등록', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '새 예약 등록', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('담당 직원 *', { exact: true }).locator('option').filter({ hasText: '예약 불가 접수 직원' })).toHaveCount(0);
  await dialog.getByLabel('예약자 이름 *', { exact: true }).fill('예약 중 등록 고객');
  await dialog.getByLabel('예약자 연락처', { exact: true }).fill('010-2222-4444');
  await dialog.getByLabel('담당 직원 *', { exact: true }).selectOption(staff.id);
  await dialog.getByRole('checkbox', { name: new RegExp(service.name) }).check();
  const times = dialog.getByRole('group', { name: '가능한 시작 시간 선택' });
  await expect(times.getByRole('button', { name: '10:00', exact: true })).toHaveCount(0);
  await expect(times.getByRole('button', { name: '12:00', exact: true })).toHaveCount(0);
  await times.getByRole('button', { name: '11:00', exact: true }).click();
  await dialog.getByLabel('예약 메모', { exact: true }).fill('입력한 상담 메모 유지');
  await dialog.getByRole('button', { name: '+ 새 고객 등록', exact: true }).click();
  let customer = page.getByRole('dialog', { name: '새 고객 등록', exact: true });
  await expect(customer.getByLabel('고객 이름 *', { exact: true })).toHaveValue('예약 중 등록 고객');
  await expect(customer.getByLabel('연락처', { exact: true })).toHaveValue('010-2222-4444');
  await page.goBack();
  const leave = page.getByRole('dialog', { name: '저장하지 않은 내용이 있습니다', exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: '돌아가기', exact: true }).click();
  await expect(customer).toBeVisible();
  await customer.getByLabel('시술 시 주의사항', { exact: true }).fill('두피 자극 확인');
  await customer.getByRole('button', { name: '고객 등록 후 예약 계속', exact: true }).click();
  await expect(dialog.getByLabel('예약 메모', { exact: true })).toHaveValue('입력한 상담 메모 유지');
  await expect(dialog.getByLabel('시작 시간 *', { exact: true })).toHaveValue('11:00');
  await expect(dialog.getByRole('checkbox', { name: new RegExp(service.name) })).toBeChecked();
  await expect(dialog.locator('.ops-warning')).toContainText('두피 자극 확인');
  await dialog.getByRole('button', { name: '예약 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  const snapshot = await state(page);
  const savedCustomer = snapshot.data.customers.find(item => item.name === '예약 중 등록 고객');
  const appointment = snapshot.data.appointments.find(item => item.customerId === savedCustomer.id);
  expect(appointment.start).toBe(660);
  expect(appointment.notes).toBe('입력한 상담 메모 유지');
  expect(appointment.serviceIds).toEqual([service.id]);
});

test('예약 중 중복 전화번호 고객을 선택하고 차트에서 예약 없는 수납을 시작한다', async ({ page }) => {
  await prepare(page);
  let result = await action(page, 'customer.save', { name: '기존 연락처 고객', phone: '010-1234-9999', memo: '', warning: '' });
  const saved = result.data.customers.find(item => item.name === '기존 연락처 고객');
  await page.reload();
  await page.getByRole('button', { name: '＋ 예약 등록', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '새 예약 등록', exact: true });
  await dialog.getByRole('button', { name: '+ 새 고객 등록', exact: true }).click();
  const customer = page.getByRole('dialog', { name: '새 고객 등록', exact: true });
  await customer.getByLabel('고객 이름 *', { exact: true }).fill('오타 난 이름');
  await customer.getByLabel('연락처', { exact: true }).fill('01012349999');
  await customer.getByRole('button', { name: '기존 고객 선택 · 기존 연락처 고객', exact: true }).click();
  await expect(dialog).toContainText('선택한 고객: 기존 연락처 고객');
  expect((await state(page)).data.customers).toHaveLength(1);
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '내용 버리고 닫기', exact: true }).click();
  await goTo(page, '고객 관리');
  await page.getByRole('button', { name: '기존 연락처 고객 고객 차트 보기', exact: true }).click();
  await page.getByRole('dialog', { name: '고객 차트', exact: true }).getByRole('button', { name: '예약 없이 수납', exact: true }).click();
  const payment = page.getByRole('dialog', { name: '새 수납 기록', exact: true });
  await expect(payment).toBeVisible();
  await expect(payment.getByLabel('고객', { exact: true })).toHaveValue(saved.id);
});

test('예약 날짜·고객 검색 조건은 다른 메뉴를 방문한 뒤 돌아와도 유지된다', async ({ page }) => {
  await prepare(page);
  await goTo(page, '예약 일정');
  await page.getByLabel('조회 날짜', { exact: true }).fill('2026-11-15');
  await page.getByLabel('고객 검색', { exact: true }).fill('이전 검색');
  await goTo(page, '고객 관리');
  await page.getByLabel('고객 검색', { exact: true }).fill('고객 검색 유지');
  await goTo(page, '예약 일정');
  await expect(page.getByLabel('조회 날짜', { exact: true })).toHaveValue('2026-11-15');
  await expect(page.getByLabel('고객 검색', { exact: true })).toHaveValue('이전 검색');
  await goTo(page, '고객 관리');
  await expect(page.getByLabel('고객 검색', { exact: true })).toHaveValue('고객 검색 유지');
});
