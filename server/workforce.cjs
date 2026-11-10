"use strict";
// Attendance, leave/overtime requests, notices, expenses, certificates and
// purchase requests. Mutations return a new state and perform no database I/O.
const { randomUUID } = require("node:crypto");

const LEAVE_TYPES = {
  annual: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  sick: "병가",
  special: "경조사·공가",
  unpaid: "무급 휴가",
};
const OVERTIME_TYPES = {
  overtime: "연장 근무",
  night: "야간 근무",
  holiday: "휴일 근무",
};
const EXPENSE_CATEGORIES = [
  "임대료·관리비",
  "공과금",
  "소모품·비품",
  "마케팅·광고",
  "카드·결제 수수료",
  "세금·보험",
  "복리후생",
  "교육·세미나",
  "수리·유지보수",
  "기타",
];
const EXPENSE_METHODS = ["card", "corporate_card", "cash", "transfer", "auto"];
const OPEN_APPOINTMENTS = new Set(["booked", "checked_in", "in_service"]);
const LIVE_REQUEST = new Set(["requested", "approved"]);

function fail(message, status = 422, code = "VALIDATION") {
  throw Object.assign(new Error(message), { status, code });
}
function text(value, label, max = 500, required = false) {
  if (value == null) value = "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail(`${label}을(를) ${max}자 이내로 입력해 주세요.`);
  const result = value.trim();
  if (required && !result) fail(`${label}을(를) 입력해 주세요.`);
  return result;
}
function date(value, label = "날짜") {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "2199-12-31" ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    fail(`${label}을(를) 올바른 날짜로 입력해 주세요.`);
  return value;
}
function minutes(value, label, min = 0, max = 1440) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label}을(를) 확인해 주세요.`);
  return value;
}
function money(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000_000)
    fail(`${label}을(를) 1원 이상 정수로 입력해 주세요.`);
  return value;
}
function find(rows, value, label) {
  const row = (rows || []).find((entry) => entry.id === value);
  if (!row)
    fail(
      `${label}을(를) 찾을 수 없습니다. 새로고침 후 확인해 주세요.`,
      404,
      "NOT_FOUND",
    );
  return row;
}
function requireRole(ctx, roles) {
  if (!ctx?.actor || !roles.includes(ctx.actor.role))
    fail("이 작업을 수행할 권한이 없습니다.", 403, "FORBIDDEN");
}
function seoulMinutes(iso) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .split(":")
    .map(Number);
  return (h % 24) * 60 + m;
}
function addDays(value, delta) {
  const day = new Date(`${value}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + delta);
  return day.toISOString().slice(0, 10);
}
function eachDay(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
const weekday = (value) => new Date(`${value}T12:00:00Z`).getUTCDay();
const actorStamp = (ctx) => ({
  at: ctx.now,
  actorId: ctx.actor.id,
  actorName: ctx.actor.name,
});

/** Working days a leave consumes: staff working weekdays that are not store holidays. */
function leaveDays(data, staff, request) {
  if (request.type === "half_am" || request.type === "half_pm") return 0.5;
  return eachDay(request.from, request.to).filter(
    (day) =>
      (staff.workingDays || []).includes(weekday(day)) &&
      !(data.store.closedWeekdays || []).includes(weekday(day)),
  ).length;
}
function halfDayWindow(staff, type) {
  const middle =
    staff.breakStart != null
      ? staff.breakStart
      : Math.round((staff.startMinutes + staff.endMinutes) / 2 / 10) * 10;
  return type === "half_am"
    ? { start: staff.startMinutes, end: middle }
    : {
        start: staff.breakEnd != null ? staff.breakEnd : middle,
        end: staff.endMinutes,
      };
}
/** Annual leave balance for a calendar year. Pending requests count as reserved. */
function leaveBalance(data, staffId, year, ignoreId = null) {
  const staff = (data.staff || []).find((entry) => entry.id === staffId);
  const allowance = Number(staff?.annualLeave ?? 15);
  let used = 0,
    reserved = 0;
  for (const request of data.staffRequests || []) {
    if (
      request.id === ignoreId ||
      request.staffId !== staffId ||
      request.kind !== "leave" ||
      !["annual", "half_am", "half_pm"].includes(request.type) ||
      request.from.slice(0, 4) !== String(year)
    )
      continue;
    if (request.status === "approved") used += request.days;
    if (request.status === "requested") reserved += request.days;
  }
  return {
    allowance,
    used,
    reserved,
    remaining: allowance - used - reserved,
  };
}
/** Approved leave that blocks the given appointment window, if any. */
function leaveConflict(data, staffId, day, start, end) {
  return (data.staffRequests || []).find(
    (request) =>
      request.kind === "leave" &&
      request.status === "approved" &&
      request.staffId === staffId &&
      request.from <= day &&
      request.to >= day &&
      (request.start == null || (start < request.end && end > request.start)),
  );
}
function overlappingAppointments(data, request) {
  return (data.appointments || []).filter(
    (appointment) =>
      appointment.staffId === request.staffId &&
      OPEN_APPOINTMENTS.has(appointment.status) &&
      appointment.date >= request.from &&
      appointment.date <= request.to &&
      (request.start == null ||
        (appointment.start < request.end &&
          appointment.start + appointment.duration > request.start)),
  );
}

function clock(data, payload, ctx) {
  const staffId = ctx.actor.staffId;
  const staff = find(data.staff, staffId, "직원");
  if (staff.status !== "active") fail("재직 직원만 출퇴근을 기록할 수 있습니다.");
  const now = seoulMinutes(ctx.now);
  const record = data.attendance.find(
    (entry) => entry.staffId === staffId && entry.date === ctx.today,
  );
  if (payload.kind === "in") {
    if (record?.clockIn != null)
      fail(
        record.clockOut == null
          ? "이미 출근을 기록했습니다."
          : "오늘 퇴근까지 기록했습니다. 수정이 필요하면 원장에게 정정을 요청해 주세요.",
        409,
        "ATTENDANCE_EXISTS",
      );
    data.attendance.push({
      id: `att_${randomUUID()}`,
      staffId,
      date: ctx.today,
      clockIn: now,
      clockOut: null,
      source: "self",
      note: text(payload.note, "메모", 200),
      changes: [{ ...actorStamp(ctx), kind: "clock_in" }],
    });
  } else if (payload.kind === "out") {
    if (!record || record.clockIn == null)
      fail("오늘 출근 기록이 없습니다. 먼저 출근을 기록해 주세요.", 409);
    if (record.clockOut != null) fail("이미 퇴근을 기록했습니다.", 409);
    if (now < record.clockIn)
      fail("퇴근 시각이 출근 시각보다 빠릅니다. 원장에게 정정을 요청해 주세요.");
    record.clockOut = now;
    if (payload.note) record.note = text(payload.note, "메모", 200);
    record.changes.push({ ...actorStamp(ctx), kind: "clock_out" });
  } else fail("출근 또는 퇴근을 선택해 주세요.");
}
function attendanceSave(data, payload, ctx) {
  requireRole(ctx, ["owner"]);
  const existing = payload.id
    ? find(data.attendance, payload.id, "출퇴근 기록")
    : null;
  const staff = find(data.staff, payload.staffId, "직원");
  const day = date(payload.date, "근무일");
  if (day > ctx.today) fail("미래 날짜의 출퇴근은 기록할 수 없습니다.");
  const clockIn = minutes(payload.clockIn, "출근 시각", 0, 1439);
  const clockOut =
    payload.clockOut == null
      ? null
      : minutes(payload.clockOut, "퇴근 시각", 1, 1440);
  if (clockOut != null && clockOut <= clockIn)
    fail("퇴근 시각은 출근 시각 이후여야 합니다.");
  const reason = text(payload.reason, "정정 사유", 300, true);
  if (
    data.attendance.some(
      (entry) =>
        entry.id !== existing?.id &&
        entry.staffId === staff.id &&
        entry.date === day,
    )
  )
    fail("같은 날짜의 출퇴근 기록이 이미 있습니다. 기존 기록을 수정해 주세요.", 409);
  const change = {
    ...actorStamp(ctx),
    kind: existing ? "corrected" : "manual",
    reason,
    before: existing
      ? { date: existing.date, clockIn: existing.clockIn, clockOut: existing.clockOut }
      : null,
    after: { date: day, clockIn, clockOut },
  };
  if (existing)
    Object.assign(existing, {
      staffId: staff.id,
      date: day,
      clockIn,
      clockOut,
      changes: [...existing.changes, change],
    });
  else
    data.attendance.push({
      id: `att_${randomUUID()}`,
      staffId: staff.id,
      date: day,
      clockIn,
      clockOut,
      source: "manual",
      note: "",
      changes: [change],
    });
}
function attendanceDelete(data, payload, ctx) {
  requireRole(ctx, ["owner"]);
  const record = find(data.attendance, payload.id, "출퇴근 기록");
  text(payload.reason, "삭제 사유", 300, true);
  data.attendance = data.attendance.filter((entry) => entry !== record);
}

function requestCreate(data, payload, ctx) {
  const staffId = ctx.actor.staffId;
  const staff = find(data.staff, staffId, "직원");
  if (staff.status !== "active") fail("재직 직원만 신청할 수 있습니다.");
  const kind = payload.kind;
  const reason = text(payload.reason, "신청 사유", 500);
  const from = date(payload.from, "시작일");
  const request = {
    id: `req_${randomUUID()}`,
    staffId,
    kind,
    type: payload.type,
    from,
    to: from,
    start: null,
    end: null,
    days: 0,
    minutes: 0,
    reason,
    status: "requested",
    createdAt: ctx.now,
    createdBy: ctx.actor.id,
    changes: [{ ...actorStamp(ctx), kind: "requested" }],
  };
  if (kind === "leave") {
    if (!LEAVE_TYPES[payload.type]) fail("휴가 종류를 선택해 주세요.");
    const half = payload.type === "half_am" || payload.type === "half_pm";
    request.to = half ? from : date(payload.to ?? from, "종료일");
    if (request.to < from) fail("종료일은 시작일 이후여야 합니다.");
    if (eachDay(from, request.to).length > 31)
      fail("한 번에 31일까지 신청할 수 있습니다.");
    if (half) {
      if (!(staff.workingDays || []).includes(weekday(from)))
        fail("반차는 근무일에만 신청할 수 있습니다.");
      Object.assign(request, halfDayWindow(staff, payload.type));
      if (request.end <= request.start)
        fail("근무시간을 확인할 수 없어 반차를 계산하지 못했습니다.");
    }
    request.days = leaveDays(data, staff, request);
    if (!request.days) fail("선택한 기간에 근무일이 없습니다.");
    if (["annual", "half_am", "half_pm"].includes(payload.type)) {
      const balance = leaveBalance(data, staffId, Number(from.slice(0, 4)));
      if (request.days > balance.remaining)
        fail(
          `남은 연차(${balance.remaining}일)보다 많이 신청할 수 없습니다. 무급 휴가 등 다른 종류로 신청해 주세요.`,
          409,
          "LEAVE_BALANCE",
        );
    }
    const overlap = (data.staffRequests || []).find(
      (other) =>
        other.staffId === staffId &&
        other.kind === "leave" &&
        LIVE_REQUEST.has(other.status) &&
        other.from <= request.to &&
        other.to >= request.from &&
        (other.start == null ||
          request.start == null ||
          (request.start < other.end && request.end > other.start)),
    );
    if (overlap)
      fail("같은 기간에 신청한 휴가가 있습니다.", 409, "LEAVE_OVERLAP");
  } else if (kind === "overtime") {
    if (!OVERTIME_TYPES[payload.type]) fail("근무 종류를 선택해 주세요.");
    request.start = minutes(payload.start, "시작 시각", 0, 1439);
    request.end = minutes(payload.end, "종료 시각", 1, 1440);
    if (request.end <= request.start)
      fail("종료 시각은 시작 시각 이후여야 합니다.");
    request.minutes = request.end - request.start;
    if (
      (data.staffRequests || []).some(
        (other) =>
          other.staffId === staffId &&
          other.kind === "overtime" &&
          LIVE_REQUEST.has(other.status) &&
          other.from === from &&
          request.start < other.end &&
          request.end > other.start,
      )
    )
      fail("같은 시간대에 신청한 근무가 있습니다.", 409);
  } else fail("휴가 또는 연장·야간·휴일 근무를 선택해 주세요.");
  data.staffRequests.push(request);
}
function requestCancel(data, payload, ctx) {
  const request = find(data.staffRequests, payload.id, "신청");
  if (request.staffId !== ctx.actor.staffId)
    fail("본인이 신청한 내역만 취소할 수 있습니다.", 403, "FORBIDDEN");
  if (
    !(
      request.status === "requested" ||
      (request.status === "approved" && request.from > ctx.today)
    )
  )
    fail(
      "승인 대기 중이거나 아직 시작하지 않은 승인 건만 취소할 수 있습니다.",
      409,
    );
  request.status = "cancelled";
  request.changes.push({
    ...actorStamp(ctx),
    kind: "cancelled",
    reason: text(payload.reason, "취소 사유", 300),
  });
}
function requestDecide(data, payload, ctx) {
  requireRole(ctx, ["owner"]);
  const request = find(data.staffRequests, payload.id, "신청");
  const decision = payload.decision;
  const note = text(payload.note, "처리 메모", 300);
  if (decision === "approved" || decision === "rejected") {
    if (request.status !== "requested")
      fail("승인 대기 중인 신청만 처리할 수 있습니다.", 409);
    if (decision === "approved" && request.kind === "leave") {
      const conflicts = overlappingAppointments(data, request);
      if (conflicts.length)
        fail(
          `휴가 기간에 처리되지 않은 예약 ${conflicts.length}건이 있습니다 (${[
            ...new Set(conflicts.map((entry) => entry.date)),
          ]
            .slice(0, 3)
            .join(", ")}). 예약 담당자나 시간을 먼저 변경해 주세요.`,
          409,
          "LEAVE_APPOINTMENTS",
        );
    }
    if (decision === "rejected" && !note) fail("반려 사유를 입력해 주세요.");
  } else if (decision === "cancelled") {
    if (!LIVE_REQUEST.has(request.status))
      fail("이미 반려되었거나 취소된 신청입니다.", 409);
    if (!note) fail("승인 취소 사유를 입력해 주세요.");
  } else fail("승인 또는 반려를 선택해 주세요.");
  request.status = decision;
  request.decidedAt = ctx.now;
  request.decidedBy = ctx.actor.name;
  request.decisionNote = note;
  request.changes.push({ ...actorStamp(ctx), kind: decision, reason: note });
}

function noticeSave(data, payload, ctx) {
  requireRole(ctx, ["owner", "manager"]);
  const existing = payload.id ? find(data.notices, payload.id, "공지") : null;
  if (existing?.archived) fail("보관된 공지는 수정할 수 없습니다.", 409);
  if (typeof (payload.pinned ?? false) !== "boolean")
    fail("상단 고정 여부를 확인해 주세요.");
  const record = {
    ...(existing || {
      id: `notice_${randomUUID()}`,
      createdAt: ctx.now,
      authorId: ctx.actor.id,
      authorName: ctx.actor.name,
      archived: false,
    }),
    title: text(payload.title, "제목", 120, true),
    body: text(payload.body, "내용", 5000, true),
    pinned: payload.pinned ?? false,
    updatedAt: ctx.now,
  };
  if (existing) Object.assign(existing, record);
  else data.notices.push(record);
}
function noticeArchive(data, payload, ctx) {
  requireRole(ctx, ["owner", "manager"]);
  const notice = find(data.notices, payload.id, "공지");
  notice.archived = true;
  notice.pinned = false;
  notice.archivedAt = ctx.now;
  notice.archivedBy = ctx.actor.name;
}

function expenseRecord(payload, ctx, existing) {
  const category = payload.category;
  if (!EXPENSE_CATEGORIES.includes(category))
    fail("지출 분류를 선택해 주세요.");
  if (!EXPENSE_METHODS.includes(payload.method))
    fail("결제 수단을 선택해 주세요.");
  const day = date(payload.date, "지출일");
  if (day > ctx.today) fail("미래 날짜의 지출은 기록할 수 없습니다.");
  return {
    ...(existing || {
      id: `exp_${randomUUID()}`,
      createdAt: ctx.now,
      createdBy: ctx.actor.name,
      status: "active",
      changes: [],
    }),
    date: day,
    category,
    amount: money(payload.amount, "지출 금액"),
    vendor: text(payload.vendor, "거래처·사용처", 100, true),
    method: payload.method,
    reference: text(payload.reference, "승인·증빙 번호", 100),
    memo: text(payload.memo, "메모", 500),
    evidence: ["tax_invoice", "card_slip", "cash_receipt", "receipt", "none"].includes(
      payload.evidence,
    )
      ? payload.evidence
      : "receipt",
  };
}
function expenseSave(data, payload, ctx) {
  requireRole(ctx, ["owner"]);
  const existing = payload.id ? find(data.expenses, payload.id, "지출") : null;
  if (existing?.status === "void") fail("취소된 지출은 수정할 수 없습니다.", 409);
  const record = expenseRecord(payload, ctx, existing);
  record.changes = [
    ...(existing?.changes || []),
    { ...actorStamp(ctx), kind: existing ? "updated" : "created" },
  ];
  if (existing) Object.assign(existing, record);
  else data.expenses.push(record);
}
function expenseVoid(data, payload, ctx) {
  requireRole(ctx, ["owner"]);
  const expense = find(data.expenses, payload.id, "지출");
  if (expense.status === "void") fail("이미 취소된 지출입니다.", 409);
  expense.status = "void";
  expense.changes.push({
    ...actorStamp(ctx),
    kind: "void",
    reason: text(payload.reason, "취소 사유", 300, true),
  });
}
/** Bulk import of card statement rows. Duplicates (same date, amount, vendor, reference) are skipped. */
function expenseImport(data, payload, ctx) {
  requireRole(ctx, ["owner"]);
  if (!Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > 500)
    fail("가져올 내역을 1~500건 선택해 주세요.");
  const key = (row) =>
    [row.date, row.amount, row.vendor.toLowerCase(), row.reference].join("|");
  const existing = new Set(
    data.expenses.filter((row) => row.status !== "void").map(key),
  );
  let added = 0;
  payload.rows.forEach((row, index) => {
    let record;
    try {
      record = expenseRecord(
        {
          ...row,
          category: row.category || payload.category,
          method: payload.method,
          evidence: "card_slip",
        },
        ctx,
      );
    } catch (error) {
      fail(`${index + 1}번째 줄: ${error.message}`);
    }
    if (existing.has(key(record))) return;
    existing.add(key(record));
    record.changes = [{ ...actorStamp(ctx), kind: "imported" }];
    data.expenses.push(record);
    added += 1;
  });
  if (!added) fail("새로 추가할 내역이 없습니다. 이미 가져온 내역입니다.", 409);
}

function certificateIssue(data, payload, ctx) {
  requireRole(ctx, ["owner"]);
  const staff = find(data.staff, payload.staffId, "직원");
  const type = payload.type;
  if (!["employment", "career"].includes(type))
    fail("증명서 종류를 선택해 주세요.");
  if (!staff.hireDate)
    fail("직원 정보에 입사일을 먼저 입력해 주세요.", 409, "HIRE_DATE_REQUIRED");
  if (type === "employment" && staff.status !== "active")
    fail("재직증명서는 재직 중인 직원만 발급할 수 있습니다. 경력증명서를 발급해 주세요.", 409);
  const year = ctx.today.slice(0, 4);
  const sequence =
    data.certificates.filter((entry) => entry.number.startsWith(`${year}-`))
      .length + 1;
  data.certificates.push({
    id: `cert_${randomUUID()}`,
    number: `${year}-${String(sequence).padStart(4, "0")}`,
    staffId: staff.id,
    type,
    purpose: text(payload.purpose, "용도", 100, true),
    issuedAt: ctx.now,
    issuedDate: ctx.today,
    issuedBy: ctx.actor.name,
    snapshot: {
      name: staff.name,
      birthDate: staff.birthDate || "",
      address: staff.address || "",
      team: staff.team || "",
      title: staff.title || "",
      role: staff.role,
      hireDate: staff.hireDate,
      resignDate: staff.resignDate || "",
      duties: text(payload.duties, "담당 업무", 200),
    },
    store: {
      name: data.store.name,
      phone: data.store.phone || "",
      address: data.store.address || "",
      businessNumber: data.store.businessNumber || "",
      representative: data.store.representative || "",
      logo: data.store.logo || "",
    },
  });
}

function purchaseRequest(data, payload, ctx) {
  const item = find(data.items, payload.itemId, "품목");
  if (item.active === false) fail("사용 중지된 품목은 요청할 수 없습니다.");
  const quantity = payload.quantity;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999)
    fail("요청 수량(포장 개수)을 1~9999 사이로 입력해 주세요.");
  if (
    data.purchaseRequests.some(
      (entry) => entry.itemId === item.id && entry.status === "requested",
    )
  )
    fail("이미 구매 요청된 품목입니다. 기존 요청을 확인해 주세요.", 409);
  data.purchaseRequests.push({
    id: `pr_${randomUUID()}`,
    itemId: item.id,
    itemName: item.name,
    quantity,
    note: text(payload.note, "요청 메모", 300),
    staffId: ctx.actor.staffId,
    requestedBy: ctx.actor.name,
    createdAt: ctx.now,
    status: "requested",
  });
}
function purchaseRequestDecide(data, payload, ctx) {
  requireRole(ctx, ["owner", "manager"]);
  const request = find(data.purchaseRequests, payload.id, "구매 요청");
  if (request.status !== "requested")
    fail("대기 중인 구매 요청만 처리할 수 있습니다.", 409);
  if (!["ordered", "rejected"].includes(payload.status))
    fail("발주 반영 또는 반려를 선택해 주세요.");
  const note = text(payload.note, "처리 메모", 300, payload.status === "rejected");
  Object.assign(request, {
    status: payload.status,
    decisionNote: note,
    decidedBy: ctx.actor.name,
    decidedAt: ctx.now,
  });
}

