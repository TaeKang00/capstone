"use strict";

const { randomUUID } = require("node:crypto");
const inventory = require("../src/inventory.js");
const ROLES = ["owner", "manager", "designer", "reception"];
const STATUSES = [
  "booked",
  "checked_in",
  "in_service",
  "completed",
  "cancelled",
  "no_show",
];
const OPEN = new Set(["booked", "checked_in", "in_service"]);
const clone = (value) => structuredClone(value);

function fail(message, code = "VALIDATION", status = 422) {
  throw Object.assign(new Error(message), { code, status });
}
function object(value, label = "입력") {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} 형식을 확인해 주세요.`);
  return value;
}
function str(value, label, max = 200, required = false) {
  if (value == null && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail(`${label}을(를) ${max}자 이내로 입력해 주세요.`);
  const text = value.trim();
  if (required && !text) fail(`${label}을(를) 입력해 주세요.`);
  return text;
}
function id(value) {
  return str(value, "식별자", 100, true);
}
function int(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label} 범위를 확인해 주세요.`);
  return value;
}
function bool(value, label) {
  if (typeof value !== "boolean") fail(`${label} 값을 확인해 주세요.`);
  return value;
}
function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} 값을 확인해 주세요.`);
  return value;
}
function date(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "2199-12-31" ||
    !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    fail("올바른 날짜를 입력해 주세요.");
  return value;
}
function phone(value, label = "연락처") {
  const result = str(value, label, 30);
  if (
    result &&
    (!/^[+\d() -]+$/.test(result) ||
      result.replace(/\D/g, "").length < 7 ||
      result.replace(/\D/g, "").length > 15)
  )
    fail(`${label} 형식을 확인해 주세요.`);
  return result;
}
function list(value, label, limit = 100) {
  if (!Array.isArray(value) || value.length > limit)
    fail(`${label} 목록을 확인해 주세요.`);
  return value;
}
function days(value, label) {
  const result = list(value, label, 7).map((day) => int(day, label, 0, 6));
  if (new Set(result).size !== result.length)
    fail(`${label}에 중복 요일이 있습니다.`);
  return result.sort();
}
function find(rows, value, label) {
  const found = rows.find((row) => row.id === id(value));
  if (!found)
    fail(
      `${label}을(를) 찾을 수 없습니다. 새로고침 후 확인해 주세요.`,
      "NOT_FOUND",
      404,
    );
  return found;
}
function recordId(prefix) {
  return `${prefix}_${randomUUID()}`;
}
function requireRole(ctx, roles) {
  if (!ctx?.actor || !roles.includes(ctx.actor.role))
    fail("이 작업을 수행할 권한이 없습니다.", "FORBIDDEN", 403);
}
function stamp(ctx, action, detail = {}) {
  return {
    at: ctx.now,
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    action,
    ...detail,
  };
}

function initialState({ storeName, ownerName, ownerStaffId }) {
  return {
    schemaVersion: 2,
    store: {
      name: str(storeName, "매장명", 100, true),
      phone: "",
      address: "",
      timeZone: "Asia/Seoul",
      open: 600,
      close: 1200,
      slotMinutes: 30,
      closedWeekdays: [],
    },
    staff: [
      {
        id: id(ownerStaffId),
        name: str(ownerName, "원장 이름", 100, true),
        phone: "",
        role: "owner",
        status: "active",
        workingDays: [0, 1, 2, 3, 4, 5, 6],
        startMinutes: 600,
        endMinutes: 1200,
        breakStart: null,
        breakEnd: null,
      },
    ],
    services: [],
    customers: [],
    appointments: [],
    transactions: [],
    refunds: [],
    items: [],
    receipts: [],
    logs: [],
    inventoryOperations: [],
    payroll: [],
    seq: {},
  };
}

function checkSchedule(
  data,
  appointment,
  { historical = false, allowInactive = false } = {},
) {
  const staff = find(data.staff, appointment.staffId, "직원");
  if (
    !allowInactive &&
    (staff.status !== "active" || staff.role === "reception")
  )
    fail("예약을 담당할 재직 디자이너 또는 원장·매니저를 선택해 주세요.");
  const weekday = new Date(`${appointment.date}T12:00:00Z`).getUTCDay();
  const end = appointment.start + appointment.duration;
  if (!historical) {
    if (data.store.closedWeekdays.includes(weekday))
      fail("매장 휴무일에는 예약을 등록할 수 없습니다.");
    if (appointment.start < data.store.open || end > data.store.close)
      fail("예약 시간이 매장 영업시간을 벗어납니다.");
    if (
      !staff.workingDays.includes(weekday) ||
      appointment.start < staff.startMinutes ||
      end > staff.endMinutes
    )
      fail("예약 시간이 담당 직원의 근무시간을 벗어납니다.");
    if (
      staff.breakStart != null &&
      appointment.start < staff.breakEnd &&
      end > staff.breakStart
    )
      fail("담당 직원의 휴게시간과 겹칩니다.");
  }
  const conflict = data.appointments.find(
    (other) =>
      other.id !== appointment.id &&
      other.staffId === appointment.staffId &&
      other.date === appointment.date &&
      OPEN.has(other.status) &&
      appointment.start < other.start + other.duration &&
      end > other.start,
  );
  if (conflict)
    fail(
      "같은 직원의 다른 예약 시간과 겹칩니다. 시간을 변경해 주세요.",
      "APPOINTMENT_CONFLICT",
      409,
    );
}

function customerSave(data, payload, ctx) {
  requireRole(ctx, ROLES);
  const existing = payload.id ? find(data.customers, payload.id, "고객") : null;
  const result = {
    ...(existing || {
      id: recordId("customer"),
      createdAt: ctx.now,
      archived: false,
    }),
    name: str(payload.name, "고객 이름", 100, true),
    phone: phone(payload.phone),
    memo: str(payload.memo, "고객 메모", 4000),
    warning: str(payload.warning, "주의사항", 1000),
  };
  const digits = result.phone.replace(/\D/g, "");
  if (
    digits &&
    data.customers.some(
      (customer) =>
        customer.id !== result.id &&
        customer.phone.replace(/\D/g, "") === digits,
    )
  )
    fail(
      "같은 연락처로 등록된 고객이 있습니다. 기존 고객 정보를 확인해 주세요.",
      "DUPLICATE_PHONE",
      409,
    );
  if (existing) Object.assign(existing, result);
  else data.customers.push(result);
}

function appointmentSave(data, payload, ctx) {
  requireRole(ctx, ROLES);
  const existing = payload.id
    ? find(data.appointments, payload.id, "예약")
    : null;
  if (existing?.transactionId || (existing && !OPEN.has(existing.status)))
    fail(
      "완료·취소·노쇼 예약은 상태를 복구한 후 변경해 주세요. 결제된 예약은 수납 기록에서 확인해 주세요.",
      "LOCKED",
      409,
    );
  const staffId = id(payload.staffId);
  if (
    ctx.actor.role === "designer" &&
    (staffId !== ctx.actor.staffId ||
      (existing && existing.staffId !== ctx.actor.staffId))
  )
    fail("본인 담당 예약만 변경할 수 있습니다.", "FORBIDDEN", 403);
  const serviceIds = list(payload.serviceIds, "시술", 50).map(id);
  if (!serviceIds.length || new Set(serviceIds).size !== serviceIds.length)
    fail("중복 없이 시술을 하나 이상 선택해 주세요.");
  const services = serviceIds.map((serviceId) => {
    const service = find(data.services, serviceId, "시술");
    if (!service.active && !existing?.serviceIds.includes(serviceId))
      fail("중지된 시술은 새로 예약할 수 없습니다.");
    return service;
  });
  const customerId = payload.customerId ? id(payload.customerId) : null;
  if (customerId) {
    const customer = find(data.customers, customerId, "고객");
    if (customer.archived && existing?.customerId !== customerId)
      fail("보관된 고객은 복구한 후 예약할 수 있습니다.");
  }
  const result = {
    ...(existing || {
      id: recordId("appointment"),
      status: "booked",
      transactionId: null,
      changes: [],
    }),
    date: date(payload.date),
    start: int(payload.start, "시작 시간", 0, 1439),
    duration:
      payload.duration == null
        ? services.reduce((sum, service) => sum + service.duration, 0)
        : int(payload.duration, "소요 시간", 5, 1440),
    customerId,
    guestName: str(payload.guestName, "방문 고객 이름", 100, !customerId),
    guestPhone: phone(payload.guestPhone),
    staffId,
    serviceIds,
    notes: str(payload.notes, "예약 메모", 4000),
  };
  if (
    result.duration < 5 ||
    result.duration > 1440 ||
    result.start + result.duration > 1440
  )
    fail("예약 소요 시간을 확인해 주세요.");
  checkSchedule(data, result);
  result.changes = [
    ...result.changes,
    stamp(
      ctx,
      existing ? "updated" : "created",
      existing
        ? {
            before: {
              date: existing.date,
              start: existing.start,
              duration: existing.duration,
              staffId: existing.staffId,
              serviceIds: existing.serviceIds,
            },
            after: {
              date: result.date,
              start: result.start,
              duration: result.duration,
              staffId: result.staffId,
              serviceIds: result.serviceIds,
            },
          }
        : {},
    ),
  ];
  if (existing) Object.assign(existing, result);
  else data.appointments.push(result);
}

function appointmentStatus(data, payload, ctx) {
  requireRole(ctx, ROLES);
  const appointment = find(data.appointments, payload.id, "예약");
  if (
    ctx.actor.role === "designer" &&
    appointment.staffId !== ctx.actor.staffId
  )
    fail("본인 담당 예약만 변경할 수 있습니다.", "FORBIDDEN", 403);
  const status = oneOf(payload.status, STATUSES, "예약 상태");
  if (status === appointment.status) return;
  if (appointment.transactionId)
    fail("결제된 예약은 수납·환불 화면에서 처리해 주세요.", "LOCKED", 409);
  if (status === "completed")
    fail(
      "완료 처리는 수납 기록을 등록하면 자동 반영됩니다.",
      "PAYMENT_REQUIRED",
      409,
    );
  if (
    ["checked_in", "in_service"].includes(status) &&
    appointment.date > ctx.today
  )
    fail(
      "미래 예약은 방문·시술 처리할 수 없습니다. 오늘 방문했다면 예약 날짜를 먼저 변경해 주세요.",
    );
  if (status === "no_show" && appointment.date > ctx.today)
    fail("미래 예약은 노쇼로 처리할 수 없습니다.");
  const reason = str(payload.reason, "상태 변경 사유", 1000);
  const rank = { booked: 0, checked_in: 1, in_service: 2 };
  const reversal =
    !OPEN.has(appointment.status) ||
    (OPEN.has(status) && rank[status] < rank[appointment.status]);
  if ((reversal || status === "cancelled" || status === "no_show") && !reason)
    fail("취소·노쇼·상태 복구 사유를 입력해 주세요.");
  if (OPEN.has(status) && !OPEN.has(appointment.status))
    checkSchedule(data, appointment, {
      historical: appointment.date < ctx.today,
      allowInactive: appointment.date < ctx.today,
    });
  appointment.changes.push(
    stamp(ctx, "status", { before: appointment.status, after: status, reason }),
  );
  appointment.status = status;
}

function staffSave(data, payload, ctx) {
  requireRole(ctx, ["owner", "manager"]);
  const existing = payload.id ? find(data.staff, payload.id, "직원") : null;
  const role = oneOf(payload.role, ROLES, "직책");
  if (
    ctx.actor.role !== "owner" &&
    (role === "owner" || existing?.role === "owner")
  )
    fail("원장 직원 정보는 원장만 변경할 수 있습니다.", "FORBIDDEN", 403);
  const result = {
    ...(existing || { id: recordId("staff") }),
    name: str(payload.name, "직원 이름", 100, true),
    phone: phone(payload.phone),
    role,
    status: oneOf(payload.status, ["active", "inactive"], "재직 상태"),
    workingDays: days(payload.workingDays, "근무 요일"),
    startMinutes: int(payload.startMinutes, "출근 시간", 0, 1439),
    endMinutes: int(payload.endMinutes, "퇴근 시간", 1, 1440),
    breakStart:
      payload.breakStart == null || payload.breakStart === ""
        ? null
        : int(payload.breakStart, "휴게 시작", 0, 1439),
    breakEnd:
      payload.breakEnd == null || payload.breakEnd === ""
        ? null
        : int(payload.breakEnd, "휴게 종료", 1, 1440),
  };
  if (result.startMinutes >= result.endMinutes)
    fail("퇴근 시간은 출근 시간 이후여야 합니다.");
  if (
    (result.breakStart == null) !== (result.breakEnd == null) ||
    (result.breakStart != null &&
      (result.breakStart < result.startMinutes ||
        result.breakEnd > result.endMinutes ||
        result.breakEnd <= result.breakStart))
  )
    fail("휴게시간은 근무시간 안에서 시작·종료를 모두 입력해 주세요.");
  if (result.status === "active" && !result.workingDays.length)
    fail("재직 직원의 근무 요일을 하나 이상 선택해 주세요.");
  if (
    existing?.role === "owner" &&
    existing.status === "active" &&
    (result.role !== "owner" || result.status !== "active") &&
    !data.staff.some(
      (staff) =>
        staff.id !== existing.id &&
        staff.role === "owner" &&
        staff.status === "active",
    )
  )
    fail(
      "마지막 재직 원장은 비활성화하거나 직책을 변경할 수 없습니다.",
      "LAST_OWNER",
      409,
    );
  if (existing) Object.assign(existing, result);
  else data.staff.push(result);
  for (const appointment of data.appointments.filter(
    (row) =>
      row.staffId === result.id &&
      row.date >= ctx.today &&
      OPEN.has(row.status),
  )) {
    try {
      checkSchedule(data, appointment);
    } catch (error) {
      fail(
        `기존 예약(${appointment.date})을 먼저 변경해 주세요. ${error.message}`,
        "EXISTING_APPOINTMENTS",
        409,
      );
    }
  }
}

function serviceSave(data, payload, ctx) {
  requireRole(ctx, ["owner", "manager"]);
  const existing = payload.id ? find(data.services, payload.id, "시술") : null;
  const materials = list(payload.materials ?? [], "사용 재료", 100).map(
    (material) => {
      object(material, "재료");
      const item = find(data.items, material.itemId, "재료");
      if (item.kind !== "시술 재료")
        fail("시술에는 시술 재료 품목만 연결할 수 있습니다.");
      if (
        item.active === false &&
        !existing?.materials.some((old) => old.itemId === item.id)
      )
        fail("중지된 재료를 새로 연결할 수 없습니다.");
      return {
        itemId: item.id,
        quantity: inventory.parseQuantity(material.quantity, item),
      };
    },
  );
  if (
    new Set(materials.map((material) => material.itemId)).size !==
    materials.length
  )
    fail("같은 재료를 중복 등록할 수 없습니다.");
  const result = {
    ...(existing || { id: recordId("service") }),
    name: str(payload.name, "시술명", 100, true),
    price: int(payload.price, "시술 금액", 0, 1_000_000_000),
    duration: int(payload.duration, "시술 시간", 5, 1440),
    materials,
    active: bool(payload.active ?? true, "시술 사용 여부"),
  };
  if (
    data.services.some(
      (service) =>
        service.id !== result.id &&
        service.name.toLocaleLowerCase("ko-KR") ===
          result.name.toLocaleLowerCase("ko-KR"),
    )
  )
    fail("같은 이름의 시술이 이미 있습니다.", "DUPLICATE_SERVICE", 409);
  if (existing) Object.assign(existing, result);
  else data.services.push(result);
}

function storeSave(data, payload, ctx) {
  requireRole(ctx, ["owner", "manager"]);
  const result = {
    name: str(payload.name, "매장명", 100, true),
    phone: phone(payload.phone, "매장 전화번호"),
    address: str(payload.address, "매장 주소", 500),
    timeZone: oneOf(payload.timeZone ?? "Asia/Seoul", ["Asia/Seoul"], "시간대"),
    open: int(payload.open, "개점 시간", 0, 1439),
    close: int(payload.close, "폐점 시간", 1, 1440),
    slotMinutes: oneOf(
      payload.slotMinutes,
      [5, 10, 15, 20, 30, 60],
      "예약 시간 간격",
    ),
    closedWeekdays: days(payload.closedWeekdays, "정기 휴무일"),
  };
  if (result.open >= result.close || result.closedWeekdays.length === 7)
    fail("영업시간과 영업 요일을 확인해 주세요.");
  data.store = result;
  for (const appointment of data.appointments.filter(
    (row) => row.date >= ctx.today && OPEN.has(row.status),
  )) {
    try {
      checkSchedule(data, appointment);
    } catch (error) {
      fail(
        `기존 예약(${appointment.date})을 먼저 변경해 주세요. ${error.message}`,
        "EXISTING_APPOINTMENTS",
        409,
      );
    }
  }
}

function uniqueRows(rows, label) {
  list(rows, label, 100000);
  const ids = new Set();
  for (const row of rows) {
    object(row, label);
    const rowId = id(row.id);
    if (ids.has(rowId))
      fail(`${label} 식별자가 중복되어 가져올 수 없습니다.`, "INVALID_IMPORT");
    ids.add(rowId);
  }
  return rows;
}
function time(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    fail("기존 기록의 시간 형식이 올바르지 않습니다.", "INVALID_IMPORT");
  return value;
}
function localTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(value)
  )
    fail("기존 기록의 일시를 확인해 주세요.", "INVALID_IMPORT");
  date(value.slice(0, 10));
  time(value.slice(11));
  return `${value.slice(0, 10)}T${value.slice(11)}:00+09:00`;
}
function importLegacy(current, payload, ctx) {
  requireRole(ctx, ["owner"]);
  if (
    [
      "customers",
      "appointments",
      "transactions",
      "refunds",
      "items",
      "services",
      "receipts",
      "logs",
      "payroll",
    ].some((key) => current[key]?.length) ||
    current.staff.length !== 1 ||
    current.legacyArchive
  )
    fail(
      "기존 데이터 가져오기는 최초 등록 직후의 빈 매장에서만 가능합니다.",
      "IMPORT_NOT_EMPTY",
      409,
    );
  let legacy = object(payload.data, "기존 데이터");
  if (legacy.data && !legacy.resv) legacy = object(legacy.data, "기존 데이터");
  if (
    legacy.schemaVersion != null ||
    !Array.isArray(legacy.resv) ||
    !Array.isArray(legacy.txns)
  )
    fail("지원하는 v2 브라우저 저장 데이터가 아닙니다.", "INVALID_IMPORT");
  ["staff", "services", "customers", "items", "resv", "txns", "logs"].forEach(
    (key) => uniqueRows(legacy[key], key),
  );
  if (!legacy.store || !legacy.staff.length)
    fail("기존 매장·직원 정보가 없습니다.", "INVALID_IMPORT");
  for (const transaction of legacy.txns) {
    if (
      transaction.status === "취소" &&
      transaction.cancel?.mode === "redo" &&
      transaction.resvId &&
      !legacy.resv.find((row) => row.id === transaction.resvId)?.txnId
    )
      fail(
        "기존 앱에 결제 재기록 대기 예약이 있습니다. 원 결제·사용 재료를 확인하고 대기 기록을 정리한 후 가져와 주세요.",
        "LEGACY_PENDING_CORRECTION",
        409,
      );
  }
  const data = clone(current);
  // Retain the untouched source for recovery, including pending orders and older metadata.
  // This archive is never sent in the application state API; it stays inside DB backups.
  data.legacyArchive = clone(legacy);
  data.legacyImport = {
    at: ctx.now,
    actorId: ctx.actor.id,
    staffCount: legacy.staff.length,
    customerCount: legacy.customers.length,
    transactionCount: legacy.txns.length,
  };
  data.store = {
    name: str(legacy.store.name, "기존 매장명", 100, true),
    phone: phone(legacy.store.phone),
    address: str(legacy.store.address, "기존 주소", 500),
    timeZone: "Asia/Seoul",
    open: int(legacy.store.open, "기존 개점 시간", 0, 1439),
    close: int(legacy.store.close, "기존 폐점 시간", 1, 1440),
    slotMinutes: 30,
    closedWeekdays: [],
  };
  if (data.store.open >= data.store.close)
    fail("기존 매장 영업시간이 올바르지 않습니다.", "INVALID_IMPORT");
  const roleMap = { 원장: "owner", 디자이너: "designer", 스태프: "reception" };
  const statusMap = {
    예약: "booked",
    "시술 중": "in_service",
    완료: "completed",
    취소: "cancelled",
    노쇼: "no_show",
  };
  const methodMap = { 카드: "card", 현금: "cash", 계좌이체: "transfer" };
  data.staff.push(
    ...legacy.staff.map((staff) => {
      if (staff.id === current.staff[0].id)
        fail("기존 직원 식별자가 관리자와 중복됩니다.", "INVALID_IMPORT");
      oneOf(staff.role, Object.keys(roleMap), "기존 직책");
      oneOf(staff.status, ["재직", "휴직"], "기존 재직 상태");
      return {
        id: id(staff.id),
        name: str(staff.name, "기존 직원 이름", 100, true),
        role: roleMap[staff.role],
        phone: phone(staff.phone),
        status: staff.status === "재직" ? "active" : "inactive",
        workingDays: [0, 1, 2, 3, 4, 5, 6],
        startMinutes: data.store.open,
        endMinutes: data.store.close,
        breakStart: null,
        breakEnd: null,
      };
    }),
  );
  data.items = legacy.items.map((item) => {
    oneOf(item.unit, ["g", "ml", "개"], "기존 품목 단위");
    return {
      id: id(item.id),
      name: str(item.name, "기존 품목명", 100, true),
      kind: oneOf(item.kind, ["시술 재료", "판매 상품"], "기존 품목 종류"),
      unit: item.unit,
      qty: inventory.parseQuantity(item.qty, item, { allowZero: true }),
      min: inventory.parseQuantity(item.min, item, { allowZero: true }),
      price: int(item.price, "기존 품목 가격", 0, 1_000_000_000),
      active: true,
    };
  });
  data.services = legacy.services.map((service) => {
    const materials = list(service.mats, "기존 시술 재료", 100).map(
      (material) => {
        const item = find(data.items, material.itemId, "기존 시술 재료");
        if (item.kind !== "시술 재료")
          fail("기존 시술 재료 연결이 올바르지 않습니다.", "INVALID_IMPORT");
        return {
          itemId: item.id,
          quantity: inventory.parseQuantity(material.amt, item),
        };
      },
    );
    if (
      new Set(materials.map((material) => material.itemId)).size !==
      materials.length
    )
      fail("기존 시술 재료가 중복됩니다.", "INVALID_IMPORT");
    return {
      id: id(service.id),
      name: str(service.name, "기존 시술명", 100, true),
      price: int(service.price, "기존 시술 가격", 0, 1_000_000_000),
      duration: int(service.dur, "기존 시술 시간", 5, 1440),
      materials,
      active: true,
    };
  });
  data.customers = legacy.customers.map((customer) => ({
    id: id(customer.id),
    name: str(customer.name, "기존 고객 이름", 100, true),
    phone: phone(customer.phone),
    memo: str(customer.memo, "기존 고객 메모", 4000),
    warning: "",
    createdAt: `${date(customer.since)}T00:00:00+09:00`,
    archived: false,
  }));
  data.appointments = legacy.resv.map((appointment) => {
    const customerId = appointment.custId
      ? find(data.customers, appointment.custId, "기존 예약 고객").id
      : null;
    const staffId = find(data.staff, appointment.staffId, "기존 담당 직원").id;
    const serviceIds = list(appointment.svc, "기존 예약 시술", 50).map(
      (serviceId) => find(data.services, serviceId, "기존 예약 시술").id,
    );
    if (!serviceIds.length || new Set(serviceIds).size !== serviceIds.length)
      fail("기존 예약 시술을 확인해 주세요.", "INVALID_IMPORT");
    const start = int(appointment.start, "기존 예약 시간", 0, 1439),
      duration = int(appointment.dur, "기존 예약 소요 시간", 5, 1440);
    if (start + duration > 1440)
      fail("기존 예약 종료 시간을 확인해 주세요.", "INVALID_IMPORT");
    const changes = list(
      appointment.changes ?? [],
      "기존 예약 변경 이력",
      10000,
    ).map((change) => ({
      at: str(change.at, "기존 변경 일시", 100, true),
      text: str(change.text, "기존 변경 내용", 4000),
      action: "legacy",
    }));
    return {
      id: id(appointment.id),
      date: date(appointment.date),
      start,
      duration,
      customerId,
      guestName: str(
        appointment.guest,
        "기존 방문 고객 이름",
        100,
        !customerId,
      ),
      guestPhone: phone(appointment.phone),
      staffId,
      serviceIds,
      notes: str(appointment.memo, "기존 예약 메모", 4000),
      status:
        statusMap[
          oneOf(appointment.status, Object.keys(statusMap), "기존 예약 상태")
        ],
      transactionId: appointment.txnId ? id(appointment.txnId) : null,
      changes,
    };
  });
  data.transactions = legacy.txns.map((transaction) => {
    oneOf(transaction.status, ["완료", "취소"], "기존 결제 상태");
    const customerId = transaction.customerId
      ? find(data.customers, transaction.customerId, "기존 결제 고객").id
      : null;
    const staffId = find(
      data.staff,
      transaction.staffId,
      "기존 결제 담당자",
    ).id;
    const appointmentId = transaction.resvId
      ? find(data.appointments, transaction.resvId, "기존 결제 예약").id
      : null;
    const lines = list(transaction.items, "기존 결제 항목", 100).map(
      (line, index) => {
        oneOf(line.type, ["service", "product"], "기존 결제 항목 종류");
        find(
          line.type === "service" ? data.services : data.items,
          line.refId,
          "기존 결제 항목",
        );
        const unitPrice = int(line.price, "기존 항목 가격", 0, 1_000_000_000),
          discount = int(line.alloc, "기존 항목 할인", 0, unitPrice),
          total = int(line.net, "기존 항목 실결제 금액", 0, unitPrice);
        if (unitPrice - discount !== total)
          fail("기존 결제 항목 합계가 맞지 않습니다.", "INVALID_IMPORT");
        return {
          id: `${transaction.id}-line-${index + 1}`,
          type: line.type,
          refId: id(line.refId),
          name: str(line.name, "기존 결제 항목명", 100, true),
          unitPrice,
          quantity: 1,
          discount,
          total,
        };
      },
    );
    const subtotal = int(transaction.subtotal, "기존 결제 소계"),
      discount = int(transaction.discount, "기존 결제 할인", 0, subtotal),
      total = int(transaction.total, "기존 결제 합계");
    if (
      !lines.length ||
      lines.reduce((sum, line) => sum + line.unitPrice, 0) !== subtotal ||
      lines.reduce((sum, line) => sum + line.discount, 0) !== discount ||
      subtotal - discount !== total
    )
      fail("기존 결제 합계가 맞지 않습니다.", "INVALID_IMPORT");
    const transactionDate = date(transaction.date),
      transactionTime = time(transaction.time);
    const result = {
      id: id(transaction.id),
      appointmentId,
      customerId,
      customerName: str(
        transaction.customerName,
        "기존 결제 고객명",
        100,
        true,
      ),
      staffId,
      serviceDate: transactionDate,
      date: transactionDate,
      time: transactionTime,
      lines,
      discount,
      subtotal,
      total,
      method:
        methodMap[
          oneOf(transaction.method, Object.keys(methodMap), "기존 결제 수단")
        ],
      reference: "",
      notes: "기존 v2 기록에서 가져옴",
      status: transaction.status === "취소" ? "refunded" : "paid",
      actorId: null,
      createdAt: localTimestamp(`${transactionDate} ${transactionTime}`),
      changes: [],
    };
    if (transaction.status === "취소") {
      const cancelled = object(transaction.cancel, "기존 결제 취소 기록");
      const createdAt = localTimestamp(cancelled.dt);
      if (cancelled.dt.slice(0, 10) < transactionDate)
        fail("기존 환불 날짜가 결제보다 앞섭니다.", "INVALID_IMPORT");
      const restock = bool(cancelled.restock, "기존 반품 입고 여부");
      data.refunds.push({
        id: `legacy-refund-${transaction.id}`,
        transactionId: result.id,
        date: cancelled.dt.slice(0, 10),
        time: cancelled.dt.slice(11),
        lines: lines.map((line) => ({
          lineId: line.id,
          quantity: 1,
          amount: line.total,
          restock: line.type === "product" && restock,
        })),
        amount: total,
        method: result.method,
        reference: "",
        reason: str(cancelled.reason, "기존 환불 사유", 1000, true),
        actorId: null,
        createdAt,
      });
    }
    return result;
  });
  for (const appointment of data.appointments) {
    if (appointment.transactionId) {
      const transaction = find(
        data.transactions,
        appointment.transactionId,
        "기존 예약 결제",
      );
      if (
        transaction.appointmentId !== appointment.id ||
        appointment.status !== "completed"
      )
        fail("기존 예약과 결제의 연결이 맞지 않습니다.", "INVALID_IMPORT");
    } else if (appointment.status === "completed")
      fail("기존 완료 예약에 연결된 결제가 없습니다.", "INVALID_IMPORT");
  }
  for (const transaction of data.transactions.filter(
    (row) => row.status === "paid" && row.appointmentId,
  )) {
    if (
      find(data.appointments, transaction.appointmentId, "기존 결제 예약")
        .transactionId !== transaction.id
    )
      fail("기존 결제와 예약의 연결이 맞지 않습니다.", "INVALID_IMPORT");
  }
  const normalized = inventory.normalize(legacy);
  data.receipts = uniqueRows(normalized.receipts, "기존 입고").map(
    (receipt) => {
      const item = find(data.items, receipt.itemId, "기존 입고 품목");
      inventory.parseQuantity(receipt.qty, item);
      date(receipt.date);
      oneOf(receipt.status, ["active", "cancelled"], "기존 입고 상태");
      int(receipt.revision, "기존 입고 수정 차수");
      str(receipt.memo, "기존 입고 메모", 4000);
      str(receipt.token, "기존 입고 요청", 500, true);
      list(receipt.changes, "기존 입고 변경 이력", 10000);
      for (const change of receipt.changes) {
        object(change, "입고 변경 이력");
        str(change.at, "입고 변경 일시", 100, true);
        str(change.kind, "입고 변경 종류", 100, true);
        inventory.parseQuantity(change.beforeQty, item, { allowZero: true });
        inventory.parseQuantity(change.afterQty, item, { allowZero: true });
        if (
          !Number.isFinite(change.delta) ||
          Math.abs(change.delta) > 1_000_000_000
        )
          fail("기존 입고 수량 변경이 올바르지 않습니다.", "INVALID_IMPORT");
      }
      return clone(receipt);
    },
  );
  data.logs = normalized.logs.map((log) => {
    const item = find(data.items, log.itemId, "기존 재고 이력 품목");
    if (!Number.isFinite(log.delta) || Math.abs(log.delta) > 1_000_000_000)
      fail("기존 재고 증감 수량이 올바르지 않습니다.", "INVALID_IMPORT");
    inventory.parseQuantity(log.after, item, { allowZero: true });
    str(log.kind, "기존 재고 이력 종류", 100, true);
    str(log.dt, "기존 재고 일시", 100, true);
    return clone(log);
  });
  data.inventoryOperations = list(
    normalized.inventoryOperations,
    "기존 재고 요청",
    100000,
  ).map((operation) => {
    object(operation);
    str(operation.token, "기존 요청 식별자", 500, true);
    str(operation.signature, "기존 요청 내용", 10000, true);
    return clone(operation);
  });
  if (legacy.seq != null) {
    object(legacy.seq, "기존 일련번호");
    for (const [key, value] of Object.entries(legacy.seq)) {
      if (
        !/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        fail("기존 일련번호 키가 올바르지 않습니다.", "INVALID_IMPORT");
      data.seq[key] = int(value, "기존 일련번호", 0, 1_000_000_000);
    }
  }
  return data;
}

function applyOperation(state, type, payload, ctx) {
  object(payload);
  const data = clone(state);
  try {
    switch (type) {
      case "customer.save":
        customerSave(data, payload, ctx);
        break;
      case "customer.archive": {
        requireRole(ctx, ["owner", "manager", "reception"]);
        const customer = find(data.customers, payload.id, "고객");
        const archived = bool(payload.archived, "보관 여부");
        if (
          archived &&
          data.appointments.some(
            (row) => row.customerId === customer.id && OPEN.has(row.status),
          )
        )
          fail(
            "처리되지 않은 예약을 먼저 완료하거나 취소해 주세요.",
            "ACTIVE_APPOINTMENTS",
            409,
          );
        customer.archived = archived;
        break;
      }
      case "appointment.save":
        appointmentSave(data, payload, ctx);
        break;
      case "appointment.status":
        appointmentStatus(data, payload, ctx);
        break;
      case "staff.save":
        staffSave(data, payload, ctx);
        break;
      case "service.save":
        serviceSave(data, payload, ctx);
        break;
      case "store.save":
        storeSave(data, payload, ctx);
        break;
      case "legacy.import":
        return importLegacy(data, payload, ctx);
      default:
        fail("지원하지 않는 작업입니다.", "UNKNOWN_ACTION", 400);
    }
    return data;
  } catch (error) {
    if (!error.status) {
      error.status = 422;
      error.code = "VALIDATION";
    }
    throw error;
  }
}

module.exports = { initialState, applyOperation };
