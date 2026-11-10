export const LEAVE_TYPES = {
  annual: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  sick: "병가",
  special: "경조사",
  unpaid: "무급 휴가",
};
export const OVERTIME_TYPES = {
  overtime: "연장 근무",
  night: "야간 근무",
  holiday: "휴일 근무",
};
export const REQUEST_STATUS = {
  requested: { label: "승인 대기", tone: "warning" },
  approved: { label: "승인", tone: "success" },
  rejected: { label: "반려", tone: "danger" },
  cancelled: { label: "취소", tone: "muted" },
};
export const EXPENSE_CATEGORIES = [
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
export const EXPENSE_METHODS = {
  card: "카드",
  corporate_card: "법인카드",
  cash: "현금",
  transfer: "계좌이체",
  auto: "자동이체",
};
export const EVIDENCE = {
  tax_invoice: "세금계산서",
  card_slip: "카드 전표",
  cash_receipt: "현금영수증",
  receipt: "간이영수증",
  none: "증빙 없음",
};
export const ANNUAL_TYPES = ["annual", "half_am", "half_pm"];

export const typeLabel = (request) =>
  (request.kind === "overtime" ? OVERTIME_TYPES : LEAVE_TYPES)[request.type] ||
  "근태";
export const clockLabel = (value) =>
  value == null
    ? "—"
    : `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
export const hoursLabel = (minutes) => {
  const h = Math.floor(minutes / 60),
    m = Math.round(minutes % 60);
  return m ? `${h}시간 ${m}분` : `${h}시간`;
};
export const periodLabel = (request) => {
  const range =
    request.from === request.to
      ? request.from
      : `${request.from} ~ ${request.to}`;
  return request.start != null
    ? `${range} ${clockLabel(request.start)}–${clockLabel(request.end)}`
    : range;
};

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayOf = (value) => new Date(`${value}T12:00:00Z`).getUTCDay();
/** "11월 17일" or, with weekday, "11월 17일 월요일". */
export function koreanDay(value, withWeekday = false) {
  if (!value) return "";
  const label = `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`;
  return withWeekday ? `${label} ${WEEKDAY_NAMES[weekdayOf(value)]}요일` : label;
}
/** Plain Korean period: "11월 17일", "11월 17일부터 11월 19일까지", "11월 12일 20:00부터 22:00까지". */
export function requestPeriod(request, withWeekday = false) {
  if (request.kind === "overtime")
    return `${koreanDay(request.from, withWeekday)} ${clockLabel(request.start)}부터 ${clockLabel(request.end)}까지`;
  if (!request.to || request.from === request.to)
    return koreanDay(request.from, withWeekday);
  return `${koreanDay(request.from)}부터 ${koreanDay(request.to)}까지`;
}
const addDay = (value) => {
  const day = new Date(`${value}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
};
/** Working days a leave consumes (mirrors the server): staff working weekdays that are not store holidays. */
export function leaveDays(data, staff, request) {
  if (request.type === "half_am" || request.type === "half_pm") return 0.5;
  if (!request.from || !request.to || request.to < request.from) return 0;
  let count = 0;
  for (let day = request.from, guard = 0; day <= request.to && guard < 400; day = addDay(day), guard += 1) {
    const weekday = weekdayOf(day);
    if (
      (staff?.workingDays || []).includes(weekday) &&
      !(data.store?.closedWeekdays || []).includes(weekday)
    )
      count += 1;
  }
  return count;
}
/** The time window a half-day leave covers (mirrors the server). */
export function halfDayWindow(staff, type) {
  if (!staff) return { start: null, end: null };
  const middle =
    staff.breakStart != null
      ? staff.breakStart
      : Math.round((staff.startMinutes + staff.endMinutes) / 2 / 10) * 10;
  return type === "half_am"
    ? { start: staff.startMinutes, end: middle }
    : { start: staff.breakEnd != null ? staff.breakEnd : middle, end: staff.endMinutes };
}
const OPEN_APPOINTMENTS = ["booked", "checked_in", "in_service"];
/** Open appointments of the staff member that fall inside a leave request. */
export function leaveAppointments(data, request) {
  if (request.kind === "overtime") return [];
  return (data.appointments || []).filter(
    (appointment) =>
      appointment.staffId === request.staffId &&
      OPEN_APPOINTMENTS.includes(appointment.status) &&
      appointment.date >= request.from &&
      appointment.date <= (request.to || request.from) &&
      (request.start == null ||
        (appointment.start < request.end &&
          appointment.start + appointment.duration > request.start)),
  );
}

