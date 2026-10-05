import React from "react";
import { today, timeLabel } from "../api";
import { Badge, Button, EmptyState } from "./ui";
import { Icon } from "./Icon";
import { STATUS, dateLabel } from "../pages/operations-utils";
import "./SharedDesk.css";

const TASKS = [
  { page: "appointments", icon: "calendar", label: "예약 일정", description: "예약 등록 · 방문 확인" },
  { page: "customers", icon: "users", label: "고객 관리", description: "고객 조회 · 상담 기록" },
  { page: "payments", icon: "credit-card", label: "수납 · 환불", description: "결제 결과 기록 · 환불" },
  { page: "inventory", icon: "inventory", label: "재고 · 입고", description: "재고 확인 · 입고 입력" },
];

export function SharedDesk({ data, onLogin, onOwner }) {
  const currentDate = today();
  const appointments = (data?.appointments || [])
    .filter((item) => item.date === currentDate)
    .slice()
    .sort((a, b) => a.start - b.start);
  const staff = new Map((data?.staff || []).map((item) => [item.id, item.name]));
  const services = new Map((data?.services || []).map((item) => [item.id, item.name]));
  const storeName = data?.store?.name || "우리 매장";

  return (
    <div className="shared-desk">
      <header className="shared-desk-header">
        <div className="brand">
          <span className="brand-mark"><Icon name="workspace" /></span>
          <span>살롱 데스크<small>{storeName}</small></span>
        </div>
        <span className="shared-desk-status"><Icon name="lock" size={15} />공용 화면</span>
      </header>
      <main className="shared-desk-main">
        <section className="shared-desk-intro" aria-labelledby="shared-desk-title">
          <div>
            <p className="shared-desk-date">{dateLabel(currentDate)}</p>
            <h1 id="shared-desk-title">공용 업무</h1>
            <p>업무를 시작할 때 본인 계정으로 로그인해 주세요.</p>
          </div>
          <Button variant="primary" onClick={() => onLogin("dashboard")}>
            작업자 로그인<Icon name="arrow-right" size={16} />
          </Button>
        </section>

        <nav className="shared-desk-tasks" aria-label="업무 시작">
          {TASKS.map((task) => (
            <button key={task.page} className="shared-desk-task" onClick={() => onLogin(task.page)}>
              <Icon name={task.icon} size={22} />
              <span><strong>{task.label}</strong><small>{task.description}</small></span>
              <Icon name="chevron-right" size={17} />
            </button>
          ))}
        </nav>

        <div className="shared-desk-columns">
          <section className="card shared-desk-agenda" aria-labelledby="shared-agenda-title">
            <div className="shared-desk-card-heading">
              <div>
                <h2 id="shared-agenda-title">오늘 예약 현황</h2>
                <p>고객 이름과 연락처는 로그인 후 확인할 수 있습니다.</p>
              </div>
              <span className="shared-desk-count">{appointments.length}건</span>
            </div>
            {appointments.length ? (
              <ul className="shared-desk-appointments">
                {appointments.map((appointment) => {
                  const status = STATUS[appointment.status] || { label: "확인 필요", tone: "muted" };
                  return (
                    <li key={appointment.id}>
                      <div className="shared-desk-time">
                        <strong>{timeLabel(appointment.start)}</strong>
                        <span>{timeLabel(appointment.start + appointment.duration)}</span>
                      </div>
                      <div className="shared-desk-appointment-info">
                        <strong>{staff.get(appointment.staffId) || "담당 직원 미지정"}</strong>
                        <span>{(appointment.serviceIds || []).map((id) => services.get(id) || "시술").join(" · ") || "시술 미지정"}</span>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="오늘 등록된 예약이 없습니다" description="예약 등록은 작업자 로그인 후 이용해 주세요." />
            )}
            <div className="shared-desk-agenda-footer">
              <Button variant="ghost" onClick={() => onLogin("appointments", { date: currentDate })}>
                로그인하고 예약 관리<Icon name="arrow-right" size={16} />
              </Button>
            </div>
          </section>

          <aside className="shared-desk-protected" aria-labelledby="shared-private-title">
            <section className="card shared-desk-private-card">
              <Icon name="lock" size={22} />
              <h2 id="shared-private-title">원장 관리</h2>
              <p>직원 급여와 로그인 계정, 권한 설정은 원장 인증 후 열립니다.</p>
              <Button onClick={() => onOwner("staff")}>
                원장 인증하고 관리<Icon name="arrow-right" size={16} />
              </Button>
            </section>
            <div className="shared-desk-guidance">
              <h3>함께 쓰는 PC의 사용 방법</h3>
              <ol>
                <li>본인 계정으로 업무를 시작합니다.</li>
                <li>자리 비움 시 공용 화면으로 전환합니다.</li>
                <li>내 급여명세는 로그인 후 본인 인증으로 확인합니다.</li>
              </ol>
              <p>시술 담당자와 별도로, 변경한 작업자가 기록됩니다.</p>
            </div>
          </aside>
        </div>
      </main>
      <footer className="shared-desk-footer">
        <span>© {new Date().getFullYear()} {storeName}</span>
        <span>살롱 데스크 v2.0 · 매장 내부 업무용 · 한국 표준시 (KST)</span>
      </footer>
    </div>
  );
}
