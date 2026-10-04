import React from "react";
import { today, timeLabel } from "../api";
import { Badge, Button, EmptyState, Money } from "../components/ui";
import { useViewState } from "../components/ViewState";
export default function Dashboard({ data, user, navigate }) {
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
  const status = {
    booked: ["예약", "muted"],
    checked_in: ["방문", "warning"],
    in_service: ["시술 중", "success"],
    completed: ["완료", "muted"],
    cancelled: ["취소", "danger"],
    no_show: ["미방문", "danger"],
  };
  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">TODAY AT YOUR SALON</div>
          <h1 className="page-title">{user.name}님, 오늘도 반갑습니다</h1>
          <p className="page-description">
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date())}{" "}
            · {data.store.name}의 하루를 확인하세요.
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate("customers", { create: true })}>
            고객 등록
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate("appointments", { create: true })}
          >
            ＋ 예약 등록
          </Button>
        </div>
      </div>
      {setup && (
        <div className="welcome-card">
          <div>
            <h2>우리 매장에 맞게 준비해 보세요</h2>
            <p>시술 메뉴와 직원을 등록하면 예약부터 수납까지 연결됩니다.</p>
          </div>
          <Button onClick={() => navigate("settings", { tab: "services" })}>
            시술 메뉴 등록
          </Button>
        </div>
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
            <span>↗</span>
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
            오늘 예약<span>▦</span>
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
            수납 확인 필요<span>₩</span>
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
            <span>◌</span>
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
                오늘의 예약 흐름 <Badge>{working.length}건</Badge>
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
                  <Button
                    onClick={() => navigate("appointments", { create: true })}
                  >
                    예약 등록
                  </Button>
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
              ["appointments", "▦", "새 예약 등록", { create: true }],
              ["customers", "◎", "고객 찾아보기", {}],
              ...(!designer
                ? [
                    ["payments", "₩", "방문 고객 수납", { create: true }],
                    ["inventory", "▤", "입고·재고 확인", {}],
                  ]
                : [["payroll", "▧", "내 급여명세 확인", {}]]),
            ].map(([page, icon, label, context]) => (
              <button
                className="quick-action"
                key={page}
                onClick={() => navigate(page, context)}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
                <span style={{ marginLeft: "auto", fontSize: 15 }}>↗</span>
              </button>
            ))}
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <div className="card-header">
              <h2>놓치지 말아야 할 일</h2>
              <Badge tone="warning">확인</Badge>
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
              <div className="eyebrow">DAILY CHECK</div>
              <h3>마감 전, 한 번 더 확인하세요</h3>
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
