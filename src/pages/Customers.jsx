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
  dateLabel,
  serviceNames,
  staffName,
  timeLabel,
  todaySeoul,
} from "./operations-utils.js";
import "./Operations.css";
import { Icon } from "../components/Icon.jsx";
import { useViewState } from "../components/ViewState.jsx";

const blankCustomer = { name: "", phone: "", memo: "", warning: "" };
const digits = (value) => String(value || "").replace(/\D/g, "");

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
    draft.phone &&
    customers.find(
      (item) =>
        item.id !== draft.id && digits(item.phone) === digits(draft.phone),
    );
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
        cause.message || "고객 정보를 저장하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={customer ? "고객 정보 수정" : "새 고객 등록"}
      onClose={busy ? undefined : onClose}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial.current)}
      footer={
        <>
          <Button
            variant="primary"
            type="submit"
            form="customer-editor"
            busy={busy}
          >
            {forAppointment ? "고객 등록 후 예약 계속" : "고객 정보 저장"}
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
          <Field label="고객 이름 *">
            <input
              className="input"
              autoFocus
              value={draft.name}
              onChange={(event) => change("name", event.target.value)}
              maxLength={80}
              required
              autoComplete="name"
            />
          </Field>
          <Field label="연락처" help="예약 확인 및 동명이인 구분에 사용합니다.">
            <input
              className="input"
              type="tel"
              value={draft.phone}
              onChange={(event) => change("phone", event.target.value)}
              maxLength={30}
              placeholder="010-0000-0000"
              autoComplete="tel"
            />
          </Field>
        </div>
        {duplicate && (
          <div className="alert alert-warning">
            같은 연락처로 등록된 고객이 있습니다:{" "}
            <strong>{duplicate.name}</strong>
            {duplicate.archived ? " (보관된 고객)" : ""}. 기존 고객 차트를
            사용하거나 연락처를 확인해 주세요.
            {onUseExisting && !duplicate.archived && (
              <div className="row" style={{ marginTop: 8 }}>
                <Button onClick={() => onUseExisting(duplicate.id)}>
                  기존 고객 선택 · {duplicate.name}
                </Button>
              </div>
            )}
          </div>
        )}
        <Field
          label="시술 시 주의사항"
          help="알레르기, 두피 상태 등 시술 전에 확인해야 할 내용을 간결하게 적어 주세요. 예약과 수납 화면에도 표시됩니다."
        >
          <textarea
            className="textarea"
            rows={3}
            maxLength={1000}
            value={draft.warning}
            onChange={(event) => change("warning", event.target.value)}
            placeholder="예: 특정 염모제 사용 시 두피 자극 — 시술 전 확인"
          />
        </Field>
        <Field
          label="상담 및 고객 메모"
          help="선호하는 스타일, 방문 목적, 상담 내용을 기록합니다."
        >
          <textarea
            className="textarea"
            rows={5}
            maxLength={4000}
            value={draft.memo}
            onChange={(event) => change("memo", event.target.value)}
            placeholder="예: 옆머리는 짧게, 앞머리는 눈썹 위 길이 선호"
          />
        </Field>
        <p className="help">
          {forAppointment &&
            "고객 정보는 지금 저장되고, 입력 중인 예약은 다음 화면에서 저장합니다. "}
          고객에게 안내하고 동의받은 범위에서 필요한 정보만 기록해 주세요.
          주민등록번호·카드번호·비밀번호는 기록하지 않습니다.
        </p>
      </form>
    </Modal>
  );
}

