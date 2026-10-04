const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "../dist");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be an integer from 1 to 65535.");
if (!fs.existsSync(path.join(root, "index.html")))
  throw new Error("Build output missing. Run npm run build first.");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const insideRoot = (file) => {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
};
const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
  } catch {
    response.writeHead(400).end("Invalid path");
    return;
  }
  if (
    pathname.includes("\0") ||
    pathname.includes("\\") ||
    pathname.split("/").some((part) => part.startsWith("."))
  ) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  const file = path.resolve(
    root,
    "." + (pathname === "/" ? "/index.html" : pathname),
  );
  if (!insideRoot(file)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const realFile = await fsp.realpath(file);
    if (!insideRoot(realFile)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const stat = await fsp.stat(realFile);
    if (!stat.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type":
        types[path.extname(realFile)] || "application/octet-stream",
      "Content-Length": stat.size,
    });
    if (request.method === "HEAD") response.end();
    else
      fs.createReadStream(realFile)
        .on("error", () => response.destroy())
        .pipe(response);
  } catch (error) {
    response
      .writeHead(
        error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : 500,
      )
      .end("File unavailable");
  }
});
server.listen(port, host, () =>
  console.log(`Salon's local preview: http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
