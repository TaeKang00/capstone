"use strict";
const { createApp } = require("./app.cjs");
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535.");
const { app, close } = createApp({
  onError(error) {
    console.error("Request failed:", error.code || error.name);
  },
});
const server = app.listen(port, host, () =>
  console.log(`Salon ERP server listening on http://${host}:${port}`),
);
function shutdown() {
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
