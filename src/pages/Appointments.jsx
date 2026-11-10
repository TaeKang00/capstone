import { DateInput } from "../components/DateInput.jsx";
import { TimeInput } from "../components/TimeInput.jsx";
import { useMediaQuery } from "../useMediaQuery";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Money,
} from "../components/ui.jsx";
import {
  LEAVE_LABELS,
  STATUS,
  WEEKDAYS,
  availableAppointmentTimes,
  customerName,
  customerPhone,
  dateLabel,
  durationLabel,
  longDateLabel,
  moneyLabel,
  rangeLabel,
  relativeDayLabel,
  serviceNames,
  shiftDate,
  shortDateLabel,
  staffLeaves,
  staffName,
  timeLabel,
  timeMinutes,
  timestampLabel,
  todaySeoul,
  withRo,
} from "./operations-utils.js";
import "./Operations.css";
import { Icon } from "../components/Icon.jsx";
import { CustomerEditor } from "./Customers.jsx";
import { useViewState } from "../components/ViewState.jsx";

const nowMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .split(":")
    .map(Number);
  return h * 60 + m;
};

const OPEN = ["booked", "checked_in", "in_service"];
const HOUR_HEIGHT = 64;
const canTakePayment = (user) => user.role !== "designer";
const weekdayOf = (date) => new Date(`${date}T12:00:00+09:00`).getUTCDay();
const fullDayLeave = (data, staffId, date) =>
  staffLeaves(data, staffId, date).find((item) => item.start == null);
const leaveName = (leave) => LEAVE_LABELS[leave?.type] || "휴가";
// Closes a dialog through its own close button so the unsaved-changes guard still runs.
const closeDialog = (event) =>
  event.currentTarget
    .closest(".modal")
    ?.querySelector('.modal-header button[aria-label="닫기"]')
    ?.click();
// Arrow keys move between radio cards; Tab enters and leaves the group.
function radioKeys(event) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
    event.key
  ];
  if (!step) return;
  const radios = [
    ...event.currentTarget.querySelectorAll('[role="radio"]:not(:disabled)'),
  ];
  const index = radios.indexOf(document.activeElement);
  if (index < 0 || !radios.length) return;
  event.preventDefault();
  const next = radios[(index + step + radios.length) % radios.length];
  next.focus();
  next.click();
}
const rovingIndex = (items, isChecked, isEnabled) => {
  const checked = items.findIndex(
    (item, index) => isChecked(item, index) && isEnabled(item, index),
  );
  return checked >= 0
    ? checked
    : items.findIndex((item, index) => isEnabled(item, index));
};

function bookableStaff(data, user, keepId) {
  return data.staff.filter(
    (item) =>
      ((item.status === "active" && item.role !== "reception") ||
        item.id === keepId) &&
      (user.role !== "designer" || item.id === user.staffId),
  );
}

function freshDraft(data, user, date, customerId) {
  const staff = bookableStaff(data, user);
  const weekday = weekdayOf(date);
  const preferred =
    staff.find(
      (item) =>
        item.workingDays.includes(weekday) &&
        !fullDayLeave(data, item.id, date),
    ) || staff[0];
  const minutes = nowMinutes();
  const step = data.store.slotMinutes || 30;
  const suggested = Math.ceil(minutes / step) * step;
  const start =
    date === todaySeoul() &&
    suggested >= data.store.open &&
    suggested < data.store.close
      ? suggested
      : data.store.open;
  return {
    date,
    start,
    duration: 30,
    customerId: customerId || "",
    guestName: "",
    guestPhone: "",
    staffId: preferred?.id || "",
    serviceIds: [],
    notes: "",
  };
}

