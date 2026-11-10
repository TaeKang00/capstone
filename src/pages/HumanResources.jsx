import { TimeInput } from "../components/TimeInput.jsx";
import React, { useId, useRef, useState } from "react";
import { roleLabel, today, won } from "../api";
import { Badge, Button, ConfirmDialog, Field, Modal } from "../components/ui";
import { DateInput } from "../components/DateInput.jsx";
import { Icon } from "../components/Icon";
import { useViewState } from "../components/ViewState";
import { escapeHtml, logoTag, printDocument } from "../print";
import {
  ANNUAL_TYPES,
  REQUEST_STATUS,
  clockLabel,
  hoursLabel,
  josa,
  koreanDay,
  koreanDayShort,
  leaveAppointments,
  leaveBalance,
  monthSummary,
  closeDialogFrom,
  requestPeriod,
  severanceEstimate,
  shiftMonth,
  typeLabel,
  workedMinutes,
} from "../workforce-utils";
import { timeMinutes, timestampLabel } from "./operations-utils";
import "./Workforce.css";

const TABS = [
  ["requests", "신청 승인"],
  ["attendance", "출퇴근 기록"],
  ["leave", "연차 현황"],
  ["organization", "인사 이력"],
  ["certificates", "증명서 발급"],
  ["severance", "퇴직금 추정"],
];
const CERTIFICATE_TYPES = { employment: "재직증명서", career: "경력증명서" };
const koreanDate = (value) =>
  value
    ? `${value.slice(0, 4)}년 ${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`
    : "";
const staffName = (data, id) =>
  data.staff.find((row) => row.id === id)?.name || "퇴사하거나 지정되지 않은 직원";
const initialOf = (name) => (name || "직").trim().slice(0, 1);
const toMinutes = (value) =>
  /^\d{1,2}:\d{2}$/.test(value || "") ? timeMinutes(value) : null;
const corrected = (row) =>
  row.source === "manual" || (row.changes || []).some((c) => c.kind === "corrected");
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export default function HumanResources({ data, runAction, notify, navigate, routeContext }) {
  const [tab, setTab] = useViewState(
    "hr",
    "tab",
    TABS.some(([id]) => id === routeContext?.tab) ? routeContext.tab : "requests",
  );
  const pending = (data.staffRequests || []).filter(
    (row) => row.status === "requested",
  ).length;
  return (
    <div className="wf-page">
      <div className="wf-head-stack">
        <h1 className="page-title">근태와 휴가</h1>
        <nav className="chip-row wf-tabs" aria-label="근태와 휴가 메뉴">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={tab === id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
              {id === "requests" && pending > 0 && (
                <span className="wf-warn-text small wf-count">{pending}</span>
              )}
            </button>
          ))}
        </nav>
      </div>
      {tab === "requests" && (
        <Requests
          data={data}
          runAction={runAction}
          notify={notify}
          navigate={navigate}
          openRecords={() => setTab("attendance")}
        />
      )}
      {tab === "attendance" && (
        <AttendanceRecords data={data} runAction={runAction} notify={notify} />
      )}
      {tab === "leave" && <LeaveOverview data={data} />}
      {tab === "organization" && <Organization data={data} />}
      {tab === "certificates" && (
        <Certificates data={data} runAction={runAction} notify={notify} />
      )}
      {tab === "severance" && <Severance data={data} />}
    </div>
  );
}

