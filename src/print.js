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
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color: #111; font-size: 14px; line-height: 20px; font-weight: 500; margin: 0; font-variant-numeric: tabular-nums; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 24px; }
  h2 { font-size: 16px; line-height: 24px; font-weight: 600; margin: 24px 0 8px; }
  p { margin: 0; }
  .doc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
  .doc-head h1 { margin: 0; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .brand-dot { width: 12px; height: 12px; border-radius: 999px; background: #111; }
  .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
  .meta > *, .box { padding: 12px 16px; border-radius: 12px; background: #F4F4F6; }
  .meta dl, dl.kv { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
  .meta dt, dl.kv dt, .label { color: #555; font-size: 12px; line-height: 16px; font-weight: 600; }
  .meta dd, dl.kv dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 8px 12px; text-align: left; vertical-align: top; border: 0; border-bottom: 1px solid #E4E4E7; }
  th { color: #555; font-size: 12px; line-height: 16px; font-weight: 600; background: transparent; border-bottom: 1px solid #111; }
  .num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; border-bottom: 0; border-top: 1px solid #111; }
  .total { margin-top: 16px; padding: 16px; border-radius: 12px; border: 2px solid #111; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .total strong { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; }
  .pill { display: inline-block; height: 24px; padding: 0 8px; border-radius: 999px; border: 1px solid #111; font-size: 12px; line-height: 22px; font-weight: 600; }
  .note { margin-top: 16px; padding: 12px 16px; border-radius: 12px; background: #F4F4F6; white-space: pre-wrap; }
  .footer { margin-top: 32px; display: flex; justify-content: flex-end; align-items: center; gap: 16px; text-align: right; }
  .sign { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border: 2px solid #111; border-radius: 999px; font-weight: 700; }
  .logo { max-height: 48px; max-width: 160px; }
  .muted, .small { color: #666; font-size: 12px; line-height: 16px; }
  .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 16px; }
  .receipt { width: 80mm; margin: 0 auto; font-size: 12px; line-height: 16px; }
  .receipt h1 { font-size: 18px; line-height: 24px; text-align: center; margin-bottom: 12px; }
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
