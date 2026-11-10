// Printable documents (receipts, purchase orders) rendered in a hidden iframe.
// Every value interpolated into the HTML must pass through escapeHtml.
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}
export const printMoney = (value) =>
  `${Number(value || 0).toLocaleString("ko-KR")}원`;

const STYLE = `
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color: #111; font-size: 12px; margin: 0; }
  h1 { font-size: 22px; text-align: center; letter-spacing: 0.3em; margin: 0 0 18px; }
  .meta { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 14px; }
  .meta dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }
  .meta dt { color: #555; }
  .meta dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  .num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; }
  .note { margin-top: 14px; white-space: pre-wrap; }
  .footer { margin-top: 28px; text-align: right; }
  .logo { max-height: 48px; max-width: 160px; }
  .muted { color: #666; }
`;

/** Opens the browser print dialog for the given (already escaped) HTML body. */
export function printDocument(title, bodyHtml) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${bodyHtml}</body></html>`,
  );
  doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  frame.contentWindow.addEventListener("afterprint", cleanup, { once: true });
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.isConnected && frame.remove(), 60000);
  }, 50);
}

/** Store header block shared by printed documents. */
export function storeBlock(store = {}) {
  const rows = [
    ["상호", store.name],
    ["대표자", store.representative],
    ["사업자등록번호", store.businessNumber],
    ["주소", store.address],
    ["연락처", store.phone],
  ].filter(([, value]) => value);
  return `<dl>${rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("")}</dl>`;
}
export function logoTag(store = {}) {
  return /^data:image\/(png|jpeg|webp);base64,/.test(store.logo || "")
    ? `<img class="logo" alt="" src="${escapeHtml(store.logo)}">`
    : "";
}
