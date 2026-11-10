import { TimeInput } from "../components/TimeInput.jsx";
import React, { useEffect, useId, useState } from "react";
import { today } from "../api";
import { Badge, Button, Field, Modal, ConfirmDialog } from "../components/ui";
import { DateInput } from "../components/DateInput.jsx";
import { Icon } from "../components/Icon";
import { useViewState } from "../components/ViewState";
import {
  ANNUAL_TYPES,
  LEAVE_TYPES,
  OVERTIME_TYPES,
  REQUEST_STATUS,
  clockLabel,
  closeDialogFrom,
  halfDayWindow,
  hoursLabel,
  koreanDay,
  leaveAppointments,
  leaveBalance,
  leaveDays,
  monthSummary,
  requestPeriod,
  shiftMonth,
  typeLabel,
  workedMinutes,
} from "../workforce-utils";
import { shiftDate, timeMinutes } from "./operations-utils";
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

const initialOf = (name) => (name || "직").trim().slice(0, 1);
const monthName = (month) => `${Number(month.slice(5, 7))}월`;

export default function Attendance({ data, user, runAction, notify }) {
  const day = today();
  const clock = useSeoulClock();
  const [month, setMonth] = useViewState("attendance", "month", day.slice(0, 7));
  const [form, setForm] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const staff = data.staff.find((row) => row.id === user.staffId);
  const staffName = (id) => data.staff.find((row) => row.id === id)?.name || "직원";
  const attendance = data.attendance || [];
  const requests = data.staffRequests || [];
  const mine = attendance
    .filter((row) => row.staffId === user.staffId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const monthRecords = mine.filter((row) => row.date.startsWith(month));
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
        ["approved", "requested"].includes(row.status) &&
        row.to >= day &&
        row.from <= horizon,
    )
    .sort((a, b) => a.from.localeCompare(b.from));
  const onLeaveToday = (staffId) =>
    requests.find(
      (row) =>
        row.kind === "leave" &&
        row.status === "approved" &&
        row.staffId === staffId &&
        row.from <= day &&
        row.to >= day,
    );
  const myLeave = onLeaveToday(user.staffId);

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
  const working = todayRecord && todayRecord.clockOut == null;
  const status = !todayRecord
    ? myLeave
      ? { label: "휴가", tone: "status-muted" }
      : { label: "출근 전", tone: "status-warn" }
    : working
      ? { label: "근무 중", tone: "status-ok" }
      : { label: "퇴근 완료", tone: "status-muted" };
  const workday =
    staff && staff.workingDays.includes(new Date(`${day}T12:00:00+09:00`).getUTCDay());
  const elapsed = working
    ? workedMinutes({ clockIn: todayRecord.clockIn, clockOut: timeMinutes(clock) }, staff)
    : 0;
  const usedWidth = Math.min(100, (balance.used / Math.max(1, balance.allowance)) * 100);
  const reservedWidth = Math.min(
    100 - usedWidth,
    (balance.reserved / Math.max(1, balance.allowance)) * 100,
  );
  const monthTiles = [
    { label: "출근일", value: `${summary.days}일` },
    { label: "근무 시간", value: hoursLabel(summary.minutes) },
    { label: "지각", value: `${summary.late}회`, warn: summary.late > 0 },
    { label: "퇴근 누락", value: `${summary.open}건`, warn: summary.open > 0 },
    summary.overtime > 0 && { label: "승인된 연장", value: hoursLabel(summary.overtime) },
    summary.leave > 0 && { label: "휴가", value: `${summary.leave}일` },
  ].filter(Boolean);

  return (
    <div className="wf-page">
      <header className="wf-head">
        <div className="wf-head-text">
          <span className="muted">{koreanDay(day, true)}</span>
          <h1 className="page-title">근태와 휴가</h1>
        </div>
        <div className="wf-actions">
          <Button variant="secondary" onClick={() => setForm({ kind: "overtime" })}>
            연장 근무 신청
          </Button>
          <Button variant="primary" onClick={() => setForm({ kind: "leave" })}>
            휴가 신청
          </Button>
        </div>
      </header>
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}

      <div className="wf-tiles">
        <section aria-label="오늘 근태" className="panel wf-tile">
          <span className={`status-pill wf-pill ${status.tone}`}>{status.label}</span>
          <div className="wf-lines">
            {!todayRecord ? (
              <>
                <strong className="wf-big" aria-live="polite">
                  {clock}
                </strong>
                <span className="muted">
                  {workday
                    ? `${clockLabel(staff.startMinutes)}부터 ${clockLabel(staff.endMinutes)}까지 근무`
                    : "오늘은 근무일이 아니에요"}
                </span>
              </>
            ) : working ? (
              <>
                <strong className="wf-big" aria-live="polite">
                  {hoursLabel(elapsed)}
                </strong>
                <span className="muted">{clockLabel(todayRecord.clockIn)} 출근</span>
              </>
            ) : (
              <>
                <strong className="wf-big">
                  {hoursLabel(workedMinutes(todayRecord, staff))}
                </strong>
              </>
            )}
            {myLeave && <span className="muted">오늘은 승인된 {typeLabel(myLeave)}예요</span>}
          </div>
          {!todayRecord ? (
            <Button variant="primary" className="btn-block" busy={busy} onClick={() => punch("in")}>
              출근하기
            </Button>
          ) : working ? (
            <Button variant="primary" className="btn-block" busy={busy} onClick={() => punch("out")}>
              퇴근하기
            </Button>
          ) : (
            <span className="small muted">
              잘못 기록했다면 원장에게 고쳐 달라고 말해 주세요
            </span>
          )}
        </section>

        <section aria-label="연차" className="panel wf-tile">
          <span className="muted">올해 남은 연차</span>
          <strong className="wf-big">{balance.remaining}일</strong>
          <div
            className="wf-meter"
            role="img"
            aria-label={`사용 ${balance.used}일, 승인 대기 ${balance.reserved}일`}
          >
            <span style={{ width: `${usedWidth}%` }} />
            <span className="wf-meter-reserved" style={{ width: `${reservedWidth}%` }} />
          </div>
          <div className="wf-lines">
            <span className="small muted">
              {balance.allowance}일 중 {balance.used}일 사용
            </span>
            {balance.reserved > 0 && (
              <span className="small muted">승인 대기 {balance.reserved}일</span>
            )}
          </div>
        </section>

        <section aria-label="이번 달" className="panel wf-tile wf-tile-tight">
          <div className="wf-tile-head">
            <span className="muted">{monthName(month)} 근무</span>
            <span className="wf-stepper">
              <button
                type="button"
                className="icon-btn"
                aria-label="이전 달"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <Icon name="chevron-left" />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="다음 달"
                disabled={month >= day.slice(0, 7)}
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <Icon name="chevron-right" />
              </button>
            </span>
          </div>
          <div className="wf-mini-grid">
            {monthTiles.map((tile) => (
              <div key={tile.label} className="wf-mini">
                <span>{tile.label}</span>
                <strong className={tile.warn ? "warn" : undefined}>{tile.value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="wf-row-wrap">
        <section aria-labelledby="req-title" className="panel wf-list wf-grow">
          <div className="panel-head">
            <h2 id="req-title">내 신청</h2>
          </div>
          {myRequests.length ? (
            myRequests.map((row) => (
              <div key={row.id} className="wf-item">
                <span className="wf-item-main">
                  <span className="wf-item-title">{typeLabel(row)}</span>
                  <span className="small muted">{requestPeriod(row)}</span>
                  {(row.decisionNote || row.reason) && (
                    <span className="small muted">{row.decisionNote || row.reason}</span>
                  )}
                </span>
                {(row.status === "requested" ||
                  (row.status === "approved" && row.from > day)) && (
                  <Button variant="ghost" onClick={() => setCancel(row)}>
                    신청 취소
                  </Button>
                )}
                <Badge tone={REQUEST_STATUS[row.status].tone}>
                  {REQUEST_STATUS[row.status].label}
                </Badge>
              </div>
            ))
          ) : (
            <p className="wf-empty">
              신청한 내역이 없어요. 휴가나 연장 근무가 필요하면 위에서 신청해 주세요
            </p>
          )}
        </section>
        <section aria-labelledby="leave-title" className="panel wf-list wf-side">
          <div className="panel-head">
            <h2 id="leave-title">팀 휴가 일정</h2>
          </div>
          {teamLeave.length ? (
            teamLeave.map((row) => {
              const name = staffName(row.staffId);
              const period =
                row.from === row.to && row.from === day ? "오늘" : requestPeriod(row);
              return (
                <div key={row.id} className="wf-item">
                  <span className="wf-avatar" aria-hidden="true">
                    {initialOf(name)}
                  </span>
                  <span className="wf-item-main">
                    <span className="wf-item-title">
                      {name} {typeLabel(row)}
                    </span>
                    <span className="small muted">
                      {row.status === "requested" ? `${period} 승인 대기` : period}
                    </span>
                  </span>
                </div>
              );
            })
          ) : (
            <p className="wf-empty">30일 안에 잡힌 휴가가 없어요</p>
          )}
          <span className="small muted">휴가 시간에는 그 디자이너 예약이 막혀요</span>
        </section>
      </div>

      {lead && (
        <section aria-labelledby="team-title" className="panel wf-list">
          <div className="panel-head">
            <h2 id="team-title">오늘 팀 출근</h2>
          </div>
          <div className="wf-team">
            {data.staff
              .filter((row) => row.status === "active")
              .map((row) => {
                const record = attendance.find(
                  (entry) => entry.staffId === row.id && entry.date === day,
                );
                const leave = onLeaveToday(row.id);
                const state = leave
                  ? { label: "휴가", tone: "muted", note: typeLabel(leave) }
                  : record
                    ? record.clockOut == null
                      ? { label: "근무 중", tone: "success", note: `${clockLabel(record.clockIn)} 출근` }
                      : { label: "퇴근", tone: "muted", note: `${clockLabel(record.clockOut)} 퇴근` }
                    : { label: "미출근", tone: "warning", note: "출근 기록 없음" };
                return (
                  <div key={row.id} className="wf-item">
                    <span className="wf-avatar" aria-hidden="true">
                      {initialOf(row.name)}
                    </span>
                    <span className="wf-item-main">
                      <span className="wf-item-title">{row.name}</span>
                      <span className="small muted">{state.note}</span>
                    </span>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      <section aria-labelledby="records-title" className="panel wf-list">
        <div className="panel-head">
          <h2 id="records-title">{monthName(month)} 출퇴근 기록</h2>
        </div>
        {monthRecords.length ? (
          monthRecords.map((row) => (
            <div key={row.id} className="wf-item">
              <span className="wf-item-main">
                <span className="wf-item-title">{koreanDay(row.date, true)}</span>
                <span className="small muted">
                  {row.clockOut != null
                    ? `${clockLabel(row.clockIn)}부터 ${clockLabel(row.clockOut)}까지`
                    : `${clockLabel(row.clockIn)} 출근`}
                </span>
                {row.source === "manual" && <span className="small muted">원장이 고친 기록</span>}
              </span>
              <strong className="num wf-item-value">
                {row.clockOut != null ? hoursLabel(workedMinutes(row, staff)) : "근무 중"}
              </strong>
            </div>
          ))
        ) : (
          <p className="wf-empty">이 달의 출퇴근 기록이 없어요</p>
        )}
      </section>

      {form && (
        <RequestForm
          kind={form.kind}
          day={day}
          data={data}
          staff={staff}
          staffId={user.staffId}
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
          <p className="wf-item-title">{typeLabel(cancel)}</p>
          <p className="muted">{requestPeriod(cancel)}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Single-choice chips (role="radio") with arrow-key movement. */
function ChoiceGroup({ label, options, value, onChange }) {
  const id = useId();
  const keys = Object.keys(options);
  const move = (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = keys[(keys.indexOf(value) + step + keys.length) % keys.length];
    onChange(next);
    event.currentTarget.parentElement
      ?.querySelector(`[data-value="${next}"]`)
      ?.focus();
  };
  return (
    <div className="wf-group">
      <span id={id} className="wf-group-label">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="wf-choices">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            data-value={key}
            aria-checked={value === key}
            tabIndex={value === key ? 0 : -1}
            className="wf-choice"
            onClick={() => onChange(key)}
            onKeyDown={move}
          >
            {options[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

function RequestForm({ kind, day, data, staff, staffId, balance, runAction, close, notify }) {
  const leave = kind === "leave";
  const initial = leave
    ? { type: "annual", from: day, to: day, reason: "" }
    : { type: "overtime", from: day, start: "20:00", end: "21:00", reason: "" };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const half = form.type === "half_am" || form.type === "half_pm";
  const annual = ANNUAL_TYPES.includes(form.type);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const draft = leave
    ? {
        kind,
        staffId,
        type: form.type,
        from: form.from,
        to: half ? form.from : form.to,
        ...(half ? halfDayWindow(staff, form.type) : { start: null, end: null }),
      }
    : null;
  const days = draft && form.from ? leaveDays(data, staff, draft) : 0;
  const conflicts = draft && form.from ? leaveAppointments(data, draft) : [];
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
      title={leave ? "휴가 신청" : "연장 근무 신청"}
      onClose={busy ? undefined : close}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={closeDialogFrom}>
            취소
          </Button>
          <Button form="request-form" type="submit" variant="primary" busy={busy}>
            신청하기
          </Button>
        </>
      }
    >
      <form id="request-form" className="wf-dialog" onSubmit={submit}>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        <ChoiceGroup
          label="종류"
          options={leave ? LEAVE_TYPES : OVERTIME_TYPES}
          value={form.type}
          onChange={(value) => set("type", value)}
        />
        <div className={leave ? "wf-grid-2" : "wf-grid-3"}>
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
                <TimeInput
                  required
                  value={form.start}
                  onChange={(e) => set("start", e.target.value)}
                />
              </Field>
              <Field label="종료 시각" help="자정까지는 23:59로 넣어 주세요">
                <TimeInput
                  required
                  value={form.end}
                  onChange={(e) => set("end", e.target.value)}
                />
              </Field>
            </>
          )}
        </div>
        {leave && (
          <div className="wf-sum">
            {annual ? (
              <>
                <div>
                  <span>쓰는 연차</span>
                  <strong>{days}일</strong>
                </div>
                <div>
                  <span>신청 후 남는 연차</span>
                  <strong>{balance.remaining - days}일</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>쉬는 근무일</span>
                  <strong>{days}일</strong>
                </div>
                <div>
                  <span>남은 연차</span>
                  <strong>{balance.remaining}일</strong>
                </div>
              </>
            )}
          </div>
        )}
        {leave && form.from && days === 0 && (
          <div className="alert alert-warning">고른 기간에 근무일이 없어요</div>
        )}
        {leave && annual && days > balance.remaining && (
          <div className="alert alert-warning">
            남은 연차보다 많아요. 무급 휴가로 신청해 주세요
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="alert alert-warning">
            {draft.from === draft.to ? "이날" : "이 기간에"} 내 예약이 {conflicts.length}건
            있어요
          </div>
        )}
        {half && (
          <span className="small muted">반차 시간은 내 근무시간과 휴게시간으로 정해져요</span>
        )}
        <Field label={leave ? "사유" : "업무 내용"}>
          <textarea
            rows={3}
            maxLength={500}
            required={!leave}
            placeholder={leave ? "선택" : undefined}
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
