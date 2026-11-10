"use strict";
// Simplified profit & loss for a single salon. Accrual-style approximations:
// sales on payment/refund date, purchases on receipt/return date, payroll by
// pay month (finalized/paid only), expenses on expense date.
const { getReport } = require("./commerce.cjs");
const procurement = require("../src/procurement.js");

const month = (value) => value.slice(0, 7);
function monthsBetween(from, to) {
  const result = [];
  for (let cursor = month(from); cursor <= month(to); ) {
    result.push(cursor);
    const [year, m] = cursor.split("-").map(Number);
    cursor =
      m === 12
        ? `${year + 1}-01`
        : `${year}-${String(m + 1).padStart(2, "0")}`;
  }
  return result;
}
const round = (value) => Math.round(value);

function purchaseCosts(data, from, to) {
  const inRange = (day) => day >= from && day <= to;
  const lines = new Map();
  for (const order of data.purchaseOrders || [])
    for (const line of order.lines || []) lines.set(line.id, { order, line });
  const entries = [];
  for (const receipt of data.receipts || []) {
    if (receipt.status === "cancelled" || !inRange(receipt.date)) continue;
    const linked = receipt.orderLineId && lines.get(receipt.orderLineId);
    if (linked) {
      entries.push({
        date: receipt.date,
        supplierName: linked.order.supplierName,
        itemName: linked.line.itemName,
        amount: round(
          (Number(receipt.qty) / linked.line.packSize) * linked.line.unitCost,
        ),
        basis: "order",
      });
    } else {
      const item = (data.items || []).find((x) => x.id === receipt.itemId);
      if (!item?.purchasePrice) continue;
      entries.push({
        date: receipt.date,
        supplierName: "직접 입고",
        itemName: item.name,
        amount: round(
          (Number(receipt.qty) / (item.packSize || 1)) * item.purchasePrice,
        ),
        basis: "item",
      });
    }
  }
  for (const order of data.purchaseOrders || [])
    for (const change of order.changes || []) {
      if (change.adjustment !== "return" || !inRange(change.date || "")) continue;
      for (const returned of change.lines || []) {
        const line = order.lines.find((x) => x.id === returned.lineId);
        entries.push({
          date: change.date,
          supplierName: order.supplierName,
          itemName: line?.itemName || "반품",
          amount: -round(returned.quantity * (returned.unitCost ?? line?.unitCost ?? 0)),
          basis: "return",
        });
      }
    }
  return entries;
}
function supplierPayments(data, from, to) {
  let total = 0;
  for (const order of data.purchaseOrders || [])
    for (const change of order.changes || [])
      if (
        Number.isSafeInteger(change.paymentDelta) &&
        change.date >= from &&
        change.date <= to
      )
        total += change.paymentDelta;
  return total;
}

function getProfit(data, { from, to }) {
  const sales = getReport(data, { from, to });
  const months = monthsBetween(from, to);
  const monthly = new Map(
    months.map((key) => [
      key,
      { month: key, sales: 0, purchases: 0, payroll: 0, expenses: 0 },
    ]),
  );
  for (const day of sales.daily) monthly.get(month(day.date)).sales += day.net;
  const purchases = purchaseCosts(data, from, to);
  for (const entry of purchases)
    monthly.get(month(entry.date)).purchases += entry.amount;
  const payroll = (data.payroll || []).filter(
    (entry) =>
      ["finalized", "paid"].includes(entry.status) &&
      months.includes(entry.month),
  );
  for (const entry of payroll)
    monthly.get(entry.month).payroll += entry.earningsTotal || 0;
  const expenses = (data.expenses || []).filter(
    (entry) => entry.status !== "void" && entry.date >= from && entry.date <= to,
  );
  const byCategory = new Map();
  for (const entry of expenses) {
    monthly.get(month(entry.date)).expenses += entry.amount;
    byCategory.set(
      entry.category,
      (byCategory.get(entry.category) || 0) + entry.amount,
    );
  }
  const sum = (key) =>
    [...monthly.values()].reduce((total, row) => total + row[key], 0);
  const totals = {
    sales: sales.net,
    purchases: sum("purchases"),
    payroll: sum("payroll"),
    expenses: sum("expenses"),
  };
  totals.grossProfit = totals.sales - totals.purchases;
  totals.operatingProfit = totals.grossProfit - totals.payroll - totals.expenses;
  const bySupplier = new Map();
  for (const entry of purchases)
    bySupplier.set(
      entry.supplierName,
      (bySupplier.get(entry.supplierName) || 0) + entry.amount,
    );
  const pendingPayroll = (data.payroll || []).filter(
    (entry) => entry.status === "draft" && months.includes(entry.month),
  ).length;
  return {
    from,
    to,
    totals,
    margin: totals.sales ? totals.operatingProfit / totals.sales : null,
    monthly: [...monthly.values()].map((row) => ({
      ...row,
      profit: row.sales - row.purchases - row.payroll - row.expenses,
    })),
    expensesByCategory: [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    purchasesBySupplier: [...bySupplier.entries()]
      .map(([supplierName, amount]) => ({ supplierName, amount }))
      .sort((a, b) => b.amount - a.amount),
    supplierPayments: supplierPayments(data, from, to),
    estimatedPurchases: purchases
      .filter((entry) => entry.basis === "item")
      .reduce((total, entry) => total + entry.amount, 0),
    pendingPayroll,
    payables: (data.purchaseOrders || [])
      .filter((order) => !order.cancelled && procurement.balance(order) > 0)
      .reduce((total, order) => total + procurement.balance(order), 0),
  };
}

module.exports = { getProfit, purchaseCosts };
