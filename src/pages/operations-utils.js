export const STATUS = {
  booked: { label: "예약", tone: "muted" },
  checked_in: { label: "방문 확인", tone: "warning" },
  in_service: { label: "시술 중", tone: "warning" },
  completed: { label: "완료", tone: "success" },
  cancelled: { label: "취소", tone: "muted" },
  no_show: { label: "미방문", tone: "danger" },
};
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export const todaySeoul = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const shiftDate = (date, delta) => {
  const value = new Date(`${date}T12:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
};
export const dateLabel = (date) =>
  date
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "long",
        day: "numeric",
        weekday: "short",
      }).format(new Date(`${date}T12:00:00+09:00`))
    : "날짜 없음";
export const timeLabel = (value) =>
  `${String(Math.floor(Number(value) / 60)).padStart(2, "0")}:${String(Number(value) % 60).padStart(2, "0")}`;
export const timeMinutes = (value) => {
  const [h, m] = String(value).split(":").map(Number);
  return h * 60 + m;
};
export const moneyLabel = (value) =>
  `${new Intl.NumberFormat("ko-KR").format(Number(value) || 0)}원`;
export const customerName = (appointment, data) =>
  data.customers.find((item) => item.id === appointment.customerId)?.name ||
  appointment.guestName ||
  "이름 없는 고객";
export const customerPhone = (appointment, data) =>
  data.customers.find((item) => item.id === appointment.customerId)?.phone ||
  appointment.guestPhone ||
  "";
export const staffName = (id, data) =>
  data.staff.find((item) => item.id === id)?.name || "퇴사 / 미지정 직원";
export const serviceNames = (ids, data) =>
  ids
    .map(
      (id) =>
        data.services.find((item) => item.id === id)?.name || "삭제된 시술",
    )
    .join(" · ");
export const timestampLabel = (at) =>
  at
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(at))
    : "";

// Availability is a preview only. The server rechecks the schedule when saving.
export function availableAppointmentTimes(
  data,
  { date, staffId, duration, excludeId },
) {
  const staff = data.staff.find((item) => item.id === staffId);
  const length = Number(duration);
  const weekday = new Date(`${date}T12:00:00+09:00`).getUTCDay();
  if (
    !staff ||
    staff.status !== "active" ||
    staff.role === "reception" ||
    !Number.isInteger(length) ||
    length < 5 ||
    length > 1440 ||
    !Number.isFinite(weekday) ||
    data.store.closedWeekdays?.includes(weekday) ||
    !staff.workingDays.includes(weekday)
  )
    return [];
  const step = Number(data.store.slotMinutes) || 30;
  if (!Number.isInteger(step) || step < 1) return [];
  const opening = Math.max(data.store.open, staff.startMinutes);
  const closing = Math.min(data.store.close, staff.endMinutes);
  const occupied = data.appointments.filter(
    (item) =>
      item.id !== excludeId &&
      item.date === date &&
      item.staffId === staffId &&
      ["booked", "checked_in", "in_service"].includes(item.status),
  );
  const result = [];
  const first =
    data.store.open + Math.ceil((opening - data.store.open) / step) * step;
  for (let start = first; start + length <= closing; start += step) {
    const end = start + length;
    if (
      staff.breakStart != null &&
      start < staff.breakEnd &&
      end > staff.breakStart
    )
      continue;
    if (
      occupied.some(
        (item) => start < item.start + item.duration && end > item.start,
      )
    )
      continue;
    result.push(start);
  }
  return result;
}
