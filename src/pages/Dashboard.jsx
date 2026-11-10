import React from "react";
import { today, timeLabel } from "../api";
import { Badge, Button, EmptyState, Money } from "../components/ui";
import { Icon } from "../components/Icon";
import { useViewState } from "../components/ViewState";
import { STATUS } from "./operations-utils";
import { clockLabel } from "../workforce-utils";
export default function Dashboard({ data, user, navigate, noticeReads = [] }) {
  const date = today();
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .split(":")
    .map(Number);
  const minutes = clock[0] * 60 + clock[1];
  const [scheduleView, setScheduleView] = useViewState(
    "dashboard",
    "schedule",
    "open",
  );
  const appointments = data.appointments
      .filter((a) => a.date === date)
      .sort((a, b) => a.start - b.start),
    pending = data.appointments.filter(
      (a) =>
        a.date < date &&
        !["completed", "cancelled", "no_show"].includes(a.status),
    );
  const sales = data.transactions.filter((t) => t.date === date),
    refunds = data.refunds.filter((r) => r.date === date),
    net =
      sales.reduce((s, t) => s + t.total, 0) -
      refunds.reduce((s, r) => s + r.amount, 0);
  const low = data.items.filter((i) => i.active !== false && i.qty <= i.min),
    unpaid = appointments.filter(
      (a) =>
        !a.transactionId &&
        ["checked_in", "in_service", "completed"].includes(a.status),
    );
  const working = appointments.filter(
      (a) => !["cancelled", "no_show"].includes(a.status),
    ),
    completed = working.filter((a) => a.status === "completed").length;
  const operational = ["owner", "manager"].includes(user.role),
    designer = user.role === "designer";
  const setup = operational && !data.services.some((s) => s.active);
  const openAppointments = working.filter((a) => a.status !== "completed");
  const schedule =
    scheduleView === "all"
      ? working
      : [...openAppointments].sort(
          (a, b) =>
            (({ in_service: 0, checked_in: 1, booked: 2 })[a.status] ?? 3) -
              ({ in_service: 0, checked_in: 1, booked: 2 }[b.status] ?? 3) ||
            a.start - b.start,
        );
  const status = Object.fromEntries(
    Object.entries(STATUS).map(([key, value]) => [key, [value.label, value.tone]]),
  );
  const canBook = data.services.some((s) => s.active);
  const alertsOn = data.store.alerts || {};
  const myClock = (data.attendance || []).find(
    (row) => row.staffId === user.staffId && row.date === date,
  );
  const unreadNotices =
    alertsOn.unreadNotices === false
      ? []
      : (data.notices || []).filter(
          (notice) =>
            !notice.archived &&
            !noticeReads.some(
              (row) => row.noticeId === notice.id && row.userId === user.id,
            ),
        );
  const openPurchaseRequests = operational
    ? (data.purchaseRequests || []).filter((row) => row.status === "requested")
    : [];
  const pendingStaffRequests =
    alertsOn.pendingRequests === false ? 0 : data.pendingRequestCount || 0;
  const reminders = [
    !myClock && {
      key: "clock",
      tone: "warning",
      text: "아직 출근을 기록하지 않았습니다.",
      action: "출근 기록",
      go: () => navigate("attendance"),
    },
    myClock &&
      myClock.clockOut == null && {
        key: "clock",
        tone: "muted",
        text: `${clockLabel(myClock.clockIn)} 출근 · 근무 중`,
        action: "퇴근 기록",
        go: () => navigate("attendance"),
      },
    unreadNotices.length > 0 && {
      key: "notice",
      tone: "warning",
      text: `읽지 않은 공지 ${unreadNotices.length}건 · ${unreadNotices[0].title}`,
      action: "공지 확인",
      go: () => navigate("notices"),
    },
    pendingStaffRequests > 0 && {
      key: "requests",
      tone: "warning",
      text: `휴가·근무 신청 ${pendingStaffRequests}건이 승인을 기다립니다.`,
      action: "승인하기",
      go: () => navigate("hr", { tab: "requests" }),
    },
    openPurchaseRequests.length > 0 && {
      key: "purchase",
      tone: "warning",
      text: `직원 구매 요청 ${openPurchaseRequests.length}건 · ${openPurchaseRequests.map((row) => row.itemName).slice(0, 3).join(", ")}`,
      action: "발주 확인",
      go: () => navigate("purchases"),
    },
  ].filter(Boolean);
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">오늘의 매장</h1>
          <p className="page-description">
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date())}{" "}
            · {data.store.name}
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate("customers", { create: true })}>
            고객 등록
          </Button>
          <Button
            variant="primary"
            aria-label="＋ 예약 등록"
            disabled={!canBook}
            title={canBook ? undefined : "시술 메뉴를 먼저 등록해 주세요"}
            onClick={() => navigate("appointments", { create: true })}
          >
            <Icon name="plus" size={16} /> 예약 등록
          </Button>
        </div>
      </div>
      {setup && (
        <div className="welcome-card">
          <div>
            <h2>시술 메뉴를 등록해 주세요</h2>
            <p>시술 가격과 소요시간을 등록하면 예약을 시작할 수 있습니다.</p>
          </div>
          <Button onClick={() => navigate("settings", { tab: "services" })}>
            시술 메뉴 등록
          </Button>
        </div>
      )}
      {reminders.length > 0 && (
        <ul className="dashboard-reminders" aria-label="확인할 일">
          {reminders.map((row) => (
            <li key={row.key}>
              <Badge tone={row.tone}>{row.tone === "warning" ? "확인" : "근태"}</Badge>
              <span>{row.text}</span>
              <Button variant="ghost" onClick={row.go}>
                {row.action} →
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="stat-grid">
        <button
          type="button"
          className="stat-card stat-link featured"
          onClick={() =>
            navigate(
              designer ? "appointments" : "sales",
              designer ? { date, status: "all" } : { from: date, to: date },
            )
          }
          aria-label={designer ? "오늘 내 예약 확인" : "오늘 매출 정산 보기"}
        >
          <div className="stat-label">
            {designer ? "내 담당 수납" : "오늘 순매출"}
            <Icon name="chevron-right" size={15} />
          </div>
          <div className="stat-value">
            <Money value={net} />
          </div>
          <p className="stat-note">결제 {sales.length}건 · 당일 환불 차감</p>
        </button>
        <button
          type="button"
          className="stat-card stat-link"
          onClick={() => navigate("appointments", { date, status: "all" })}
          aria-label="오늘 예약 전체 보기"
        >
          <div className="stat-label">
            오늘 예약
            <Icon name="chevron-right" size={15} />
          </div>
          <div className="stat-value">
            {working.length}
            <small>건</small>
          </div>
          <p className="stat-note">
            시술 완료 {completed}건 / 취소·미방문 제외
          </p>
        </button>
        <button
          type="button"
          className="stat-card stat-link"
          onClick={() =>
            navigate(
              designer ? "appointments" : "payments",
              designer ? { date, status: "all" } : { pending: true },
            )
          }
          aria-label="수납 확인이 필요한 예약 보기"
        >
          <div className="stat-label">
            수납 확인 필요
            <Icon name="chevron-right" size={15} />
          </div>
          <div className="stat-value">
            {unpaid.length}
            <small>건</small>
          </div>
          <p className="stat-note">방문·시술 중·완료 예약 중 미수납</p>
        </button>
        <button
          type="button"
          className="stat-card stat-link"
          onClick={() =>
            navigate(
              designer ? "appointments" : "inventory",
              designer ? { pending: true } : { stock: "low" },
            )
          }
          aria-label={
            designer ? "지난 미처리 예약 보기" : "보충 필요한 재고만 보기"
          }
        >
          <div className="stat-label">
            {designer ? "확인할 이전 예약" : "보충 필요한 재고"}
            <Icon name="chevron-right" size={15} />
          </div>
          <div className="stat-value">
            {designer ? pending.length : low.length}
            <small>{designer ? "건" : "품목"}</small>
          </div>
          <p className="stat-note">
            {designer
              ? "지난 날짜의 미처리 예약"
              : "입고 기준 이하 · 품절 포함"}
          </p>
        </button>
      </div>
      <div className="dashboard-columns">
        <div className="stack">
          <section className="card">
            <div className="card-header">
              <h2>
                오늘 예약 <Badge>{working.length}건</Badge>
              </h2>
              <Button
                variant="ghost"
                onClick={() =>
                  navigate("appointments", { date, status: "all" })
                }
              >
                전체 일정 →
              </Button>
            </div>
            <div
              className="dashboard-schedule-tabs"
              role="group"
              aria-label="오늘 예약 표시 범위"
            >
              <Button
                variant={scheduleView === "open" ? "primary" : "ghost"}
                aria-pressed={scheduleView === "open"}
                onClick={() => setScheduleView("open")}
              >
                남은 예약 {openAppointments.length}건
              </Button>
              <Button
                variant={scheduleView === "all" ? "primary" : "ghost"}
                aria-pressed={scheduleView === "all"}
                onClick={() => setScheduleView("all")}
              >
                전체 {working.length}건
              </Button>
            </div>
            {scheduleView === "open" && schedule.length > 1 && (
              <p className="help dashboard-sort-note">
                시술 중 → 방문 확인 → 예약 순, 같은 상태는 시간순입니다.
              </p>
            )}
            {schedule.length ? (
              schedule.slice(0, 8).map((a) => {
                const customer = data.customers.find(
                  (c) => c.id === a.customerId,
                );
                return (
                  <div className="timeline-row" key={a.id}>
                    <div className="timeline-time">{timeLabel(a.start)}</div>
                    <div>
                      <strong>
                        {customer?.name || a.guestName || "방문 고객"}{" "}
                        {customer?.warning && (
                          <Badge tone="warning">주의사항</Badge>
                        )}
                        {a.status === "booked" && a.start < minutes && (
                          <Badge tone="warning">방문 확인 필요</Badge>
                        )}
                      </strong>
                      <small>
                        {a.serviceIds
                          .map(
                            (id) =>
                              data.services.find((s) => s.id === id)?.name,
                          )
                          .filter(Boolean)
                          .join(" · ")}{" "}
                        / {data.staff.find((s) => s.id === a.staffId)?.name}
                      </small>
                    </div>
                    <button
                      className="text-btn"
                      aria-label={`${customer?.name || a.guestName || "방문 고객"} ${timeLabel(a.start)} 예약 상세`}
                      onClick={() =>
                        navigate("appointments", { appointmentId: a.id })
                      }
                    >
                      <Badge tone={status[a.status]?.[1]}>
                        {status[a.status]?.[0]}
                      </Badge>
                    </button>
                  </div>
                );
              })
            ) : (
              <EmptyState
                title={
                  working.length
                    ? "오늘 남은 예약을 모두 정리했습니다"
                    : "오늘 예약이 없습니다"
                }
                description={
                  working.length
                    ? "완료된 예약은 전체 목록에서 다시 확인할 수 있습니다."
                    : "새 예약을 등록하거나 날짜를 바꿔 다음 일정을 확인하세요."
                }
                action={
                  canBook ? (
                    <Button
                      onClick={() => navigate("appointments", { create: true })}
                    >
                      예약 등록
                    </Button>
                  ) : null
                }
              />
            )}
            {schedule.length > 8 && (
              <div className="dashboard-more">
                <span className="help">
                  {schedule.length}건 중 8건 표시 ·{" "}
                  {scheduleView === "open"
                    ? "시술 중·방문 고객 우선"
                    : "시간순"}
                </span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    navigate("appointments", { date, status: "all" })
                  }
                >
                  남은 {schedule.length - 8}건 더 보기 →
                </Button>
              </div>
            )}
          </section>
          <section className="quick-grid">
            {[
              ["appointments", "calendar", "새 예약 등록", { create: true }],
              ["customers", "users", "고객 찾아보기", {}],
              ["attendance", "clock", "근태 · 휴가 신청", {}],
              ...(!designer
                ? [
                    [
                      "payments",
                      "credit-card",
                      "방문 고객 수납",
                      { create: true },
                    ],
                    ["inventory", "inventory", "입고·재고 확인", {}],
                  ]
                : [["payroll", "payroll", "내 급여명세 확인", {}]]),
            ].map(([page, icon, label, context]) => (
              <button
                className="quick-action"
                key={page}
                disabled={page === "appointments" && context.create && !canBook}
                onClick={() => navigate(page, context)}
              >
                <Icon name={icon} size={17} />
                {label}
                <Icon name="chevron-right" size={15} className="quick-arrow" />
              </button>
            ))}
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-header">
              <h2>확인할 업무</h2>
            </div>
            <ul className="task-list">
              <li>
                <div>
                  이전 예약 처리
                  <small>지난 날짜에 상태가 완료되지 않은 예약</small>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => navigate("appointments", { pending: true })}
                >
                  {pending.length}건 →
                </Button>
              </li>
              <li>
                <div>
                  수납 확인<small>실제 단말기 결제와 기록 대조</small>
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    navigate(
                      designer ? "appointments" : "payments",
                      designer ? { date, status: "all" } : { pending: true },
                    )
                  }
                >
                  {unpaid.length}건 →
                </Button>
              </li>
              {!designer && (
                <li>
                  <div>
                    입고 확인<small>직원이 입고 수량을 직접 등록</small>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => navigate("inventory", { stock: "low" })}
                  >
                    {low.length}품목 →
                  </Button>
                </li>
              )}
              {operational && (
                <li>
                  <div>
                    급여 확정<small>이번 달 명세와 공제 항목 확인</small>
                  </div>
                  <Button variant="ghost" onClick={() => navigate("payroll")}>
                    급여 →
                  </Button>
                </li>
              )}
            </ul>
          </section>
          <section className="card">
            <div className="card-body">
              <h3>매출 마감</h3>
              <p className="help">
                예약의 방문 상태를 정리하고 단말기 매출과 ERP 수납을 대조하세요.
                환불은 처리한 날짜의 정산에 반영됩니다.
              </p>
              <Button
                variant="ghost"
                onClick={() =>
                  navigate(
                    designer ? "appointments" : "sales",
                    designer
                      ? { date, status: "all" }
                      : { from: date, to: date },
                  )
                }
              >
                {designer ? "내 예약 확인" : "오늘 정산 확인"} →
              </Button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
