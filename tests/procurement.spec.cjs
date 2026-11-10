"use strict";
const {
  test,
  expect,
  setupOwner,
  goTo,
  state,
  today,
  action,
} = require("./ux-fixture.cjs");
const dialog = (page) => page.getByRole("dialog").last();
const close = async (page) =>
  dialog(page)
    .getByRole("button", { name: "닫기", exact: true })
    .first()
    .click();

test("로그인 후 거래처·분류·품목·시술 등록부터 발주·부분 입고·지급·시술 소모까지 한 바퀴 실행한다", async ({
  page,
}) => {
  await setupOwner(page);
  await goTo(page, "발주 · 거래처");
  await page.getByRole("tab", { name: "거래처", exact: true }).click();
  await page
    .getByRole("button", { name: "+ 거래처 등록", exact: true })
    .click();
  await dialog(page).getByLabel("거래처 이름", { exact: true }).fill("봄 유통");
  await dialog(page).getByLabel("담당자", { exact: true }).fill("김담당");
  await dialog(page).getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("봄 유통", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "품목 분류", exact: true }).click();
  await page.getByRole("button", { name: "+ 분류 등록", exact: true }).click();
  await dialog(page).getByLabel("분류 이름", { exact: true }).fill("두피 케어");
  await dialog(page).getByRole("button", { name: "저장", exact: true }).click();
  const categoryId = (await state(page)).data.itemCategories.find(
    (c) => c.name === "두피 케어",
  ).id;
  const supplierId = (await state(page)).data.suppliers[0].id;
  await goTo(page, "재고 · 입고");
  await page.getByRole("button", { name: "품목 등록", exact: true }).click();
  await dialog(page).getByLabel("품목 이름", { exact: true }).fill("케어 샴푸");
  await dialog(page)
    .getByLabel("품목 분류", { exact: true })
    .selectOption(categoryId);
  await dialog(page)
    .getByLabel("기본 거래처", { exact: true })
    .selectOption(supplierId);
  await dialog(page)
    .getByLabel("관리 단위", { exact: true })
    .selectOption("ml");
  await dialog(page).getByLabel("1개당 용량 (ml)", { exact: true }).fill("500");
  await dialog(page)
    .getByLabel("1개 입고 단가 (원)", { exact: true })
    .fill("20000");
  await dialog(page).getByLabel("보충 기준 (ml)", { exact: true }).fill("500");
  await dialog(page)
    .getByRole("button", { name: "품목 등록", exact: true })
    .click();
  await expect(
    page.getByText("케어 샴푸", { exact: true }).first(),
  ).toBeVisible();
  const itemId = (await state(page)).data.items[0].id;
  await page
    .getByLabel("품목 분류별 조회", { exact: true })
    .selectOption(categoryId);
  await expect(page.locator("tbody")).toContainText("케어 샴푸");
  await page
    .getByRole("button", { name: "시술 · 재료 설정", exact: true })
    .click();
  const gate = page.getByRole("dialog", {
    name: "원장 관리 열기",
    exact: true,
  });
  await gate
    .getByLabel("원장 아이디", { exact: true })
    .fill("owner@example.test");
  await gate
    .getByLabel("비밀번호", { exact: true })
    .fill("Owner-test-password-2026!");
  await gate.getByRole("button", { name: "열기", exact: true }).click();
  await page.getByRole("button", { name: "＋ 시술 등록", exact: true }).click();
  await dialog(page)
    .getByLabel("시술 이름", { exact: true })
    .fill("두피 케어 시술");
  await dialog(page)
    .getByLabel("기본 가격 (원)", { exact: true })
    .fill("30000");
  await dialog(page).getByLabel("소요시간 (분)", { exact: true }).fill("30");
  await dialog(page)
    .getByRole("button", { name: /재료 추가/ })
    .click();
  await dialog(page).getByLabel("재료", { exact: true }).selectOption(itemId);
  await dialog(page).getByLabel("소모 수량", { exact: true }).fill("100");
  await dialog(page)
    .getByRole("button", { name: "시술 저장", exact: true })
    .click();
  await goTo(page, "발주 · 거래처");
  await page.getByRole("tab", { name: "발주 내역", exact: true }).click();
  await page.getByRole("button", { name: "+ 발주 등록", exact: true }).click();
  await dialog(page)
    .getByLabel("발주 거래처", { exact: true })
    .selectOption(supplierId);
  await dialog(page)
    .getByRole("checkbox", { name: "케어 샴푸 발주 선택", exact: true })
    .check();
  await dialog(page)
    .getByLabel("케어 샴푸 발주 개수", { exact: true })
    .fill("3");
  await expect(dialog(page)).toContainText("60,000");
  await dialog(page)
    .getByRole("button", { name: "발주 등록", exact: true })
    .click();
  await page
    .getByRole("button", { name: "봄 유통 케어 샴푸 발주 상세", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "배송 시작 기록", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "배송 시작 기록 저장", exact: true })
    .click();
  await expect(dialog(page).getByText("배송중", { exact: true })).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "입고 수량 입력", exact: true })
    .click();
  await dialog(page)
    .getByLabel("케어 샴푸 이번 입고 개수", { exact: true })
    .fill("1");
  await dialog(page)
    .getByRole("button", { name: "발주 입고 저장", exact: true })
    .click();
  await expect(dialog(page).getByText("대기", { exact: true })).toBeVisible();
  expect((await state(page)).data.items[0].qty).toBe(500);
  await close(page);
  await page.getByLabel("배송 상태", { exact: true }).selectOption("waiting");
  await expect(page.locator("tbody")).toContainText("부분 입고");
  await page
    .getByRole("button", { name: "봄 유통 케어 샴푸 발주 상세", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "입고 수량 입력", exact: true })
    .click();
  await dialog(page)
    .getByLabel("케어 샴푸 이번 입고 개수", { exact: true })
    .fill("2");
  await dialog(page)
    .getByRole("button", { name: "발주 입고 저장", exact: true })
    .click();
  await expect(
    dialog(page).getByText("배송완료", { exact: true }),
  ).toBeVisible();
  expect((await state(page)).data.items[0].qty).toBe(1500);
  await dialog(page)
    .getByRole("button", { name: "대금 지급 기록", exact: true })
    .click();
  await dialog(page)
    .getByLabel("처리 사유 / 메모", { exact: true })
    .fill("거래처 대금 이체 확인");
  await dialog(page)
    .getByRole("button", { name: "대금 지급 기록 저장", exact: true })
    .click();
  await expect(dialog(page)).toContainText("대금 지급 완료");
  await close(page);
  await goTo(page, "수납 · 환불");
  await page.getByRole("button", { name: "+ 수납 기록", exact: true }).click();
  const data = (await state(page)).data;
  await dialog(page)
    .getByLabel("담당 직원", { exact: true })
    .selectOption(data.staff[0].id);
  await dialog(page).getByRole("combobox", { name: "시술이나 상품 담기", exact: true }).fill(data.services[0].name);
  await dialog(page).getByRole("combobox", { name: "시술이나 상품 담기", exact: true }).press("Enter");
  await dialog(page)
    .getByRole("checkbox", { name: /단말기 승인/ })
    .check();
  await dialog(page)
    .getByRole("button", { name: "수납 30,000원 기록", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await state(page)).data.items[0].qty).toBe(1400);
  await goTo(page, "재고 · 입고");
  await page.getByRole("tab", { name: "재고 변동 이력", exact: true }).click();
  await expect(page.locator("tbody")).toContainText("수납 사용");
  await expect(page.locator("tbody")).toContainText("100");
});

