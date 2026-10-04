const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const template = read("src/template.html");
const marker = "/* APP_LOGIC */";
if (template.split(marker).length !== 2)
  throw new Error("Template must contain exactly one APP_LOGIC marker.");

const dependencies = [
  {
    source: "react/umd/react.production.min.js",
    target: "react.js",
    url: "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
    integrity:
      "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z",
  },
  {
    source: "react-dom/umd/react-dom.production.min.js",
    target: "react-dom.js",
    url: "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
    integrity:
      "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1",
  },
  {
    source: "@babel/standalone/babel.min.js",
    target: "babel.js",
    url: "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js",
    integrity:
      "sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y",
  },
];

let support = read("public/vendor/support.js");
for (const dependency of dependencies) {
  const bytes = fs.readFileSync(
    path.join(root, "node_modules", dependency.source),
  );
  const actual =
    "sha384-" + crypto.createHash("sha384").update(bytes).digest("base64");
  if (actual !== dependency.integrity)
    throw new Error(`Integrity check failed: ${dependency.source}`);
  if (!support.includes(dependency.url))
    throw new Error(`Missing runtime dependency URL: ${dependency.url}`);
  support = support.replaceAll(dependency.url, `./vendor/${dependency.target}`);
}

fs.mkdirSync(path.join(dist, "vendor"), { recursive: true });
fs.mkdirSync(path.join(dist, "fonts"), { recursive: true });
fs.mkdirSync(path.join(dist, "licenses"), { recursive: true });
fs.writeFileSync(
  path.join(dist, "index.html"),
  template.replace(marker, () => read("src/app.js")),
);
for (const filename of ["inventory.js", "styles.css"]) {
  fs.copyFileSync(path.join(root, "src", filename), path.join(dist, filename));
}
fs.writeFileSync(path.join(dist, "vendor/support.js"), support);
for (const dependency of dependencies) {
  fs.copyFileSync(
    path.join(root, "node_modules", dependency.source),
    path.join(dist, "vendor", dependency.target),
  );
}
for (const weight of ["Regular", "Bold"]) {
  const filename = `Pretendard-${weight}.woff2`;
  fs.copyFileSync(
    path.join(root, "node_modules/pretendard/dist/web/static/woff2", filename),
    path.join(dist, "fonts", filename),
  );
}
fs.copyFileSync(
  path.join(root, "public/fonts/OFL.txt"),
  path.join(dist, "licenses/Pretendard-OFL.txt"),
);
for (const packageName of ["react", "react-dom", "@babel/standalone"]) {
  fs.copyFileSync(
    path.join(root, "node_modules", packageName, "LICENSE"),
    path.join(
      dist,
      "licenses",
      packageName.replaceAll("/", "-") + "-LICENSE.txt",
    ),
  );
}
console.log(
  "Built dist/index.html with local, integrity-checked runtime assets.",
);