function CustomerChart({
  customer,
  data,
  user,
  onClose,
  onEdit,
  onArchive,
  navigate,
}) {
  const [tab, setTab] = useState("profile");
  const visits = useMemo(
    () =>
      data.appointments
        .filter((item) => item.customerId === customer.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.start - a.start),
    [data.appointments, customer.id],
  );
  const payments = useMemo(
    () =>
      data.transactions
        .filter((item) => item.customerId === customer.id)
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            String(b.time).localeCompare(String(a.time)),
        ),
    [data.transactions, customer.id],
  );
  const txIds = new Set(payments.map((item) => item.id));
  const refunds = data.refunds.filter((item) => txIds.has(item.transactionId));
  const total =
    payments.reduce((sum, item) => sum + item.total, 0) -
    refunds.reduce((sum, item) => sum + item.amount, 0);
  const canArchive = user.role !== "designer";
  return (
    <Modal
      title="고객 차트"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            고객 정보 수정
          </Button>
          {!customer.archived && (
            <>
              {user.role !== "designer" && (
                <Button
                  onClick={() =>
                    navigate("payments", { customerId: customer.id })
                  }
                >
                  예약 없이 수납
                </Button>
              )}
              <Button
                onClick={() =>
                  navigate("appointments", { customerId: customer.id })
                }
              >
                예약 등록
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="ops-form">
        <div className="ops-chart-header">
          <div className="ops-customer-avatar" aria-hidden="true">
            {customer.name.slice(0, 1)}
          </div>
          <div>
            <h2>
              {customer.name}{" "}
              {customer.archived && <Badge tone="muted">보관됨</Badge>}
            </h2>
            <span className="muted">{customer.phone || "연락처 미등록"}</span>
          </div>
        </div>
        {customer.warning && (
          <div className="ops-warning">
            <strong>시술 전 확인</strong>
            <br />
            {customer.warning}
          </div>
        )}
        <div className="stat-grid">
          <div className="stat-card">
            <span className="muted">완료된 방문</span>
            <strong>
              {visits.filter((item) => item.status === "completed").length}회
            </strong>
          </div>
          <div className="stat-card">
            <span className="muted">누적 결제 · 환불 반영</span>
            <strong>
              <Money value={total} />
            </strong>
          </div>
          <div className="stat-card">
            <span className="muted">고객 등록일</span>
            <strong>
              {customer.createdAt
                ? String(customer.createdAt).slice(0, 10)
                : "기록 없음"}
            </strong>
          </div>
        </div>
        {user.role === "designer" && (
          <p className="help">
            예약·결제 이력과 누적 금액은 본인이 담당한 기록을 기준으로
            표시됩니다.
          </p>
        )}
        <div
          className="ops-chart-tabs tabs"
          role="tablist"
          aria-label="고객 차트 보기"
        >
          {[
            ["profile", "고객 메모"],
            ["visits", `예약·방문 ${visits.length}`],
            ["payments", `수납·환불 ${payments.length}`],
          ].map(([id, label]) => (
            <Button
              key={id}
              role="tab"
              aria-selected={tab === id}
              variant="ghost"
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        {tab === "profile" && (
          <div className="stack">
            <div className="card card-body">
              <h3>상담 및 고객 메모</h3>
              <p className="ops-chart-notes">
                {customer.memo ||
                  "등록된 메모가 없습니다. 고객 정보 수정에서 상담 내용을 남길 수 있습니다."}
              </p>
            </div>
            {canArchive && (
              <div className="row">
                <span className="help">
                  {customer.archived
                    ? "보관된 고객은 신규 예약 검색에서 숨겨집니다. 기존 이력은 유지됩니다."
                    : "더 이상 방문하지 않는 고객은 보관할 수 있습니다. 기존 방문·결제 기록은 유지됩니다."}
                </span>
                <Button variant="ghost" onClick={onArchive}>
                  {customer.archived ? "고객 다시 활성화" : "고객 보관"}
                </Button>
              </div>
            )}
          </div>
        )}
        {tab === "visits" && (
          <div className="ops-chart-records">
            {visits.length ? (
              visits.map((item) => (
                <article key={item.id} className="ops-chart-record">
                  <div className="row">
                    <strong>
                      {item.date} {timeLabel(item.start)}
                    </strong>
                    <Badge tone={STATUS[item.status]?.tone}>
                      {STATUS[item.status]?.label || item.status}
                    </Badge>
                  </div>
                  <p>
                    {serviceNames(item.serviceIds, data)} ·{" "}
                    {staffName(item.staffId, data)} · {item.duration}분
                  </p>
                  {item.notes && <p>{item.notes}</p>}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      navigate("appointments", { appointmentId: item.id })
                    }
                  >
                    예약 상세 보기
                  </Button>
                </article>
              ))
            ) : (
              <EmptyState
                title="예약 이력이 없습니다"
                description="새 예약을 등록하면 이곳에 방문 이력이 쌓입니다."
              />
            )}
          </div>
        )}
        {tab === "payments" && (
          <div className="ops-chart-records">
            {payments.length ? (
              payments.map((item) => {
                const ownRefunds = refunds.filter(
                  (refund) => refund.transactionId === item.id,
                );
                return (
                  <article key={item.id} className="ops-chart-record">
                    <div className="row">
                      <strong>
                        {item.date} · <Money value={item.total} />
                      </strong>
                      <Badge
                        tone={item.status === "paid" ? "success" : "warning"}
                      >
                        {item.status === "refunded"
                          ? "전액 환불"
                          : item.status === "partially_refunded"
                            ? "부분 환불"
                            : "수납 완료"}
                      </Badge>
                    </div>
                    <p>
                      {item.lines
                        .map(
                          (line) =>
                            `${line.name}${line.quantity > 1 ? ` × ${line.quantity}` : ""}`,
                        )
                        .join(" · ")}
                      <br />
                      {staffName(item.staffId, data)} ·{" "}
                      {{ card: "카드", cash: "현금", transfer: "계좌이체" }[
                        item.method
                      ] || item.method}
                    </p>
                    {ownRefunds.map((refund) => (
                      <p key={refund.id} className="muted">
                        {refund.date} 환불 <Money value={refund.amount} /> ·{" "}
                        {refund.reason}
                      </p>
                    ))}
                    {user.role !== "designer" && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          navigate("payments", { transactionId: item.id })
                        }
                      >
                        수납 내역 보기
                      </Button>
                    )}
                  </article>
                );
              })
            ) : (
              <EmptyState
                title="수납 이력이 없습니다"
                description="완료된 결제와 환불 내역을 여기에서 확인할 수 있습니다."
              />
            )}
          </div>
        )}
      </div>
    </Modal>
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
  const [archiveFilter, setArchiveFilter] = useViewState(
    "customers",
    "archiveFilter",
    "active",
  );
  const [sort, setSort] = useViewState("customers", "sort", "name");
  const [page, setPage] = useViewState("customers", "page", 1);
  const [selectedId, setSelectedId] = useState(null);
  const [editor, setEditor] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const routeHandled = useRef("");
  useEffect(() => {
    const key = JSON.stringify(routeContext);
    if (key === routeHandled.current) return;
    routeHandled.current = key;
    if (routeContext.customerId) setSelectedId(routeContext.customerId);
    else if (routeContext.create) setEditor({});
  }, [routeContext]);
  const filterKey = JSON.stringify([query, archiveFilter, sort]);
  const previousFilters = useRef(filterKey);
  useEffect(() => {
    if (filterKey !== previousFilters.current) setPage(1);
    previousFilters.current = filterKey;
  }, [filterKey, setPage]);
  const stats = useMemo(() => {
    const result = new Map(
      data.customers.map((item) => [
        item.id,
        { visits: 0, last: null, next: null },
      ]),
    );
    const today = todaySeoul();
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
    return result;
  }, [data.customers, data.appointments]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return data.customers
      .filter(
        (item) =>
          (archiveFilter === "all" ||
            Boolean(item.archived) === (archiveFilter === "archived")) &&
          (!search ||
            item.name.toLocaleLowerCase().includes(search) ||
            String(item.phone).includes(search) ||
            (digits(search).length > 0 &&
              /^[\d\s+()-]+$/.test(search) &&
              digits(item.phone).includes(digits(search)))),
      )
      .sort((a, b) =>
        sort === "recent"
          ? String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
          : sort === "visits"
            ? stats.get(b.id).visits - stats.get(a.id).visits ||
              a.name.localeCompare(b.name, "ko")
            : a.name.localeCompare(b.name, "ko"),
      );
  }, [data.customers, query, archiveFilter, sort, stats]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 24));
  const currentPage = Math.min(page, pageCount);
  const selected = data.customers.find((item) => item.id === selectedId);
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
          ? "고객을 다시 활성화했습니다."
          : "고객을 보관했습니다.",
        "success",
      );
      setArchiveTarget(null);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ops-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">고객 관리</h1>
          <p className="page-description">
            연락처, 상담 메모와 예약·방문 내역을 확인합니다.
          </p>
        </div>
        <div className="page-actions">
          <Button
            variant="primary"
            onClick={() => setEditor({})}
            aria-label="+ 고객 등록"
          >
            <Icon name="plus" size={16} /> 고객 등록
          </Button>
        </div>
      </header>
      <div className="stat-grid">
        <div className="stat-card">
          <span className="muted">활성 고객</span>
          <strong>
            {data.customers.filter((item) => !item.archived).length}명
          </strong>
        </div>
        <div className="stat-card">
          <span className="muted">주의사항 등록</span>
          <strong>
            {
              data.customers.filter((item) => !item.archived && item.warning)
                .length
            }
            명
          </strong>
        </div>
        <div className="stat-card">
          <span className="muted">보관된 고객</span>
          <strong>
            {data.customers.filter((item) => item.archived).length}명
          </strong>
        </div>
      </div>
      <div className="card card-body ops-filters">
        <Field label="고객 검색" className="ops-search">
          <input
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="고객 이름 또는 연락처"
          />
        </Field>
        <Field label="고객 상태">
          <select
            className="select"
            value={archiveFilter}
            onChange={(event) => setArchiveFilter(event.target.value)}
          >
            <option value="active">활성 고객</option>
            <option value="archived">보관된 고객</option>
            <option value="all">전체 고객</option>
          </select>
        </Field>
        <Field label="정렬">
          <select
            className="select"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="name">이름순</option>
            <option value="recent">최근 등록순</option>
            <option value="visits">방문 많은 순</option>
          </select>
        </Field>
      </div>
      <p className="help" style={{ margin: 0 }}>
        검색 결과 {filtered.length}명
        {user.role === "designer"
          ? " · 방문 횟수는 본인 담당 예약 기준입니다."
          : ""}
      </p>
      {filtered.length ? (
        <div className="ops-customer-list">
          {filtered
            .slice((currentPage - 1) * 24, currentPage * 24)
            .map((customer) => {
              const summary = stats.get(customer.id);
              return (
                <article key={customer.id} className="card ops-customer-card">
                  <div className="ops-customer-title">
                    <div className="row">
                      <div className="ops-customer-avatar" aria-hidden="true">
                        {customer.name.slice(0, 1)}
                      </div>
                      <div>
                        <h2>{customer.name}</h2>
                        <span className="help">
                          {customer.phone || "연락처 미등록"}
                        </span>
                      </div>
                    </div>
                    {customer.archived && <Badge tone="muted">보관</Badge>}
                  </div>
                  <div className="ops-customer-summary">
                    <div className="muted">
                      완료된 방문<strong>{summary.visits}회</strong>
                    </div>
                    <div className="muted">
                      최근 방문
                      <strong>{summary.last || "방문 기록 없음"}</strong>
                    </div>
                  </div>
                  <div className="ops-customer-note">
                    {customer.warning ? (
                      <p className="ops-customer-caution">
                        <strong>주의</strong>{" "}
                        {customer.warning.length > 90
                          ? `${customer.warning.slice(0, 90)}…`
                          : customer.warning}
                      </p>
                    ) : (
                      <span className="help">등록된 주의사항 없음</span>
                    )}
                    {summary.next && (
                      <span className="help">
                        다음 예약 · {dateLabel(summary.next)}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setSelectedId(customer.id)}
                    aria-label={`${customer.name} 고객 차트 보기`}
                  >
                    고객 차트 보기
                  </Button>
                </article>
              );
            })}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            title={
              query
                ? "검색한 고객이 없습니다"
                : archiveFilter === "archived"
                  ? "보관된 고객이 없습니다"
                  : "첫 고객을 등록해 보세요"
            }
            description={
              query
                ? "이름이나 전화번호 일부로 다시 검색해 주세요."
                : "고객 정보, 상담 메모, 예약과 수납 내역을 한곳에서 관리합니다."
            }
            action={
              archiveFilter !== "archived" ? (
                <Button onClick={() => setEditor({})}>고객 등록</Button>
              ) : undefined
            }
          />
        </div>
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
          <span>
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
      {selected && !editor && !archiveTarget && (
        <CustomerChart
          customer={selected}
          data={data}
          user={user}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditor(selected)}
          onArchive={() => {
            setError("");
            setArchiveTarget(selected);
          }}
          navigate={navigate}
        />
      )}
      {editor && (
        <CustomerEditor
          customer={editor.id ? editor : null}
          customers={data.customers}
          runAction={runAction}
          onClose={() => setEditor(null)}
          onUseExisting={(id) => {
            setEditor(null);
            setSelectedId(id);
          }}
          onSaved={(id) => {
            setEditor(null);
            if (id) setSelectedId(id);
            notify?.("고객 정보를 저장했습니다.", "success");
          }}
        />
      )}
      {archiveTarget && (
        <ConfirmDialog
          title={
            archiveTarget.archived
              ? "고객을 다시 활성화할까요?"
              : "고객을 보관할까요?"
          }
          onClose={() => !busy && setArchiveTarget(null)}
          onConfirm={archiveCustomer}
          busy={busy}
          confirmLabel={archiveTarget.archived ? "다시 활성화" : "보관하기"}
        >
          <p>
            <strong>{archiveTarget.name}</strong> 고객의 기존 예약·결제·상담
            기록은 유지됩니다.
            {!archiveTarget.archived &&
              " 보관한 고객은 새 예약의 고객 검색에서 숨겨집니다."}
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