test("거래처 미사용 필터와 모바일 간편 발주 입력, 오류 후 입력 보존", async ({
  page,
}) => {
  await setupOwner(page);
  let result = await action(page, "supplier.save", {
    name: "모바일 공급사",
    contact: "",
    phone: "",
    note: "",
    active: true,
  });
  const supplierId = result.data.suppliers[0].id;
  await action(page, "inventory.item", {
    name: "모바일 재료",
    kind: "시술 재료",
    unit: "ml",
    packSize: 500,
    supplierId,
    min: 100,
    price: 0,
    purchasePrice: 10000,
    active: true,
  });
  await page.reload();
  await goTo(page, "발주 · 거래처");
  await page.getByRole("button", { name: "+ 발주 등록", exact: true }).click();
  await dialog(page)
    .getByLabel("발주 거래처", { exact: true })
    .selectOption(supplierId);
  await dialog(page)
    .getByRole("checkbox", { name: "모바일 재료 발주 선택", exact: true })
    .check();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await dialog(page)
    .getByLabel("모바일 재료 발주 개수", { exact: true })
    .fill("2");
  await page.route(
    "**/api/actions/purchase.create",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "TEMP_UNAVAILABLE", message: "연결을 확인해 주세요." },
        }),
      }),
    { times: 1 },
  );
  await dialog(page)
    .getByRole("button", { name: "발주 등록", exact: true })
    .click();
  await expect(dialog(page).getByRole("alert")).toContainText("연결을 확인");
  await expect(
    dialog(page).getByLabel("모바일 재료 발주 개수", { exact: true }),
  ).toHaveValue("2");
  await dialog(page)
    .getByRole("button", { name: "발주 등록", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "모바일 공급사 모바일 재료 발주 상세",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "거래처", exact: true }).click();
  await page
    .getByRole("button", { name: "모바일 공급사 수정", exact: true })
    .click();
  await dialog(page)
    .getByLabel("사용 상태", { exact: true })
    .selectOption("false");
  await dialog(page).getByRole("button", { name: "저장", exact: true }).click();
  // Wait for the supplier dialog (which has its own 사용 상태 field) to close.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("사용 상태", { exact: true }).selectOption("inactive");
  await expect(page.locator("tbody")).toContainText("모바일 공급사");
});
