import { DateInput } from "../components/DateInput.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Modal,
  Field,
  Badge,
  EmptyState,
  Money,
} from "../components/ui";
import {
  todayInSeoul,
  money,
  quantity,
  methodNames,
  paymentNames,
  monthStart,
  displayTime,
  refundedLines,
  refundEstimate,
} from "./commerce-utils";
import "./Commerce.css";
import { useViewState } from "../components/ViewState";
import { matchesSearch } from "./commerce-utils";

const paymentTone = (status) =>
  status === "paid" ? "success" : status === "refunded" ? "muted" : "warning";
const numeric = (value) => Number(value || 0);

export default function Payments({
  data,
  user,
  runAction,
  notify,
  navigate,
  routeContext,
}) {
  const today = todayInSeoul();
  const canWrite = user.role !== "designer";
  const [from, setFrom] = useViewState("payments", "from", monthStart());
  const [to, setTo] = useViewState("payments", "to", today);
  const [query, setQuery] = useViewState("payments", "query", "");
  const [status, setStatus] = useViewState("payments", "status", "all");
  const [limit, setLimit] = useState(50);
  const [dialog, setDialog] = useState(null);
  const usedContext = useRef(null);
  const pendingHeading = useRef(null);
  const transactions = data.transactions || [];
  const staff = data.staff || [];
  const pending = (data.appointments || [])
    .filter(
      (a) =>
        !a.transactionId &&
        ["checked_in", "in_service", "completed"].includes(a.status),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const records = useMemo(
    () =>
      transactions
        .filter(
          (tx) =>
            tx.date >= from &&
            tx.date <= to &&
            (status === "all" || tx.status === status) &&
            matchesSearch(query, [
              tx.customerName,
              data.customers.find((customer) => customer.id === tx.customerId)
                ?.phone,
              tx.reference,
              tx.id,
              staff.find((s) => s.id === tx.staffId)?.name,
              ...(tx.lines || []).map((line) => line.name),
            ]),
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            String(b.createdAt || b.time).localeCompare(
              String(a.createdAt || a.time),
            ),
        ),
    [transactions, from, to, query, status, staff, data.customers],
  );
  useEffect(() => setLimit(50), [from, to, query, status]);
  const gross = transactions
    .filter((t) => t.date >= from && t.date <= to)
    .reduce((sum, t) => sum + t.total, 0);
  const refundTotal = (data.refunds || [])
    .filter((r) => r.date >= from && r.date <= to)
    .reduce((sum, r) => sum + r.amount, 0);
  const currentTx = dialog?.id
    ? transactions.find((t) => t.id === dialog.id)
    : null;
  useEffect(() => {
    if (!routeContext || routeContext === usedContext.current) return;
    usedContext.current = routeContext;
    if (routeContext.transactionId)
      setDialog({ kind: "detail", id: routeContext.transactionId });
    else if (routeContext.appointmentId && canWrite)
      setDialog({ kind: "create", appointmentId: routeContext.appointmentId });
    else if (routeContext.customerId && canWrite)
      setDialog({ kind: "create", customerId: routeContext.customerId });
    else if (routeContext.create && canWrite) setDialog({ kind: "create" });
    else if (routeContext.pending) {
      pendingHeading.current?.scrollIntoView({ block: "center" });
      pendingHeading.current?.focus({ preventScroll: true });
    }
  }, [routeContext, canWrite]);
  const saved = (message) => {
    setDialog(null);
    notify(message);
  };
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">수납 · 환불</h1>
          <p className="page-description">
            단말기 결제 결과와 환불 내역을 기록합니다.
          </p>
        </div>
        {canWrite && (
          <Button
            variant="primary"
            onClick={() => setDialog({ kind: "create" })}
          >
            + 수납 기록
          </Button>
        )}
      </header>
      <div className="commerce-stats">
        <div className="stat-card">
          <span className="muted">기간 결제액</span>
          <strong>
            <Money value={gross} />
          </strong>
          <span className="muted">
            {from} ~ {to}
          </span>
        </div>
        <div className="stat-card">
          <span className="muted">기간 환불액</span>
          <strong>
            <Money value={refundTotal} />
          </strong>
          <span className="muted">실제 환불 처리일 기준</span>
        </div>
        <div className="stat-card">
          <span className="muted">기간 순수납액</span>
          <strong>
            <Money value={gross - refundTotal} />
          </strong>
          <span className="muted">결제액 − 환불액</span>
        </div>
        <div className="stat-card">
          <span className="muted">수납 대기</span>
          <strong>
            {pending.length}
            <small>건</small>
          </strong>
          <span className="muted">접수·시술 중·시술 완료 예약</span>
        </div>
      </div>
      {canWrite && pending.length > 0 && (
        <section aria-label="수납 대기 예약">
          <h2
            className="commerce-section-title"
            ref={pendingHeading}
            tabIndex={-1}
          >
            수납할 예약 · {pending.length}건
          </h2>
          <div className="commerce-pending">
            {pending.map((a) => (
              <button
                key={a.id}
                onClick={() =>
                  setDialog({ kind: "create", appointmentId: a.id })
                }
              >
                <strong>
                  {data.customers.find((c) => c.id === a.customerId)?.name ||
                    a.guestName ||
                    "방문 고객"}
                </strong>
                <small>
                  {a.date} · {String(Math.floor(a.start / 60)).padStart(2, "0")}
                  :{String(a.start % 60).padStart(2, "0")} ·{" "}
                  {staff.find((s) => s.id === a.staffId)?.name ||
                    "담당자 미지정"}
                </small>
                <small>
                  {a.serviceIds
                    .map((id) => data.services.find((s) => s.id === id)?.name)
                    .filter(Boolean)
                    .join(", ") || "시술 선택 필요"}{" "}
                  →
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-body">
          <div className="commerce-filters">
            <Field label="결제 시작일">
              <DateInput
                className="input"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="결제 종료일">
              <DateInput
                className="input"
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
            <div className="search-field">
              <Field label="검색">
                <input
                  className="input"
                  type="search"
                  placeholder="고객명, 연락처, 시술, 승인번호"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </Field>
            </div>
            <Field label="처리 상태">
              <select
                className="select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">전체 상태</option>
                {Object.entries(paymentNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="commerce-filter-summary">
            <div className="commerce-actions" aria-label="수납 빠른 기간 선택">
              <Button
                variant="ghost"
                onClick={() => {
                  setFrom(today);
                  setTo(today);
                }}
              >
                오늘
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFrom(monthStart());
                  setTo(today);
                }}
              >
                이번 달
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFrom(monthStart());
                  setTo(today);
                  setQuery("");
                  setStatus("all");
                }}
              >
                조회 조건 초기화
              </Button>
            </div>
            <span className="muted" role="status">
              조회 결과 {records.length}건
            </span>
          </div>
          {from > to && (
            <p className="error" role="alert">
              시작일이 종료일보다 늦습니다. 조회 기간을 확인해 주세요.
            </p>
          )}
          {records.length ? (
            <div className="table-wrap">
              <table className="table commerce-table commerce-mobile-cards">
                <thead>
                  <tr>
                    <th>고객 / 결제일</th>
                    <th className="optional-mobile">담당자</th>
                    <th>상태</th>
                    <th className="optional-mobile">결제 수단</th>
                    <th className="numeric">결제액</th>
                    <th className="numeric">누적 환불</th>
                    <th>
                      <span className="sr-only">상세 보기</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, limit).map((tx) => {
                    const refunded = (data.refunds || [])
                      .filter((r) => r.transactionId === tx.id)
                      .reduce((sum, r) => sum + r.amount, 0);
                    return (
                      <tr key={tx.id}>
                        <td>
                          <button
                            className="row-button"
                            onClick={() =>
                              setDialog({ kind: "detail", id: tx.id })
                            }
                          >
                            <strong>{tx.customerName || "방문 고객"}</strong>
                            <span className="commerce-secondary">
                              {tx.date} {tx.time}
                            </span>
                          </button>
                        </td>
                        <td data-label="담당자" className="optional-mobile">
                          {staff.find((s) => s.id === tx.staffId)?.name ||
                            "기존 담당자"}
                        </td>
                        <td data-label="상태">
                          <Badge tone={paymentTone(tx.status)}>
                            {paymentNames[tx.status] || tx.status}
                          </Badge>
                        </td>
                        <td data-label="수단" className="optional-mobile">
                          {methodNames[tx.method]}
                        </td>
                        <td data-label="결제액" className="numeric">
                          <Money value={tx.total} />
                        </td>
                        <td data-label="누적 환불" className="numeric">
                          {refunded ? <Money value={refunded} /> : "—"}
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setDialog({ kind: "detail", id: tx.id })
                            }
                            aria-label={`${tx.customerName || "방문 고객"} 결제 상세`}
                          >
                            상세
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="조회된 수납 기록이 없습니다"
              description="기간과 검색 조건을 확인하거나 첫 수납을 기록하세요."
              action={
                canWrite && (
                  <Button
                    variant="primary"
                    onClick={() => setDialog({ kind: "create" })}
                  >
                    수납 기록
                  </Button>
                )
              }
            />
          )}
          {records.length > limit && (
            <Button onClick={() => setLimit((value) => value + 50)}>
              더 보기 ({limit} / {records.length})
            </Button>
          )}
          <p className="commerce-note">
            목록은 원래 결제일로 조회합니다. 당일 환불·정산 내역은{" "}
            <button
              className="commerce-tag-button"
              onClick={() => navigate("sales")}
            >
              매출 · 정산
            </button>
            에서 확인하세요.
          </p>
        </div>
      </section>
      {dialog?.kind === "create" && (
        <PaymentForm
          key={`${dialog.appointmentId || ""}-${dialog.customerId || ""}`}
          data={data}
          initial={dialog}
          runAction={runAction}
          onClose={() => setDialog(null)}
          onSaved={() => saved("수납 기록을 저장했습니다.")}
        />
      )}
      {currentTx && dialog.kind === "detail" && (
        <PaymentDetail
          tx={currentTx}
          data={data}
          canWrite={canWrite}
          onClose={() => setDialog(null)}
          onCorrect={() => setDialog({ kind: "correct", id: currentTx.id })}
          onRefund={() => setDialog({ kind: "refund", id: currentTx.id })}
          navigate={navigate}
        />
      )}
      {currentTx && dialog.kind === "correct" && (
        <CorrectionForm
          tx={currentTx}
          data={data}
          runAction={runAction}
          onClose={() => setDialog({ kind: "detail", id: currentTx.id })}
          onSaved={() =>
            saved("수납 정보를 정정했습니다. 재고와 결제 금액은 유지됩니다.")
          }
        />
      )}
      {currentTx && dialog.kind === "refund" && (
        <RefundForm
          tx={currentTx}
          data={data}
          runAction={runAction}
          onClose={() => setDialog({ kind: "detail", id: currentTx.id })}
          onSaved={() => saved("환불 기록을 저장했습니다.")}
        />
      )}
    </>
  );
}

function PaymentForm({ data, initial, runAction, onClose, onSaved }) {
  const appointment = (data.appointments || []).find(
    (a) => a.id === initial.appointmentId,
  );
  const [form, setForm] = useState(() => ({
    appointmentId: appointment?.id,
    customerId: appointment?.customerId || initial.customerId || "",
    guestName: appointment?.guestName || "",
    staffId: appointment?.staffId || "",
    serviceDate: appointment?.date || todayInSeoul(),
    lines: (appointment?.serviceIds || []).map((id) => {
      const service = data.services.find((s) => s.id === id);
      return {
        key: crypto.randomUUID(),
        type: "service",
        refId: id,
        quantity: "1",
        unitPrice: String(service?.price || 0),
      };
    }),
    discount: "0",
    method: "card",
    reference: "",
    notes: "",
  }));
  const [addValue, setAddValue] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setConfirmed(false);
    setDirty(true);
  };
  const customer = data.customers.find((c) => c.id === form.customerId);
  const customerOptions = data.customers.filter(
    (c) =>
      c.id === form.customerId ||
      (!c.archived && matchesSearch(customerQuery, [c.name, c.phone])),
  );
  const serviceOptions = data.services.filter(
    (s) => s.active !== false && matchesSearch(catalogQuery, [s.name, "시술"]),
  );
  const productOptions = data.items.filter(
    (i) =>
      i.kind === "판매 상품" &&
      i.active !== false &&
      matchesSearch(catalogQuery, [i.name, "판매 상품"]),
  );
  const selectedStaff = data.staff.find((s) => s.id === form.staffId);
  const eligibleStaff = data.staff.filter(
    (s) => s.status === "active" || s.id === form.staffId,
  );
  const subtotal = form.lines.reduce(
    (sum, line) =>
      sum + Math.round(numeric(line.quantity) * numeric(line.unitPrice)),
    0,
  );
  const total = subtotal - numeric(form.discount);
  const lineItem = (line) =>
    line.type === "service"
      ? data.services.find((s) => s.id === line.refId)
      : data.items.find((s) => s.id === line.refId);
  const stockUse = useMemo(() => {
    const uses = {};
    form.lines.forEach((line) => {
      if (line.type === "product")
        uses[line.refId] = (uses[line.refId] || 0) + numeric(line.quantity);
      else
        (
          data.services.find((s) => s.id === line.refId)?.materials || []
        ).forEach((material) => {
          uses[material.itemId] =
            (uses[material.itemId] || 0) +
            numeric(material.quantity) * numeric(line.quantity);
        });
    });
    return Object.entries(uses).map(([id, used]) => ({
      item: data.items.find((i) => i.id === id),
      used,
    }));
  }, [form.lines, data.services, data.items]);
  const insufficient = stockUse.filter(
    ({ item, used }) => !item || used > item.qty + 0.00001,
  );
  function addLine() {
    if (!addValue) return;
    const [type, ...ids] = addValue.split(":");
    const refId = ids.join(":");
    const item =
      type === "service"
        ? data.services.find((s) => s.id === refId)
        : data.items.find((s) => s.id === refId);
    if (!item) return;
    const existing = form.lines.find(
      (line) => line.type === type && line.refId === refId,
    );
    update(
      "lines",
      existing
        ? form.lines.map((line) =>
            line === existing
              ? { ...line, quantity: String(numeric(line.quantity) + 1) }
              : line,
          )
        : [
            ...form.lines,
            {
              key: crypto.randomUUID(),
              type,
              refId,
              quantity: "1",
              unitPrice: String(item.price || 0),
            },
          ],
    );
    setAddValue("");
    setCatalogQuery("");
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!form.lines.length)
      return setError("시술 또는 판매 상품을 한 개 이상 추가해 주세요.");
    if (!confirmed) return setError("실제 결제 완료 여부를 확인해 주세요.");
    if (total < 0)
      return setError("할인액은 시술·상품 합계보다 클 수 없습니다.");
    setBusy(true);
    setError("");
    try {
      await runAction("payment.create", {
        ...form,
        customerId: form.customerId || undefined,
        lines: form.lines.map(({ key, ...line }) => ({
          ...line,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
        })),
        discount: Number(form.discount || 0),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={appointment ? "예약 수납 기록" : "새 수납 기록"}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      size="wide"
      footer={
        <>
          <Button
            variant="primary"
            type="submit"
            form="payment-create"
            busy={busy}
            disabled={
              !confirmed || !form.lines.length || insufficient.length > 0
            }
          >
            수납 {money(Math.max(0, total))} 기록
          </Button>
        </>
      }
    >
      <form id="payment-create" onSubmit={submit} className="stack">
        <fieldset disabled={busy} className="commerce-fieldset">
          <div className="alert alert-warning">
            카드 승인과 현금 수령은 매장 단말기·계좌에서 먼저 완료해 주세요. 이
            화면에서는 결제 결과와 재고 사용을 기록합니다.
          </div>
          {error && (
            <div
              className="alert alert-danger commerce-inline-error"
              role="alert"
            >
              {error}
            </div>
          )}
          <div className="commerce-form-grid">
            {!appointment && (
              <div className="full">
                <Field
                  label="고객 빠른 검색"
                  help="이름이나 연락처 일부로 검색한 뒤 아래 고객을 선택하세요."
                >
                  <input
                    className="input"
                    type="search"
                    value={customerQuery}
                    placeholder="예: 김민지 또는 1234"
                    onChange={(e) => setCustomerQuery(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <Field
              label="고객"
              help={
                appointment
                  ? "예약의 고객 정보로 연결됩니다."
                  : "비회원은 방문 고객을 선택하세요. 검색어를 바꿔도 선택한 고객은 유지됩니다."
              }
            >
              <select
                className="select"
                value={form.customerId}
                disabled={!!appointment}
                onChange={(e) => update("customerId", e.target.value)}
              >
                <option value="">방문 고객 (비회원)</option>
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.phone || "연락처 없음"}
                  </option>
                ))}
              </select>
              {customerQuery && customerOptions.length === 0 && (
                <span className="help" role="status">
                  일치하는 고객이 없습니다. 방문 고객으로 기록할 수 있습니다.
                </span>
              )}
            </Field>
            {!form.customerId && (
              <Field label="방문 고객 이름">
                <input
                  className="input"
                  maxLength={60}
                  value={form.guestName}
                  disabled={!!appointment}
                  placeholder="예: 방문 고객"
                  onChange={(e) => update("guestName", e.target.value)}
                />
              </Field>
            )}
            <Field
              label="담당 직원"
              help={
                appointment
                  ? "예약 담당자입니다. 변경이 필요하면 예약에서 먼저 수정하세요."
                  : undefined
              }
            >
              <select
                className="select"
                required
                disabled={!!appointment}
                value={form.staffId}
                onChange={(e) => update("staffId", e.target.value)}
              >
                <option value="">담당자를 선택하세요</option>
                {eligibleStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.status === "inactive" ? " (비활성)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="시술 · 판매일" help="수납일은 오늘로 기록됩니다.">
              <DateInput
                className="input"
                type="date"
                disabled={!!appointment}
                required
                max={todayInSeoul()}
                value={form.serviceDate}
                onChange={(e) => update("serviceDate", e.target.value)}
              />
            </Field>
          </div>
          {customer?.warning && (
            <div className="alert alert-warning">
              <strong>고객 주의사항</strong>
              <p className="commerce-prewrap">{customer.warning}</p>
            </div>
          )}
          {selectedStaff?.status === "inactive" && (
            <div className="alert alert-warning">
              현재 비활성 직원입니다. 실제 담당자를 확인해 주세요.
            </div>
          )}
          <section>
            <h3 className="commerce-section-title">시술 및 판매 상품</h3>
            {!form.lines.length && (
              <p className="commerce-note">
                아래에서 시술 또는 상품을 선택해 추가하세요.
              </p>
            )}
            {form.lines.map((line, index) => {
              const item = lineItem(line);
              return (
                <div className="commerce-line" key={line.key}>
                  <div className="line-label">
                    <strong>{item?.name || "삭제된 품목"}</strong>
                    <span className="commerce-secondary">
                      {line.type === "service"
                        ? "시술"
                        : `상품 · 재고 ${quantity(item?.qty)}${item?.unit || "개"}`}
                    </span>
                  </div>
                  <Field label={`수량 ${index + 1}`}>
                    <input
                      className="input"
                      aria-label={`${item?.name || "품목"} 수량`}
                      type="number"
                      inputMode="decimal"
                      min={
                        line.type === "product" && item?.unit !== "개"
                          ? ".001"
                          : "1"
                      }
                      step={
                        line.type === "product" && item?.unit !== "개"
                          ? ".001"
                          : "1"
                      }
                      required
                      value={line.quantity}
                      onChange={(e) =>
                        update(
                          "lines",
                          form.lines.map((l) =>
                            l.key === line.key
                              ? { ...l, quantity: e.target.value }
                              : l,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="단가 (원)">
                    <input
                      className="input"
                      aria-label={`${item?.name || "품목"} 단가`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      required
                      value={line.unitPrice}
                      onChange={(e) =>
                        update(
                          "lines",
                          form.lines.map((l) =>
                            l.key === line.key
                              ? { ...l, unitPrice: e.target.value }
                              : l,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Button
                    className="remove-line"
                    variant="ghost"
                    aria-label={`${item?.name || "품목"} 삭제`}
                    onClick={() =>
                      update(
                        "lines",
                        form.lines.filter((l) => l.key !== line.key),
                      )
                    }
                  >
                    ×
                  </Button>
                </div>
              );
            })}
            <Field label="시술 · 상품 검색">
              <input
                className="input"
                type="search"
                value={catalogQuery}
                placeholder="추가할 시술이나 상품 이름"
                onChange={(e) => {
                  setCatalogQuery(e.target.value);
                  setAddValue("");
                }}
              />
            </Field>
            <div className="commerce-add-line">
              <Field label="추가할 시술 · 상품">
                <select
                  className="select"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                >
                  <option value="">선택하세요</option>
                  <optgroup label="시술">
                    {serviceOptions.map((s) => (
                      <option key={s.id} value={`service:${s.id}`}>
                        {s.name} · {money(s.price)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="판매 상품">
                    {productOptions.map((i) => (
                      <option key={i.id} value={`product:${i.id}`}>
                        {i.name} · {money(i.price)} · 재고 {quantity(i.qty)}
                        {i.unit}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Field>
              <Button
                variant="secondary"
                disabled={!addValue}
                onClick={addLine}
              >
                항목 추가
              </Button>
            </div>
            {catalogQuery &&
              !serviceOptions.length &&
              !productOptions.length && (
                <p className="commerce-note" role="status">
                  검색에 맞는 시술·상품이 없습니다. 검색어를 지우거나 사용 중인
                  품목을 확인하세요.
                </p>
              )}
            {stockUse.length > 0 && (
              <p className="commerce-note">
                저장 시 사용 재고:{" "}
                {stockUse
                  .map(
                    ({ item, used }) =>
                      `${item?.name || "미등록 품목"} ${quantity(used)}${item?.unit || ""}`,
                  )
                  .join(" / ")}
              </p>
            )}
            {insufficient.length > 0 && (
              <div role="alert" className="alert alert-warning">
                {insufficient
                  .map(({ item }) => item?.name || "미등록 품목")
                  .join(", ")}
                의 재고가 부족합니다. 재고 화면에서 실제 입고 또는 실사 수량을
                먼저 기록하세요.
              </div>
            )}
          </section>
          <div className="commerce-totals">
            <div>
              <span>시술 · 상품 합계</span>
              <Money value={subtotal} />
            </div>
            <div>
              <label htmlFor="payment-discount">전체 할인 (원)</label>
              <input
                className="input"
                id="payment-discount"
                type="number"
                inputMode="numeric"
                min="0"
                max={subtotal}
                step="1"
                value={form.discount}
                onChange={(e) => update("discount", e.target.value)}
              />
            </div>
            <div className="grand-total">
              <span>최종 결제액</span>
              <Money value={total} />
            </div>
          </div>
          <div className="commerce-form-grid">
            <Field label="결제 수단">
              <select
                className="select"
                value={form.method}
                onChange={(e) => update("method", e.target.value)}
              >
                {Object.entries(methodNames).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="승인번호 · 거래번호"
              help="전체 카드번호나 비밀번호는 입력하지 마세요."
            >
              <input
                className="input"
                maxLength={100}
                value={form.reference}
                onChange={(e) => update("reference", e.target.value)}
                placeholder="단말기 승인번호 또는 이체 참조"
              />
            </Field>
            <div className="full">
              <Field label="수납 메모">
                <textarea
                  className="textarea"
                  maxLength={1000}
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  placeholder="수납 시 참고할 내용"
                />
              </Field>
            </div>
          </div>
          <label className="commerce-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setDirty(true);
              }}
            />
            <span>
              단말기 승인·현금 수령·이체 확인을 완료했고, 위의{" "}
              {money(Math.max(0, total))}을 기록합니다.
            </span>
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}

function PaymentDetail({
  tx,
  data,
  canWrite,
  onClose,
  onCorrect,
  onRefund,
  navigate,
}) {
  const refunds = (data.refunds || []).filter((r) => r.transactionId === tx.id);
  const refundTotal = refunds.reduce((sum, r) => sum + r.amount, 0);
  const refunded = refundedLines(data, tx.id);
  return (
    <Modal
      title="수납 상세"
      onClose={onClose}
      size="wide"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          {canWrite && (
            <Button variant="secondary" onClick={onCorrect}>
              수납 정보 정정
            </Button>
          )}
          {canWrite && tx.status !== "refunded" && (
            <Button variant="danger" onClick={onRefund}>
              환불 기록
            </Button>
          )}
        </>
      }
    >
      <div className="commerce-detail-top">
        <div>
          <h3>{tx.customerName || "방문 고객"}</h3>
          <p className="muted">
            {tx.date} {tx.time} · {methodNames[tx.method]}
          </p>
        </div>
        <Badge tone={paymentTone(tx.status)}>
          {paymentNames[tx.status] || tx.status}
        </Badge>
      </div>
      <dl className="commerce-definition">
        <dt>결제 번호</dt>
        <dd>{tx.id}</dd>
        <dt>담당 직원</dt>
        <dd>
          {data.staff.find((s) => s.id === tx.staffId)?.name || "기존 담당자"}
        </dd>
        <dt>시술 · 판매일</dt>
        <dd>{tx.serviceDate || tx.date}</dd>
        <dt>승인 · 거래번호</dt>
        <dd>{tx.reference || "미입력"}</dd>
        {tx.customerId && (
          <>
            <dt>고객 정보</dt>
            <dd>
              <button
                className="commerce-tag-button"
                onClick={() => {
                  onClose();
                  navigate("customers", { customerId: tx.customerId });
                }}
              >
                고객 차트 열기
              </button>
            </dd>
          </>
        )}
        {tx.appointmentId && (
          <>
            <dt>연결 예약</dt>
            <dd>
              <button
                className="commerce-tag-button"
                onClick={() => {
                  onClose();
                  navigate("appointments", { appointmentId: tx.appointmentId });
                }}
              >
                예약 확인
              </button>
            </dd>
          </>
        )}
        {tx.notes && (
          <>
            <dt>수납 메모</dt>
            <dd className="commerce-prewrap">{tx.notes}</dd>
          </>
        )}
      </dl>
      <h3 className="commerce-section-title">결제 항목</h3>
      <div className="table-wrap">
        <table className="table commerce-table">
          <thead>
            <tr>
              <th>항목</th>
              <th className="numeric">수량</th>
              <th className="numeric">할인</th>
              <th className="numeric">결제액</th>
              <th className="numeric">환불액</th>
            </tr>
          </thead>
          <tbody>
            {tx.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.name}</strong>
                  <span className="commerce-secondary">
                    {line.type === "service" ? "시술" : "상품"} · 단가{" "}
                    {money(line.unitPrice)}
                  </span>
                </td>
                <td className="numeric">{quantity(line.quantity)}</td>
                <td className="numeric">
                  <Money value={line.discount || 0} />
                </td>
                <td className="numeric">
                  <Money value={line.total} />
                </td>
                <td className="numeric">
                  {refunded[line.id] ? money(refunded[line.id].amount) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="commerce-totals">
        <div>
          <span>원 결제액</span>
          <Money value={tx.total} />
        </div>
        <div>
          <span>누적 환불액</span>
          <Money value={refundTotal} />
        </div>
        <div className="grand-total">
          <span>환불 후 결제액</span>
          <Money value={tx.total - refundTotal} />
        </div>
      </div>
      {refunds.length > 0 && (
        <section>
          <h3 className="commerce-section-title">환불 이력</h3>
          <ul className="commerce-timeline">
            {refunds.map((r) => (
              <li key={r.id}>
                <strong>
                  {money(r.amount)} · {methodNames[r.method]}
                </strong>
                <span className="commerce-secondary">
                  {r.date} {r.time} · {r.reference || "거래번호 미입력"}
                </span>
                <p>{r.reason}</p>
                <p className="commerce-note">
                  {r.lines
                    .map(
                      (l) =>
                        `${tx.lines.find((t) => t.id === l.lineId)?.name || "품목"} ${quantity(l.quantity)}${l.restock ? " (재입고)" : ""}`,
                    )
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(tx.changes || []).length > 0 && (
        <section>
          <h3 className="commerce-section-title">정보 정정 이력</h3>
          <ul className="commerce-timeline">
            {tx.changes.map((c, index) => (
              <li key={index}>
                <strong>
                  {c.actorName || "직원"} · {displayTime(c.at || c.createdAt)}
                </strong>
                <p>{c.reason || "정보 정정"}</p>
                {c.before && c.after && (
                  <p className="commerce-note">
                    {c.before.method !== c.after.method &&
                      `결제 수단: ${methodNames[c.before.method] || c.before.method} → ${methodNames[c.after.method] || c.after.method}`}{" "}
                    {c.before.reference !== c.after.reference &&
                      `거래번호: ${c.before.reference || "없음"} → ${c.after.reference || "없음"}`}{" "}
                    {c.before.staffId !== c.after.staffId &&
                      `담당자: ${data.staff.find((s) => s.id === c.before.staffId)?.name || "기존 담당자"} → ${data.staff.find((s) => s.id === c.after.staffId)?.name || "기존 담당자"}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}

function CorrectionForm({ tx, data, runAction, onClose, onSaved }) {
  const [form, setForm] = useState({
    staffId: tx.staffId,
    method: tx.method,
    reference: tx.reference || "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction("payment.correct", { id: tx.id, ...form });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="수납 정보 정정"
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button
            variant="primary"
            type="submit"
            form="payment-correct"
            busy={busy}
          >
            정정 저장
          </Button>
        </>
      }
    >
      <form id="payment-correct" onSubmit={submit} className="stack">
        <fieldset disabled={busy} className="commerce-fieldset">
          <div className="alert">
            담당자·결제 수단·거래번호의 오입력을 바로잡습니다. 결제액과 재고
            사용량은 유지됩니다. 금액을 변경하려면 환불 또는 추가 수납을
            기록하세요.
          </div>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <Field label="담당 직원">
            <select
              className="select"
              value={form.staffId}
              required
              onChange={(e) => update("staffId", e.target.value)}
            >
              {data.staff
                .filter((s) => s.status === "active" || s.id === tx.staffId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="결제 수단">
            <select
              className="select"
              value={form.method}
              onChange={(e) => update("method", e.target.value)}
            >
              {Object.entries(methodNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="승인번호 · 거래번호">
            <input
              className="input"
              maxLength={100}
              value={form.reference}
              onChange={(e) => update("reference", e.target.value)}
            />
          </Field>
          <Field label="정정 사유 (필수)">
            <textarea
              className="textarea"
              required
              maxLength={1000}
              value={form.reason}
              onChange={(e) => update("reason", e.target.value)}
              placeholder="예: 단말기 거래내역 확인 후 승인번호 정정"
            />
          </Field>
        </fieldset>
      </form>
    </Modal>
  );
}

function RefundForm({ tx, data, runAction, onClose, onSaved }) {
  const previous = refundedLines(data, tx.id);
  const [form, setForm] = useState({
    lines: tx.lines.map((line) => ({
      lineId: line.id,
      quantity: "0",
      restock: false,
    })),
    method: tx.method,
    reference: "",
    reason: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setConfirmed(false);
    setDirty(true);
  };
  const total = form.lines.reduce(
    (sum, line) =>
      sum +
      refundEstimate(
        tx.lines.find((l) => l.id === line.lineId),
        line.quantity,
        previous[line.lineId],
      ),
    0,
  );
  const full = () =>
    update(
      "lines",
      tx.lines.map((line) => ({
        lineId: line.id,
        quantity: String(
          Math.max(
            0,
            Math.round(
              (line.quantity - (previous[line.id]?.quantity || 0)) * 1000,
            ) / 1000,
          ),
        ),
        restock: false,
      })),
    );
  const setLine = (lineId, key, value) =>
    update(
      "lines",
      form.lines.map((line) =>
        line.lineId === lineId ? { ...line, [key]: value } : line,
      ),
    );
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const lines = form.lines
      .filter((l) => Number(l.quantity) > 0)
      .map((l) => ({ ...l, quantity: Number(l.quantity) }));
    if (!lines.length) return setError("환불할 항목의 수량을 입력해 주세요.");
    if (!confirmed) return setError("실제 환불 완료 여부를 확인해 주세요.");
    setBusy(true);
    setError("");
    try {
      await runAction("payment.refund", {
        transactionId: tx.id,
        ...form,
        lines,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="환불 기록"
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      size="wide"
      footer={
        <>
          <Button
            variant="danger"
            type="submit"
            form="payment-refund"
            busy={busy}
            disabled={
              !confirmed || !form.lines.some((l) => Number(l.quantity) > 0)
            }
          >
            환불 {money(total)} 기록
          </Button>
        </>
      }
    >
      <form id="payment-refund" onSubmit={submit} className="stack">
        <fieldset disabled={busy} className="commerce-fieldset">
          <div className="alert alert-warning">
            단말기 승인 취소 또는 실제 환불을 먼저 완료해 주세요. 환불은 오늘
            매출 정산에 반영됩니다. 이미 사용한 시술 재료는 자동으로 복구되지
            않습니다.
          </div>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <h3 className="commerce-section-title">
            {tx.customerName || "방문 고객"} · 환불 항목
            <Button variant="secondary" onClick={full}>
              남은 수량 전체
            </Button>
          </h3>
          {tx.lines.map((line) => {
            const remaining = Math.max(
              0,
              Math.round(
                (line.quantity - (previous[line.id]?.quantity || 0)) * 1000,
              ) / 1000,
            );
            const draft = form.lines.find((l) => l.lineId === line.id);
            const item =
              line.type === "product"
                ? data.items.find((i) => i.id === line.refId)
                : null;
            return (
              <div key={line.id} className="commerce-refund-line">
                <strong>{line.name}</strong>
                <span className="commerce-secondary">
                  원 수량 {quantity(line.quantity)} · 남은 환불 가능 수량{" "}
                  {quantity(remaining)} · 할인 반영액 {money(line.total)}
                </span>
                {remaining > 0 ? (
                  <>
                    <div className="refund-fields">
                      <Field label="이번 환불 수량">
                        <input
                          className="input"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={remaining}
                          step={
                            line.type === "product" && item?.unit !== "개"
                              ? ".001"
                              : "1"
                          }
                          required
                          value={draft.quantity}
                          onChange={(e) =>
                            setLine(line.id, "quantity", e.target.value)
                          }
                        />
                      </Field>
                      <div className="refund-preview">
                        {money(
                          refundEstimate(
                            line,
                            draft.quantity,
                            previous[line.id],
                          ),
                        )}
                      </div>
                    </div>
                    {line.type === "product" && (
                      <label className="commerce-check">
                        <input
                          type="checkbox"
                          checked={draft.restock}
                          disabled={numeric(draft.quantity) <= 0}
                          onChange={(e) =>
                            setLine(line.id, "restock", e.target.checked)
                          }
                        />
                        <span>
                          실제로 회수한 상품을 재고에 다시 추가합니다.
                        </span>
                      </label>
                    )}
                  </>
                ) : (
                  <Badge tone="muted">환불 완료</Badge>
                )}
              </div>
            );
          })}
          <div className="commerce-totals">
            <div className="grand-total">
              <span>이번 환불 예상액</span>
              <Money value={total} />
            </div>
          </div>
          <p className="commerce-note">
            전체 할인액을 각 항목에 배분한 금액으로 계산합니다. 저장 시 서버가
            잔여 수량과 금액을 다시 확인합니다.
          </p>
          <div className="commerce-form-grid">
            <Field label="실제 환불 수단">
              <select
                className="select"
                value={form.method}
                onChange={(e) => update("method", e.target.value)}
              >
                {Object.entries(methodNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="환불 승인번호 · 거래번호">
              <input
                className="input"
                maxLength={100}
                value={form.reference}
                onChange={(e) => update("reference", e.target.value)}
              />
            </Field>
            <div className="full">
              <Field label="환불 사유 (필수)">
                <textarea
                  className="textarea"
                  required
                  maxLength={1000}
                  value={form.reason}
                  onChange={(e) => update("reason", e.target.value)}
                  placeholder="예: 미사용 판매 상품 반품, 서비스 결제 착오"
                />
              </Field>
            </div>
          </div>
          <label className="commerce-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setDirty(true);
              }}
            />
            <span>
              고객에게 {money(total)} 환불을 완료했으며 수량과 상품 회수 여부를
              확인했습니다.
            </span>
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
