import { DateInput } from "../components/DateInput.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Money,
} from "../components/ui.jsx";
import {
  STATUS,
  WEEKDAYS,
  availableAppointmentTimes,
  customerName,
  customerPhone,
  dateLabel,
  moneyLabel,
  serviceNames,
  shiftDate,
  staffName,
  timeLabel,
  timeMinutes,
  timestampLabel,
  todaySeoul,
} from "./operations-utils.js";
import "./Operations.css";
import { Icon } from "../components/Icon.jsx";
import { CustomerEditor } from "./Customers.jsx";
import { useViewState } from "../components/ViewState.jsx";

const OPEN = ["booked", "checked_in", "in_service"];
const canTakePayment = (user) => user.role !== "designer";
function freshDraft(data, user, date, customerId) {
  const availableStaff = data.staff.filter(
    (item) =>
      item.status === "active" &&
      item.role !== "reception" &&
      (user.role !== "designer" || item.id === user.staffId),
  );
  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const minutes = timeMinutes(nowParts);
  const suggested =
    Math.ceil(minutes / (data.store.slotMinutes || 30)) *
    (data.store.slotMinutes || 30);
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
    staffId: availableStaff[0]?.id || "",
    serviceIds: [],
    notes: "",
  };
}
function AppointmentEditor({
  appointment,
  date,
  customerId,
  preferredStaffId,
  data,
  user,
  runAction,
  onClose,
  onSaved,
}) {
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
        },
  );
  const [draft, setDraft] = useState(initial.current);
  const [kind, setKind] = useState(
    initial.current.customerId ? "customer" : "guest",
  );
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [customerEditor, setCustomerEditor] = useState(null);
  const [customerCreated, setCustomerCreated] = useState(false);
  const bookingDirty =
    JSON.stringify(draft) !== JSON.stringify(initial.current) ||
    kind !== (initial.current.customerId ? "customer" : "guest");
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
  const change = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const availableStaff = data.staff.filter(
    (item) =>
      ((item.status === "active" && item.role !== "reception") ||
        item.id === draft.staffId) &&
      (user.role !== "designer" || item.id === user.staffId),
  );
  const availableServices = data.services.filter(
    (item) => item.active || draft.serviceIds.includes(item.id),
  );
  const services = data.services.filter((item) =>
    draft.serviceIds.includes(item.id),
  );
  const customer = data.customers.find((item) => item.id === draft.customerId);
  const matchingCustomers = data.customers
    .filter(
      (item) =>
        (!item.archived || item.id === draft.customerId) &&
        (!search.trim() ||
          item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ||
          (String(item.phone || "")
            .replace(/\D/g, "")
            .includes(search.replace(/\D/g, "")) &&
            /\d/.test(search))),
    )
    .slice(0, 15);
  const selectedStaff = data.staff.find((item) => item.id === draft.staffId);
  const weekday = new Date(`${draft.date}T12:00:00+09:00`).getUTCDay();
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
  });
  function openCustomerEditor() {
    const term = search.trim();
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
      setError("예약할 고객을 선택해 주세요.");
      return;
    }
    if (!draft.serviceIds.length) {
      setError("시술을 하나 이상 선택해 주세요.");
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
          "예약을 저장하지 못했습니다. 입력 내용을 확인해 주세요.",
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
  return (
    <Modal
      title={appointment ? "예약 수정" : "새 예약 등록"}
      size="wide"
      onClose={busy ? undefined : onClose}
      dirty={bookingDirty}
      footer={
        <>
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
      <form id="appointment-editor" className="ops-form" onSubmit={submit}>
        {error && (
          <div className="ops-error" role="alert">
            {error}
          </div>
        )}
        {customerCreated && (
          <div className="alert alert-success" role="status">
            고객 등록이 완료되었습니다. 아래 예약 내용을 확인하고 예약을 저장해
            주세요.
          </div>
        )}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">고객 정보</legend>
          <div className="row">
            <Button
              type="button"
              variant={kind === "customer" ? "primary" : "secondary"}
              aria-pressed={kind === "customer"}
              onClick={() => setKind("customer")}
            >
              등록 고객
            </Button>
            <Button
              type="button"
              variant={kind === "guest" ? "primary" : "secondary"}
              aria-pressed={kind === "guest"}
              onClick={() => setKind("guest")}
            >
              미등록 고객
            </Button>
            <Button onClick={openCustomerEditor} aria-label="+ 새 고객 등록">
              <Icon name="plus" size={16} /> 새 고객 등록
            </Button>
          </div>
        </fieldset>
        {kind === "customer" ? (
          <div>
            <Field label="고객 찾기">
              <input
                className="input"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="이름 또는 연락처로 검색"
              />
            </Field>
            {customer && (
              <div className="alert alert-success" style={{ marginTop: 8 }}>
                선택한 고객: <strong>{customer.name}</strong> ·{" "}
                {customer.phone || "연락처 없음"}
              </div>
            )}
            <div
              className="ops-choice-list"
              role="group"
              aria-label="고객 검색 결과"
            >
              {matchingCustomers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`ops-choice ${draft.customerId === item.id ? "selected" : ""}`}
                  aria-pressed={draft.customerId === item.id}
                  onClick={() => change("customerId", item.id)}
                >
                  <strong>
                    {item.name}
                    {item.archived ? " (보관됨)" : ""}
                  </strong>
                  <small>{item.phone || "연락처 없음"}</small>
                </button>
              ))}
              {!matchingCustomers.length && (
                <p className="help">
                  일치하는 고객이 없습니다. 위의 ‘새 고객 등록’으로 고객을
                  등록하고 이 예약을 이어서 작성할 수 있습니다.
                </p>
              )}
            </div>
            {!search &&
              data.customers.filter((item) => !item.archived).length > 15 && (
                <p className="help">
                  처음 15명의 고객을 표시했습니다. 이름이나 연락처를 입력해
                  검색해 주세요.
                </p>
              )}
            {customer?.warning && (
              <div className="ops-warning">
                <strong>시술 전 확인</strong>
                <br />
                {customer.warning}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-2">
            <Field label="예약자 이름 *">
              <input
                className="input"
                value={draft.guestName}
                maxLength={80}
                required
                onChange={(event) => change("guestName", event.target.value)}
                placeholder="예약자 이름"
              />
            </Field>
            <Field label="예약자 연락처">
              <input
                className="input"
                type="tel"
                value={draft.guestPhone}
                maxLength={30}
                onChange={(event) => change("guestPhone", event.target.value)}
                placeholder="010-0000-0000"
              />
            </Field>
          </div>
        )}
        <div className="grid grid-2">
          <Field label="예약 날짜 *">
            <DateInput
              className="input"
              type="date"
              required
              value={draft.date}
              onChange={(event) => change("date", event.target.value)}
            />
          </Field>
          <Field label="담당 직원 *">
            <select
              className="select"
              required
              value={draft.staffId}
              onChange={(event) => change("staffId", event.target.value)}
            >
              <option value="">담당 직원 선택</option>
              {availableStaff.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.status !== "active" ? " (비활성)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {closed && (
          <div className="alert alert-warning">
            {dateLabel(draft.date)}은 매장 정기 휴무일입니다. 다른 날짜를 선택해
            주세요.
          </div>
        )}
        {off && (
          <div className="alert alert-warning">
            선택한 직원의 근무일이 아닙니다. 다른 날짜 또는 담당 직원을 선택해
            주세요.
          </div>
        )}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label">예약 시술 *</legend>
          {availableServices.length ? (
            <div className="ops-service-options">
              {availableServices.map((item) => (
                <label key={item.id} className="ops-service-option">
                  <input
                    type="checkbox"
                    checked={draft.serviceIds.includes(item.id)}
                    onChange={() => toggleService(item.id)}
                  />
                  <span>
                    <strong>
                      {item.name}
                      {!item.active ? " (사용 중지)" : ""}
                    </strong>
                    <small>
                      {item.duration}분 · {moneyLabel(item.price)}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="help">
              등록된 시술이 없습니다. 매장 관리자에게 시술 등록을 요청해 주세요.
            </p>
          )}
        </fieldset>
        <div className="grid grid-2">
          <Field
            label="시작 시간 *"
            help={`매장 영업 ${timeLabel(data.store.open)}–${timeLabel(data.store.close)}`}
          >
            <input
              className="input"
              type="time"
              required
              step="60"
              value={Number.isFinite(draft.start) ? timeLabel(draft.start) : ""}
              onChange={(event) =>
                change("start", timeMinutes(event.target.value))
              }
            />
          </Field>
          <Field
            label="소요 시간 (분) *"
            help={`예정 종료 ${Number.isFinite(Number(draft.start) + Number(draft.duration)) ? timeLabel(Number(draft.start) + Number(draft.duration)) : "—"} · 시술 선택 시 기본 시간이 적용됩니다.`}
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
        {selectedStaff && (
          <p className="help" style={{ margin: 0 }}>
            {selectedStaff.name} 근무: {timeLabel(selectedStaff.startMinutes)}–
            {timeLabel(selectedStaff.endMinutes)}
            {selectedStaff.breakStart != null && selectedStaff.breakEnd != null
              ? ` · 휴게 ${timeLabel(selectedStaff.breakStart)}–${timeLabel(selectedStaff.breakEnd)}`
              : ""}
          </p>
        )}
        <section className="ops-availability" aria-label="예약 가능한 시간">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>예약 가능한 시작 시간</strong>
            <span className="help">
              {Number(draft.duration) || 0}분 시술 기준 ·{" "}
              {data.store.slotMinutes || 30}분 간격
            </span>
          </div>
          {availableTimes.length ? (
            <div
              className="ops-time-options"
              role="group"
              aria-label="가능한 시작 시간 선택"
            >
              {availableTimes.map((start) => (
                <button
                  type="button"
                  className={`ops-time-option ${Number(draft.start) === start ? "selected" : ""}`}
                  aria-pressed={Number(draft.start) === start}
                  key={start}
                  onClick={() => change("start", start)}
                >
                  {timeLabel(start)}
                </button>
              ))}
            </div>
          ) : (
            <p className="help" role="status">
              선택한 날짜·담당자·소요 시간에 맞는 빈 시간이 없습니다. 날짜나
              담당자를 변경해 주세요.
            </p>
          )}
          <p className="help">
            영업·근무·휴게시간과 기존 예약을 반영합니다. 위에서 시간을 직접
            입력할 수도 있으며, 저장할 때 최신 예약을 다시 확인합니다.
          </p>
        </section>
        {collisions.length > 0 && (
          <div className="alert alert-warning">
            <strong>같은 담당자의 예약과 겹칩니다.</strong>
            {collisions.map((item) => (
              <div key={item.id}>
                {timeLabel(item.start)}–{timeLabel(item.start + item.duration)}{" "}
                · {customerName(item, data)}
              </div>
            ))}
            시작 시간이나 담당 직원을 조정해 주세요.
          </div>
        )}
        <Field
          label="예약 메모"
          help="요청한 스타일, 지각 연락, 상담할 내용을 남겨 주세요."
        >
          <textarea
            className="textarea"
            rows={3}
            maxLength={3000}
            value={draft.notes}
            onChange={(event) => change("notes", event.target.value)}
            placeholder="예: 첫 방문 · 시술 전 스타일 상담 요청"
          />
        </Field>
        <div
          className="card card-body row"
          style={{ justifyContent: "space-between" }}
        >
          <span>선택한 시술 기준 예상 금액</span>
          <strong>
            <Money
              value={services.reduce((sum, item) => sum + item.price, 0)}
            />
          </strong>
        </div>
        <p className="help" style={{ margin: 0 }}>
          최종 수납 금액은 시술 후 결제 화면에서 확인합니다. 예약 저장 시 재고와
          매출은 변하지 않습니다.
        </p>
      </form>
    </Modal>
  );
}

function StatusDialog({ target, data, runAction, onClose, onSaved }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { status } = target;
  const appointment =
    data.appointments.find((item) => item.id === target.appointment.id) ||
    target.appointment;
  const backward =
    ["booked", "checked_in", "in_service"].indexOf(status) <=
      ["booked", "checked_in", "in_service"].indexOf(appointment.status) ||
    ["cancelled", "no_show"].includes(appointment.status);
  const requiresReason = backward || ["cancelled", "no_show"].includes(status);
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
      title={`예약을 ‘${STATUS[status].label}’ 상태로 변경`}
      onClose={busy ? undefined : onClose}
      dirty={Boolean(reason)}
      footer={
        <>
          <Button
            type="submit"
            form="appointment-status"
            variant={
              status === "cancelled" || status === "no_show"
                ? "danger"
                : "primary"
            }
            busy={busy}
          >
            변경하기
          </Button>
        </>
      }
    >
      <form id="appointment-status" className="ops-form" onSubmit={submit}>
        {error && (
          <div className="ops-error" role="alert">
            {error}
          </div>
        )}
        <div className="card card-body">
          <strong>{customerName(appointment, data)}</strong>
          <p className="help">
            {appointment.date} {timeLabel(appointment.start)} ·{" "}
            {staffName(appointment.staffId, data)} ·{" "}
            {serviceNames(appointment.serviceIds, data)}
          </p>
          <div className="row">
            <Badge tone={STATUS[appointment.status]?.tone}>
              {STATUS[appointment.status]?.label}
            </Badge>
            <Icon name="arrow-right" size={16} />
            <Badge tone={STATUS[status]?.tone}>{STATUS[status]?.label}</Badge>
          </div>
        </div>
        {status === "no_show" && (
          <p className="help">
            방문 예정 시간이 지난 후 실제 미방문 여부를 확인하고 처리해 주세요.
          </p>
        )}
        {["booked", "checked_in"].includes(status) && backward && (
          <p className="help">
            상태를 복구하면 담당 직원의 예약 시간이 다시 점유됩니다. 다른 예약과
            겹치면 저장할 수 없습니다.
          </p>
        )}
        <Field
          label={requiresReason ? "변경 사유 *" : "변경 메모 (선택)"}
          help="변경 시각과 처리 직원이 기록됩니다."
        >
          <textarea
            autoFocus
            className="textarea"
            required={requiresReason}
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              status === "cancelled"
                ? "예: 고객 요청으로 일정 변경"
                : status === "no_show"
                  ? "예: 예약 시간 경과 후 연락했으나 응답 없음"
                  : "상태를 변경하는 이유를 남겨 주세요."
            }
          />
        </Field>
      </form>
    </Modal>
  );
}

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
  return (
    <Modal
      title="예약 상세"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          {OPEN.includes(appointment.status) && (
            <Button variant="secondary" onClick={onEdit}>
              예약 수정
            </Button>
          )}
          {OPEN.includes(appointment.status) && canTakePayment(user) && (
            <Button
              onClick={() =>
                navigate("payments", { appointmentId: appointment.id })
              }
            >
              수납하기
            </Button>
          )}
        </>
      }
    >
      <div className="ops-form">
        <div className="ops-day-heading">
          <div>
            <h2>{customerName(appointment, data)}</h2>
            <p className="help">
              {customerPhone(appointment, data) || "연락처 미등록"}
            </p>
          </div>
          <Badge tone={STATUS[appointment.status]?.tone}>
            {STATUS[appointment.status]?.label}
          </Badge>
        </div>
        {customer?.warning && (
          <div className="ops-warning">
            <strong>시술 전 확인</strong>
            <br />
            {customer.warning}
          </div>
        )}
        <div className="grid grid-2">
          <div className="card card-body">
            <span className="muted">예약 일시</span>
            <h3>{dateLabel(appointment.date)}</h3>
            <p>
              {timeLabel(appointment.start)}–
              {timeLabel(appointment.start + appointment.duration)} ·{" "}
              {appointment.duration}분
            </p>
          </div>
          <div className="card card-body">
            <span className="muted">담당 직원 · 시술</span>
            <h3>{staffName(appointment.staffId, data)}</h3>
            <p>{serviceNames(appointment.serviceIds, data)}</p>
          </div>
        </div>
        {appointment.notes && (
          <div className="card card-body">
            <h3>예약 메모</h3>
            <p className="ops-chart-notes">{appointment.notes}</p>
          </div>
        )}
        <div className="row">
          {customer && (
            <Button
              variant="secondary"
              onClick={() => navigate("customers", { customerId: customer.id })}
            >
              고객 차트 열기
            </Button>
          )}
          {appointment.transactionId && canTakePayment(user) && (
            <Button
              variant="secondary"
              onClick={() =>
                navigate("payments", {
                  transactionId: appointment.transactionId,
                })
              }
            >
              수납 내역 보기
            </Button>
          )}
          {appointment.status === "checked_in" && (
            <Button variant="ghost" onClick={() => onStatus("booked")}>
              방문 확인 되돌리기
            </Button>
          )}
          {appointment.status === "in_service" && (
            <Button variant="ghost" onClick={() => onStatus("checked_in")}>
              시술 시작 되돌리기
            </Button>
          )}
          {["cancelled", "no_show"].includes(appointment.status) &&
            !appointment.transactionId && (
              <Button variant="secondary" onClick={() => onStatus("booked")}>
                예약 복구
              </Button>
            )}
        </div>
        <div>
          <h3>예약 변경 이력</h3>
          {latest.length ? (
            <ul className="ops-history">
              {latest.map((entry, index) => (
                <li key={entry.id || index}>
                  <strong>
                    {entry.actorName || entry.actor?.name || "직원"}
                  </strong>{" "}
                  ·{" "}
                  {entry.text ||
                    (entry.action === "status"
                      ? `${STATUS[entry.before]?.label || entry.before} → ${STATUS[entry.after]?.label || entry.after}${entry.reason ? ` · ${entry.reason}` : ""}`
                      : entry.reason ||
                        entry.summary ||
                        (entry.action === "created"
                          ? "예약 등록"
                          : "예약 정보 수정"))}
                  <time>{timestampLabel(entry.at || entry.createdAt)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="help">
              이전 시스템에서 가져온 예약은 상세 변경 이력이 없을 수 있습니다.
            </p>
          )}
        </div>
      </div>
    </Modal>
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
  const routeHandled = useRef("");
  useEffect(() => {
    const key = JSON.stringify(routeContext);
    if (key === routeHandled.current) return;
    routeHandled.current = key;
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
      setMode("day");
      setStatusFilter(routeContext.status || "all");
      setStaffFilter("all");
      setQuery("");
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
          (mode === "day"
            ? item.date === date
            : mode === "pending"
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
  }, [data, date, mode, today, from, to, staffFilter, statusFilter, query]);
  const dayAppointments = data.appointments.filter(
    (item) => item.date === date,
  );
  const selected = data.appointments.find((item) => item.id === selectedId);
  const dayOfWeek = new Date(`${date}T12:00:00+09:00`).getUTCDay();
  const closed = data.store.closedWeekdays?.includes(dayOfWeek);
  const ready =
    data.services.some((item) => item.active) &&
    visibleStaff.some(
      (item) => item.status === "active" && item.role !== "reception",
    );
  const pageCount = Math.max(1, Math.ceil(matching.length / 30));
  const currentPage = Math.min(page, pageCount);
  const startStatus = (appointment, status) => {
    setSelectedId(null);
    setStatusTarget({ appointment, status });
  };
  return (
    <section className="ops-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">예약 관리</h1>
          <p className="page-description">
            날짜와 담당자별 예약을 확인하고 방문 상태를 관리합니다.
          </p>
        </div>
        <div className="page-actions">
          <Button
            variant="primary"
            disabled={!ready}
            aria-label="+ 예약 등록"
            onClick={() => setEditor({})}
          >
            <Icon name="plus" size={16} /> 예약 등록
          </Button>
        </div>
      </header>
      {!ready && (
        <div className="alert alert-warning">
          <strong>예약을 받기 위한 기본 설정이 필요합니다.</strong>
          <p>활성 직원과 시술을 등록하면 예약을 시작할 수 있습니다.</p>
          {["owner", "manager"].includes(user.role) && (
            <div className="row">
              <Button variant="secondary" onClick={() => navigate("staff")}>
                직원 등록
              </Button>
              <Button variant="secondary" onClick={() => navigate("settings")}>
                시술 설정
              </Button>
            </div>
          )}
        </div>
      )}
      {overdue.length > 0 && mode !== "pending" && (
        <div
          className="alert alert-warning row"
          style={{ justifyContent: "space-between" }}
        >
          <span>
            <strong>지난 날짜의 미처리 예약 {overdue.length}건</strong> · 실제
            방문 여부와 수납 여부를 확인해 주세요.
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              setMode("pending");
              setStatusFilter("all");
            }}
          >
            미처리 예약 확인
          </Button>
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="예약 보기 방식">
        {[
          ["day", "하루 일정"],
          ["range", "기간 목록"],
          [
            "pending",
            `지난 미처리${overdue.length ? ` ${overdue.length}` : ""}`,
          ],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={`tab ${mode === value ? "active" : ""}`}
            onClick={() => {
              setMode(value);
              setStatusFilter("all");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "day" && (
        <div className="ops-day-heading">
          <h2>
            {dateLabel(date)}
            <span className="ops-count">{date === today ? "오늘" : date}</span>
          </h2>
          <div className="ops-date-controls">
            <Button
              variant="secondary"
              aria-label="이전 날짜"
              onClick={() => setDate(shiftDate(date, -1))}
            >
              <Icon name="chevron-left" size={16} />
            </Button>
            <DateInput
              className="input"
              aria-label="조회 날짜"
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
            <Button
              variant="secondary"
              aria-label="다음 날짜"
              onClick={() => setDate(shiftDate(date, 1))}
            >
              <Icon name="chevron-right" size={16} />
            </Button>
            <Button variant="secondary" onClick={() => setDate(today)}>
              오늘
            </Button>
          </div>
        </div>
      )}
      {mode === "day" && (
        <div className="stat-grid">
          <div className="stat-card">
            <span className="muted">전체 예약</span>
            <strong>{dayAppointments.length}건</strong>
          </div>
          <div className="stat-card">
            <span className="muted">방문 예정</span>
            <strong>
              {
                dayAppointments.filter((item) => item.status === "booked")
                  .length
              }
              건
            </strong>
          </div>
          <div className="stat-card">
            <span className="muted">방문 · 시술 중</span>
            <strong>
              {
                dayAppointments.filter((item) =>
                  ["checked_in", "in_service"].includes(item.status),
                ).length
              }
              건
            </strong>
          </div>
          <div className="stat-card">
            <span className="muted">시술 완료</span>
            <strong>
              {
                dayAppointments.filter((item) => item.status === "completed")
                  .length
              }
              건
            </strong>
          </div>
        </div>
      )}
      <div className="card card-body ops-filters">
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
            placeholder="이름 또는 연락처"
          />
        </Field>
      </div>
      {mode === "range" && from > to && (
        <div className="ops-error" role="alert">
          종료 날짜를 시작 날짜 이후로 선택해 주세요.
        </div>
      )}
      {mode === "day" && (
        <div>
          {closed ? (
            <div className="alert alert-warning">
              {WEEKDAYS[dayOfWeek]}요일은 매장 정기 휴무일입니다. 기존 예약이
              있다면 일정 변경 여부를 확인해 주세요.
            </div>
          ) : (
            <div className="ops-schedule" aria-label="직원 근무시간">
              {visibleStaff
                .filter(
                  (item) =>
                    item.status === "active" &&
                    (staffFilter === "all" || item.id === staffFilter),
                )
                .map((item) => (
                  <div className="ops-schedule-item" key={item.id}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.workingDays.includes(dayOfWeek)
                        ? `${timeLabel(item.startMinutes)}–${timeLabel(item.endMinutes)}`
                        : "휴무"}
                      {item.workingDays.includes(dayOfWeek) &&
                      item.breakStart != null
                        ? ` · 휴게 ${timeLabel(item.breakStart)}–${timeLabel(item.breakEnd)}`
                        : ""}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
      <div className="ops-day-heading">
        <h2 style={{ fontSize: 16 }}>
          {mode === "pending" ? "지난 미처리 예약" : "예약 목록"}
          <span className="ops-count">{matching.length}건</span>
        </h2>
        <span className="help">
          시간순 정렬 · 담당 직원의 휴게시간과 중복 예약을 확인합니다.
        </span>
      </div>
      {matching.length ? (
        <div className="ops-bookings">
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
                    {mode !== "day" && <span>{appointment.date}</span>}
                    <strong>{timeLabel(appointment.start)}</strong>
                    <span>
                      ~ {timeLabel(appointment.start + appointment.duration)}
                      <br />
                      {appointment.duration}분
                    </span>
                  </div>
                  <div>
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
                    <div className="ops-booking-info">
                      {serviceNames(appointment.serviceIds, data)}
                      <br />
                      {staffName(appointment.staffId, data)}
                      {staff?.status !== "active"
                        ? " (비활성 직원)"
                        : ""} ·{" "}
                      {customerPhone(appointment, data) || "연락처 없음"}
                    </div>
                    {customer?.warning && (
                      <div className="ops-warning">
                        <strong>시술 전 확인</strong> · {customer.warning}
                      </div>
                    )}
                    {appointment.notes && (
                      <p className="ops-booking-notes">{appointment.notes}</p>
                    )}
                  </div>
                  <div className="ops-booking-actions">
                    {appointment.status === "booked" && (
                      <Button
                        onClick={() => startStatus(appointment, "checked_in")}
                      >
                        방문 확인
                      </Button>
                    )}
                    {appointment.status === "checked_in" && (
                      <Button
                        onClick={() => startStatus(appointment, "in_service")}
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
                          onClick={() => startStatus(appointment, "cancelled")}
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
                    {["cancelled", "no_show"].includes(appointment.status) &&
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
        <div className="card">
          <EmptyState
            title={
              mode === "pending"
                ? "지난 미처리 예약이 없습니다"
                : "조건에 맞는 예약이 없습니다"
            }
            description={
              mode === "pending"
                ? "지난 예약의 방문 및 수납 처리가 모두 정리되어 있습니다."
                : query || staffFilter !== "all" || statusFilter !== "all"
                  ? "날짜와 검색 조건을 확인해 주세요."
                  : "새 예약을 등록해 하루 일정을 시작하세요."
            }
            action={
              ready && mode !== "pending" ? (
                <Button onClick={() => setEditor({})}>예약 등록</Button>
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
          <span>
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
      {editor && (
        <AppointmentEditor
          appointment={editor.appointment}
          date={date}
          customerId={editor.customerId}
          preferredStaffId={
            staffFilter === "all"
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
            notify?.("예약을 저장했습니다.", "success");
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
            notify?.("예약 상태를 변경했습니다.", "success");
          }}
        />
      )}
    </section>
  );
}
