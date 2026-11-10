import React, { useState } from "react";
import { roleLabel, today, won } from "../api";
import { Badge, Button, ConfirmDialog, EmptyState, Field, Modal } from "../components/ui";
import { DateInput } from "../components/DateInput.jsx";
import { useViewState } from "../components/ViewState";
import { printDocument } from "../print";
import {
  REQUEST_STATUS,
  clockLabel,
  hoursLabel,
  leaveBalance,
  monthSummary,
  periodLabel,
  severanceEstimate,
  typeLabel,
  workedMinutes,
} from "../workforce-utils";
import { dateLabel, timeMinutes, timestampLabel } from "./operations-utils";
import "./Workforce.css";

const TABS = [
  ["requests", "신청 승인"],
  ["attendance", "출퇴근 기록"],
  ["leave", "연차 현황"],
  ["organization", "조직 · 인사 이력"],
  ["certificates", "증명서 발급"],
  ["severance", "퇴직금 추정"],
];
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const koreanDate = (value) =>
  value
    ? `${value.slice(0, 4)}년 ${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`
    : "";
const staffName = (data, id) =>
  data.staff.find((row) => row.id === id)?.name || "퇴사 / 미지정 직원";

export default function HumanResources({ data, runAction, notify, routeContext }) {
  const [tab, setTab] = useViewState(
    "hr",
    "tab",
    TABS.some(([id]) => id === routeContext?.tab) ? routeContext.tab : "requests",
  );
  const pending = (data.staffRequests || []).filter(
    (row) => row.status === "requested",
  ).length;
  return (
    <div className="workforce-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">인사 · 근태</h1>
          <p className="page-description">
            휴가·근무 신청 승인, 출퇴근 정정, 연차·인사 이력, 증명서 발급을
            관리합니다.
          </p>
        </div>
      </div>
      <nav className="tabs" aria-label="인사 · 근태 메뉴">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${tab === id ? "active" : ""}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "requests" && pending > 0 && (
              <span className="nav-count">{pending}</span>
            )}
          </button>
        ))}
      </nav>
      {tab === "requests" && (
        <Requests data={data} runAction={runAction} notify={notify} />
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

function Requests({ data, runAction, notify }) {
  const [filter, setFilter] = useViewState("hr", "requestFilter", "requested");
  const [decision, setDecision] = useState(null);
  const rows = (data.staffRequests || [])
    .filter((row) => filter === "all" || row.status === filter)
    .sort((a, b) => a.from.localeCompare(b.from));
  return (
    <section className="card">
      <div className="card-header">
        <h2>휴가 · 근무 신청</h2>
        <select
          aria-label="상태 필터"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="requested">승인 대기</option>
          <option value="approved">승인</option>
          <option value="rejected">반려</option>
          <option value="cancelled">취소</option>
          <option value="all">전체</option>
        </select>
      </div>
      <div className="card-body">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table commerce-table commerce-mobile-cards">
              <thead>
                <tr>
                  <th>직원</th>
                  <th>종류</th>
                  <th>기간</th>
                  <th>사용</th>
                  <th>사유</th>
                  <th>상태</th>
                  <th aria-label="작업" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const balance =
                    row.kind === "leave" &&
                    leaveBalance(data, row.staffId, Number(row.from.slice(0, 4)));
                  return (
                    <tr key={row.id}>
                      <td data-label="직원">{staffName(data, row.staffId)}</td>
                      <td data-label="종류">{typeLabel(row)}</td>
                      <td data-label="기간">{periodLabel(row)}</td>
                      <td data-label="사용">
                        {row.kind === "leave"
                          ? `${row.days}일`
                          : hoursLabel(row.minutes)}
                        {balance && ["annual", "half_am", "half_pm"].includes(row.type) && (
                          <span className="help"> · 잔여 {balance.remaining}일</span>
                        )}
                      </td>
                      <td data-label="사유">{row.reason || "—"}</td>
                      <td data-label="상태">
                        <Badge tone={REQUEST_STATUS[row.status].tone}>
                          {REQUEST_STATUS[row.status].label}
                        </Badge>
                        {row.decisionNote && (
                          <span className="help"> {row.decisionNote}</span>
                        )}
                      </td>
                      <td className="row-actions">
                        {row.status === "requested" && (
                          <>
                            <Button
                              variant="primary"
                              onClick={() => setDecision({ row, decision: "approved" })}
                            >
                              승인
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => setDecision({ row, decision: "rejected" })}
                            >
                              반려
                            </Button>
                          </>
                        )}
                        {row.status === "approved" && (
                          <Button
                            variant="ghost"
                            onClick={() => setDecision({ row, decision: "cancelled" })}
                          >
                            승인 취소
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="해당하는 신청이 없습니다"
            description="직원이 근태 · 휴가 화면에서 신청하면 여기에 표시됩니다."
          />
        )}
        <p className="help">
          휴가를 승인하면 해당 시간에 예약을 잡을 수 없습니다. 기존 예약이
          있으면 담당자나 시간을 먼저 변경해야 승인됩니다.
        </p>
      </div>
      {decision && (
        <DecisionDialog
          {...decision}
          data={data}
          runAction={runAction}
          notify={notify}
          close={() => setDecision(null)}
        />
      )}
    </section>
  );
}

function DecisionDialog({ row, decision, data, runAction, notify, close }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const labels = { approved: "승인", rejected: "반려", cancelled: "승인 취소" };
  return (
    <ConfirmDialog
      title={`${staffName(data, row.staffId)} · ${typeLabel(row)} ${labels[decision]}`}
      confirmLabel={labels[decision]}
      variant={decision === "approved" ? "primary" : "danger"}
      busy={busy}
      onClose={close}
      onConfirm={async () => {
        setBusy(true);
        setError("");
        try {
          await runAction("request.decide", { id: row.id, decision, note });
          notify(`${labels[decision]} 처리했습니다.`);
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
      <p>{periodLabel(row)}</p>
      <Field label={decision === "approved" ? "메모 (선택)" : "사유 (필수)"}>
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
  const [month, setMonth] = useViewState("hr", "month", today().slice(0, 7));
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
      <div className="toolbar">
        <Field label="조회 월">
          <DateInput
            className="input"
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </Field>
        <Field label="직원">
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
          onClick={() =>
            setEditing({
              staffId: staffId || active[0]?.id || "",
              date: today(),
              clockIn: "10:00",
              clockOut: "20:00",
              reason: "",
            })
          }
        >
          기록 추가
        </Button>
      </div>
      <section className="card">
        <div className="card-header">
          <h2>월간 집계</h2>
        </div>
        <div className="card-body table-wrap">
          <table className="table commerce-table commerce-mobile-cards">
            <thead>
              <tr>
                <th>직원</th>
                <th className="numeric">출근일</th>
                <th className="numeric">근무시간</th>
                <th className="numeric">지각</th>
                <th className="numeric">승인 연장</th>
                <th className="numeric">휴가</th>
                <th className="numeric">퇴근 누락</th>
              </tr>
            </thead>
            <tbody>
              {active
                .filter((row) => !staffId || row.id === staffId)
                .map((row) => {
                  const summary = monthSummary(data, row.id, month);
                  return (
                    <tr key={row.id}>
                      <td data-label="직원">{row.name}</td>
                      <td data-label="출근일" className="numeric">{summary.days}일</td>
                      <td data-label="근무시간" className="numeric">{hoursLabel(summary.minutes)}</td>
                      <td data-label="지각" className="numeric">{summary.late}회</td>
                      <td data-label="승인 연장" className="numeric">{hoursLabel(summary.overtime)}</td>
                      <td data-label="휴가" className="numeric">{summary.leave}일</td>
                      <td data-label="퇴근 누락" className="numeric">
                        {summary.open ? <Badge tone="warning">{summary.open}건</Badge> : "0건"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="help">
            근무시간은 출퇴근 기록에서 설정된 휴게시간을 뺀 값입니다. 급여명세
            작성 화면의 &lsquo;근태 기록 불러오기&rsquo;로 근무일·시간을 채울 수 있습니다.
          </p>
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <h2>상세 기록</h2>
        </div>
        <div className="card-body">
          {records.length ? (
            <div className="table-wrap">
              <table className="table commerce-table commerce-mobile-cards">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>직원</th>
                    <th>출근</th>
                    <th>퇴근</th>
                    <th className="numeric">근무</th>
                    <th>구분</th>
                    <th aria-label="작업" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((row) => {
                    const staff = data.staff.find((s) => s.id === row.staffId);
                    return (
                      <tr key={row.id}>
                        <td data-label="날짜">{dateLabel(row.date)}</td>
                        <td data-label="직원">{staff?.name || "직원"}</td>
                        <td data-label="출근">
                          {clockLabel(row.clockIn)}
                          {staff && row.clockIn > staff.startMinutes && (
                            <Badge tone="warning">지각</Badge>
                          )}
                        </td>
                        <td data-label="퇴근">{clockLabel(row.clockOut)}</td>
                        <td data-label="근무" className="numeric">
                          {row.clockOut != null ? hoursLabel(workedMinutes(row, staff)) : "—"}
                        </td>
                        <td data-label="구분">
                          {row.source === "manual" || row.changes?.some((c) => c.kind === "corrected")
                            ? "정정"
                            : "본인 기록"}
                        </td>
                        <td className="row-actions">
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setEditing({
                                id: row.id,
                                staffId: row.staffId,
                                date: row.date,
                                clockIn: clockLabel(row.clockIn),
                                clockOut: row.clockOut == null ? "" : clockLabel(row.clockOut),
                                reason: "",
                              })
                            }
                          >
                            정정
                          </Button>
                          <Button variant="ghost" onClick={() => setRemoving(row)}>
                            삭제
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">이 달의 출퇴근 기록이 없습니다.</p>
          )}
        </div>
      </section>
      {editing && (
        <AttendanceForm
          initial={editing}
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

function AttendanceForm({ initial, staff, runAction, notify, close }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
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
      onClose={busy ? undefined : close}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
      footer={
        <Button form="attendance-form" type="submit" variant="primary" busy={busy}>
          저장
        </Button>
      }
    >
      <form id="attendance-form" className="stack" onSubmit={submit}>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        <div className="grid grid-2">
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
          <Field label="근무일">
            <DateInput
              className="input"
              type="date"
              required
              max={today()}
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="출근 시각">
            <input
              type="time"
              required
              value={form.clockIn}
              onChange={(e) => set("clockIn", e.target.value)}
            />
          </Field>
          <Field label="퇴근 시각" help="비우면 근무 중으로 남습니다.">
            <input
              type="time"
              value={form.clockOut}
              onChange={(e) => set("clockOut", e.target.value)}
            />
          </Field>
        </div>
        <Field label="정정 사유">
          <input
            required
            maxLength={300}
            placeholder="예: 퇴근 기록 누락, 지문 인식 오류"
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
          />
        </Field>
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
      <p>
        {staffName(data, row.staffId)} · {dateLabel(row.date)}{" "}
        {clockLabel(row.clockIn)}–{clockLabel(row.clockOut)}
      </p>
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
    <section className="card">
      <div className="card-header">
        <h2>{year}년 연차 현황</h2>
        <div className="row">
          <Button variant="ghost" onClick={() => setYear(year - 1)} aria-label="이전 해">
            ‹
          </Button>
          <Button variant="ghost" onClick={() => setYear(year + 1)} aria-label="다음 해">
            ›
          </Button>
        </div>
      </div>
      <div className="card-body table-wrap">
        <table className="table commerce-table commerce-mobile-cards">
          <thead>
            <tr>
              <th>직원</th>
              <th>입사일</th>
              <th className="numeric">부여</th>
              <th className="numeric">사용</th>
              <th className="numeric">승인 대기</th>
              <th className="numeric">잔여</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((row) => {
              const balance = leaveBalance(data, row.id, year);
              return (
                <tr key={row.id}>
                  <td data-label="직원">{row.name}</td>
                  <td data-label="입사일">{row.hireDate || "미입력"}</td>
                  <td data-label="부여" className="numeric">{balance.allowance}일</td>
                  <td data-label="사용" className="numeric">{balance.used}일</td>
                  <td data-label="승인 대기" className="numeric">{balance.reserved}일</td>
                  <td data-label="잔여" className="numeric">
                    <strong>{balance.remaining}일</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="help">
          연차·반차만 차감합니다. 부여 일수는 직원 · 계정의 직원 정보에서
          변경합니다. 근로기준법상 발생 일수(1년 미만 월 1일, 1년 이상 15일
          + 가산)는 매장에서 확인해 입력해 주세요.
        </p>
      </div>
    </section>
  );
}

function Organization({ data }) {
  const teams = new Map();
  for (const row of data.staff.filter((s) => s.status === "active")) {
    const key = row.team || "소속 미지정";
    if (!teams.has(key)) teams.set(key, []);
    teams.get(key).push(row);
  }
  const history = [...(data.staffHistory || [])].sort((a, b) =>
    b.at.localeCompare(a.at),
  );
  const kinds = {
    hire: "입사",
    rehire: "재입사",
    resign: "퇴사",
    promotion: "승진·직책 변경",
    transfer: "부서 이동",
    update: "정보 변경",
  };
  const value = (row, raw) =>
    row.field === "role"
      ? roleLabel(raw)
      : row.field === "status"
        ? raw === "active"
          ? "재직"
          : raw
            ? "퇴사·비활성"
            : ""
        : raw || "없음";
  return (
    <>
      <section className="card">
        <div className="card-header">
          <h2>조직도</h2>
        </div>
        <div className="card-body">
          <div className="org-chart">
            <div className="org-root">
              <strong>{data.store.name}</strong>
              <span className="help">
                대표 {data.store.representative ||
                  data.staff.find((s) => s.role === "owner")?.name ||
                  ""}
              </span>
            </div>
            <div className="org-teams">
              {[...teams.entries()].map(([team, members]) => (
                <div key={team} className="org-team">
                  <h3>
                    {team} <span className="help">{members.length}명</span>
                  </h3>
                  <ul>
                    {members.map((row) => (
                      <li key={row.id}>
                        <strong>{row.name}</strong>
                        <span className="help">
                          {row.title || roleLabel(row.role)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <p className="help">
            팀과 직위는 직원 · 계정의 직원 정보에서 지정합니다.
          </p>
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <h2>인사 발령 이력</h2>
        </div>
        <div className="card-body">
          {history.length ? (
            <div className="table-wrap">
              <table className="table commerce-table commerce-mobile-cards">
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>직원</th>
                    <th>구분</th>
                    <th>변경 내용</th>
                    <th>처리자</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td data-label="일자">{row.date}</td>
                      <td data-label="직원">{staffName(data, row.staffId)}</td>
                      <td data-label="구분">{kinds[row.kind] || row.kind}</td>
                      <td data-label="변경 내용">
                        {row.kind === "hire"
                          ? "직원 등록"
                          : `${row.label}: ${value(row, row.before)} → ${value(row, row.after)}`}
                      </td>
                      <td data-label="처리자">{row.actorName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              직원 정보에서 직책·팀·직위·재직 상태를 바꾸면 자동으로 기록됩니다.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function certificateHtml(certificate) {
  const s = certificate.snapshot,
    store = certificate.store;
  const employment = certificate.type === "employment";
  const rows = [
    ["성명", s.name],
    ["생년월일", koreanDate(s.birthDate)],
    ["주소", s.address],
    ["소속", [s.team, s.title || roleLabel(s.role)].filter(Boolean).join(" / ")],
    ["담당 업무", s.duties],
    [
      employment ? "재직 기간" : "근무 기간",
      `${koreanDate(s.hireDate)} ~ ${employment ? "현재" : koreanDate(s.resignDate) || "현재"}`,
    ],
    ["용도", certificate.purpose],
  ].filter(([, value]) => value);
  return `
    <div class="certificate">
      <p class="number">발급번호 제 ${escapeHtml(certificate.number)} 호</p>
      ${store.logo ? `<img class="logo" src="${escapeHtml(store.logo)}" alt="">` : ""}
      <h1>${employment ? "재 직 증 명 서" : "경 력 증 명 서"}</h1>
      <table>${rows
        .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
        .join("")}</table>
      <p class="statement">위와 같이 ${employment ? "재직하고 있음" : "근무하였음"}을 증명합니다.</p>
      <p class="date">${escapeHtml(koreanDate(certificate.issuedDate))}</p>
      <div class="issuer">
        <p><strong>${escapeHtml(store.name)}</strong></p>
        ${store.businessNumber ? `<p>사업자등록번호 ${escapeHtml(store.businessNumber)}</p>` : ""}
        ${store.address ? `<p>${escapeHtml(store.address)}</p>` : ""}
        ${store.phone ? `<p>전화 ${escapeHtml(store.phone)}</p>` : ""}
        <p class="sign">대표 ${escapeHtml(store.representative || "")} (인)</p>
      </div>
    </div>`;
}
const CERTIFICATE_CSS = `
  .certificate{max-width:640px;margin:24px auto;font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#111}
  .number{font-size:12px;color:#555}
  .logo{max-height:56px;display:block;margin:8px auto}
  h1{text-align:center;font-size:28px;letter-spacing:4px;margin:24px 0 32px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{border:1px solid #333;padding:10px 12px;text-align:left}
  th{width:120px;background:#f3f4f6;font-weight:600}
  .statement{text-align:center;margin:40px 0 16px;font-size:15px}
  .date{text-align:center;margin-bottom:40px}
  .issuer{text-align:center;line-height:1.6}
  .issuer p{margin:0}
  .sign{margin-top:12px!important;font-size:16px}`;

function Certificates({ data, runAction, notify }) {
  const blank = { staffId: "", type: "employment", purpose: "", duties: "" };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const staff = data.staff.find((row) => row.id === form.staffId);
  const issued = [...(data.certificates || [])].sort((a, b) =>
    b.issuedAt.localeCompare(a.issuedAt),
  );
  const print = (certificate) =>
    printDocument(
      `${certificate.type === "employment" ? "재직증명서" : "경력증명서"} ${certificate.number}`,
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
    <div className="grid grid-2 workforce-split">
      <section className="card">
        <div className="card-header">
          <h2>증명서 발급</h2>
        </div>
        <form className="card-body stack" onSubmit={issue}>
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
          <Field label="종류">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="employment">재직증명서</option>
              <option value="career">경력증명서</option>
            </select>
          </Field>
          <Field label="담당 업무 (선택)">
            <input
              maxLength={200}
              placeholder="예: 헤어 디자인, 고객 상담"
              value={form.duties}
              onChange={(e) => setForm({ ...form, duties: e.target.value })}
            />
          </Field>
          <Field label="용도">
            <input
              required
              maxLength={100}
              placeholder="예: 금융기관 제출, 이직"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </Field>
          {staff && !staff.hireDate && (
            <p className="alert alert-warning">
              직원 정보에 입사일이 없습니다. 직원 · 계정에서 먼저 입력해 주세요.
            </p>
          )}
          {!data.store.representative && (
            <p className="help">
              대표자명·사업자등록번호는 설정 · 백업의 매장 정보에서 입력하면
              증명서에 표시됩니다.
            </p>
          )}
          <Button type="submit" variant="primary" busy={busy}>
            발급하고 인쇄
          </Button>
        </form>
      </section>
      <section className="card">
        <div className="card-header">
          <h2>발급 대장</h2>
        </div>
        <div className="card-body">
          {issued.length ? (
            <ul className="leave-list">
              {issued.map((row) => (
                <li key={row.id}>
                  <strong>
                    {row.number} · {row.snapshot.name}
                  </strong>
                  <span>
                    {row.type === "employment" ? "재직증명서" : "경력증명서"} ·{" "}
                    {row.purpose}
                  </span>
                  <span className="muted">
                    {timestampLabel(row.issuedAt)} · {row.issuedBy}
                  </span>
                  <Button variant="ghost" onClick={() => print(row)}>
                    다시 인쇄
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">발급한 증명서가 없습니다.</p>
          )}
          <p className="help">
            발급 당시 직원·매장 정보로 보관되어 재인쇄해도 내용이 같습니다.
          </p>
        </div>
      </section>
    </div>
  );
}

function Severance({ data }) {
  const day = today();
  const staff = data.staff.filter((row) => row.hireDate);
  return (
    <section className="card">
      <div className="card-header">
        <h2>퇴직금 추정</h2>
      </div>
      <div className="card-body">
        {staff.length ? (
          <div className="table-wrap">
            <table className="table commerce-table commerce-mobile-cards">
              <thead>
                <tr>
                  <th>직원</th>
                  <th>입사일</th>
                  <th className="numeric">재직일수</th>
                  <th className="numeric">1일 평균임금</th>
                  <th className="numeric">추정 퇴직금</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((row) => {
                  const estimate = severanceEstimate(data, row, day);
                  return (
                    <tr key={row.id}>
                      <td data-label="직원">
                        {row.name}
                        {row.status !== "active" && <span className="help"> · 퇴사</span>}
                      </td>
                      <td data-label="입사일">{row.hireDate}</td>
                      <td data-label="재직일수" className="numeric">
                        {estimate.serviceDays.toLocaleString("ko-KR")}일
                      </td>
                      <td data-label="1일 평균임금" className="numeric">
                        {estimate.daily ? won(estimate.daily) : "확정 급여 없음"}
                      </td>
                      <td data-label="추정 퇴직금" className="numeric">
                        {!estimate.eligible ? (
                          <span className="help">1년 미만 · 지급 대상 아님</span>
                        ) : estimate.amount != null ? (
                          <strong>{won(estimate.amount)}</strong>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">입사일이 입력된 직원이 없습니다.</p>
        )}
        <p className="help">
          1일 평균임금 = 최근 3개월 확정·지급 급여명세의 지급 합계 ÷ 해당 월
          일수, 퇴직금 = 1일 평균임금 × 30일 × 재직일수 ÷ 365. 상여금·연차수당
          가산과 퇴직연금(DB·DC) 가입 여부에 따라 실제 금액이 달라지므로 노무
          담당자와 확인하세요.
        </p>
      </div>
    </section>
  );
}
