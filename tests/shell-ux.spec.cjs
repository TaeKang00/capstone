"use strict";
const {
  test,
  expect,
  setupOwner,
  state,
  action,
  goTo,
  today,
} = require("./ux-fixture.cjs");

test("뒤로·앞으로 이동은 검색 조건을 유지하고 새로고침은 현재 업무 화면을 연다", async ({
  page,
}) => {
  await setupOwner(page);
  await goTo(page, "고객 관리");
  await page.getByLabel("고객 검색", { exact: true }).fill("다시 찾을 고객");
  await goTo(page, "재고 · 입고");
  await expect(page).toHaveURL(/#\/inventory$/);
  await page.goBack();
  await expect(page).toHaveURL(/#\/customers$/);
  await expect(page.getByLabel("고객 검색", { exact: true })).toHaveValue(
    "다시 찾을 고객",
  );
  await page.goForward();
  await expect(page).toHaveURL(/#\/inventory$/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "재고 · 입고", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/inventory$/);
});

test("브라우저 뒤로가기에서도 입력을 보호하고 폐기를 선택한 뒤에만 이동한다", async ({
  page,
}) => {
  await setupOwner(page);
  await goTo(page, "고객 관리");
  await page.getByRole("button", { name: "+ 고객 등록", exact: true }).click();
  await page.getByLabel("고객 이름 *", { exact: true }).fill("보존할 초안");
  await page.goBack();
  const confirm = page.getByRole("dialog", {
    name: "저장하지 않은 내용이 있습니다",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(/#\/customers$/);
  await confirm.getByRole("button", { name: "돌아가기", exact: true }).click();
  await expect(page.getByLabel("고객 이름 *", { exact: true })).toHaveValue(
    "보존할 초안",
  );
  await page.goBack();
  await expect(confirm).toBeVisible();
  await confirm
    .getByRole("button", { name: "변경 버리고 이동", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  await page.goForward();
  await expect(page).toHaveURL(/#\/customers$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("서버 동기화 실패를 알리고 다시 확인하면 기존 업무 화면에서 회복한다", async ({
  page,
}) => {
  await setupOwner(page);
  await goTo(page, "고객 관리");
  await page.route("**/api/state", (route) => route.abort("connectionfailed"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const banner = page.locator(".connection-banner");
  await expect(banner).toContainText("서버의 최신 내용을 확인하지 못했습니다");
  await expect(banner).toContainText("마지막으로 확인한 자료");
  await page.unroute("**/api/state");
  await banner.getByRole("button", { name: "연결 다시 확인" }).click();
  await expect(banner).toBeHidden();
  await expect(page).toHaveURL(/#\/customers$/);
  await expect(page.locator(".sync-status")).toContainText("동기화");
});

test("완료된 오전 예약 뒤에 오후 고객이 숨지 않으며 1인 매장을 설정 미완료로 표시하지 않는다", async ({
  page,
}) => {
  await setupOwner(page);
  let envelope = await action(page, "service.save", {
    name: "대시보드 확인 시술",
    price: 1000,
    duration: 30,
    materials: [],
    active: true,
  });
  const service = envelope.data.services[0],
    staff = envelope.data.staff[0];
  for (let index = 0; index < 9; index++) {
    envelope = await action(page, "appointment.save", {
      date: today(),
      start: 600 + index * 30,
      staffId: staff.id,
      serviceIds: [service.id],
      guestName: `완료 고객 ${index + 1}`,
      notes: "",
    });
    const appointment = envelope.data.appointments.at(-1);
    await action(page, "payment.create", {
      appointmentId: appointment.id,
      staffId: staff.id,
      lines: [{ type: "service", refId: service.id, quantity: 1 }],
      discount: 0,
      method: "cash",
      reference: "",
      notes: "",
    });
  }
  await action(page, "appointment.save", {
    date: today(),
    start: 900,
    staffId: staff.id,
    serviceIds: [service.id],
    guestName: "오후 다음 고객",
    notes: "",
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "시술 메뉴를 등록해 주세요" }),
  ).toHaveCount(0);
  await expect(page.locator(".timeline-row")).toHaveCount(1);
  await expect(page.locator(".timeline-row")).toContainText("오후 다음 고객");
  await page.getByRole("button", { name: "전체 10건", exact: true }).click();
  await expect(page.locator(".timeline-row")).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "남은 2건 더 보기 →" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "오늘 정산 확인 →" }).click();
  await expect(page.getByLabel("조회 시작일", { exact: true })).toHaveValue(
    today(),
  );
  await expect(page.getByLabel("조회 종료일", { exact: true })).toHaveValue(
    today(),
  );
});
