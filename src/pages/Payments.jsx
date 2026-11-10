import { DateInput } from "../components/DateInput.jsx";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Button,
  Modal,
  Field,
  Badge,
  EmptyState,
  Money,
} from "../components/ui";
import Icon from "../components/Icon";
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
import "./Payments.css";
import { useViewState } from "../components/ViewState";
import { matchesSearch } from "./commerce-utils";
import {
  printDocument,
  escapeHtml,
  printMoney,
  logoTag,
} from "../print";

const paymentPill = (status) =>
  status === "paid"
    ? "status-ok"
    : status === "refunded"
      ? "status-muted"
      : "status-warn";
const numeric = (value) => Number(value || 0);
const pad2 = (value) => String(value).padStart(2, "0");
const clock = (minutes) =>
  `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
const shortDate = (date) => {
  const [, month, day] = String(date || "").split("-");
  return month && day ? `${Number(month)}월 ${Number(day)}일` : date || "";
};
const initialOf = (name) => String(name || "").trim().charAt(0) || "방";
const roundQty = (value) => Math.max(0, Math.round(value * 1000) / 1000);
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayOf = (date) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? "" : `${WEEKDAYS[day]}요일`;
};
/** "11월 9일 18:05" in Seoul time for a stored ISO timestamp. */
const seoulMoment = (value) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return value ? String(value) : "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${Number(parts.month)}월 ${Number(parts.day)}일 ${parts.hour}:${parts.minute}`;
};
// Final consonant of the last character decides 로 or 으로 (ㄹ takes 로).
const DIGIT_FINAL = { 0: 1, 1: 8, 2: 0, 3: 1, 4: 0, 5: 0, 6: 1, 7: 8, 8: 8, 9: 0 };
const withRo = (word) => {
  const text = String(word ?? "");
  const last = text.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  let final = null;
  if (code >= 0 && code <= 11171) final = code % 28;
  else if (/[0-9]/.test(last)) final = DIGIT_FINAL[last];
  if (final === null) return `${text}(으)로`;
  return `${text}${final === 0 || final === 8 ? "로" : "으로"}`;
};
const receivedBy = (method) => `${withRo(methodNames[method] || method)} 받았어요`;