function Requests({ data, runAction, notify, navigate, openRecords }) {
  const [filter, setFilter] = useViewState("hr", "requestFilter", "approved");
  const [decision, setDecision] = useState(null);
  const month = today().slice(0, 7);
  const requests = data.staffRequests || [];
  const queue = requests
    .filter((row) => row.status === "requested")
    .sort((a, b) => a.from.localeCompare(b.from));
  const history = requests
    .filter((row) =>
      filter === "all" ? row.status !== "requested" : row.status === filter,
    )
    .sort((a, b) => b.from.localeCompare(a.from));
  const people = data.staff
    .filter((row) => row.status === "active")
    .map((row) => ({ row, summary: monthSummary(data, row.id, month) }));
  const most = Math.max(1, ...people.map(({ summary }) => summary.minutes));
  const note = (summary) =>
    summary.open
      ? { text: `퇴근 누락 ${summary.open}건`, warn: true }
      : summary.late
        ? { text: `지각 ${summary.late}회`, warn: true }
        : summary.leave
          ? { text: `휴가 ${summary.leave}일` }
          : { text: `출근 ${summary.days}일` };
  return (
    <>
      <div className="wf-columns">
        <section aria-labelledby="queue-title" className="wf-queue">
          <h2 id="queue-title" className="wf-section-title">
            승인 대기 {queue.length}건
          </h2>
          {queue.length ? (
            queue.map((row) => {
              const name = staffName(data, row.staffId);
              const balance =
                row.kind === "leave" &&
                ANNUAL_TYPES.includes(row.type) &&
                leaveBalance(data, row.staffId, Number(row.from.slice(0, 4)));
              const conflicts = leaveAppointments(data, row);
              const meta = balance
                ? `남은 연차 ${balance.remaining}일`
                : row.kind === "overtime"
                  ? row.reason
                  : "";
              return (
                <article key={row.id} className="panel">
                  <div className="wf-card-top">
                    <span className="wf-avatar wf-avatar-lg" aria-hidden="true">
                      {initialOf(name)}
                    </span>
                    <span className="wf-item-main">
                      <strong className="wf-card-title">
                        {name} {typeLabel(row)}
                      </strong>
                      <span className="muted">{requestPeriod(row, true)}</span>
                      {row.kind === "leave" && row.days > 1 && (
                        <span className="small muted">근무일 {row.days}일</span>
                      )}
                      {row.kind === "leave" && row.reason && (
                        <span className="small muted">{row.reason}</span>
                      )}
                    </span>
                    {meta && <span className="wf-card-meta">{meta}</span>}
                  </div>
                  {conflicts.length > 0 && (
                    <div className="wf-conflict">
                      <span>
                        {row.from === row.to ? "이날" : "이 기간"} 예약 {conflicts.length}건을
                        먼저 옮겨야 해요
                      </span>
                      {navigate && (
                        <button
                          type="button"
                          className="wf-link"
                          onClick={() =>
                            navigate("appointments", { appointmentId: conflicts[0].id })
                          }
                        >
                          예약 보기
                        </button>
                      )}
                    </div>
                  )}
                  <div className="wf-card-actions">
                    <Button
                      variant="danger"
                      onClick={() => setDecision({ row, decision: "rejected" })}
                    >
                      반려
                    </Button>
                    <Button
                      variant="primary"
                      disabled={conflicts.length > 0}
                      onClick={() => setDecision({ row, decision: "approved" })}
                    >
                      승인
                    </Button>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="wf-empty">승인을 기다리는 신청이 없어요</p>
          )}
          <span className="small muted">
            휴가를 승인하면 그 시간에는 예약을 받을 수 없어요
          </span>
        </section>

        <section aria-labelledby="month-title" className="panel wf-hours">
          <div className="panel-head">
            <h2 id="month-title">{Number(month.slice(5, 7))}월 근무 시간</h2>
            <button type="button" className="btn btn-ghost" onClick={openRecords}>
              기록 고치기
            </button>
          </div>
          <div className="wf-people">
            {people.map(({ row, summary }) => {
              const line = note(summary);
              return (
                <div key={row.id} className="wf-person">
                  <div className="wf-person-top">
                    <span>{row.name}</span>
                    <span className="num">{hoursLabel(summary.minutes)}</span>
                  </div>
                  <div className="wf-bar" aria-hidden="true">
                    <span style={{ width: `${(summary.minutes / most) * 100}%` }} />
                  </div>
                  <span className={`small ${line.warn ? "wf-warn-text" : "muted"}`}>
                    {line.text}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section aria-labelledby="history-title" className="panel wf-list">
        <div className="panel-head">
          <h2 id="history-title">처리한 신청</h2>
          <div className="seg" role="group" aria-label="처리 상태">
            {[
              ["approved", "승인 완료"],
              ["rejected", "반려"],
              ["cancelled", "취소"],
              ["all", "전체"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {history.length ? (
          history.map((row) => (
            <div key={row.id} className="wf-item">
              <span className="wf-item-main">
                <span className="wf-item-title">
                  {staffName(data, row.staffId)} {typeLabel(row)}
                </span>
                <span className="small muted">{requestPeriod(row)}</span>
                {row.decisionNote && (
                  <span className="small muted">{row.decisionNote}</span>
                )}
              </span>
              {row.status === "approved" && (
                <Button
                  variant="ghost"
                  onClick={() => setDecision({ row, decision: "cancelled" })}
                >
                  승인 취소
                </Button>
              )}
              <Badge tone={REQUEST_STATUS[row.status].tone}>
                {REQUEST_STATUS[row.status].label}
              </Badge>
            </div>
          ))
        ) : (
          <p className="wf-empty">해당하는 신청이 없어요</p>
        )}
      </section>
      {decision &&
        (decision.decision === "cancelled" ? (
          <CancelApprovalDialog
            row={decision.row}
            data={data}
            runAction={runAction}
            notify={notify}
            close={() => setDecision(null)}
          />
        ) : (
          <DecisionDialog
            row={decision.row}
            data={data}
            runAction={runAction}
            notify={notify}
            navigate={navigate}
            close={() => setDecision(null)}
          />
        ))}
    </>
  );
}

const appointmentLine = (appointment, data) => {
  const customer =
    (data.customers || []).find((item) => item.id === appointment.customerId)?.name ||
    appointment.guestName ||
    "이름 없는 고객";
  const services = (appointment.serviceIds || [])
    .map((id) => (data.services || []).find((item) => item.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  return `${clockLabel(appointment.start)} ${customer} 님${services ? ` ${services}` : ""}`;
};

/** One dialog for a pending request: 반려 and 승인 side by side (LeaveDecision board). */
function DecisionDialog({ row, data, runAction, notify, navigate, close }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [noteError, setNoteError] = useState("");
  const noteRef = useRef(null);
  const noteId = useId();
  const staff = data.staff.find((item) => item.id === row.staffId);
  const name = staffName(data, row.staffId);
  const leave = row.kind === "leave";
  const annual = leave && ANNUAL_TYPES.includes(row.type);
  const balance = leave && leaveBalance(data, row.staffId, Number(row.from.slice(0, 4)));
  const conflicts = leaveAppointments(data, row);
  const labels = { approved: "승인", rejected: "반려" };
  const decide = async (decision) => {
    if (decision === "rejected" && !note.trim()) {
      setNoteError("반려 사유를 적어 주세요");
      noteRef.current?.focus();
      return;
    }
    setBusy(decision);
    setError("");
    try {
      await runAction("request.decide", { id: row.id, decision, note });
      notify(`${labels[decision]} 처리했습니다.`);
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };
  const tiles = leave
    ? [
        {
          label: "날짜",
          value: requestPeriod(row, true),
          note: row.days != null ? `근무일 ${row.days}일` : "",
        },
        ...(annual
          ? [
              {
                label: "승인하면 남는 연차",
                value: `${balance.remaining}일`,
                note: "이 신청은 이미 빼고 셌어요",
              },
              {
                label: "반려하면",
                value: `${balance.remaining + (row.days || 0)}일`,
                note: `${row.days || 0}일을 돌려받아요`,
              },
            ]
          : [
              {
                label: "남은 연차",
                value: `${balance.remaining}일`,
                note: "연차에서 빠지지 않아요",
              },
            ]),
      ]
    : [
        {
          label: "날짜",
          value: koreanDay(row.from, true),
          note: `${clockLabel(row.start)}부터 ${clockLabel(row.end)}까지`,
        },
        {
          label: "연장 시간",
          value: hoursLabel(row.minutes || 0),
          note: "승인하면 근무 시간에 더해져요",
        },
      ];
  return (
    <Modal
      title={`${name} ${typeLabel(row)} 신청`}
      subtitle={
        leave
          ? "승인하면 그 시간에는 예약을 받을 수 없어요"
          : "승인하면 이번 달 근무 시간에 더해져요"
      }
      size="wide"
      onClose={busy ? undefined : close}
      dirty={note !== ""}
      footer={
        <>
          {conflicts.length > 0 && (
            <span className="small wf-warn-text">예약을 옮기면 승인할 수 있어요</span>
          )}
          <Button
            variant="danger"
            busy={busy === "rejected"}
            disabled={Boolean(busy)}
            onClick={() => decide("rejected")}
          >
            반려
          </Button>
          <Button
            variant="primary"
            busy={busy === "approved"}
            disabled={Boolean(busy) || conflicts.length > 0}
            onClick={() => decide("approved")}
          >
            승인
          </Button>
        </>
      }
    >
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}
      <div className="wf-inset wf-inline">
        <span className="wf-avatar wf-avatar-lg" aria-hidden="true">
          {initialOf(name)}
        </span>
        <span className="wf-lines">
          <span className="wf-item-title">{name}</span>
          {staff && (
            <span className="small muted">{staff.title || roleLabel(staff.role)}</span>
          )}
        </span>
        <span className="wf-push">
          <Badge tone={REQUEST_STATUS[row.status]?.tone || "warning"}>
            {REQUEST_STATUS[row.status]?.label || "승인 대기"}
          </Badge>
        </span>
      </div>
      <div className={`wf-stat-grid${tiles.length === 3 ? " wf-stat-grid-3" : ""}`}>
        {tiles.map((tile) => (
          <div key={tile.label} className="wf-stat">
            <span className="small muted">{tile.label}</span>
            <strong>{tile.value}</strong>
            {tile.note && <span className="small muted">{tile.note}</span>}
          </div>
        ))}
      </div>
      {row.reason && (
        <div className="wf-inset wf-lines">
          <span className="wf-mini-label">{leave ? "신청 사유" : "업무 내용"}</span>
          <span>{row.reason}</span>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="wf-warn-box">
          <Icon name="alert" />
          <span className="wf-lines">
            <span className="wf-strong-warn">
              {row.from === row.to ? "이날" : "이 기간"} 예약 {conflicts.length}건을 먼저
              옮겨야 해요
            </span>
            <span className="small wf-text">{appointmentLine(conflicts[0], data)}</span>
            {conflicts.length > 1 && (
              <span className="small wf-text">그 밖에 {conflicts.length - 1}건</span>
            )}
          </span>
          {navigate && (
            <button
              type="button"
              className="wf-warn-link"
              onClick={() => {
                close();
                navigate("appointments", { appointmentId: conflicts[0].id });
              }}
            >
              예약 보기
              <Icon name="chevron-right" size={20} />
            </button>
          )}
        </div>
      )}
      <div className="field">
        <span className="wf-label-row">
          <label className="field-label" htmlFor={noteId}>
            메모
          </label>
          <span className="small muted num" aria-hidden="true">
            {note.length}/300
          </span>
        </span>
        <textarea
          ref={noteRef}
          id={noteId}
          rows={3}
          maxLength={300}
          placeholder="승인할 때는 선택이에요"
          aria-describedby={`${noteId}-hint`}
          aria-invalid={noteError ? true : undefined}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (noteError && e.target.value.trim()) setNoteError("");
          }}
        />
        <span id={`${noteId}-hint`} className={noteError ? "error" : "help"}>
          {noteError || "반려할 때는 사유를 꼭 적어 주세요. 직원에게 보여요"}
        </span>
      </div>
    </Modal>
  );
}

function CancelApprovalDialog({ row, data, runAction, notify, close }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <ConfirmDialog
      title={`${staffName(data, row.staffId)} ${typeLabel(row)} 승인 취소`}
      confirmLabel="승인 취소"
      variant="danger"
      busy={busy}
      onClose={close}
      onConfirm={async () => {
        setBusy(true);
        setError("");
        try {
          await runAction("request.decide", { id: row.id, decision: "cancelled", note });
          notify("승인 취소 처리했습니다.");
          close();
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}
      <p className="muted">{requestPeriod(row, true)}</p>
      <Field label="사유 (필수)">
        <textarea
          rows={3}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}

function AttendanceRecords({ data, runAction, notify }) {
  const day = today();
  const [month, setMonth] = useViewState("hr", "month", day.slice(0, 7));
  const [staffId, setStaffId] = useViewState("hr", "staffId", "");
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const active = data.staff.filter(
    (row) =>
      row.status === "active" ||
      (data.attendance || []).some(
        (entry) => entry.staffId === row.id && entry.date.startsWith(month),
      ),
  );
  const records = (data.attendance || [])
    .filter(
      (row) => row.date.startsWith(month) && (!staffId || row.staffId === staffId),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.staffId.localeCompare(b.staffId));
  return (
    <>
      <div className="wf-toolbar">
        <Field label="조회 월">
          <span className="wf-month">
            <button
              type="button"
              className="icon-btn"
              aria-label="이전 달"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <Icon name="chevron-left" />
            </button>
            <DateInput
              className="input"
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
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
        </Field>
        <Field label="직원" className="wf-staff-field">
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">전체 직원</option>
            {active.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        <Button
          variant="primary"
          className="wf-push"
          onClick={() =>
            setEditing({
              initial: {
                staffId: staffId || active[0]?.id || "",
                date: day,
                clockIn: "10:00",
                clockOut: "20:00",
                reason: "",
              },
            })
          }
        >
          <Icon name="plus" size={20} /> 기록 추가
        </Button>
      </div>
      <div className="wf-row-wrap">
        <section className="panel wf-summary-panel" aria-labelledby="hr-summary-title">
          <div className="panel-head">
            <h2 id="hr-summary-title">{Number(month.slice(5, 7))}월 집계</h2>
          </div>
          <div className="table-wrap">
            <table className="wf-table">
              <thead>
                <tr>
                  <th scope="col">직원</th>
                  <th scope="col" className="numeric">출근일</th>
                  <th scope="col" className="numeric">근무 시간</th>
                  <th scope="col" className="numeric">지각</th>
                  <th scope="col" className="numeric">승인 연장</th>
                  <th scope="col" className="numeric">휴가</th>
                  <th scope="col" className="numeric">퇴근 누락</th>
                </tr>
              </thead>
              <tbody>
                {active
                  .filter((row) => !staffId || row.id === staffId)
                  .map((row) => {
                    const summary = monthSummary(data, row.id, month);
                    return (
                      <tr key={row.id}>
                        <th scope="row">{row.name}</th>
                        <td className="numeric">{summary.days}일</td>
                        <td className="numeric">{hoursLabel(summary.minutes)}</td>
                        <td className="numeric">
                          {summary.late ? (
                            <Badge tone="warning">{summary.late}회</Badge>
                          ) : (
                            "0회"
                          )}
                        </td>
                        <td className="numeric">{hoursLabel(summary.overtime)}</td>
                        <td className="numeric">{summary.leave}일</td>
                        <td className="numeric">
                          {summary.open ? (
                            <Badge tone="warning">{summary.open}건</Badge>
                          ) : (
                            "0건"
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="wf-lines">
            <span className="small muted">근무 시간은 출퇴근 기록에서 휴게시간을 뺀 값이에요</span>
            <span className="small muted">
              급여명세의 근태 불러오기로 근무일과 시간을 채울 수 있어요
            </span>
          </div>
        </section>
        <section className="panel wf-detail-panel" aria-labelledby="hr-records-title">
          <div className="panel-head">
            <h2 id="hr-records-title">상세 기록</h2>
            <span className="small muted">최근 날짜부터 보여요</span>
          </div>
          {records.length ? (
            <div className="table-wrap">
              <table className="wf-table">
                <thead>
                  <tr>
                    <th scope="col">날짜</th>
                    <th scope="col">직원</th>
                    <th scope="col">출근</th>
                    <th scope="col">퇴근</th>
                    <th scope="col" className="numeric">근무</th>
                    <th scope="col">구분</th>
                    <th scope="col" aria-label="작업" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((row) => {
                    const staff = data.staff.find((s) => s.id === row.staffId);
                    const open = row.clockOut == null;
                    return (
                      <tr key={row.id}>
                        <th scope="row">{koreanDayShort(row.date)}</th>
                        <td>{staff?.name || "직원"}</td>
                        <td>
                          <span className="wf-inline-tight">
                            {clockLabel(row.clockIn)}
                            {staff && row.clockIn > staff.startMinutes && (
                              <Badge tone="warning">지각</Badge>
                            )}
                          </span>
                        </td>
                        <td>
                          {!open ? (
                            clockLabel(row.clockOut)
                          ) : row.date === day ? (
                            <Badge tone="success">근무 중</Badge>
                          ) : (
                            <Badge tone="warning">기록 없음</Badge>
                          )}
                        </td>
                        <td className="numeric">
                          {!open ? (
                            hoursLabel(workedMinutes(row, staff))
                          ) : row.date === day ? (
                            <span className="wf-faint">퇴근 후 계산</span>
                          ) : (
                            <span className="muted">0시간</span>
                          )}
                        </td>
                        <td>
                          {corrected(row) ? (
                            <span className="wf-accent-text">정정</span>
                          ) : (
                            <span className="muted">본인 기록</span>
                          )}
                        </td>
                        <td className="numeric">
                          <span className="wf-row-actions">
                            <Button
                              variant="ghost"
                              onClick={() =>
                                setEditing({
                                  record: row,
                                  initial: {
                                    id: row.id,
                                    staffId: row.staffId,
                                    date: row.date,
                                    clockIn: clockLabel(row.clockIn),
                                    clockOut: open ? "" : clockLabel(row.clockOut),
                                    reason: "",
                                  },
                                })
                              }
                            >
                              정정
                            </Button>
                            <Button variant="ghost" onClick={() => setRemoving(row)}>
                              삭제
                            </Button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="wf-empty">이 달의 출퇴근 기록이 없어요</p>
          )}
        </section>
      </div>
      {editing && (
        <AttendanceForm
          initial={editing.initial}
          record={editing.record}
          data={data}
          staff={active.length ? active : data.staff}
          runAction={runAction}
          notify={notify}
          close={() => setEditing(null)}
        />
      )}
      {removing && (
        <RemoveAttendance
          row={removing}
          data={data}
          runAction={runAction}
          notify={notify}
          close={() => setRemoving(null)}
        />
      )}
    </>
  );
}

/** 출퇴근 정정 / 기록 추가 (AttendanceEdit board). */
function AttendanceForm({ initial, record, data, staff, runAction, notify, close }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const day = today();
  const person = data.staff.find((row) => row.id === form.staffId);
  const clash =
    !form.id &&
    (data.attendance || []).find(
      (entry) => entry.staffId === form.staffId && entry.date === form.date,
    );
  const shown = record || clash;
  const clockIn = toMinutes(form.clockIn);
  const clockOut = toMinutes(form.clockOut);
  const worked =
    clockIn != null && clockOut != null && clockOut > clockIn
      ? workedMinutes({ clockIn, clockOut }, person)
      : null;
  const breakCut = worked != null ? clockOut - clockIn - worked : 0;
  const month = /^\d{4}-\d{2}/.test(form.date || "") ? form.date.slice(0, 7) : day.slice(0, 7);
  const before = form.staffId ? monthSummary(data, form.staffId, month).minutes : 0;
  const replaced =
    record &&
    record.staffId === form.staffId &&
    record.date.startsWith(month) &&
    record.clockOut != null
      ? workedMinutes(record, person)
      : 0;
  const after = before - replaced + (worked || 0);
  const change =
    after > before
      ? { text: `${hoursLabel(before)}에서 늘어요`, tone: "wf-ok-text" }
      : after < before
        ? { text: `${hoursLabel(before)}에서 줄어요`, tone: "wf-warn-text" }
        : { text: "그대로예요", tone: "muted" };
  const sourceLabel = record && corrected(record) ? "기존 기록" : "본인 기록";
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await runAction("attendance.save", {
        id: form.id,
        staffId: form.staffId,
        date: form.date,
        clockIn: timeMinutes(form.clockIn),
        clockOut: form.clockOut ? timeMinutes(form.clockOut) : null,
        reason: form.reason,
      });
      notify("출퇴근 기록을 저장했습니다.");
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={form.id ? "출퇴근 정정" : "출퇴근 기록 추가"}
      subtitle={form.id ? "기록 추가도 같은 창에서 해요" : "직원이 찍지 못한 날을 넣어요"}
      size="wide"
      onClose={busy ? undefined : close}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={closeDialogFrom}>
            취소
          </Button>
          <Button form="attendance-form" type="submit" variant="primary" busy={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id="attendance-form" className="wf-dialog-form" onSubmit={submit}>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        {shown && (
          <div className="wf-inset wf-inline">
            <span className="wf-lines">
              <span className="wf-mini-label">지금 기록</span>
              <span className="wf-strong num">{clockLabel(shown.clockIn)} 출근</span>
              <span className="small muted">
                {shown.clockOut == null
                  ? "퇴근 기록이 없어요"
                  : `${clockLabel(shown.clockOut)} 퇴근`}
              </span>
              {clash && (
                <span className="small wf-warn-text">
                  이날 기록이 이미 있어요. 상세 기록에서 정정해 주세요
                </span>
              )}
            </span>
            {shown.clockOut == null && (
              <span className="wf-push">
                {shown.date === day ? (
                  <Badge tone="success">근무 중</Badge>
                ) : (
                  <Badge tone="warning">퇴근 누락</Badge>
                )}
              </span>
            )}
          </div>
        )}
        <div className="wf-grid-2">
          <Field label="직원">
            <select
              required
              value={form.staffId}
              onChange={(e) => set("staffId", e.target.value)}
            >
              {staff.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="근무일"
            help={form.date ? koreanDay(form.date, true).split(" ").at(-1) : undefined}
          >
            <DateInput
              className="input"
              type="date"
              required
              max={day}
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field
            label="출근 시각"
            help={
              record && clockIn != null && clockIn !== record.clockIn
                ? `${sourceLabel} ${clockLabel(record.clockIn)}에서 고쳐요`
                : undefined
            }
          >
            <TimeInput
              interval={10}
              required
              aria-label="출근 시각"
              pickerLabel="출근 시각"
              value={form.clockIn}
              onChange={(e) => set("clockIn", e.target.value)}
            />
          </Field>
          <Field label="퇴근 시각" help="비우면 근무 중으로 남아요">
            <TimeInput
              interval={10}
              aria-label="퇴근 시각"
              pickerLabel="퇴근 시각"
              value={form.clockOut}
              onChange={(e) => set("clockOut", e.target.value)}
            />
          </Field>
        </div>
        <Field label="정정 사유" help="직원과 변경 기록에 남아요">
          <input
            required
            maxLength={300}
            placeholder="예: 퇴근 기록 누락"
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
          />
        </Field>
        <div className="wf-stat-grid">
          <div className="wf-stat">
            <span className="small muted">고친 뒤 근무 시간</span>
            <strong>{worked != null ? hoursLabel(worked) : "—"}</strong>
            <span
              className={`small ${clockOut != null && worked == null ? "wf-warn-text" : "muted"}`}
            >
              {worked == null
                ? clockOut == null
                  ? "퇴근 시각을 넣으면 계산해요"
                  : "퇴근 시각은 출근 시각 뒤여야 해요"
                : breakCut > 0
                  ? `휴게 ${hoursLabel(breakCut)}을 뺐어요`
                  : "휴게시간과 겹치지 않아요"}
            </span>
          </div>
          <div className="wf-stat">
            <span className="small muted">{Number(month.slice(5, 7))}월 근무 시간</span>
            <strong>{hoursLabel(after)}</strong>
            <span className={`small ${change.tone}`}>{change.text}</span>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function RemoveAttendance({ row, data, runAction, notify, close }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <ConfirmDialog
      title="출퇴근 기록을 삭제할까요?"
      confirmLabel="삭제"
      variant="danger"
      busy={busy}
      onClose={close}
      onConfirm={async () => {
        setBusy(true);
        try {
          await runAction("attendance.delete", { id: row.id, reason });
          notify("기록을 삭제했습니다.");
          close();
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}
      <div className="wf-lines">
        <span className="wf-item-title">{staffName(data, row.staffId)}</span>
        <span className="muted">{koreanDay(row.date, true)}</span>
        <span className="muted">
          {row.clockOut != null
            ? `${clockLabel(row.clockIn)}부터 ${clockLabel(row.clockOut)}까지`
            : `${clockLabel(row.clockIn)} 출근`}
        </span>
      </div>
      <Field label="삭제 사유">
        <input
          required
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}

function LeaveOverview({ data }) {
  const [year, setYear] = useViewState("hr", "year", Number(today().slice(0, 4)));
  const staff = data.staff.filter((row) => row.status === "active");
  return (
    <section className="panel" aria-labelledby="hr-leave-title">
      <div className="panel-head">
        <h2 id="hr-leave-title">{year}년 연차 현황</h2>
        <span className="wf-stepper">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setYear(year - 1)}
            aria-label="이전 해"
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setYear(year + 1)}
            aria-label="다음 해"
          >
            <Icon name="chevron-right" />
          </button>
        </span>
      </div>
      <div className="table-wrap">
        <table className="wf-table wf-table-tall">
          <thead>
            <tr>
              <th scope="col">직원</th>
              <th scope="col">입사일</th>
              <th scope="col" className="numeric">부여</th>
              <th scope="col" className="numeric">사용</th>
              <th scope="col" className="numeric">승인 대기</th>
              <th scope="col">쓴 비율</th>
              <th scope="col" className="numeric">남은 연차</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((row) => {
              const balance = leaveBalance(data, row.id, year);
              const used = Math.min(100, percent(balance.used, balance.allowance));
              const reserved = Math.min(100 - used, percent(balance.reserved, balance.allowance));
              return (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  <td>{row.hireDate || <span className="muted">미입력</span>}</td>
                  <td className="numeric">{balance.allowance}일</td>
                  <td className="numeric">{balance.used}일</td>
                  <td className="numeric">
                    {balance.reserved > 0 ? (
                      <span className="wf-warn-strong">{balance.reserved}일</span>
                    ) : (
                      `${balance.reserved}일`
                    )}
                  </td>
                  <td>
                    <span className="wf-rate">
                      <span className="wf-rate-bar" aria-hidden="true">
                        <span style={{ width: `${used}%` }} />
                        <span className="wf-rate-reserved" style={{ width: `${reserved}%` }} />
                      </span>
                      <span className="small muted">
                        {percent(balance.used + balance.reserved, balance.allowance)}%
                      </span>
                    </span>
                  </td>
                  <td className="numeric">
                    <strong className={balance.remaining <= 0 ? "wf-warn-text" : "wf-strong"}>
                      {balance.remaining}일
                    </strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="wf-legend">
        <span>
          <span className="wf-legend-mark" aria-hidden="true" />
          <span className="small muted">사용</span>
        </span>
        <span>
          <span className="wf-legend-mark wf-rate-reserved" aria-hidden="true" />
          <span className="small muted">승인 대기</span>
        </span>
      </div>
      <div className="wf-inset wf-lines wf-lines-8">
        <span>연차와 반차만 빠져요. 남은 연차는 승인 대기까지 뺀 값이에요</span>
        <span>부여 일수는 직원 메뉴의 직원 정보에서 바꿔요</span>
        <span className="small muted">
          근로기준법 발생 일수는 1년 미만이면 한 달에 1일, 1년 이상이면 15일에 가산 일수를
          더해요. 매장에서 확인해 넣어 주세요
        </span>
      </div>
    </section>
  );
}

const HISTORY_KINDS = {
  hire: { label: "입사", tone: "success" },
  rehire: { label: "재입사", tone: "success" },
  resign: { label: "퇴사", tone: "danger" },
  promotion: { label: "직책 변경", tone: "accent" },
  transfer: { label: "부서 이동", tone: "accent" },
  update: { label: "정보 변경", tone: "muted" },
};
const historyValue = (row, raw) =>
  row.field === "role"
    ? roleLabel(raw)
    : row.field === "status"
      ? raw === "active"
        ? "재직"
        : raw
          ? "퇴사"
          : ""
      : raw || "";
/** One plain sentence for a personnel change, e.g. "직위를 디자이너에서 실장으로 바꿨어요". */
function historySentence(row) {
  if (row.kind === "hire") return "직원으로 등록했어요";
  const before = row.before ? historyValue(row, row.before) : "";
  const after = row.after ? historyValue(row, row.after) : "";
  const label = row.label || "정보";
  if (row.field === "status" && after)
    return before
      ? `${before}에서 ${josa(after, "으로/로")} 바꿨어요`
      : `${josa(after, "으로/로")} 바꿨어요`;
  if (row.kind === "transfer" && before && after)
    return `${before}에서 ${josa(after, "으로/로")} 옮겼어요`;
  if (before && after)
    return `${josa(label, "을/를")} ${before}에서 ${josa(after, "으로/로")} 바꿨어요`;
  if (after) return `${josa(label, "을/를")} ${josa(after, "으로/로")} 정했어요`;
  if (before) return `${label} ${josa(before, "을/를")} 지웠어요`;
  return `${josa(label, "을/를")} 바꿨어요`;
}

function Organization({ data }) {
  const teams = new Map();
  const activeStaff = data.staff.filter((s) => s.status === "active");
  for (const row of activeStaff) {
    const key = row.team || "소속 미지정";
    if (!teams.has(key)) teams.set(key, []);
    teams.get(key).push(row);
  }
  const history = [...(data.staffHistory || [])].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
  const representative =
    data.store.representative || data.staff.find((s) => s.role === "owner")?.name || "";
  return (
    <div className="wf-row-wrap">
      <section className="panel wf-org-panel" aria-labelledby="hr-org-title">
        <div className="panel-head">
          <h2 id="hr-org-title">조직도</h2>
          <span className="small muted">재직 {activeStaff.length}명</span>
        </div>
        <div className="wf-inset wf-inline">
          <span className="wf-avatar wf-avatar-lg" aria-hidden="true">
            {initialOf(data.store.name)}
          </span>
          <span className="wf-lines">
            <span className="wf-item-title">{data.store.name}</span>
            {representative && <span className="small muted">대표 {representative}</span>}
          </span>
        </div>
        {[...teams.entries()].map(([team, members]) => (
          <div key={team} className="wf-org-team">
            <div className="wf-org-team-head">
              <h3>{team}</h3>
              <span className="small muted">{members.length}명</span>
            </div>
            <ul>
              {members.map((row) => (
                <li key={row.id}>
                  <span className="wf-avatar" aria-hidden="true">
                    {initialOf(row.name)}
                  </span>
                  <strong>{row.name}</strong>
                  <span className="muted">{row.title || roleLabel(row.role)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <span className="small muted">팀과 직위는 직원 메뉴의 직원 정보에서 정해요</span>
      </section>
      <section className="panel wf-grow" aria-labelledby="hr-history-title">
        <div className="panel-head">
          <h2 id="hr-history-title">인사 발령 이력</h2>
          {history.length > 0 && <span className="small muted">최근 순</span>}
        </div>
        {history.length ? (
          <ol className="wf-timeline">
            {history.map((row, index) => {
              const name = staffName(data, row.staffId);
              const kind = HISTORY_KINDS[row.kind] || { label: row.kind, tone: "muted" };
              return (
                <li key={row.id} className={index === 0 ? "is-latest" : undefined}>
                  <span className="wf-timeline-rail" aria-hidden="true">
                    <span />
                    <span className="wf-timeline-dot" />
                    <span />
                  </span>
                  <div className="wf-timeline-card">
                    <span className="wf-timeline-date muted num">{row.date}</span>
                    <span className="wf-avatar" aria-hidden="true">
                      {initialOf(name)}
                    </span>
                    <span className="wf-lines wf-timeline-main">
                      <span className="wf-item-title">{name}</span>
                      <span>{historySentence(row)}</span>
                    </span>
                    <span className={`badge badge-${kind.tone}`}>{kind.label}</span>
                    <span className="wf-timeline-actor small muted">
                      {row.actorName} 처리
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="wf-empty">아직 기록된 인사 발령이 없어요</p>
        )}
        <span className="small muted">
          직원 정보에서 직책, 팀, 직위, 재직 상태를 바꾸면 자동으로 기록돼요
        </span>
      </section>
    </div>
  );
}

const certificateJob = (snapshot) => snapshot.title || roleLabel(snapshot.role);
const certificatePeriod = (snapshot, type) =>
  `${koreanDate(snapshot.hireDate)}부터 ${
    type === "employment" ? "현재" : koreanDate(snapshot.resignDate) || "현재"
  }까지`;

/** Printable certificate body (PrintCertificate board). Every value is escaped. */
function certificateHtml(certificate) {
  const s = certificate.snapshot,
    store = certificate.store || {};
  const employment = certificate.type === "employment";
  const dl = (rows) =>
    `<dl class="cert-dl">${rows
      .filter(([, value]) => value)
      .map(
        ([key, value], index) =>
          `<dt>${escapeHtml(key)}</dt><dd${key === "성명" && index === 0 ? ' class="strong"' : ""}>${escapeHtml(value)}</dd>`,
      )
      .join("")}</dl>`;
  const logo = logoTag(store);
  return `
    <article class="cert">
      <div class="cert-top">
        <span class="small">발급번호 제 ${escapeHtml(certificate.number)} 호</span>
        <span class="brand">${logo || '<span class="brand-dot" aria-hidden="true"></span>'}${escapeHtml(store.name)}</span>
      </div>
      <h1 class="cert-title">${employment ? "재직증명서" : "경력증명서"}</h1>
      <section>
        <h2>인적 사항</h2>
        ${dl([
          ["성명", s.name],
          ["생년월일", koreanDate(s.birthDate)],
          ["주소", s.address],
        ])}
      </section>
      <section>
        <h2>${employment ? "재직 사항" : "경력 사항"}</h2>
        ${dl([
          ["소속", s.team],
          ["직위", certificateJob(s)],
          ["담당 업무", s.duties || certificateJob(s)],
          [employment ? "재직 기간" : "근무 기간", certificatePeriod(s, certificate.type)],
          ["용도", certificate.purpose],
        ])}
      </section>
      <div class="cert-statement">
        <p class="strong">위와 같이 ${employment ? "재직하고 있음" : "근무하였음"}을 증명합니다.</p>
        <p>${escapeHtml(koreanDate(certificate.issuedDate))}</p>
      </div>
      <footer class="cert-issuer">
        <strong class="cert-store">${escapeHtml(store.name)}</strong>
        ${store.businessNumber ? `<span class="cert-first">사업자등록번호 ${escapeHtml(store.businessNumber)}</span>` : ""}
        ${store.address ? `<span>${escapeHtml(store.address)}</span>` : ""}
        ${store.phone ? `<span>전화 ${escapeHtml(store.phone)}</span>` : ""}
        <div class="cert-sign">
          <span class="strong">대표 ${escapeHtml(store.representative || "")}</span>
          <span class="cert-seal" aria-label="직인 자리">(인)</span>
        </div>
      </footer>
    </article>`;
}
const CERTIFICATE_CSS = `
  .cert{min-height:250mm;padding:8mm;display:flex;flex-direction:column;gap:32px}
  .cert .strong{font-weight:600}
  .cert-top{display:flex;align-items:center;justify-content:space-between;gap:16px}
  .cert-top .small{color:#555}
  .cert-top .logo{max-height:24px}
  .cert-title{margin:0;text-align:center;font-size:40px;line-height:48px;font-weight:700;letter-spacing:.24em}
  .cert section{display:flex;flex-direction:column;gap:8px}
  .cert h2{margin:0}
  .cert-dl{margin:0;padding:12px 16px;border-radius:12px;background:#F4F4F6;display:grid;grid-template-columns:120px minmax(0,1fr);gap:12px 16px}
  .cert-dl dt{color:#555}
  .cert-dl dd{margin:0}
  .cert-statement{margin-top:24px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center}
  .cert-statement .strong{font-size:16px;line-height:24px}
  .cert-issuer{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
  .cert-store{font-size:18px;line-height:1.25;font-weight:700;letter-spacing:-.02em}
  .cert-first{margin-top:4px}
  .cert-sign{margin-top:16px;display:flex;align-items:center;gap:16px}
  .cert-sign .strong{font-size:16px;line-height:24px}
  .cert-seal{width:72px;height:72px;border-radius:12px;border:1px dashed #8B8B96;display:flex;align-items:center;justify-content:center;color:#555}`;

function Certificates({ data, runAction, notify }) {
  const blank = { staffId: "", type: "employment", purpose: "", duties: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const staff = data.staff.find((row) => row.id === form.staffId);
  const certificates = data.certificates || [];
  const issued = [...certificates].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  const year = today().slice(0, 4);
  const nextNumber = `${year}-${String(
    certificates.filter((row) => row.number?.startsWith(`${year}-`)).length + 1,
  ).padStart(4, "0")}`;
  const print = (certificate) =>
    printDocument(
      `${CERTIFICATE_TYPES[certificate.type] || "증명서"} ${certificate.number}`,
      `<style>${CERTIFICATE_CSS}</style>${certificateHtml(certificate)}`,
    );
  const issue = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await runAction("certificate.issue", form);
      notify("증명서를 발급했습니다. 인쇄 창을 엽니다.");
      setForm(blank);
      const latest = result.data.certificates.at(-1);
      if (latest) print(latest);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wf-row-wrap">
      <section className="panel wf-cert-panel" aria-labelledby="hr-cert-title">
        <div className="panel-head">
          <h2 id="hr-cert-title">증명서 발급</h2>
        </div>
        <form className="wf-form" onSubmit={issue}>
          {error && (
            <div className="alert alert-warning" role="alert">
              {error}
            </div>
          )}
          <Field label="직원">
            <select
              required
              value={form.staffId}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            >
              <option value="">선택해 주세요</option>
              {data.staff.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({row.status === "active" ? "재직" : "퇴사"})
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <span className="field-label" id="hr-cert-type">
              증명서 종류
            </span>
            <div className="chip-row wf-pills" role="group" aria-labelledby="hr-cert-type">
              {Object.entries(CERTIFICATE_TYPES).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="chip"
                  aria-pressed={form.type === id}
                  onClick={() => setForm({ ...form, type: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Field label="담당 업무" help="선택이에요. 비우면 직책으로 나와요">
            <input
              maxLength={200}
              placeholder="예: 헤어 디자인"
              value={form.duties}
              onChange={(e) => setForm({ ...form, duties: e.target.value })}
            />
          </Field>
          <Field label="용도와 제출처" help="증명서의 용도 칸에 그대로 나와요">
            <input
              required
              maxLength={100}
              placeholder="예: 금융기관 제출"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </Field>
          {staff && !staff.hireDate && (
            <p className="alert alert-warning">
              직원 정보에 입사일이 없습니다. 직원 메뉴에서 먼저 넣어 주세요
            </p>
          )}
          {staff && form.type === "employment" && staff.status !== "active" && (
            <p className="alert alert-warning">
              재직증명서는 재직 중인 직원만 발급할 수 있어요. 경력증명서를 골라 주세요
            </p>
          )}
          {staff && (
            <div className="wf-inset wf-lines wf-lines-8">
              <span className="wf-mini-label">증명서에 들어가는 내용</span>
              {[
                ["성명", staff.name],
                ["소속", [staff.team, staff.title || roleLabel(staff.role)].filter(Boolean).join(" ")],
                [
                  form.type === "employment" ? "재직 기간" : "근무 기간",
                  staff.hireDate ? certificatePeriod(staff, form.type) : "입사일 없음",
                ],
                ["발급번호", `제${nextNumber}호`],
              ].map(([label, value]) => (
                <span key={label} className="wf-kv-line">
                  <span className="muted">{label}</span>
                  <span className="wf-strong">{value}</span>
                </span>
              ))}
            </div>
          )}
          {!data.store.representative && (
            <span className="small muted">
              대표자와 사업자등록번호는 설정의 매장 정보에서 넣으면 증명서에 나와요
            </span>
          )}
          <Button type="submit" variant="primary" className="btn-block" busy={busy}>
            <Icon name="print" size={20} /> 발급하고 인쇄
          </Button>
        </form>
      </section>
      <section className="panel wf-grow" aria-labelledby="hr-issued-title">
        <div className="panel-head">
          <h2 id="hr-issued-title">발급 대장</h2>
          {issued.length > 0 && <span className="small muted">{issued.length}건</span>}
        </div>
        {issued.length ? (
          <div className="table-wrap">
            <table className="wf-table">
              <thead>
                <tr>
                  <th scope="col">직원</th>
                  <th scope="col">종류</th>
                  <th scope="col">발급번호</th>
                  <th scope="col">용도</th>
                  <th scope="col">발급일</th>
                  <th scope="col">발급자</th>
                  <th scope="col" aria-label="작업" />
                </tr>
              </thead>
              <tbody>
                {issued.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.snapshot.name}</th>
                    <td>
                      <span
                        className={`badge badge-${row.type === "employment" ? "accent" : "muted"}`}
                      >
                        {CERTIFICATE_TYPES[row.type] || "증명서"}
                      </span>
                    </td>
                    <td>제{row.number}호</td>
                    <td className="wf-cell-wrap">{row.purpose}</td>
                    <td title={timestampLabel(row.issuedAt)}>
                      {koreanDay(row.issuedDate || row.issuedAt?.slice(0, 10))}
                    </td>
                    <td>{row.issuedBy}</td>
                    <td className="numeric">
                      <Button variant="ghost" onClick={() => print(row)}>
                        <Icon name="print" size={20} /> 다시 인쇄
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="wf-empty">발급한 증명서가 없어요</p>
        )}
        <span className="small muted">
          발급할 때 정보로 보관해서 다시 인쇄해도 내용이 같아요
        </span>
      </section>
    </div>
  );
}

function Severance({ data }) {
  const day = today();
  const staff = data.staff.filter((row) => row.hireDate);
  const rows = staff.map((row) => ({ row, estimate: severanceEstimate(data, row, day) }));
  const sample = rows.find(
    ({ estimate }) => estimate.eligible && estimate.amount != null && estimate.daily,
  );
  return (
    <div className="wf-row-wrap">
      <section className="panel wf-grow" aria-labelledby="hr-severance-title">
        <div className="panel-head">
          <h2 id="hr-severance-title">퇴직금 추정</h2>
          <span className="small muted">오늘 퇴사한다고 보고 셌어요</span>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="wf-table wf-table-tall">
              <thead>
                <tr>
                  <th scope="col">직원</th>
                  <th scope="col">입사일</th>
                  <th scope="col" className="numeric">재직일수</th>
                  <th scope="col" className="numeric">1일 평균임금</th>
                  <th scope="col" className="numeric">추정 퇴직금</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row, estimate }) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <span className="wf-inline-tight">
                        {row.name}
                        {row.status !== "active" && <Badge tone="muted">퇴사</Badge>}
                      </span>
                    </th>
                    <td>{row.hireDate}</td>
                    <td className="numeric">
                      {estimate.serviceDays.toLocaleString("ko-KR")}일
                    </td>
                    <td className="numeric">
                      {estimate.daily ? (
                        won(estimate.daily)
                      ) : (
                        <span className="muted">확정 급여 없음</span>
                      )}
                    </td>
                    <td className="numeric">
                      {!estimate.eligible ? (
                        <span className="small muted">1년 미만이라 대상 아님</span>
                      ) : estimate.amount != null ? (
                        <strong className="wf-strong">{won(estimate.amount)}</strong>
                      ) : (
                        <span className="wf-warn-text">계산 불가</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="wf-empty">입사일을 넣은 직원이 없어요</p>
        )}
        <span className="small muted">
          추정 금액이에요. 실제 지급액은 노무 담당자와 확인해 주세요
        </span>
      </section>
      <section className="panel wf-side wf-gap-12" aria-labelledby="hr-severance-how">
        <div className="panel-head">
          <h2 id="hr-severance-how">이렇게 계산해요</h2>
        </div>
        <div className="wf-inset wf-lines">
          <span className="wf-mini-label">1일 평균임금</span>
          <span>최근 3개월 확정 급여의 지급 합계를</span>
          <span>그 기간 일수로 나눠요</span>
        </div>
        <div className="wf-inset wf-lines">
          <span className="wf-mini-label">퇴직금</span>
          <span>1일 평균임금에 30일을 곱하고</span>
          <span>재직일수를 곱한 뒤 365로 나눠요</span>
        </div>
        {sample && (
          <div className="wf-inset wf-lines">
            <span className="wf-mini-label">예시</span>
            <span>
              {sample.row.name} {won(sample.estimate.daily)}에 30일을 곱하면{" "}
              {won(sample.estimate.daily * 30)}
            </span>
            <span>
              재직 {sample.estimate.serviceDays.toLocaleString("ko-KR")}일이면{" "}
              {won(sample.estimate.amount)}이에요
            </span>
          </div>
        )}
        <div className="wf-warn-box wf-lines">
          <span className="wf-strong-warn">실제 금액은 달라질 수 있어요</span>
          <span className="wf-text">상여금, 연차수당, 퇴직연금 가입 여부에 따라 달라져요</span>
        </div>
      </section>
    </div>
  );
}
