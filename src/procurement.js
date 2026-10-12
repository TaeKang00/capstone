(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SalonProcurement = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const received = (line, receipts) =>
    Math.round(
      (receipts || [])
        .filter((r) => r.orderLineId === line.id && r.status !== "cancelled")
        .reduce((sum, r) => sum + Number(r.qty) / line.packSize, 0) * 1000,
    ) / 1000;
  const adjusted = (order, line, kind) =>
    (order.changes || [])
      .filter((c) => c.adjustment === kind)
      .flatMap((c) => c.lines || [])
      .filter((l) => l.lineId === line.id)
      .reduce((s, l) => s + l.quantity, 0);
  const cancelled = (order, line) => adjusted(order, line, "cancel");
  const returned = (order, line) => adjusted(order, line, "return");
  const pending = (order, line, receipts) =>
    Math.max(
      0,
      line.quantity - cancelled(order, line) - received(line, receipts),
    );
  const originalTotal = (order) =>
    order.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const total = (order) =>
    order.cancelled
      ? 0
      : order.lines.reduce(
          (s, l) =>
            s +
            (l.quantity - cancelled(order, l) - returned(order, l)) *
              l.unitCost,
          0,
        );
  const paidAmount = (order) =>
    (order.changes || []).some((c) => Number.isSafeInteger(c.paymentDelta))
      ? order.changes
          .filter((c) => Number.isSafeInteger(c.paymentDelta))
          .reduce((s, c) => s + c.paymentDelta, 0)
      : order.paid
        ? originalTotal(order)
        : 0;
  const balance = (order) => total(order) - paidAmount(order);
  function status(order, receipts) {
    if (
      order.cancelled ||
      order.lines.every((l) => cancelled(order, l) >= l.quantity)
    )
      return "cancelled";
    if (
      order.lines.every(
        (l) => received(l, receipts) >= l.quantity - cancelled(order, l),
      )
    )
      return "delivered";
    if (order.lines.some((l) => received(l, receipts) > 0)) return "waiting";
    return order.shipped ? "shipping" : "waiting";
  }
  const labels = {
    waiting: "대기",
    shipping: "배송중",
    delivered: "배송완료",
    cancelled: "취소",
  };
  return {
    received,
    total,
    originalTotal,
    status,
    labels,
    cancelled,
    returned,
    pending,
    paidAmount,
    balance,
  };
});
