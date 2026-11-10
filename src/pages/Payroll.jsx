import { DateInput } from "../components/DateInput.jsx";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useViewState } from "../components/ViewState";
import Icon from "../components/Icon";
import {
  Button,
  Modal,
  Field,
  EmptyState,
  ConfirmDialog,
} from "../components/ui";
import "./Payroll.css";

const statusText = {
  draft: "작성 중",
  finalized: "확정",
  paid: "지급 완료",
};
const statusTone = {
  draft: "status-warn",
  finalized: "pay-status-final",
  paid: "status-ok",
};
const roleText = {
  owner: "원장",
  manager: "매니저",
  designer: "디자이너",
  reception: "접수",
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const format = (value) => Number(value || 0).toLocaleString("ko-KR");
function nextPayDate(month) {
  const [year, m] = month.split("-").map(Number);
  return `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-05`;
}
function shiftMonth(month, offset) {
  const [year, value] = (month || today().slice(0, 7)).split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}
function getRevenue(data, staffId, month) {
  let gross = 0,
    refunded = 0;
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))
    return { gross, refunded, net: 0 };
  for (const tx of data.transactions || []) {
    if (tx.staffId !== staffId) continue;
    const services = (tx.lines || []).filter((line) => line.type === "service");
    if (tx.date?.startsWith(month))
      gross += services.reduce((sum, line) => sum + line.total, 0);
    for (const refund of data.refunds || [])
      if (refund.transactionId === tx.id && refund.date?.startsWith(month))
        refunded += (refund.lines || [])
          .filter((line) =>
            services.some((service) => service.id === line.lineId),
          )
          .reduce((sum, line) => sum + line.amount, 0);
  }
  return { gross, refunded, net: gross - refunded };
}
const INSURANCE = ["국민연금", "건강보험", "장기요양보험", "고용보험"];
const DEFAULT_RATES = {
  pension: 4.75,
  health: 3.595,
  care: 13.14,
  employment: 0.9,
};
const floor10 = (value) => Math.max(0, Math.floor(value / 10) * 10);
/** Employee-side social insurance estimates from the taxable base. */
export function insuranceDeductions(base, rates = {}) {
  const r = { ...DEFAULT_RATES, ...rates };
  const health = floor10((base * r.health) / 100);
  return [
    { name: "국민연금", amount: floor10((base * r.pension) / 100) },
    { name: "건강보험", amount: health },
    { name: "장기요양보험", amount: floor10((health * r.care) / 100) },
    { name: "고용보험", amount: floor10((base * r.employment) / 100) },
  ];
}
/** Work days/hours from clock records and approved overtime requests in the month. */
export function attendanceSummary(data, staffId, month) {
  const staff = (data.staff || []).find((entry) => entry.id === staffId);
  const records = (data.attendance || []).filter(
    (entry) =>
      entry.staffId === staffId &&
      entry.date?.startsWith(month) &&
      entry.clockIn != null &&
      entry.clockOut != null,
  );
  let minutes = 0;
  for (const entry of records) {
    let worked = entry.clockOut - entry.clockIn;
    if (staff?.breakStart != null && staff?.breakEnd != null)
      worked -= Math.max(
        0,
        Math.min(entry.clockOut, staff.breakEnd) -
          Math.max(entry.clockIn, staff.breakStart),
      );
    minutes += Math.max(0, worked);
  }
  const overtime = (data.staffRequests || [])
    .filter(
      (entry) =>
        entry.staffId === staffId &&
        entry.kind === "overtime" &&
        entry.status === "approved" &&
        entry.from?.startsWith(month),
    )
    .reduce((sum, entry) => sum + (entry.minutes || 0), 0);
  return {
    days: records.length,
    hours: Math.round((minutes / 60) * 10) / 10,
    overtime: Math.round((overtime / 60) * 10) / 10,
  };
}
const monthTitle = (month = "") =>
  `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
const dayTitle = (date) =>
  date ? `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일` : "없음";
const seoulParts = (value) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
/** "11월 3일 09:40" in Seoul time. */
const shortDateTime = (value) => {
  if (!value) return "";
  const p = seoulParts(value);
  return `${Number(p.month)}월 ${Number(p.day)}일 ${p.hour}:${p.minute}`;
};
/** "2026-11-07 18:20" in Seoul time, for the printed copy. */
const isoDateTime = (value) => {
  if (!value) return "";
  const p = seoulParts(value);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
/** "2026년 11월 10일" */
const fullDate = (date) =>
  date
    ? `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`
    : "없음";
/** "10월 1일부터 31일까지" when both ends fall in one month. */
function periodLabel(from, to) {
  if (!from || !to) return "없음";
  if (from.slice(0, 7) === to.slice(0, 7))
    return `${dayTitle(from)}부터 ${Number(to.slice(8, 10))}일까지`;
  return `${dayTitle(from)}부터 ${dayTitle(to)}까지`;
}
const hoursText = (value, unit) =>
  value == null || value === "" ? "미입력" : `${value}${unit}`;
const minus = (value) =>
  Number(value || 0) > 0 ? `−${format(value)}원` : `${format(value)}원`;
function basisLabel(record) {
  const rate = Number(record.commissionRate || 0);
  if (rate > 0) return `기본급과 인센티브 ${rate}%`;
  if (record.allowances?.length)
    return `기본급과 수당 ${record.allowances.length}건`;
  return "기본급";
}
const changeText = {
  created: "작성",
  updated: "수정",
  finalized: "확정",
  reopened: "확정 취소",
  paid: "지급 완료",
};
function initialForm(month, staffId) {
  return {
    staffId,
    month,
    payDate: nextPayDate(month),
    basePay: "",
    commissionRate: "0",
    allowances: [],
    deductions: [],
    workDays: "",
    workHours: "",
    overtimeHours: "",
    basis: "",
    notes: "",
  };
}
function PayrollForm({ data, initial, busy, error, helper, onSubmit, onClose }) {
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [copySource, setCopySource] = useState(null);
  const [copiedFrom, setCopiedFrom] = useState(null);
  const [intent, setIntent] = useState("draft");
  const finalizeRef = useRef(false);
  const ids = useId();
  const set = (key, value) => {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const identityLocked = Boolean(
    initial.changes?.some((change) => change.kind === "finalized"),
  );
  const taken = (staffId) =>
    (data.payroll || []).some(
      (record) =>
        record.id !== initial.id &&
        record.staffId === staffId &&
        record.month === form.month,
    );
  const existing = (data.payroll || []).find(
    (record) =>
      record.id !== initial.id &&
      record.staffId === form.staffId &&
      record.month === form.month,
  );
  const previous = (data.payroll || [])
    .filter(
      (record) =>
        record.staffId === form.staffId &&
        record.month < form.month &&
        record.status !== "draft",
    )
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const copyPrevious = () => {
    setForm((current) => ({
      ...current,
      basePay: copySource.basePay,
      commissionRate: copySource.commissionRate,
      allowances: copySource.allowances.map((item) => ({ ...item })),
      deductions: copySource.deductions.map((item) => ({ ...item })),
      basis: copySource.basis || "",
      workDays: "",
      workHours: "",
      overtimeHours: "",
      notes: "",
    }));
    setDirty(true);
    setCopiedFrom({
      month: copySource.month,
      staffId: copySource.staffId,
      name: copySource.staffSnapshot?.name,
    });
    setCopySource(null);
  };
  const revenue = getRevenue(data, form.staffId, form.month);
  const commission = Math.round(
    (Math.max(0, revenue.net) * Number(form.commissionRate || 0)) / 100,
  );
  const allowances = form.allowances.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const deductions = form.deductions.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const earnings = Number(form.basePay || 0) + commission + allowances;
  const net = earnings - deductions;
  const [helperNote, setHelperNote] = useState("");
  const loadAttendance = () => {
    const summary = attendanceSummary(data, form.staffId, form.month);
    if (!summary.days && !summary.overtime) {
      setHelperNote("이 달의 출퇴근 기록과 승인된 연장 근무가 없어요.");
      return;
    }
    setDirty(true);
    setForm((current) => ({
      ...current,
      workDays: String(summary.days),
      workHours: String(Math.max(summary.hours, summary.overtime)),
      overtimeHours: String(summary.overtime),
    }));
    setHelperNote(
      `출퇴근 ${summary.days}일, ${summary.hours}시간과 승인된 연장 ${summary.overtime}시간을 불러왔어요. 휴게 시간은 직원 근무 설정대로 뺐어요.`,
    );
  };
  const applyInsurance = () => {
    const base = Number(form.basePay || 0) + commission + allowances;
    if (!base) {
      setHelperNote("기본급이나 지급 항목을 먼저 입력해 주세요.");
      return;
    }
    const computed = insuranceDeductions(base, data.store?.payrollRates);
    setDirty(true);
    setForm((current) => ({
      ...current,
      deductions: [
        ...current.deductions.filter((item) => !INSURANCE.includes(item.name)),
        ...computed.map((item) => ({ ...item, amount: String(item.amount) })),
      ],
    }));
    setHelperNote(
      `과세 기준 ${format(base)}원으로 4대보험 근로자 부담분을 계산했어요. 비과세 수당이 있으면 금액을 고쳐 주세요.`,
    );
  };
  useEffect(() => {
    if (helper === "attendance") loadAttendance();
    if (helper === "insurance") applyInsurance();
  }, []);
  const addItem = (key) => set(key, [...form[key], { name: "", amount: "" }]);
  const updateItem = (key, index, patch) =>
    set(
      key,
      form[key].map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );
  const itemRow = (key, title, item, index) => (
    <div
      className={`pay-item ${key === "deductions" ? "pay-item-deduct" : ""}`}
      key={index}
    >
      <input
        className="pay-item-name"
        aria-label={`${title} ${index + 1} 항목명`}
        placeholder="항목 이름"
        required
        maxLength={60}
        value={item.name}
        onChange={(event) => updateItem(key, index, { name: event.target.value })}
      />
      <span className="pay-unit-input">
        <input
          type="number"
          className="num"
          aria-label={`${title} ${index + 1} 금액`}
          required
          min="0"
          step="1"
          value={item.amount}
          onChange={(event) =>
            updateItem(key, index, { amount: event.target.value })
          }
        />
        <span aria-hidden="true">원</span>
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={`${title} ${index + 1} 삭제`}
        onClick={() =>
          set(
            key,
            form[key].filter((_, i) => i !== index),
          )
        }
      >
        <Icon name="trash" size={20} />
      </button>
    </div>
  );
  return (
    <Modal
      title={initial.id ? "명세서 수정" : "명세서 작성"}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      size="wide"
      footer={
        <div className="pay-form-footer">
          <span className="payroll-preview">
            <span className="small muted">실지급액</span>
            <strong className="num">{format(net)}원</strong>
            <span className="small muted">
              지급 {format(earnings)}원에서 공제 {format(deductions)}원을 뺐어요
            </span>
          </span>
          <div className="pay-form-buttons">
            <Button
              type="submit"
              form="payslip-form"
              variant="secondary"
              busy={busy && intent === "draft"}
              disabled={busy || Boolean(existing)}
              onClick={() => {
                finalizeRef.current = false;
                setIntent("draft");
              }}
            >
              임시 저장
            </Button>
            <Button
              type="submit"
              form="payslip-form"
              variant="primary"
              busy={busy && intent === "final"}
              disabled={busy || Boolean(existing)}
              onClick={() => {
                finalizeRef.current = true;
                setIntent("final");
              }}
            >
              저장하고 확정
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="payslip-form"
        className="pay-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !existing)
            onSubmit(form, { finalize: finalizeRef.current });
        }}
      >
        <fieldset disabled={busy} className="pay-fieldset">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="pay-grid-3">
            <Field label="직원">
              <select
                className="select"
                required
                disabled={identityLocked}
                value={form.staffId}
                onChange={(event) => set("staffId", event.target.value)}
              >
                <option value="">직원 선택</option>
                {data.staff.map((staff) => (
                  <option
                    key={staff.id}
                    value={staff.id}
                    disabled={taken(staff.id)}
                  >
                    {staff.name}
                    {staff.status === "inactive" ? " (퇴사)" : ""}
                    {taken(staff.id) ? " (명세서 있음)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="귀속월">
              <DateInput
                className="input"
                type="month"
                min="2000-01"
                max="2099-12"
                required
                disabled={identityLocked}
                value={form.month}
                onChange={(event) => {
                  const month = event.target.value;
                  setDirty(true);
                  setForm((current) => ({
                    ...current,
                    month,
                    payDate:
                      current.payDate === nextPayDate(current.month) && month
                        ? nextPayDate(month)
                        : current.payDate,
                  }));
                }}
              />
            </Field>
            <Field label="지급 예정일">
              <DateInput
                className="input"
                type="date"
                required
                value={form.payDate}
                onChange={(event) => set("payDate", event.target.value)}
              />
            </Field>
          </div>
          {existing && (
            <div role="alert" className="alert alert-warning">
              이 직원의 {monthTitle(form.month)} 명세서가 이미 있어요. 목록에서
              기존 명세서를 열거나 다른 직원, 다른 달을 골라 주세요.
            </div>
          )}
          {previous && (
            <div className="pay-inset-row">
              <span className="pay-row-text">
                <span className="pay-row-title">
                  {monthTitle(previous.month)} 조건이 있어요
                </span>
                <span className="small muted">
                  기본급, 인센티브 비율, 수당, 공제, 계산 근거를 가져와요
                </span>
              </span>
              <Button variant="secondary" onClick={() => setCopySource(previous)}>
                이전 명세서 조건 불러오기
              </Button>
            </div>
          )}
          {copiedFrom && (
            <p
              className={
                copiedFrom.staffId === form.staffId
                  ? "small muted pay-note"
                  : "alert alert-warning"
              }
              role="status"
            >
              {copiedFrom.name}님의 {monthTitle(copiedFrom.month)} 조건을
              불러왔어요. 근무 기록과 메모는 비웠고, 인센티브는 고른 달의 매출로
              계산해요.
              {copiedFrom.staffId !== form.staffId &&
                " 직원이 바뀌었어요. 이 직원의 계약에 맞는 금액인지 확인해 주세요."}
            </p>
          )}
          <section className="pay-section" aria-labelledby={`${ids}-pay`}>
            <div className="pay-section-head">
              <h3 id={`${ids}-pay`}>지급</h3>
              <button
                type="button"
                className="text-btn pay-text-btn"
                onClick={() => addItem("allowances")}
                disabled={form.allowances.length >= 30}
              >
                항목 추가
              </button>
            </div>
            <div className="pay-row">
              <span className="pay-row-text">
                <label className="pay-row-title" htmlFor={`${ids}-base`}>
                  기본급
                </label>
                <span className="small muted">
                  {copiedFrom ? "지난달 조건 불러옴" : "월 정액"}
                </span>
              </span>
              <span className="pay-unit-input pay-wide-input">
                <input
                  id={`${ids}-base`}
                  className="num"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={form.basePay}
                  onChange={(event) => set("basePay", event.target.value)}
                />
                <span aria-hidden="true">원</span>
              </span>
            </div>
            <div className="pay-row">
              <span className="pay-row-text">
                <span className="pay-row-title">시술 인센티브</span>
                <span className="small muted">
                  순 시술 매출 {format(Math.max(0, revenue.net))}원의{" "}
                  {Number(form.commissionRate || 0)}%
                </span>
                {revenue.refunded > 0 && (
                  <span className="small muted">
                    시술 매출 {format(revenue.gross)}원에서 환불{" "}
                    {format(revenue.refunded)}원을 뺐어요
                  </span>
                )}
              </span>
              <span className="pay-unit-input pay-rate-input">
                <input
                  className="num"
                  aria-label="인센티브 비율"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  value={form.commissionRate}
                  onChange={(event) => set("commissionRate", event.target.value)}
                />
                <span aria-hidden="true">%</span>
              </span>
              <strong className="pay-row-value num">{format(commission)}원</strong>
            </div>
            {form.allowances.map((item, index) =>
              itemRow("allowances", "추가 지급", item, index),
            )}
            <span className="small muted">
              인센티브는 결제일 기준 할인 후 시술 매출에서 그 달 환불을 빼고
              계산해요. 저장하거나 확정할 때 최신 거래로 다시 계산해요.
            </span>
          </section>
          <section className="pay-section" aria-labelledby={`${ids}-deduct`}>
            <div className="pay-section-head">
              <h3 id={`${ids}-deduct`}>공제</h3>
              <span className="pay-head-actions">
                <button
                  type="button"
                  className="pay-pill"
                  onClick={applyInsurance}
                >
                  4대보험 계산
                </button>
                <button
                  type="button"
                  className="text-btn pay-text-btn"
                  onClick={() => addItem("deductions")}
                  disabled={form.deductions.length >= 30}
                >
                  항목 추가
                </button>
              </span>
            </div>
            {form.deductions.length > 0 ? (
              <div className="pay-grid-2">
                {form.deductions.map((item, index) =>
                  itemRow("deductions", "공제", item, index),
                )}
              </div>
            ) : (
              <p className="small muted pay-note">
                4대보험 계산을 누르거나 소득세 같은 항목을 추가해 주세요
              </p>
            )}
            <span className="small muted">요율은 설정에서 바꿔요</span>
            <span className="small muted">
              소득세와 지방소득세는 간이세액표를 보고 직접 넣어요
            </span>
          </section>
          <section className="pay-section" aria-labelledby={`${ids}-work`}>
            <div className="pay-section-head">
              <h3 id={`${ids}-work`}>근무 기록</h3>
              <button type="button" className="pay-pill" onClick={loadAttendance}>
                근태 불러오기
              </button>
            </div>
            <div className="pay-grid-3">
              {[
                ["workDays", "근무일", "일", 31, 1],
                ["workHours", "근무 시간", "시간", 744, 0.01],
                ["overtimeHours", "연장", "시간", 744, 0.01],
              ].map(([key, label, unit, max, step]) => (
                <div className="pay-tile" key={key}>
                  <label className="small muted" htmlFor={`${ids}-${key}`}>
                    {label}
                  </label>
                  <span className="pay-unit-input">
                    <input
                      id={`${ids}-${key}`}
                      className="num"
                      type="number"
                      min="0"
                      max={max}
                      step={step}
                      value={form[key] ?? ""}
                      onChange={(event) => set(key, event.target.value)}
                    />
                    <span aria-hidden="true">{unit}</span>
                  </span>
                </div>
              ))}
            </div>
            <span className="small muted">근무 시간에는 연장 시간이 들어가요</span>
          </section>
          {helperNote && (
            <p className="pay-helper-note" role="status">
              {helperNote}
            </p>
          )}
          <section className="pay-section" aria-labelledby={`${ids}-memo`}>
            <div className="pay-section-head">
              <h3 id={`${ids}-memo`}>메모</h3>
            </div>
            <Field
              label="계산 근거"
              help="예: 기본급은 월 정액, 연장 수당은 통상시급에 연장 시간과 배율을 곱해요"
            >
              <textarea
                className="textarea"
                rows="3"
                maxLength={2000}
                value={form.basis}
                onChange={(event) => set("basis", event.target.value)}
              />
            </Field>
            <Field label="명세서 메모" help="직원에게도 보여요">
              <textarea
                className="textarea"
                rows="2"
                maxLength={1000}
                value={form.notes}
                onChange={(event) => set("notes", event.target.value)}
              />
            </Field>
            <span className="small muted">
              계산 결과는 참고용이에요. 실제 보험료 고지액과 세액을 확인한 뒤
              확정해 주세요
            </span>
          </section>
        </fieldset>
      </form>
      {copySource && (
        <ConfirmDialog
          title="이전 급여 조건을 불러올까요?"
          confirmLabel="조건 불러오기"
          onClose={() => setCopySource(null)}
          onConfirm={copyPrevious}
        >
          <p>
            {monthTitle(copySource.month)}에 확정한{" "}
            {copySource.staffSnapshot?.name}님의 조건으로 지금 입력 중인 급여
            항목을 바꿔요.
          </p>
          <p>근무일수, 근로시간, 메모는 비워요.</p>
          <p>세금, 보험 공제와 수당은 이번 달 자료에 맞게 다시 확인해 주세요.</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
/** Paper copy of a payslip (PrintPayslip.dc.html). Only rendered for printing. */
function Statement({ record, className = "payroll-sheet" }) {
  const details = [
    ["직원명", record.staffSnapshot?.name],
    ["직책", roleText[record.staffSnapshot?.role] || "직원"],
    ["귀속기간", `${record.revenue.from}부터 ${record.revenue.to}까지`, true],
    [
      record.paidDate ? "실제 지급일" : "지급 예정일",
      record.paidDate || record.payDate,
    ],
    ["근무일수", hoursText(record.workDays, "일")],
    ["총 근로시간", hoursText(record.workHours, "시간")],
    ["연장 근로시간", hoursText(record.overtimeHours, "시간")],
  ];
  const earnings = [
    ["기본급", record.basePay],
    [`시술 인센티브 ${record.commissionRate}%`, record.commission],
    ...record.allowances.map((entry) => [entry.name, entry.amount]),
  ];
  return (
    <article className={className}>
      <header className="ps-head">
        <div className="ps-head-text">
          <span className="ps-store">
            <span className="ps-dot" aria-hidden="true" />
            {record.storeSnapshot?.name}
          </span>
          <h1>{monthTitle(record.month)} 급여명세서</h1>
        </div>
        <span className="ps-status">{statusText[record.status]}</span>
      </header>
      {record.status === "draft" && (
        <p className="ps-draft">
          아직 확정하지 않은 명세서예요. 확정할 때 최신 매출로 인센티브를 다시
          계산해요.
        </p>
      )}
      <dl className="ps-details">
        {details.map(([label, value, wide]) => (
          <div key={label} className={wide ? "ps-wide" : undefined}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="ps-cols">
        <section className="ps-section">
          <h2>지급 내역</h2>
          <div className="ps-box">
            {earnings.map(([label, amount], index) => (
              <div className="ps-line" key={index}>
                <span>{label}</span>
                <span>{format(amount)}원</span>
              </div>
            ))}
            <div className="ps-line ps-total">
              <strong>지급 합계</strong>
              <strong>{format(record.earningsTotal)}원</strong>
            </div>
          </div>
        </section>
        <section className="ps-section">
          <h2>공제 내역</h2>
          <div className="ps-box">
            {record.deductions.length ? (
              record.deductions.map((entry, index) => (
                <div className="ps-line" key={index}>
                  <span>{entry.name}</span>
                  <span>{format(entry.amount)}원</span>
                </div>
              ))
            ) : (
              <div className="ps-line">
                <span>공제 없음</span>
                <span>0원</span>
              </div>
            )}
            <div className="ps-line ps-total">
              <strong>공제 합계</strong>
              <strong>{format(record.deductionTotal)}원</strong>
            </div>
          </div>
        </section>
      </div>
      <div className="ps-net">
        <span>실지급액</span>
        <strong>{format(record.netPay)}원</strong>
      </div>
      <div className="ps-cols">
        <section className="ps-section">
          <h2>인센티브 계산 근거</h2>
          <div className="ps-lines">
            <span>시술 매출 {format(record.revenue.gross)}원</span>
            <span>시술 환불 {format(record.revenue.refunded)}원</span>
            <span>순매출 {format(record.revenue.net)}원</span>
            <span>
              인센티브 기준 {format(Math.max(0, record.revenue.net))}원의{" "}
              {record.commissionRate}%는 {format(record.commission)}원이에요. 원
              단위에서 반올림해요.
            </span>
            {record.revenue.method && (
              <span className="ps-note">{record.revenue.method}</span>
            )}
          </div>
        </section>
        <section className="ps-section">
          <h2>지급과 공제 계산 근거</h2>
          <span className="payroll-preserve">
            {record.basis || "입력된 계산 근거가 없어요."}
          </span>
          {record.notes && (
            <>
              <h2 className="ps-subhead">전달 사항</h2>
              <span className="payroll-preserve">{record.notes}</span>
            </>
          )}
        </section>
      </div>
      <footer className="ps-foot">
        <div className="ps-lines">
          <span className="ps-foot-store">{record.storeSnapshot?.name}</span>
          {record.storeSnapshot?.phone && <span>{record.storeSnapshot.phone}</span>}
          {record.storeSnapshot?.address && (
            <span>{record.storeSnapshot.address}</span>
          )}
        </div>
        <div className="ps-lines">
          <span>세금, 보험료, 수당은 입력된 금액이에요.</span>
          <span>지급 완료 표시는 계좌 이체를 실행하지 않아요.</span>
          <span>명세서 번호 {record.id}</span>
          {record.finalizedAt && <span>확정 {isoDateTime(record.finalizedAt)}</span>}
        </div>
      </footer>
    </article>
  );
}
/** Read-only label/value tile used across the payslip dialogs. */
function Tile({ label, value, sub }) {
  return (
    <div className="pv-tile">
      <span className="pv-label">{label}</span>
      <span className="pv-value num">{value}</span>
      {sub && <span className="pv-label">{sub}</span>}
    </div>
  );
}
const lastChange = (record, kind) =>
  [...(record.changes || [])].reverse().find((entry) => entry.kind === kind);
const changeTone = (kind) =>
  kind === "finalized"
    ? "pay-status-final"
    : kind === "paid"
      ? "status-ok"
      : "pay-tone-muted";
/** Full payslip inside the 급여명세서 dialog (PayslipView.dc.html). */
function SlipStatement({ record, manager }) {
  const rate = record.commissionRate;
  const changes = manager ? [...(record.changes || [])].reverse() : [];
  return (
    <div className="pv">
      <div className="pv-grid-4">
        <Tile label="직원명" value={record.staffSnapshot?.name} />
        <Tile
          label="직책"
          value={roleText[record.staffSnapshot?.role] || "직원"}
        />
        <Tile
          label="귀속기간"
          value={periodLabel(record.revenue.from, record.revenue.to)}
        />
        <Tile
          label={record.paidDate ? "실제 지급일" : "지급 예정일"}
          value={fullDate(record.paidDate || record.payDate)}
        />
      </div>
      {record.status === "draft" && (
        <div className="alert alert-warning">
          아직 확정하지 않은 명세서예요. 직원에게는 확정한 뒤 보이고, 확정할 때
          최신 매출로 인센티브를 다시 계산해요.
        </div>
      )}
      <section className="pv-section">
        <h3>근무 기록</h3>
        <div className="pv-grid-3">
          <Tile label="근무일수" value={hoursText(record.workDays, "일")} />
          <Tile label="총 근로시간" value={hoursText(record.workHours, "시간")} />
          <Tile
            label="연장 근로시간"
            value={hoursText(record.overtimeHours, "시간")}
          />
        </div>
      </section>
      <div className="pv-cols">
        <section className="pv-col">
          <h3>지급</h3>
          <div className="pv-row">
            <span className="pv-row-text">
              <span>기본급</span>
              <span className="pv-label">월 정액</span>
            </span>
            <span className="pv-amount num">{format(record.basePay)}원</span>
          </div>
          <div className="pv-row">
            <span className="pv-row-text">
              <span>시술 인센티브 {rate}%</span>
              <span className="pv-label">
                순매출 {format(Math.max(0, record.revenue.net))}원의 {rate}%
              </span>
            </span>
            <span className="pv-amount num">{format(record.commission)}원</span>
          </div>
          {record.allowances.map((entry, index) => (
            <div className="pv-row" key={index}>
              <span className="pv-row-text">
                <span>{entry.name}</span>
              </span>
              <span className="pv-amount num">{format(entry.amount)}원</span>
            </div>
          ))}
          <div className="pv-row pv-row-total">
            <span>지급 합계</span>
            <span className="pv-amount num">{format(record.earningsTotal)}원</span>
          </div>
        </section>
        <section className="pv-col">
          <h3>공제</h3>
          {record.deductions.length ? (
            record.deductions.map((entry, index) => (
              <div className="pv-row" key={index}>
                <span className="pv-row-text">
                  <span>{entry.name}</span>
                </span>
                <span className="pv-amount pay-minus num">{minus(entry.amount)}</span>
              </div>
            ))
          ) : (
            <div className="pv-row">
              <span className="pv-row-text">
                <span>공제 없음</span>
              </span>
              <span className="pv-amount num">0원</span>
            </div>
          )}
          <div className="pv-row pv-row-total">
            <span>공제 합계</span>
            <span className="pv-amount pay-minus num">
              {minus(record.deductionTotal)}
            </span>
          </div>
        </section>
      </div>
      <div className="pv-net">
        <span className="pv-row-text">
          <span className="pv-strong">실지급액</span>
          <span className="pv-label">
            지급 {format(record.earningsTotal)}원에서 공제{" "}
            {format(record.deductionTotal)}원을 뺐어요
          </span>
        </span>
        <strong className="num">{format(record.netPay)}원</strong>
      </div>
      <div className="pv-cols">
        <section className="pv-col">
          <h3>계산 근거</h3>
          <div className="pv-card">
            <span className="pv-card-title">인센티브</span>
            <div className="pv-kv">
              <span>시술 매출</span>
              <span className="num">{format(record.revenue.gross)}원</span>
            </div>
            <div className="pv-kv">
              <span>시술 환불</span>
              <span className={`num ${record.revenue.refunded > 0 ? "pay-minus" : ""}`}>
                {minus(record.revenue.refunded)}
              </span>
            </div>
            <div className="pv-kv pv-kv-strong">
              <span>순매출</span>
              <span className="num">{format(record.revenue.net)}원</span>
            </div>
            <span className="pv-label">
              순매출의 {rate}%를 원 단위에서 반올림해요
            </span>
            {record.revenue.method && (
              <span className="pv-label">{record.revenue.method}</span>
            )}
          </div>
          <div className="pv-card">
            <span className="pv-card-title">지급과 공제</span>
            <span className="payroll-preserve">
              {record.basis || "입력된 계산 근거가 없어요."}
            </span>
          </div>
          {record.notes && (
            <div className="pv-card">
              <span className="pv-card-title">전달 사항</span>
              <span className="payroll-preserve">{record.notes}</span>
            </div>
          )}
        </section>
        <section className="pv-col">
          {manager && <h3>변경 기록 {changes.length}건</h3>}
          {changes.map((entry, index) => (
            <div className="pv-card pv-change" key={index}>
              <span className={`pay-badge ${changeTone(entry.kind)}`}>
                {changeText[entry.kind] || entry.kind}
              </span>
              <span className="pv-row-text">
                <span className="pv-strong num">{shortDateTime(entry.at)}</span>
                {entry.actorName && (
                  <span className="pv-label">{entry.actorName}</span>
                )}
                {entry.reason && (
                  <span className="pv-label pv-reason">{entry.reason}</span>
                )}
              </span>
            </div>
          ))}
          <div className="pv-card pv-meta">
            <span className="pv-label">명세서 번호 {record.id}</span>
            <span className="pv-label">세금, 보험료, 수당은 입력한 금액이에요</span>
            <span className="pv-label">
              지급 완료로 기록해도 계좌 이체는 되지 않아요
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
function SlipPanel({ record, manager, onOpen, onPrint }) {
  const titleId = useId();
  const draft = record.status === "draft";
  const lines = [
    ["기본급", record.basePay],
    ...(Number(record.commissionRate) > 0 || record.commission
      ? [[`시술 인센티브 ${record.commissionRate}%`, record.commission]]
      : []),
    ...record.allowances.map((entry) => [entry.name, entry.amount]),
    ...record.deductions.map((entry) => [entry.name, -Number(entry.amount || 0)]),
  ];
  return (
    <aside className="pay-panel" aria-labelledby={titleId}>
      <div className="pay-panel-head">
        <h2 id={titleId}>
          {manager
            ? `${record.staffSnapshot?.name} ${Number(record.month.slice(5, 7))}월`
            : `${monthTitle(record.month)} 급여`}
        </h2>
        <span className="muted">{statusText[record.status]}</span>
        <span className="muted small">
          {record.paidDate
            ? `${dayTitle(record.paidDate)} 지급`
            : `${dayTitle(record.payDate)} 지급 예정`}
        </span>
      </div>
      <div className="pay-lines">
        {lines.map(([label, amount], index) => (
          <div className="pay-line" key={index}>
            <span>{label}</span>
            <span className={`num ${amount < 0 ? "pay-minus" : ""}`}>
              {amount < 0 ? `−${format(-amount)}` : format(amount)}원
            </span>
          </div>
        ))}
      </div>
      <div className="pay-net">
        <span>실지급액</span>
        <strong className="num">{format(record.netPay)}원</strong>
      </div>
      {manager && draft && (
        <>
          <span className="muted small">직원에게는 확정한 뒤 보여요</span>
          <div className="pay-panel-buttons">
            <Button
              variant="secondary"
              onClick={() =>
                onOpen({ kind: "edit", id: record.id, helper: "attendance" })
              }
            >
              근태 불러오기
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                onOpen({ kind: "edit", id: record.id, helper: "insurance" })
              }
            >
              4대보험 계산
            </Button>
          </div>
          <div className="pay-panel-actions">
            <Button
              variant="secondary"
              onClick={() => onOpen({ kind: "edit", id: record.id })}
            >
              수정
            </Button>
            <Button
              variant="primary"
              onClick={() => onOpen({ kind: "finalize", id: record.id })}
            >
              확정
            </Button>
          </div>
        </>
      )}
      {manager && record.status === "finalized" && (
        <div className="pay-panel-actions">
          <Button
            variant="secondary"
            onClick={() => onOpen({ kind: "reopen", id: record.id })}
          >
            확정 취소
          </Button>
          <Button
            variant="primary"
            onClick={() => onOpen({ kind: "paid", id: record.id })}
          >
            지급 완료 기록
          </Button>
        </div>
      )}
      <div className="pay-panel-foot">
        <button
          type="button"
          className="text-btn pay-text-btn"
          onClick={() => onOpen({ kind: "view", id: record.id })}
        >
          전체 명세서
        </button>
        <Button variant="secondary" onClick={onPrint}>
          <Icon name="print" size={20} />
          {draft ? "초안 인쇄" : "인쇄 / PDF 저장"}
        </Button>
      </div>
    </aside>
  );
}
export default function Payroll({
  data,
  user,
  runAction,
  notify,
  navigate,
  routeContext,
  personalOnly = false,
}) {
  const manager = !personalOnly && user.role === "owner";
  const availableRecords = useMemo(
    () =>
      (data.payroll || []).filter(
        (record) =>
          manager ||
          (record.staffId === user.staffId &&
            ["finalized", "paid"].includes(record.status)),
      ),
    [data.payroll, manager, user.staffId],
  );
  const [month, setMonth] = useViewState("payroll", "month", () =>
    manager
      ? today().slice(0, 7)
      : availableRecords
          .map((record) => record.month)
          .sort()
          .at(-1) || today().slice(0, 7),
  );
  const [staffId, setStaffId] = useViewState(
    "payroll",
    "staffId",
    manager ? routeContext?.staffId || "" : "",
  );
  const [status, setStatus] = useViewState("payroll", "status", "");
  const [selectedId, setSelectedId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [paidDate, setPaidDate] = useState(today());
  const [paidConfirmed, setPaidConfirmed] = useState(false);
  const dialogIds = useId();
  useEffect(() => {
    if (manager && routeContext?.staffId) {
      setStaffId(routeContext.staffId);
      setStatus("");
    }
  }, [routeContext?.staffId]);
  const records = useMemo(
    () =>
      availableRecords
        .filter(
          (item) =>
            item.month === month &&
            (!staffId || item.staffId === staffId) &&
            (!status || item.status === status),
        )
        .sort((a, b) =>
          (a.staffSnapshot?.name || "").localeCompare(
            b.staffSnapshot?.name || "",
            "ko",
          ),
        ),
    [availableRecords, month, staffId, status],
  );
  const current =
    records.find((item) => item.id === selectedId) || records[0] || null;
  const selected = dialog?.id
    ? availableRecords.find((item) => item.id === dialog.id)
    : null;
  const printable = (dialog?.kind === "view" && selected) || current;
  const open = (value) => {
    setError("");
    setReason("");
    setPaidDate(today());
    setPaidConfirmed(false);
    setDialog(value);
  };
  const close = () => {
    if (!busy) setDialog(null);
  };
  async function submit(type, payload, options = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await runAction(type, payload);
      let next = null;
      if (type === "payroll.save") {
        setMonth(payload.month);
        if (staffId && staffId !== payload.staffId) setStaffId(payload.staffId);
        if (status && status !== "draft") setStatus("");
        const saved = (result?.data?.payroll || []).find(
          (row) =>
            row.staffId === payload.staffId && row.month === payload.month,
        );
        if (saved) {
          setSelectedId(saved.id);
          if (options.finalize) next = { kind: "finalize", id: saved.id };
        }
      }
      if (type !== "payroll.save" && payload.id) setSelectedId(payload.id);
      setDialog(next);
      notify(
        type === "payroll.save"
          ? "급여명세서를 저장했습니다."
          : type === "payroll.finalize"
            ? "급여명세서를 확정했습니다. 직원이 내 급여에서 확인할 수 있습니다."
            : type === "payroll.paid"
              ? "급여 지급 완료를 기록했습니다."
              : "확정을 취소했습니다. 명세서를 수정할 수 있습니다.",
        "success",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function print() {
    document.body.classList.add("payroll-printing");
    const finish = () => {
      document.body.classList.remove("payroll-printing");
      window.removeEventListener("afterprint", finish);
    };
    window.addEventListener("afterprint", finish);
    try {
      window.print();
    } catch (err) {
      finish();
      notify(
        "인쇄 창을 열지 못했습니다. 브라우저의 인쇄 기능을 확인해 주세요.",
        "danger",
      );
    }
  }
  if (
    !manager &&
    !personalOnly &&
    !["manager", "designer", "reception"].includes(user.role)
  )
    return (
      <EmptyState
        title="급여 조회 권한이 없습니다"
        description="원장에게 문의해 주세요."
      />
    );
  const total = records.reduce((sum, item) => sum + item.netPay, 0);
  const drafts = records.filter((item) => item.status === "draft").length;
  const upcoming = records
    .filter((item) => item.status !== "paid")
    .map((item) => item.payDate)
    .filter(Boolean)
    .sort()[0];
  const lastPaid = records
    .map((item) => item.paidDate || item.payDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  const statusOptions = [
    ["", "전체"],
    ...Object.entries(statusText).filter(([key]) => manager || key !== "draft"),
  ];
  return (
    <div className="pay-page">
      <header className="pay-head">
        <div className="pay-head-text">
          <span className="muted">
            {manager ? `${Number(month.slice(5, 7))}월 귀속` : "확정된 명세서만 보여요"}
          </span>
          <h1 className="pay-title">{manager ? "급여" : "내 급여명세서"}</h1>
        </div>
        {manager && (
          <Button
            variant="primary"
            onClick={() =>
              data.staff.length ? open({ kind: "new" }) : navigate("staff")
            }
          >
            {data.staff.length ? "명세서 작성" : "직원 먼저 등록"}
          </Button>
        )}
      </header>
      <div className="pay-toolbar">
        <div className="pay-month">
          <button
            type="button"
            className="icon-btn"
            aria-label="이전 달 급여"
            disabled={month === "2000-01"}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <Field label="귀속월" className="pay-month-field">
            <DateInput
              className="input"
              type="month"
              min="2000-01"
              max="2099-12"
              required
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </Field>
          <button
            type="button"
            className="icon-btn"
            aria-label="다음 달 급여"
            disabled={month === "2099-12"}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <Icon name="chevron-right" size={20} />
          </button>
          <button
            type="button"
            className="text-btn pay-text-btn"
            onClick={() => setMonth(today().slice(0, 7))}
          >
            이번 달
          </button>
        </div>
        {manager && (
          <Field label="직원" className="pay-staff-field">
            <select
              className="select"
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            >
              <option value="">전체 직원</option>
              {data.staff.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div role="group" aria-label="상태" className="chip-row">
          {statusOptions.map(([key, label]) => (
            <button
              key={key || "all"}
              type="button"
              className="chip"
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="pay-stats">
        <div className="pay-stat">
          <span className="muted">{manager ? "지급 합계" : "실지급액 합계"}</span>
          <strong className="num">{format(total)}원</strong>
        </div>
        {manager ? (
          <div className="pay-stat">
            <span className="muted">확정 전</span>
            <strong className={`num ${drafts ? "pay-warn" : ""}`}>{drafts}명</strong>
          </div>
        ) : (
          <div className="pay-stat">
            <span className="muted">명세서</span>
            <strong className="num">{records.length}건</strong>
          </div>
        )}
        <div className="pay-stat">
          <span className="muted">{manager ? "지급 예정일" : "지급일"}</span>
          <strong className="num">{dayTitle(manager ? upcoming : lastPaid)}</strong>
        </div>
      </div>
      <div className="pay-layout">
        <section aria-label="명세서 목록" className="pay-list">
          {records.length ? (
            records.map((record) => {
              const name = record.staffSnapshot?.name || "";
              const on = current?.id === record.id;
              return (
                <button
                  type="button"
                  key={record.id}
                  className="pay-slip"
                  aria-current={on ? "true" : undefined}
                  aria-label={`${name} ${record.month} 급여명세서 보기`}
                  onClick={() => setSelectedId(record.id)}
                >
                  <span className="pay-avatar" aria-hidden="true">
                    {manager ? name.slice(0, 1) : Number(record.month.slice(5, 7))}
                  </span>
                  <span className="pay-slip-text">
                    <span className="pay-slip-name">
                      {manager ? name : monthTitle(record.month)}
                    </span>
                    <span className="small muted">{basisLabel(record)}</span>
                  </span>
                  <span className={`pay-badge ${statusTone[record.status]}`}>
                    {statusText[record.status]}
                  </span>
                  <strong className="pay-slip-net num">
                    {format(record.netPay)}원
                  </strong>
                </button>
              );
            })
          ) : (
            <EmptyState
              title="이 달의 급여명세서가 없어요"
              description={
                manager
                  ? "명세서를 작성하거나 귀속월과 조건을 바꿔 보세요."
                  : "명세서가 확정되면 여기에 보여요. 귀속월을 바꿔 이전 명세서도 볼 수 있어요."
              }
              action={
                manager ? (
                  <Button variant="primary" onClick={() => open({ kind: "new" })}>
                    첫 명세서 작성
                  </Button>
                ) : undefined
              }
            />
          )}
        </section>
        {current && (
          <SlipPanel
            record={current}
            manager={manager}
            onOpen={open}
            onPrint={print}
          />
        )}
      </div>
      <p className="small muted">
        {manager
          ? "실제 이체와 세금 신고는 따로 처리해요. 지급 완료 금액이 틀렸다면 다음 급여에서 항목과 사유를 남겨 조정해 주세요."
          : "금액이 다르면 원장에게 문의해 주세요."}
      </p>
      {printable &&
        createPortal(
          <div className="payroll-print-root" aria-hidden="true">
            <Statement record={printable} className="payroll-sheet payroll-statement" />
          </div>,
          document.body,
        )}
      {(dialog?.kind === "new" || (dialog?.kind === "edit" && selected)) && (
        <PayrollForm
          key={selected?.id || "new"}
          data={data}
          helper={dialog.helper}
          initial={
            selected ||
            initialForm(
              month || today().slice(0, 7),
              (staffId &&
              !(data.payroll || []).some(
                (item) => item.staffId === staffId && item.month === month,
              )
                ? staffId
                : "") ||
                data.staff.find(
                  (staff) =>
                    staff.status === "active" &&
                    !(data.payroll || []).some(
                      (item) =>
                        item.staffId === staff.id && item.month === month,
                    ),
                )?.id ||
                "",
            )
          }
          busy={busy}
          error={error}
          onSubmit={(form, options) => submit("payroll.save", form, options)}
          onClose={close}
        />
      )}
      {dialog?.kind === "view" && selected && (
        <Modal
          title={
            <>
              {monthTitle(selected.month)} 급여명세서
              <span className={`pay-badge pay-title-badge ${statusTone[selected.status]}`}>
                {statusText[selected.status]}
              </span>
            </>
          }
          subtitle={selected.storeSnapshot?.name || undefined}
          onClose={close}
          size="wide"
          footer={
            <>
              <Button variant="secondary" className="pay-foot-print" onClick={print}>
                <Icon name="print" size={20} />
                {selected.status === "draft" ? "초안 인쇄" : "인쇄 / PDF 저장"}
              </Button>
              {manager && selected.status === "draft" && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => open({ kind: "edit", id: selected.id })}
                  >
                    수정
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => open({ kind: "finalize", id: selected.id })}
                  >
                    확정
                  </Button>
                </>
              )}
              {manager && selected.status === "finalized" && (
                <>
                  <span className="small muted pay-foot-hint">
                    확정을 취소하면 다시 수정할 수 있어요
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => open({ kind: "reopen", id: selected.id })}
                  >
                    확정 취소
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => open({ kind: "paid", id: selected.id })}
                  >
                    지급 완료 기록
                  </Button>
                </>
              )}
            </>
          }
        >
          <SlipStatement record={selected} manager={manager} />
        </Modal>
      )}
      {dialog?.kind === "finalize" && selected && (
        <ConfirmDialog
          title="급여명세서를 확정할까요?"
          onClose={close}
          onConfirm={() => submit("payroll.finalize", { id: selected.id })}
          busy={busy}
          confirmLabel="최신 매출로 계산 후 확정"
        >
          <p>
            {selected.staffSnapshot?.name}님의 {monthTitle(selected.month)}{" "}
            급여예요. 확정하면 직원에게 명세서가 보여요.
          </p>
          <div className="alert alert-warning">
            확정할 때 최신 매출과 환불로 인센티브를 다시 계산해요. 확정한 뒤
            금액을 한 번 더 확인하고 지급해 주세요.
          </div>
          {selected.month === today().slice(0, 7) && (
            <p className="help">
              아직 끝나지 않은 달이에요. 확정 뒤에 생긴 매출과 환불은 자동으로
              반영되지 않아요.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </ConfirmDialog>
      )}
      {dialog?.kind === "reopen" && selected && (
        <Modal
          title="급여 확정 취소"
          subtitle={`${selected.staffSnapshot?.name || ""} ${monthTitle(selected.month)} 급여`}
          onClose={busy ? undefined : close}
          dirty={Boolean(reason)}
          footer={
            <>
              <Button variant="secondary" onClick={close} disabled={busy}>
                돌아가기
              </Button>
              <Button
                type="submit"
                form="payroll-reopen-form"
                variant="danger"
                busy={busy}
              >
                확정 취소
              </Button>
            </>
          }
        >
          <form
            id="payroll-reopen-form"
            className="pay-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit("payroll.reopen", { id: selected.id, reason });
            }}
          >
            <div className="pv-grid-2">
              <Tile label="실지급액" value={`${format(selected.netPay)}원`} />
              <Tile
                label="확정한 때"
                value={
                  selected.finalizedAt ? shortDateTime(selected.finalizedAt) : "기록 없음"
                }
                sub={lastChange(selected, "finalized")?.actorName}
              />
            </div>
            <ul className="pay-checks">
              <li>
                <Icon name="check" size={20} />
                명세서를 작성 중으로 되돌려요
              </li>
              <li>
                <Icon name="check" size={20} />
                직원 화면에서는 다시 확정할 때까지 숨겨요
              </li>
              <li>
                <Icon name="check" size={20} />
                기존 확정 기록은 변경 기록에 그대로 남아요
              </li>
            </ul>
            <div className="field">
              <span className="pay-field-head">
                <label className="field-label" htmlFor={`${dialogIds}-reason`}>
                  취소 사유
                </label>
                <span className="small muted num" aria-hidden="true">
                  {reason.length}/500
                </span>
              </span>
              <textarea
                id={`${dialogIds}-reason`}
                aria-describedby={`${dialogIds}-reason-help`}
                disabled={busy}
                className="textarea"
                rows={4}
                required
                maxLength={500}
                placeholder="예: 연장 근무 수당 금액 정정"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <span id={`${dialogIds}-reason-help`} className="help">
                꼭 적어야 해요. 변경 기록에 함께 남아요
              </span>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
      {dialog?.kind === "paid" && selected && (
        <Modal
          title="실제 급여 지급 기록"
          subtitle={`${selected.staffSnapshot?.name || ""} ${monthTitle(selected.month)} 급여`}
          onClose={busy ? undefined : close}
          dirty={paidDate !== today() || paidConfirmed}
          footer={
            <>
              <Button variant="secondary" onClick={close} disabled={busy}>
                돌아가기
              </Button>
              <Button
                type="submit"
                form="payroll-paid-form"
                variant="primary"
                busy={busy}
                disabled={!paidConfirmed}
              >
                지급 완료로 기록
              </Button>
            </>
          }
        >
          <form
            id="payroll-paid-form"
            className="pay-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (paidConfirmed)
                submit("payroll.paid", { id: selected.id, paidDate });
            }}
          >
            <div className="pv-net">
              <span className="pv-row-text">
                <span className="pv-strong">실지급액</span>
                <span className="pv-label">
                  {selected.staffSnapshot?.name} 님에게 지급할 금액
                </span>
              </span>
              <strong className="num">{format(selected.netPay)}원</strong>
            </div>
            <div className="alert alert-warning pay-warn-box">
              <strong>실제로 이체한 뒤에 기록해 주세요</strong>
              <span>이 기록은 계좌 이체를 하지 않아요</span>
              <span>지급 완료 뒤에는 명세서를 고칠 수 없어요</span>
            </div>
            <div className="pv-grid-2">
              <Field
                label="실제 지급일"
                help={`${Number(selected.month.slice(5, 7))}월 1일부터 오늘까지 고를 수 있어요`}
              >
                <DateInput
                  disabled={busy}
                  className="input"
                  type="date"
                  required
                  max={today()}
                  min={`${selected.month}-01`}
                  value={paidDate}
                  onChange={(event) => setPaidDate(event.target.value)}
                />
              </Field>
            </div>
            <label className="pay-confirm-card">
              <input
                type="checkbox"
                required
                disabled={busy}
                checked={paidConfirmed}
                onChange={(event) => setPaidConfirmed(event.target.checked)}
              />
              <span className="pv-row-text">
                <span className="pv-strong">
                  {format(selected.netPay)}원을 {selected.staffSnapshot?.name} 님
                  계좌로 보냈어요
                </span>
                <span className="pv-label">체크해야 기록할 수 있어요</span>
              </span>
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
