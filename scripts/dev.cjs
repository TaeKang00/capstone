const { spawn } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const children = [
  spawn(process.execPath, ["--watch", "server/index.cjs"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development", PORT: "3001" },
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }),
];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  children.forEach((child) => child.kill());
  process.exitCode = code;
}
children.forEach((child) => {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
