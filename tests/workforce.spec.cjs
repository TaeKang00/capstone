"use strict";
const { test, expect, setupOwner, adminAction, adminState, action, goTo, unlockOwner, today } = require("./ux-fixture.cjs");

test("출근 기록, 휴가 신청과 원장 승인이 화면에서 이어진다", async ({ page }) => {
  await setupOwner(page);
  await goTo(page, "근태 · 휴가");
  await expect(page.getByRole("heading", { name: "근태와 휴가", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "출근하기", exact: true }).click();
  await expect(page.getByText("출근을 기록했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "퇴근하기", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "휴가 신청", exact: false }).first().click();
  const dialog = page.getByRole("dialog", { name: "휴가 신청", exact: true });
  await dialog.getByRole("radio", { name: "병가", exact: true }).click();
  await dialog.getByLabel("사유", { exact: true }).fill("병원 진료");
  await dialog.getByRole("button", { name: "신청하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("region", { name: "내 신청" })).toContainText("승인 대기");

  // The owner dashboard lists the pending request and opens the HR area after re-authentication.
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "오늘의 매장" }).click();
  await expect(page.getByText("휴가 신청 1건 승인 대기")).toBeVisible();
  await unlockOwner(page);
  await page.getByRole("navigation", { name: "원장 관리 메뉴" }).getByRole("button", { name: /근태와 휴가/ }).click();
  await page.getByRole("button", { name: "승인", exact: true }).click();
  const approve = page.getByRole("dialog", { name: /병가 승인/ });
  await approve.getByRole("button", { name: "승인", exact: true }).click();
  await expect(approve).toBeHidden();
  const admin = await adminState(page);
  expect(admin.data.staffRequests[0].status).toBe("approved");

  // Approved leave blocks bookings for that staff member on the server.
  const service = (await adminAction(page, "service.save", { name: "휴가 확인 시술", price: 1000, duration: 30, materials: [], active: true })).data.services[0];
  await page.getByRole("button", { name: "지금 잠그기", exact: true }).click();
  const staffId = admin.data.staff[0].id;
  const blocked = await page.request.post("/api/actions/appointment.save", {
    headers: { "X-CSRF-Token": (await (await page.request.get("/api/auth/me")).json()).csrfToken },
    data: {
      version: (await (await page.request.get("/api/state")).json()).version,
      requestId: `leave-check-${Date.now()}`,
      payload: { date: today(), start: 600, staffId, serviceIds: [service.id], guestName: "휴가 확인", guestPhone: "", notes: "" },
    },
  });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error.code).toBe("STAFF_ON_LEAVE");

});

test("재직증명서는 입사일이 있어야 발급된다", async ({ page }) => {
  await setupOwner(page);
  await unlockOwner(page);
  const nav = page.getByRole("navigation", { name: "원장 관리 메뉴" });
  await nav.getByRole("button", { name: /근태와 휴가/ }).click();
  await page.getByRole("button", { name: "증명서 발급", exact: true }).click();
  const owner = (await adminState(page)).data.staff[0];
  await page.getByLabel("직원", { exact: true }).selectOption(owner.id);
  await expect(page.getByText("직원 정보에 입사일이 없습니다.", { exact: false })).toBeVisible();
  await adminAction(page, "staff.save", { ...owner, hireDate: "2020-03-01", title: "원장" });
  await page.reload();
  await unlockOwner(page);
  await nav.getByRole("button", { name: /근태와 휴가/ }).click();
  await page.getByRole("button", { name: "증명서 발급", exact: true }).click();
  await page.getByLabel("직원", { exact: true }).selectOption(owner.id);
  await page.getByLabel("용도", { exact: true }).fill("금융기관 제출");
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole("button", { name: "발급하고 인쇄", exact: true }).click();
  await expect(page.getByText(`재직증명서 ${today().slice(0, 4)}-0001`)).toBeVisible();
});

test("작은 화면에서 새 화면들이 가로로 넘치지 않는다", async ({ page }) => {
  await setupOwner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, heading] of [["근태 · 휴가", "근태와 휴가"], ["예약 일정", null], ["고객 관리", "고객"]]) {
    await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
    await page.getByRole("dialog", { name: "매장 메뉴" }).getByRole("button", { name, exact: false }).click();
    if (heading) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("dialog", { name: "매장 메뉴" }).getByRole("button", { name: "원장 관리", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "원장 관리 열기", exact: true });
  await gate.getByLabel("비밀번호", { exact: true }).fill("Owner-test-password-2026!");
  await gate.getByRole("button", { name: "열기", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "원장 관리 메뉴" });
  for (const [button, heading] of [[/근태와 휴가/, "근태와 휴가"], [/^매출$/, "매출"]]) {
    await nav.getByRole("button", { name: button }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});