export function leaveBalance(data, staffId, year) {
  const staff = (data.staff || []).find((row) => row.id === staffId);
  const allowance = Number(staff?.annualLeave ?? 15);
  let used = 0,
    reserved = 0;
  for (const request of data.staffRequests || []) {
    if (
      request.staffId !== staffId ||
      request.kind !== "leave" ||
      !ANNUAL_TYPES.includes(request.type) ||
      request.from.slice(0, 4) !== String(year)
    )
      continue;
    if (request.status === "approved") used += request.days;
    if (request.status === "requested") reserved += request.days;
  }
  return { allowance, used, reserved, remaining: allowance - used - reserved };
}

/** Worked minutes for one attendance record, excluding the scheduled break. */
export function workedMinutes(record, staff) {
  if (record.clockIn == null || record.clockOut == null) return 0;
  let total = record.clockOut - record.clockIn;
  if (staff?.breakStart != null) {
    const overlap =
      Math.min(record.clockOut, staff.breakEnd) -
      Math.max(record.clockIn, staff.breakStart);
    if (overlap > 0) total -= overlap;
  }
  return Math.max(0, total);
}
export function monthSummary(data, staffId, month) {
  const staff = (data.staff || []).find((row) => row.id === staffId);
  const records = (data.attendance || []).filter(
    (row) => row.staffId === staffId && row.date.startsWith(month),
  );
  const complete = records.filter((row) => row.clockOut != null);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const minutes = complete.reduce(
    (total, row) => total + workedMinutes(row, staff),
    0,
  );
  const late = staff
    ? records.filter((row) => row.clockIn > staff.startMinutes).length
    : 0;
  const overtime = (data.staffRequests || [])
    .filter(
      (row) =>
        row.staffId === staffId &&
        row.kind === "overtime" &&
        row.status === "approved" &&
        row.from.startsWith(month),
    )
    .reduce((total, row) => total + row.minutes, 0);
  const leave = (data.staffRequests || [])
    .filter(
      (row) =>
        row.staffId === staffId &&
        row.kind === "leave" &&
        row.status === "approved" &&
        row.from.startsWith(month),
    )
    .reduce((total, row) => total + row.days, 0);
  return {
    days: complete.length,
    // Today's shift that is still in progress is not a missing clock-out.
    open: records.filter((row) => row.clockOut == null && row.date !== today)
      .length,
    minutes,
    late,
    overtime,
    leave,
  };
}
export function yearsBetween(from, to) {
  return (Date.parse(to) - Date.parse(from)) / (365 * 86400000);
}
/**
 * 퇴직금 추정: 1일 평균임금(최근 3개월 확정 급여 지급총액 ÷ 해당 기간 일수) × 30 × 재직일수/365.
 * 실제 지급액은 상여·연차수당 반영 여부에 따라 달라집니다.
 */
export function severanceEstimate(data, staff, untilDate) {
  if (!staff?.hireDate) return null;
  const end = staff.resignDate || untilDate;
  const serviceDays = Math.floor(
    (Date.parse(end) - Date.parse(staff.hireDate)) / 86400000,
  );
  const slips = (data.payroll || [])
    .filter(
      (row) =>
        row.staffId === staff.id && ["finalized", "paid"].includes(row.status),
    )
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 3);
  if (!slips.length) return { serviceDays, eligible: serviceDays >= 365 };
  const wages = slips.reduce((total, row) => total + (row.earningsTotal || 0), 0);
  const days = slips.reduce((total, row) => {
    const [y, m] = row.month.split("-").map(Number);
    return total + new Date(Date.UTC(y, m, 0)).getUTCDate();
  }, 0);
  const daily = wages / days;
  return {
    serviceDays,
    eligible: serviceDays >= 365,
    months: slips.length,
    daily: Math.round(daily),
    amount: Math.floor((daily * 30 * serviceDays) / 365 / 10) * 10,
  };
}
export function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === "," || char === "\t") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function normalizeDate(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}
export const normalizeAmount = (value) =>
  Number(String(value || "").replace(/[^\d-]/g, "")) || 0;
/** "2026-11" shifted by whole months. */
export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
/** A footer "취소" button closes its dialog the same way the header close button does (keeps the unsaved-changes check). */
export function closeDialogFrom(event) {
  event.currentTarget
    .closest('[role="dialog"]')
    ?.querySelector('.modal-header button[aria-label="닫기"]')
    ?.click();
}
