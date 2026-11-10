import React, { useEffect, useState } from "react";
import { api, today } from "../api";
import { Badge, Button, ConfirmDialog, EmptyState, Field, Modal, Money } from "../components/ui";
import { DateInput } from "../components/DateInput.jsx";
import { useViewState } from "../components/ViewState";
import {
  EVIDENCE,
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  normalizeAmount,
  normalizeDate,
  parseCsv,
} from "../workforce-utils";
import "./Workforce.css";

const monthStart = (day) => `${day.slice(0, 7)}-01`;
const TABS = [
  ["profit", "손익 현황"],
  ["expenses", "지출 기록"],
  ["import", "카드 내역 가져오기"],
];

export default function Finance({ data, version, runAction, notify }) {
  const [tab, setTab] = useViewState("finance", "tab", "profit");
  return (
    <div className="workforce-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">경비 · 손익</h1>
          <p className="page-description">
            임대료·공과금 등 지출을 기록하고 매출·매입·인건비와 합쳐 간이 손익을
            확인합니다.
          </p>
        </div>
      </div>
      <nav className="tabs" aria-label="경비 · 손익 메뉴">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${tab === id ? "active" : ""}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "profit" && <Profit version={version} />}
      {tab === "expenses" && (
        <Expenses data={data} runAction={runAction} notify={notify} />
      )}
      {tab === "import" && (
        <CardImport
          runAction={runAction}
          notify={notify}
          done={() => setTab("expenses")}
        />
      )}
    </div>
  );
}

