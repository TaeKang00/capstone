import React, { useState } from "react";
import { today, timeLabel } from "../api";
import { Button, EmptyState, Money } from "../components/ui";
import { Icon } from "../components/Icon";
import { useViewState } from "../components/ViewState";
import { STATUS } from "./operations-utils";
import { clockLabel, hoursLabel, leaveBalance } from "../workforce-utils";

const STATUS_TONE = {
  in_service: "ok",
  checked_in: "warn",
  booked: "muted",
  completed: "muted",
  cancelled: "muted",
  no_show: "danger",
};
const durationLabel = (minutes) => {
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
};

const nowMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .split(":")
    .map(Number);
  return h * 60 + m;
};

function ClockCard({ record, runAction, notify, onLeave, leave }) {
  const [busy, setBusy] = useState(false);
  const working = record && record.clockOut == null;
  const done = record && record.clockOut != null;
  const clock = async (kind) => {
    setBusy(true);
    try {
      await runAction("attendance.clock", { kind });
      notify(kind === "in" ? "출근을 기록했습니다." : "퇴근을 기록했습니다.");
    } catch (err) {
      notify(err.message, "danger");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="home-clock-row">
      <section className="home-clock" aria-label="출퇴근">
        <span className={`status-pill status-${working ? "ok" : done ? "muted" : "warn"}`}>
          {working ? "근무 중" : done ? "퇴근" : "출근 전"}
        </span>
        <div className="home-clock-time">
          <strong>
            {working
              ? hoursLabel(Math.max(0, nowMinutes() - record.clockIn))
              : done
                ? hoursLabel(Math.max(0, record.clockOut - record.clockIn))
                : "아직 기록 없음"}
          </strong>
          <span>
            {record ? `${clockLabel(record.clockIn)} 출근` : "출근하기를 눌러 주세요"}
            {done ? `, ${clockLabel(record.clockOut)} 퇴근` : ""}
          </span>
        </div>
        {!done && (
          <Button variant="primary" busy={busy} onClick={() => clock(working ? "out" : "in")}>
            {working ? "퇴근하기" : "출근하기"}
          </Button>
        )}
      </section>
      <button type="button" className="home-leave" onClick={onLeave}>
        <span>
          <strong>남은 연차 {leave.remaining}일</strong>
          <small>{leave.reserved ? `승인 대기 ${leave.reserved}일` : "신청한 휴가가 없어요"}</small>
        </span>
        <span className="home-leave-cta">휴가 신청</span>
      </button>
    </div>
  );
}

const shiftDay = (value, days) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const METHOD_LABEL = { card: "카드", cash: "현금", transfer: "계좌이체" };

/** Phone-only owner summary (OwnerMobile board): today's sales by method and the approval shortcut. */
function OwnerPhoneSummary({ data, date, net, unpaid, open, pending, navigate }) {
  const sales = data.transactions.filter((t) => t.date === date);
  const refunds = data.refunds.filter((r) => r.date === date);
  const byMethod = Object.keys(METHOD_LABEL).map((method) => [
    METHOD_LABEL[method],
    sales.filter((t) => t.method === method).reduce((sum, t) => sum + t.total, 0),
  ]);
  const refundTotal = refunds.reduce((sum, r) => sum + r.amount, 0);
  const lastWeek = shiftDay(date, -7);
  const lastNet =
    data.transactions.filter((t) => t.date === lastWeek).reduce((sum, t) => sum + t.total, 0) -
    data.refunds.filter((r) => r.date === lastWeek).reduce((sum, r) => sum + r.amount, 0);
  const diff = net - lastNet;
  const next = open.find((a) => a.status === "booked");
  const nextName = next
    ? data.customers.find((c) => c.id === next.customerId)?.name || next.guestName || "방문 고객"
    : null;
  return (
    <div className="owner-phone">
      <section className="owner-phone-sales" aria-label="오늘 매출">
        <span className="home-stat-label">오늘 순매출</span>
        <strong className="owner-phone-net">
          <Money value={net} />
        </strong>
        <span className={`small ${diff > 0 ? "tone-up" : diff < 0 ? "tone-down" : "muted"}`}>
          {diff === 0
            ? "지난주 같은 요일과 같아요"
            : `지난주 같은 요일보다 ${Math.abs(diff).toLocaleString("ko-KR")}원 ${diff > 0 ? "많아요" : "적어요"}`}
        </span>
        <div className="owner-phone-methods">
          {byMethod.map(([label, value]) => (
            <div key={label}>
              <span className="small muted">{label}</span>
              <span className="num">{value.toLocaleString("ko-KR")}원</span>
            </div>
          ))}
          <div>
            <span className="small muted">환불</span>
            <span className="num">{refundTotal ? `−${refundTotal.toLocaleString("ko-KR")}` : 0}원</span>
          </div>
        </div>
        <span className="small muted">
          결제 {sales.length}건{refunds.length ? `, 환불 ${refunds.length}건` : ""}
        </span>
      </section>
      <div className="owner-phone-tiles">
        <button type="button" onClick={() => navigate("payments", { pending: true })}>
          <span className="small muted">수납 대기</span>
          <strong>{unpaid}건</strong>
          <span className="small muted">시술을 마친 손님</span>
        </button>
        <button type="button" onClick={() => navigate("appointments", { date })}>
          <span className="small muted">남은 예약</span>
          <strong>{open.length}건</strong>
          <span className="small muted">
            {next ? `다음 ${timeLabel(next.start)} ${nextName} 님` : "남은 예약이 없어요"}
          </span>
        </button>
      </div>
      {pending > 0 && (
        <button
          type="button"
          className="owner-phone-approval"
          onClick={() => navigate("hr", { tab: "requests" })}
        >
          <span>
            <strong>승인 대기 {pending}건</strong>
            <span className="small muted">원장 관리에서 확인해요</span>
          </span>
          <span className="owner-phone-approval-cta">
            확인
            <Icon name="chevron-right" size={16} />
          </span>
        </button>
      )}
    </div>
  );
}

export default function Dashboard({ data, user, navigate, runAction, notify }) {
  const date = today();
  const [scheduleView, setScheduleView] = useViewState(
    "dashboard",
    "schedule",
    "open",
  );
  const operational = ["owner", "manager"].includes(user.role),
    designer = user.role === "designer";
  const appointments = data.appointments
    .filter((a) => a.date === date)
    .sort((a, b) => a.start - b.start);
  const pending = data.appointments.filter(
    (a) =>
      a.date < date && !["completed", "cancelled", "no_show"].includes(a.status),
  );
  const sales = data.transactions.filter((t) => t.date === date),
    refunds = data.refunds.filter((r) => r.date === date),
    net =
      sales.reduce((s, t) => s + t.total, 0) -
      refunds.reduce((s, r) => s + r.amount, 0);
  const low = data.items.filter((i) => i.active !== false && i.qty <= i.min);
  const unpaid = appointments.filter(
    (a) =>
      !a.transactionId &&
      ["checked_in", "in_service", "completed"].includes(a.status),
  );
  const working = appointments.filter(
    (a) => !["cancelled", "no_show"].includes(a.status),
  );
  const openAppointments = working.filter((a) => a.status !== "completed");
  const rank = { in_service: 0, checked_in: 1, booked: 2 };
  const views = {
    open: [...openAppointments].sort(
      (a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.start - b.start,
    ),
    in_service: working.filter((a) => a.status === "in_service"),
    completed: working.filter((a) => a.status === "completed"),
    all: working,
  };
  const schedule = views[scheduleView] || views.open;
  const canBook = data.services.some((s) => s.active);
  const setup = operational && !canBook;

  const alertsOn = data.store.alerts || {};
  const myClock = (data.attendance || []).find(
    (row) => row.staffId === user.staffId && row.date === date,
  );
  const openPurchaseRequests = operational
    ? (data.purchaseRequests || []).filter((row) => row.status === "requested")
    : [];
  const pendingStaffRequests =
    alertsOn.pendingRequests === false ? 0 : data.pendingRequestCount || 0;
  const todos = [
    !myClock && {
      key: "clock",
      tone: "warn",
      title: "출근 기록 전",
      detail: "근태에서 출근을 눌러 주세요",
      go: () => navigate("attendance"),
    },
    myClock &&
      myClock.clockOut == null && {
        key: "clock",
        tone: "ok",
        title: "근무 중",
        detail: `${clockLabel(myClock.clockIn)} 출근`,
        go: () => navigate("attendance"),
      },
    pendingStaffRequests > 0 && {
      key: "requests",
      tone: "accent",
      title: `휴가 신청 ${pendingStaffRequests}건 승인 대기`,
      detail: "원장 관리에서 승인해요",
      go: () => navigate("hr", { tab: "requests" }),
    },
    !designer &&
      alertsOn.unpaid !== false &&
      unpaid.length > 0 && {
        key: "unpaid",
        tone: "warn",
        title: `수납 대기 ${unpaid.length}건`,
        detail: "시술을 마친 손님",
        go: () => navigate("payments", { pending: true }),
      },
    !designer &&
      alertsOn.lowStock !== false &&
      low.length > 0 && {
        key: "stock",
        tone: "warn",
        title: `보충할 재고 ${low.length}품목`,
        detail: low[0].name,
        go: () => navigate("inventory", { stock: "low" }),
      },
    openPurchaseRequests.length > 0 && {
      key: "purchase",
      tone: "warn",
      title: `구매 요청 ${openPurchaseRequests.length}건`,
      detail: openPurchaseRequests[0].itemName,
      go: () => navigate("purchases"),
    },
    pending.length > 0 && {
      key: "pending",
      tone: "warn",
      title: `지난 예약 정리 ${pending.length}건`,
      detail: "완료나 취소로 바꿔 주세요",
      go: () => navigate("appointments", { pending: true }),
    },
  ].filter(Boolean);

  const stats = designer
    ? [
        ["내 담당 수납", <Money value={net} />, () => navigate("appointments", { date, status: "all" })],
        ["남은 예약", `${openAppointments.length}건`, () => navigate("appointments", { date })],
        ["완료", `${views.completed.length}건`, () => navigate("appointments", { date, status: "all" })],
      ]
    : [
        ["오늘 순매출", <Money value={net} />, () => navigate("sales", { from: date, to: date })],
        ["남은 예약", `${openAppointments.length}건`, () => navigate("appointments", { date })],
        ["수납 대기", `${unpaid.length}건`, () => navigate("payments", { pending: true })],
      ];
  const chips = [
    ["open", `남은 예약 ${openAppointments.length}건`],
    ["in_service", `시술 중 ${views.in_service.length}건`],
    ["completed", `완료 ${views.completed.length}건`],
    ["all", `전체 ${working.length}건`],
  ];
  const cardAction = (a) => {
    if (!designer && !a.transactionId && ["in_service", "completed"].includes(a.status))
      return ["수납", () => navigate("payments", { appointmentId: a.id })];
    if (a.status === "checked_in") return ["시술 시작", () => navigate("appointments", { appointmentId: a.id })];
    if (a.status === "booked") return ["예약 보기", () => navigate("appointments", { appointmentId: a.id })];
    return ["상세", () => navigate("appointments", { appointmentId: a.id })];
  };

  return (
    <div className="home">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date())}
          </p>
          <h1 className="page-title">오늘의 매장</h1>
        </div>
      </header>

      {setup && (
        <div className="welcome-card">
          <div>
            <h2>시술 메뉴를 등록해 주세요</h2>
            <p>시술 가격과 소요시간을 등록하면 예약을 받을 수 있어요</p>
          </div>
          <Button onClick={() => navigate("settings", { tab: "services" })}>
            시술 메뉴 등록
          </Button>
        </div>
      )}

      {designer && user.staffId && (
        <ClockCard
          record={myClock}
          runAction={runAction}
          notify={notify}
          leave={leaveBalance(data, user.staffId, Number(date.slice(0, 4)))}
          onLeave={() => navigate("attendance", { create: true })}
        />
      )}

      {operational && (
        <OwnerPhoneSummary
          data={data}
          date={date}
          net={net}
          unpaid={unpaid.length}
          open={openAppointments}
          pending={pendingStaffRequests}
          navigate={navigate}
        />
      )}

      <div className="home-stats">
        {stats.map(([label, value, go]) => (
          <button key={label} type="button" className="home-stat" onClick={go}>
            <span className="home-stat-label">{label}</span>
            <strong className="home-stat-value">{value}</strong>
          </button>
        ))}
      </div>

      <div className="home-columns">
        <section className="home-schedule" aria-labelledby="home-schedule-title">
          <div className="home-section-head">
            <h2 id="home-schedule-title">{designer ? "내 오늘 예약" : "오늘 예약"}</h2>
            <div className="chip-row" role="group" aria-label="오늘 예약 표시 범위">
              {chips.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="chip"
                  aria-pressed={scheduleView === key}
                  onClick={() => setScheduleView(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {schedule.length ? (
            <div className="appointment-grid">
              {schedule.slice(0, 8).map((a) => {
                const customer = data.customers.find((c) => c.id === a.customerId);
                const name = customer?.name || a.guestName || "방문 고객";
                const staff = data.staff.find((s) => s.id === a.staffId)?.name || "담당 미정";
                const [actionLabel, action] = cardAction(a);
                return (
                  <article className="timeline-row appointment-card" key={a.id}>
                    <div className="appointment-preview">
                      <span className={`status-pill status-${STATUS_TONE[a.status]}`}>
                        {STATUS[a.status]?.label}
                      </span>
                      <strong className="appointment-time">{timeLabel(a.start)}</strong>
                      <span className="appointment-length">{durationLabel(a.duration)}</span>
                    </div>
                    <div className="appointment-info">
                      <span className="appointment-avatar" aria-hidden="true">
                        {staff.slice(0, 1)}
                      </span>
                      <div>
                        <strong>{name} 님</strong>
                        <span>
                          {a.serviceIds
                            .map((id) => data.services.find((s) => s.id === id)?.name)
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                        <small>{staff}</small>
                        {customer?.warning && <small className="appointment-warning">{customer.warning}</small>}
                      </div>
                    </div>
                    <Button variant="primary" onClick={action} aria-label={`${name} ${timeLabel(a.start)} ${actionLabel}`}>
                      {actionLabel}
                    </Button>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={
                working.length && scheduleView === "open"
                  ? "남은 예약을 모두 정리했어요"
                  : "보여줄 예약이 없어요"
              }
              description="다른 범위를 고르거나 예약 일정에서 날짜를 바꿔 보세요"
              action={
                canBook ? (
                  <Button onClick={() => navigate("appointments", { create: true })}>
                    예약 등록
                  </Button>
                ) : null
              }
            />
          )}
          {schedule.length > 8 && (
            <div className="dashboard-more">
              <Button
                variant="ghost"
                onClick={() => navigate("appointments", { date, status: "all" })}
              >
                남은 {schedule.length - 8}건 더 보기 →
              </Button>
            </div>
          )}
        </section>

        <aside className="home-side">
          <section className="card home-todo" aria-labelledby="home-todo-title">
            <h2 id="home-todo-title">확인할 일</h2>
            {todos.length ? (
              <ul>
                {todos.map((todo) => (
                  <li key={todo.key}>
                    <button type="button" onClick={todo.go}>
                      <span className={`todo-dot tone-${todo.tone}`} aria-hidden="true" />
                      <span className="todo-text">
                        <strong>{todo.title}</strong>
                        <small>{todo.detail}</small>
                      </span>
                      <Icon name="chevron-right" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">지금 확인할 일이 없어요</p>
            )}
          </section>
          <section className="card home-close">
            <h2>{designer ? "오늘 일정" : "매출 마감"}</h2>
            <p className="help">
              {designer
                ? "담당 예약의 방문 상태를 정리해 주세요"
                : "단말기 매출과 수납 기록을 맞춰 보세요"}
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                navigate(
                  designer ? "appointments" : "sales",
                  designer ? { date, status: "all" } : { from: date, to: date },
                )
              }
            >
              {designer ? "내 예약 확인" : "오늘 정산 확인"} →
            </Button>
          </section>
        </aside>
      </div>
    </div>
  );
}
