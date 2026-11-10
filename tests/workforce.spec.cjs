"use strict";
const { test, expect, setupOwner, adminAction, adminState, action, goTo, unlockOwner, today } = require("./ux-fixture.cjs");

test("출근 기록, 휴가 신청과 원장 승인, 공지 확인이 화면에서 이어진다", async ({ page }) => {
  await setupOwner(page);
  await goTo(page, "근태 · 휴가");
  await expect(page.getByRole("heading", { name: "근태 · 휴가", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "출근하기", exact: true }).click();
  await expect(page.getByText("출근을 기록했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "퇴근하기", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "휴가 신청", exact: false }).first().click();
  const dialog = page.getByRole("dialog", { name: "휴가 신청", exact: true });
  await dialog.getByLabel("종류", { exact: true }).selectOption("sick");
  await dialog.getByLabel("사유 (선택)", { exact: true }).fill("병원 진료");
  await dialog.getByRole("button", { name: "신청하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name: "승인 대기" })).toBeVisible();

  // The owner dashboard lists the pending request and opens the HR area after re-authentication.
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "오늘의 매장" }).click();
  await expect(page.getByText("휴가·근무 신청 1건이 승인을 기다립니다.")).toBeVisible();
  await unlockOwner(page);
  await page.getByRole("navigation", { name: "원장 관리 메뉴" }).getByRole("button", { name: /인사 · 근태/ }).click();
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

  await goTo(page, "공지사항");
  await page.getByRole("button", { name: "공지 작성", exact: false }).click();
  const notice = page.getByRole("dialog", { name: "공지 작성", exact: true });
  await notice.getByLabel("제목", { exact: true }).fill("이번 주 재고 점검");
  await notice.getByLabel("내용", { exact: true }).fill("토요일 마감 후 실사를 진행합니다.");
  await notice.getByRole("button", { name: "저장", exact: true }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: /공지사항.*1/ })).toBeVisible();
  await page.getByRole("button", { name: /이번 주 재고 점검/ }).click();
  await expect(page.getByRole("dialog", { name: "이번 주 재고 점검" }).getByText("확인한 직원 1명")).toBeVisible();
  await page.getByRole("dialog", { name: "이번 주 재고 점검" }).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: /공지사항.*1/ })).toHaveCount(0);
});

test("지출을 등록하면 손익에 반영되고 증명서는 입사일이 있어야 발급된다", async ({ page }) => {
  await setupOwner(page);
  await unlockOwner(page);
  const nav = page.getByRole("navigation", { name: "원장 관리 메뉴" });
  await nav.getByRole("button", { name: /경비 · 손익/ }).click();
  await page.getByRole("button", { name: "지출 기록", exact: true }).click();
  await page.getByRole("button", { name: "지출 등록", exact: true }).click();
  const form = page.getByRole("dialog", { name: "지출 등록", exact: true });
  await form.getByLabel("분류", { exact: true }).selectOption("공과금");
  await form.getByLabel("금액 (원)", { exact: true }).fill("123000");
  await form.getByLabel("사용처 · 거래처", { exact: true }).fill("한국전력");
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("cell", { name: "한국전력" })).toBeVisible();
  await page.getByRole("button", { name: "손익 현황", exact: true }).click();
  await expect(page.locator(".profit-total")).toContainText("-123,000");

  await nav.getByRole("button", { name: /인사 · 근태/ }).click();
  await page.getByRole("button", { name: "증명서 발급", exact: true }).click();
  const owner = (await adminState(page)).data.staff[0];
  await page.getByLabel("직원", { exact: true }).selectOption(owner.id);
  await expect(page.getByText("직원 정보에 입사일이 없습니다.", { exact: false })).toBeVisible();
  await adminAction(page, "staff.save", { ...owner, hireDate: "2020-03-01", title: "원장" });
  await page.reload();
  await unlockOwner(page);
  await nav.getByRole("button", { name: /인사 · 근태/ }).click();
  await page.getByRole("button", { name: "증명서 발급", exact: true }).click();
  await page.getByLabel("직원", { exact: true }).selectOption(owner.id);
  await page.getByLabel("용도", { exact: true }).fill("금융기관 제출");
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole("button", { name: "발급하고 인쇄", exact: true }).click();
  await expect(page.getByText(`${today().slice(0, 4)}-0001 · 검증 원장`)).toBeVisible();
});

test("작은 화면에서 새 화면들이 가로로 넘치지 않는다", async ({ page }) => {
  await setupOwner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["근태 · 휴가", "공지사항"]) {
    await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
    await page.getByRole("dialog", { name: "매장 메뉴" }).getByRole("button", { name, exact: false }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page.getByRole("dialog", { name: "매장 메뉴" }).getByRole("button", { name: "원장 관리", exact: true }).click();
  const gate = page.getByRole("dialog", { name: "원장 관리 잠금 해제", exact: true });
  await gate.getByLabel("비밀번호", { exact: true }).fill("Owner-test-password-2026!");
  await gate.getByRole("button", { name: "원장 인증", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "원장 관리 메뉴" });
  for (const [button, heading] of [[/인사 · 근태/, "인사 · 근태"], [/경비 · 손익/, "경비 · 손익"]]) {
    await nav.getByRole("button", { name: button }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
});
