"use strict";
// A new temporary SQLite database for every browser-test run. Never use the store DB.
const { mkdtempSync, rmSync, cpSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createApp } = require("../server/app.cjs");
const port = Number(process.env.ERP_E2E_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("ERP_E2E_PORT must be a valid TCP port.");
const origin = `http://127.0.0.1:${port}`;
const directory = mkdtempSync(path.join(tmpdir(), "salon-erp-browser-"));
try {
  // Snapshot the compiled UI so a parallel development build cannot delete live test assets.
  cpSync(path.join(__dirname, "../dist"), path.join(directory, "dist"), {
    recursive: true,
  });
  const { app, close } = createApp({
    production: false,
    dbPath: path.join(directory, "e2e.sqlite"),
    distPath: path.join(directory, "dist"),
    origin,
    bootstrapToken: "",
  });
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`Isolated browser test server: ${origin}`),
  );
  const stop = () =>
    server.close(() => {
      close();
      rmSync(directory, { recursive: true, force: true });
      process.exit(0);
    });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
  server.on("error", (error) => {
    close();
    rmSync(directory, { recursive: true, force: true });
    console.error(error.message);
    process.exit(1);
  });
} catch (error) {
  rmSync(directory, { recursive: true, force: true });
  console.error(
    `Browser test server could not start. Run npm run build first. ${error.message}`,
  );
  process.exit(1);
}