/** Pill-shaped single-choice chips (role="radio") with arrow-key support. */
function ChipRadios({ options, value, onChange, labelledBy, label, bordered }) {
  const selected = options.some(([key]) => key === value);
  const move = (event, index) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next][0]);
    event.currentTarget.parentElement?.children[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={`paym-chips ${bordered ? "paym-chips-bordered" : ""}`}
    >
      {options.map(([key, name], index) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          tabIndex={value === key || (!selected && index === 0) ? 0 : -1}
          onClick={() => onChange(key)}
          onKeyDown={(event) => move(event, index)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

/** Close through the dialog's own close button so the unsaved-changes check runs. */
function requestModalClose(event) {
  event.currentTarget
    .closest(".modal")
    ?.querySelector('.modal-header button[aria-label="닫기"]')
    ?.click();
}

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
  const [periodOpen, setPeriodOpen] = useState(false);
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
  const isToday = from === today && to === today;
  const isMonth = from === monthStart() && to === today;
  return (
    <div className="paym-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">결제와 환불 기록</p>
          <h1 className="page-title">수납</h1>
        </div>
        {canWrite && (
          <Button
            variant="primary"
            aria-label="+ 수납 기록"
            onClick={() => setDialog({ kind: "create" })}
          >
            <Icon name="plus" size={16} />
            수납 기록
          </Button>
        )}
      </header>
      <div className="home-stats paym-stats">
        <div className="home-stat paym-stat-extra">
          <span className="home-stat-label">기간 결제액</span>
          <strong className="home-stat-value">
            <Money value={gross} />
          </strong>
          <span className="paym-stat-note">
            {from} ~ {to}
          </span>
        </div>
        <div className="home-stat paym-stat-extra">
          <span className="home-stat-label">기간 환불액</span>
          <strong className="home-stat-value">
            <Money value={refundTotal} />
          </strong>
          <span className="paym-stat-note">실제 환불한 날 기준</span>
        </div>
        <div className="home-stat">
          <span className="home-stat-label">기간 순수납액</span>
          <strong className="home-stat-value">
            <Money value={gross - refundTotal} />
          </strong>
          <span className="paym-stat-note">결제액에서 환불액을 뺀 금액</span>
        </div>
        <div
          className={`home-stat paym-stat-pending${pending.length ? " is-waiting" : ""}`}
        >
          <span className="home-stat-label">수납 대기</span>
          <strong className="home-stat-value">
            {pending.length}
            <small>건</small>
          </strong>
          <span className="paym-stat-note">접수부터 시술 완료까지</span>
        </div>
      </div>
      {canWrite && pending.length > 0 && (
        <section className="panel paym-pending" aria-label="수납 대기 예약">
          <div className="panel-head">
            <h2 ref={pendingHeading} tabIndex={-1}>
              수납할 예약
            </h2>
            <span className="badge badge-warning">{pending.length}건</span>
          </div>
          <ul className="paym-pending-list">
            {pending.map((a) => {
              const name =
                data.customers.find((c) => c.id === a.customerId)?.name ||
                a.guestName ||
                "방문 고객";
              const staffLabel =
                staff.find((s) => s.id === a.staffId)?.name || "담당자 미지정";
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className="list-row paym-row"
                    onClick={() =>
                      setDialog({ kind: "create", appointmentId: a.id })
                    }
                  >
                    <span className="paym-avatar" aria-hidden="true">
                      {initialOf(name)}
                    </span>
                    <span className="paym-row-time" aria-hidden="true">
                      {clock(a.start)}
                    </span>
                    <span className="paym-row-main">
                      <strong>{name}</strong>
                      <small
                        className={
                          a.date === today ? "paym-row-when is-today" : "paym-row-when"
                        }
                      >
                        {shortDate(a.date)} {clock(a.start)}
                      </small>
                      <small className="paym-row-services">
                        {a.serviceIds
                          .map(
                            (id) => data.services.find((s) => s.id === id)?.name,
                          )
                          .filter(Boolean)
                          .join(", ") || "시술 선택 필요"}
                      </small>
                      <small className="paym-row-staff">
                        {staffLabel}
                      </small>
                    </span>
                    <span className="paym-row-side">{staffLabel}</span>
                    <span className="paym-row-cta" aria-hidden="true">
                      수납
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="panel paym-history" aria-labelledby="paym-history-title">
        <div className="panel-head">
          <h2 id="paym-history-title">수납 기록</h2>
          <span className="muted" role="status">
            조회 결과 {records.length}건
          </span>
        </div>
        <div className="paym-filters">
          <Field label="결제 시작일" className="paym-date-field">
            <DateInput
              className="input"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="결제 종료일" className="paym-date-field">
            <DateInput
              className="input"
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="검색" className="paym-search">
            <div className="input-icon">
              <Icon name="search" />
              <input
                type="search"
                placeholder="고객명, 연락처, 시술, 승인번호"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </Field>
        </div>
        <div className="paym-filter-chips">
          <div className="chip-row" role="group" aria-label="수납 빠른 기간 선택">
            <button
              type="button"
              className="chip"
              aria-pressed={isToday}
              onClick={() => {
                setFrom(today);
                setTo(today);
              }}
            >
              오늘
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={isMonth}
              onClick={() => {
                setFrom(monthStart());
                setTo(today);
              }}
            >
              이번 달
            </button>
            <button
              type="button"
              className="paym-period-btn"
              aria-haspopup="dialog"
              aria-label={`조회 기간 ${from} ~ ${to}`}
              onClick={() => setPeriodOpen(true)}
            >
              <Icon name="calendar" size={16} />
              {from === to
                ? shortDate(from)
                : `${shortDate(from)} ~ ${shortDate(to)}`}
            </button>
          </div>
          <div className="chip-row" role="group" aria-label="처리 상태">
            {[["all", "전체"], ...Object.entries(paymentNames)].map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="chip"
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setFrom(monthStart());
              setTo(today);
              setQuery("");
              setStatus("all");
            }}
          >
            조회 조건 초기화
          </button>
        </div>
        {from > to && (
          <p className="error" role="alert">
            시작일이 종료일보다 늦어요. 조회 기간을 확인해 주세요.
          </p>
        )}
        {records.length ? (
          <>
            <div className="paym-tx-head" aria-hidden="true">
              <span>고객</span>
              <span>담당</span>
              <span>수단</span>
              <span>상태</span>
              <span>결제액</span>
            </div>
            <ul className="paym-tx-list">
              {records.slice(0, limit).map((tx) => {
                const refunded = (data.refunds || [])
                  .filter((r) => r.transactionId === tx.id)
                  .reduce((sum, r) => sum + r.amount, 0);
                const name = tx.customerName || "방문 고객";
                return (
                  <li key={tx.id}>
                    <button
                      type="button"
                      className="list-row paym-tx"
                      aria-label={`${name} 결제 상세`}
                      onClick={() => setDialog({ kind: "detail", id: tx.id })}
                    >
                      <span className="paym-avatar" aria-hidden="true">
                        {initialOf(name)}
                      </span>
                      <span className="paym-row-main">
                        <strong>{name}</strong>
                        <small>
                          {tx.date} {tx.time}
                        </small>
                      </span>
                      <span className="paym-tx-staff">
                        {staff.find((s) => s.id === tx.staffId)?.name ||
                          "기존 담당자"}
                      </span>
                      <span className="paym-tx-method">
                        {methodNames[tx.method] || tx.method}
                      </span>
                      <span className="paym-tx-status">
                        <span className={`paym-pill ${paymentPill(tx.status)}`}>
                          {paymentNames[tx.status] || tx.status}
                        </span>
                      </span>
                      <span className="paym-tx-amount">
                        <strong>{money(tx.total)}</strong>
                        {refunded > 0 && <small>환불 {money(refunded)}</small>}
                      </span>
                      <Icon name="chevron-right" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState
            title="조회된 수납 기록이 없어요"
            description="기간과 검색 조건을 확인하거나 첫 수납을 기록해 주세요."
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
          <Button
            className="paym-more"
            onClick={() => setLimit((value) => value + 50)}
          >
            더 보기 ({limit} / {records.length})
          </Button>
        )}
        <p className="paym-note">
          목록은 처음 결제한 날로 조회해요. 당일 환불과 정산 내역은{" "}
          <button
            type="button"
            className="paym-link"
            onClick={() => navigate("sales")}
          >
            매출
          </button>
          에서 확인해 주세요.
        </p>
      </section>
      {periodOpen && (
        <Modal
          title="조회 기간"
          onClose={() => setPeriodOpen(false)}
          footer={
            <Button variant="primary" onClick={() => setPeriodOpen(false)}>
              확인
            </Button>
          }
        >
          <div className="paym-grid-2">
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
          </div>
          {from > to && (
            <p className="error" role="alert">
              시작일이 종료일보다 늦어요. 조회 기간을 확인해 주세요.
            </p>
          )}
        </Modal>
      )}
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
          onReprice={() => setDialog({ kind: "reprice", id: currentTx.id })}
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
      {currentTx && dialog.kind === "reprice" && (
        <RepriceForm
          tx={currentTx}
          runAction={runAction}
          onClose={() => setDialog({ kind: "detail", id: currentTx.id })}
          onSaved={() =>
            saved(
              "금액 정정을 기록했습니다. 시술 재료와 상품 재고는 유지됩니다.",
            )
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
    </div>
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
    materialQuantities: {},
    materialReason: "",
    discount: "0",
    method: "card",
    reference: "",
    notes: "",
  }));
  const [customerQuery, setCustomerQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [editingPrice, setEditingPrice] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const customerSearch = useRef(null);
  const listboxRef = useRef(null);
  const uid = useId();
  const listboxId = `${uid}-results`;
  const methodLabelId = `${uid}-method`;
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
  const results = [
    ...serviceOptions.map((item) => ({ type: "service", item })),
    ...productOptions.map((item) => ({ type: "product", item })),
  ];
  const showList = listOpen && results.length > 0;
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
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
      standard: used,
      used:
        data.items.find((i) => i.id === id)?.kind === "시술 재료" &&
        form.materialQuantities[id] !== undefined
          ? numeric(form.materialQuantities[id])
          : used,
    }));
  }, [form.lines, form.materialQuantities, data.services, data.items]);
  const insufficient = stockUse.filter(
    ({ item, used }) => !item || used > item.qty + 0.00001,
  );
  useEffect(() => {
    if (!showList) return;
    listboxRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [showList, activeIndex]);
  function addLine(type, refId) {
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
    setCatalogQuery("");
    setActive(0);
    setListOpen(false);
  }
  const setLine = (key, field, value) =>
    update(
      "lines",
      form.lines.map((l) => (l.key === key ? { ...l, [field]: value } : l)),
    );
  function comboKey(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!listOpen) return setListOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(
        (activeIndex + step + results.length) % Math.max(1, results.length),
      );
    } else if (event.key === "Enter") {
      // Enter adds the highlighted result instead of submitting the form.
      event.preventDefault();
      const pick = showList || catalogQuery ? results[activeIndex] : null;
      if (pick) addLine(pick.type, pick.item.id);
    } else if (event.key === "Escape" && showList) {
      event.preventDefault();
      setListOpen(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!form.lines.length)
      return setError("시술 또는 판매 상품을 한 개 이상 담아 주세요.");
    if (!confirmed) return setError("실제 결제 완료 여부를 확인해 주세요.");
    if (total < 0)
      return setError("할인액은 시술과 상품 합계보다 클 수 없어요.");
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
        materialUsage: stockUse
          .filter(({ item }) => item?.kind === "시술 재료")
          .map(({ item, used }) => ({ itemId: item.id, quantity: used })),
        materialReason: form.materialReason,
        discount: Number(form.discount || 0),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const customerName = customer?.name || form.guestName || "방문 고객";
  return (
    <Modal
      title={appointment ? "예약 수납 기록" : "새 수납 기록"}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      size="wide"
    >
      <form id="payment-create" onSubmit={submit} className="paym-checkout">
        <fieldset disabled={busy} className="paym-fieldset">
          {error && (
            <div className="alert alert-danger paym-error" role="alert">
              {error}
            </div>
          )}
          <div className="paym-checkout-grid">
            <section className="paym-cart" aria-label="담은 항목">
              <div className="paym-customer">
                <span className="paym-avatar paym-avatar-lg" aria-hidden="true">
                  {initialOf(customerName)}
                </span>
                <span className="paym-customer-text">
                  <strong>
                    {customer
                      ? `${customer.name} 님`
                      : form.guestName
                        ? `${form.guestName} 님`
                        : "방문 고객"}
                  </strong>
                  {customer?.warning ? (
                    <span className="paym-customer-warning">
                      {customer.warning}
                    </span>
                  ) : (
                    <span className="paym-customer-sub">
                      {appointment
                        ? "예약한 고객으로 연결돼요"
                        : customer?.phone || "비회원"}
                    </span>
                  )}
                </span>
                {!appointment && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => customerSearch.current?.focus()}
                  >
                    바꾸기
                  </button>
                )}
              </div>
              {!appointment && (
                <div className="paym-customer-pick">
                  <Field label="고객 빠른 검색">
                    <input
                      ref={customerSearch}
                      className="input"
                      type="search"
                      value={customerQuery}
                      placeholder="이름이나 연락처 일부"
                      onChange={(e) => setCustomerQuery(e.target.value)}
                    />
                  </Field>
                  <Field label="고객">
                    <select
                      className="select"
                      value={form.customerId}
                      onChange={(e) => update("customerId", e.target.value)}
                    >
                      <option value="">방문 고객 (비회원)</option>
                      {customerOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.phone || "연락처 없음"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {customerQuery && customerOptions.length === 0 && (
                    <span className="help paym-span" role="status">
                      일치하는 고객이 없어요. 방문 고객으로 기록할 수 있어요.
                    </span>
                  )}
                  {!form.customerId && (
                    <Field label="방문 고객 이름" className="paym-span">
                      <input
                        className="input"
                        maxLength={60}
                        value={form.guestName}
                        placeholder="예: 방문 고객"
                        onChange={(e) => update("guestName", e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              )}
              <div className="paym-combo">
                <label htmlFor={`${uid}-catalog`} className="field-label">
                  시술이나 상품 담기
                </label>
                <div className="input-icon">
                  <Icon name="search" />
                  <input
                    id={`${uid}-catalog`}
                    type="text"
                    role="combobox"
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={showList}
                    aria-controls={listboxId}
                    aria-activedescendant={
                      showList ? `${listboxId}-${activeIndex}` : undefined
                    }
                    aria-describedby={`${uid}-combo-hint`}
                    placeholder="시술이나 상품 이름"
                    value={catalogQuery}
                    onChange={(e) => {
                      setCatalogQuery(e.target.value);
                      setActive(0);
                      setListOpen(true);
                    }}
                    onClick={() => setListOpen(true)}
                    onBlur={() => setListOpen(false)}
                    onKeyDown={comboKey}
                  />
                </div>
                {showList && (
                  <ul
                    id={listboxId}
                    ref={listboxRef}
                    role="listbox"
                    aria-label="검색 결과"
                    className="paym-listbox"
                  >
                    {results.map(({ type, item }, index) => (
                      <li
                        key={`${type}:${item.id}`}
                        id={`${listboxId}-${index}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => addLine(type, item.id)}
                      >
                        <span className="paym-option-name">{item.name}</span>
                        {type === "product" && (
                          <span className="paym-option-meta">
                            재고 {quantity(item.qty)}
                            {item.unit}
                          </span>
                        )}
                        <span className="paym-option-price">
                          {money(item.price)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {catalogQuery && !results.length ? (
                  <span id={`${uid}-combo-hint`} className="help" role="status">
                    검색에 맞는 시술이나 상품이 없어요. 사용 중인 품목인지
                    확인해 주세요.
                  </span>
                ) : (
                  <span id={`${uid}-combo-hint`} className="help">
                    Enter를 누르면 바로 담겨요
                  </span>
                )}
              </div>
              {form.lines.length ? (
                <ul className="paym-lines">
                  {form.lines.map((line) => {
                    const item = lineItem(line);
                    const name = item?.name || "품목";
                    const decimal =
                      line.type === "product" && item?.unit !== "개";
                    const min = decimal ? 0.001 : 1;
                    const qty = numeric(line.quantity);
                    const editing = editingPrice === line.key;
                    return (
                      <li className="paym-line" key={line.key}>
                        <span className="paym-line-name">
                          <strong>{item?.name || "삭제된 품목"}</strong>
                          <small>
                            {money(line.unitPrice)}
                            {line.type === "product" &&
                              ` 재고 ${quantity(item?.qty)}${item?.unit || "개"}`}
                          </small>
                        </span>
                        <span
                          className="paym-qty"
                          role="group"
                          aria-label={`${name} 수량 조절`}
                        >
                          <button
                            type="button"
                            aria-label={`${name} 수량 줄이기`}
                            disabled={qty <= min}
                            onClick={() =>
                              setLine(
                                line.key,
                                "quantity",
                                String(Math.max(min, roundQty(qty - 1))),
                              )
                            }
                          >
                            <Icon name="minus" />
                          </button>
                          <input
                            aria-label={`${name} 수량`}
                            type="number"
                            inputMode="decimal"
                            min={decimal ? ".001" : "1"}
                            step={decimal ? ".001" : "1"}
                            required
                            value={line.quantity}
                            onChange={(e) =>
                              setLine(line.key, "quantity", e.target.value)
                            }
                          />
                          <button
                            type="button"
                            aria-label={`${name} 수량 늘리기`}
                            onClick={() =>
                              setLine(
                                line.key,
                                "quantity",
                                String(roundQty(qty + 1)),
                              )
                            }
                          >
                            <Icon name="plus" />
                          </button>
                        </span>
                        <strong className="paym-line-total">
                          {money(Math.round(qty * numeric(line.unitPrice)))}
                        </strong>
                        <span className="paym-line-tools">
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`${name} 단가 수정`}
                            aria-expanded={editing}
                            onClick={() =>
                              setEditingPrice(editing ? null : line.key)
                            }
                          >
                            <Icon name="edit" size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`${name} 삭제`}
                            onClick={() =>
                              update(
                                "lines",
                                form.lines.filter((l) => l.key !== line.key),
                              )
                            }
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </span>
                        {editing && (
                        <Field label="단가 (원)" className="paym-line-price">
                          <input
                            className="input"
                            aria-label={`${name} 단가`}
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            required
                            value={line.unitPrice}
                            onChange={(e) =>
                              setLine(line.key, "unitPrice", e.target.value)
                            }
                          />
                        </Field>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="paym-empty">
                  담은 항목이 없어요. 위에서 시술이나 상품을 찾아 담아 주세요.
                </p>
              )}
              {stockUse.length > 0 && (
                <div className="paym-stock">
                  <span className="field-label">저장할 때 쓰는 재고</span>
                  <ul>
                    {stockUse.map(({ item, used }, index) => (
                      <li key={item?.id || index}>
                        <span>{item?.name || "미등록 품목"}</span>
                        <span>
                          {quantity(used)}
                          {item?.unit || ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {stockUse.some(({ item }) => item?.kind === "시술 재료") && (
                <details className="paym-details">
                  <summary>실제 재료 사용량 조정</summary>
                  <p className="help">
                    이번 시술 전체에서 쓴 양을 입력해 주세요. 기본량과 다르면
                    사유를 남겨요.
                  </p>
                  {stockUse
                    .filter(({ item }) => item?.kind === "시술 재료")
                    .map(({ item, standard }) => (
                      <Field
                        key={item.id}
                        label={`${item.name} 실제 사용량 (${item.unit})`}
                        help={`기본 사용량 ${quantity(standard)}${item.unit}`}
                      >
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step={item.unit === "개" ? "1" : ".001"}
                          value={form.materialQuantities[item.id] ?? standard}
                          onChange={(e) =>
                            update("materialQuantities", {
                              ...form.materialQuantities,
                              [item.id]: e.target.value,
                            })
                          }
                          required
                        />
                      </Field>
                    ))}
                  <Field label="사용량 변경 사유">
                    <input
                      className="input"
                      maxLength={500}
                      value={form.materialReason}
                      onChange={(e) => update("materialReason", e.target.value)}
                    />
                  </Field>
                </details>
              )}
              {insufficient.length > 0 && (
                <div role="alert" className="alert alert-warning">
                  {insufficient
                    .map(({ item }) => item?.name || "미등록 품목")
                    .join(", ")}
                  의 재고가 부족해요. 재고 화면에서 실제 입고나 실사 수량을 먼저
                  기록해 주세요.
                </div>
              )}
              <div className="paym-extra">
                <Field label="시술일" help="수납일은 오늘로 기록돼요.">
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
                <Field label="수납 메모">
                  <textarea
                    className="textarea"
                    rows={2}
                    maxLength={1000}
                    value={form.notes}
                    onChange={(e) => update("notes", e.target.value)}
                    placeholder="수납할 때 참고할 내용"
                  />
                </Field>
              </div>
            </section>
            <aside className="paym-summary" aria-label="결제 정보">
              <div className="paym-due">
                <h3>받을 금액</h3>
                <strong className={total < 0 ? "tone-down" : undefined}>
                  {money(total)}
                </strong>
                {numeric(form.discount) > 0 && (
                  <>
                    <span className="small muted">합계 {money(subtotal)}</span>
                    <span className="small tone-up">
                      할인 {money(numeric(form.discount))} 적용
                    </span>
                  </>
                )}
              </div>
              <Field label="전체 할인 (원)">
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={subtotal}
                  step="1"
                  value={form.discount}
                  onChange={(e) => update("discount", e.target.value)}
                />
              </Field>
              <div className="paym-group">
                <span id={methodLabelId} className="field-label">
                  결제 수단
                </span>
                <ChipRadios
                  labelledBy={methodLabelId}
                  options={Object.entries(methodNames)}
                  value={form.method}
                  onChange={(value) => update("method", value)}
                />
              </div>
              <Field
                label="담당 직원"
                help={
                  appointment
                    ? "예약 담당자예요. 바꾸려면 예약에서 먼저 수정해 주세요."
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
              {selectedStaff?.status === "inactive" && (
                <p className="small tone-warn-text paym-flat">
                  지금은 비활성 직원이에요. 실제 담당자를 확인해 주세요.
                </p>
              )}
              <Field
                label="승인번호"
                help="카드번호 전체나 비밀번호는 적지 마세요."
              >
                <input
                  className="input"
                  maxLength={100}
                  value={form.reference}
                  onChange={(e) => update("reference", e.target.value)}
                  placeholder="단말기 영수증의 번호"
                />
              </Field>
              <label className="paym-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                    setDirty(true);
                  }}
                />
                <span>단말기 승인이나 현금 수령, 이체 확인을 마쳤어요</span>
              </label>
              <div className="paym-submit">
                <Button
                  variant="primary"
                  type="submit"
                  busy={busy}
                  disabled={
                    !confirmed || !form.lines.length || insufficient.length > 0
                  }
                >
                  수납 {money(Math.max(0, total))} 기록
                </Button>
                <span className="small muted">
                  단말기 승인을 마친 뒤 눌러 주세요
                </span>
              </div>
            </aside>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function printReceipt(tx, data) {
  const store = data.store || {};
  const refunds = (data.refunds || []).filter((r) => r.transactionId === tx.id);
  const staff =
    data.staff.find((s) => s.id === tx.staffId)?.name || "기존 담당자";
  const grid =
    "display:grid;grid-template-columns:minmax(0,1fr) 40px 96px 88px 104px;gap:8px";
  const row = (label, value) =>
    `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#555">${label}</span><span>${value}</span></div>`;
  const lines = (tx.lines || [])
    .map(
      (line) => `<div style="${grid};align-items:start">
        <span style="display:flex;flex-direction:column;gap:4px"><span style="font-weight:600">${escapeHtml(
          line.name,
        )}</span><span class="small">${line.type === "service" ? "시술" : "상품"}</span></span>
        <span class="num">${escapeHtml(quantity(line.quantity))}</span>
        <span class="num">${printMoney(line.unitPrice)}</span>
        <span class="num">${line.discount ? `-${printMoney(line.discount)}` : "없음"}</span>
        <span class="num" style="font-weight:600">${printMoney(line.total)}</span>
      </div>`,
    )
    .join("");
  const refundRows = refunds
    .map(
      (r) => `<div style="display:flex;justify-content:space-between;gap:16px;align-items:start">
        <span style="display:flex;flex-direction:column;gap:4px">
          <span>${escapeHtml(`${r.date} ${r.time || ""}`.trim())}</span>
          <span class="small">${escapeHtml(methodNames[r.method] || r.method)}</span>
          ${r.reason ? `<span class="small">${escapeHtml(r.reason)}</span>` : ""}
        </span>
        <span class="num">-${printMoney(r.amount)}</span>
      </div>`,
    )
    .join("");
  const refundTotal = refunds.reduce((sum, r) => sum + r.amount, 0);
  const storeRows = [
    ["상호", store.name],
    ["대표자", store.representative],
    ["사업자번호", store.businessNumber],
    ["주소", store.address],
    ["연락처", store.phone],
  ].filter(([, value]) => value);
  const kv = (rows) =>
    `<dl class="kv">${rows
      .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
      .join("")}</dl>`;
  const brand = logoTag(store) ||
    (store.name
      ? `<span class="brand"><span class="brand-dot"></span>${escapeHtml(store.name)}</span>`
      : "");
  printDocument(
    `영수증 ${tx.date}`,
    `<div class="doc-head">
      <div style="display:flex;flex-direction:column;gap:8px">${brand}<h1>영수증</h1></div>
      <span class="small" style="color:#555">결제 번호 ${escapeHtml(tx.id)}</span>
    </div>
    <div class="grid-2" style="margin-bottom:24px">
      ${kv([
        ["결제일시", `${tx.date} ${tx.time || ""}`.trim()],
        ["고객", tx.customerName ? `${tx.customerName} 님` : "방문 고객"],
        ["담당", staff],
      ])}
      ${storeRows.length ? kv(storeRows) : "<div></div>"}
    </div>
    <section class="box" aria-label="결제 항목" style="display:flex;flex-direction:column;gap:12px">
      <div style="${grid}" class="label"><span>항목</span><span class="num">수량</span><span class="num">단가</span><span class="num">할인</span><span class="num">금액</span></div>
      ${lines}
    </section>
    <section aria-label="결제 금액" style="margin-top:24px;display:flex;flex-direction:column;gap:8px">
      ${row("공급 합계", printMoney(tx.subtotal))}
      ${tx.discount ? row("할인", `-${printMoney(tx.discount)}`) : ""}
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px"><strong style="font-size:16px;line-height:24px">결제 금액</strong><strong style="font-size:18px;line-height:24px">${printMoney(tx.total)}</strong></div>
      ${row("결제 수단", escapeHtml(methodNames[tx.method] || tx.method))}
      ${tx.reference ? row("승인번호", escapeHtml(tx.reference)) : ""}
    </section>
    ${
      refunds.length
        ? `<section class="box" style="margin-top:24px;display:flex;flex-direction:column;gap:8px">
        <h2 style="margin:0">환불 내역</h2>
        ${refundRows}
        <div style="margin-top:4px;display:flex;justify-content:space-between;gap:16px"><strong style="font-weight:600">환불 후 결제액</strong><strong style="font-weight:600">${printMoney(
          tx.total - refundTotal,
        )}</strong></div>
      </section>`
        : ""
    }
    <p class="small" style="margin-top:24px">카드 결제는 카드 단말기 매출전표가 정식 증빙이에요. 이 영수증은 매장 거래 확인용이에요.</p>
    ${store.name ? `<div class="footer" style="font-weight:600">${escapeHtml(store.name)}</div>` : ""}`,
  );
}
function PaymentDetail({
  tx,
  data,
  canWrite,
  onClose,
  onCorrect,
  onRefund,
  onReprice,
  navigate,
}) {
  const refunds = (data.refunds || []).filter((r) => r.transactionId === tx.id);
  const refundTotal = refunds.reduce((sum, r) => sum + r.amount, 0);
  const refunded = refundedLines(data, tx.id);
  const staffName = (id) =>
    data.staff.find((s) => s.id === id)?.name || "기존 담당자";
  const name = tx.customerName || "방문 고객";
  const canReprice = tx.status === "paid" && !refunds.length;
  const changeLines = (c) => {
    if (!c.before || !c.after) return [];
    const rows = [];
    if (c.before.staffId !== c.after.staffId)
      rows.push(
        `담당자 ${staffName(c.before.staffId)}에서 ${withRo(staffName(c.after.staffId))}`,
      );
    if (c.before.method !== c.after.method)
      rows.push(
        `결제 수단 ${methodNames[c.before.method] || c.before.method}에서 ${withRo(methodNames[c.after.method] || c.after.method)}`,
      );
    if (c.before.reference !== c.after.reference)
      rows.push(
        `승인번호 ${c.before.reference || "없음"}에서 ${withRo(c.after.reference || "없음")}`,
      );
    return rows;
  };
  return (
    <Modal
      title="수납 상세"
      onClose={onClose}
      size="wide"
      footer={
        <>
          <span className="paym-detail-print">
            <Button variant="secondary" onClick={() => printReceipt(tx, data)}>
              <Icon name="print" size={16} />
              영수증 인쇄
            </Button>
          </span>
          {canWrite && (
            <Button variant="secondary" onClick={onCorrect}>
              수납 정보 정정
            </Button>
          )}
          {canWrite && tx.status !== "refunded" && (
            <Button
              variant="secondary"
              onClick={onReprice}
              disabled={!canReprice}
              aria-describedby={
                canReprice ? undefined : "paym-detail-reprice-note"
              }
            >
              금액 정정과 재수납
            </Button>
          )}
          {canWrite && tx.status !== "refunded" && (
            <Button
              variant="danger"
              className="paym-danger-soft"
              onClick={onRefund}
            >
              환불 기록
            </Button>
          )}
        </>
      }
    >
      <div className="paym-detail-who">
        <span className="paym-avatar" aria-hidden="true">
          {initialOf(name)}
        </span>
        <span className="paym-detail-who-text">
          <strong>{tx.customerName ? `${tx.customerName} 님` : name}</strong>
          <span className="num">
            {shortDate(tx.date)} {weekdayOf(tx.date)} {tx.time} 결제
          </span>
          <small>{receivedBy(tx.method)}</small>
        </span>
        <span className={`paym-pill ${paymentPill(tx.status)}`}>
          {paymentNames[tx.status] || tx.status}
        </span>
      </div>
      {(tx.correctsTransactionId || tx.replacedBy) && (
        <p className="paym-info">
          <Icon name="info" size={20} />
          <span>
            {tx.correctsTransactionId ? (
              <>
                <strong>기존 수납 {tx.correctsTransactionId}의 금액 정정 기록이에요</strong>
                <span>재고는 다시 빼지 않았어요.</span>
              </>
            ) : (
              <strong>수납 {tx.replacedBy}로 금액을 정정했어요</strong>
            )}
          </span>
        </p>
      )}
      <dl className="paym-detail-kv">
        <div>
          <dt>결제 번호</dt>
          <dd className="num">{tx.id}</dd>
        </div>
        <div>
          <dt>담당 직원</dt>
          <dd>{staffName(tx.staffId)}</dd>
        </div>
        <div>
          <dt>시술일</dt>
          <dd className="num">{tx.serviceDate || tx.date}</dd>
        </div>
        <div>
          <dt>승인번호</dt>
          <dd className="num">{tx.reference || "미입력"}</dd>
        </div>
        {tx.customerId && (
          <div>
            <dt>고객 정보</dt>
            <dd>
              <button
                type="button"
                className="paym-detail-link"
                onClick={() => {
                  onClose();
                  navigate("customers", { customerId: tx.customerId });
                }}
              >
                손님 정보 보기
                <Icon name="chevron-right" size={16} />
              </button>
            </dd>
          </div>
        )}
        {tx.appointmentId && (
          <div>
            <dt>연결 예약</dt>
            <dd>
              <button
                type="button"
                className="paym-detail-link"
                onClick={() => {
                  onClose();
                  navigate("appointments", { appointmentId: tx.appointmentId });
                }}
              >
                예약 확인
                <Icon name="chevron-right" size={16} />
              </button>
            </dd>
          </div>
        )}
        {tx.notes && (
          <div className="paym-detail-kv-wide">
            <dt>수납 메모</dt>
            <dd className="paym-prewrap">{tx.notes}</dd>
          </div>
        )}
        {tx.materialUsage?.length > 0 && (
          <div className="paym-detail-kv-wide">
            <dt>실제 재료 사용량</dt>
            {tx.materialUsage.map((m, index) => (
              <dd key={m.itemId || index} className="num">
                {m.name} {quantity(m.quantity)}
                {m.unit}
              </dd>
            ))}
            {tx.materialReason && (
              <dd className="paym-detail-kv-sub">{tx.materialReason}</dd>
            )}
          </div>
        )}
      </dl>
      <section className="paym-detail-lines" aria-labelledby="paym-lines-title">
        <h3 id="paym-lines-title">결제 항목</h3>
        <div className="paym-detail-line-head" aria-hidden="true">
          <span>항목</span>
          <span>수량</span>
          <span>할인</span>
          <span>결제액</span>
          <span>환불액</span>
        </div>
        <ul>
          {tx.lines.map((line) => (
            <li key={line.id} className="paym-detail-line">
              <span className="paym-detail-line-name">
                <span>
                  <strong>{line.name}</strong>
                  <span className="paym-tag">
                    {line.type === "service" ? "시술" : "상품"}
                  </span>
                </span>
                <small>단가 {money(line.unitPrice)}</small>
              </span>
              <span data-label="수량">{quantity(line.quantity)}</span>
              <span data-label="할인">{money(line.discount || 0)}</span>
              <strong data-label="결제액">{money(line.total)}</strong>
              <strong
                data-label="환불액"
                className={refunded[line.id] ? "is-refund" : "is-none"}
              >
                {refunded[line.id] ? money(refunded[line.id].amount) : "없음"}
              </strong>
            </li>
          ))}
        </ul>
      </section>
      <div className="paym-detail-totals">
        <div>
          <span>원 결제액</span>
          <strong>{money(tx.total)}</strong>
        </div>
        <div>
          <span>누적 환불액</span>
          <strong className={refundTotal > 0 ? "is-refund" : undefined}>
            {money(refundTotal)}
          </strong>
        </div>
        <div className="is-grand">
          <span>환불 후 결제액</span>
          <strong>{money(tx.total - refundTotal)}</strong>
        </div>
      </div>
      {(refunds.length > 0 || (tx.changes || []).length > 0) && (
        <div className="paym-detail-history">
          {refunds.length > 0 && (
            <section aria-labelledby="paym-refund-history">
              <h3 id="paym-refund-history">환불 이력</h3>
              <ul>
                {refunds.map((r) => (
                  <li key={r.id}>
                    <span className="paym-detail-history-top">
                      <strong className="is-refund">{money(r.amount)}</strong>
                      <small>
                        {shortDate(r.date)} {r.time}
                      </small>
                    </span>
                    <span>{refundMethodNames[r.method] || r.method}</span>
                    <small>
                      {r.reference
                        ? `취소 승인번호 ${r.reference}`
                        : "취소 승인번호 미입력"}
                    </small>
                    {r.reason && <span>{r.reason}</span>}
                    {(r.lines || []).map((l, index) => {
                      const line = tx.lines.find((t) => t.id === l.lineId);
                      const unit =
                        line?.type === "product"
                          ? data.items.find((i) => i.id === line.refId)?.unit ||
                            "개"
                          : "회";
                      return (
                        <small key={l.lineId || index}>
                          {line?.name || "품목"}{" "}
                          {l.mode === "amount"
                            ? `${money(l.amount)} 금액 환불`
                            : `${quantity(l.quantity)}${unit} 환불`}
                          {l.restock ? " 재입고" : ""}
                        </small>
                      );
                    })}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(tx.changes || []).length > 0 && (
            <section aria-labelledby="paym-change-history">
              <h3 id="paym-change-history">정보 정정 이력</h3>
              <ul>
                {tx.changes.map((c, index) => (
                  <li key={index}>
                    <span className="paym-detail-history-top">
                      <strong>{c.actorName || "직원"}</strong>
                      <small>{seoulMoment(c.at || c.createdAt)}</small>
                    </span>
                    <span>{c.reason || c.kind || "정보 정정"}</span>
                    {changeLines(c).map((row) => (
                      <small key={row}>{row}</small>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {canWrite && !canReprice && tx.status !== "refunded" && (
        <p id="paym-detail-reprice-note" className="paym-detail-note">
          <Icon name="info" size={16} />
          환불 기록이 있는 결제는 금액 정정과 재수납을 할 수 없어요
        </p>
      )}
    </Modal>
  );
}

function CorrectionForm({ tx, data, runAction, onClose, onSaved }) {
  const methodLabelId = `${useId()}-method`;
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
  const staffName = (id) =>
    data.staff.find((s) => s.id === id)?.name || "기존 담당자";
  const methodName = (key) => methodNames[key] || key;
  const changes = [
    form.staffId !== tx.staffId && [
      "담당 직원",
      staffName(tx.staffId),
      staffName(form.staffId),
    ],
    form.method !== tx.method && [
      "결제 수단",
      methodName(tx.method),
      methodName(form.method),
    ],
    form.reference !== (tx.reference || "") && [
      "승인번호",
      tx.reference || "없음",
      form.reference || "없음",
    ],
  ].filter(Boolean);
  return (
    <Modal
      title="수납 정보 정정"
      subtitle={`${tx.customerName ? `${tx.customerName} 님` : "방문 고객"} ${shortDate(tx.date)} 결제`}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={requestModalClose}
          >
            취소
          </Button>
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
      <form id="payment-correct" onSubmit={submit} className="paym-form">
        <fieldset disabled={busy} className="paym-fieldset">
          <div className="paym-info">
            <Icon name="info" size={20} />
            <span>
              <strong>잘못 넣은 담당자, 결제 수단, 승인번호를 바로잡아요</strong>
              <span>결제액과 재고 사용량은 그대로 남아요.</span>
              <span>
                금액을 바꾸려면 수납 상세의 ‘금액 정정과 재수납’을 써 주세요.
              </span>
            </span>
          </div>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <Field label="담당 직원" className="paym-half">
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
          <div className="paym-group">
            <span id={methodLabelId} className="field-label">
              결제 수단
            </span>
            <ChipRadios
              bordered
              labelledBy={methodLabelId}
              options={Object.entries(methodNames)}
              value={form.method}
              onChange={(value) => update("method", value)}
            />
          </div>
          <Field
            label="승인번호"
            help="단말기 영수증에 찍힌 번호예요"
            className="paym-half"
          >
            <input
              className="input num"
              maxLength={100}
              value={form.reference}
              onChange={(e) => update("reference", e.target.value)}
            />
          </Field>
          <Field
            label="정정 사유 (필수)"
            help="정정한 직원과 시각이 함께 기록돼요"
          >
            <textarea
              className="textarea"
              rows={3}
              required
              maxLength={1000}
              value={form.reason}
              onChange={(e) => update("reason", e.target.value)}
              placeholder="예: 단말기 거래내역 확인 후 승인번호 정정"
            />
          </Field>
          <div className="paym-diff" aria-live="polite">
            <span className="field-label">바뀌는 내용</span>
            {changes.length ? (
              changes.map(([label, before, after]) => (
                <span key={label} className="paym-diff-row">
                  {label}
                  <s>{before}</s>
                  <Icon name="arrow-right" size={16} />
                  <strong>{after}</strong>
                </span>
              ))
            ) : (
              <span className="muted">아직 바꾼 내용이 없어요</span>
            )}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}


const refundMethodNames = { ...methodNames, card: "카드 취소" };

function RefundForm({ tx, data, runAction, onClose, onSaved }) {
  const previous = refundedLines(data, tx.id);
  const uid = useId();
  const methodLabelId = `${uid}-method`;
  const info = (line) => {
    const remaining = roundQty(
      line.quantity - (previous[line.id]?.quantity || 0),
    );
    const remainingAmount = Math.max(
      0,
      line.total - (previous[line.id]?.amount || 0),
    );
    const unit =
      line.type === "product"
        ? data.items.find((i) => i.id === line.refId)?.unit
        : null;
    const decimal = line.type === "product" && unit && unit !== "개";
    return {
      remaining,
      remainingAmount,
      decimal,
      unit,
      available: remaining > 0 && (line.total === 0 || remainingAmount > 0),
    };
  };
  const [form, setForm] = useState({
    lines: tx.lines.map((line) => ({
      lineId: line.id,
      on: false,
      mode: "full",
      quantity: "0",
      amount: "0",
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
  const refundQuantity = (line, draft) =>
    draft.mode === "full" ? info(line).remaining : numeric(draft.quantity);
  const lineRefund = (line, draft) =>
    !draft?.on
      ? 0
      : draft.mode === "amount"
        ? numeric(draft.amount)
        : refundEstimate(line, refundQuantity(line, draft), previous[line.id]);
  const total = tx.lines.reduce(
    (sum, line) =>
      sum +
      lineRefund(
        line,
        form.lines.find((l) => l.lineId === line.id),
      ),
    0,
  );
  const chosen = tx.lines
    .map((line) => ({
      line,
      draft: form.lines.find((l) => l.lineId === line.id),
    }))
    .filter(
      ({ line, draft }) =>
        draft?.on &&
        (draft.mode === "amount"
          ? numeric(draft.amount)
          : refundQuantity(line, draft)) > 0,
    );
  const full = () =>
    update(
      "lines",
      form.lines.map((draft) => {
        const line = tx.lines.find((l) => l.id === draft.lineId);
        return info(line).available
          ? { ...draft, on: true, mode: "full" }
          : draft;
      }),
    );
  const setLine = (lineId, changes) =>
    update(
      "lines",
      form.lines.map((line) =>
        line.lineId === lineId ? { ...line, ...changes } : line,
      ),
    );
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const lines = chosen.map(({ line, draft }) =>
      draft.mode === "amount"
        ? { lineId: line.id, amount: Number(draft.amount) }
        : {
            lineId: line.id,
            quantity: refundQuantity(line, draft),
            restock: line.type === "product" ? draft.restock : false,
          },
    );
    if (!lines.length) return setError("환불할 항목을 골라 주세요.");
    if (!confirmed) return setError("실제 환불 완료 여부를 확인해 주세요.");
    setBusy(true);
    setError("");
    try {
      await runAction("payment.refund", {
        transactionId: tx.id,
        method: form.method,
        reference: form.reference,
        reason: form.reason,
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
      title="환불"
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      size="wide"
      footer={
        <>
          <div className="paym-refund-sum">
            <span className="small muted">환불 금액</span>
            <strong>{money(total)}</strong>
          </div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={requestModalClose}
          >
            취소
          </Button>
          <Button
            variant="danger"
            type="submit"
            form="payment-refund"
            busy={busy}
            disabled={!confirmed || !chosen.length}
          >
            환불 {money(total)} 기록
          </Button>
        </>
      }
    >
      <form id="payment-refund" onSubmit={submit} className="paym-refund">
        <fieldset disabled={busy} className="paym-fieldset">
          <p className="paym-refund-sub">
            {tx.customerName ? `${tx.customerName} 님` : "방문 고객"}{" "}
            {shortDate(tx.date)} 결제
          </p>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="paym-refund-head">
            <span className="field-label">환불할 항목</span>
            <button type="button" className="text-btn" onClick={full}>
              남은 수량 전체
            </button>
          </div>
          <div className="paym-refund-lines">
            {tx.lines.map((line) => {
              const { remaining, remainingAmount, decimal, unit, available } =
                info(line);
              const draft = form.lines.find((l) => l.lineId === line.id);
              const partly = previous[line.id]?.quantity > 0 ||
                previous[line.id]?.amount > 0;
              const modes = [
                ["full", "전체 환불"],
                ...(remaining > 1 || decimal ? [["quantity", "수량 지정"]] : []),
                ...(line.type === "service"
                  ? [["amount", "금액 직접 입력"]]
                  : []),
              ];
              return (
                <div
                  key={line.id}
                  className={`commerce-refund-line paym-refund-line ${draft.on ? "is-on" : ""}`}
                >
                  <div className="paym-refund-top">
                    <input
                      type="checkbox"
                      aria-label={`${line.name} 환불`}
                      checked={draft.on}
                      disabled={!available}
                      onChange={(e) =>
                        setLine(line.id, {
                          on: e.target.checked,
                          mode: "full",
                          quantity: e.target.checked ? String(remaining) : "0",
                          amount: "0",
                          restock: false,
                        })
                      }
                    />
                    <span className="paym-refund-name">
                      <strong>{line.name}</strong>
                      <small>
                        {money(line.total)} 결제
                        {line.quantity !== 1 &&
                          ` ${quantity(line.quantity)}${line.type === "service" ? "회" : unit || "개"}`}
                      </small>
                      {partly && available && (
                        <small>
                          남은 수량 {quantity(remaining)} 남은 금액{" "}
                          {money(remainingAmount)}
                        </small>
                      )}
                    </span>
                    {available ? (
                      <strong className="paym-refund-amount">
                        {money(lineRefund(line, draft))}
                      </strong>
                    ) : (
                      <Badge tone="muted">환불 완료</Badge>
                    )}
                  </div>
                  {available && draft.on && (
                    <div className="paym-refund-body">
                      {modes.length > 1 && (
                        <ChipRadios
                          label={`${line.name} 환불 기준`}
                          options={modes}
                          value={draft.mode}
                          onChange={(mode) =>
                            setLine(line.id, {
                              mode,
                              quantity:
                                mode === "quantity" &&
                                numeric(draft.quantity) <= 0
                                  ? String(remaining)
                                  : draft.quantity,
                            })
                          }
                        />
                      )}
                      {draft.mode === "amount" && (
                        <Field
                          label={`${line.name} 이번 환불 금액 (원)`}
                          help={`최대 ${money(remainingAmount)}`}
                        >
                          <input
                            className="input"
                            type="number"
                            min="0"
                            max={remainingAmount}
                            step="1"
                            value={draft.amount}
                            required
                            onChange={(e) =>
                              setLine(line.id, { amount: e.target.value })
                            }
                          />
                        </Field>
                      )}
                      {draft.mode === "quantity" && (
                        <Field
                          label="이번 환불 수량"
                          help={`최대 ${quantity(remaining)}`}
                        >
                          <input
                            className="input"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={remaining}
                            step={decimal ? ".001" : "1"}
                            required
                            value={draft.quantity}
                            onChange={(e) =>
                              setLine(line.id, { quantity: e.target.value })
                            }
                          />
                        </Field>
                      )}
                      {line.type === "product" && draft.mode !== "amount" && (
                        <label className="paym-confirm">
                          <input
                            type="checkbox"
                            checked={draft.restock}
                            disabled={refundQuantity(line, draft) <= 0}
                            onChange={(e) =>
                              setLine(line.id, { restock: e.target.checked })
                            }
                          />
                          <span>실제로 회수한 상품을 재고에 다시 넣어요</span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="paym-group">
            <span id={methodLabelId} className="paym-group-title">
              돌려준 방법
            </span>
            <ChipRadios
              bordered
              labelledBy={methodLabelId}
              options={Object.entries(refundMethodNames)}
              value={form.method}
              onChange={(value) => update("method", value)}
            />
          </div>
          <div className="paym-refund-grid">
            <Field label="취소 승인번호">
              <input
                className="input"
                maxLength={100}
                value={form.reference}
                placeholder="단말기 취소 영수증의 번호"
                onChange={(e) => update("reference", e.target.value)}
              />
            </Field>
            <Field label="사유">
              <input
                className="input"
                required
                maxLength={1000}
                value={form.reason}
                placeholder="예: 미사용 상품 반품"
                onChange={(e) => update("reason", e.target.value)}
              />
            </Field>
          </div>
          <ul className="paym-hints">
            <li>환불은 오늘 매출 정산에 반영돼요.</li>
            <li>이미 쓴 시술 재료는 재고로 돌아가지 않아요.</li>
            <li>할인액은 항목별로 나눠 계산하고, 저장할 때 다시 확인해요.</li>
          </ul>
          <label className="paym-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setDirty(true);
              }}
            />
            <span>
              고객에게 {money(total)} 환불을 완료했고 수량과 회수한 상품을
              확인했어요
            </span>
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}

function RepriceForm({ tx, runAction, onClose, onSaved }) {
  const methodLabelId = `${useId()}-method`;
  const [prices, setPrices] = useState(
    tx.lines.map((l) => String(l.unitPrice)),
  );
  const [discount, setDiscount] = useState(String(tx.discount));
  const [method, setMethod] = useState(tx.method),
    [reference, setReference] = useState(""),
    [refundReference, setRefundReference] = useState(""),
    [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const total =
    tx.lines.reduce(
      (s, l, i) => s + Math.round(l.quantity * Number(prices[i] || 0)),
      0,
    ) - Number(discount || 0);
  const delta = total - tx.total;
  async function submit(e) {
    e.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      await runAction("payment.reprice", {
        id: tx.id,
        lines: tx.lines.map((l, i) => ({
          lineId: l.id,
          unitPrice: Number(prices[i]),
        })),
        discount: Number(discount),
        method,
        reference,
        refundReference,
        reason,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="금액 정정과 재수납"
      subtitle={`${tx.customerName ? `${tx.customerName} 님` : "방문 고객"} ${shortDate(tx.date)} 결제`}
      size="wide"
      dirty={dirty}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={requestModalClose}
          >
            취소
          </Button>
          <Button
            type="submit"
            form="payment-reprice"
            busy={busy}
            disabled={!confirmed}
            variant="primary"
          >
            정정 기록 저장
          </Button>
        </>
      }
    >
      <form
        id="payment-reprice"
        className="paym-form"
        onSubmit={submit}
        onChange={() => {
          setDirty(true);
          setConfirmed(false);
        }}
      >
        <fieldset className="paym-fieldset" disabled={busy}>
          <div className="paym-info">
            <Icon name="info" size={20} />
            <span>
              <strong>같은 시술과 상품의 단가와 할인액만 바꿔요</strong>
              <span>
                단말기에서 기존 결제 {money(tx.total)}을 취소하고 새 금액으로
                결제한 뒤 기록해 주세요.
              </span>
              <span>재료와 상품 재고는 다시 빼지 않아요.</span>
            </span>
          </div>
          {error && (
            <p role="alert" className="alert alert-danger">
              {error}
            </p>
          )}
          <section
            className="paym-reprice-lines"
            aria-labelledby="paym-reprice-title"
          >
            <h3 id="paym-reprice-title">항목별 정정 단가</h3>
            {tx.lines.map((l, i) => (
              <div key={l.id} className="paym-reprice-line">
                <span className="paym-reprice-name">
                  <strong>{l.name}</strong>
                  <small>기존 단가 {money(l.unitPrice)}</small>
                  <small>수량 {quantity(l.quantity)}</small>
                </span>
                <span className="paym-suffix">
                  <input
                    aria-label={`${l.name} 정정 단가 (원)`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    required
                    value={prices[i]}
                    onChange={(e) =>
                      setPrices((p) =>
                        p.map((v, j) => (i === j ? e.target.value : v)),
                      )
                    }
                  />
                  <span aria-hidden="true">원</span>
                </span>
              </div>
            ))}
          </section>
          <div className="paym-grid-2">
            <Field label="정정 할인액" help={`기존 할인 ${money(tx.discount)}`}>
              <span className="paym-suffix">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  required
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
                <span aria-hidden="true">원</span>
              </span>
            </Field>
            <div className="paym-group paym-group-tight">
              <span id={methodLabelId} className="field-label">
                새 결제 수단
              </span>
              <ChipRadios
                bordered
                labelledBy={methodLabelId}
                options={Object.entries(methodNames)}
                value={method}
                onChange={(value) => {
                  setMethod(value);
                  setDirty(true);
                  setConfirmed(false);
                }}
              />
            </div>
          </div>
          <div className="paym-grid-2">
            <Field label="기존 결제 취소 번호">
              <input
                className="input num"
                maxLength={120}
                value={refundReference}
                onChange={(e) => setRefundReference(e.target.value)}
              />
            </Field>
            <Field label="새 결제 승인번호">
              <input
                className="input num"
                maxLength={120}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </div>
          <Field label="금액 정정 사유 (필수)">
            <textarea
              className="textarea"
              rows={2}
              required
              maxLength={1000}
              value={reason}
              placeholder="예: 학생 요금을 적용하지 않고 결제함"
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <div className="paym-compare" aria-live="polite">
            <span className="paym-compare-side">
              <span className="field-label">기존 결제액</span>
              <span className="paym-compare-before">{money(tx.total)}</span>
            </span>
            <Icon name="arrow-right" size={20} />
            <span className="paym-compare-side is-after">
              <span className="field-label">새 결제액</span>
              <strong className={total < 0 ? "is-refund" : undefined}>
                {money(total)}
              </strong>
              <small
                className={
                  delta < 0 ? "is-down" : delta > 0 ? "is-up" : undefined
                }
              >
                {delta < 0
                  ? `${money(-delta)} 줄어요`
                  : delta > 0
                    ? `${money(delta)} 늘어요`
                    : "금액이 같아요"}
              </small>
            </span>
          </div>
          <label className="paym-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => {
                e.stopPropagation();
                setConfirmed(e.target.checked);
              }}
            />
            <span>기존 결제 취소와 새 금액 결제를 단말기에서 마쳤어요</span>
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}
