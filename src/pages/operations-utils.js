import { useEffect, useState } from "react";

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
    .join(", ");
// "11월 10일 화요일"
export const longDateLabel = (date) =>
  date
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date(`${date}T12:00:00+09:00`))
    : "날짜 없음";
// "11월 10일"
export const shortDateLabel = (date) =>
  date
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "long",
        day: "numeric",
      }).format(new Date(`${date}T12:00:00+09:00`))
    : "날짜 없음";
// "오늘", "내일", "어제" or "11월 12일"
export const relativeDayLabel = (date, today = todaySeoul()) =>
  date === today
    ? "오늘"
    : date === shiftDate(today, 1)
      ? "내일"
      : date === shiftDate(today, -1)
        ? "어제"
        : shortDateLabel(date);
// "2시간 30분", "45분"
export const durationLabel = (minutes) => {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest}분`;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
};
// "10:00부터 20:00까지"
export const rangeLabel = (start, end) =>
  `${timeLabel(start)}부터 ${timeLabel(end)}까지`;
export const LEAVE_LABELS = {
  annual: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  sick: "병가",
  special: "경조사 휴가",
  unpaid: "무급 휴가",
};
// Approved leave for one staff member on one date. start == null means all day.
export const staffLeaves = (data, staffId, date) =>
  (data.staffRequests || []).filter(
    (item) =>
      item.kind === "leave" &&
      item.status === "approved" &&
      item.staffId === staffId &&
      item.from <= date &&
      item.to >= date,
  );
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
  { date, staffId, duration, excludeId, notBefore = 0 },
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
  const leaves = staffLeaves(data, staffId, date);
  if (leaves.some((item) => item.start == null)) return [];
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
      start < notBefore ||
      occupied.some(
        (item) => start < item.start + item.duration && end > item.start,
      ) ||
      leaves.some((item) => start < item.end && end > item.start)
    )
      continue;
    result.push(start);
  }
  return result;
}


// Phone layout switch. Pages render a different layout below 640px, so this
// is a JS check rather than CSS: the two layouts must not both be in the DOM.
export const PHONE_QUERY = "(max-width: 640px)";
export function useMediaQuery(query = PHONE_QUERY) {
  const read = () =>
    typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return undefined;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

// "취소로", "미방문으로": picks 으로 after a final consonant other than ㄹ.
export const withRo = (word) => {
  const code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
  const batchim = code >= 0 && code <= 11171 ? code % 28 : 0;
  return `${word}${batchim && batchim !== 8 ? "으로" : "로"}`;
};