function AppointmentEditor({
  appointment,
  date,
  customerId,
  preferredStaffId,
  preset,
  data,
  user,
  runAction,
  onClose,
  onSaved,
}) {
  const ids = useId();
  const initial = useRef(
    appointment
      ? {
          id: appointment.id,
          date: appointment.date,
          start: appointment.start,
          duration: appointment.duration,
          customerId: appointment.customerId || "",
          guestName: appointment.guestName || "",
          guestPhone: appointment.guestPhone || "",
          staffId: appointment.staffId,
          serviceIds: [...appointment.serviceIds],
          notes: appointment.notes || "",
        }
      : {
          ...freshDraft(data, user, date, customerId),
          ...(preferredStaffId ? { staffId: preferredStaffId } : {}),
          ...(preset || {}),
        },
  );
  const [draft, setDraft] = useState(initial.current);
  // Most bookings are returning customers, so new bookings start with customer search.
  const initialKind = useRef(
    initial.current.customerId ||
      (!appointment && data.customers.some((row) => !row.archived))
      ? "customer"
      : "guest",
  );
  const [kind, setKind] = useState(initialKind.current);
  const [search, setSearch] = useState("");
  // Typed times are for walk-ins and edits whose time is not one of the suggested slots.
  const [manual, setManual] = useState(() => {
    if (!appointment && !preset) return false;
    const start = Number(initial.current.start);
    return !availableAppointmentTimes(data, {
      date: initial.current.date,
      staffId: initial.current.staffId,
      duration: initial.current.duration,
      excludeId: initial.current.id,
      notBefore: initial.current.date === todaySeoul() ? nowMinutes() : 0,
    }).includes(start);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef(null);
  const [customerEditor, setCustomerEditor] = useState(null);
  const [customerCreated, setCustomerCreated] = useState(false);
  const bookingDirty =
    JSON.stringify(draft) !== JSON.stringify(initial.current) ||
    kind !== initialKind.current;
  useEffect(() => {
    if (!customerEditor) return;
    const protectBooking = (event) => {
      if (bookingDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protectBooking);
    return () => window.removeEventListener("beforeunload", protectBooking);
  }, [customerEditor, bookingDirty]);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);
  const change = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const today = todaySeoul();
  const availableStaff = bookableStaff(data, user, draft.staffId);
  const availableServices = data.services.filter(
    (item) => item.active || draft.serviceIds.includes(item.id),
  );
  const services = data.services.filter((item) =>
    draft.serviceIds.includes(item.id),
  );
  const customer = data.customers.find((item) => item.id === draft.customerId);
  const term = search.trim();
  const matchingCustomers = data.customers
    .filter(
      (item) =>
        !item.archived &&
        (item.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()) ||
          (/\d/.test(term) &&
            String(item.phone || "")
              .replace(/\D/g, "")
              .includes(term.replace(/\D/g, "")))),
    )
    .slice(0, 8);
  const recentCustomers = useMemo(() => {
    const byId = new Map(data.customers.map((item) => [item.id, item]));
    const seen = new Set();
    const result = [];
    const push = (item) => {
      if (!item || item.archived || seen.has(item.id) || result.length >= 5)
        return;
      seen.add(item.id);
      result.push(item);
    };
    [...data.appointments]
      .filter((item) => item.customerId && item.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start)
      .forEach((item) => push(byId.get(item.customerId)));
    [...data.customers]
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      )
      .forEach(push);
    return result;
  }, [data.customers, data.appointments, today]);
  const shownCustomers = term ? matchingCustomers : recentCustomers;
  const customerChips =
    customer && !shownCustomers.some((item) => item.id === customer.id)
      ? [customer, ...shownCustomers]
      : shownCustomers;
  const selectedStaff = data.staff.find((item) => item.id === draft.staffId);
  const weekday = weekdayOf(draft.date);
  const closed = data.store.closedWeekdays?.includes(weekday);
  const off = selectedStaff && !selectedStaff.workingDays.includes(weekday);
  const collisions = data.appointments.filter(
    (item) =>
      item.id !== draft.id &&
      item.date === draft.date &&
      item.staffId === draft.staffId &&
      OPEN.includes(item.status) &&
      Number(draft.start) < item.start + item.duration &&
      Number(draft.start) + Number(draft.duration) > item.start,
  );
  const availableTimes = availableAppointmentTimes(data, {
    date: draft.date,
    staffId: draft.staffId,
    duration: draft.duration,
    excludeId: draft.id,
    // Past slots are not suggested for today; times can still be typed for walk-ins.
    notBefore: draft.date === today ? nowMinutes() : 0,
  });
  const start = Number(draft.start);
  const timeChosen =
    Number.isFinite(start) && (manual || availableTimes.includes(start));
  const dayWord = relativeDayLabel(draft.date, today);
  const staffNotes = availableStaff
    .map((item) => {
      if (closed) return null;
      const leaves = staffLeaves(data, item.id, draft.date);
      const whole = leaves.find((leave) => leave.start == null);
      if (whole) return `${item.name} 님은 ${dayWord} ${leaveName(whole)}예요`;
      if (!item.workingDays.includes(weekday))
        return `${item.name} 님은 ${dayWord} 쉬는 날이에요`;
      return leaves
        .map(
          (leave) =>
            `${item.name} 님은 ${dayWord} ${rangeLabel(leave.start, leave.end)} ${leaveName(leave)}예요`,
        )
        .join("\n");
    })
    .filter(Boolean);
  const staffDisabled = (item) =>
    item.id !== draft.staffId &&
    (closed ||
      !item.workingDays.includes(weekday) ||
      Boolean(fullDayLeave(data, item.id, draft.date)));
  const totalPrice = services.reduce((sum, item) => sum + item.price, 0);
  const who =
    kind === "customer"
      ? customer
        ? `${customer.name} 님`
        : ""
      : draft.guestName.trim()
        ? `${draft.guestName.trim()} 님`
        : "";
  const summary = [
    who,
    dayWord,
    timeChosen ? timeLabel(start) : "시간을 골라 주세요",
  ]
    .filter(Boolean)
    .join(" ");
  function openCustomerEditor() {
    setCustomerEditor({
      name: kind === "guest" ? draft.guestName : /\d/.test(term) ? "" : term,
      phone:
        kind === "guest"
          ? draft.guestPhone
          : /^[\d\s+()-]+$/.test(term)
            ? term
            : "",
    });
  }
  function startGuest() {
    setDraft((current) => ({
      ...current,
      guestName: current.guestName || (/\d/.test(term) ? "" : term),
      guestPhone:
        current.guestPhone || (/^[\d\s+()-]+$/.test(term) ? term : ""),
    }));
    setKind("guest");
  }
  function useCustomer(id, created) {
    change("customerId", id);
    setKind("customer");
    setCustomerEditor(null);
    setCustomerCreated(created);
    setSearch("");
  }
  function toggleService(id) {
    setDraft((current) => {
      const ids = current.serviceIds.includes(id)
        ? current.serviceIds.filter((item) => item !== id)
        : [...current.serviceIds, id];
      return {
        ...current,
        serviceIds: ids,
        duration: Math.max(
          1,
          data.services
            .filter((item) => ids.includes(item.id))
            .reduce((sum, item) => sum + item.duration, 0) || 30,
        ),
      };
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (kind === "customer" && !draft.customerId) {
      setError("예약할 손님을 골라 주세요.");
      return;
    }
    if (kind === "guest" && !draft.guestName.trim()) {
      setError("손님 이름을 적어 주세요.");
      return;
    }
    if (!draft.serviceIds.length) {
      setError("시술을 하나 이상 골라 주세요.");
      return;
    }
    if (!draft.staffId) {
      setError("디자이너를 골라 주세요.");
      return;
    }
    if (!timeChosen) {
      setError("예약할 시간을 골라 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await runAction("appointment.save", {
        ...draft,
        customerId: kind === "customer" ? draft.customerId : null,
        guestName: kind === "guest" ? draft.guestName : "",
        guestPhone: kind === "guest" ? draft.guestPhone : "",
        start: Number(draft.start),
        duration: Number(draft.duration),
      });
      onSaved(draft.date, draft.staffId);
    } catch (cause) {
      setError(
        cause.message ||
          "예약을 저장하지 못했어요. 입력 내용을 확인해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (customerEditor)
    return (
      <div data-dirty={bookingDirty}>
        <CustomerEditor
          customers={data.customers}
          runAction={runAction}
          initialValues={customerEditor}
          forAppointment
          onClose={() => setCustomerEditor(null)}
          onSaved={(id) => useCustomer(id, true)}
          onUseExisting={(id) => useCustomer(id, false)}
        />
      </div>
    );
  const sameName = (item) =>
    customerChips.filter((other) => other.name === item.name).length > 1;
  const staffFocus = rovingIndex(
    availableStaff,
    (item) => item.id === draft.staffId,
    (item) => !staffDisabled(item),
  );
  const timeFocus = rovingIndex(
    availableTimes,
    (item) => item === start,
    () => true,
  );
  return (
    <Modal
      title={appointment ? "예약 수정" : "예약 등록"}
      size="wide"
      onClose={busy ? undefined : onClose}
      dirty={bookingDirty}
      footer={
        <>
          <span className="ops-footer-summary" aria-live="polite">
            {summary}
          </span>
          <Button variant="secondary" onClick={closeDialog} disabled={busy}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="appointment-editor"
            busy={busy}
          >
            예약 저장
          </Button>
        </>
      }
    >
      <form
        id="appointment-editor"
        className="ops-form ops-booking-form"
        onSubmit={submit}
        noValidate
      >
        {error && (
          <div className="ops-error" role="alert" ref={errorRef}>
            {error}
          </div>
        )}
        {customerCreated && (
          <div className="alert alert-success" role="status">
            손님을 등록했어요. 예약 내용을 확인하고 저장해 주세요.
          </div>
        )}

        <div className="ops-section">
          {kind === "customer" ? (
            <>
              <label htmlFor={`${ids}-customer`} className="ops-section-label">
                손님
              </label>
              <div className="input-icon">
                <Icon name="search" size={20} />
                <input
                  id={`${ids}-customer`}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="이름이나 전화번호 뒷자리"
                  autoComplete="off"
                />
              </div>
              <div
                className="chip-row"
                role="group"
                aria-label={term ? "고객 검색 결과" : "최근 손님"}
              >
                {customerChips.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="chip"
                    aria-pressed={draft.customerId === item.id}
                    onClick={() => change("customerId", item.id)}
                  >
                    {item.name}
                    {sameName(item) && item.phone && (
                      <span className="ops-chip-sub">
                        {" "}
                        {String(item.phone).replace(/\D/g, "").slice(-4)}
                      </span>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  className="text-btn ops-text-btn"
                  onClick={startGuest}
                >
                  처음 온 손님
                </button>
              </div>
              {term && !matchingCustomers.length && (
                <p className="help" role="status">
                  일치하는 손님이 없어요. 처음 온 손님이면 이름과 전화번호를
                  적어 주세요.
                </p>
              )}
              {customer && (
                <span className="help">
                  {customer.phone || "전화번호 없음"}
                </span>
              )}
              {customer?.warning && (
                <div className="ops-warning">
                  시술 전 확인: {customer.warning}
                </div>
              )}
            </>
          ) : (
            <>
              <span className="ops-section-label">손님</span>
              <div className="grid grid-2">
                <Field label="손님 이름">
                  <input
                    className="input"
                    value={draft.guestName}
                    maxLength={80}
                    required
                    autoComplete="off"
                    onChange={(event) =>
                      change("guestName", event.target.value)
                    }
                  />
                </Field>
                <Field label="전화번호">
                  <input
                    className="input"
                    type="tel"
                    value={draft.guestPhone}
                    maxLength={30}
                    autoComplete="off"
                    onChange={(event) =>
                      change("guestPhone", event.target.value)
                    }
                    placeholder="010-0000-0000"
                  />
                </Field>
              </div>
              <div className="ops-inline-actions">
                <button
                  type="button"
                  className="text-btn ops-text-btn"
                  onClick={openCustomerEditor}
                >
                  손님 정보로 등록
                </button>
                {data.customers.some((item) => !item.archived) && (
                  <button
                    type="button"
                    className="text-btn ops-text-btn"
                    onClick={() => setKind("customer")}
                  >
                    등록된 손님 찾기
                  </button>
                )}
              </div>
              <span className="help">
                등록하면 다음 방문 때 이름으로 바로 찾을 수 있어요
              </span>
            </>
          )}
        </div>

        <div className="ops-section">
          <span id={`${ids}-service`} className="ops-section-label">
            시술
          </span>
          {availableServices.length ? (
            <div
              className="chip-row"
              role="group"
              aria-labelledby={`${ids}-service`}
            >
              {availableServices.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="chip ops-chip-outline"
                  aria-pressed={draft.serviceIds.includes(item.id)}
                  title={`${durationLabel(item.duration)} ${moneyLabel(item.price)}`}
                  onClick={() => toggleService(item.id)}
                >
                  {item.name}
                  {!item.active ? " (사용 중지)" : ""}
                </button>
              ))}
            </div>
          ) : (
            <p className="help">
              등록된 시술이 없어요. 원장님께 시술 등록을 요청해 주세요.
            </p>
          )}
          {services.length > 0 && (
            <div className="ops-lines">
              <span className="help">
                소요 시간 {durationLabel(draft.duration)}
              </span>
              <span className="help">예상 금액 {moneyLabel(totalPrice)}</span>
            </div>
          )}
        </div>

        <div className="ops-section">
          <span id={`${ids}-staff`} className="ops-section-label">
            디자이너
          </span>
          {availableStaff.length ? (
            <div
              className="pick-grid ops-staff-grid"
              role="radiogroup"
              aria-labelledby={`${ids}-staff`}
              onKeyDown={radioKeys}
            >
              {availableStaff.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  className="pick-card"
                  aria-checked={draft.staffId === item.id}
                  disabled={staffDisabled(item)}
                  tabIndex={index === staffFocus ? 0 : -1}
                  onClick={() => change("staffId", item.id)}
                >
                  <span className="ops-avatar" aria-hidden="true">
                    {item.name.slice(0, 1)}
                  </span>
                  <span className="ops-pick-name">
                    {item.name}
                    {item.status !== "active" ? " (비활성)" : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="help">예약을 받을 수 있는 직원이 없어요.</p>
          )}
          {staffNotes.map((note) =>
            note.split("\n").map((line) => (
              <span className="help" key={line}>
                {line}
              </span>
            )),
          )}
        </div>

        <div className="ops-section">
          <div className="ops-section-head">
            <span id={`${ids}-time`} className="ops-section-label">
              시간
            </span>
            <div className="ops-date-nav">
              <button
                type="button"
                className="icon-btn"
                aria-label="이전 날"
                onClick={() => change("date", shiftDate(draft.date, -1))}
              >
                <Icon name="chevron-left" size={20} />
              </button>
              <DateInput
                className="input ops-date-input"
                type="date"
                aria-label="예약 날짜"
                required
                value={draft.date}
                onChange={(event) => {
                  if (event.target.value) change("date", event.target.value);
                }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label="다음 날"
                onClick={() => change("date", shiftDate(draft.date, 1))}
              >
                <Icon name="chevron-right" size={20} />
              </button>
            </div>
          </div>
          {closed && (
            <div className="alert alert-warning">
              {dateLabel(draft.date)}은 매장 정기 휴무일이에요. 다른 날을 골라
              주세요.
            </div>
          )}
          {!closed && off && (
            <div className="alert alert-warning">
              {selectedStaff.name} 님은 이날 근무하지 않아요. 다른 날이나
              디자이너를 골라 주세요.
            </div>
          )}
          {availableTimes.length ? (
            <div
              className="ops-time-grid"
              role="radiogroup"
              aria-labelledby={`${ids}-time`}
              onKeyDown={radioKeys}
            >
              {availableTimes.map((value, index) => (
                <button
                  type="button"
                  role="radio"
                  className="time-chip"
                  aria-checked={start === value}
                  tabIndex={index === timeFocus ? 0 : -1}
                  key={value}
                  onClick={() => change("start", value)}
                >
                  {timeLabel(value)}
                </button>
              ))}
            </div>
          ) : (
            <p className="help ops-empty-times" role="status">
              이날은 비어 있는 시간이 없어요. 날짜나 디자이너를 바꿔 주세요.
            </p>
          )}
          <span className="help">지나간 시간과 휴가 시간은 빼고 보여요</span>
          <div className="ops-inline-actions">
            <button
              type="button"
              className="text-btn ops-text-btn"
              aria-expanded={manual}
              onClick={() => setManual((value) => !value)}
            >
              <Icon name={manual ? "chevron-up" : "chevron-down"} size={16} />
              시간 직접 입력
            </button>
          </div>
          {manual && (
            <div className="grid grid-2">
              <Field
                label="시작 시간"
                help={`매장 영업 ${rangeLabel(data.store.open, data.store.close)}`}
              >
                <TimeInput
                  className="input"
                  interval={Number(data.store.slotMinutes) || 30}
                  required
                  step="60"
                  value={Number.isFinite(start) ? timeLabel(start) : ""}
                  onChange={(event) =>
                    change(
                      "start",
                      event.target.value
                        ? timeMinutes(event.target.value)
                        : NaN,
                    )
                  }
                />
              </Field>
              <Field
                label="소요 시간 (분)"
                help={
                  Number.isFinite(start + Number(draft.duration))
                    ? `${timeLabel(start + Number(draft.duration))}에 끝나요`
                    : "시술을 고르면 기본 시간이 들어가요"
                }
              >
                <input
                  className="input"
                  type="number"
                  min="5"
                  max="1440"
                  required
                  value={draft.duration}
                  onChange={(event) => change("duration", event.target.value)}
                />
              </Field>
            </div>
          )}
          {manual && collisions.length > 0 && (
            <div className="alert alert-warning">
              <strong>같은 디자이너의 예약과 겹쳐요</strong>
              {collisions.map((item) => (
                <div key={item.id}>
                  {rangeLabel(item.start, item.start + item.duration)}{" "}
                  {customerName(item, data)}
                </div>
              ))}
              <div>시작 시간이나 디자이너를 바꿔 주세요.</div>
            </div>
          )}
        </div>

        <div className="ops-section">
          <label htmlFor={`${ids}-memo`} className="ops-section-label">
            메모
          </label>
          <textarea
            id={`${ids}-memo`}
            className="textarea"
            rows={3}
            maxLength={3000}
            value={draft.notes}
            onChange={(event) => change("notes", event.target.value)}
            placeholder="손님 요청이나 상담 내용"
          />
        </div>
      </form>
    </Modal>
  );
}

function StatusPill({ status }) {
  return (
    <span className="ops-pill" data-status={status}>
      {STATUS[status]?.label || status}
    </span>
  );
}

function StatusDialog({ target, data, runAction, onClose, onSaved }) {
  const ids = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { status } = target;
  const appointment =
    data.appointments.find((item) => item.id === target.appointment.id) ||
    target.appointment;
  const backward =
    OPEN.indexOf(status) <= OPEN.indexOf(appointment.status) ||
    ["cancelled", "no_show"].includes(appointment.status);
  const requiresReason = backward || ["cancelled", "no_show"].includes(status);
  const stopping = ["cancelled", "no_show"].includes(status);
  const fromLabel = STATUS[appointment.status]?.label || appointment.status;
  const toLabel = STATUS[status]?.label || status;
  const range = rangeLabel(
    appointment.start,
    appointment.start + appointment.duration,
  );
  const designer = staffName(appointment.staffId, data);
  const notes = [];
  if (status === "no_show")
    notes.push(
      "방문 예정 시간이 지난 뒤 실제로 오지 않았는지 확인하고 처리해 주세요.",
    );
  if (stopping) {
    notes.push(
      `${status === "cancelled" ? "취소하면" : "미방문으로 바꾸면"} ${designer} 디자이너의 ${range}가 비어요.`,
    );
    notes.push("수납 전이라면 예약 상세에서 ‘예약 복구’로 되돌릴 수 있어요.");
  }
  if (["booked", "checked_in"].includes(status) && backward)
    notes.push(
      "상태를 되돌리면 디자이너의 예약 시간이 다시 잡혀요. 다른 예약과 겹치면 저장할 수 없어요.",
    );
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction("appointment.status", {
        id: appointment.id,
        status,
        reason,
      });
      onSaved();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`예약을 ‘${toLabel}’ 상태로 변경`}
      size="wide"
      onClose={busy ? undefined : onClose}
      dirty={Boolean(reason)}
      footer={
        <>
          <Button variant="secondary" onClick={closeDialog} disabled={busy}>
            돌아가기
          </Button>
          <Button
            type="submit"
            form="appointment-status"
            variant={stopping ? "danger" : "primary"}
            busy={busy}
          >
            {withRo(toLabel)} 변경
          </Button>
        </>
      }
    >
      <form
        id="appointment-status"
        className="ops-form ops-status-form"
        onSubmit={submit}
      >
        {error && (
          <div className="ops-error" role="alert">
            {error}
          </div>
        )}
        <div className="ops-status-summary">
          <span className="ops-status-text">
            <strong>{customerName(appointment, data)} 님</strong>
            <span className="num">
              {longDateLabel(appointment.date)} {timeLabel(appointment.start)}
            </span>
            <span>{designer}</span>
            <span>{serviceNames(appointment.serviceIds, data)}</span>
          </span>
          <span
            className="ops-status-change"
            aria-label={`${fromLabel}에서 ${withRo(toLabel)}`}
          >
            <StatusPill status={appointment.status} />
            <Icon name="arrow-right" size={16} />
            <StatusPill status={status} />
          </span>
        </div>
        <div className="ops-reason">
          <span className="ops-reason-head">
            <label htmlFor={`${ids}-reason`} className="field-label">
              {requiresReason ? "변경 사유" : "변경 메모"}
            </label>
            <span
              className={`ops-tag ${requiresReason ? "is-required" : ""}`}
              aria-hidden="true"
            >
              {requiresReason ? "필수" : "선택"}
            </span>
          </span>
          <textarea
            id={`${ids}-reason`}
            autoFocus
            className="textarea"
            required={requiresReason}
            aria-describedby={`${ids}-reason-help`}
            rows={4}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              status === "cancelled"
                ? "예: 손님 요청으로 일정 변경"
                : status === "no_show"
                  ? "예: 예약 시간이 지나 연락했지만 받지 않음"
                  : "상태를 바꾸는 이유를 남겨 주세요"
            }
          />
          <span id={`${ids}-reason-help`} className="ops-lines">
            <span className="help">
              취소나 미방문으로 바꾸거나 상태를 되돌릴 때는 사유가 꼭 필요해요
            </span>
            <span className="help">변경 시각과 처리한 직원이 기록돼요</span>
          </span>
        </div>
        {notes.length > 0 && (
          <div className="ops-info">
            <Icon name="info" size={20} />
            <span className="ops-lines">
              {notes.map((line, index) => (
                <span key={line} className={index ? "muted" : undefined}>
                  {line}
                </span>
              ))}
            </span>
          </div>
        )}
      </form>
    </Modal>
  );
}

function historyText(entry) {
  if (entry.text) return entry.text;
  if (entry.action === "status")
    return `${STATUS[entry.before]?.label || entry.before}에서 ${STATUS[entry.after]?.label || entry.after}(으)로`;
  return (
    entry.summary || (entry.action === "created" ? "예약 등록" : "예약 정보 수정")
  );
}

const STEPS = [
  ["booked", "예약"],
  ["checked_in", "방문 확인"],
  ["in_service", "시술 시작"],
  ["completed", "수납과 완료"],
];

function AppointmentDetail({
  appointment,
  data,
  user,
  onClose,
  onEdit,
  onStatus,
  navigate,
}) {
  const customer = data.customers.find(
    (item) => item.id === appointment.customerId,
  );
  const latest = [...(appointment.changes || [])].reverse();
  const today = todaySeoul();
  const open = OPEN.includes(appointment.status);
  const started = appointment.date <= today;
  const advance =
    appointment.status === "booked" && started
      ? ["checked_in", "방문 확인"]
      : appointment.status === "checked_in" && started
        ? ["in_service", "시술 시작"]
        : null;
  const pay = open && canTakePayment(user);
  const receipt = appointment.transactionId && canTakePayment(user);
  const restore =
    ["cancelled", "no_show"].includes(appointment.status) &&
    !appointment.transactionId;
  const stepIndex = STEPS.findIndex(([key]) => key === appointment.status);
  const name = customerName(appointment, data);
  const services = appointment.serviceIds.map(
    (id) => data.services.find((item) => item.id === id)?.name || "삭제된 시술",
  );
  const designer = staffName(appointment.staffId, data);
  const sideActions = [
    appointment.status === "checked_in" && started && (
      <Button key="undo-in" variant="ghost" onClick={() => onStatus("booked")}>
        방문 확인 되돌리기
      </Button>
    ),
    appointment.status === "in_service" && (
      <Button
        key="undo-service"
        variant="ghost"
        onClick={() => onStatus("checked_in")}
      >
        시술 시작 되돌리기
      </Button>
    ),
    open && started && appointment.status !== "in_service" && (
      <Button key="no-show" variant="ghost" onClick={() => onStatus("no_show")}>
        미방문 처리
      </Button>
    ),
    open && (
      <Button
        key="cancel"
        variant="danger"
        onClick={() => onStatus("cancelled")}
      >
        예약 취소
      </Button>
    ),
  ].filter(Boolean);
  const mainActions = [
    open && (
      <Button key="edit" variant="secondary" onClick={onEdit}>
        예약 수정
      </Button>
    ),
    receipt && (
      <Button
        key="receipt"
        variant="secondary"
        onClick={() =>
          navigate("payments", { transactionId: appointment.transactionId })
        }
      >
        수납 내역 보기
      </Button>
    ),
    restore && (
      <Button key="restore" variant="secondary" onClick={() => onStatus("booked")}>
        예약 복구
      </Button>
    ),
    advance && (
      <Button
        key="advance"
        variant={pay ? "secondary" : "primary"}
        onClick={() => onStatus(advance[0])}
      >
        {advance[1]}
      </Button>
    ),
    pay && (
      <Button
        key="pay"
        variant="primary"
        onClick={() => navigate("payments", { appointmentId: appointment.id })}
      >
        수납하기
      </Button>
    ),
  ].filter(Boolean);
  return (
    <Modal
      title="예약 상세"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span className="ops-footer-side">{sideActions}</span>
          {mainActions.length ? (
            mainActions
          ) : (
            <Button variant="secondary" onClick={onClose}>
              닫기
            </Button>
          )}
        </>
      }
    >
      <div className="ops-form ops-detail">
        <div className="ops-detail-hero">
          <span className="ops-detail-when">
            <span className="ops-detail-day">
              <StatusPill status={appointment.status} />
              <span className="ops-meta">{longDateLabel(appointment.date)}</span>
            </span>
            <strong className="ops-detail-range">
              {rangeLabel(
                appointment.start,
                appointment.start + appointment.duration,
              )}
            </strong>
            <span className="muted">{durationLabel(appointment.duration)}</span>
          </span>
          {stepIndex >= 0 && (
            <ol className="ops-steps" aria-label="진행 단계">
              {STEPS.map(([key, label], index) => (
                <li
                  key={key}
                  className={index === stepIndex ? "is-now" : undefined}
                  aria-current={index === stepIndex ? "step" : undefined}
                >
                  <span className="ops-step-dot" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="ops-detail-person">
          <span className="ops-avatar ops-avatar-md" aria-hidden="true">
            {name.slice(0, 1)}
          </span>
          <span className="ops-person-text">
            <span className="ops-detail-name">{name} 님</span>
            <span className="muted num">
              {customerPhone(appointment, data) || "전화번호 없음"}
            </span>
          </span>
          {customer && (
            <button
              type="button"
              className="ops-pill-btn"
              onClick={() => navigate("customers", { customerId: customer.id })}
            >
              손님 정보 보기
              <Icon name="chevron-right" size={16} />
            </button>
          )}
        </div>
        {customer?.warning && (
          <div className="ops-warning ops-warning-note" role="note">
            <Icon name="alert" size={20} />
            <span className="ops-lines">
              <strong>시술 전 확인</strong>
              <span>{customer.warning}</span>
            </span>
          </div>
        )}
        <dl className="ops-facts">
          <div>
            <dt>시술</dt>
            <dd className="ops-lines">
              {services.length ? (
                services.map((item, index) => <span key={index}>{item}</span>)
              ) : (
                <span>선택한 시술 없음</span>
              )}
            </dd>
          </div>
          <div>
            <dt>디자이너</dt>
            <dd className="ops-facts-staff">
              <span className="ops-avatar ops-avatar-sm" aria-hidden="true">
                {designer.slice(0, 1)}
              </span>
              {designer}
            </dd>
          </div>
          {appointment.notes && (
            <div className="ops-facts-wide">
              <dt>메모</dt>
              <dd className="ops-chart-notes">{appointment.notes}</dd>
            </div>
          )}
        </dl>
        <section className="ops-section" aria-labelledby="appointment-history">
          <h3 id="appointment-history" className="ops-panel-title">
            변경 기록
          </h3>
          {latest.length ? (
            <ul className="ops-history">
              {latest.map((entry, index) => (
                <li key={entry.id || index}>
                  <span className="ops-history-text">
                    <strong>
                      {entry.actorName || entry.actor?.name || "직원"}
                    </strong>
                    <span>{historyText(entry)}</span>
                    {entry.reason &&
                      (entry.action === "status" || !entry.text) && (
                        <span className="help">{entry.reason}</span>
                      )}
                  </span>
                  <time className="help num">
                    {timestampLabel(entry.at || entry.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="help">
              이전 시스템에서 가져온 예약은 변경 기록이 없을 수 있어요.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}

const BLOCK_TONE = {
  booked: "booked",
  checked_in: "arrived",
  in_service: "service",
  completed: "done",
};

// One staff member's day: working window, leave, appointments and a free-slot check.
function staffDay(data, person, date, dayAppointments, step) {
  const closed = data.store.closedWeekdays?.includes(weekdayOf(date));
  const leaves = staffLeaves(data, person.id, date);
  const wholeLeave = leaves.find((item) => item.start == null);
  const offDay = closed || !person.workingDays.includes(weekdayOf(date));
  const open = Math.max(data.store.open, person.startMinutes);
  const close = Math.min(data.store.close, person.endMinutes);
  const appointments = dayAppointments
    .filter((row) => row.staffId === person.id)
    .sort((a, b) => a.start - b.start);
  const free = (minute) =>
    !offDay &&
    !wholeLeave &&
    person.status === "active" &&
    person.role !== "reception" &&
    minute >= open &&
    minute + step <= close &&
    !(
      person.breakStart != null &&
      minute < person.breakEnd &&
      minute + step > person.breakStart
    ) &&
    !leaves.some((item) => minute < item.end && minute + step > item.start) &&
    !appointments.some(
      (row) =>
        OPEN.includes(row.status) &&
        minute < row.start + row.duration &&
        minute + step > row.start,
    );
  return { person, leaves, wholeLeave, offDay, open, close, appointments, free };
}

const scheduleColumns = (staff, dayAppointments) =>
  staff.filter(
    (item) =>
      (item.status === "active" && item.role !== "reception") ||
      dayAppointments.some((row) => row.staffId === item.id),
  );

function Timetable({ data, date, staff, canCreate, onOpen, onCreate }) {
  const [hover, setHover] = useState(null);
  const today = todaySeoul();
  const weekday = weekdayOf(date);
  const closed = data.store.closedWeekdays?.includes(weekday);
  const step = Number(data.store.slotMinutes) || 30;
  const dayAppointments = data.appointments.filter(
    (item) => item.date === date && !["cancelled", "no_show"].includes(item.status),
  );
  const columns = scheduleColumns(staff, dayAppointments);
  const starts = [data.store.open, ...dayAppointments.map((row) => row.start)];
  const ends = [
    data.store.close,
    ...dayAppointments.map((row) => row.start + row.duration),
  ];
  const top = Math.floor(Math.min(...starts) / 60) * 60;
  const bottom = Math.max(top + 60, Math.ceil(Math.max(...ends) / 60) * 60);
  const hours = [];
  for (let value = top; value < bottom; value += 60) hours.push(value);
  const px = (minutes) => ((minutes - top) / 60) * HOUR_HEIGHT;
  const height = px(bottom);
  if (!columns.length)
    return (
      <section className="panel" aria-label="직원별 시간표">
        <EmptyState
          title="시간표에 보여 줄 직원이 없어요"
          description="예약을 받을 직원을 등록하면 시간표가 만들어져요."
        />
      </section>
    );
  const columnInfo = columns.map((person) =>
    staffDay(data, person, date, dayAppointments, step),
  );
  const minuteAt = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = ((event.clientY - rect.top) / HOUR_HEIGHT) * 60;
    return top + Math.floor(minutes / step) * step;
  };
  return (
    <section className="panel ops-tt" aria-label="직원별 시간표">
      <div
        className="ops-tt-grid"
        style={{
          gridTemplateColumns: `56px repeat(${columns.length}, minmax(160px, 1fr))`,
          minWidth: 56 + columns.length * 168,
        }}
      >
        <span aria-hidden="true" />
        {columnInfo.map(({ person, wholeLeave, offDay }) => (
          <div className="ops-tt-head" key={person.id}>
            <span className="ops-avatar" aria-hidden="true">
              {person.name.slice(0, 1)}
            </span>
            <span className="ops-tt-head-text">
              <strong>{person.name}</strong>
              <span className="help">
                {closed
                  ? "매장 휴무"
                  : wholeLeave
                    ? leaveName(wholeLeave)
                    : offDay
                      ? "쉬는 날"
                      : rangeLabel(person.startMinutes, person.endMinutes)}
              </span>
            </span>
          </div>
        ))}
        <div className="ops-tt-hours" aria-hidden="true">
          {hours.map((value) => (
            <span key={value} style={{ height: HOUR_HEIGHT }}>
              {timeLabel(value)}
            </span>
          ))}
        </div>
        {columnInfo.map((info) => {
          const { person, leaves, wholeLeave, offDay, open, close, appointments, free } =
            info;
          const ghost = hover?.staffId === person.id ? hover.minute : null;
          return (
            <div
              key={person.id}
              className={`ops-tt-col ${canCreate ? "can-create" : ""}`}
              style={{ height }}
              onMouseMove={(event) => {
                if (!canCreate) return;
                const minute = minuteAt(event);
                const next = free(minute) ? minute : null;
                if (ghost !== next)
                  setHover(next == null ? null : { staffId: person.id, minute: next });
              }}
              onMouseLeave={() => setHover(null)}
              onClick={(event) => {
                if (!canCreate || event.target !== event.currentTarget) return;
                const minute = minuteAt(event);
                if (free(minute)) onCreate(person.id, minute);
              }}
            >
              {(offDay || wholeLeave) && (
                <div
                  className="ops-tt-block tone-leave ops-tt-static"
                  style={{ top: 4, height: height - 8 }}
                >
                  <span className="ops-tt-meta">
                    {closed ? "매장 휴무" : wholeLeave ? leaveName(wholeLeave) : "쉬는 날"}
                  </span>
                </div>
              )}
              {!offDay && !wholeLeave && (
                <>
                  {open > top && (
                    <div
                      className="ops-tt-off"
                      style={{ top: 0, height: px(open) }}
                    />
                  )}
                  {close < bottom && (
                    <div
                      className="ops-tt-off"
                      style={{ top: px(close), height: height - px(close) }}
                    />
                  )}
                  {person.breakStart != null && person.breakEnd != null && (
                    <div
                      className="ops-tt-block tone-leave ops-tt-static"
                      style={{
                        top: px(person.breakStart) + 2,
                        height: Math.max(
                          24,
                          px(person.breakEnd) - px(person.breakStart) - 4,
                        ),
                      }}
                    >
                      <span className="ops-tt-meta">휴게</span>
                    </div>
                  )}
                  {leaves.map((leave) => (
                    <div
                      key={leave.id}
                      className="ops-tt-block tone-leave ops-tt-static"
                      style={{
                        top: px(leave.start) + 2,
                        height: Math.max(24, px(leave.end) - px(leave.start) - 4),
                      }}
                    >
                      <span className="ops-tt-meta">{leaveName(leave)}</span>
                    </div>
                  ))}
                </>
              )}
              {ghost != null && (
                <div
                  className="ops-tt-ghost"
                  style={{
                    top: px(ghost) + 2,
                    height: (step / 60) * HOUR_HEIGHT - 4,
                  }}
                  aria-hidden="true"
                >
                  <Icon name="plus" size={16} />
                  {timeLabel(ghost)}
                </div>
              )}
              {appointments.map((row) => {
                const customer = data.customers.find(
                  (item) => item.id === row.customerId,
                );
                const blockHeight = Math.max(
                  24,
                  (row.duration / 60) * HOUR_HEIGHT - 4,
                );
                const size =
                  blockHeight < 44 ? "is-tiny" : blockHeight < 76 ? "is-short" : "";
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`ops-tt-block tone-${BLOCK_TONE[row.status] || "booked"} ${size}`}
                    style={{ top: px(row.start) + 2, height: blockHeight }}
                    onClick={() => onOpen(row.id)}
                  >
                    <span className="ops-tt-meta">
                      {timeLabel(row.start)} {STATUS[row.status]?.label}
                    </span>
                    <span className="ops-tt-name">
                      {customer?.warning && (
                        <span className="ops-warn-dot" title="시술 전 확인" />
                      )}
                      {customerName(row, data)} 님
                    </span>
                    <span className="ops-tt-service">
                      {serviceNames(row.serviceIds, data)}
                    </span>
                  </button>
                );
              })}
              {date === today && (() => {
                const now = nowMinutes();
                return now >= top && now <= bottom ? (
                  <div className="ops-tt-now" style={{ top: px(now) }} aria-hidden="true" />
                ) : null;
              })()}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const PHONE_TONE = {
  booked: "booked",
  checked_in: "arrived",
  in_service: "service",
  completed: "done",
};

// Phone layout of the day view: date nav, designer chips and a vertical list
// (leave, bookings and open gaps in time order) instead of the staff grid.
function PhoneSchedule({
  data,
  date,
  today,
  staff,
  staffFilter,
  canCreate,
  overdueCount,
  hiddenCount,
  onDate,
  onStaff,
  onPending,
  onOpen,
  onCreate,
  onNew,
  onShowList,
  notice,
}) {
  const step = Number(data.store.slotMinutes) || 30;
  const closed = data.store.closedWeekdays?.includes(weekdayOf(date));
  const dayAppointments = data.appointments.filter(
    (item) =>
      item.date === date && !["cancelled", "no_show"].includes(item.status),
  );
  const columns = scheduleColumns(staff, dayAppointments);
  const active = columns.some((item) => item.id === staffFilter)
    ? staffFilter
    : "all";
  const shown =
    active === "all" ? columns : columns.filter((item) => item.id === active);
  const infos = shown.map((person) =>
    staffDay(data, person, date, dayAppointments, step),
  );
  const count = (id) =>
    dayAppointments.filter(
      (row) =>
        columns.some((item) => item.id === row.staffId) &&
        (id === "all" || row.staffId === id),
    ).length;
  const rows = [];
  for (const info of infos) {
    const name = info.person.name;
    if (!closed && info.wholeLeave)
      rows.push({
        kind: "leave",
        key: `l-${info.person.id}`,
        start: info.open,
        title: leaveName(info.wholeLeave),
        staff: name,
        range: "하루 종일",
      });
    else if (!closed && info.offDay)
      rows.push({
        kind: "leave",
        key: `o-${info.person.id}`,
        start: info.open,
        title: "쉬는 날",
        pill: "휴무",
        staff: name,
        range: "하루 종일",
      });
    else if (!closed)
      for (const leave of info.leaves)
        rows.push({
          kind: "leave",
          key: `l-${leave.id}`,
          start: leave.start,
          title: leaveName(leave),
          staff: name,
          range: rangeLabel(leave.start, leave.end),
        });
    for (const row of info.appointments)
      rows.push({ kind: "booking", key: row.id, start: row.start, row });
  }
  if (canCreate && !closed && date >= today) {
    const notBefore = date === today ? nowMinutes() : 0;
    const booked = infos.flatMap((info) => info.appointments);
    const openAt = (minute) =>
      minute >= notBefore &&
      !booked.some(
        (row) => minute < row.start + row.duration && minute + step > row.start,
      ) &&
      infos.find((info) => info.free(minute));
    let gap = null;
    for (
      let minute = data.store.open;
      minute + step <= data.store.close;
      minute += step
    ) {
      const who = openAt(minute);
      if (who && gap) gap.end = minute + step;
      else if (who)
        gap = {
          kind: "gap",
          key: `g-${minute}`,
          start: minute,
          end: minute + step,
          staffId: who.person.id,
        };
      else if (gap) {
        rows.push(gap);
        gap = null;
      }
    }
    if (gap) rows.push(gap);
  }
  const order = { leave: 0, booking: 1, gap: 2 };
  rows.sort((a, b) => a.start - b.start || order[a.kind] - order[b.kind]);
  const now = date === today ? nowMinutes() : null;
  const prefix =
    date === today
      ? "오늘 "
      : date === shiftDate(today, 1)
        ? "내일 "
        : date === shiftDate(today, -1)
          ? "어제 "
          : "";
  const total = count("all");
  return (
    <>
      <header className="ops-m-head">
        <span className="ops-m-title">
          <span className="ops-m-dot" aria-hidden="true" />
          <h1>예약</h1>
        </span>
        {overdueCount > 0 && (
          <button type="button" className="ops-m-overdue" onClick={onPending}>
            지난 미처리 {overdueCount}건
            <Icon name="chevron-right" size={16} />
          </button>
        )}
      </header>
      <div className="ops-m-controls">
        <div className="ops-m-datenav">
          <button
            type="button"
            className="ops-m-square"
            aria-label="이전 날"
            onClick={() => onDate(shiftDate(date, -1))}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <span className="ops-m-date">
            <DateInput
              className="input"
              aria-label="조회 날짜"
              type="date"
              required
              value={date}
              onChange={(event) => {
                if (event.target.value) onDate(event.target.value);
              }}
            />
            <span className="ops-m-date-label" aria-hidden="true">
              <Icon name="calendar" size={16} />
              {prefix}
              {longDateLabel(date)}
              <Icon name="chevron-down" size={16} />
            </span>
          </span>
          <button
            type="button"
            className="ops-m-square"
            aria-label="다음 날"
            onClick={() => onDate(shiftDate(date, 1))}
          >
            <Icon name="chevron-right" size={20} />
          </button>
        </div>
        {columns.length > 1 && (
          <div className="ops-m-chips" role="group" aria-label="디자이너">
            {[{ id: "all", name: "전체" }, ...columns].map((item) => (
              <button
                key={item.id}
                type="button"
                className="chip ops-chip-outline"
                aria-pressed={active === item.id}
                onClick={() => onStaff(item.id)}
              >
                {item.name}
                <span className="ops-m-chip-count">{count(item.id)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {notice}
      {closed && (
        <div className="alert alert-warning">
          {WEEKDAYS[weekdayOf(date)]}요일은 매장 정기 휴무일이에요. 잡혀 있는
          예약이 있다면 일정 변경을 확인해 주세요.
        </div>
      )}
      <section
        className="ops-m-timeline"
        aria-label={`${shortDateLabel(date)} 예약 ${total}건`}
      >
        {!columns.length ? (
          <p className="ops-m-empty">
            예약을 받을 직원을 등록하면 시간표가 만들어져요
          </p>
        ) : !rows.length ? (
          <p className="ops-m-empty">이날은 잡힌 예약이 없어요</p>
        ) : (
          rows.map((item) => {
            const end =
              item.kind === "booking"
                ? item.row.start + item.row.duration
                : item.end;
            const current =
              item.kind === "booking" &&
              now != null &&
              item.start <= now &&
              now < end;
            return (
              <div className="ops-m-row" key={item.key}>
                <span
                  className={`ops-m-time ${current ? "is-now" : ""} ${item.kind === "gap" ? "is-gap" : ""}`}
                >
                  {timeLabel(item.start)}
                </span>
                {item.kind === "gap" && (
                  <button
                    type="button"
                    className="ops-m-gap"
                    onClick={() => onCreate(item.staffId, item.start)}
                  >
                    <span>{rangeLabel(item.start, item.end)} 비어 있어요</span>
                    <Icon name="plus" size={16} />
                  </button>
                )}
                {item.kind === "leave" && (
                  <div className="ops-m-card tone-leave">
                    <span className="ops-m-card-text">
                      <span className="ops-m-name">{item.title}</span>
                      <span>{item.staff}</span>
                      <span className="ops-meta num">{item.range}</span>
                    </span>
                    <span className="ops-pill" data-status="leave">
                      {item.pill || "휴가"}
                    </span>
                  </div>
                )}
                {item.kind === "booking" &&
                  (() => {
                    const row = item.row;
                    const warning = data.customers.find(
                      (person) => person.id === row.customerId,
                    )?.warning;
                    return (
                      <button
                        type="button"
                        className={`ops-m-card tone-${PHONE_TONE[row.status] || "booked"}`}
                        onClick={() => onOpen(row.id)}
                      >
                        <span className="ops-m-card-text">
                          <span className="ops-m-name">
                            {customerName(row, data)} 님
                            {warning && (
                              <span
                                className="ops-warn-dot"
                                role="img"
                                aria-label="시술 전 확인"
                              />
                            )}
                          </span>
                          <span>{serviceNames(row.serviceIds, data)}</span>
                          <span className="ops-meta num">
                            {rangeLabel(row.start, end)}
                          </span>
                          {active === "all" && (
                            <span className="ops-meta">
                              {staffName(row.staffId, data)}
                            </span>
                          )}
                        </span>
                        <StatusPill status={row.status} />
                      </button>
                    );
                  })()}
              </div>
            );
          })
        )}
        <div className="ops-inline-actions ops-m-more">
          {hiddenCount > 0 && (
            <span className="help">
              취소나 미방문 {hiddenCount}건은 목록에서 볼 수 있어요
            </span>
          )}
          <button
            type="button"
            className="text-btn ops-text-btn"
            onClick={onShowList}
          >
            목록에서 보기
          </button>
        </div>
      </section>
      {canCreate && (
        <button type="button" className="ops-m-fab" onClick={onNew}>
          <Icon name="plus" size={20} />
          예약 등록
        </button>
      )}
    </>
  );
}

export default function Appointments({
  data,
  user,
  runAction,
  notify,
  navigate,
  routeContext = {},
}) {
  const today = todaySeoul();
  const [date, setDate] = useViewState("appointments", "date", today);
  const [mode, setMode] = useViewState("appointments", "mode", "day");
  const [from, setFrom] = useViewState("appointments", "from", today);
  const [to, setTo] = useViewState("appointments", "to", shiftDate(today, 7));
  const [staffFilter, setStaffFilter] = useViewState(
    "appointments",
    "staffFilter",
    "all",
  );
  const [statusFilter, setStatusFilter] = useViewState(
    "appointments",
    "statusFilter",
    "all",
  );
  const [query, setQuery] = useViewState("appointments", "query", "");
  const [editor, setEditor] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [page, setPage] = useViewState("appointments", "page", 1);
  const phone = useMediaQuery();
  // Each navigation creates a new context object, so repeated requests
  // (for example the header booking button) are handled every time.
  const routeHandled = useRef(null);
  useEffect(() => {
    if (routeContext === routeHandled.current) return;
    routeHandled.current = routeContext;
    if (routeContext.appointmentId) {
      const appointment = data.appointments.find(
        (item) => item.id === routeContext.appointmentId,
      );
      if (appointment) {
        setDate(appointment.date);
        setMode("day");
        setSelectedId(appointment.id);
      }
    } else if (routeContext.customerId) {
      setDate(routeContext.date || today);
      setMode("day");
      setEditor({ customerId: routeContext.customerId });
    } else if (routeContext.create) {
      setDate(routeContext.date || today);
      setMode("day");
      setEditor({});
    } else if (routeContext.pending) {
      setMode("pending");
      setStatusFilter("all");
      setStaffFilter("all");
      setQuery("");
    } else if (routeContext.date) {
      setDate(routeContext.date);
      setStaffFilter("all");
      setQuery("");
      if (routeContext.status && routeContext.status !== "all") {
        setMode("range");
        setFrom(routeContext.date);
        setTo(routeContext.date);
        setStatusFilter(routeContext.status);
      } else {
        setMode("day");
        setStatusFilter("all");
      }
    }
  }, [routeContext, data.appointments]);
  const filterKey = JSON.stringify([
    date,
    mode,
    from,
    to,
    staffFilter,
    statusFilter,
    query,
  ]);
  const previousFilters = useRef(filterKey);
  useEffect(() => {
    if (filterKey !== previousFilters.current) setPage(1);
    previousFilters.current = filterKey;
  }, [filterKey, setPage]);
  const overdue = data.appointments.filter(
    (item) => item.date < today && OPEN.includes(item.status),
  );
  const visibleStaff = data.staff.filter(
    (item) => user.role !== "designer" || item.id === user.staffId,
  );
  const matching = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return data.appointments
      .filter(
        (item) =>
          (mode === "pending"
            ? item.date < today && OPEN.includes(item.status)
            : item.date >= from && item.date <= to) &&
          (staffFilter === "all" || item.staffId === staffFilter) &&
          (statusFilter === "all" || item.status === statusFilter) &&
          (!search ||
            customerName(item, data).toLocaleLowerCase().includes(search) ||
            (customerPhone(item, data)
              .replace(/\D/g, "")
              .includes(search.replace(/\D/g, "")) &&
              /\d/.test(search))),
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.start - b.start ||
          staffName(a.staffId, data).localeCompare(
            staffName(b.staffId, data),
            "ko",
          ),
      );
  }, [data, mode, today, from, to, staffFilter, statusFilter, query]);
  const dayAppointments = data.appointments.filter(
    (item) => item.date === date,
  );
  const dayActive = dayAppointments.filter(
    (item) => !["cancelled", "no_show"].includes(item.status),
  );
  const dayHidden = dayAppointments.length - dayActive.length;
  const selected = data.appointments.find((item) => item.id === selectedId);
  const dayOfWeek = weekdayOf(date);
  const closed = data.store.closedWeekdays?.includes(dayOfWeek);
  const hasService = data.services.some((item) => item.active);
  const hasStaff = visibleStaff.some(
    (item) => item.status === "active" && item.role !== "reception",
  );
  const ready = hasService && hasStaff;
  const pageCount = Math.max(1, Math.ceil(matching.length / 30));
  const currentPage = Math.min(page, pageCount);
  const startStatus = (appointment, status) => {
    setSelectedId(null);
    setStatusTarget({ appointment, status });
  };
  const switchMode = (value) => {
    setMode(value);
    setStatusFilter("all");
  };
  const eyebrow =
    mode === "day"
      ? `${date === today ? "오늘 " : ""}예약 ${dayActive.length}건`
      : `예약 ${matching.length}건`;
  const title =
    mode === "day"
      ? longDateLabel(date)
      : mode === "pending"
        ? "지난 미처리 예약"
        : "예약 목록";
  const phoneDay = phone && mode === "day";
  const setupAlert = !ready && (
    <section className="setup-notice" aria-labelledby="ops-setup-title">
      <span className="setup-notice-icon" aria-hidden="true">
        <Icon name="info" />
      </span>
      <div className="setup-notice-text">
        <strong id="ops-setup-title">
          {!hasService && !hasStaff
            ? "직원과 시술을 등록하면 예약을 받을 수 있어요"
            : !hasService
              ? "시술을 등록하면 예약을 받을 수 있어요"
              : "예약을 맡을 직원을 등록해 주세요"}
        </strong>
        <span>
          {!hasService
            ? "시술 이름과 가격, 걸리는 시간을 넣어 주세요"
            : "디자이너나 매니저로 등록한 직원만 예약을 받아요"}
        </span>
      </div>
      {["owner", "manager"].includes(user.role) && (
        <div className="setup-notice-actions">
          {!hasStaff && (
            <Button variant={hasService ? "primary" : "secondary"} onClick={() => navigate("staff")}>
              직원 등록
            </Button>
          )}
          {!hasService && (
            <Button variant="primary" onClick={() => navigate("settings", { tab: "services" })}>
              시술 등록
            </Button>
          )}
        </div>
      )}
    </section>
  );
  return (
    <section className={`ops-page ${phoneDay ? "ops-page-phone" : ""}`}>
      {phoneDay ? (
        <PhoneSchedule
          data={data}
          date={date}
          today={today}
          staff={visibleStaff}
          staffFilter={staffFilter}
          canCreate={ready}
          overdueCount={overdue.length}
          hiddenCount={dayHidden}
          onDate={setDate}
          onStaff={setStaffFilter}
          onPending={() => switchMode("pending")}
          onOpen={setSelectedId}
          onCreate={(staffId, start) =>
            setEditor({ preset: { staffId, start } })
          }
          onNew={() => setEditor({})}
          notice={setupAlert}
          onShowList={() => {
            setFrom(date);
            setTo(date);
            setQuery("");
            switchMode("range");
          }}
        />
      ) : (
        <header className="page-header ops-page-header">
          <div>
            <p className="page-eyebrow">{eyebrow}</p>
            <h1 className="page-title">{title}</h1>
          </div>
          {mode === "day" && (
            <div className="ops-date-controls">
              <Button
                variant="secondary"
                className="ops-square"
                aria-label="이전 날"
                onClick={() => setDate(shiftDate(date, -1))}
              >
                <Icon name="chevron-left" size={20} />
              </Button>
              <Button variant="secondary" onClick={() => setDate(today)}>
                오늘
              </Button>
              <Button
                variant="secondary"
                className="ops-square"
                aria-label="다음 날"
                onClick={() => setDate(shiftDate(date, 1))}
              >
                <Icon name="chevron-right" size={20} />
              </Button>
              <DateInput
                className="input ops-date-input"
                aria-label="조회 날짜"
                type="date"
                required
                value={date}
                onChange={(event) => {
                  if (event.target.value) setDate(event.target.value);
                }}
              />
            </div>
          )}
        </header>
      )}
      {!phoneDay && setupAlert}
      {!phoneDay && (
        <>
          <div className="ops-toolbar">
            <div className="chip-row" role="group" aria-label="보기">
              <button
                type="button"
                className="chip"
                aria-pressed={mode === "day"}
                onClick={() => switchMode("day")}
              >
                시간표
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={mode === "range"}
                onClick={() => switchMode("range")}
              >
                목록
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={mode === "pending"}
                onClick={() => switchMode("pending")}
              >
                지난 미처리
                {overdue.length > 0 && (
                  <span className="ops-chip-count"> {overdue.length}</span>
                )}
              </button>
            </div>
            {mode === "day" && ready && (
              <span className="muted">빈 칸을 누르면 그 시간으로 예약해요</span>
            )}
            {mode === "pending" && (
              <span className="muted">
                실제 방문 여부와 수납 여부를 확인해 주세요
              </span>
            )}
          </div>
        </>
      )}
      {mode === "day" && !phoneDay && (
        <>
          {closed && (
            <div className="alert alert-warning">
              {WEEKDAYS[dayOfWeek]}요일은 매장 정기 휴무일이에요. 잡혀 있는
              예약이 있다면 일정 변경을 확인해 주세요.
            </div>
          )}
          <Timetable
            data={data}
            date={date}
            staff={visibleStaff}
            canCreate={ready}
            onOpen={setSelectedId}
            onCreate={(staffId, start) =>
              setEditor({ preset: { staffId, start } })
            }
          />
          {dayHidden > 0 && (
            <div className="ops-inline-actions ops-hidden-note">
              <span className="muted">
                취소나 미방문 {dayHidden}건은 목록에서 볼 수 있어요
              </span>
              <button
                type="button"
                className="text-btn ops-text-btn"
                onClick={() => {
                  setFrom(date);
                  setTo(date);
                  setStaffFilter("all");
                  setQuery("");
                  switchMode("range");
                }}
              >
                목록에서 보기
              </button>
            </div>
          )}
        </>
      )}
      {mode !== "day" && (
        <>
          <div className="panel ops-filters">
            {mode === "range" && (
              <>
                <Field label="시작 날짜">
                  <DateInput
                    className="input"
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </Field>
                <Field label="종료 날짜">
                  <DateInput
                    className="input"
                    type="date"
                    value={to}
                    min={from}
                    onChange={(event) => setTo(event.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="담당 직원">
              <select
                className="select"
                value={staffFilter}
                onChange={(event) => setStaffFilter(event.target.value)}
              >
                <option value="all">전체 담당자</option>
                {visibleStaff.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.status !== "active" ? " (비활성)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="예약 상태">
              <select
                className="select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">전체 상태</option>
                {Object.entries(STATUS)
                  .filter(([key]) => mode !== "pending" || OPEN.includes(key))
                  .map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="고객 검색" className="ops-search">
              <input
                className="input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름이나 전화번호"
              />
            </Field>
          </div>
          {mode === "range" && from > to && (
            <div className="ops-error" role="alert">
              종료 날짜를 시작 날짜 이후로 골라 주세요.
            </div>
          )}
          {matching.length ? (
            <div className="panel ops-bookings">
              {matching
                .slice((currentPage - 1) * 30, currentPage * 30)
                .map((appointment) => {
                  const customer = data.customers.find(
                    (item) => item.id === appointment.customerId,
                  );
                  const staff = data.staff.find(
                    (item) => item.id === appointment.staffId,
                  );
                  return (
                    <article
                      className="ops-booking"
                      key={appointment.id}
                      data-status={appointment.status}
                      aria-label={`${appointment.date} ${timeLabel(appointment.start)} ${customerName(appointment, data)} 예약`}
                    >
                      <div className="ops-booking-time">
                        <span className="help">
                          {dateLabel(appointment.date)}
                        </span>
                        <strong>{timeLabel(appointment.start)}</strong>
                        <span className="help">
                          {timeLabel(appointment.start + appointment.duration)}
                          까지
                        </span>
                      </div>
                      <div className="ops-booking-main">
                        <div className="ops-booking-person">
                          <button
                            type="button"
                            className="ops-link"
                            onClick={() => setSelectedId(appointment.id)}
                          >
                            {customerName(appointment, data)}
                          </button>
                          <Badge tone={STATUS[appointment.status]?.tone}>
                            {STATUS[appointment.status]?.label}
                          </Badge>
                        </div>
                        <span>{serviceNames(appointment.serviceIds, data)}</span>
                        <span className="help">
                          {staffName(appointment.staffId, data)}
                          {staff?.status !== "active" ? " (비활성 직원)" : ""}
                        </span>
                        <span className="help">
                          {customerPhone(appointment, data) || "전화번호 없음"}
                        </span>
                        {customer?.warning && (
                          <div className="ops-warning">
                            시술 전 확인: {customer.warning}
                          </div>
                        )}
                        {appointment.notes && (
                          <p className="ops-booking-notes">
                            {appointment.notes}
                          </p>
                        )}
                      </div>
                      <div className="ops-booking-actions">
                        {appointment.status === "booked" &&
                          appointment.date <= today && (
                            <Button
                              variant="primary"
                              onClick={() =>
                                startStatus(appointment, "checked_in")
                              }
                            >
                              방문 확인
                            </Button>
                          )}
                        {appointment.status === "checked_in" &&
                          appointment.date <= today && (
                            <Button
                              variant="primary"
                              onClick={() =>
                                startStatus(appointment, "in_service")
                              }
                            >
                              시술 시작
                            </Button>
                          )}
                        {OPEN.includes(appointment.status) && (
                          <>
                            <Button
                              variant="secondary"
                              onClick={() => setEditor({ appointment })}
                            >
                              수정
                            </Button>
                            {canTakePayment(user) && (
                              <Button
                                variant={
                                  appointment.status === "in_service"
                                    ? "primary"
                                    : "secondary"
                                }
                                onClick={() =>
                                  navigate("payments", {
                                    appointmentId: appointment.id,
                                  })
                                }
                              >
                                수납
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              onClick={() =>
                                startStatus(appointment, "cancelled")
                              }
                            >
                              취소
                            </Button>
                            {appointment.date <= today &&
                              appointment.status !== "in_service" && (
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    startStatus(appointment, "no_show")
                                  }
                                >
                                  미방문
                                </Button>
                              )}
                          </>
                        )}
                        {["cancelled", "no_show"].includes(
                          appointment.status,
                        ) &&
                          !appointment.transactionId && (
                            <Button
                              variant="secondary"
                              onClick={() => startStatus(appointment, "booked")}
                            >
                              예약 복구
                            </Button>
                          )}
                        <Button
                          variant="ghost"
                          onClick={() => setSelectedId(appointment.id)}
                        >
                          상세
                        </Button>
                      </div>
                    </article>
                  );
                })}
            </div>
          ) : (
            <div className="panel">
              <EmptyState
                title={
                  mode === "pending"
                    ? "지난 미처리 예약이 없어요"
                    : "조건에 맞는 예약이 없어요"
                }
                description={
                  mode === "pending"
                    ? "지난 예약의 방문과 수납이 모두 정리되어 있어요."
                    : query || staffFilter !== "all" || statusFilter !== "all"
                      ? "날짜와 검색 조건을 확인해 주세요."
                      : "새 예약을 등록해 일정을 채워 보세요."
                }
                action={
                  ready && mode !== "pending" ? (
                    <Button variant="primary" onClick={() => setEditor({})}>
                      예약 등록
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
          {pageCount > 1 && (
            <nav className="ops-pagination" aria-label="예약 목록 페이지">
              <Button
                variant="secondary"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                이전
              </Button>
              <span className="num">
                {currentPage} / {pageCount}
              </span>
              <Button
                variant="secondary"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                다음
              </Button>
            </nav>
          )}
        </>
      )}
      {editor && (
        <AppointmentEditor
          appointment={editor.appointment}
          date={date}
          customerId={editor.customerId}
          preset={editor.preset}
          preferredStaffId={
            (mode === "day" && !phone) || staffFilter === "all"
              ? undefined
              : visibleStaff.find(
                  (item) =>
                    item.id === staffFilter &&
                    item.status === "active" &&
                    item.role !== "reception",
                )?.id
          }
          data={data}
          user={user}
          runAction={runAction}
          onClose={() => setEditor(null)}
          onSaved={(savedDate, savedStaffId) => {
            setEditor(null);
            setDate(savedDate);
            setMode("day");
            setStatusFilter("all");
            setQuery("");
            if (staffFilter !== "all") setStaffFilter(savedStaffId);
            notify?.("예약을 저장했어요", "success");
          }}
        />
      )}
      {selected && !editor && !statusTarget && (
        <AppointmentDetail
          appointment={selected}
          data={data}
          user={user}
          onClose={() => setSelectedId(null)}
          onEdit={() => {
            setEditor({ appointment: selected });
            setSelectedId(null);
          }}
          onStatus={(status) => startStatus(selected, status)}
          navigate={navigate}
        />
      )}
      {statusTarget && (
        <StatusDialog
          target={statusTarget}
          data={data}
          runAction={runAction}
          onClose={() => setStatusTarget(null)}
          onSaved={() => {
            setStatusTarget(null);
            notify?.("예약 상태를 바꿨어요", "success");
          }}
        />
      )}
    </section>
  );
}
