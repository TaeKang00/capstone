'use strict';
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const EMAIL = 'owner@example.test';
const PASSWORD = 'Owner-test-password-2026!';
const TODAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function state(page) { const response = await page.request.get('/api/state'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function session(page) { const response = await page.request.get('/api/auth/me'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function action(page, type, payload) {
  const [{ version }, { csrfToken }] = await Promise.all([state(page), session(page)]);
  const response = await page.request.post(`/api/actions/${type}`, { headers: { 'X-CSRF-Token': csrfToken }, data: { version, requestId: randomUUID(), payload } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
async function ensureSetup(page) {
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  if (bootstrap.needsSetup) {
    const response = await page.request.post('/api/bootstrap', { data: { storeName: '브라우저 테스트 미용실', name: '테스트 원장', email: EMAIL, password: PASSWORD } });
    expect(response.ok()).toBeTruthy();
    const { csrfToken } = await response.json();
    await page.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': csrfToken } });
  }
}
async function login(page, email = EMAIL, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '다시 만나 반갑습니다' })).toBeHidden();
}
async function nav(page, name) { await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name, exact: false }).click(); }
async function closeDialog(page) { await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).first().click(); }
async function catalog(page, tag, { material = false, product = false } = {}) {
  let result = await action(page, 'staff.save', { name: `${tag} 디자이너`, phone: '', role: 'designer', status: 'active', workingDays: [0, 1, 2, 3, 4, 5, 6], startMinutes: 600, endMinutes: 1200, breakStart: null, breakEnd: null });
  const staff = result.data.staff.find(row => row.name === `${tag} 디자이너`);
  let materialItem, productItem;
  if (material) {
    result = await action(page, 'inventory.item', { name: `${tag} 약제`, kind: '시술 재료', unit: 'g', min: 50, price: 0, active: true });
    materialItem = result.data.items.find(row => row.name === `${tag} 약제`);
    await action(page, 'inventory.receipt', { itemId: materialItem.id, qty: 100, date: TODAY, memo: '테스트 입고' });
  }
  if (product) {
    result = await action(page, 'inventory.item', { name: `${tag} 샴푸`, kind: '판매 상품', unit: '개', min: 2, price: 10000, active: true });
    productItem = result.data.items.find(row => row.name === `${tag} 샴푸`);
    await action(page, 'inventory.receipt', { itemId: productItem.id, qty: 5, date: TODAY, memo: '테스트 입고' });
  }
  result = await action(page, 'service.save', { name: `${tag} 염색`, price: 20000, duration: 30, materials: materialItem ? [{ itemId: materialItem.id, quantity: 10 }] : [], active: true });
  const service = result.data.services.find(row => row.name === `${tag} 염색`);
  await page.reload();
  return { staff, service, materialItem, productItem };
}

test('첫 설치는 관리자 등록부터 시작하고 로그인과 푸터가 유지된다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '우리 매장을 시작하세요' })).toBeVisible();
  await page.getByLabel('매장 이름', { exact: true }).fill('브라우저 테스트 미용실');
  await page.getByLabel('원장 이름', { exact: true }).fill('테스트 원장');
  await page.getByLabel('이메일', { exact: true }).fill(EMAIL);
  await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
  await page.getByLabel('비밀번호 확인', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '매장 만들고 시작하기' }).click();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  await expect(page.locator('.app-footer')).toContainText('브라우저 테스트 미용실');
  const initial = await state(page);
  expect(initial.data.customers).toEqual([]);
  expect(initial.data.appointments).toEqual([]);
  expect(initial.data.transactions).toEqual([]);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('heading', { name: '다시 만나 반갑습니다' })).toBeVisible();
  await page.getByLabel('이메일', { exact: true }).fill(EMAIL);
  await page.getByLabel('비밀번호', { exact: true }).fill('incorrect-test-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
});

