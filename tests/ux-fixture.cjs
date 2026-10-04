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
  erpServer: async ({}, use) => {
    const directory = mkdtempSync(path.join(tmpdir(), "salon-ux-"));
    cpSync(path.join(__dirname, "../dist"), path.join(directory, "dist"), {
      recursive: true,
    });
    const { app, close } = createApp({
      dbPath: path.join(directory, "test.sqlite"),
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
async function setupOwner(page) {
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
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("button", { name, exact: false })
    .click();
}
module.exports = { test, expect, setupOwner, state, action, goTo, today };
