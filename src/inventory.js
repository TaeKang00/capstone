(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SalonInventory = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const MAX_QUANTITY = 1000000000;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const round = (value) => Math.round(value * 1000) / 1000;
  const clean = (value) => (typeof value === "string" ? value.trim() : "");

  function parseQuantity(raw, item, options) {
    const allowZero = !!(options && options.allowZero);
    if (typeof raw !== "string" && typeof raw !== "number")
      throw new Error("수량을 숫자로 입력해 주세요.");
    const text = String(raw).trim();
    if (!/^\d+(?:\.\d+)?$/.test(text))
      throw new Error("수량은 음수나 문자 없이 숫자로 입력해 주세요.");
    const value = Number(text);
    if (!Number.isFinite(value) || value > MAX_QUANTITY)
      throw new Error("수량은 10억 이하로 입력해 주세요.");
    if (value === 0 && !allowZero) throw new Error("수량은 0보다 커야 합니다.");
    const unit = item && item.unit;
    if (unit === "g" || unit === "ml") {
      if ((text.split(".")[1] || "").length > 3)
        throw new Error("g와 ml 수량은 소수점 셋째 자리까지 입력할 수 있습니다.");
    } else if (!Number.isInteger(value)) {
      throw new Error("개 단위 수량은 정수로 입력해 주세요.");
    }
    return value;
  }

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return false;
    const date = new Date(value + "T12:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }

  function normalize(data) {
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("재고 데이터를 불러올 수 없습니다.");
    const d = clone(data);
    ["items", "logs", "receipts", "inventoryOperations"].forEach((key) => {
      if (d[key] == null) d[key] = [];
      if (!Array.isArray(d[key]))
        throw new Error("재고 데이터 형식을 확인해 주세요.");
    });
    if (!d.seq || typeof d.seq !== "object" || Array.isArray(d.seq)) d.seq = {};
    d.receipts.forEach((receipt) => {
      if (receipt.revision == null) receipt.revision = 0;
      if (!receipt.status) receipt.status = "active";
      if (!Array.isArray(receipt.changes)) receipt.changes = [];
    });
    // Legacy completed orders already affected stock. Migrate their metadata only.
    (Array.isArray(d.orders) ? d.orders : [])
      .filter((order) => order.status === "입고 완료")
      .forEach((order) => {
        const id = "legacy-" + order.id;
        if (
          d.receipts.some(
            (receipt) =>
              receipt.id === id || receipt.legacyOrderId === order.id,
          )
        )
          return;
        const date = order.recvDate || order.date;
        const legacyLog = d.logs.find(
          (log) =>
            log.ref === order.id &&
            log.itemId === order.itemId &&
            log.kind === "입고",
        );
        const at =
          (legacyLog &&
            (legacyLog.at ||
              (typeof legacyLog.dt === "string" &&
                legacyLog.dt.replace(" ", "T")))) ||
          date;
        const actorId = order.actorId || null;
        const actorName = order.actorName || "기존 기록 (담당자 미기록)";
        d.receipts.push({
          id,
          legacyOrderId: order.id,
          itemId: order.itemId,
          qty: order.qty,
          date,
          actorId,
          actorName,
          memo: order.memo || "",
          status: "active",
          revision: 0,
          token: "legacy-" + order.id,
          changes: [
            {
              at,
              actorId,
              actorName,
              kind: "기존 입고",
              beforeQty: 0,
              afterQty: order.qty,
              delta: order.qty,
              reason: "기존 입고 완료 기록 이관",
            },
          ],
        });
      });
    return d;
  }

  function stockStatus(item) {
    return Number(item.qty) <= 0
      ? "품절"
      : Number(item.qty) <= Number(item.min)
        ? "보충 필요"
        : "정상";
  }

  function context(ctx) {
    if (
      !ctx ||
      !validDate(ctx.today) ||
      !clean(ctx.at) ||
      !Number.isFinite(Date.parse(ctx.at))
    )
      throw new Error("작업 날짜를 확인해 주세요.");
    if (!clean(ctx.actorId) || !clean(ctx.actorName))
      throw new Error("작업 직원을 선택해 주세요.");
    return {
      today: ctx.today,
      at: ctx.at,
      actorId: clean(ctx.actorId),
      actorName: clean(ctx.actorName),
    };
  }

  function begin(data, form, ctx, kind, fields) {
    const d = normalize(data);
    if (!form || !clean(form.token))
      throw new Error("저장 요청 정보가 없습니다. 창을 다시 열어 주세요.");
    const token = clean(form.token);
    const signature = JSON.stringify(
      [kind].concat(
        fields.map((key) => [key, form[key] == null ? null : form[key]]),
      ),
    );
    const previous = d.inventoryOperations.find(
      (operation) => operation.token === token,
    );
    if (previous) {
      if (previous.signature !== signature)
        throw new Error("이미 사용한 저장 요청입니다. 창을 다시 열어 주세요.");
      return { d, duplicate: true };
    }
    return { d, token, signature, kind, ctx: context(ctx), duplicate: false };
  }

  function getItem(d, itemId) {
    const item = d.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("품목을 찾을 수 없습니다.");
    item.qty = parseQuantity(item.qty, item, { allowZero: true });
    return item;
  }

  function nextId(d, key, prefix, collection) {
    let counter =
      Number.isSafeInteger(d.seq[key]) && d.seq[key] > 0 ? d.seq[key] : 1;
    let id;
    do {
      id = prefix + counter++;
    } while (collection.some((record) => record.id === id));
    d.seq[key] = counter;
    return id;
  }

  function stockAfter(item, delta) {
    const after = round(item.qty + delta);
    if (after < 0)
      throw new Error(
        "이미 사용한 수량 때문에 재고가 음수가 됩니다. 현재 재고를 확인해 주세요.",
      );
    parseQuantity(after, item, { allowZero: true });
    return after;
  }

  function localTime(at) {
    const date = new Date(at);
    return (
      String(date.getHours()).padStart(2, "0") +
      ":" +
      String(date.getMinutes()).padStart(2, "0")
    );
  }

  function addLog(op, item, delta, kind, extra) {
    const dateTime = op.ctx.today + " " + localTime(op.ctx.at);
    const log = Object.assign(
      {
        id: nextId(op.d, "l", "L", op.d.logs),
        dt: dateTime,
        at: op.ctx.at,
        itemId: item.id,
        delta,
        kind,
        after: item.qty,
        ref: "",
        actorId: op.ctx.actorId,
        actorName: op.ctx.actorName,
        reason: "",
      },
      extra || {},
    );
    op.d.logs.push(log);
  }

  function finish(op, itemId, receiptId) {
    op.d.inventoryOperations.push({
      token: op.token,
      signature: op.signature,
      kind: op.kind,
      at: op.ctx.at,
      itemId,
      receiptId: receiptId || null,
    });
    return op.d;
  }

  function change(
    op,
    kind,
    beforeQty,
    afterQty,
    reason,
    beforeStock,
    afterStock,
  ) {
    return {
      at: op.ctx.at,
      actorId: op.ctx.actorId,
      actorName: op.ctx.actorName,
      kind,
      beforeQty,
      afterQty,
      delta: round(afterQty - beforeQty),
      reason,
      beforeStock,
      afterStock,
    };
  }

  function addReceipt(data, form, ctx) {
    const op = begin(data, form, ctx, "입고", [
      "itemId",
      "qty",
      "date",
      "memo",
    ]);
    if (op.duplicate) return op.d;
    const item = getItem(op.d, form.itemId);
    const qty = parseQuantity(form.qty, item);
    if (!validDate(form.date) || form.date > op.ctx.today)
      throw new Error("입고일은 오늘 또는 이전의 올바른 날짜로 입력해 주세요.");
    const before = item.qty;
    item.qty = stockAfter(item, qty);
    const id = nextId(op.d, "receipt", "IN", op.d.receipts);
    op.d.receipts.push({
      id,
      itemId: item.id,
      qty,
      date: form.date,
      memo: clean(form.memo),
      actorId: op.ctx.actorId,
      actorName: op.ctx.actorName,
      status: "active",
      revision: 0,
      token: op.token,
      changes: [change(op, "입고", 0, qty, clean(form.memo), before, item.qty)],
    });
    addLog(op, item, qty, "입고", {
      dt: form.date + " " + localTime(op.ctx.at),
      receiptId: id,
      ref: id,
      reason: clean(form.memo),
    });
    return finish(op, item.id, id);
  }

  function editableReceipt(op, form) {
    const receipt = op.d.receipts.find(
      (candidate) => candidate.id === form.receiptId,
    );
    if (!receipt) throw new Error("입고 내역을 찾을 수 없습니다.");
    if (receipt.status !== "active")
      throw new Error("취소된 입고 내역은 변경할 수 없습니다.");
    if (
      !Number.isInteger(form.expectedRevision) ||
      form.expectedRevision !== receipt.revision
    )
      throw new Error(
        "입고 내역이 변경되었습니다. 창을 다시 열어 확인해 주세요.",
      );
    if (!clean(form.reason)) throw new Error("변경 사유를 입력해 주세요.");
    return receipt;
  }

  function correctReceipt(data, form, ctx) {
    const op = begin(data, form, ctx, "입고 정정", [
      "receiptId",
      "qty",
      "reason",
      "expectedRevision",
    ]);
    if (op.duplicate) return op.d;
    const receipt = editableReceipt(op, form);
    const item = getItem(op.d, receipt.itemId);
    const qty = parseQuantity(form.qty, item);
    const beforeQty = parseQuantity(receipt.qty, item);
    if (qty === beforeQty) throw new Error("기존 입고 수량과 같습니다.");
    const delta = round(qty - beforeQty);
    const beforeStock = item.qty;
    item.qty = stockAfter(item, delta);
    receipt.qty = qty;
    receipt.revision += 1;
    receipt.changes.push(
      change(
        op,
        "입고 정정",
        beforeQty,
        qty,
        clean(form.reason),
        beforeStock,
        item.qty,
      ),
    );
    addLog(op, item, delta, "입고 정정", {
      receiptId: receipt.id,
      ref: receipt.id,
      reason: clean(form.reason),
    });
    return finish(op, item.id, receipt.id);
  }

  function cancelReceipt(data, form, ctx) {
    const op = begin(data, form, ctx, "입고 취소", [
      "receiptId",
      "reason",
      "expectedRevision",
    ]);
    if (op.duplicate) return op.d;
    const receipt = editableReceipt(op, form);
    const item = getItem(op.d, receipt.itemId);
    const qty = parseQuantity(receipt.qty, item);
    const beforeStock = item.qty;
    item.qty = stockAfter(item, -qty);
    receipt.status = "cancelled";
    receipt.revision += 1;
    receipt.changes.push(
      change(
        op,
        "입고 취소",
        qty,
        0,
        clean(form.reason),
        beforeStock,
        item.qty,
      ),
    );
    addLog(op, item, -qty, "입고 취소", {
      receiptId: receipt.id,
      ref: receipt.id,
      reason: clean(form.reason),
    });
    return finish(op, item.id, receipt.id);
  }

  function setThreshold(data, form, ctx) {
    const op = begin(data, form, ctx, "기준 변경", ["itemId", "qty", "reason"]);
    if (op.duplicate) return op.d;
    const item = getItem(op.d, form.itemId);
    const qty = parseQuantity(form.qty, item, { allowZero: true });
    const beforeMin = parseQuantity(item.min, item, { allowZero: true });
    if (beforeMin === qty) throw new Error("현재 기준 수량과 같습니다.");
    item.min = qty;
    addLog(op, item, 0, "기준 변경", {
      beforeMin,
      afterMin: qty,
      ref: "보충 기준",
      reason: clean(form.reason) || "보충 기준 수량 변경",
    });
    return finish(op, item.id);
  }

  function adjustStock(data, form, ctx) {
    const op = begin(data, form, ctx, "재고 조정", ["itemId", "qty", "reason"]);
    if (op.duplicate) return op.d;
    const item = getItem(op.d, form.itemId);
    const qty = parseQuantity(form.qty, item, { allowZero: true });
    if (qty === item.qty) throw new Error("현재 수량과 같습니다.");
    if (!clean(form.reason)) throw new Error("조정 사유를 입력해 주세요.");
    const beforeStock = item.qty;
    const delta = round(qty - item.qty);
    item.qty = qty;
    addLog(op, item, delta, "재고 조정", {
      beforeStock,
      ref: clean(form.reason),
      reason: clean(form.reason),
    });
    return finish(op, item.id);
  }

  return Object.freeze({
    parseQuantity,
    normalize,
    stockStatus,
    addReceipt,
    correctReceipt,
    cancelReceipt,
    setThreshold,
    adjustStock,
  });
});
