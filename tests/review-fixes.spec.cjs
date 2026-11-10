"use strict";
const {
  test,
  expect,
  setupOwner,
  state,
  action,
  adminAction,
  goTo,
  today,
  OWNER_EMAIL,
} = require("./ux-fixture.cjs");
const dialog = (page) => page.getByRole("dialog").last();
async function seed(page) {
  await setupOwner(page);
  let r = await action(page, "inventory.item", {
    name: "케어 재료",
    kind: "시술 재료",
    unit: "ml",
    packSize: 500,
    purchasePrice: 20000,
    price: 0,
    min: 100,
    active: true,
  });
  const item = r.data.items[0];
  await action(page, "inventory.receipt", {
    itemId: item.id,
    packQty: 3,
    date: today(),
  });
  await adminAction(page, "service.save", {
    name: "케어 시술",
    price: 50000,
    duration: 30,
    active: true,
    materials: [{ itemId: item.id, quantity: 100 }],
  });
  await page.reload();
  return (await state(page)).data;
}

test("실제 사용량 입력 → 금액 정정 재수납 → 금액 일부 환불이 재고를 한 번만 차감한다", async ({
  page,
}) => {
  const d = await seed(page);
  await goTo(page, "수납 · 환불");
  await page.getByRole("button", { name: "+ 수납 기록", exact: true }).click();
  await dialog(page)
    .getByLabel("담당 직원", { exact: true })
    .selectOption(d.staff[0].id);
  await dialog(page).getByRole("combobox", { name: "시술이나 상품 담기", exact: true }).fill(d.services[0].name);
  await dialog(page).getByRole("combobox", { name: "시술이나 상품 담기", exact: true }).press("Enter");
  await dialog(page)
    .getByText("실제 재료 사용량 조정", { exact: true })
    .click();
  await dialog(page)
    .getByLabel("케어 재료 실제 사용량 (ml)", { exact: true })
    .fill("150");
  await dialog(page)
    .getByLabel("사용량 변경 사유", { exact: true })
    .fill("긴 머리 실제 사용량");
  await dialog(page)
    .getByRole("checkbox", { name: /단말기 승인/ })
    .check();
  await dialog(page)
    .getByRole("button", { name: "수납 50,000원 기록", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await state(page)).data.items[0].qty).toBe(1350);
  await page
    .getByRole("button", { name: "방문 고객 결제 상세", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "금액 정정·재수납", exact: true })
    .click();
  await dialog(page)
    .getByLabel("케어 시술 정정 단가 (원)", { exact: true })
    .fill("30000");
  await dialog(page)
    .getByLabel("금액 정정 사유", { exact: true })
    .fill("단가 오입력");
  await dialog(page)
    .getByRole("checkbox", { name: /기존 결제 취소와/ })
    .check();
  await dialog(page)
    .getByRole("button", { name: "정정 기록 저장", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  let data = (await state(page)).data;
  expect(data.items[0].qty).toBe(1350);
  expect(data.transactions[1].total).toBe(30000);
  await page
    .getByRole("button", { name: "방문 고객 결제 상세", exact: true })
    .first()
    .click();
  await dialog(page)
    .getByRole("button", { name: "환불 기록", exact: true })
    .click();
  await dialog(page).getByRole("checkbox", { name: "케어 시술 환불", exact: true }).check();
  await dialog(page).getByRole("radio", { name: "금액 직접 입력", exact: true }).click();
  await dialog(page)
    .getByLabel("케어 시술 이번 환불 금액 (원)", { exact: true })
    .fill("10000");
  await dialog(page)
    .getByLabel("사유", { exact: true })
    .fill("고객 협의 일부 환불");
  await dialog(page)
    .getByRole("checkbox", { name: /고객에게.*환불을 완료/ })
    .check();
  await dialog(page)
    .getByRole("button", { name: "환불 10,000원 기록", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  data = (await state(page)).data;
  expect(data.refunds.at(-1).amount).toBe(10000);
  expect(data.items[0].qty).toBe(1350);
  await page
    .getByRole("button", { name: "방문 고객 결제 상세", exact: true })
    .first()
    .click();
  await expect(dialog(page)).toContainText("10,000원 금액 환불");
});

test("일부 입고 후 잔량 취소·분할 지급·반품·환급 금액을 화면에서 기록한다", async ({
  page,
}) => {
  const d = await seed(page);
  let r = await action(page, "supplier.save", {
    name: "검증 유통",
    contact: "",
    phone: "",
    note: "",
    active: true,
  });
  const supplierId = r.data.suppliers[0].id;
  r = await action(page, "purchase.create", {
    supplierId,
    date: today(),
    lines: [{ itemId: d.items[0].id, quantity: 3, unitCost: 20000 }],
  });
  const o = r.data.purchaseOrders[0];
  await action(page, "purchase.receive", {
    id: o.id,
    date: today(),
    lines: [{ lineId: o.lines[0].id, quantity: 2 }],
  });
  await page.reload();
  await goTo(page, "발주 · 거래처");
  await page
    .getByRole("button", { name: "검증 유통 케어 재료 발주 상세", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "미입고 잔량 취소", exact: true })
    .click();
  await dialog(page)
    .getByLabel("케어 재료 취소 개수", { exact: true })
    .fill("1");
  await dialog(page)
    .getByLabel("처리 사유 / 메모", { exact: true })
    .fill("품절로 잔량 취소");
  await dialog(page)
    .getByRole("button", { name: "미입고 잔량 취소 저장", exact: true })
    .click();
  await expect(
    dialog(page).getByText("배송완료", { exact: true }),
  ).toBeVisible();
  for (const amount of [10000, 30000]) {
    await dialog(page)
      .getByRole("button", { name: "분할 지급·환급", exact: true })
      .click();
    await dialog(page)
      .getByLabel("이번 정산 금액 (원)", { exact: true })
      .fill(String(amount));
    await dialog(page)
      .getByLabel("처리 사유 / 메모", { exact: true })
      .fill("이체 확인");
    await dialog(page)
      .getByRole("button", { name: "분할 지급·환급 저장", exact: true })
      .click();
    await expect(dialog(page)).toHaveAttribute("aria-labelledby", /./);
    await expect(
      dialog(page).getByRole("button", { name: "거래처 반품", exact: true }),
    ).toBeVisible();
  }
  await dialog(page)
    .getByRole("button", { name: "거래처 반품", exact: true })
    .click();
  await dialog(page)
    .getByLabel("케어 재료 반품 개수", { exact: true })
    .fill("1");
  await dialog(page)
    .getByLabel("처리 사유 / 메모", { exact: true })
    .fill("불량 실제 반품");
  await dialog(page)
    .getByRole("button", { name: "거래처 반품 저장", exact: true })
    .click();
  await expect(dialog(page)).toContainText("돌려받을 금액");
  await dialog(page)
    .getByRole("button", { name: "분할 지급·환급", exact: true })
    .click();
  await expect(
    dialog(page).getByLabel("정산 구분", { exact: true }),
  ).toHaveValue("refund");
  await dialog(page)
    .getByLabel("처리 사유 / 메모", { exact: true })
    .fill("반품 대금 반환 확인");
  await dialog(page)
    .getByRole("button", { name: "분할 지급·환급 저장", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "거래처 반품", exact: true }),
  ).toBeVisible();
  const latest = (await state(page)).data;
  expect(latest.items[0].qty).toBe(2000);
  expect(
    latest.purchaseOrders[0].changes
      .filter((c) => c.paymentDelta)
      .reduce((s, c) => s + c.paymentDelta, 0),
  ).toBe(20000);
});

test("원장이 복구 코드를 발급하고 로그인 화면에서 아이디 확인·비밀번호 재설정을 한다", async ({
  page,
}) => {
  await setupOwner(page);
  await goTo(page, "매장 설정");
  await page
    .getByRole("button", { name: "백업 · 이전 자료", exact: true })
    .click();
  await page
    .getByRole("button", { name: "복구 코드 발급", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "새 코드 발급", exact: true })
    .click();
  const input = page.getByLabel("일회용 복구 코드", { exact: true });
  await expect(input).toBeVisible();
  const code = await input.inputValue();
  expect(code).toHaveLength(43);
  await expect(page.getByText("자동 백업 상태", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "지금 잠그기", exact: true }).click();
  await page.getByRole('button', { name: /내 메뉴$/ }).click();
  await page.getByRole('menuitem', { name: '로그아웃', exact: true }).click();
  await dialog(page)
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await page
    .getByRole("button", { name: "아이디·비밀번호 찾기", exact: true })
    .click();
  await dialog(page).getByLabel("원장 복구 코드", { exact: true }).fill(code);
  await dialog(page)
    .getByLabel("새 비밀번호", { exact: true })
    .fill("Recovered-owner-password-2026");
  await dialog(page)
    .getByLabel("새 비밀번호 확인", { exact: true })
    .fill("Recovered-owner-password-2026");
  await dialog(page)
    .getByRole("button", { name: "원장 계정 복구", exact: true })
    .click();
  await expect(dialog(page)).toContainText(OWNER_EMAIL);
  await dialog(page)
    .getByRole("button", { name: "로그인으로 돌아가기", exact: true })
    .click();
  await expect(page.getByLabel("아이디", { exact: true })).toHaveValue(
    OWNER_EMAIL,
  );
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill("Recovered-owner-password-2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
});
