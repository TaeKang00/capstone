"use strict";
const { randomUUID } = require("node:crypto");

function fail(message, status = 422, code = "PAYROLL_VALIDATION") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}
function text(value, label, max = 500, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string") fail(`${label} 형식을 확인해 주세요.`);
  const result = value.trim();
  if (result.length > max || (required && !result))
    fail(
      `${label}${required ? "을(를) 입력하고" : "은(는)"} ${max}자 이내로 작성해 주세요.`,
    );
  return result;
}
function number(
  value,
  label,
  { max = Number.MAX_SAFE_INTEGER, integer = true, nullable = false } = {},
) {
  if (nullable && (value === "" || value == null)) return null;
  if (
    value === "" ||
    value == null ||
    typeof value === "boolean" ||
    !["number", "string"].includes(typeof value)
  )
    fail(`${label}을(를) 입력해 주세요.`);
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value))
    fail(`${label} 형식을 확인해 주세요.`);
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    n > max ||
    (integer && !Number.isSafeInteger(n))
  )
    fail(`${label} 범위를 확인해 주세요.`);
  return n;
}
function date(value, label) {
  const parsed =
    typeof value === "string" ? new Date(`${value}T00:00:00Z`) : new Date(NaN);
  if (
    typeof value !== "string" ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    fail(`${label}을(를) 올바른 날짜로 입력해 주세요.`);
  return value;
}
function period(month) {
  if (typeof month !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))
    fail("급여 귀속월을 확인해 주세요.");
  const [year, m] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, "0")}`,
  };
}
function add(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result))
    fail("합계 금액이 허용 범위를 초과합니다.");
  return result;
}
function entries(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30)
    fail(`${label}은(는) 30개까지 입력할 수 있습니다.`);
  return value.map((entry) => {
    if (!entry || typeof entry !== "object")
      fail(`${label} 형식을 확인해 주세요.`);
    return {
      name: text(entry.name, `${label} 항목명`, 60, true),
      amount: number(entry.amount, `${label} 금액`),
    };
  });
}
function revenue(data, staffId, month) {
  const { from, to } = period(month);
  const inPeriod = (value) => value >= from && value <= to;
  const sales = [],
    returns = [];
  let gross = 0,
    refunded = 0;
  const all = data.transactions || [];
  for (const tx of all) {
    if (tx.staffId !== staffId) continue;
    const serviceLines = (tx.lines || []).filter(
      (line) => line.type === "service",
    );
    if (inPeriod(tx.date)) {
      const amount = serviceLines.reduce(
        (sum, line) => add(sum, number(line.total, "시술 매출")),
        0,
      );
      if (serviceLines.length) {
        gross = add(gross, amount);
        sales.push({ transactionId: tx.id, date: tx.date, amount });
      }
    }
    for (const refund of data.refunds || []) {
      if (refund.transactionId !== tx.id || !inPeriod(refund.date)) continue;
      const amount = (refund.lines || [])
        .filter((line) =>
          serviceLines.some((service) => service.id === line.lineId),
        )
        .reduce((sum, line) => add(sum, number(line.amount, "시술 환불액")), 0);
      if (amount) {
        refunded = add(refunded, amount);
        returns.push({
          refundId: refund.id,
          transactionId: tx.id,
          date: refund.date,
          amount,
        });
      }
    }
  }
  return {
    from,
    to,
    gross,
    refunded,
    net: add(gross, -refunded),
    sales,
    refunds: returns,
    method:
      "결제일 기준 시술 할인 후 매출 − 해당 월 시술 환불액 (판매 상품 제외, 음수 인센티브 0원)",
  };
}
function calculate(data, record) {
  const source = revenue(data, record.staffId, record.month);
  const basisPoints = Math.round(record.commissionRate * 100);
  const commission = Number(
    (BigInt(Math.max(0, source.net)) * BigInt(basisPoints) + 5000n) / 10000n,
  );
  const allowanceTotal = record.allowances.reduce(
    (sum, item) => add(sum, item.amount),
    0,
  );
  const deductionTotal = record.deductions.reduce(
    (sum, item) => add(sum, item.amount),
    0,
  );
  const earningsTotal = add(add(record.basePay, commission), allowanceTotal);
  const netPay = add(earningsTotal, -deductionTotal);
  if (netPay < 0)
    fail("공제 합계가 지급 합계를 초과합니다. 공제 항목을 확인해 주세요.");
  return {
    revenue: source,
    commission,
    allowanceTotal,
    deductionTotal,
    earningsTotal,
    netPay,
  };
}
function staffSnapshot(staff) {
  return { id: staff.id, name: staff.name, role: staff.role };
}
function storeSnapshot(store) {
  return {
    name: store.name,
    phone: store.phone || "",
    address: store.address || "",
  };
}
function applyPayroll(data, type, payload, ctx) {
  if (!ctx?.actor || !["owner", "manager"].includes(ctx.actor.role))
    fail("급여 관리 권한이 없습니다.", 403, "FORBIDDEN");
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    fail("급여 요청 형식을 확인해 주세요.");
  if (
    ![
      "payroll.save",
      "payroll.finalize",
      "payroll.reopen",
      "payroll.paid",
    ].includes(type)
  )
    fail("지원하지 않는 급여 작업입니다.", 400, "UNKNOWN_ACTION");
  const next = structuredClone(data);
  next.payroll ||= [];
  const existing =
    payload.id == null
      ? null
      : next.payroll.find((item) => item.id === payload.id);
  if (payload.id != null && !existing)
    fail("급여명세서를 찾을 수 없습니다.", 404, "NOT_FOUND");
  const actor = {
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    at: ctx.now,
  };
  if (type === "payroll.save") {
    if (existing && existing.status !== "draft")
      fail(
        "확정한 급여명세서는 수정할 수 없습니다. 수정이 필요하면 확정을 취소해 주세요.",
        409,
        "PAYROLL_LOCKED",
      );
    if (
      existing?.changes?.some((change) => change.kind === "finalized") &&
      (existing.staffId !== payload.staffId || existing.month !== payload.month)
    )
      fail(
        "확정 이력이 있는 명세서의 직원과 귀속월은 변경할 수 없습니다.",
        409,
        "PAYROLL_IDENTITY_LOCKED",
      );
    const staff = next.staff.find((item) => item.id === payload.staffId);
    if (!staff) fail("등록된 직원을 선택해 주세요.");
    const { from } = period(payload.month);
    if (
      next.payroll.some(
        (item) =>
          item.id !== existing?.id &&
          item.staffId === staff.id &&
          item.month === payload.month,
      )
    )
      fail(
        "해당 직원의 이번 달 급여명세서가 이미 있습니다.",
        409,
        "PAYROLL_DUPLICATE",
      );
    const payDate = date(payload.payDate, "지급 예정일");
    if (payDate < from)
      fail("지급 예정일은 급여 귀속월 시작일 이후여야 합니다.");
    const commissionRate = number(
      payload.commissionRate ?? 0,
      "인센티브 비율",
      { max: 100, integer: false },
    );
    if (
      Math.abs(commissionRate * 100 - Math.round(commissionRate * 100)) > 1e-8
    )
      fail("인센티브 비율은 소수점 둘째 자리까지 입력해 주세요.");
    const record = {
      id: existing?.id || `pay_${randomUUID()}`,
      staffId: staff.id,
      month: payload.month,
      payDate,
      basePay: number(payload.basePay, "기본급"),
      commissionRate,
      allowances: entries(payload.allowances, "추가 지급"),
      deductions: entries(payload.deductions, "공제"),
      workDays: number(payload.workDays, "근무일수", {
        max: 31,
        nullable: true,
      }),
      workHours: number(payload.workHours, "근로시간", {
        max: 744,
        integer: false,
        nullable: true,
      }),
      overtimeHours: number(payload.overtimeHours, "연장근로시간", {
        max: 744,
        integer: false,
        nullable: true,
      }),
      basis: text(payload.basis, "지급·공제 계산 근거", 2000),
      notes: text(payload.notes, "메모", 1000),
      status: "draft",
      createdAt: existing?.createdAt || ctx.now,
      updatedAt: ctx.now,
      createdBy: existing?.createdBy || ctx.actor.id,
      changes: existing?.changes || [],
    };
    if (
      record.workHours !== null &&
      record.overtimeHours !== null &&
      record.overtimeHours > record.workHours
    )
      fail("연장근로시간은 총 근로시간을 초과할 수 없습니다.");
    Object.assign(record, calculate(next, record));
    record.staffSnapshot = staffSnapshot(staff);
    record.storeSnapshot = storeSnapshot(next.store);
    record.changes.push({ ...actor, kind: existing ? "updated" : "created" });
    if (existing) next.payroll[next.payroll.indexOf(existing)] = record;
    else next.payroll.push(record);
  } else {
    if (!existing) fail("급여명세서를 선택해 주세요.");
    if (type === "payroll.finalize") {
      if (existing.status !== "draft")
        fail(
          "작성 중인 급여명세서만 확정할 수 있습니다.",
          409,
          "PAYROLL_LOCKED",
        );
      if (existing.month > ctx.today.slice(0, 7))
        fail("미래 월 급여는 아직 확정할 수 없습니다.");
      const staff = next.staff.find((item) => item.id === existing.staffId);
      if (!staff) fail("직원 정보를 찾을 수 없습니다.");
      Object.assign(existing, calculate(next, existing));
      existing.staffSnapshot = staffSnapshot(staff);
      existing.storeSnapshot = storeSnapshot(next.store);
      existing.status = "finalized";
      existing.finalizedAt = ctx.now;
      existing.finalizedBy = ctx.actor.id;
      existing.changes.push({
        ...actor,
        kind: "finalized",
        snapshot: structuredClone({ ...existing, changes: undefined }),
      });
    } else if (type === "payroll.reopen") {
      if (existing.status !== "finalized")
        fail(
          "지급 전 확정 명세서만 확정을 취소할 수 있습니다. 지급 후 차액은 다음 급여의 추가 지급·공제 항목으로 기록해 주세요.",
          409,
          "PAYROLL_LOCKED",
        );
      const reason = text(payload.reason, "확정 취소 사유", 500, true);
      existing.status = "draft";
      delete existing.finalizedAt;
      delete existing.finalizedBy;
      existing.changes.push({ ...actor, kind: "reopened", reason });
    } else {
      if (existing.status !== "finalized")
        fail(
          "확정한 급여명세서만 지급 완료로 처리할 수 있습니다.",
          409,
          "PAYROLL_LOCKED",
        );
      const paidDate = date(payload.paidDate, "실제 지급일");
      if (paidDate > ctx.today || paidDate < period(existing.month).from)
        fail("실제 지급일은 귀속월 시작일에서 오늘 사이로 입력해 주세요.");
      existing.status = "paid";
      existing.paidDate = paidDate;
      existing.paidAt = ctx.now;
      existing.changes.push({ ...actor, kind: "paid", paidDate });
    }
    existing.updatedAt = ctx.now;
  }
  return next;
}
module.exports = { applyPayroll, getPayrollRevenue: revenue };
