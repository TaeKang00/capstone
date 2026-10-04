export const todayInSeoul = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
export const money = (value) =>
  `${Number(value || 0).toLocaleString("ko-KR")}원`;
export const quantity = (value) =>
  Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
export const methodNames = { card: "카드", cash: "현금", transfer: "계좌이체" };
export const paymentNames = {
  paid: "결제 완료",
  partially_refunded: "일부 환불",
  refunded: "전체 환불",
};
export const monthStart = (date = todayInSeoul()) => `${date.slice(0, 7)}-01`;
// Spaces and phone-number separators should not prevent finding a customer.
export function matchesSearch(query, values) {
  const text = values
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
  const compact = text.replace(/[\s-]/g, "");
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every(
      (word) => text.includes(word) || compact.includes(word.replace(/-/g, "")),
    );
}
export function displayTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
export function refundedLines(data, transactionId) {
  return (data.refunds || [])
    .filter((r) => r.transactionId === transactionId)
    .reduce((result, refund) => {
      for (const line of refund.lines || []) {
        const prev = result[line.lineId] || { quantity: 0, amount: 0 };
        result[line.lineId] = {
          quantity:
            Math.round((prev.quantity + Number(line.quantity)) * 1000) / 1000,
          amount: prev.amount + Number(line.amount),
        };
      }
      return result;
    }, {});
}
export function refundEstimate(line, chosenQuantity, previous) {
  const old = previous || { quantity: 0, amount: 0 };
  const chosen = Number(chosenQuantity || 0);
  if (
    !line ||
    !Number.isFinite(chosen) ||
    chosen < 0 ||
    !Number.isSafeInteger(line.total) ||
    Number(line.quantity) <= 0
  )
    return 0;
  const original = Math.round(Number(line.quantity) * 1000);
  const cumulativeQuantity = Math.min(
    original,
    Math.round((old.quantity + chosen) * 1000),
  );
  const cumulative = Number(
    (BigInt(line.total) * BigInt(cumulativeQuantity)) / BigInt(original),
  );
  return Math.max(0, cumulative - old.amount);
}
