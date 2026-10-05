"use strict";
// A local, single-process launcher. Operational hosting still uses npm start.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const ROOT = path.resolve(__dirname, "..");
const STATUS_PATH = "/__salon_local_status";
const digest = (value) => createHash("sha256").update(value).digest("hex");

function npmCli() {
  const executableDir = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(executableDir, "node_modules/npm/bin/npm-cli.js"),
    path.resolve(executableDir, "../lib/node_modules/npm/bin/npm-cli.js"),
    ...(process.env.PATH || "").split(path.delimiter).map((directory) =>
      path.join(directory, "node_modules/npm/bin/npm-cli.js"),
    ),
  ];
  const found = candidates.find((file) => file && file.endsWith("npm-cli.js") && fs.existsSync(file));
  if (!found) throw new Error("npm을 찾을 수 없습니다. npm이 포함된 Node.js 24 이상을 설치해 주세요. https://nodejs.org/");
  return found;
}

function runNode(args, { root, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root, stdio: "inherit", signal,
      env: { ...process.env, NODE_ENV: "development" },
    });
    child.once("error", reject);
    child.once("exit", (code, reason) => {
      if (code === 0) resolve();
      else reject(new Error(`준비 작업이 종료되었습니다 (${reason || code}). 위 오류와 인터넷 연결을 확인해 주세요.`));
    });
  });
}

async function prepareProject({ root, signal }) {
  const lock = fs.readFileSync(path.join(root, "package-lock.json"));
  const fingerprint = digest(Buffer.concat([
    lock, Buffer.from(`${process.platform}/${process.arch}/${process.versions.node.split(".")[0]}`),
  ]));
  const stamp = path.join(root, "node_modules/.salon-local-ready");
  let installed = "";
  try { installed = fs.readFileSync(stamp, "utf8"); } catch {}
  const required = ["express/package.json", "react/package.json", "react-dom/package.json", "pretendard/package.json", "vite/bin/vite.js"];
  if (installed !== fingerprint || required.some((file) => !fs.existsSync(path.join(root, "node_modules", file)))) {
    console.log("[1/3] 필요한 패키지를 설치합니다. 처음 실행할 때는 인터넷 연결이 필요합니다.");
    await runNode([npmCli(), "ci", "--include=dev", "--no-audit", "--no-fund"], { root, signal });
    fs.writeFileSync(stamp, fingerprint);
  } else console.log("[1/3] 설치된 패키지를 확인했습니다.");
  console.log("[2/3] 최신 화면을 준비합니다.");
  await runNode([path.join(root, "node_modules/vite/bin/vite.js"), "build"], { root, signal });
}

async function checkExisting(url, identity, signal) {
  const read = async () => {
    const response = await fetch(url + STATUS_PATH, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
      redirect: "error",
    });
    if (!response.ok) throw new Error("NOT_LOCAL_LAUNCHER");
    const status = await response.json();
    if (status.application !== "salon-desk-local" || status.identity !== identity) throw new Error("NOT_LOCAL_LAUNCHER");
    return status;
  };
  let status;
  try { status = await read(); }
  catch { throw new Error(`${url} 주소를 다른 프로그램이나 다른 ERP 폴더에서 사용하고 있습니다. 기존 실행 창을 종료한 뒤 다시 실행해 주세요.`); }
  if (!status.ready) console.log("이미 같은 ERP를 준비 중입니다. 준비가 끝날 때까지 기다립니다.");
  const deadline = Date.now() + 10 * 60 * 1000;
  while (!status.ready) {
    if (Date.now() > deadline) throw new Error("준비 시간이 길어지고 있습니다. 먼저 실행한 창의 설치·오류 안내를 확인해 주세요.");
    await delay(500, undefined, { signal });
    try { status = await read(); }
    catch { throw new Error("먼저 실행한 ERP가 종료되었습니다. 해당 창의 오류를 확인하고 다시 실행해 주세요."); }
  }
}

async function startLocal(options = {}) {
  const root = fs.realpathSync(options.root || ROOT);
  const dbPath = path.resolve(root, options.dbPath || process.env.DB_PATH || "data/salon.sqlite");
  const port = options.port ?? Number(process.env.SALON_LOCAL_PORT || 4173);
  if (!Number.isInteger(port) || port < (options.port === 0 ? 0 : 1) || port > 65535) throw new Error("실행 포트는 1~65535 사이의 숫자여야 합니다.");
  const signal = options.signal || new AbortController().signal;
  signal.throwIfAborted();
  const identity = digest(`${root}\n${dbPath}`);
  let app, closeDatabase, ready = false, stopping;
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === STATUS_PATH) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ application: "salon-desk-local", identity, ready }));
    }
    if (app) return app(req, res);
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "2" });
    res.end("살롱 데스크를 준비하고 있습니다. 실행 창의 안내를 확인해 주세요.");
  });
  const stop = () => stopping ||= new Promise((resolve) => {
    signal.removeEventListener("abort", stop);
    ready = false;
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      if (closeDatabase) { closeDatabase(); closeDatabase = null; }
      resolve();
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    const url = `http://127.0.0.1:${port}`;
    await checkExisting(url, identity, signal);
    return { url, reused: true, stop: async () => {} };
  }
  const url = `http://127.0.0.1:${server.address().port}`;
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    await (options.prepare || prepareProject)({ root, signal });
    signal.throwIfAborted();
    const created = require("../server/app.cjs").createApp({
      production: false, origin: url, bootstrapToken: "", dbPath,
      distPath: options.distPath || path.join(root, "dist"),
      onError(error) { console.error("요청 처리 오류:", error.code || error.name); },
    });
    app = created.app;
    closeDatabase = created.close;
    ready = true;
    return { url, reused: false, stop };
  } catch (error) { await stop(); throw error; }
}

function openBrowser(url) {
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", windowsHide: true, detached: true });
  child.on("error", () => console.log(`브라우저를 직접 열고 ${url} 주소로 접속해 주세요.`));
  child.on("exit", (code) => { if (code) console.log(`브라우저를 직접 열고 ${url} 주소로 접속해 주세요.`); });
  child.unref();
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 이상이 필요합니다. https://nodejs.org/ 에서 설치 후 다시 실행해 주세요.");
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    const running = await startLocal({ signal: controller.signal });
    console.log(running.reused ? "이미 실행 중인 ERP를 엽니다." : "[3/3] ERP 실행 준비가 완료되었습니다.");
    console.log(`\n접속 주소: ${running.url}`);
    if (!running.reused) console.log("사용하는 동안 이 창을 열어 두세요. 종료: Ctrl+C 또는 이 창 닫기\n");
    if (!process.argv.includes("--no-browser")) openBrowser(running.url);
    if (running.reused) {
      process.removeListener("SIGINT", interrupted);
      process.removeListener("SIGTERM", interrupted);
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
}
if (require.main === module) main().catch((error) => { console.error(`\n실행 실패: ${error.message}\n`); process.exitCode = 1; });
module.exports = { startLocal, prepareProject };