const HANDLERS = {
  "attendance.clock": clock,
  "attendance.save": attendanceSave,
  "attendance.delete": attendanceDelete,
  "request.create": requestCreate,
  "request.cancel": requestCancel,
  "request.decide": requestDecide,
  "notice.save": noticeSave,
  "notice.archive": noticeArchive,
  "expense.save": expenseSave,
  "expense.void": expenseVoid,
  "expense.import": expenseImport,
  "certificate.issue": certificateIssue,
  "purchase.request": purchaseRequest,
  "purchase.requestDecide": purchaseRequestDecide,
};
const WORKFORCE_ACTIONS = Object.keys(HANDLERS);

function ensureCollections(data) {
  for (const key of [
    "attendance",
    "staffRequests",
    "notices",
    "expenses",
    "certificates",
    "purchaseRequests",
    "staffHistory",
  ])
    data[key] ||= [];
  return data;
}
function applyWorkforce(state, type, payload, ctx) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    fail("요청 형식을 확인해 주세요.");
  const handler = HANDLERS[type];
  if (!handler) fail("지원하지 않는 작업입니다.", 400, "UNKNOWN_ACTION");
  const data = ensureCollections(structuredClone(state));
  try {
    handler(data, payload, ctx);
  } catch (error) {
    if (!error.status) Object.assign(error, { status: 422, code: "VALIDATION" });
    throw error;
  }
  return data;
}

module.exports = {
  applyWorkforce,
  WORKFORCE_ACTIONS,
  LEAVE_TYPES,
  OVERTIME_TYPES,
  EXPENSE_CATEGORIES,
  leaveBalance,
  leaveConflict,
  leaveDays,
  ensureCollections,
  seoulMinutes,
};
