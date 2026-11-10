import { useMediaQuery } from "../useMediaQuery";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  Money,
} from "../components/ui.jsx";
import {
  STATUS,
  serviceNames,
  shiftDate,
  shortDateLabel,
  staffName,
  timeLabel,
  todaySeoul,
} from "./operations-utils.js";
import "./Operations.css";
import { Icon } from "../components/Icon.jsx";
import { useViewState } from "../components/ViewState.jsx";

const blankCustomer = { name: "", phone: "", memo: "", warning: "" };
const digits = (value) => String(value || "").replace(/\D/g, "");
const PAGE_SIZE = 24;
const LIST_MODES = [
  ["recent", "최근 방문"],
  ["name", "이름순"],
  ["visits", "방문순"],
  ["archived", "보관"],
];
// Closes a dialog through its own close button so the unsaved-changes guard still runs.
const closeDialog = (event) =>
  event.currentTarget
    .closest(".modal")
    ?.querySelector('.modal-header button[aria-label="닫기"]')
    ?.click();
const dayWithYear = (date, today) =>
  date.slice(0, 4) === today.slice(0, 4)
    ? shortDateLabel(date)
    : `${date.slice(0, 4)}년 ${shortDateLabel(date)}`;
const lastVisitLabel = (date, today) =>
  !date
    ? "방문 기록 없음"
    : date === today
      ? "오늘 방문"
      : date === shiftDate(today, -1)
        ? "어제 방문"
        : dayWithYear(date, today);

export function CustomerEditor({
  customer,
  customers,
  runAction,
  onClose,
  onSaved,
  initialValues,
  onUseExisting,
  forAppointment = false,
}) {
  const initial = useRef(
    customer
      ? {
          id: customer.id,
          name: customer.name,
          phone: customer.phone || "",
          memo: customer.memo || "",
          warning: customer.warning || "",
        }
      : { ...blankCustomer, ...initialValues },
  );
  const [draft, setDraft] = useState(initial.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const change = (key, value) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const duplicate =
    digits(draft.phone) &&
    customers.find(
      (item) =>
        item.id !== draft.id && digits(item.phone) === digits(draft.phone),
    );
  const canUseDuplicate =
    duplicate && onUseExisting && !(forAppointment && duplicate.archived);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await runAction("customer.save", draft);
      const saved = draft.id
        ? result?.data?.customers.find((item) => item.id === draft.id)
        : result?.data?.customers.find(
            (item) =>
              !customers.some((previous) => previous.id === item.id) &&
              item.name === draft.name.trim(),
          );
      onSaved(saved?.id);
    } catch (cause) {
      setError(
        cause.message || "손님 정보를 저장하지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={customer ? "고객 정보 수정" : "고객 등록"}
      onClose={busy ? undefined : onClose}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial.current)}
      footer={
        <>
          <Button variant="secondary" onClick={closeDialog} disabled={busy}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="customer-editor"
            busy={busy}
          >
            {forAppointment ? "저장하고 예약 계속" : "고객 저장"}
          </Button>
        </>
      }
    >
      <form id="customer-editor" className="ops-form" onSubmit={submit}>
        {error && (
          <div className="ops-error" role="alert">
            {error}
          </div>
        )}
        <div className="grid grid-2">
          <Field label="이름">
            <input
              className="input"
              autoFocus
              value={draft.name}
              onChange={(event) => change("name", event.target.value)}
              maxLength={80}
              required
              autoComplete="off"
            />
          </Field>
          <Field label="전화번호">
            <input
              className={`input ${duplicate ? "ops-input-warn" : ""}`}
              type="tel"
              value={draft.phone}
              onChange={(event) => change("phone", event.target.value)}
              maxLength={30}
              placeholder="010-0000-0000"
              autoComplete="off"
            />
          </Field>
        </div>
        {duplicate && (
          <div className="ops-dup" role="status">
            <span className="ops-dup-text">
              <strong>같은 번호의 손님이 있어요</strong>
              <span>
                {duplicate.name} 님{duplicate.archived ? " (보관됨)" : ""}
              </span>
            </span>
            {canUseDuplicate && (
              <button
                type="button"
                className="chip ops-chip-outline"
                onClick={() => onUseExisting(duplicate.id)}
              >
                {forAppointment ? "그 손님으로 예약" : "그 손님 보기"}
              </button>
            )}
          </div>
        )}
        <Field
          label="시술 전 확인할 점"
          help="예약과 수납 화면에 노란 글씨로 보여요"
        >
          <input
            className="input"
            maxLength={1000}
            value={draft.warning}
            onChange={(event) => change("warning", event.target.value)}
            placeholder="예: 두피 민감, 임신 중"
          />
        </Field>
        <Field label="메모" help="주민등록번호나 카드번호는 적지 말아 주세요">
          <textarea
            className="textarea"
            rows={4}
            maxLength={4000}
            value={draft.memo}
            onChange={(event) => change("memo", event.target.value)}
            placeholder="선호 스타일이나 상담 내용"
          />
        </Field>
        {forAppointment && (
          <p className="help">
            손님 정보는 지금 저장되고, 예약은 다음 화면에서 저장해요
          </p>
        )}
      </form>
    </Modal>
  );
}

