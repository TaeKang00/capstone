import React, { useEffect, useMemo, useState } from "react";
import { useViewState } from "../components/ViewState";
import {
  Button,
  Modal,
  Field,
  Badge,
  EmptyState,
  Money,
  ConfirmDialog,
} from "../components/ui";
import "./Payroll.css";

const statusText = {
  draft: "작성 중",
  finalized: "확정 · 지급 대기",
  paid: "지급 완료",
};
const statusTone = { draft: "muted", finalized: "warning", paid: "success" };
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
function PayrollForm({ data, initial, busy, error, onSubmit, onClose }) {
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [copySource, setCopySource] = useState(null);
  const [copiedFrom, setCopiedFrom] = useState(null);
  const set = (key, value) => {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const identityLocked = Boolean(
    initial.changes?.some((change) => change.kind === "finalized"),
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
  const net = Number(form.basePay || 0) + commission + allowances - deductions;
  const itemFields = (key, title, examples) => (
    <section className="payroll-form-section">
      <div className="row">
        <h3>{title}</h3>
        <Button
          type="button"
          variant="secondary"
          onClick={() => set(key, [...form[key], { name: "", amount: "" }])}
          disabled={form[key].length >= 30}
        >
          항목 추가
        </Button>
      </div>
      {form[key].length === 0 && <p className="muted">{examples}</p>}
      {form[key].map((item, index) => (
        <div className="payroll-item-row" key={index}>
          <Field label={`${title} ${index + 1} 항목명`}>
            <input
              className="input"
              required
              maxLength={60}
              value={item.name}
              onChange={(event) =>
                set(
                  key,
                  form[key].map((entry, i) =>
                    i === index
                      ? { ...entry, name: event.target.value }
                      : entry,
                  ),
                )
              }
            />
          </Field>
          <Field label="금액 (원)">
            <input
              className="input"
              type="number"
              required
              min="0"
              step="1"
              value={item.amount}
              onChange={(event) =>
                set(
                  key,
                  form[key].map((entry, i) =>
                    i === index
                      ? { ...entry, amount: event.target.value }
                      : entry,
                  ),
                )
              }
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              set(
                key,
                form[key].filter((_, i) => i !== index),
              )
            }
            aria-label={`${title} ${index + 1} 삭제`}
          >
            삭제
          </Button>
        </div>
      ))}
    </section>
  );
  return (
    <Modal
      title={initial.id ? "급여명세서 수정" : "급여명세서 작성"}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      size="wide"
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !existing) onSubmit(form);
        }}
      >
        <fieldset
          disabled={busy}
          className="stack"
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="grid grid-3">
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
                    disabled={(data.payroll || []).some(
                      (record) =>
                        record.id !== initial.id &&
                        record.staffId === staff.id &&
                        record.month === form.month,
                    )}
                  >
                    {staff.name}
                    {staff.status === "inactive" ? " (퇴사·비활성)" : ""}
                    {(data.payroll || []).some(
                      (record) =>
                        record.id !== initial.id &&
                        record.staffId === staff.id &&
                        record.month === form.month,
                    )
                      ? " · 명세서 있음"
                      : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="급여 귀속월">
              <input
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
              <input
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
              선택한 직원의 {form.month} 명세서가 이미 있습니다. 목록에서 기존
              명세서를 열거나 다른 직원·귀속월을 선택해 주세요.
            </div>
          )}
          {previous && (
            <div className="alert">
              <div className="row">
                <strong>{previous.month} 급여 조건을 이어서 작성</strong>
                <Button onClick={() => setCopySource(previous)}>
                  이전 명세서 조건 불러오기
                </Button>
              </div>
              <p className="help">
                기본급·인센티브 비율·추가 지급·공제·계산 근거를 가져옵니다. 이번
                달 금액은 저장 전에 확인하세요.
              </p>
            </div>
          )}
          {copiedFrom && (
            <p
              className={
                copiedFrom.staffId === form.staffId
                  ? "help"
                  : "alert alert-warning"
              }
              role="status"
            >
              {copiedFrom.name}님의 {copiedFrom.month} 조건을 불러왔습니다. 근무
              내역·메모는 비웠으며, 선택한 귀속월의 매출로 인센티브를
              계산합니다.
              {copiedFrom.staffId !== form.staffId &&
                " 직원이 변경되었습니다. 현재 직원의 계약에 맞는 금액인지 확인하세요."}
            </p>
          )}
          <section className="payroll-form-section">
            <h3>기본급과 인센티브</h3>
            <div className="grid grid-2">
              <Field label="기본급 (원)">
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={form.basePay}
                  onChange={(event) => set("basePay", event.target.value)}
                />
              </Field>
              <Field
                label="시술 매출 인센티브 (%)"
                help="0~100%, 소수점 둘째 자리까지"
              >
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  value={form.commissionRate}
                  onChange={(event) =>
                    set("commissionRate", event.target.value)
                  }
                />
              </Field>
            </div>
            <div className="payroll-calculation">
              <span>
                해당 월 시술 매출 <strong>{format(revenue.gross)}원</strong>
              </span>
              <span>
                해당 월 시술 환불 <strong>−{format(revenue.refunded)}원</strong>
              </span>
              <span>
                예상 인센티브 <strong>{format(commission)}원</strong>
              </span>
            </div>
            <p className="help">
              결제일 기준 할인 후 시술 매출에서 해당 월 환불액을 뺍니다. 이전 달
              결제의 이번 달 환불도 반영하며 상품 매출은 제외합니다. 순매출이
              음수면 인센티브는 0원입니다. 저장·확정 시 최신 거래로 다시
              계산합니다.
            </p>
          </section>
          {itemFields(
            "allowances",
            "추가 지급",
            "식대, 직책수당, 연장근로수당 등을 항목별로 입력하세요.",
          )}
          {itemFields(
            "deductions",
            "공제",
            "확인한 소득세, 지방소득세, 보험료 등을 항목별로 입력하세요.",
          )}
          <div className="alert alert-warning">
            세금·4대보험·연장근로수당은 자동 산정하지 않습니다. 확인한 금액과
            계산 근거를 직접 입력하세요.
          </div>
          <section className="payroll-form-section">
            <h3>근무 내역과 계산 근거</h3>
            <div className="grid grid-3">
              <Field label="근무일수 (선택)">
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="31"
                  step="1"
                  value={form.workDays ?? ""}
                  onChange={(event) => set("workDays", event.target.value)}
                />
              </Field>
              <Field label="총 근로시간 (선택)" help="연장근로시간 포함">
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="744"
                  step="0.01"
                  value={form.workHours ?? ""}
                  onChange={(event) => set("workHours", event.target.value)}
                />
              </Field>
              <Field label="연장근로시간 (선택)">
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="744"
                  step="0.01"
                  value={form.overtimeHours ?? ""}
                  onChange={(event) => set("overtimeHours", event.target.value)}
                />
              </Field>
            </div>
            <Field
              label="지급·공제 계산 근거"
              help="예: 기본급 월 정액 / 연장수당: 통상시급 × 연장시간 × 적용 배율 / 공제액 산출 기준"
            >
              <textarea
                className="textarea"
                rows="3"
                maxLength={2000}
                value={form.basis}
                onChange={(event) => set("basis", event.target.value)}
              />
            </Field>
            <Field label="명세서 메모" help="직원에게도 표시됩니다.">
              <textarea
                className="textarea"
                rows="2"
                maxLength={1000}
                value={form.notes}
                onChange={(event) => set("notes", event.target.value)}
              />
            </Field>
          </section>
          <div className="payroll-preview">
            <span>예상 실지급액</span>
            <strong>{format(net)}원</strong>
            <small>
              지급 합계{" "}
              {format(Number(form.basePay || 0) + commission + allowances)}원 −
              공제 {format(deductions)}원
            </small>
          </div>
          <div className="payroll-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => (dirty ? setDiscard(true) : onClose())}
              disabled={busy}
            >
              취소
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={Boolean(existing)}
            >
              작성 중으로 저장
            </Button>
          </div>
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
            {copySource.month}에 확정한 {copySource.staffSnapshot?.name}님의
            조건으로 현재 입력 중인 급여 항목을 바꿉니다.
          </p>
          <p>
            근무일수·근로시간·메모는 비웁니다. 세금·보험 공제와 수당은 이번 달
            자료에 맞게 다시 확인해 주세요.
          </p>
        </ConfirmDialog>
      )}
      {discard && (
        <ConfirmDialog
          title="작성을 취소할까요?"
          onClose={() => setDiscard(false)}
          onConfirm={onClose}
          confirmLabel="내용 버리고 닫기"
          variant="danger"
        >
          저장하지 않은 급여 변경사항이 사라집니다.
        </ConfirmDialog>
      )}
    </Modal>
  );
}
function Statement({ record }) {
  return (
    <article className="payroll-statement">
      <div className="payroll-statement-header">
        <div>
          <p className="payroll-kicker">PAYSLIP</p>
          <h2>{record.month.replace("-", "년 ")}월 급여명세서</h2>
          <p>{record.storeSnapshot?.name}</p>
        </div>
        <Badge tone={statusTone[record.status]}>
          {statusText[record.status]}
        </Badge>
      </div>
      <dl className="payroll-details">
        <div>
          <dt>직원명</dt>
          <dd>{record.staffSnapshot?.name}</dd>
        </div>
        <div>
          <dt>직책</dt>
          <dd>{roleText[record.staffSnapshot?.role] || "직원"}</dd>
        </div>
        <div>
          <dt>귀속기간</dt>
          <dd>
            {record.revenue.from} ~ {record.revenue.to}
          </dd>
        </div>
        <div>
          <dt>{record.paidDate ? "실제 지급일" : "지급 예정일"}</dt>
          <dd>{record.paidDate || record.payDate}</dd>
        </div>
        <div>
          <dt>근무일수</dt>
          <dd>{record.workDays == null ? "미입력" : `${record.workDays}일`}</dd>
        </div>
        <div>
          <dt>총 / 연장 근로시간</dt>
          <dd>
            {record.workHours ?? "—"} / {record.overtimeHours ?? "—"}시간
          </dd>
        </div>
      </dl>
      {record.status === "draft" && (
        <div className="alert alert-warning">
          작성 중인 미확정 명세서입니다. 직원에게는 확정 후 표시되며, 확정 시
          최신 매출로 인센티브를 다시 계산합니다.
        </div>
      )}
      <div className="grid grid-2 payroll-statement-tables">
        <section>
          <h3>지급 내역</h3>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">금액</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>기본급</td>
                <td>
                  <Money value={record.basePay} />
                </td>
              </tr>
              <tr>
                <td>시술 인센티브 ({record.commissionRate}%)</td>
                <td>
                  <Money value={record.commission} />
                </td>
              </tr>
              {record.allowances.map((entry, index) => (
                <tr key={index}>
                  <td>{entry.name}</td>
                  <td>
                    <Money value={entry.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">지급 합계</th>
                <td>
                  <Money value={record.earningsTotal} />
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
        <section>
          <h3>공제 내역</h3>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">금액</th>
              </tr>
            </thead>
            <tbody>
              {record.deductions.length ? (
                record.deductions.map((entry, index) => (
                  <tr key={index}>
                    <td>{entry.name}</td>
                    <td>
                      <Money value={entry.amount} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="2">공제 없음</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">공제 합계</th>
                <td>
                  <Money value={record.deductionTotal} />
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      </div>
      <div className="payroll-preview">
        <span>실지급액</span>
        <strong>{format(record.netPay)}원</strong>
        <small>지급 합계 − 공제 합계</small>
      </div>
      <section className="payroll-basis">
        <h3>인센티브 계산 근거</h3>
        <p>
          시술 매출 {format(record.revenue.gross)}원 − 시술 환불{" "}
          {format(record.revenue.refunded)}원 = 순매출{" "}
          {format(record.revenue.net)}원
        </p>
        <p>
          인센티브 기준 {format(Math.max(0, record.revenue.net))}원 ×{" "}
          {record.commissionRate}% = {format(record.commission)}원 (원 단위
          반올림)
        </p>
        <p className="help">{record.revenue.method}</p>
      </section>
      <section className="payroll-basis">
        <h3>지급·공제 계산 근거</h3>
        <p className="payroll-preserve">
          {record.basis || "입력된 계산 근거가 없습니다."}
        </p>
        {record.notes && (
          <>
            <h3>전달 사항</h3>
            <p className="payroll-preserve">{record.notes}</p>
          </>
        )}
      </section>
      <footer className="payroll-statement-footer">
        <p>
          {record.storeSnapshot?.name}
          {record.storeSnapshot?.phone && ` · ${record.storeSnapshot.phone}`}
        </p>
        {record.storeSnapshot?.address && <p>{record.storeSnapshot.address}</p>}
        <p>
          세금·보험료·수당은 입력된 금액입니다. 이 명세서의 지급 완료 표시는
          계좌 이체를 실행하지 않습니다.
        </p>
        <p>
          명세서 번호 {record.id}
          {record.finalizedAt &&
            ` · 확정 ${new Date(record.finalizedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`}
        </p>
      </footer>
    </article>
  );
}
export default function Payroll({
  data,
  user,
  runAction,
  notify,
  navigate,
  routeContext,
}) {
  const manager = ["owner", "manager"].includes(user.role);
  const [month, setMonth] = useViewState("payroll", "month", () =>
    manager
      ? today().slice(0, 7)
      : (data.payroll || [])
          .map((record) => record.month)
          .sort()
          .at(-1) || today().slice(0, 7),
  );
  const [staffId, setStaffId] = useViewState(
    "payroll",
    "staffId",
    routeContext?.staffId || "",
  );
  const [status, setStatus] = useViewState("payroll", "status", "");
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [paidDate, setPaidDate] = useState(today());
  useEffect(() => {
    if (manager && routeContext?.staffId) {
      setStaffId(routeContext.staffId);
      setStatus("");
    }
  }, [routeContext?.staffId]);
  const records = useMemo(
    () =>
      (data.payroll || [])
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
    [data.payroll, month, staffId, status],
  );
  const selected = dialog?.id
    ? (data.payroll || []).find((item) => item.id === dialog.id)
    : null;
  const open = (value) => {
    setError("");
    setReason("");
    setPaidDate(today());
    setDialog(value);
  };
  const close = () => {
    if (!busy) setDialog(null);
  };
  async function submit(type, payload) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction(type, payload);
      if (type === "payroll.save") {
        setMonth(payload.month);
        if (staffId && staffId !== payload.staffId) setStaffId(payload.staffId);
        if (status && status !== "draft") setStatus("");
      }
      setDialog(null);
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
  if (!manager && !["designer", "reception"].includes(user.role))
    return (
      <EmptyState
        title="급여 조회 권한이 없습니다"
        description="원장 또는 매니저에게 문의해 주세요."
      />
    );
  return (
    <div className="stack payroll-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {manager ? "급여 · 명세서" : "내 급여명세서"}
          </h1>
          <p className="page-description">
            {manager
              ? "월별 급여를 계산하고, 명세서를 확정한 뒤 실제 지급을 기록하세요."
              : "확정된 월별 지급 내역과 공제 항목을 확인하세요."}
          </p>
        </div>
        {manager && (
          <Button
            variant="primary"
            onClick={() =>
              data.staff.length ? open({ kind: "new" }) : navigate("staff")
            }
          >
            {data.staff.length ? "급여명세서 작성" : "직원 먼저 등록"}
          </Button>
        )}
      </div>
      <div className="toolbar">
        <Button
          aria-label="이전 달 급여"
          disabled={month === "2000-01"}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          이전 달
        </Button>
        <Field label="귀속월">
          <input
            className="input"
            type="month"
            min="2000-01"
            max="2099-12"
            required
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </Field>
        <Button
          aria-label="다음 달 급여"
          disabled={month === "2099-12"}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          다음 달
        </Button>
        <Button variant="ghost" onClick={() => setMonth(today().slice(0, 7))}>
          이번 달
        </Button>
        {manager && (
          <Field label="직원">
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
        <Field label="상태">
          <select
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">전체 상태</option>
            {Object.entries(statusText)
              .filter(([key]) => manager || key !== "draft")
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="stat-grid">
        <div className="stat-card">
          <span>조회 명세서</span>
          <strong>{records.length}건</strong>
        </div>
        <div className="stat-card">
          <span>실지급액 합계</span>
          <strong>
            {format(records.reduce((sum, item) => sum + item.netPay, 0))}원
          </strong>
          <small>작성 중·확정·지급 완료 포함</small>
        </div>
        <div className="stat-card">
          <span>확정 후 지급 대기</span>
          <strong>
            {format(
              records
                .filter((item) => item.status === "finalized")
                .reduce((sum, item) => sum + item.netPay, 0),
            )}
            원
          </strong>
        </div>
      </div>
      {manager && (
        <div className="alert">
          작성 → 금액 확인·확정 → 계좌 이체 등 실제 지급 → 지급 완료 기록 순서로
          처리하세요. 직원에게는 확정한 명세서부터 표시됩니다.
        </div>
      )}
      <section className="card">
        {records.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">직원</th>
                  <th scope="col">상태</th>
                  <th scope="col">지급 합계</th>
                  <th scope="col">공제 합계</th>
                  <th scope="col">실지급액</th>
                  <th scope="col">지급일</th>
                  <th scope="col">명세서</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>{record.staffSnapshot?.name}</strong>
                      <small className="payroll-subtext">{record.month}</small>
                    </td>
                    <td>
                      <Badge tone={statusTone[record.status]}>
                        {statusText[record.status]}
                      </Badge>
                    </td>
                    <td>
                      <Money value={record.earningsTotal} />
                    </td>
                    <td>
                      <Money value={record.deductionTotal} />
                    </td>
                    <td>
                      <strong>
                        <Money value={record.netPay} />
                      </strong>
                    </td>
                    <td>
                      {record.paidDate || record.payDate}
                      <small className="payroll-subtext">
                        {record.paidDate ? "실제 지급" : "지급 예정"}
                      </small>
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => open({ kind: "view", id: record.id })}
                        aria-label={`${record.staffSnapshot?.name} ${record.month} 급여명세서 보기`}
                      >
                        보기
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="이 조건의 급여명세서가 없습니다"
            description={
              manager
                ? "직원별 월 급여를 작성하거나 귀속월과 조회 조건을 변경해 주세요."
                : "급여명세서가 확정되면 여기에 표시됩니다. 귀속월을 바꾸어 이전 명세서도 확인할 수 있습니다."
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
      <p className="help">
        명세서는 급여 확인과 출력에 사용할 수 있습니다. 실제 이체·세금 신고는
        별도로 처리하며, 잘못 입력한 지급 완료 금액의 차액은 다음 급여에서
        항목과 사유를 남겨 조정하세요.
      </p>
      {(dialog?.kind === "new" || (dialog?.kind === "edit" && selected)) && (
        <PayrollForm
          key={selected?.id || "new"}
          data={data}
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
          onSubmit={(form) => submit("payroll.save", form)}
          onClose={close}
        />
      )}
      {dialog?.kind === "view" && selected && (
        <Modal
          title="급여명세서"
          onClose={close}
          size="wide"
          footer={
            <div className="payroll-actions">
              <Button variant="secondary" onClick={print}>
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
                    급여 확정
                  </Button>
                </>
              )}
              {manager && selected.status === "finalized" && (
                <>
                  <Button
                    variant="ghost"
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
            </div>
          }
        >
          <Statement record={selected} />
          {manager && selected.changes?.length > 0 && (
            <details className="payroll-history">
              <summary>명세서 변경 기록 ({selected.changes.length})</summary>
              <ul>
                {selected.changes.map((entry, index) => (
                  <li key={index}>
                    {new Date(entry.at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}{" "}
                    · {entry.actorName} ·{" "}
                    {
                      {
                        created: "작성",
                        updated: "수정",
                        finalized: "확정",
                        reopened: "확정 취소",
                        paid: "지급 완료",
                      }[entry.kind]
                    }
                    {entry.reason && ` · ${entry.reason}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
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
            {selected.staffSnapshot?.name}님의 {selected.month} 급여입니다.
            확정하면 직원에게 명세서가 표시됩니다.
          </p>
          <div className="alert alert-warning">
            확정 시 최신 매출·환불로 인센티브를 다시 계산합니다. 확정 후 금액을
            한 번 더 확인하고 실제 지급하세요.
          </div>
          {selected.month === today().slice(0, 7) && (
            <p className="help">
              아직 종료되지 않은 월입니다. 확정 이후 추가된 매출·환불은 자동으로
              반영되지 않습니다.
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
        <Modal title="급여 확정 취소" onClose={busy ? undefined : close} dirty={Boolean(reason)}>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              submit("payroll.reopen", { id: selected.id, reason });
            }}
          >
            <p>
              명세서를 작성 중으로 되돌리고 직원 화면에서 숨깁니다. 기존 확정
              기록은 남습니다.
            </p>
            <Field label="취소 사유">
              <textarea
                disabled={busy}
                className="textarea"
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="danger" busy={busy}>
              확정 취소
            </Button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "paid" && selected && (
        <Modal title="실제 급여 지급 기록" onClose={busy ? undefined : close} dirty={paidDate !== today()}>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              submit("payroll.paid", { id: selected.id, paidDate });
            }}
          >
            <p>
              {selected.staffSnapshot?.name}님에게{" "}
              <strong>{format(selected.netPay)}원</strong>을 실제 지급한 뒤
              기록하세요.
            </p>
            <div className="alert alert-warning">
              이 작업은 계좌 이체를 실행하지 않습니다. 지급 완료 후에는 명세서를
              수정할 수 없습니다.
            </div>
            <Field label="실제 지급일">
              <input
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
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" busy={busy}>
              실제 지급 확인 · 완료 기록
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
