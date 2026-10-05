"use strict";
const { test, expect, setupOwner, adminAction, action, goTo, today } = require("./ux-fixture.cjs");

function previousMonth() {
  const [year, month] = today().split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

test("드롭다운은 펼친 목록과 키보드로 선택하고 Escape가 작성 창을 닫지 않는다", async ({ page }) => {
  await setupOwner(page);
  const result = await adminAction(page, "staff.save", {
    name: "선택 확인 디자이너", phone: "", role: "designer", status: "active",
    workingDays: [0, 1, 2, 3, 4, 5, 6], startMinutes: 600, endMinutes: 1200,
    breakStart: null, breakEnd: null,
  });
  const staff = result.data.staff.find((row) => row.name === "선택 확인 디자이너");
  await page.reload();
  await goTo(page, "매출 · 정산");
  const select = page.getByLabel("담당 직원", { exact: true });
  await select.click();
  await page.getByRole("option", { name: staff.name, exact: true }).click();
  await expect(select).toHaveValue(staff.id);
  await select.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("");
  await goTo(page, "직원 관리");
  await page.getByRole("button", { name: "＋ 직원 등록", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "직원 등록", exact: true });
  const role = dialog.getByLabel("역할", { exact: true });
  await role.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await role.click();
  await page.getByRole("option", { name: "접수 직원", exact: true }).click();
  await expect(role).toHaveValue("reception");
});

test("달력에서 선택한 날짜로 조회하고 기간 제한과 직접 입력을 유지한다", async ({ page }) => {
  await setupOwner(page);
  await goTo(page, "매출 · 정산");
  const month = previousMonth();
  const from = page.getByLabel("조회 시작일", { exact: true });
  const to = page.getByLabel("조회 종료일", { exact: true });
  await from.fill(`${month}-09`);
  await to.fill(`${month}-20`);
  await page.getByRole("button", { name: "조회 시작일 달력 열기", exact: true }).click();
  const startPicker = page.getByRole("dialog", { name: "조회 시작일 날짜 선택", exact: true });
  await startPicker.locator(`[data-date-key="${month}-12"]`).click();
  await expect(from).toHaveValue(`${month}-12`);
  await expect(from).toBeFocused();
  await expect(startPicker).toBeHidden();
  await page.getByRole("button", { name: "조회 종료일 달력 열기", exact: true }).click();
  const endPicker = page.getByRole("dialog", { name: "조회 종료일 날짜 선택", exact: true });
  await expect(endPicker.locator(`[data-date-key="${month}-11"]`)).toBeDisabled();
  await expect(endPicker.getByRole("button", { name: "선택 지우기" })).toHaveCount(0);
  await endPicker.locator(`[data-date-key="${month}-18"]`).click();
  await expect(to).toHaveValue(`${month}-18`);
  await page.getByRole("button", { name: "조회", exact: true }).click();
  await expect(page.locator("p.commerce-note").filter({ hasText: `${month}-12 ~ ${month}-18` })).toBeVisible();
  await to.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(endPicker).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(to).toHaveValue(`${month}-17`);
  await from.fill(`${month}-10`);
  await expect(from).toHaveValue(`${month}-10`);
});

test("작성 중 달력의 Escape는 달력만 닫고 월 선택과 선택 지우기를 지원한다", async ({ page }) => {
  await setupOwner(page);
  await page.getByRole("button", { name: "＋ 예약 등록", exact: true }).click();
  const appointment = page.getByRole("dialog", { name: "새 예약 등록", exact: true });
  await appointment.getByLabel("예약자 이름 *", { exact: true }).fill("입력 보존 확인");
  await appointment.getByRole("button", { name: "예약 날짜 * 달력 열기", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "예약 날짜 * 날짜 선택", exact: true });
  await expect(calendar).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar).toBeHidden();
  await expect(appointment).toBeVisible();
  await expect(appointment.getByLabel("예약자 이름 *", { exact: true })).toHaveValue("입력 보존 확인");
  await expect(page.getByRole("dialog", { name: "작성 중인 내용을 닫을까요?" })).toHaveCount(0);
  await appointment.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "내용 버리고 닫기", exact: true }).click();

  await goTo(page, "급여명세");
  const monthInput = page.getByLabel("귀속월", { exact: true });
  const selectedMonth = previousMonth();
  await monthInput.fill(selectedMonth);
  await page.getByRole("button", { name: "귀속월 월 선택 열기", exact: true }).click();
  const monthPicker = page.getByRole("dialog", { name: "귀속월 월 선택", exact: true });
  await monthPicker.locator(`[data-date-key="${selectedMonth.slice(0, 4)}-01"]`).click();
  await expect(monthInput).toHaveValue(`${selectedMonth.slice(0, 4)}-01`);
  await monthInput.fill("2000-01");
  await page.getByRole("button", { name: "귀속월 월 선택 열기", exact: true }).click();
  await expect(monthPicker.getByRole("button", { name: "이전 연도", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");

  await goTo(page, "수납 · 환불");
  const start = page.getByLabel("결제 시작일", { exact: true });
  await start.fill(`${selectedMonth}-01`);
  await page.getByRole("button", { name: "결제 시작일 달력 열기", exact: true }).click();
  await page.getByRole("dialog", { name: "결제 시작일 날짜 선택", exact: true }).getByRole("button", { name: "선택 지우기", exact: true }).click();
  await expect(start).toHaveValue("");
});

test("작은 화면에서도 달력이 화면 안에 열리고 바깥 클릭으로 닫힌다", async ({ page }) => {
  await setupOwner(page);
  await goTo(page, "매출 · 정산");
  await page.setViewportSize({ width: 390, height: 740 });
  await page.getByRole("button", { name: "조회 종료일 달력 열기", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "조회 종료일 날짜 선택", exact: true });
  await expect(picker).toBeVisible();
  const bounds = await picker.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(740);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const before = await page.getByLabel("조회 종료일", { exact: true }).inputValue();
  await page.locator(".private-workspace-identity").click();
  await expect(picker).toBeHidden();
  await expect(page.getByLabel("조회 종료일", { exact: true })).toHaveValue(before);
});
