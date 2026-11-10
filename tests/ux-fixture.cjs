"use strict";
const { test: base, expect } = require("@playwright/test");
const { mkdtempSync, rmSync, cpSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../server/app.cjs");
const today = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const test = base.extend({
  privacyClock: async ({}, use) => {
    let offset = 0;
    await use({ now: () => Date.now() + offset, advance: milliseconds => { offset += milliseconds; } });
  },
  erpServer: async ({ privacyClock }, use) => {
    const directory = mkdtempSync(path.join(tmpdir(), "salon-ux-"));
    cpSync(path.join(__dirname, "../dist"), path.join(directory, "dist"), {
      recursive: true,
    });
    const { app, close } = createApp({
      dbPath: path.join(directory, "test.sqlite"),
      now: privacyClock.now,
      production: false,
      origin: "",
      bootstrapToken: "",
      distPath: path.join(directory, "dist"),
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    try {
      await use(`http://127.0.0.1:${server.address().port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  baseURL: async ({ erpServer }, use) => use(erpServer),
});
const OWNER_EMAIL = "owner@example.test";
const OWNER_PASSWORD = "Owner-test-password-2026!";
const ownerGrants = new WeakMap();
const trackingPages = new WeakSet();
function trackPrivateAccess(page) {
  if (trackingPages.has(page)) return;
  trackingPages.add(page);
  page.on("response", async response => {
    if (!response.url().endsWith("/api/auth/private/unlock") || !response.ok()) return;
    try {
      const grant = await response.json();
      if (grant.scope === "owner") ownerGrants.set(page, grant);
    } catch {}
  });
}
async function session(page) {
  const response = await page.request.get("/api/auth/me");
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function adminHeaders(page) {
  const current = await session(page);
  let grant = ownerGrants.get(page);
  if (grant) {
    const check = await page.request.get("/api/admin/state", { headers: { "X-Private-Token": grant.accessToken } });
    if (!check.ok()) grant = null;
  }
  if (!grant) {
    const response = await page.request.post("/api/auth/private/unlock", {
      headers: { "X-CSRF-Token": current.csrfToken },
      data: { scope: "owner", email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    grant = await response.json();
    ownerGrants.set(page, grant);
  }
  return { "X-CSRF-Token": current.csrfToken, "X-Private-Token": grant.accessToken };
}
async function adminState(page) {
  const response = await page.request.get("/api/admin/state", { headers: await adminHeaders(page) });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function adminAction(page, type, payload) {
  const headers = await adminHeaders(page);
  const response = await page.request.get("/api/admin/state", { headers });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { version } = await response.json();
  const saved = await page.request.post(`/api/actions/${type}`, {
    headers, data: { version, requestId: randomUUID(), payload },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  return saved.json();
}
async function unlockOwner(page) {
  trackPrivateAccess(page);
  const navigation = page.getByRole("navigation", { name: "원장 관리 메뉴" });
  if (await navigation.isVisible()) return;
  await page.getByRole("button", { name: "원장 관리", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "원장 관리 열기", exact: true });
  await dialog.getByLabel("원장 아이디", { exact: true }).fill(OWNER_EMAIL);
  await dialog.getByLabel("비밀번호", { exact: true }).fill(OWNER_PASSWORD);
  const granted = page.waitForResponse(response => response.url().endsWith("/api/auth/private/unlock") && response.ok());
  await dialog.getByRole("button", { name: "열기", exact: true }).click();
  ownerGrants.set(page, await (await granted).json());
  await expect(navigation).toBeVisible();
}
async function openPersonal(page, email, password) {
  await page.getByRole("button", { name: "내 급여명세", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "내 급여명세 본인 인증", exact: true });
  await expect(dialog).toContainText(email);
  await dialog.getByLabel("비밀번호", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "본인 인증", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내 급여명세서", exact: true })).toBeVisible();
}
async function setupOwner(page) {
  trackPrivateAccess(page);
  const response = await page.request.post("/api/bootstrap", {
    data: {
      storeName: "사용성 검증 매장",
      name: "검증 원장",
      email: "owner@example.test",
      password: "Owner-test-password-2026!",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  return response.json();
}
async function state(page) {
  const response = await page.request.get("/api/state");
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function action(page, type, payload) {
  const [{ version }, session] = await Promise.all([
    state(page),
    page.request.get("/api/auth/me").then((r) => r.json()),
  ]);
  const response = await page.request.post(`/api/actions/${type}`, {
    headers: { "X-CSRF-Token": session.csrfToken },
    data: { version, requestId: randomUUID(), payload },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function goTo(page, name) {
  const privateNames = { "직원 관리": "직원", "급여명세": "급여", "매장 설정": "설정", "매출 · 정산": "매출" };
  if (privateNames[name]) {
    await unlockOwner(page);
    await page.getByRole("navigation", { name: "원장 관리 메뉴" }).getByRole("button", { name: privateNames[name], exact: true }).click();
    return;
  }
  if (await page.getByRole("button", { name: "지금 잠그기", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "지금 잠그기", exact: true }).click();
  }
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name, exact: false }).click();
}
module.exports = {
  test, expect, setupOwner, state, action, goTo, today, session,
  adminState, adminAction, adminHeaders, unlockOwner, openPersonal, trackPrivateAccess,
  OWNER_EMAIL, OWNER_PASSWORD,
};