function Profit({ version }) {
  const day = today();
  const [range, setRange] = useViewState("finance", "range", {
    from: monthStart(day),
    to: day,
  });
  const [draft, setDraft] = useState(range);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    api(`/reports/profit?${new URLSearchParams(range)}`)
      .then((result) => live && setReport(result))
      .catch((err) => live && setError(err.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [range, version]);
  const quick = (from, to) => {
    setDraft({ from, to });
    setRange({ from, to });
  };
  const [y, m] = day.split("-").map(Number);
  const previous = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const previousEnd = new Date(Date.UTC(Number(previous.slice(0, 4)), Number(previous.slice(5)), 0))
    .toISOString()
    .slice(0, 10);
  const t = report?.totals;
  return (
    <>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.from && draft.to && draft.from <= draft.to) setRange(draft);
          else setError("조회 시작일과 종료일을 확인해 주세요.");
        }}
      >
        <Field label="시작일">
          <DateInput
            className="input"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label="종료일">
          <DateInput
            className="input"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <Button type="submit" variant="primary">
          조회
        </Button>
        <Button variant="ghost" onClick={() => quick(monthStart(day), day)}>
          이번 달
        </Button>
        <Button variant="ghost" onClick={() => quick(`${previous}-01`, previousEnd)}>
          지난달
        </Button>
        <Button variant="ghost" onClick={() => quick(`${y}-01-01`, day)}>
          올해
        </Button>
      </form>
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}
      {busy && !report && <p className="muted">손익을 계산하고 있습니다…</p>}
      {t && (
        <>
          <div className="stat-grid profit-grid">
            {[
              ["순매출", t.sales, "수납 − 환불"],
              ["매입 원가", t.purchases, "입고 기준"],
              ["인건비", t.payroll, "확정·지급 급여"],
              ["경비", t.expenses, "지출 기록"],
            ].map(([label, value, note]) => (
              <div key={label} className="stat-card">
                <span className="stat-label">{label}</span>
                <strong className="stat-value">
                  <Money value={value} />
                </strong>
                <p className="stat-note">{note}</p>
              </div>
            ))}
            <div className={`stat-card profit-total ${t.operatingProfit < 0 ? "loss" : ""}`}>
              <span className="stat-label">영업이익</span>
              <strong className="stat-value">
                <Money value={t.operatingProfit} />
              </strong>
              <p className="stat-note">
                {report.margin == null
                  ? "매출 없음"
                  : `이익률 ${(report.margin * 100).toFixed(1)}%`}
              </p>
            </div>
          </div>
          {(report.pendingPayroll > 0 || report.estimatedPurchases > 0) && (
            <div className="alert alert-warning">
              {report.pendingPayroll > 0 &&
                `작성 중인 급여명세 ${report.pendingPayroll}건은 인건비에 포함하지 않았습니다. `}
              {report.estimatedPurchases > 0 &&
                `발주 없이 직접 입고한 ${report.estimatedPurchases.toLocaleString("ko-KR")}원은 품목의 입고 단가로 추정했습니다.`}
            </div>
          )}
          <section className="card">
            <div className="card-header">
              <h2>월별 손익계산서</h2>
            </div>
            <div className="card-body table-wrap">
              <table className="table commerce-table commerce-mobile-cards">
                <thead>
                  <tr>
                    <th>월</th>
                    <th className="numeric">순매출</th>
                    <th className="numeric">매입 원가</th>
                    <th className="numeric">매출총이익</th>
                    <th className="numeric">인건비</th>
                    <th className="numeric">경비</th>
                    <th className="numeric">영업이익</th>
                  </tr>
                </thead>
                <tbody>
                  {report.monthly.map((row) => (
                    <tr key={row.month}>
                      <td data-label="월">{row.month}</td>
                      <td data-label="순매출" className="numeric"><Money value={row.sales} /></td>
                      <td data-label="매입 원가" className="numeric"><Money value={row.purchases} /></td>
                      <td data-label="매출총이익" className="numeric"><Money value={row.sales - row.purchases} /></td>
                      <td data-label="인건비" className="numeric"><Money value={row.payroll} /></td>
                      <td data-label="경비" className="numeric"><Money value={row.expenses} /></td>
                      <td data-label="영업이익" className={`numeric ${row.profit < 0 ? "negative" : ""}`}>
                        <strong><Money value={row.profit} /></strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="help">
                매출은 결제·환불일, 매입은 입고·반품일, 인건비는 급여 귀속월,
                경비는 지출일 기준입니다. 세무 신고용 재무제표가 아닌 매장 운영
                참고용 간이 손익입니다.
              </p>
            </div>
          </section>
          <div className="grid grid-2">
            <section className="card">
              <div className="card-header">
                <h2>경비 분류별</h2>
              </div>
              <div className="card-body">
                {report.expensesByCategory.length ? (
                  <ul className="bar-list">
                    {report.expensesByCategory.map((row) => (
                      <li key={row.category}>
                        <span>{row.category}</span>
                        <span
                          className="bar"
                          style={{ width: `${(row.amount / report.expensesByCategory[0].amount) * 100}%` }}
                          aria-hidden="true"
                        />
                        <Money value={row.amount} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">기간 내 지출 기록이 없습니다.</p>
                )}
              </div>
            </section>
            <section className="card">
              <div className="card-header">
                <h2>거래처 · 채무</h2>
              </div>
              <div className="card-body">
                <dl className="summary-grid">
                  <div>
                    <dt>기간 내 거래처 지급액</dt>
                    <dd><Money value={report.supplierPayments} /></dd>
                  </div>
                  <div>
                    <dt>현재 미지급금 (전체)</dt>
                    <dd><Money value={report.payables} /></dd>
                  </div>
                </dl>
                {report.purchasesBySupplier.length > 0 && (
                  <ul className="bar-list">
                    {report.purchasesBySupplier.map((row) => (
                      <li key={row.supplierName}>
                        <span>{row.supplierName}</span>
                        <span
                          className="bar"
                          style={{
                            width: `${Math.max(0, (row.amount / Math.max(1, report.purchasesBySupplier[0].amount)) * 100)}%`,
                          }}
                          aria-hidden="true"
                        />
                        <Money value={row.amount} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function Expenses({ data, runAction, notify }) {
  const day = today();
  const [month, setMonth] = useViewState("finance", "month", day.slice(0, 7));
  const [category, setCategory] = useViewState("finance", "category", "");
  const [showVoid, setShowVoid] = useState(false);
  const [editing, setEditing] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const rows = (data.expenses || [])
    .filter(
      (row) =>
        row.date.startsWith(month) &&
        (!category || row.category === category) &&
        (showVoid || row.status !== "void"),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = rows
    .filter((row) => row.status !== "void")
    .reduce((sum, row) => sum + row.amount, 0);
  return (
    <>
      <div className="toolbar">
        <Field label="월">
          <DateInput
            className="input"
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
          />
        </Field>
        <Field label="분류">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">전체 분류</option>
            {EXPENSE_CATEGORIES.map((row) => (
              <option key={row}>{row}</option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={showVoid}
            onChange={(e) => setShowVoid(e.target.checked)}
          />
          취소 건 포함
        </label>
        <Button
          variant="primary"
          onClick={() =>
            setEditing({
              date: day,
              category: "소모품·비품",
              amount: "",
              vendor: "",
              method: "card",
              evidence: "card_slip",
              reference: "",
              memo: "",
            })
          }
        >
          지출 등록
        </Button>
      </div>
      <section className="card">
        <div className="card-header">
          <h2>
            지출 내역 <span className="help">합계 {total.toLocaleString("ko-KR")}원</span>
          </h2>
        </div>
        <div className="card-body">
          {rows.length ? (
            <div className="table-wrap">
              <table className="table commerce-table commerce-mobile-cards">
                <thead>
                  <tr>
                    <th>지출일</th>
                    <th>분류</th>
                    <th>사용처</th>
                    <th>결제</th>
                    <th>증빙</th>
                    <th className="numeric">금액</th>
                    <th aria-label="작업" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className={row.status === "void" ? "voided" : ""}>
                      <td data-label="지출일">{row.date}</td>
                      <td data-label="분류">{row.category}</td>
                      <td data-label="사용처">
                        {row.vendor}
                        {row.memo && <span className="help"> · {row.memo}</span>}
                      </td>
                      <td data-label="결제">{EXPENSE_METHODS[row.method]}</td>
                      <td data-label="증빙">{EVIDENCE[row.evidence] || "—"}</td>
                      <td data-label="금액" className="numeric">
                        <Money value={row.amount} />
                        {row.status === "void" && <Badge tone="muted">취소</Badge>}
                      </td>
                      <td className="row-actions">
                        {row.status !== "void" && (
                          <>
                            <Button variant="ghost" onClick={() => setEditing({ ...row })}>
                              수정
                            </Button>
                            <Button variant="ghost" onClick={() => setVoiding(row)}>
                              취소
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="지출 기록이 없습니다"
              description="임대료, 공과금, 소모품 구입 등 매장 운영 비용을 등록하면 손익에 반영됩니다."
            />
          )}
        </div>
      </section>
      {editing && (
        <ExpenseForm
          initial={editing}
          runAction={runAction}
          notify={notify}
          close={() => setEditing(null)}
        />
      )}
      {voiding && (
        <VoidExpense
          row={voiding}
          runAction={runAction}
          notify={notify}
          close={() => setVoiding(null)}
        />
      )}
    </>
  );
}

function ExpenseForm({ initial, runAction, notify, close }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await runAction("expense.save", {
        id: form.id,
        date: form.date,
        category: form.category,
        amount: normalizeAmount(form.amount),
        vendor: form.vendor,
        method: form.method,
        evidence: form.evidence,
        reference: form.reference,
        memo: form.memo,
      });
      notify("지출을 저장했습니다.");
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={form.id ? "지출 수정" : "지출 등록"}
      onClose={busy ? undefined : close}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
      footer={
        <Button form="expense-form" type="submit" variant="primary" busy={busy}>
          저장
        </Button>
      }
    >
      <form id="expense-form" className="stack" onSubmit={submit}>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        <div className="grid grid-2">
          <Field label="지출일">
            <DateInput
              className="input"
              type="date"
              required
              max={today()}
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
            />
          </Field>
          <Field label="분류">
            <select value={form.category} onChange={(e) => set("category", e.target.value)}>
              {EXPENSE_CATEGORIES.map((row) => (
                <option key={row}>{row}</option>
              ))}
            </select>
          </Field>
          <Field label="금액 (원)">
            <input
              required
              inputMode="numeric"
              value={form.amount === "" ? "" : Number(normalizeAmount(form.amount)).toLocaleString("ko-KR")}
              onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          <Field label="사용처 · 거래처">
            <input
              required
              maxLength={100}
              value={form.vendor}
              onChange={(e) => set("vendor", e.target.value)}
            />
          </Field>
          <Field label="결제 수단">
            <select value={form.method} onChange={(e) => set("method", e.target.value)}>
              {Object.entries(EXPENSE_METHODS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="증빙">
            <select value={form.evidence} onChange={(e) => set("evidence", e.target.value)}>
              {Object.entries(EVIDENCE).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="승인 · 증빙 번호 (선택)">
          <input
            maxLength={100}
            value={form.reference}
            onChange={(e) => set("reference", e.target.value)}
          />
        </Field>
        <Field label="메모 (선택)">
          <textarea
            rows={2}
            maxLength={500}
            value={form.memo}
            onChange={(e) => set("memo", e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

function VoidExpense({ row, runAction, notify, close }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <ConfirmDialog
      title="지출 기록을 취소할까요?"
      confirmLabel="지출 취소"
      variant="danger"
      busy={busy}
      onClose={close}
      onConfirm={async () => {
        setBusy(true);
        try {
          await runAction("expense.void", { id: row.id, reason });
          notify("지출을 취소했습니다.");
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
        {row.date} · {row.vendor} · {row.amount.toLocaleString("ko-KR")}원
      </p>
      <Field label="취소 사유">
        <input required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

const HEADER_GUESS = {
  date: /(이용|승인|거래|사용)?\s*(일자|일시|날짜)|date/i,
  vendor: /(가맹점|사용처|이용처|상호)|merchant|vendor/i,
  amount: /(이용|승인|결제|사용)?\s*금액|amount/i,
  reference: /승인\s*번호|approval/i,
};
function CardImport({ runAction, notify, done }) {
  const [raw, setRaw] = useState("");
  const [method, setMethod] = useState("corporate_card");
  const [category, setCategory] = useState("소모품·비품");
  const [columns, setColumns] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const table = raw.trim() ? parseCsv(raw.trim()) : [];
  const header = table[0] || [];
  const guessed =
    columns ||
    Object.fromEntries(
      Object.entries(HEADER_GUESS).map(([key, pattern]) => [
        key,
        header.findIndex((cell) => pattern.test(cell)),
      ]),
    );
  const hasHeader = Object.values(guessed).some((index) => index >= 0);
  const mapping = hasHeader ? guessed : { date: 0, vendor: 1, amount: 2, reference: 3 };
  const body = hasHeader ? table.slice(1) : table;
  const rows = body
    .map((cells) => ({
      date: normalizeDate(cells[mapping.date]),
      vendor: (cells[mapping.vendor] || "").slice(0, 100),
      amount: normalizeAmount(cells[mapping.amount]),
      reference: mapping.reference >= 0 ? (cells[mapping.reference] || "").slice(0, 100) : "",
    }))
    .filter((row) => row.date || row.vendor || row.amount);
  const valid = rows.filter((row) => row.date && row.vendor && row.amount > 0);
  const load = (file) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError("1MB 이하의 CSV 파일을 선택해 주세요.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setColumns(null);
      setRaw(String(reader.result || ""));
    };
    reader.readAsText(file, "utf-8");
  };
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await runAction("expense.import", { rows: valid, method, category });
      notify(`${valid.length}건 중 새 내역을 지출로 가져왔습니다.`);
      setRaw("");
      done();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <div className="card-header">
        <h2>카드 사용 내역 가져오기</h2>
      </div>
      <div className="card-body stack">
        <p className="help">
          카드사 홈페이지에서 내려받은 이용내역 CSV를 선택하거나 표를 복사해
          붙여넣으세요. 일자·가맹점·금액·승인번호 열을 자동으로 찾고, 이미
          가져온 같은 내역은 건너뜁니다. 카드사 계정에 직접 접속하지 않습니다.
        </p>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        <div className="grid grid-2">
          <Field label="CSV 파일">
            <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => load(e.target.files?.[0])} />
          </Field>
          <Field label="결제 수단">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="corporate_card">법인카드</option>
              <option value="card">개인·사업자 카드</option>
            </select>
          </Field>
        </div>
        <Field label="또는 붙여넣기" help="예: 2026-11-02, 다이소 강남점, 12000, 30012345">
          <textarea
            rows={6}
            value={raw}
            onChange={(e) => {
              setColumns(null);
              setRaw(e.target.value);
            }}
          />
        </Field>
        {hasHeader && (
          <div className="grid grid-2">
            {[
              ["date", "일자 열"],
              ["vendor", "가맹점 열"],
              ["amount", "금액 열"],
              ["reference", "승인번호 열"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <select
                  value={mapping[key]}
                  onChange={(e) => setColumns({ ...mapping, [key]: Number(e.target.value) })}
                >
                  <option value={-1}>사용 안 함</option>
                  {header.map((cell, index) => (
                    <option key={index} value={index}>
                      {cell || `${index + 1}번째 열`}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        )}
        <Field label="기본 분류">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((row) => (
              <option key={row}>{row}</option>
            ))}
          </select>
        </Field>
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table commerce-table">
              <thead>
                <tr>
                  <th>일자</th>
                  <th>가맹점</th>
                  <th className="numeric">금액</th>
                  <th>승인번호</th>
                  <th>확인</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, index) => {
                  const ok = row.date && row.vendor && row.amount > 0;
                  return (
                    <tr key={index}>
                      <td>{row.date || "—"}</td>
                      <td>{row.vendor || "—"}</td>
                      <td className="numeric">{row.amount.toLocaleString("ko-KR")}</td>
                      <td>{row.reference || "—"}</td>
                      <td>
                        <Badge tone={ok ? "success" : "warning"}>{ok ? "가져옴" : "제외"}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 50 && <p className="help">처음 50건만 미리 보여줍니다.</p>}
          </div>
        )}
        <Button
          variant="primary"
          disabled={!valid.length || valid.length > 500}
          busy={busy}
          onClick={submit}
        >
          {valid.length ? `${valid.length}건 가져오기` : "가져올 내역 없음"}
        </Button>
        {valid.length > 500 && <p className="error">한 번에 500건까지 가져올 수 있습니다.</p>}
        <p className="help">취소·환불 건(음수 금액)은 제외됩니다. 가져온 뒤 지출 기록에서 분류를 수정하세요.</p>
      </div>
    </section>
  );
}
