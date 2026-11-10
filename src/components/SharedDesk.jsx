import React from "react";
import { today, timeLabel } from "../api";
import { Button } from "./ui";
import { STATUS, dateLabel } from "../pages/operations-utils";
import "./SharedDesk.css";

const TONE = {
  booked: "muted",
  checked_in: "warn",
  in_service: "ok",
  completed: "muted",
  no_show: "danger",
};

export function SharedDesk({ data, onLogin, onOwner }) {
  const currentDate = today();
  const appointments = (data?.appointments || [])
    .filter((item) => item.date === currentDate && item.status !== "cancelled")
    .slice()
    .sort((a, b) => a.start - b.start);
  const staff = new Map((data?.staff || []).map((item) => [item.id, item.name]));
  const services = new Map((data?.services || []).map((item) => [item.id, item.name]));
  const storeName = data?.store?.name || "살롱 데스크";

  return (
    <div className="shared-desk">
      <header className="shared-desk-header">
        <span className="shared-desk-brand">
          <span className="brand-dot" aria-hidden="true" />
          <strong>{storeName}</strong>
        </span>
        <span className="shared-desk-status">공용 화면</span>
      </header>
      <div className="shared-desk-body">
        <main className="shared-desk-main" aria-labelledby="shared-desk-title">
          <header className="shared-desk-intro">
            <span className="muted">{dateLabel(currentDate)}</span>
            <h1 id="shared-desk-title">오늘 예약</h1>
            <p>손님 이름은 로그인한 뒤에 보여요</p>
          </header>
          {appointments.length ? (
            <ul className="shared-desk-cards" aria-label={`오늘 예약 ${appointments.length}건`}>
              {appointments.map((appointment) => {
                const status = STATUS[appointment.status] || { label: "확인 필요" };
                return (
                  <li key={appointment.id} className="shared-desk-card">
                    <div className="shared-desk-time">
                      <strong>{timeLabel(appointment.start)}</strong>
                      <span className={`status-pill status-${TONE[appointment.status] || "muted"}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="shared-desk-card-info">
                      <strong>
                        {(appointment.serviceIds || []).map((id) => services.get(id) || "시술").join(", ") || "시술 미지정"}
                      </strong>
                      <span>{staff.get(appointment.staffId) || "담당 미지정"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="shared-desk-empty">
              <strong>오늘 등록된 예약이 없어요</strong>
              <span>예약은 로그인한 뒤에 등록할 수 있어요</span>
            </div>
          )}
        </main>
        <aside className="shared-desk-login" aria-labelledby="shared-login-title">
          <div className="shared-desk-login-head">
            <h2 id="shared-login-title">업무 시작</h2>
            <span>기록에 내 이름이 남아요</span>
          </div>
          <Button variant="primary" onClick={() => onLogin("dashboard")}>
            작업자 로그인
          </Button>
          <Button variant="secondary" onClick={() => onOwner("staff")}>
            원장 관리 열기
          </Button>
          <div className="shared-desk-help">
            <span>자리를 비울 때는 공용 화면으로 돌아와 주세요</span>
            <span className="muted">내 급여명세는 로그인한 뒤 본인 인증으로 열어요</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
