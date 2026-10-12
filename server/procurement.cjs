"use strict";
const { randomUUID } = require("node:crypto");
const inventory = require("../src/inventory.js");
const {
  received,
  status,
  total,
  cancelled,
  returned,
  pending,
  paidAmount,
  balance,
} = require("../src/procurement.js");
function fail(message, status = 422) {
  throw Object.assign(new Error(message), {
    status,
    code: "PROCUREMENT_VALIDATION",
  });
}
function text(v, label, max = 200, required = false) {
  if (v == null && !required) return "";
  if (
    typeof v !== "string" ||
    v.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ||
    (required && !v.trim())
  )
    fail(`${label}을(를) 확인해 주세요.`);
  return v.trim();
}
function integer(v, label, min = 0, max = 1e9) {
  if (!Number.isSafeInteger(v) || v < min || v > max)
    fail(`${label}은(는) ${min}~${max} 범위의 정수로 입력해 주세요.`);
  return v;
}
function date(v, label) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v < "1900-01-01" ||
    v > "2199-12-31" ||
    !Number.isFinite(Date.parse(v + "T12:00:00Z")) ||
    new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v
  )
    fail(`${label}을(를) 확인해 주세요.`);
  return v;
}
function active(v) {
  if (typeof v !== "boolean") fail("사용 상태를 선택해 주세요.");
  return v;
}
function find(rows, id, label) {
  const row = (rows || []).find((r) => r.id === id);
  if (!row) fail(`${label}을(를) 찾을 수 없습니다.`, 404);
  return row;
}
function stock(method, ...args) {
  try {
    return inventory[method](...args);
  } catch (e) {
    fail(e.message);
  }
}
function applyProcurement(data, type, p, ctx) {
  if (!p || typeof p !== "object" || Array.isArray(p))
    fail("요청 형식을 확인해 주세요.");
  if (!["owner", "manager", "reception"].includes(ctx.actor.role))
    fail("발주 업무 권한이 없습니다.", 403);
  if (
    ctx.actor.role === "reception" &&
    !["purchase.receive", "purchase.receiptCancel"].includes(type)
  )
    fail("거래처·발주 관리 권한이 없습니다.", 403);
  let d = structuredClone(data);
  d.suppliers ||= [];
  d.itemCategories ||= [];
  d.purchaseOrders ||= [];
  const stamp = (o, action, detail) =>
    o.changes.push({
      at: ctx.now,
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      action,
      ...detail,
    });
  if (type === "supplier.save" || type === "category.save") {
    const rows = type === "supplier.save" ? d.suppliers : d.itemCategories;
    const old = p.id ? find(rows, p.id, "등록 정보") : null;
    const name = text(p.name, "이름", 100, true);
    if (
      rows.some(
        (r) =>
          r.id !== old?.id &&
          r.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      fail("이미 등록된 이름입니다. 기존 정보를 확인해 주세요.");
    const row = { id: old?.id || randomUUID(), name, active: active(p.active) };
    if (type === "supplier.save")
      Object.assign(row, {
        contact: text(p.contact, "담당자", 100),
        phone: text(p.phone, "연락처", 30),
        note: text(p.note, "메모", 500),
      });
    if (old) Object.assign(old, row);
    else rows.push(row);
    return d;
  }
  if (type === "purchase.create") {
    const supplier = find(d.suppliers, p.supplierId, "거래처");
    if (!supplier.active) fail("사용 중인 거래처를 선택해 주세요.");
    const orderDate = date(p.date, "발주일");
    if (orderDate > ctx.today)
      fail("발주일은 오늘 또는 이전 날짜로 입력해 주세요.");
    const deliveryDate = p.deliveryDate
      ? date(p.deliveryDate, "납품 예정일")
      : "";
    if (deliveryDate && deliveryDate < orderDate)
      fail("납품 예정일은 발주일 이후로 입력해 주세요.");
    if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 100)
      fail("발주할 품목을 1~100개 선택해 주세요.");
    const ids = new Set();
    const lines = p.lines.map((l) => {
      const item = find(d.items, l?.itemId, "품목");
      if (item.active === false) fail("미사용 품목은 새로 발주할 수 없습니다.");
      if (ids.has(item.id)) fail("같은 품목은 한 번만 선택해 주세요.");
      ids.add(item.id);
      const packSize = stock("parseQuantity", item.packSize || 1, item);
      const quantity = integer(l.quantity, "발주 수량", 1, 1000000),
        unitCost = integer(l.unitCost, "입고 단가", 0, 1e9);
      stock(
        "parseQuantity",
        Math.round(quantity * packSize * 1000) / 1000,
        item,
      );
      return {
        id: randomUUID(),
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        packSize,
        quantity,
        unitCost,
      };
    });
    const o = {
      id: randomUUID(),
      supplierId: supplier.id,
      supplierName: supplier.name,
      date: orderDate,
      deliveryDate,
      lines,
      shipped: false,
      cancelled: false,
      paid: false,
      paidDate: "",
      reference: "",
      notes: text(p.notes, "발주 메모", 500),
      createdAt: ctx.now,
      actorName: ctx.actor.name,
      changes: [],
    };
    if (!Number.isSafeInteger(total(o)) || total(o) > 1e12)
      fail("총 발주 금액은 1조 원 이하로 입력해 주세요.");
    stamp(o, "발주 등록");
    d.purchaseOrders.push(o);
    return d;
  }
  const o = find(d.purchaseOrders, p.id, "발주");
  if (o.cancelled) fail("취소된 발주는 변경할 수 없습니다.");
  // Preserve pre-ledger payments before adjusting an order's payable amount.
  if (o.paid && !o.changes.some((c) => Number.isSafeInteger(c.paymentDelta)))
    stamp(o, "이전 지급 이관", {
      paymentDelta: paidAmount(o),
      paymentId: randomUUID(),
      date: o.paidDate || o.date,
      legacy: true,
    });
  const settle = () => {
    o.paid = balance(o) <= 0;
  };
  if (type === "purchase.closeRemaining" || type === "purchase.return") {
    const reason = text(p.reason, "처리 사유", 500, true);
    const returning = type === "purchase.return";
    const eventDate = date(p.date || ctx.today, "처리일");
    if (eventDate < o.date || eventDate > ctx.today)
      fail("처리일은 발주일과 오늘 사이여야 합니다.");
    if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 100)
      fail("처리할 품목과 수량을 선택해 주세요.");
    const seen = new Set();
    const lines = p.lines.map((raw) => {
      const l = find(o.lines, raw?.lineId, "발주 품목");
      if (seen.has(l.id)) fail("같은 품목을 중복 입력할 수 없습니다.");
      seen.add(l.id);
      const q = integer(raw.quantity, "처리 개수", 1, 1000000);
      const available = returning
        ? received(l, d.receipts) - returned(o, l)
        : pending(o, l, d.receipts);
      if (q > available)
        fail(`${l.itemName}: 처리 가능한 수량을 초과했습니다.`);
      if (returning) {
        const item = find(d.items, l.itemId, "재고 품목");
        const qty = Math.round((item.qty - q * l.packSize) * 1000) / 1000;
        if (qty < 0) fail(`${l.itemName}: 반품할 실제 재고가 부족합니다.`);
        d = stock(
          "adjustStock",
          d,
          {
            itemId: item.id,
            qty,
            reason: `거래처 반품 · ${reason}`,
            token: `${ctx.actor.id}:${ctx.requestId}:${l.id}`,
          },
          {
            today: ctx.today,
            at: ctx.now,
            actorId: ctx.actor.id,
            actorName: ctx.actor.name,
          },
        );
      }
      return {
        lineId: l.id,
        itemName: l.itemName,
        quantity: q,
        unitCost: l.unitCost,
      };
    });
    const target = find(d.purchaseOrders, o.id, "발주");
    stamp(target, returning ? "반품 기록" : "미입고 잔량 취소", {
      adjustment: returning ? "return" : "cancel",
      date: eventDate,
      reason,
      lines,
    });
    target.paid = balance(target) <= 0;
    return d;
  }
  if (type === "purchase.settlement") {
    const reason = text(p.reason, "지급·환급 사유", 500, true);
    const eventDate = date(p.date, "처리일");
    if (eventDate > ctx.today) fail("미래 날짜로 지급·환급할 수 없습니다.");
    let delta;
    if (p.kind === "void") {
      const entry = o.changes.find(
        (c) => c.paymentId === p.paymentId && c.paymentDelta && !c.voids,
      );
      if (!entry || o.changes.some((c) => c.voids === entry.paymentId))
        fail("정정할 지급 기록을 확인해 주세요.");
      delta = -entry.paymentDelta;
    } else {
      const amount = integer(p.amount, "금액", 1, 1e12);
      if (p.kind === "payment") {
        if (amount > Math.max(0, balance(o)))
          fail("남은 지급액보다 많이 입력했습니다.");
        delta = amount;
      } else if (p.kind === "refund") {
        if (amount > Math.max(0, -balance(o)))
          fail("거래처에서 돌려받을 금액보다 큽니다.");
        delta = -amount;
      } else fail("지급 또는 거래처 환급을 선택해 주세요.");
    }
    if (paidAmount(o) + delta < 0) fail("관련 환급 기록을 먼저 정정해 주세요.");
    stamp(
      o,
      p.kind === "void"
        ? "지급·환급 기록 정정"
        : p.kind === "refund"
          ? "거래처 환급"
          : "대금 분할 지급",
      {
        paymentId: randomUUID(),
        paymentDelta: delta,
        date: eventDate,
        reference: text(p.reference, "참조번호", 100),
        reason,
        ...(p.kind === "void" ? { voids: p.paymentId } : {}),
      },
    );
    o.paidDate = eventDate;
    settle();
    return d;
  }
  if (type === "purchase.ship") {
    if (!o.lines.some((l) => pending(o, l, d.receipts) > 0))
      fail("이미 입고가 완료된 발주입니다.");
    if (o.shipped) fail("이미 배송 시작이 기록된 발주입니다.");
    o.shipped = true;
    stamp(o, "배송 시작");
    return d;
  }
  if (type === "purchase.cancel") {
    if (o.lines.some((l) => received(l, d.receipts) > 0) || paidAmount(o) > 0)
      fail(
        "입고나 지급 기록이 있는 발주는 취소할 수 없습니다. 입고 취소 및 지급 정정을 먼저 처리해 주세요.",
      );
    const reason = text(p.reason, "취소 사유", 500, true);
    o.cancelled = true;
    stamp(o, "발주 취소", { reason });
    return d;
  }
  if (type === "purchase.payment") {
    const paid = active(p.paid),
      reason = text(p.reason, "지급 메모 / 정정 사유", 500, true);
    if (paid === o.paid) fail("이미 같은 지급 상태입니다.");
    const paidDate = paid ? date(p.paidDate, "지급일") : "";
    if (paidDate && paidDate > ctx.today)
      fail("지급일은 오늘 또는 이전 날짜로 입력해 주세요.");
    const previousPaid = paidAmount(o);
    o.paid = paid;
    o.paidDate = paidDate;
    o.reference = text(p.reference, "이체 확인 번호", 100);
    stamp(o, paid ? "대금 지급 기록" : "대금 지급 정정", {
      paidDate,
      reference: o.reference,
      reason,
      amount: total(o),
      paymentId: randomUUID(),
      paymentDelta: paid ? total(o) - previousPaid : -previousPaid,
      date: paidDate || ctx.today,
    });
    return d;
  }
  const receiptContext = {
    today: ctx.today,
    at: ctx.now,
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
  };
  if (type === "purchase.receive") {
    if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 100)
      fail("이번에 받은 품목과 수량을 입력해 주세요.");
    const receiptDate = date(p.date, "입고일");
    if (receiptDate > ctx.today || receiptDate < o.date)
      fail("입고일은 발주일과 오늘 사이로 입력해 주세요.");
    const ids = new Set();
    const details = [];
    for (const l of p.lines) {
      const line = find(o.lines, l?.lineId, "발주 품목");
      if (ids.has(line.id)) fail("같은 품목의 입고가 중복되었습니다.");
      ids.add(line.id);
      const qty = integer(l.quantity, "이번 입고 개수", 1, 1000000);
      if (qty > pending(o, line, d.receipts))
        fail(`${line.itemName}: 미입고 수량보다 많이 입력했습니다.`);
      const beforeIds = new Set((d.receipts || []).map((r) => r.id));
      d = stock(
        "addReceipt",
        d,
        {
          itemId: line.itemId,
          qty: Math.round(qty * line.packSize * 1000) / 1000,
          date: receiptDate,
          memo: text(p.memo, "입고 메모", 500),
          token: `${ctx.actor.id}:${ctx.requestId}:${line.id}`,
        },
        receiptContext,
      );
      const receipt = d.receipts.find((r) => !beforeIds.has(r.id));
      Object.assign(receipt, {
        orderId: o.id,
        orderLineId: line.id,
        packSize: line.packSize,
        packQty: qty,
      });
      details.push({ itemName: line.itemName, quantity: qty });
    }
    stamp(find(d.purchaseOrders, o.id, "발주"), "입고 기록", {
      lines: details,
    });
    return d;
  }
  if (type === "purchase.receiptCancel") {
    const r = find(d.receipts, p.receiptId, "입고");
    if (r.orderId !== o.id) fail("이 발주의 입고 내역이 아닙니다.");
    const line = find(o.lines, r.orderLineId, "발주 품목");
    if (returned(o, line) > 0)
      fail(
        "반품 이력이 있는 품목의 입고는 취소할 수 없습니다. 반품 기록을 확인해 주세요.",
      );
    const reason = text(p.reason, "입고 취소 사유", 500, true);
    d = stock(
      "cancelReceipt",
      d,
      {
        receiptId: r.id,
        expectedRevision: r.revision,
        reason,
        token: `${ctx.actor.id}:${ctx.requestId}`,
      },
      receiptContext,
    );
    stamp(find(d.purchaseOrders, o.id, "발주"), "입고 취소", {
      receiptId: r.id,
      reason,
    });
    return d;
  }
  fail("지원하지 않는 발주 작업입니다.", 404);
}
module.exports = { applyProcurement };
