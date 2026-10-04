const { test, expect } = require('@playwright/test');

const STORAGE_KEY = 'salon-erp-prototype-v2';
const shampoo = page => page.getByTestId('inventory-item-i5');
const wax = page => page.getByTestId('inventory-item-i6');
const dialog = page => page.getByRole('dialog');

async function inventory(page) {
  const nav = page.getByRole('button', { name: /^재고·입고(?: \d+)?$/ });
  if (!(await nav.isVisible())) await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await nav.click();
  await expect(shampoo(page)).toBeVisible();
}

async function storedData(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.data || null, STORAGE_KEY);
}

async function expectQuantity(page, itemId, qty) {
  await expect.poll(async () => {
    const data = await storedData(page);
    return data?.items.find(item => item.id === itemId)?.qty;
  }).toBe(qty);
}

async function openReceipt(page, itemId = 'i5') {
  await page.getByTestId(`inventory-item-${itemId}`).getByRole('button', { name: '입고 등록', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

async function receive(page, quantity, memo = '') {
  await openReceipt(page);
  await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill(String(quantity));
  if (memo) await dialog(page).getByLabel(/^메모/).fill(memo);
  await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
}

async function receiptHistory(page) {
  await page.getByRole('tab', { name: '입고 내역', exact: true }).click();
}

function receiptWithMemo(page, memo) {
  return page.locator('[data-testid^="receipt-"]').filter({ hasText: memo });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await inventory(page);
});

test('manual receipt previews the added amount and preserves date, actor, and memo after reload', async ({ page }) => {
  await openReceipt(page);
  await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill('10');
  const receiptDate = await dialog(page).getByLabel('입고일', { exact: true }).inputValue();
  expect(receiptDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await dialog(page).getByLabel(/^메모/).fill('매장 수동 입고 검수 완료');
  await expect(dialog(page)).toContainText('현재 2개 + 입고 10개 = 저장 후 12개');
  await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expectQuantity(page, 'i5', 12);
  await expect(shampoo(page)).toContainText('정상');
  await receiptHistory(page);
  const receipt = receiptWithMemo(page, '매장 수동 입고 검수 완료');
  await expect(receipt).toHaveCount(1);
  await expect(receipt).toContainText('샴푸');
  await expect(receipt).toContainText('+10개');
  await expect(receipt).toContainText('김민지');
  await expect(receipt).toContainText(receiptDate);
  await page.reload();
  await inventory(page);
  await expectQuantity(page, 'i5', 12);
  await receiptHistory(page);
  await expect(receiptWithMemo(page, '매장 수동 입고 검수 완료')).toHaveCount(1);
});

test('stock equal to its threshold still needs replenishment; exceeding it clears the alert', async ({ page }) => {
  await expect(shampoo(page)).toContainText('보충 필요');
  await expect(wax(page)).toContainText('품절');
  await receive(page, 1, '기준 수량 도달');
  await expectQuantity(page, 'i5', 3);
  await expect(shampoo(page)).toContainText('보충 필요');
  await receive(page, 9, '기준 초과 보충');
  await expectQuantity(page, 'i5', 12);
  await expect(shampoo(page)).toContainText('정상');
  await expect(shampoo(page)).not.toContainText('보충 필요');
  await expect(wax(page)).toContainText('품절');
  await expect(page.getByRole('button', { name: /^재고·입고(?: \d+)?$/ })).toContainText('1');
});

test('per-item threshold changes update equality-based alerts and persist', async ({ page }) => {
  await shampoo(page).getByRole('button', { name: '기준 설정', exact: true }).click();
  await dialog(page).getByLabel('보충 기준 수량', { exact: true }).fill('2');
  await dialog(page).getByRole('button', { name: '기준 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(shampoo(page)).toContainText('보충 필요');
  await shampoo(page).getByRole('button', { name: '기준 설정', exact: true }).click();
  await dialog(page).getByLabel('보충 기준 수량', { exact: true }).fill('1');
  await dialog(page).getByRole('button', { name: '기준 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(shampoo(page)).toContainText('정상');
  await page.reload();
  await inventory(page);
  await expect(shampoo(page)).toContainText('정상');
  const data = await storedData(page);
  expect(data.items.find(item => item.id === 'i5')).toMatchObject({ qty: 2, min: 1 });
});

test('receipt correction applies only the difference and cancellation reverses only that receipt', async ({ page }) => {
  await receive(page, 10, '정정 대상 입고');
  await receive(page, 4, '유지해야 하는 별도 입고');
  await expectQuantity(page, 'i5', 16);
  await receiptHistory(page);
  await receiptWithMemo(page, '정정 대상 입고').getByRole('button', { name: '수량 정정', exact: true }).click();
  await dialog(page).getByLabel('올바른 입고 수량', { exact: true }).fill('6');
  await dialog(page).getByLabel('정정 사유', { exact: true }).fill('박스 수량을 잘못 입력함');
  await dialog(page).getByRole('button', { name: '정정 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectQuantity(page, 'i5', 12);
  await expect(receiptWithMemo(page, '정정 대상 입고')).toContainText('+6개');
  await receiptWithMemo(page, '정정 대상 입고').getByRole('button', { name: '입고 취소', exact: true }).click();
  await dialog(page).getByLabel('취소 사유', { exact: true }).fill('입고 전량 공급처 반송');
  await dialog(page).getByRole('button', { name: '입고 취소 확정', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectQuantity(page, 'i5', 6);
  await expect(receiptWithMemo(page, '정정 대상 입고')).toContainText('취소');
  await expect(receiptWithMemo(page, '유지해야 하는 별도 입고')).toContainText('+4개');
  await page.reload();
  await inventory(page);
  await expectQuantity(page, 'i5', 6);
});

test('stocktaking sets a total and requires a reason instead of recording another receipt', async ({ page }) => {
  await shampoo(page).getByRole('button', { name: '재고 조정', exact: true }).click();
  await dialog(page).getByLabel('실사 총수량', { exact: true }).fill('7');
  await dialog(page).getByRole('button', { name: '조정 저장', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByLabel('조정 사유', { exact: true }).fill('진열장 포함 실사 결과');
  await dialog(page).getByRole('button', { name: '조정 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectQuantity(page, 'i5', 7);
  await receiptHistory(page);
  await expect(page.locator('[data-testid^="receipt-"]').filter({ hasText: '진열장 포함 실사 결과' })).toHaveCount(0);
});

test('receipt rejects zero, negative, and fractional piece quantities without changing stock', async ({ page }) => {
  await openReceipt(page);
  for (const invalid of ['0', '-1', '1.5']) {
    await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill(invalid);
    await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    const data = await storedData(page);
    if (data) expect(data.items.find(item => item.id === 'i5').qty).toBe(2);
  }
  await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill('10');
  await dialog(page).getByLabel('입고일', { exact: true }).fill('');
  await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
});

test('receipt correction and cancellation require reasons', async ({ page }) => {
  await receive(page, 10, '사유 검증 입고');
  await receiptHistory(page);
  await receiptWithMemo(page, '사유 검증 입고').getByRole('button', { name: '수량 정정', exact: true }).click();
  await dialog(page).getByLabel('올바른 입고 수량', { exact: true }).fill('5');
  await dialog(page).getByRole('button', { name: '정정 저장', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expectQuantity(page, 'i5', 12);
  await dialog(page).getByLabel('정정 사유', { exact: true }).fill('수량 재확인');
  await dialog(page).getByRole('button', { name: '정정 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectQuantity(page, 'i5', 7);
  await receiptWithMemo(page, '사유 검증 입고').getByRole('button', { name: '입고 취소', exact: true }).click();
  await dialog(page).getByRole('button', { name: '입고 취소 확정', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expectQuantity(page, 'i5', 7);
});

test('failed browser storage leaves the receipt draft open and retry adds the stock exactly once', async ({ page }) => {
  await openReceipt(page);
  await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill('10');
  await dialog(page).getByLabel(/^메모/).fill('저장 재시도 검증');
  await page.evaluate(() => {
    window.__originalStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'salon-erp-prototype-v2') throw new DOMException('Test storage quota failure', 'QuotaExceededError');
      return window.__originalStorageSetItem.call(this, key, value);
    };
  });
  await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('추가 입고 수량', { exact: true })).toHaveValue('10');
  await expect(page.getByText(/저장.*실패|저장할 수 없/).first()).toBeVisible();
  const failedData = await storedData(page);
  if (failedData) expect(failedData.items.find(item => item.id === 'i5').qty).toBe(2);
  await expect(page.getByText('입고가 기록되었습니다.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalStorageSetItem; });
  await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectQuantity(page, 'i5', 12);
  await receiptHistory(page);
  await expect(receiptWithMemo(page, '저장 재시도 검증')).toHaveCount(1);
  await page.reload();
  await inventory(page);
  await expectQuantity(page, 'i5', 12);
});

test('inventory and the receipt form fit a 390px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await inventory(page);
  await expect(shampoo(page)).toBeVisible();
  const viewportFits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await expect.poll(viewportFits).toBe(true);
  await openReceipt(page);
  await expect(dialog(page).getByLabel('추가 입고 수량', { exact: true })).toBeVisible();
  await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill('10');
  await expect(dialog(page)).toContainText('현재 2개 + 입고 10개 = 저장 후 12개');
  await expect.poll(viewportFits).toBe(true);
  await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expectQuantity(page, 'i5', 12);
});

test('the global receipt action lets staff choose the item before adding stock', async ({ page }) => {
  await page.getByRole('button', { name: '+ 입고 등록', exact: true }).click();
  await dialog(page).getByRole('radio', { name: /헤어 왁스/ }).click();
  await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill('5');
  await expect(dialog(page)).toContainText('현재 0개 + 입고 5개 = 저장 후 5개');
  await dialog(page).getByLabel(/^메모/).fill('품목 선택 입고');
  await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectQuantity(page, 'i6', 5);
  await expect(wax(page)).toContainText('정상');
  await expect(shampoo(page)).toContainText('보충 필요');
  await receiptHistory(page);
  await expect(receiptWithMemo(page, '품목 선택 입고')).toContainText('헤어 왁스');
});

test('cancelling stock that has already been used cannot make the total negative', async ({ page }) => {
  await receive(page, 10, '사용 후 취소 검증');
  await shampoo(page).getByRole('button', { name: '재고 조정', exact: true }).click();
  await dialog(page).getByLabel('실사 총수량', { exact: true }).fill('3');
  await dialog(page).getByLabel('조정 사유', { exact: true }).fill('일부 사용 후 실사');
  await dialog(page).getByRole('button', { name: '조정 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectQuantity(page, 'i5', 3);
  await receiptHistory(page);
  await receiptWithMemo(page, '사용 후 취소 검증').getByRole('button', { name: '입고 취소', exact: true }).click();
  await dialog(page).getByLabel('취소 사유', { exact: true }).fill('사용량 확인 전 취소 시도');
  await dialog(page).getByRole('button', { name: '입고 취소 확정', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expectQuantity(page, 'i5', 3);
});

test('dashboard shortage count reflects manually received stock', async ({ page }) => {
  await page.getByRole('button', { name: '대시보드', exact: true }).click();
  await expect(page.getByTestId('dashboard-low-stock')).toContainText('2개');
  await inventory(page);
  await receive(page, 10);
  await page.getByRole('button', { name: '대시보드', exact: true }).click();
  await expect(page.getByTestId('dashboard-low-stock')).toContainText('1개');
});

test('dirty receipt close and Escape preserve inputs until explicitly discarded and trap focus', async ({ page }) => {
  await openReceipt(page);
  await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill('10');
  await dialog(page).getByLabel(/^메모/).fill('닫아도 유지할 작성 내용');
  const close = dialog(page).getByRole('button', { name: '닫기', exact: true });
  const save = dialog(page).getByRole('button', { name: '입고 저장', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog(page).getByText('작성 중인 내용을 닫을까요?', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: '계속 작성', exact: true }).click();
  await expect(dialog(page).getByLabel('추가 입고 수량', { exact: true })).toHaveValue('10');
  await expect(dialog(page).getByLabel(/^메모/)).toHaveValue('닫아도 유지할 작성 내용');
  await close.click();
  await expect(dialog(page).getByText('작성 중인 내용을 닫을까요?', { exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: '내용 버리고 닫기', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(shampoo(page).getByRole('button', { name: '입고 등록', exact: true })).toBeFocused();
  await expect(shampoo(page).getByTestId('stock-qty')).toHaveText('2개');
  const data = await storedData(page);
  if (data) expect(data.receipts.filter(receipt => receipt.memo === '닫아도 유지할 작성 내용')).toHaveLength(0);
});

test('two tabs detect a conflicting receipt and recheck the latest total before retrying', async ({ page, context }) => {
  const secondTab = await context.newPage();
  await secondTab.goto('/');
  await inventory(secondTab);
  await openReceipt(page);
  await dialog(page).getByLabel('추가 입고 수량', { exact: true }).fill('10');
  await dialog(page).getByLabel(/^메모/).fill('첫 번째 창 입고');
  await openReceipt(secondTab);
  await dialog(secondTab).getByLabel('추가 입고 수량', { exact: true }).fill('4');
  await dialog(secondTab).getByLabel(/^메모/).fill('두 번째 창 입고');
  await dialog(page).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectQuantity(page, 'i5', 12);
  await dialog(secondTab).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog(secondTab)).toBeVisible();
  await expect(dialog(secondTab)).toContainText('다른 창에서 변경한 내용을 불러왔습니다.');
  await expect(dialog(secondTab)).toContainText('현재 12개 + 입고 4개 = 저장 후 16개');
  await expect(dialog(secondTab).getByLabel('추가 입고 수량', { exact: true })).toHaveValue('4');
  await expectQuantity(secondTab, 'i5', 12);
  await dialog(secondTab).getByRole('button', { name: '입고 저장', exact: true }).click();
  await expect(dialog(secondTab)).toHaveCount(0);
  await expectQuantity(secondTab, 'i5', 16);
  await expect(shampoo(page).getByTestId('stock-qty')).toHaveText('16개');
  const data = await storedData(secondTab);
  expect(data.receipts.filter(receipt => receipt.itemId === 'i5')).toHaveLength(2);
  await receiptHistory(secondTab);
  await expect(receiptWithMemo(secondTab, '첫 번째 창 입고')).toHaveCount(1);
  await expect(receiptWithMemo(secondTab, '두 번째 창 입고')).toHaveCount(1);
  await secondTab.close();
});
