import React, { useEffect, useState } from "react";
import { today } from "../api";
import { Badge, Button, EmptyState, Field, Modal, ConfirmDialog } from "../components/ui";
import { DateInput } from "../components/DateInput.jsx";
import { Icon } from "../components/Icon";
import { useViewState } from "../components/ViewState";
import {
  LEAVE_TYPES,
  OVERTIME_TYPES,
  REQUEST_STATUS,
  clockLabel,
  hoursLabel,
  leaveBalance,
  monthSummary,
  periodLabel,
  typeLabel,
  workedMinutes,
} from "../workforce-utils";
import { dateLabel, shiftDate, timeMinutes } from "./operations-utils";
import "./Workforce.css";

function useSeoulClock() {
  const read = () =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
  const [value, setValue] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setValue(read()), 15000);
    return () => clearInterval(timer);
  }, []);
  return value;
}

export default function Attendance({ data, user, runAction, notify }) {
  const day = today();
  const clock = useSeoulClock();
  const [month, setMonth] = useViewState("attendance", "month", day.slice(0, 7));
  const [form, setForm] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const staff = data.staff.find((row) => row.id === user.staffId);
  const attendance = data.attendance || [];
  const requests = data.staffRequests || [];
  const mine = attendance
    .filter((row) => row.staffId === user.staffId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const todayRecord = mine.find((row) => row.date === day);
  const myRequests = requests
    .filter((row) => row.staffId === user.staffId)
    .sort((a, b) => b.createdAt?.localeCompare?.(a.createdAt) || 0);
  const summary = monthSummary(data, user.staffId, month);
  const balance = leaveBalance(data, user.staffId, Number(day.slice(0, 4)));
  const lead = ["owner", "manager"].includes(user.role);
  const horizon = shiftDate(day, 30);
  const teamLeave = requests
    .filter(
      (row) =>
        row.kind === "leave" &&
        row.status === "approved" &&
        row.to >= day &&
        row.from <= horizon,
    )
    .sort((a, b) => a.from.localeCompare(b.from));
  const onLeaveToday = (staffId) =>
    teamLeave.find(
      (row) => row.staffId === staffId && row.from <= day && row.to >= day,
    );

  const punch = async (kind) => {
    setBusy(true);
    setError("");
    try {
      await runAction("attendance.clock", { kind });
      notify(kind === "in" ? "출근을 기록했습니다." : "퇴근을 기록했습니다.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const status = !todayRecord
    ? { label: "출근 전", tone: "muted" }
    : todayRecord.clockOut == null
      ? { label: "근무 중", tone: "success" }
      : { label: "퇴근 완료", tone: "muted" };
  const scheduled =
    staff && staff.workingDays.includes(new Date(`${day}T12:00:00+09:00`).getUTCDay())
      ? `${clockLabel(staff.startMinutes)}–${clockLabel(staff.endMinutes)}`
      : "오늘은 근무일이 아닙니다";

  return (
    <div className="workforce-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">근태 · 휴가</h1>
          <p className="page-description">
            출퇴근을 기록하고 휴가·연장 근무를 신청합니다. 승인은 원장 관리의
            인사 · 근태에서 처리합니다.
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => setForm({ kind: "overtime" })}>
            연장·휴일 근무 신청
          </Button>
          <Button variant="primary" onClick={() => setForm({ kind: "leave" })}>
            <Icon name="plus" size={15} /> 휴가 신청
          </Button>
        </div>
      </div>
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}
      <div className="workforce-top">
        <section className="card clock-card" aria-labelledby="clock-title">
          <div className="card-body">
            <div className="clock-head">
              <div>
                <h2 id="clock-title">오늘 근태</h2>
                <p className="muted">
                  {dateLabel(day)} · 근무 예정 {scheduled}
                </p>
              </div>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="clock-now" aria-live="polite">
              {clock}
            </p>
            <dl className="clock-times">
              <div>
                <dt>출근</dt>
                <dd>{clockLabel(todayRecord?.clockIn)}</dd>
              </div>
              <div>
                <dt>퇴근</dt>
                <dd>{clockLabel(todayRecord?.clockOut)}</dd>
              </div>
              <div>
                <dt>근무</dt>
                <dd>
                  {todayRecord?.clockOut != null
                    ? hoursLabel(workedMinutes(todayRecord, staff))
                    : "—"}
                </dd>
              </div>
            </dl>
            {onLeaveToday(user.staffId) && (
              <p className="help">
                오늘은 승인된 {typeLabel(onLeaveToday(user.staffId))}입니다.
              </p>
            )}
            {!todayRecord ? (
              <Button
                variant="primary"
                className="btn-block"
                busy={busy}
                onClick={() => punch("in")}
              >
                출근하기
              </Button>
            ) : todayRecord.clockOut == null ? (
              <Button
                variant="primary"
                className="btn-block"
                busy={busy}
                onClick={() => punch("out")}
              >
                퇴근하기
              </Button>
            ) : (
              <p className="help">
                오늘 기록을 마쳤습니다. 잘못 기록했다면 원장에게 정정을
                요청해 주세요.
              </p>
            )}
          </div>
        </section>
        <section className="card" aria-labelledby="balance-title">
          <div className="card-body">
            <h2 id="balance-title">{day.slice(0, 4)}년 연차</h2>
            <div className="balance-meter">
              <strong>{balance.remaining}</strong>
              <span>일 남음 / 총 {balance.allowance}일</span>
            </div>
            <div
              className="meter"
              role="img"
              aria-label={`사용 ${balance.used}일, 승인 대기 ${balance.reserved}일`}
            >
              <span
                className="meter-used"
                style={{
                  width: `${Math.min(100, (balance.used / Math.max(1, balance.allowance)) * 100)}%`,
                }}
              />
              <span
                className="meter-reserved"
                style={{
                  width: `${Math.min(100, (balance.reserved / Math.max(1, balance.allowance)) * 100)}%`,
                }}
              />
            </div>
            <p className="help">
              사용 {balance.used}일 · 승인 대기 {balance.reserved}일. 연간 연차
              일수는 원장이 직원 정보에서 설정합니다.
            </p>
          </div>
        </section>
        <section className="card" aria-labelledby="month-title">
          <div className="card-body">
            <div className="clock-head">
              <h2 id="month-title">월간 요약</h2>
              <DateInput
                className="input input-compact"
                type="month"
                aria-label="조회 월"
                value={month}
                max={day.slice(0, 7)}
                onChange={(event) => event.target.value && setMonth(event.target.value)}
              />
            </div>
            <dl className="summary-grid">
              <div>
                <dt>출근일</dt>
                <dd>{summary.days}일</dd>
              </div>
              <div>
                <dt>근무시간</dt>
                <dd>{hoursLabel(summary.minutes)}</dd>
              </div>
              <div>
                <dt>지각</dt>
                <dd>{summary.late}회</dd>
              </div>
              <div>
                <dt>승인된 연장</dt>
                <dd>{hoursLabel(summary.overtime)}</dd>
              </div>
              <div>
                <dt>휴가</dt>
                <dd>{summary.leave}일</dd>
              </div>
              <div>
                <dt>퇴근 누락</dt>
                <dd>{summary.open}건</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {lead && (
        <section className="card">
          <div className="card-header">
            <h2>오늘 팀 출근 현황</h2>
          </div>
          <div className="card-body">
            <ul className="team-status">
              {data.staff
                .filter((row) => row.status === "active")
                .map((row) => {
                  const record = attendance.find(
                    (entry) => entry.staffId === row.id && entry.date === day,
                  );
                  const leave = onLeaveToday(row.id);
                  return (
                    <li key={row.id}>
                      <strong>{row.name}</strong>
                      <span>
                        {leave
                          ? typeLabel(leave)
                          : record
                            ? `${clockLabel(record.clockIn)} 출근${record.clockOut != null ? ` · ${clockLabel(record.clockOut)} 퇴근` : ""}`
                            : "미출근"}
                      </span>
                      <Badge
                        tone={
                          leave
                            ? "muted"
                            : record
                              ? record.clockOut == null
                                ? "success"
                                : "muted"
                              : "warning"
                        }
                      >
                        {leave ? "휴가" : record ? (record.clockOut == null ? "근무 중" : "퇴근") : "미출근"}
                      </Badge>
                    </li>
                  );
                })}
            </ul>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>내 신청 내역</h2>
        </div>
        <div className="card-body">
          {myRequests.length ? (
            <div className="table-wrap">
              <table className="table commerce-table commerce-mobile-cards">
                <thead>
                  <tr>
                    <th>종류</th>
                    <th>기간</th>
                    <th>사용</th>
                    <th>상태</th>
                    <th>처리 메모</th>
                    <th aria-label="작업" />
                  </tr>
                </thead>
                <tbody>
                  {myRequests.map((row) => (
                    <tr key={row.id}>
                      <td data-label="종류">{typeLabel(row)}</td>
                      <td data-label="기간">{periodLabel(row)}</td>
                      <td data-label="사용">
                        {row.kind === "leave" ? `${row.days}일` : hoursLabel(row.minutes)}
                      </td>
                      <td data-label="상태">
                        <Badge tone={REQUEST_STATUS[row.status].tone}>
                          {REQUEST_STATUS[row.status].label}
                        </Badge>
                      </td>
                      <td data-label="처리 메모">{row.decisionNote || row.reason || "—"}</td>
                      <td>
                        {(row.status === "requested" ||
                          (row.status === "approved" && row.from > day)) && (
                          <Button variant="ghost" onClick={() => setCancel(row)}>
                            신청 취소
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="신청 내역이 없습니다"
              description="휴가나 연장·휴일 근무가 필요하면 위의 신청 버튼을 눌러 주세요."
            />
          )}
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-header">
            <h2>팀 휴가 일정 (30일)</h2>
          </div>
          <div className="card-body">
            {teamLeave.length ? (
              <ul className="leave-list">
                {teamLeave.map((row) => (
                  <li key={row.id}>
                    <strong>
                      {data.staff.find((s) => s.id === row.staffId)?.name || "직원"}
                    </strong>
                    <span>{typeLabel(row)}</span>
                    <span className="muted">{periodLabel(row)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">예정된 휴가가 없습니다.</p>
            )}
            <p className="help">승인된 휴가 시간에는 해당 직원에게 예약을 잡을 수 없습니다.</p>
          </div>
        </section>
        <section className="card">
          <div className="card-header">
            <h2>{month.replace("-", "년 ")}월 출퇴근 기록</h2>
          </div>
          <div className="card-body">
            {mine.filter((row) => row.date.startsWith(month)).length ? (
              <div className="table-wrap">
                <table className="table commerce-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>출근</th>
                      <th>퇴근</th>
                      <th className="numeric">근무</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mine
                      .filter((row) => row.date.startsWith(month))
                      .map((row) => (
                        <tr key={row.id}>
                          <td>
                            {dateLabel(row.date)}
                            {row.source === "manual" && (
                              <span className="help"> · 정정됨</span>
                            )}
                          </td>
                          <td>{clockLabel(row.clockIn)}</td>
                          <td>{clockLabel(row.clockOut)}</td>
                          <td className="numeric">
                            {row.clockOut != null
                              ? hoursLabel(workedMinutes(row, staff))
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">이 달의 출퇴근 기록이 없습니다.</p>
            )}
          </div>
        </section>
      </div>

      {form && (
        <RequestForm
          kind={form.kind}
          day={day}
          balance={balance}
          runAction={runAction}
          close={() => setForm(null)}
          notify={notify}
        />
      )}
      {cancel && (
        <ConfirmDialog
          title="신청을 취소할까요?"
          confirmLabel="신청 취소"
          variant="danger"
          busy={busy}
          onClose={() => setCancel(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await runAction("request.cancel", { id: cancel.id });
              notify("신청을 취소했습니다.");
              setCancel(null);
            } catch (err) {
              setError(err.message);
              setCancel(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          {typeLabel(cancel)} · {periodLabel(cancel)}
        </ConfirmDialog>
      )}
    </div>
  );
}

function RequestForm({ kind, day, balance, runAction, close, notify }) {
  const leave = kind === "leave";
  const initial = leave
    ? { type: "annual", from: day, to: day, reason: "" }
    : { type: "overtime", from: day, start: "20:00", end: "21:00", reason: "" };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const half = form.type === "half_am" || form.type === "half_pm";
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await runAction(
        "request.create",
        leave
          ? {
              kind,
              type: form.type,
              from: form.from,
              to: half ? form.from : form.to,
              reason: form.reason,
            }
          : {
              kind,
              type: form.type,
              from: form.from,
              start: timeMinutes(form.start),
              end: form.end === "24:00" ? 1440 : timeMinutes(form.end),
              reason: form.reason,
            },
      );
      notify("신청했습니다. 원장 승인 후 확정됩니다.");
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={leave ? "휴가 신청" : "연장·야간·휴일 근무 신청"}
      onClose={busy ? undefined : close}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
      footer={
        <Button form="request-form" type="submit" variant="primary" busy={busy}>
          신청하기
        </Button>
      }
    >
      <form id="request-form" className="stack" onSubmit={submit}>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        <Field label="종류">
          <select value={form.type} onChange={(e) => set("type", e.target.value)}>
            {Object.entries(leave ? LEAVE_TYPES : OVERTIME_TYPES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {leave && ["annual", "half_am", "half_pm"].includes(form.type) && (
          <p className="help">남은 연차 {balance.remaining}일 (승인 대기 포함)</p>
        )}
        <div className="grid grid-2">
          <Field label={leave && !half ? "시작일" : "날짜"}>
            <DateInput
              className="input"
              type="date"
              required
              value={form.from}
              onChange={(e) => {
                const value = e.target.value;
                setForm((current) => ({
                  ...current,
                  from: value,
                  to: current.to && current.to < value ? value : current.to,
                }));
              }}
            />
          </Field>
          {leave && !half && (
            <Field label="종료일">
              <DateInput
                className="input"
                type="date"
                required
                min={form.from}
                value={form.to}
                onChange={(e) => set("to", e.target.value)}
              />
            </Field>
          )}
          {!leave && (
            <>
              <Field label="시작 시각">
                <input
                  type="time"
                  required
                  value={form.start}
                  onChange={(e) => set("start", e.target.value)}
                />
              </Field>
              <Field label="종료 시각" help="자정까지는 23:59로 입력하세요.">
                <input
                  type="time"
                  required
                  value={form.end}
                  onChange={(e) => set("end", e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
        {half && (
          <p className="help">
            반차 시간은 근무시간과 휴게시간을 기준으로 자동 계산합니다.
          </p>
        )}
        <Field label={leave ? "사유 (선택)" : "업무 내용"}>
          <textarea
            rows={3}
            maxLength={500}
            required={!leave}
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