function CustomerDetail({
  customer,
  data,
  user,
  summary,
  onEdit,
  onArchive,
  navigate,
  compact = false,
}) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [customer.id]);
  const today = todaySeoul();
  const visits = useMemo(
    () => data.appointments.filter((item) => item.customerId === customer.id),
    [data.appointments, customer.id],
  );
  const payments = useMemo(
    () => data.transactions.filter((item) => item.customerId === customer.id),
    [data.transactions, customer.id],
  );
  const txIds = new Set(payments.map((item) => item.id));
  const refunds = data.refunds.filter((item) => txIds.has(item.transactionId));
  const refundedFor = (id) =>
    refunds
      .filter((item) => item.transactionId === id)
      .reduce((sum, item) => sum + item.amount, 0);
  const total =
    payments.reduce((sum, item) => sum + item.total, 0) -
    refunds.reduce((sum, item) => sum + item.amount, 0);
  const records = useMemo(() => {
    const linked = new Set();
    const rows = visits.map((item) => {
      const tx =
        payments.find((row) => row.appointmentId === item.id) ||
        payments.find((row) => row.id === item.transactionId);
      if (tx) linked.add(tx.id);
      return {
        key: `a-${item.id}`,
        date: item.date,
        time: timeLabel(item.start),
        title: serviceNames(item.serviceIds, data),
        staff: staffName(item.staffId, data),
        status: item.status,
        tx,
        appointmentId: item.id,
      };
    });
    for (const tx of payments) {
      if (linked.has(tx.id)) continue;
      rows.push({
        key: `t-${tx.id}`,
        date: tx.date,
        time: String(tx.time || "").slice(0, 5),
        title: tx.lines
          .map(
            (line) =>
              `${line.name}${line.quantity > 1 ? ` ${line.quantity}개` : ""}`,
          )
          .join(", "),
        staff: staffName(tx.staffId, data),
        status: null,
        tx,
      });
    }
    return rows.sort(
      (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time),
    );
  }, [visits, payments, data]);
  const shown = showAll ? records : records.slice(0, 8);
  const canArchive = user.role !== "designer";
  const created = customer.createdAt ? String(customer.createdAt).slice(0, 10) : "";
  const actions = [
    !customer.archived && user.role !== "designer" && (
      <Button
        key="pay"
        variant="secondary"
        onClick={() => navigate("payments", { customerId: customer.id })}
      >
        예약 없이 수납
      </Button>
    ),
    !customer.archived && (
      <Button
        key="book"
        variant="primary"
        onClick={() => navigate("appointments", { customerId: customer.id })}
      >
        예약 등록
      </Button>
    ),
  ].filter(Boolean);
  const info = (
    <>
      <div className="ops-stat-row">
        <div className="inset ops-stat">
          <span className="muted">방문</span>
          <strong className="num">{summary.visits}회</strong>
        </div>
        <div className="inset ops-stat">
          <span className="muted">누적 결제</span>
          <strong className="num">
            <Money value={total} />
          </strong>
        </div>
        <div className="inset ops-stat">
          <span className="muted">다음 예약</span>
          <strong>{summary.next ? dayWithYear(summary.next, today) : "없음"}</strong>
        </div>
      </div>
      {user.role === "designer" && (
        <p className="help">방문과 결제 기록은 내가 담당한 것만 보여요</p>
      )}
      <div className="ops-section">
        <span className="ops-meta-label">메모</span>
        <p className="ops-chart-notes">
          {customer.memo || "남긴 메모가 없어요. 정보 수정에서 적을 수 있어요."}
        </p>
      </div>
    </>
  );
  const archive = canArchive && (
      <div className="ops-archive-row">
        <span className="help">
          {customer.archived
            ? "보관한 손님은 예약할 때 검색되지 않아요. 기록은 그대로 남아 있어요."
            : "더 이상 오지 않는 손님은 보관할 수 있어요. 기록은 그대로 남아요."}
        </span>
        <Button variant="ghost" onClick={onArchive}>
          {customer.archived ? "고객 다시 활성화" : "고객 보관"}
        </Button>
      </div>
  );
  return (
    <>
      <div className="panel ops-detail-card">
        <div className="ops-person-head">
          <span className="ops-avatar ops-avatar-xl" aria-hidden="true">
            {customer.name.slice(0, 1)}
          </span>
          <span className="ops-person-text">
            <h2 id="customer-detail-title" className="ops-person-title">
              {customer.name} 님
              {customer.archived && <Badge tone="muted">보관됨</Badge>}
            </h2>
            {compact && customer.phone ? (
              <a className="muted num ops-tel" href={`tel:${digits(customer.phone)}`}>
                {customer.phone}
              </a>
            ) : (
              <span className="muted">{customer.phone || "전화번호 없음"}</span>
            )}
            {created && (
              <span className="help">{dayWithYear(created, today)} 등록</span>
            )}
          </span>
          {!compact && (
            <span className="ops-inline-actions">
              <Button variant="secondary" onClick={onEdit}>
                정보 수정
              </Button>
              {actions}
            </span>
          )}
        </div>
        {customer.warning && (
          <div className={`ops-warning ${compact ? "ops-warning-note" : ""}`}>
            {compact && <Icon name="alert" size={20} />}
            시술 전 확인: {customer.warning}
          </div>
        )}
        {compact && actions.length > 0 && (
          <div className="ops-m-actions">{actions}</div>
        )}
        {!compact && info}
        {!compact && archive}
      </div>
      {compact && info}
      <div className="panel ops-records">
        <h3 className="ops-panel-title">방문 기록</h3>
        {records.length ? (
          <ul className="ops-record-list">
            {shown.map((row) => {
              const refunded = row.tx ? refundedFor(row.tx.id) : 0;
              const end =
                row.tx && (!row.status || row.status === "completed") ? (
                  <>
                    <strong className="num">
                      <Money value={row.tx.total - refunded} />
                    </strong>
                    {refunded > 0 && (
                      <span className="help tone-warn-text">
                        환불 <Money value={refunded} />
                      </span>
                    )}
                  </>
                ) : (
                  <Badge tone={STATUS[row.status]?.tone}>
                    {STATUS[row.status]?.label || row.status}
                  </Badge>
                );
              const content = compact ? (
                <>
                  <span className="ops-record-main">
                    <strong>{row.title || "기록된 항목 없음"}</strong>
                    <span className="help num">
                      {dayWithYear(row.date, today)}
                      {row.time ? ` ${row.time}` : ""}
                    </span>
                    <span className="help">{row.staff}</span>
                  </span>
                  <span className="ops-record-end">{end}</span>
                </>
              ) : (
                <>
                  <span className="ops-record-date">
                    <span>{dayWithYear(row.date, today)}</span>
                    {row.time && <span className="help num">{row.time}</span>}
                  </span>
                  <span className="ops-record-main">
                    <strong>{row.title || "기록된 항목 없음"}</strong>
                    <span className="help">{row.staff}</span>
                  </span>
                  <span className="ops-record-end">{end}</span>
                </>
              );
              const target = row.appointmentId
                ? () =>
                    navigate("appointments", {
                      appointmentId: row.appointmentId,
                    })
                : user.role !== "designer"
                  ? () => navigate("payments", { transactionId: row.tx.id })
                  : null;
              return (
                <li key={row.key}>
                  {target ? (
                    <button
                      type="button"
                      className={`ops-record ${compact ? "is-compact" : ""}`}
                      onClick={target}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={`ops-record ${compact ? "is-compact" : ""}`}>
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="help">
            아직 방문 기록이 없어요. 예약을 등록하면 여기에 쌓여요.
          </p>
        )}
        {records.length > 8 && (
          <button
            type="button"
            className="text-btn ops-text-btn"
            aria-expanded={showAll}
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? "최근 8건만 보기" : `모두 보기 ${records.length}건`}
          </button>
        )}
      </div>
      {compact && archive && <div className="ops-m-archive">{archive}</div>}
    </>
  );
}

export default function Customers({
  data,
  user,
  runAction,
  notify,
  navigate,
  routeContext = {},
}) {
  const [query, setQuery] = useViewState("customers", "query", "");
  const [listMode, setListMode] = useViewState(
    "customers",
    "listMode",
    "recent",
  );
  const [page, setPage] = useViewState("customers", "page", 1);
  const [selectedId, setSelectedId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const detailRef = useRef(null);
  const phone = useMediaQuery();
  const revealDetail = () => {
    // On a phone the detail replaces the list, so it starts at the top.
    if (window.matchMedia?.("(max-width: 640px)").matches)
      requestAnimationFrame(() => window.scrollTo?.(0, 0));
    else if (window.matchMedia?.("(max-width: 900px)").matches)
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView?.({ block: "start" }),
      );
  };
  const select = (id) => {
    setSelectedId(id);
    revealDetail();
  };
  // Each navigation creates a new context object, so a repeated header search still applies.
  const routeHandled = useRef(null);
  useEffect(() => {
    if (routeContext === routeHandled.current) return;
    routeHandled.current = routeContext;
    if (typeof routeContext.query === "string") {
      setQuery(routeContext.query);
      setSelectedId(null);
    }
    if (routeContext.customerId) select(routeContext.customerId);
    else if (routeContext.create) setEditor({});
  }, [routeContext]);
  const filterKey = JSON.stringify([query, listMode]);
  const previousFilters = useRef(filterKey);
  useEffect(() => {
    if (filterKey !== previousFilters.current) setPage(1);
    previousFilters.current = filterKey;
  }, [filterKey, setPage]);
  const today = todaySeoul();
  const stats = useMemo(() => {
    const result = new Map(
      data.customers.map((item) => [
        item.id,
        { visits: 0, last: null, next: null },
      ]),
    );
    for (const visit of data.appointments) {
      const entry = result.get(visit.customerId);
      if (!entry) continue;
      if (visit.status === "completed") {
        entry.visits++;
        if (!entry.last || visit.date > entry.last) entry.last = visit.date;
      }
      if (
        ["booked", "checked_in", "in_service"].includes(visit.status) &&
        visit.date >= today &&
        (!entry.next || visit.date < entry.next)
      )
        entry.next = visit.date;
    }
    for (const tx of data.transactions || []) {
      const entry = result.get(tx.customerId);
      if (entry && (!entry.last || tx.date > entry.last)) entry.last = tx.date;
    }
    return result;
  }, [data.customers, data.appointments, data.transactions, today]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const archived = listMode === "archived";
    // New customers without a visit sort by their registration date.
    const recency = (item) =>
      stats.get(item.id).last || String(item.createdAt || "").slice(0, 10);
    return data.customers
      .filter(
        (item) =>
          Boolean(item.archived) === archived &&
          (!search ||
            item.name.toLocaleLowerCase().includes(search) ||
            String(item.phone).includes(search) ||
            (digits(search).length > 0 &&
              /^[\d\s+()-]+$/.test(search) &&
              digits(item.phone).includes(digits(search)))),
      )
      .sort((a, b) =>
        listMode === "recent"
          ? recency(b).localeCompare(recency(a)) ||
            String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
          : listMode === "visits"
            ? stats.get(b.id).visits - stats.get(a.id).visits ||
              a.name.localeCompare(b.name, "ko")
            : a.name.localeCompare(b.name, "ko"),
      );
  }, [data.customers, query, listMode, stats]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const chosen = data.customers.find((item) => item.id === selectedId);
  // Phones show the list first and open a customer as its own screen.
  const current = phone ? chosen : chosen || pageRows[0];
  const phoneDetail = phone && Boolean(chosen);
  const activeCount = data.customers.filter((item) => !item.archived).length;
  const archivedCount = data.customers.length - activeCount;
  async function archiveCustomer() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction("customer.archive", {
        id: archiveTarget.id,
        archived: !archiveTarget.archived,
      });
      notify?.(
        archiveTarget.archived
          ? "손님을 다시 활성화했어요"
          : "손님을 보관했어요",
        "success",
      );
      setSelectedId(archiveTarget.id);
      setArchiveTarget(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`ops-page ${phone ? "ops-page-phone" : ""}`}>
      {phoneDetail ? (
        <header className="ops-m-head ops-m-head-back">
          <button
            type="button"
            className="ops-m-back"
            aria-label="고객 목록으로"
            onClick={() => setSelectedId(null)}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <h1>고객 정보</h1>
          <button
            type="button"
            className="ops-m-chipbtn"
            onClick={() => setEditor(current)}
          >
            정보 수정
          </button>
        </header>
      ) : phone ? (
        <header className="ops-m-head">
          <span className="ops-m-title">
            <span className="ops-m-dot" aria-hidden="true" />
            <h1>고객</h1>
            <span className="ops-meta">
              {listMode === "archived"
                ? `보관 ${archivedCount}명`
                : `전체 ${activeCount}명`}
            </span>
          </span>
          <button
            type="button"
            className="ops-m-cta"
            aria-label="+ 고객 등록"
            onClick={() => setEditor({})}
          >
            <Icon name="plus" size={20} />
            고객 등록
          </button>
        </header>
      ) : (
        <header className="page-header ops-page-header">
          <div>
            <p className="page-eyebrow">
              {listMode === "archived"
                ? `보관 ${archivedCount}명`
                : `전체 ${activeCount}명`}
            </p>
            <h1 className="page-title">고객</h1>
          </div>
          <Button
            variant="primary"
            onClick={() => setEditor({})}
            aria-label="+ 고객 등록"
          >
            고객 등록
          </Button>
        </header>
      )}
      <div className="ops-split">
        {!phoneDetail && (
        <section className="panel ops-customer-pane" aria-label="고객 목록">
          <div className="input-icon">
            <Icon name="search" size={20} />
            <input
              type="search"
              aria-label="고객 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름이나 전화번호"
            />
          </div>
          <div className="chip-row" role="group" aria-label="정렬">
            {LIST_MODES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="chip"
                aria-pressed={listMode === value}
                onClick={() => {
                  setListMode(value);
                  setSelectedId(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {user.role === "designer" && (
            <p className="help">방문 횟수는 내가 담당한 예약 기준이에요</p>
          )}
          {filtered.length ? (
            <ul className="ops-customer-list">
              {pageRows.map((customer) => {
                const summary = stats.get(customer.id);
                return (
                  <li key={customer.id}>
                    <button
                      type="button"
                      className="list-row ops-customer-row"
                      aria-current={current?.id === customer.id ? "true" : undefined}
                      onClick={() => select(customer.id)}
                    >
                      <span className="ops-avatar ops-avatar-md" aria-hidden="true">
                        {customer.name.slice(0, 1)}
                      </span>
                      <span className="ops-customer-text">
                        <strong>{customer.name}</strong>
                        <span className="help">
                          {lastVisitLabel(summary.last, today)}
                        </span>
                      </span>
                      <span
                        className={`help ops-customer-note ${customer.warning ? "tone-warn-text" : ""}`}
                      >
                        {customer.warning ? "주의" : `${summary.visits}회`}
                      </span>
                      {phone && (
                        <Icon
                          name="chevron-right"
                          size={20}
                          className="ops-row-chevron"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title={
                query
                  ? "찾는 손님이 없어요"
                  : listMode === "archived"
                    ? "보관한 손님이 없어요"
                    : "첫 손님을 등록해 보세요"
              }
              description={
                query
                  ? "이름이나 전화번호 일부로 다시 찾아 주세요."
                  : listMode === "archived"
                    ? undefined
                    : "연락처와 상담 메모, 예약과 수납 기록을 한곳에서 볼 수 있어요."
              }
              action={
                listMode !== "archived" ? (
                  <Button variant="primary" onClick={() => setEditor({})}>
                    고객 등록
                  </Button>
                ) : undefined
              }
            />
          )}
          {pageCount > 1 && (
            <nav className="ops-pagination" aria-label="고객 목록 페이지">
              <Button
                variant="secondary"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                이전
              </Button>
              <span className="num">
                {currentPage} / {pageCount}
              </span>
              <Button
                variant="secondary"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                다음
              </Button>
            </nav>
          )}
        </section>
        )}
        {current && (!phone || phoneDetail) && (
          <section
            ref={detailRef}
            className={`ops-customer-detail ${phone ? "ops-m-detail" : ""}`}
            aria-labelledby="customer-detail-title"
          >
            <CustomerDetail
              customer={current}
              data={data}
              user={user}
              summary={stats.get(current.id)}
              compact={phone}
              onEdit={() => setEditor(current)}
              onArchive={() => {
                setError("");
                setArchiveTarget(current);
              }}
              navigate={navigate}
            />
          </section>
        )}
      </div>
      {editor && (
        <CustomerEditor
          customer={editor.id ? editor : null}
          customers={data.customers}
          runAction={runAction}
          onClose={() => setEditor(null)}
          onUseExisting={(id) => {
            setEditor(null);
            select(id);
          }}
          onSaved={(id) => {
            setEditor(null);
            if (id) {
              const saved = data.customers.find((item) => item.id === id);
              if (!saved?.archived && listMode === "archived")
                setListMode("recent");
              select(id);
            }
            notify?.("손님 정보를 저장했어요", "success");
          }}
        />
      )}
      {archiveTarget && (
        <ConfirmDialog
          title={
            archiveTarget.archived
              ? "손님을 다시 활성화할까요?"
              : "손님을 보관할까요?"
          }
          onClose={() => !busy && setArchiveTarget(null)}
          onConfirm={archiveCustomer}
          busy={busy}
          confirmLabel={archiveTarget.archived ? "다시 활성화" : "보관하기"}
        >
          <p>
            <strong>{archiveTarget.name}</strong> 님의 예약, 결제, 상담 기록은
            그대로 남아요.
            {!archiveTarget.archived &&
              " 보관한 손님은 새 예약의 손님 검색에서 숨겨져요."}
          </p>
          {error && (
            <div className="ops-error" role="alert">
              {error}
            </div>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
