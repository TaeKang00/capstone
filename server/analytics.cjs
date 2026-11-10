"use strict";
// Sales breakdown for the owner's analysis screen: per designer, per service/product
// and per payment method, with a daily series for each entry and the previous period.
const DAY = 86400000;
const METHOD_NAMES = { card: "카드", cash: "현금", transfer: "계좌이체" };
const fail = (message) => {
  const error = new Error(message);
  error.status = 422;
  error.code = "VALIDATION_ERROR";
  throw error;
};
const isDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const shift = (value, days) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);

function collect(data, from, to) {
  const days = [];
  for (let day = from; day <= to; day = shift(day, 1)) days.push(day);
  const index = new Map(days.map((day, i) => [day, i]));
  const byTransaction = new Map(
    (data.transactions || []).map((entry) => [entry.id, entry]),
  );
  const dims = { staff: new Map(), service: new Map(), method: new Map() };
  const total = {
    net: 0,
    count: 0,
    series: days.map(() => 0),
    seriesCount: days.map(() => 0),
  };
  const record = (dim, key, name) => {
    const map = dims[dim];
    if (!map.has(key))
      map.set(key, {
        key,
        name,
        net: 0,
        count: 0,
        series: days.map(() => 0),
        seriesCount: days.map(() => 0),
        cross: new Map(),
      });
    return map.get(key);
  };
  const staffName = (id) =>
    (data.staff || []).find((entry) => entry.id === id)?.name || "기록된 직원";
  const lineName = (line) =>
    ((line.type === "service" ? data.services : data.items) || []).find(
      (entry) => entry.id === line.refId,
    )?.name ||
    line.name ||
    "기록된 항목";
  const lineKey = (line) => `${line.type}:${line.refId}`;
  for (const tx of data.transactions || []) {
    const i = index.get(tx.date);
    if (i == null) continue;
    total.net += tx.total;
    total.count += 1;
    total.series[i] += tx.total;
    total.seriesCount[i] += 1;
    const staff = record("staff", tx.staffId, staffName(tx.staffId));
    staff.net += tx.total;
    staff.count += 1;
    staff.series[i] += tx.total;
    staff.seriesCount[i] += 1;
    const method = record("method", tx.method, METHOD_NAMES[tx.method] || tx.method);
    method.net += tx.total;
    method.count += 1;
    method.series[i] += tx.total;
    method.seriesCount[i] += 1;
    for (const line of tx.lines || []) {
      const quantity = Number(line.quantity) || 0;
      const amount = Number(line.total) || 0;
      const item = record("service", lineKey(line), lineName(line));
      item.net += amount;
      item.count += quantity;
      item.series[i] += amount;
      item.seriesCount[i] += quantity;
      const name = lineName(line);
      staff.cross.set(name, (staff.cross.get(name) || 0) + quantity);
      const designer = staffName(tx.staffId);
      item.cross.set(designer, (item.cross.get(designer) || 0) + quantity);
    }
  }
  for (const refund of data.refunds || []) {
    const i = index.get(refund.date);
    if (i == null) continue;
    const original = byTransaction.get(refund.transactionId);
    total.net -= refund.amount;
    total.series[i] -= refund.amount;
    if (original) {
      const staff = record("staff", original.staffId, staffName(original.staffId));
      staff.net -= refund.amount;
      staff.series[i] -= refund.amount;
    }
    const method = record("method", refund.method, METHOD_NAMES[refund.method] || refund.method);
    method.net -= refund.amount;
    method.series[i] -= refund.amount;
    for (const refundLine of refund.lines || []) {
      const line = original?.lines?.find((x) => x.id === refundLine.lineId);
      if (!line) continue;
      const item = record("service", lineKey(line), lineName(line));
      const amount = Number(refundLine.amount) || 0;
      item.net -= amount;
      item.series[i] -= amount;
    }
  }
  return { days, dims, total };
}

function getBreakdown(data, options = {}) {
  const { from, to } = options;
  if (!isDate(from) || !isDate(to)) fail("조회 기간을 확인해 주세요.");
  if (from > to) fail("시작일은 종료일보다 늦을 수 없습니다.");
  const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
  if (length > 367) fail("조회 기간은 367일 이내로 선택해 주세요.");
  const current = collect(data, from, to);
  const previous = collect(data, shift(from, -length), shift(from, -1));
  const shape = (dim) =>
    [...current.dims[dim].values()]
      .map(({ cross, ...entry }) => ({
        ...entry,
        prevNet: previous.dims[dim].get(entry.key)?.net || 0,
        top: [...cross.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
          .slice(0, 3)
          .map(([name, count]) => ({ name, count })),
      }))
      .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, "ko"));
  return {
    from,
    to,
    previousFrom: shift(from, -length),
    previousTo: shift(from, -1),
    days: current.days,
    total: { ...current.total, prevNet: previous.total.net },
    dims: { staff: shape("staff"), service: shape("service"), method: shape("method") },
  };
}

module.exports = { getBreakdown };
