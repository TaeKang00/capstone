const { test, expect } = require("@playwright/test");
const key = "salon-erp-prototype-v2";
const read = (page) =>
  page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k) || "null")?.data,
    key,
  );

test("existing screens render and a service sale can be replenished by manual receipt", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  for (const name of [
    "예약·일정",
    "고객 관리",
    "결제",
    "매출 관리",
    "직원 관리",
    "설정",
    "대시보드",
  ]) {
    await page
      .locator("nav")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "10:00 한지원 결제 시작", exact: true })
    .click();
  await page.getByLabel("할인 금액", { exact: true }).fill("10000");
  await page.getByRole("button", { name: /^결제 기록 완료 ·/ }).click();
  await expect(
    page.getByText("결제가 기록되었습니다", { exact: true }),
  ).toBeVisible();
  let data = await read(page);
  expect(data.items.find((i) => i.id === "i1").qty).toBe(140);
  const paid = data.txns.find((t) => t.resvId === "r1");
  expect(paid.total).toBe(90000);
  await page
    .locator("nav")
    .getByRole("button", { name: /^재고·입고/ })
    .click();
  const item = page.getByTestId("inventory-item-i1");
  await expect(item.getByTestId("stock-status")).toHaveText("보충 필요");
  await item.getByRole("button", { name: "입고 등록", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("추가 입고 수량", { exact: true })
    .fill("60");
  await page.getByRole("button", { name: "입고 저장", exact: true }).click();
  await expect(item.getByTestId("stock-qty")).toHaveText("200g");
  data = await read(page);
  expect(data.txns.find((t) => t.id === paid.id)).toEqual(paid);
  expect(errors).toEqual([]);
});

test("shared storage failure keeps payment draft and retry records the transaction once", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "10:00 한지원 결제 시작", exact: true })
    .click();
  await page.getByLabel("할인 금액", { exact: true }).fill("10000");
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("Test quota", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: /^결제 기록 완료 ·/ }).click();
  await expect(
    page.getByText("브라우저 저장 실패", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("결제가 기록되었습니다", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("할인 금액", { exact: true })).toHaveValue(
    "10000",
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem;
  });
  await page.getByRole("button", { name: /^결제 기록 완료 ·/ }).click();
  await expect(
    page.getByText("결제가 기록되었습니다", { exact: true }),
  ).toBeVisible();
  const data = await read(page);
  expect(data.txns.filter((t) => t.resvId === "r1")).toHaveLength(1);
  expect(data.items.find((i) => i.id === "i1").qty).toBe(140);
});