test('고객 주의사항과 예약 수납·정정·부분 환불이 연결되며 재료를 중복 차감하지 않는다', async ({ page }) => {
  await ensureSetup(page); await login(page);
  const { staff, service, materialItem, productItem } = await catalog(page, '연결', { material: true, product: true });
  await nav(page, '고객 관리');
  await page.getByRole('button', { name: '+ 고객 등록', exact: true }).click();
  await page.getByLabel('고객 이름 *', { exact: true }).fill('연결 고객');
  await page.getByLabel('연락처', { exact: true }).fill('010-7777-1111');
  await page.getByLabel('시술 시 주의사항', { exact: true }).fill('테스트 약제 알레르기 확인');
  await page.getByLabel('상담 및 고객 메모', { exact: true }).fill('차분한 색상 선호');
  await page.getByRole('button', { name: '고객 정보 저장' }).click();
  await expect(page.getByRole('dialog', { name: '고객 차트', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '예약 등록', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '새 예약 등록', exact: true });
  await expect(dialog.getByText('테스트 약제 알레르기 확인')).toBeVisible();
  await dialog.getByLabel('담당 직원 *', { exact: true }).selectOption(staff.id);
  await dialog.getByRole('checkbox', { name: new RegExp(service.name) }).check();
  await dialog.getByLabel('시작 시간 *', { exact: true }).fill('10:00');
  await dialog.getByRole('button', { name: '예약 저장' }).click();
  await expect(dialog).toBeHidden();
  let snapshot = await state(page); const booking = snapshot.data.appointments.find(row => row.staffId === staff.id);
  expect(booking.status).toBe('booked');
  expect(snapshot.data.items.find(row => row.id === materialItem.id).qty).toBe(100);
  await page.locator('.ops-booking').filter({ hasText: '연결 고객' }).getByRole('button', { name: '상세', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '수납하기' }).click();
  dialog = page.getByRole('dialog', { name: '예약 수납 기록', exact: true });
  await expect(dialog.getByText('테스트 약제 알레르기 확인')).toBeVisible();
  await dialog.getByLabel('추가할 시술 · 상품', { exact: true }).selectOption(`product:${productItem.id}`);
  await dialog.getByRole('button', { name: '항목 추가', exact: true }).click();
  await dialog.getByLabel('전체 할인 (원)', { exact: true }).fill('3000');
  await dialog.getByRole('checkbox', { name: /단말기 승인/ }).check();
  await dialog.getByRole('button', { name: '수납 27,000원 기록' }).click();
  await expect(dialog).toBeHidden();
  snapshot = await state(page);
  const transaction = snapshot.data.transactions.find(row => row.appointmentId === booking.id);
  expect(transaction.total).toBe(27000);
  expect(snapshot.data.appointments.find(row => row.id === booking.id).status).toBe('completed');
  expect(snapshot.data.items.find(row => row.id === materialItem.id).qty).toBe(90);
  expect(snapshot.data.items.find(row => row.id === productItem.id).qty).toBe(4);
  await page.getByRole('button', { name: '연결 고객 결제 상세', exact: true }).click();
  await page.getByRole('button', { name: '수납 정보 정정', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '수납 정보 정정', exact: true });
  await dialog.getByLabel('승인번호 · 거래번호', { exact: true }).fill('TEST-APPROVAL-27');
  await dialog.getByLabel('정정 사유 (필수)', { exact: true }).fill('단말기 거래번호 확인');
  await dialog.getByRole('button', { name: '정정 저장' }).click();
  await expect(dialog).toBeHidden();
  snapshot = await state(page);
  expect(snapshot.data.items.find(row => row.id === materialItem.id).qty).toBe(90);
  expect(snapshot.data.transactions.find(row => row.id === transaction.id).reference).toBe('TEST-APPROVAL-27');
  await page.getByRole('button', { name: '연결 고객 결제 상세', exact: true }).click();
  await page.getByRole('button', { name: '환불 기록', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '환불 기록', exact: true });
  const productLine = dialog.locator('.commerce-refund-line').filter({ hasText: productItem.name });
  await productLine.getByLabel('이번 환불 수량', { exact: true }).fill('1');
  await productLine.getByRole('checkbox', { name: /실제로 회수한 상품/ }).check();
  await dialog.getByLabel('환불 사유 (필수)', { exact: true }).fill('미개봉 상품 반품');
  await dialog.getByRole('checkbox', { name: /고객에게.*환불을 완료/ }).check();
  await dialog.getByRole('button', { name: '환불 9,000원 기록' }).click();
  await expect(dialog).toBeHidden();
  snapshot = await state(page);
  expect(snapshot.data.items.find(row => row.id === materialItem.id).qty).toBe(90);
  expect(snapshot.data.items.find(row => row.id === productItem.id).qty).toBe(5);
  expect(snapshot.data.transactions.find(row => row.id === transaction.id).status).toBe('partially_refunded');
  expect(snapshot.data.refunds.find(row => row.transactionId === transaction.id).amount).toBe(9000);
  await nav(page, '매출 · 정산');
  await expect(page.getByRole('heading', { name: '매출 · 정산', exact: true })).toBeVisible();
});

test('급여명세서를 작성·확정·지급 처리하고 출력할 수 있다', async ({ page }) => {
  await ensureSetup(page); await login(page);
  const { staff } = await catalog(page, '급여');
  await nav(page, '급여명세');
  await page.getByRole('button', { name: '급여명세서 작성', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '급여명세서 작성', exact: true });
  await dialog.getByLabel('직원', { exact: true }).selectOption(staff.id);
  await dialog.getByLabel('기본급 (원)', { exact: true }).fill('2400000');
  await dialog.getByLabel('지급·공제 계산 근거', { exact: true }).fill('테스트 월 정액 급여');
  await dialog.getByRole('button', { name: '작성 중으로 저장' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: `${staff.name} ${TODAY.slice(0, 7)} 급여명세서 보기` }).click();
  await page.getByRole('button', { name: '급여 확정', exact: true }).click();
  await page.getByRole('button', { name: '최신 매출로 계산 후 확정' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  let snapshot = await state(page); const payroll = snapshot.data.payroll.find(row => row.staffId === staff.id);
  expect(payroll.status).toBe('finalized'); expect(payroll.netPay).toBe(2400000);
  await page.getByRole('button', { name: `${staff.name} ${TODAY.slice(0, 7)} 급여명세서 보기` }).click();
  await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
  await page.getByRole('button', { name: '인쇄 / PDF 저장' }).click();
  expect(await page.evaluate(() => window.__printCalls)).toBe(1);
  await expect(page.locator('.payroll-statement')).toContainText('테스트 월 정액 급여');
  await page.getByRole('button', { name: '지급 완료 기록', exact: true }).click();
  await page.getByRole('button', { name: '실제 지급 확인 · 완료 기록' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  snapshot = await state(page);
  expect(snapshot.data.payroll.find(row => row.id === payroll.id).status).toBe('paid');
});

test('디자이너는 첫 비밀번호를 변경하고 본인 업무와 확정 급여만 볼 수 있다', async ({ page }) => {
  await ensureSetup(page); await login(page);
  await nav(page, '직원 관리');
  await page.getByRole('button', { name: '＋ 직원 등록', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '직원 등록', exact: true });
  await dialog.getByLabel('직원 이름', { exact: true }).fill('권한 디자이너');
  await dialog.getByRole('button', { name: '직원 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  const { data } = await state(page); const staff = data.staff.find(row => row.name === '권한 디자이너');
  await page.locator('.staff-card').filter({ hasText: '권한 디자이너' }).getByRole('button', { name: '계정 발급', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('로그인 이메일', { exact: true }).fill('designer@example.test');
  await dialog.getByLabel('임시 비밀번호', { exact: true }).fill('Temporary-password-2026!');
  await dialog.getByRole('button', { name: '계정 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  const { csrfToken } = await session(page);
  await page.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': csrfToken } });
  await login(page, 'designer@example.test', 'Temporary-password-2026!');
  await expect(page.getByRole('heading', { name: '새 비밀번호를 설정해 주세요' })).toBeVisible();
  await page.getByLabel('임시 비밀번호', { exact: true }).fill('Temporary-password-2026!');
  await page.getByLabel('새 비밀번호', { exact: true }).fill('Designer-final-password-2026!');
  await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('Designer-final-password-2026!');
  await page.getByRole('button', { name: '비밀번호 변경', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('button', { name: /매장 설정|매출 · 정산|수납 · 환불|직원 관리/ })).toHaveCount(0);
  const own = await state(page);
  expect(own.data.appointments.every(row => row.staffId === staff.id)).toBeTruthy();
  expect(own.data.transactions.every(row => row.staffId === staff.id)).toBeTruthy();
  expect(own.data.payroll.every(row => row.staffId === staff.id && row.status !== 'draft')).toBeTruthy();
  const reports = await page.request.get(`/api/reports?from=${TODAY}&to=${TODAY}`); expect(reports.status()).toBe(403);
  await nav(page, '급여명세');
  await expect(page.getByRole('heading', { name: '내 급여명세서' })).toBeVisible();
});

test('수동 입고는 기록자·정정 이력을 남기고 기준 이하에서만 보충 표시를 한다', async ({ page }) => {
  await ensureSetup(page); await login(page); await nav(page, '재고 · 입고');
  await page.getByRole('button', { name: '품목 등록', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '새 품목 등록', exact: true });
  await dialog.getByLabel('품목 이름', { exact: true }).fill('수동 확인 샴푸');
  await dialog.getByLabel('품목 구분', { exact: true }).selectOption('판매 상품');
  await dialog.getByLabel('보충 기준 (개)', { exact: true }).fill('2');
  await dialog.getByLabel('판매 단가 (원)', { exact: true }).fill('15000');
  await dialog.getByRole('button', { name: '품목 등록', exact: true }).click();
  await expect(dialog).toBeHidden();
  let row = page.getByRole('row').filter({ hasText: '수동 확인 샴푸' });
  await expect(row).toContainText('품절');
  await row.getByRole('button', { name: '수동 확인 샴푸 입고', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '수동 입고', exact: true });
  await dialog.getByLabel('추가할 수량 (개)', { exact: true }).fill('2');
  await dialog.getByLabel('메모 (선택)', { exact: true }).fill('현물 검수 후 입력');
  await dialog.getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(row).toContainText('보충 필요');
  await row.getByRole('button', { name: '수동 확인 샴푸 보충 기준 변경', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '보충 기준 변경', exact: true });
  await dialog.getByLabel('새 보충 기준 (개)', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: '변경 저장', exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(row).toContainText('정상');
  await page.getByRole('tab', { name: /입고 기록/ }).click();
  await page.getByRole('button', { name: `수동 확인 샴푸 ${TODAY} 입고 상세`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: '입고 상세', exact: true });
  await expect(dialog).toContainText('테스트 원장');
  await dialog.getByRole('button', { name: '수량 정정', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '입고 수량 정정', exact: true });
  await dialog.getByLabel('정정할 입고 총수량 (개)', { exact: true }).fill('3');
  await dialog.getByLabel('정정 사유 (필수)', { exact: true }).fill('검수 수량 재확인');
  await dialog.getByRole('button', { name: '정정 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  let snapshot = await state(page); const item = snapshot.data.items.find(item => item.name === '수동 확인 샴푸');
  expect(item.qty).toBe(3); expect(item.min).toBe(1);
  const receipt = snapshot.data.receipts.find(receipt => receipt.itemId === item.id);
  expect(receipt.revision).toBe(1); expect(receipt.actorName).toBe('테스트 원장');
  await page.getByRole('button', { name: `수동 확인 샴푸 ${TODAY} 입고 상세`, exact: true }).click();
  await page.getByRole('button', { name: '입고 취소', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '입고 취소', exact: true });
  await dialog.getByLabel('취소 사유 (필수)', { exact: true }).fill('중복 기록 확인');
  await dialog.getByRole('button', { name: '입고 취소 저장', exact: true }).click();
  await expect(dialog).toBeHidden(); snapshot = await state(page);
  expect(snapshot.data.items.find(row => row.id === item.id).qty).toBe(0);
  expect(snapshot.data.receipts.find(row => row.id === receipt.id).status).toBe('cancelled');
});

test('모바일 메뉴와 키보드 모달은 입력을 지키고 화면이 옆으로 넘치지 않는다', async ({ page }) => {
  await ensureSetup(page); await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.locator('.mobile-drawer').getByRole('button', { name: /고객 관리/ }).click();
  await expect(page.locator('.mobile-drawer')).toBeHidden();
  await page.getByRole('button', { name: '+ 고객 등록', exact: true }).click();
  await page.getByLabel('고객 이름 *', { exact: true }).fill('닫기 보호 테스트');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '작성 중인 내용을 닫을까요?' })).toBeVisible();
  await page.getByRole('dialog', { name: '작성 중인 내용을 닫을까요?' }).getByRole('button', { name: '돌아가기' }).click();
  await expect(page.getByLabel('고객 이름 *', { exact: true })).toHaveValue('닫기 보호 테스트');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '내용 버리고 닫기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await expect(page.locator('.app-footer')).toBeVisible();
});

test('매장 운영 설정과 시술 가격을 저장하고 다시 접속해도 유지한다', async ({ page }) => {
  await ensureSetup(page); await login(page); await nav(page, '매장 설정');
  await page.getByLabel('매장 주소', { exact: true }).fill('테스트시 테스트로 123');
  await page.getByLabel('매장 전화', { exact: true }).fill('02-1234-5678');
  await page.getByLabel('예약 시간 간격', { exact: true }).selectOption('15');
  await page.getByRole('button', { name: '매장 설정 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '매장 설정 저장', exact: true })).toBeDisabled();
  await page.reload(); await nav(page, '매장 설정');
  await expect(page.getByLabel('매장 주소', { exact: true })).toHaveValue('테스트시 테스트로 123');
  await expect(page.getByLabel('예약 시간 간격', { exact: true })).toHaveValue('15');
  await page.getByRole('button', { name: '시술 · 가격표', exact: true }).click();
  await page.getByRole('button', { name: '＋ 시술 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '시술 메뉴 등록', exact: true });
  await dialog.getByLabel('시술 이름', { exact: true }).fill('설정 화면 커트');
  await dialog.getByLabel('기본 가격 (원)', { exact: true }).fill('25000');
  await dialog.getByLabel('소요시간 (분)', { exact: true }).fill('45');
  await dialog.getByRole('button', { name: '시술 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: '설정 화면 커트' })).toContainText('25,000');
  await page.getByRole('button', { name: '활동 기록', exact: true }).click();
  await expect(page.getByRole('heading', { name: '최근 활동 기록', exact: true })).toBeVisible();
});

test('다른 직원이 먼저 저장하면 입력을 유지하고 최신 자료 확인 후 재시도한다', async ({ page }) => {
  await ensureSetup(page); await login(page); await nav(page, '고객 관리');
  await page.getByRole('button', { name: '+ 고객 등록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 고객 등록', exact: true });
  await dialog.getByLabel('고객 이름 *', { exact: true }).fill('충돌 뒤 유지된 고객');
  await action(page, 'customer.save', { name: '다른 직원이 먼저 저장한 고객', memo: '', warning: '', phone: '' });
  await dialog.getByRole('button', { name: '고객 정보 저장', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('고객 이름 *', { exact: true })).toHaveValue('충돌 뒤 유지된 고객');
  let snapshot = await state(page);
  expect(snapshot.data.customers.filter(row => row.name === '충돌 뒤 유지된 고객')).toHaveLength(0);
  await dialog.getByRole('button', { name: '고객 정보 저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  snapshot = await state(page);
  expect(snapshot.data.customers.filter(row => row.name === '충돌 뒤 유지된 고객')).toHaveLength(1);
  expect(snapshot.data.customers.filter(row => row.name === '다른 직원이 먼저 저장한 고객')).toHaveLength(1);
});

test('수납 저장 응답이 끊겨도 재시도하면 결제와 재료 사용이 한 번만 기록된다', async ({ page }) => {
  await ensureSetup(page); await login(page);
  const { staff, service, materialItem } = await catalog(page, '재시도', { material: true });
  await nav(page, '수납 · 환불');
  await page.getByRole('button', { name: '+ 수납 기록', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 수납 기록', exact: true });
  await dialog.getByLabel('방문 고객 이름', { exact: true }).fill('응답 유실 고객');
  await dialog.getByLabel('담당 직원', { exact: true }).selectOption(staff.id);
  await dialog.getByLabel('추가할 시술 · 상품', { exact: true }).selectOption(`service:${service.id}`);
  await dialog.getByRole('button', { name: '항목 추가', exact: true }).click();
  await dialog.getByRole('checkbox', { name: /단말기 승인/ }).check();
  const requestIds = [];
  await page.route('**/api/actions/payment.create', async route => {
    requestIds.push(route.request().postDataJSON().requestId);
    if (requestIds.length === 1) {
      const response = await route.fetch(); expect(response.ok()).toBeTruthy();
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: '수납 20,000원 기록', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('방문 고객 이름', { exact: true })).toHaveValue('응답 유실 고객');
  let snapshot = await state(page);
  expect(snapshot.data.transactions.filter(row => row.staffId === staff.id)).toHaveLength(1);
  expect(snapshot.data.items.find(row => row.id === materialItem.id).qty).toBe(90);
  await dialog.getByRole('button', { name: '수납 20,000원 기록', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requestIds).toHaveLength(2); expect(requestIds[0]).toBe(requestIds[1]);
  snapshot = await state(page);
  expect(snapshot.data.transactions.filter(row => row.staffId === staff.id)).toHaveLength(1);
  expect(snapshot.data.items.find(row => row.id === materialItem.id).qty).toBe(90);
});

test('접수 직원도 확정된 본인 급여명세서를 조회·출력할 수 있다', async ({ page }) => {
  await ensureSetup(page); await login(page);
  let result = await action(page, 'staff.save', { name: '급여 조회 접수 직원', phone: '', role: 'reception', status: 'active', workingDays: [0, 1, 2, 3, 4, 5, 6], startMinutes: 600, endMinutes: 1200, breakStart: null, breakEnd: null });
  const staff = result.data.staff.find(row => row.name === '급여 조회 접수 직원');
  const { csrfToken } = await session(page);
  const created = await page.request.post('/api/users', { headers: { 'X-CSRF-Token': csrfToken }, data: { name: staff.name, email: 'reception@example.test', role: 'reception', staffId: staff.id, password: 'Reception-temporary-2026!' } });
  expect(created.ok()).toBeTruthy();
  result = await action(page, 'payroll.save', { staffId: staff.id, month: TODAY.slice(0, 7), payDate: TODAY, basePay: 2100000, commissionRate: 0, allowances: [], deductions: [], workDays: '', workHours: '', overtimeHours: '', basis: '접수 직원 월 정액 급여', notes: '' });
  const payroll = result.data.payroll.find(row => row.staffId === staff.id);
  await action(page, 'payroll.finalize', { id: payroll.id });
  await page.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': csrfToken } });
  await login(page, 'reception@example.test', 'Reception-temporary-2026!');
  await page.getByLabel('임시 비밀번호', { exact: true }).fill('Reception-temporary-2026!');
  await page.getByLabel('새 비밀번호', { exact: true }).fill('Reception-final-password-2026!');
  await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('Reception-final-password-2026!');
  await page.getByRole('button', { name: '비밀번호 변경', exact: true }).click();
  await nav(page, '급여명세');
  await expect(page.getByRole('heading', { name: '내 급여명세서' })).toBeVisible();
  await expect(page.getByRole('button', { name: '급여명세서 작성', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `${staff.name} ${TODAY.slice(0, 7)} 급여명세서 보기`, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('2,100,000');
  await expect(page.getByRole('button', { name: '인쇄 / PDF 저장', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /급여 확정|확정 취소|지급 완료 기록/ })).toHaveCount(0);
  const own = await state(page);
  expect(own.data.payroll.map(row => row.id)).toEqual([payroll.id]);
});
