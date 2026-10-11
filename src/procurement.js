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
  const total = (order) =>
    order.lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
  function status(order, receipts) {
    if (order.cancelled) return "cancelled";
    if (order.lines.every((l) => received(l, receipts) >= l.quantity))
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
  return { received, total, status, labels };
});
