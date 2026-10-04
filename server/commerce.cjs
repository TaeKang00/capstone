"use strict";

const inventory = require("../src/inventory.js");
const MAX_MONEY = 1_000_000_000_000;
const METHODS = ["card", "cash", "transfer"];
const clone = (value) => JSON.parse(JSON.stringify(value));
const roundQuantity = (value) => Math.round(value * 1000) / 1000;
const fail = (message, code = "VALIDATION_ERROR", status = 422) => {
  throw Object.assign(new Error(message), { code, status });
};
function text(value, label, max = 1000, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string") fail(`${label} 형식을 확인해 주세요.`);
  const result = value.trim();
  if (
    (required && !result) ||
    result.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)
  )
    fail(
      `${label}을(를) ${required ? "1~" : ""}${max}자 이내로 입력해 주세요.`,
    );
  return result;
}
function id(value, label = "항목") {
  return text(value, label, 128, true);
}
function money(value, label, fallback) {
  if (value == null && fallback !== undefined) return fallback;
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY)
    fail(`${label}은(는) 0원 이상 1조 원 이하의 정수로 입력해 주세요.`);
  return value;
}
function date(value, label = "날짜") {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "9999-12-31"
  )
    fail(`${label}을(를) 확인해 주세요.`);
  const parsed = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    fail(`${label}을(를) 확인해 주세요.`);
  return value;
}
function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label}을(를) 선택해 주세요.`);
  return value;
}
function quantity(value, item, allowZero = false) {
  try {
    return inventory.parseQuantity(value, item, { allowZero });
  } catch (error) {
    fail(error.message);
  }
}
function safeMoney(value, label = "계산 금액") {
  return money(value, label);
}
function nextId(data, key, prefix, collection) {
  data.seq ||= {};
  let counter =
    Number.isSafeInteger(data.seq[key]) && data.seq[key] > 0
      ? data.seq[key]
      : 1;
  let result;
  do {
    result = `${prefix}${counter++}`;
  } while (collection.some((entry) => entry.id === result));
  data.seq[key] = counter;
  return result;
}
function timeAt(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
function context(ctx) {
  if (
    !ctx?.actor?.id ||
    !ctx.actor.name ||
    !Number.isFinite(Date.parse(ctx.now))
  )
    fail("작업자 또는 작업 시각 정보가 없습니다.", "INVALID_CONTEXT", 400);
  date(ctx.today, "작업 날짜");
  if (!["owner", "manager", "reception"].includes(ctx.actor.role))
    fail("이 작업을 수행할 권한이 없습니다.", "FORBIDDEN", 403);
  return ctx;
}
function editableStaff(data, value, allowInactive = false) {
  const staff = data.staff.find((entry) => entry.id === id(value, "담당 직원"));
  if (!staff || (!allowInactive && staff.status !== "active"))
    fail("현재 근무 중인 담당 직원을 선택해 주세요.");
  return staff;
}
function stockLog(data, item, delta, kind, ref, reason, ctx) {
  const beforeStock = quantity(item.qty, item, true);
  const after = roundQuantity(beforeStock + delta);
  if (after < 0)
    fail(
      `${item.name} 재고가 부족합니다. 현재 ${beforeStock}${item.unit}, 필요 ${Math.abs(delta)}${item.unit}. 실제 수량을 확인하고 입고해 주세요.`,
      "INSUFFICIENT_STOCK",
      409,
    );
  quantity(after, item, true);
  item.qty = after;
  data.logs.push({
    id: nextId(data, "l", "L", data.logs),
    dt: `${ctx.today} ${timeAt(ctx.now)}`,
    at: ctx.now,
    itemId: item.id,
    delta,
    kind,
    beforeStock,
    after,
    ref,
    reason,
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
  });
}

// Integer arithmetic avoids rounding drift when distributing a won discount.
function allocateDiscount(lines, discount, subtotal) {
  if (!subtotal) return lines.map(() => 0);
  const denominator = BigInt(subtotal);
  const parts = lines.map((line, index) => {
    const numerator = BigInt(line.gross) * BigInt(discount);
    return {
      index,
      value: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  let remainder = discount - parts.reduce((sum, part) => sum + part.value, 0);
  const order = [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const part of order) {
    if (remainder-- <= 0) break;
    part.value += 1;
  }
  return parts.map((part) => part.value);
}
function paymentCreate(data, payload, ctx) {
  const d = clone(data);
  d.transactions ||= [];
  d.refunds ||= [];
  d.logs ||= [];
  let appointment = null;
  if (payload.appointmentId) {
    appointment = d.appointments.find(
      (entry) => entry.id === id(payload.appointmentId, "예약"),
    );
    if (!appointment) fail("예약을 찾을 수 없습니다.");
    if (["cancelled", "no_show"].includes(appointment.status))
      fail(
        "취소 또는 노쇼 예약은 수납할 수 없습니다. 예약 상태를 먼저 변경해 주세요.",
      );
    if (
      appointment.transactionId ||
      d.transactions.some((entry) => entry.appointmentId === appointment.id)
    )
      fail(
        "이미 수납한 예약입니다. 기존 수납 내역에서 확인해 주세요.",
        "ALREADY_PAID",
        409,
      );
    if (payload.customerId && payload.customerId !== appointment.customerId)
      fail("예약 고객과 수납 고객이 다릅니다.");
    if (payload.staffId && payload.staffId !== appointment.staffId)
      fail(
        "예약 담당 직원과 수납 담당 직원이 다릅니다. 예약 정보를 먼저 수정해 주세요.",
      );
  }
  const staff = editableStaff(
    d,
    appointment?.staffId || payload.staffId,
    !!appointment,
  );
  const serviceDate = date(
    payload.serviceDate || appointment?.date || ctx.today,
    "시술일",
  );
  if (serviceDate > ctx.today)
    fail("시술일은 오늘 또는 이전 날짜로 입력해 주세요.");
  if (appointment && serviceDate !== appointment.date)
    fail("시술일은 예약 날짜와 같아야 합니다. 예약 정보를 먼저 확인해 주세요.");
  const customerId = appointment?.customerId || payload.customerId || null;
  const customer = customerId
    ? d.customers.find((entry) => entry.id === id(customerId, "고객"))
    : null;
  if (customerId && !customer) fail("고객을 찾을 수 없습니다.");
  if (customer?.archived && !appointment)
    fail("보관된 고객입니다. 고객 정보를 먼저 복원해 주세요.");
  const customerName =
    customer?.name ||
    text(
      appointment?.guestName || payload.guestName || "방문 고객",
      "고객 이름",
      80,
      true,
    );
  if (
    !Array.isArray(payload.lines) ||
    payload.lines.length < 1 ||
    payload.lines.length > 100
  )
    fail("수납할 시술 또는 상품을 1~100개 선택해 주세요.");
  const txId = nextId(d, "transaction", "TX", d.transactions);
  const consumption = new Map();
  function consume(item, amount, allowInactive = false) {
    if (!item || (item.active === false && !allowInactive))
      fail(
        "사용 중지되었거나 삭제된 품목입니다. 시술 재료 또는 상품 설정을 확인해 주세요.",
      );
    const previous = consumption.get(item.id) || { item, amount: 0 };
    previous.amount = roundQuantity(previous.amount + amount);
    quantity(previous.amount, item);
    consumption.set(item.id, previous);
  }
  const lines = payload.lines.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      fail("수납 항목 형식을 확인해 주세요.");
    const type = enumValue(raw.type, ["service", "product"], "수납 항목 종류");
    const refId = id(raw.refId, "시술 또는 상품");
    let catalog;
    const previouslyReserved =
      type === "service" && appointment?.serviceIds?.includes(refId);
    if (type === "service")
      catalog = d.services.find(
        (entry) =>
          entry.id === refId && (entry.active !== false || previouslyReserved),
      );
    else
      catalog = d.items.find(
        (entry) =>
          entry.id === refId &&
          entry.active !== false &&
          entry.kind === "판매 상품",
      );
    if (!catalog) fail("사용 중인 시술 또는 판매 상품을 선택해 주세요.");
    const count = quantity(
      raw.quantity,
      type === "service" ? { unit: "개" } : catalog,
    );
    const unitPrice = money(
      raw.unitPrice,
      "단가",
      money(catalog.price, "기본 단가"),
    );
    const countMillis = BigInt(Math.round(count * 1000));
    const gross = safeMoney(
      Number((BigInt(unitPrice) * countMillis + 500n) / 1000n),
    );
    if (type === "product") consume(catalog, count);
    else {
      for (const material of catalog.materials || []) {
        const item = d.items.find((entry) => entry.id === material.itemId);
        if (!item || item.kind !== "시술 재료")
          fail(`${catalog.name}의 재료 설정을 확인해 주세요.`);
        const amount = quantity(material.quantity, item);
        consume(item, roundQuantity(amount * count), previouslyReserved);
      }
    }
    return {
      id: `${txId}-L${index + 1}`,
      type,
      refId,
      name: catalog.name,
      unitPrice,
      quantity: count,
      gross,
    };
  });
  const subtotal = safeMoney(
    lines.reduce((sum, line) => sum + line.gross, 0),
    "합계 금액",
  );
  const discount = money(payload.discount, "할인 금액", 0);
  if (discount > subtotal) fail("할인 금액은 수납 합계보다 클 수 없습니다.");
  const allocated = allocateDiscount(lines, discount, subtotal);
  const transaction = {
    id: txId,
    appointmentId: appointment?.id || null,
    customerId,
    customerName,
    staffId: staff.id,
    serviceDate,
    date: ctx.today,
    time: timeAt(ctx.now),
    lines: lines.map(({ gross, ...line }, index) => ({
      ...line,
      discount: allocated[index],
      total: gross - allocated[index],
    })),
    discount,
    subtotal,
    total: subtotal - discount,
    method: enumValue(payload.method, METHODS, "결제 수단"),
    reference: text(payload.reference, "승인 번호 또는 이체 참조", 120),
    notes: text(payload.notes, "메모", 2000),
    status: "paid",
    actorId: ctx.actor.id,
    createdAt: ctx.now,
    changes: [],
  };
  for (const { item, amount } of consumption.values())
    stockLog(d, item, -amount, "수납 사용", txId, `${customerName} 수납`, ctx);
  d.transactions.push(transaction);
  if (appointment) {
    appointment.changes ||= [];
    appointment.changes.push({
      at: ctx.now,
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      from: appointment.status,
      to: "completed",
      reason: "수납 완료",
      transactionId: txId,
    });
    appointment.status = "completed";
    appointment.transactionId = txId;
  }
  return d;
}
function paymentCorrect(data, payload, ctx) {
  for (const key of Object.keys(payload))
    if (!["id", "staffId", "method", "reference", "reason"].includes(key))
      fail(
        "수납 정보 정정에서는 담당 직원·결제 수단·승인 번호만 변경할 수 있습니다. 금액 변경은 환불 후 새로 수납해 주세요.",
      );
  const d = clone(data);
  const transaction = d.transactions.find(
    (entry) => entry.id === id(payload.id, "수납"),
  );
  if (!transaction) fail("수납 내역을 찾을 수 없습니다.");
  const reason = text(payload.reason, "정정 사유", 1000, true);
  const before = {
    staffId: transaction.staffId,
    method: transaction.method,
    reference: transaction.reference,
  };
  const after = { ...before };
  if (payload.staffId != null)
    after.staffId = editableStaff(
      d,
      payload.staffId,
      payload.staffId === transaction.staffId,
    ).id;
  if (payload.method != null)
    after.method = enumValue(payload.method, METHODS, "결제 수단");
  if (payload.reference != null)
    after.reference = text(payload.reference, "승인 번호 또는 이체 참조", 120);
  if (Object.keys(before).every((key) => before[key] === after[key]))
    fail("변경된 정보가 없습니다.");
  Object.assign(transaction, after);
  transaction.changes ||= [];
  transaction.changes.push({
    at: ctx.now,
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    kind: "정보 정정",
    before,
    after,
    reason,
  });
  return d;
}
function refundedLine(data, transactionId, lineId) {
  return (data.refunds || [])
    .filter((entry) => entry.transactionId === transactionId)
    .flatMap((entry) => entry.lines)
    .filter((entry) => entry.lineId === lineId)
    .reduce(
      (totals, entry) => ({
        quantity: roundQuantity(totals.quantity + entry.quantity),
        amount: totals.amount + entry.amount,
      }),
      { quantity: 0, amount: 0 },
    );
}
function paymentRefund(data, payload, ctx) {
  const d = clone(data);
  d.refunds ||= [];
  d.logs ||= [];
  const transaction = d.transactions.find(
    (entry) => entry.id === id(payload.transactionId, "수납"),
  );
  if (!transaction) fail("수납 내역을 찾을 수 없습니다.");
  if (transaction.status === "refunded")
    fail("전액 환불한 수납 내역입니다.", "ALREADY_REFUNDED", 409);
  if (
    !Array.isArray(payload.lines) ||
    payload.lines.length < 1 ||
    payload.lines.length > transaction.lines.length
  )
    fail("환불할 항목과 수량을 선택해 주세요.");
  const reason = text(payload.reason, "환불 사유", 1000, true);
  const method = enumValue(payload.method, METHODS, "환불 수단");
  const refundId = nextId(d, "refund", "RF", d.refunds);
  const seen = new Set();
  const lines = payload.lines.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      fail("환불 항목 형식을 확인해 주세요.");
    const lineId = id(raw.lineId, "환불 항목");
    if (seen.has(lineId)) fail("같은 항목을 중복 선택할 수 없습니다.");
    seen.add(lineId);
    const original = transaction.lines.find((line) => line.id === lineId);
    if (!original) fail("원래 수납에 없는 환불 항목입니다.");
    const item =
      original.type === "product"
        ? d.items.find((entry) => entry.id === original.refId)
        : null;
    // The sold quantity is authoritative even if a historical catalog item was archived.
    const unit =
      original.type === "service"
        ? { unit: "개" }
        : item || { unit: Number.isInteger(original.quantity) ? "개" : "g" };
    const count = quantity(raw.quantity, unit);
    const previous = refundedLine(d, transaction.id, lineId);
    const cumulative = roundQuantity(previous.quantity + count);
    if (cumulative > original.quantity)
      fail(
        `${original.name}의 남은 환불 수량 ${roundQuantity(original.quantity - previous.quantity)}을(를) 초과했습니다.`,
        "REFUND_EXCEEDS_REMAINING",
        409,
      );
    const target = Number(
      (BigInt(original.total) * BigInt(Math.round(cumulative * 1000))) /
        BigInt(Math.round(original.quantity * 1000)),
    );
    const amount = safeMoney(target - previous.amount, "환불 금액");
    if (raw.restock != null && typeof raw.restock !== "boolean")
      fail("재입고 여부를 확인해 주세요.");
    if (raw.restock && original.type !== "product")
      fail("시술 환불에서는 이미 사용한 재료를 자동 복원할 수 없습니다.");
    const restock = raw.restock === true && original.type === "product";
    if (restock) {
      if (!item) fail("재입고할 상품이 없습니다. 상품 정보를 확인해 주세요.");
      stockLog(d, item, count, "환불 재입고", refundId, reason, ctx);
    }
    return { lineId, quantity: count, amount, restock };
  });
  const amount = safeMoney(
    lines.reduce((sum, line) => sum + line.amount, 0),
    "환불 합계",
  );
  const allRefunded = d.refunds
    .filter((entry) => entry.transactionId === transaction.id)
    .reduce((sum, entry) => sum + entry.amount, 0);
  if (allRefunded + amount > transaction.total)
    fail(
      "환불 금액이 원래 수납 금액을 초과합니다.",
      "REFUND_EXCEEDS_REMAINING",
      409,
    );
  d.refunds.push({
    id: refundId,
    transactionId: transaction.id,
    date: ctx.today,
    time: timeAt(ctx.now),
    lines,
    amount,
    method,
    reference: text(payload.reference, "환불 승인 번호 또는 이체 참조", 120),
    reason,
    actorId: ctx.actor.id,
    createdAt: ctx.now,
  });
  const complete = transaction.lines.every(
    (line) =>
      refundedLine(d, transaction.id, line.id).quantity === line.quantity,
  );
  transaction.status = complete ? "refunded" : "partially_refunded";
  transaction.changes ||= [];
  transaction.changes.push({
    at: ctx.now,
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    kind: "환불",
    refundId,
    amount,
    reason,
  });
  return d;
}

function inventoryItem(data, payload, ctx) {
  if (!["owner", "manager"].includes(ctx.actor.role))
    fail("품목 등록·수정 권한이 없습니다.", "FORBIDDEN", 403);
  if ("qty" in payload)
    fail(
      "품목 등록·수정에서 현재 재고를 바꿀 수 없습니다. 입고 또는 실사 조정을 이용해 주세요.",
    );
  const d = clone(data);
  const item = payload.id
    ? d.items.find((entry) => entry.id === id(payload.id, "품목"))
    : null;
  if (payload.id && !item) fail("품목을 찾을 수 없습니다.");
  const name = text(payload.name, "품목명", 120, true);
  if (
    d.items.some(
      (entry) =>
        entry.id !== item?.id &&
        entry.name.trim().toLocaleLowerCase("ko") ===
          name.toLocaleLowerCase("ko"),
    )
  )
    fail("이미 등록된 품목명입니다. 기존 품목을 확인해 주세요.");
  const kind = enumValue(payload.kind, ["시술 재료", "판매 상품"], "품목 분류");
  const unit = enumValue(payload.unit, ["g", "ml", "개"], "단위");
  const min = quantity(payload.min, { unit }, true);
  const price = money(payload.price, "가격", 0);
  const active = payload.active == null ? true : payload.active;
  if (typeof active !== "boolean") fail("품목 사용 여부를 확인해 주세요.");
  const materialServices = item
    ? d.services.filter((service) =>
        (service.materials || []).some(
          (material) => material.itemId === item.id,
        ),
      )
    : [];
  if (item && (item.unit !== unit || item.kind !== kind)) {
    const referenced =
      item.qty !== 0 ||
      d.logs.some((entry) => entry.itemId === item.id) ||
      (d.receipts || []).some((entry) => entry.itemId === item.id) ||
      materialServices.length ||
      d.transactions.some((entry) =>
        entry.lines.some(
          (line) => line.refId === item.id && line.type === "product",
        ),
      );
    if (referenced)
      fail(
        "재고 또는 사용 이력이 있는 품목의 분류·단위는 변경할 수 없습니다. 새 품목으로 등록해 주세요.",
      );
  }
  if (!active && materialServices.some((service) => service.active !== false))
    fail(
      "사용 중인 시술에 연결된 재료입니다. 시술의 재료 설정을 먼저 변경해 주세요.",
    );
  if (item) {
    const beforeMin = item.min;
    Object.assign(item, { name, kind, unit, min, price, active });
    if (beforeMin !== min) {
      d.logs ||= [];
      stockLog(
        d,
        item,
        0,
        "기준 변경",
        "보충 기준",
        "품목 정보에서 보충 기준 변경",
        ctx,
      );
      Object.assign(d.logs.at(-1), { beforeMin, afterMin: min });
    }
  } else
    d.items.push({
      id: nextId(d, "item", "IT", d.items),
      name,
      kind,
      unit,
      qty: 0,
      min,
      price,
      active,
    });
  return d;
}
const INVENTORY_METHODS = {
  "inventory.receipt": "addReceipt",
  "inventory.correct": "correctReceipt",
  "inventory.cancel": "cancelReceipt",
  "inventory.threshold": "setThreshold",
  "inventory.adjust": "adjustStock",
};
function inventoryAction(data, type, payload, ctx) {
  const form = {
    ...payload,
    token: `${id(ctx.actor.id, "직원")}:${id(ctx.requestId, "저장 요청")}`,
  };
  if (
    type === "inventory.receipt" &&
    data.items.find((entry) => entry.id === payload.itemId)?.active === false
  )
    fail(
      "사용 중지된 품목입니다. 품목을 다시 사용으로 변경한 뒤 입고해 주세요.",
    );
  if (payload.memo != null) form.memo = text(payload.memo, "입고 메모", 2000);
  if (payload.reason != null)
    form.reason = text(payload.reason, "변경 사유", 1000);
  try {
    const d = inventory[INVENTORY_METHODS[type]](data, form, {
      today: ctx.today,
      at: ctx.now,
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
    });
    const oldLogIds = new Set((data.logs || []).map((entry) => entry.id));
    for (const log of d.logs)
      if (!oldLogIds.has(log.id))
        log.dt = `${log.dt.slice(0, 10)} ${timeAt(ctx.now)}`;
    return d;
  } catch (error) {
    if (error.status) throw error;
    fail(error.message);
  }
}
function applyCommerce(data, type, payload, ctx) {
  context(ctx);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    fail("요청 내용을 확인해 주세요.", "INVALID_PAYLOAD", 400);
  if (type === "payment.create") return paymentCreate(data, payload, ctx);
  if (type === "payment.correct") return paymentCorrect(data, payload, ctx);
  if (type === "payment.refund") return paymentRefund(data, payload, ctx);
  if (type === "inventory.item") return inventoryItem(data, payload, ctx);
  if (INVENTORY_METHODS[type]) return inventoryAction(data, type, payload, ctx);
  fail("지원하지 않는 수납·재고 작업입니다.", "UNKNOWN_ACTION", 400);
}
function getReport(data, options = {}) {
  const from = date(options.from, "시작일");
  const to = date(options.to, "종료일");
  if (from > to) fail("시작일은 종료일보다 늦을 수 없습니다.");
  if (
    Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) >
    366 * 86400000
  )
    fail("조회 기간은 367일 이내로 선택해 주세요.");
  const staffId = options.staffId ? id(options.staffId, "담당 직원") : null;
  if (staffId && !data.staff.some((entry) => entry.id === staffId))
    fail("조회할 직원을 찾을 수 없습니다.");
  const matching = (entry) => entry.date >= from && entry.date <= to;
  const transactions = data.transactions.filter(
    (entry) => matching(entry) && (!staffId || entry.staffId === staffId),
  );
  const byTransaction = new Map(
    data.transactions.map((entry) => [entry.id, entry]),
  );
  const refundEntries = (data.refunds || []).filter(
    (entry) =>
      matching(entry) &&
      (!staffId || byTransaction.get(entry.transactionId)?.staffId === staffId),
  );
  const byMethod = METHODS.map((method) => ({
    method,
    gross: 0,
    refunds: 0,
    net: 0,
  }));
  const byStaffMap = new Map();
  const days = new Map();
  for (
    let day = Date.parse(`${from}T00:00:00Z`),
      end = Date.parse(`${to}T00:00:00Z`);
    day <= end;
    day += 86400000
  ) {
    const value = new Date(day).toISOString().slice(0, 10);
    days.set(value, { date: value, gross: 0, refunds: 0, net: 0 });
  }
  function staffRecord(value) {
    if (!byStaffMap.has(value))
      byStaffMap.set(value, {
        staffId: value,
        name:
          data.staff.find((entry) => entry.id === value)?.name || "기록된 직원",
        total: 0,
        count: 0,
      });
    return byStaffMap.get(value);
  }
  let gross = 0,
    refunds = 0;
  for (const entry of transactions) {
    gross += entry.total;
    byMethod.find((record) => record.method === entry.method).gross +=
      entry.total;
    const staff = staffRecord(entry.staffId);
    staff.total += entry.total;
    staff.count += 1;
    days.get(entry.date).gross += entry.total;
  }
  for (const entry of refundEntries) {
    refunds += entry.amount;
    byMethod.find((record) => record.method === entry.method).refunds +=
      entry.amount;
    const original = byTransaction.get(entry.transactionId);
    if (original) staffRecord(original.staffId).total -= entry.amount;
    days.get(entry.date).refunds += entry.amount;
  }
  byMethod.forEach((entry) => {
    entry.net = entry.gross - entry.refunds;
  });
  const daily = [...days.values()].map((entry) => ({
    ...entry,
    net: entry.gross - entry.refunds,
  }));
  return clone({
    from,
    to,
    gross,
    refunds,
    net: gross - refunds,
    count: transactions.length,
    byMethod,
    byStaff: [...byStaffMap.values()].sort((a, b) => b.total - a.total),
    daily,
    transactions,
    refundEntries,
  });
}

module.exports = { applyCommerce, getReport };
