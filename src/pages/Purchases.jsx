import React, { useEffect, useId, useRef, useState } from "react";
import {
  Button,
  Field,
  Modal,
  Badge,
  Money,
  EmptyState,
  ConfirmDialog,
} from "../components/ui";
import Icon from "../components/Icon";
import { DateInput } from "../components/DateInput";
import { useViewState } from "../components/ViewState";
import { todayInSeoul, quantity, matchesSearch } from "./commerce-utils";
import "../procurement.js";
import { printDocument, escapeHtml, printMoney, storeBlock, logoTag } from "../print";
import "./Commerce.css";
import "./Purchases.css";
import "./PurchasesBoards.css";
const {
  received,
  total,
  status,
  labels,
  cancelled,
  returned,
  pending,
  paidAmount,
  balance,
} = globalThis.SalonProcurement;
const tone = (s) =>
  s === "delivered" ? "success" : s === "cancelled" ? "muted" : "warning";
const itemsLabel = (o) =>
  o.lines.length > 1
    ? `${o.lines[0].itemName} 외 ${o.lines.length - 1}품목`
    : o.lines[0]?.itemName || "품목 없음";
const dateLabel = (date) => {
  const [y, m, d] = String(date || "").split("-").map(Number);
  if (!y || !m || !d) return date || "";
  const thisYear = Number(todayInSeoul().slice(0, 4));
  return `${y === thisYear ? "" : `${y}년 `}${m}월 ${d}일`;
};
const shipChip = (o, receipts) => {
  const s = status(o, receipts);
  if (s === "waiting" && o.lines.some((l) => received(l, receipts) > 0))
    return ["부분 입고", "warning"];
  return [labels[s], s === "delivered" ? "success" : "muted"];
};
const payChip = (o) => {
  if (o.cancelled) return null;
  if (balance(o) < 0) return ["환급 대기", "warning"];
  if (o.paid) return ["지급 완료", "success"];
  if (paidAmount(o) > 0) return ["일부 지급", "warning"];
  return ["미지급", "warning"];
};
const payText = (o) =>
  balance(o) < 0
    ? "거래처 환급 대기"
    : o.paid
      ? "대금 지급 완료"
      : paidAmount(o) > 0
        ? "일부 지급"
        : "대금 미지급";

// Footer "취소" buttons must honour the same unsaved-changes guard as the dialog's close button.
function useCloseGuard(dirty, onClose) {
  const [asking, setAsking] = useState(false);
  const request = () => (dirty ? setAsking(true) : onClose());
  const confirm = asking && (
    <ConfirmDialog
      title="작성 중인 내용을 닫을까요?"
      onClose={() => setAsking(false)}
      onConfirm={onClose}
      confirmLabel="내용 버리고 닫기"
      variant="danger"
    >
      저장하지 않은 변경사항이 사라집니다.
    </ConfirmDialog>
  );
  return [request, confirm];
}

export default function Purchases({
  data,
  user,
  runAction,
  notify,
  navigate,
  routeContext,
}) {
  const canManage = ["owner", "manager"].includes(user.role);
  const [tab, setTab] = useViewState(
    "purchases",
    "tab",
    routeContext?.tab || "orders",
  );
  const [query, setQuery] = useViewState("purchases", "query", "");
  const [delivery, setDelivery] = useViewState("purchases", "delivery", "all");
  const [payment, setPayment] = useViewState("purchases", "payment", "all");
  const [supplierId, setSupplierId] = useViewState("purchases", "supplier", "");
  const [active, setActive] = useViewState("purchases", "active", "active");
  const [from, setFrom] = useViewState("purchases", "from", "");
  const [to, setTo] = useViewState("purchases", "to", "");
  const [selectedId, setSelectedId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [limit, setLimit] = useState(50);
  const suppliers = data.suppliers || [],
    categories = data.itemCategories || [],
    orders = data.purchaseOrders || [],
    receipts = data.receipts || [];
  const changeTab = (value) => {
    setTab(value);
    setQuery("");
    setLimit(50);
  };
  const usedContext = useRef(null);
  useEffect(() => {
    if (!routeContext || routeContext === usedContext.current) return;
    usedContext.current = routeContext;
    if (routeContext.tab) changeTab(routeContext.tab);
  }, [routeContext]);
  const match = (...v) =>
    v.join(" ").toLowerCase().includes(query.toLowerCase());
  const rows = orders
    .slice()
    .reverse()
    .filter(
      (o) =>
        (!supplierId || o.supplierId === supplierId) &&
        (!from || o.date >= from) &&
        (!to || o.date <= to) &&
        (payment === "all" || (payment === "paid" ? o.paid : !o.paid)) &&
        (delivery === "all" || status(o, receipts) === delivery) &&
        match(
          o.supplierName,
          ...o.lines.map((l) => l.itemName),
          o.notes || "",
          o.id,
        ),
    );
  const masters = (tab === "suppliers" ? suppliers : categories).filter(
    (s) =>
      (active === "all" || s.active === (active === "active")) &&
      match(s.name, s.contact || "", s.phone || ""),
  );
  const selected = selectedId ? orders.find((o) => o.id === selectedId) : null;
  const current = dialog?.id ? orders.find((o) => o.id === dialog.id) : null;
  const pendingRequests = (data.purchaseRequests || []).filter(
    (r) => r.status === "requested",
  ).length;
  const openOrders = orders.filter(
    (o) => !["delivered", "cancelled"].includes(status(o, receipts)),
  ).length;
  const orderNo = (o) => orders.indexOf(o) + 1;
  const saved = () => {
    setDialog(null);
    notify("저장했습니다.");
  };
  const tabs = [
    ["orders", "발주 내역"],
    ["requests", "구매 요청"],
    ["summary", "매입 현황"],
    ["suppliers", "거래처"],
    ["categories", "품목 분류"],
  ];
  return (
    <div className="po-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">진행 중 {openOrders}건</p>
          <h1 className="page-title">발주</h1>
        </div>
        {canManage && (
          <div className="page-actions">
            <Button
              variant="primary"
              onClick={() =>
                setDialog({
                  kind:
                    tab === "suppliers"
                      ? "supplier"
                      : tab === "categories"
                        ? "category"
                        : "new",
                })
              }
            >
              {tab === "suppliers"
                ? "거래처 등록"
                : tab === "categories"
                  ? "분류 등록"
                  : "발주 등록"}
            </Button>
          </div>
        )}
      </header>
      <div className="tabs" role="tablist" aria-label="발주 관리 메뉴">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => changeTab(id)}
          >
            {label}
            {id === "requests" && pendingRequests > 0 && (
              <span className="po-tab-count">{pendingRequests}</span>
            )}
          </button>
        ))}
      </div>
      {tab === "requests" ? (
        <RequestList
          data={data}
          canManage={canManage}
          runAction={runAction}
          notify={notify}
        />
      ) : tab === "summary" ? (
        <PurchaseSummary orders={orders} />
      ) : tab === "orders" ? (
        <>
          <div className="po-filters">
            <label className="input-icon po-search">
              <Icon name="search" />
              <span className="sr-only">검색</span>
              <input
                type="search"
                placeholder="거래처, 품목, 발주 메모"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(50);
                }}
              />
            </label>
            <Field label="배송 상태">
              <select
                value={delivery}
                onChange={(e) => setDelivery(e.target.value)}
              >
                <option value="all">전체 상태</option>
                {Object.entries(labels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="대금 지급">
              <select
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                <option value="all">전체</option>
                <option value="unpaid">미지급</option>
                <option value="paid">지급 완료</option>
              </select>
            </Field>
            <Field label="거래처">
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">전체 거래처</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.active ? "" : " (미사용)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="발주 시작일">
              <DateInput
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="발주 종료일">
              <DateInput
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </div>
          <div className="po-layout">
            <section className="po-list" aria-label="발주 목록">
              {rows.length ? (
                <table className="po-cards">
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">발주</th>
                      <th scope="col">금액과 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, limit).map((o) => {
                      const [ship, shipTone] = shipChip(o, receipts);
                      const pay = payChip(o);
                      const isSelected = o.id === selectedId;
                      return (
                        <tr
                          key={o.id}
                          className="po-card"
                          aria-current={isSelected || undefined}
                        >
                          <td className="po-card-main">
                            <button
                              type="button"
                              className="po-card-button"
                              aria-label={`${o.supplierName} ${itemsLabel(o)} 발주 상세`}
                              onClick={() => setSelectedId(o.id)}
                            >
                              <span className="po-card-top">
                                <strong>{o.supplierName}</strong>
                                <span className="small muted">
                                  발주 {orderNo(o)}
                                </span>
                              </span>
                              <span className="po-card-items">
                                {itemsLabel(o)}
                              </span>
                              <span className="small muted">
                                {dateLabel(o.date)} 발주
                              </span>
                            </button>
                          </td>
                          <td className="po-card-side">
                            <strong className="po-card-amount num">
                              <Money value={total(o)} />
                            </strong>
                            <span className="po-chips">
                              <Badge tone={shipTone}>{ship}</Badge>
                              {pay && <Badge tone={pay[1]}>{pay[0]}</Badge>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="panel">
                  <EmptyState
                    title="조회할 발주가 없어요"
                    description="거래처와 품목을 등록한 다음 필요한 품목을 골라 발주하세요"
                  />
                </div>
              )}
              {rows.length > limit && (
                <Button
                  className="po-more-button"
                  onClick={() => setLimit((v) => v + 50)}
                >
                  발주 더 보기
                </Button>
              )}
              {rows.length > 0 && (
                <p className="po-list-sum">
                  <span className="small muted">조회한 발주 {rows.length}건</span>
                  <span className="small muted">
                    취소 제외 합계{" "}
                    <Money
                      value={rows.reduce(
                        (s, o) => s + (o.cancelled ? 0 : total(o)),
                        0,
                      )}
                    />
                  </span>
                </p>
              )}
            </section>
            {selected ? (
              <OrderPanel
                order={selected}
                orderNo={orderNo(selected)}
                store={data.store}
                receipts={receipts}
                canManage={canManage}
                onClose={() => setSelectedId(null)}
                onAction={(kind, receiptId) =>
                  setDialog({ kind, id: selected.id, receiptId })
                }
              />
            ) : (
              <aside className="panel po-detail po-detail-empty">
                <Icon name="truck" />
                <p className="muted">
                  발주를 고르면 입고와 지급을 여기서 기록해요
                </p>
              </aside>
            )}
          </div>
        </>
      ) : (
        <section className="panel po-master">
          <div className="po-filters">
            <label className="input-icon po-search">
              <Icon name="search" />
              <span className="sr-only">검색</span>
              <input
                type="search"
                placeholder="이름으로 검색"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(50);
                }}
              />
            </label>
            <Field label="사용 상태">
              <select
                value={active}
                onChange={(e) => setActive(e.target.value)}
              >
                <option value="active">사용</option>
                <option value="inactive">미사용</option>
                <option value="all">전체</option>
              </select>
            </Field>
          </div>
          {tab === "categories" && (
            <p className="help">
              품목을 묶어 보는 분류예요. 시술 재료와 판매 상품 구분은 품목에서
              따로 골라요. 미사용 분류는 새 품목에 고를 수 없어요
            </p>
          )}
          {masters.length ? (
            <div className="table-wrap">
              <table className="table po-table">
                <thead>
                  <tr>
                    <th>{tab === "suppliers" ? "거래처" : "분류"} 이름</th>
                    {tab === "suppliers" && (
                      <>
                        <th>담당자 / 연락처</th>
                        <th>메모</th>
                      </>
                    )}
                    <th>사용 상태</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {masters.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      {tab === "suppliers" && (
                        <>
                          <td>
                            {s.contact || "없음"}
                            <span className="po-secondary">
                              {s.phone || "연락처 없음"}
                            </span>
                          </td>
                          <td>{s.note || "없음"}</td>
                        </>
                      )}
                      <td>
                        <Badge tone={s.active ? "success" : "muted"}>
                          {s.active ? "사용" : "미사용"}
                        </Badge>
                      </td>
                      <td>
                        {canManage && (
                          <Button
                            variant="ghost"
                            aria-label={`${s.name} 수정`}
                            onClick={() =>
                              setDialog({
                                kind:
                                  tab === "suppliers" ? "supplier" : "category",
                                record: s,
                              })
                            }
                          >
                            수정
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="조회 결과가 없어요"
              description="사용 상태와 검색어를 확인하거나 새로 등록하세요"
            />
          )}
        </section>
      )}
      {["supplier", "category"].includes(dialog?.kind) && (
        <MasterForm
          kind={dialog.kind}
          initial={dialog.record}
          runAction={runAction}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === "new" && (
        <OrderForm
          data={data}
          runAction={runAction}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {[
        "receive",
        "ship",
        "cancel",
        "payment",
        "receiptCancel",
        "closeRemaining",
        "return",
        "settlement",
      ].includes(dialog?.kind) &&
        current && (
          <OrderAction
            kind={dialog.kind}
            order={current}
            orderNo={orderNo(current)}
            receiptId={dialog.receiptId}
            receipts={receipts}
            runAction={runAction}
            onClose={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              notify("발주 내역에 반영했습니다.");
            }}
          />
        )}
    </div>
  );
}
function MasterForm({ kind, initial, runAction, onClose, onSaved }) {
  const [form, setForm] = useState(
    initial || { name: "", contact: "", phone: "", note: "", active: true },
  );
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [requestClose, closeGuard] = useCloseGuard(dirty, onClose);
  const update = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction(
        kind === "supplier" ? "supplier.save" : "category.save",
        form,
      );
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const activeId = useId();
  const supplier = kind === "supplier";
  return (
    <Modal
      title={`${supplier ? "거래처" : "품목 분류"} ${initial ? "수정" : "등록"}`}
      size="wide"
      dirty={dirty}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            취소
          </Button>
          <Button
            type="submit"
            form="purchase-master"
            variant="primary"
            busy={busy}
          >
            저장
          </Button>
        </>
      }
    >
      <form id="purchase-master" onSubmit={submit} className="po-form">
        <fieldset className="po-fieldset" disabled={busy}>
          {error && (
            <div role="alert" className="alert alert-danger">
              {error}
            </div>
          )}
          <Field
            label={supplier ? "거래처 이름" : "분류 이름"}
            help={
              supplier
                ? undefined
                : "재고 화면에서 이 분류로 품목을 골라 볼 수 있어요"
            }
          >
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          {supplier && (
            <>
              <div className="po-grid-2">
                <Field label="담당자">
                  <input
                    maxLength={100}
                    value={form.contact}
                    onChange={(e) => update("contact", e.target.value)}
                  />
                </Field>
                <Field label="연락처">
                  <input
                    type="tel"
                    className="num"
                    maxLength={30}
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                  />
                </Field>
              </div>
              <Field label="거래처 메모">
                <textarea
                  rows="3"
                  maxLength={500}
                  placeholder="예: 화요일 오전 배송, 20만 원 이상 무료 배송"
                  value={form.note}
                  onChange={(e) => update("note", e.target.value)}
                />
              </Field>
            </>
          )}
          <div className="pob-switch-row">
            <span className="pob-switch-text">
              <span id={activeId}>사용</span>
              <span className="small muted">
                {supplier
                  ? "끄면 새 발주에서 숨겨요. 기존 품목과 발주 이력은 남아요"
                  : "끄면 새 품목에서 고를 수 없어요. 기존 품목과 발주 이력은 남아요"}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={!!form.active}
              aria-labelledby={activeId}
              onClick={() => update("active", !form.active)}
            />
          </div>
        </fieldset>
      </form>
      {closeGuard}
    </Modal>
  );
}
const ORDER_SCOPES = [
  ["supplier", "이 거래처 품목"],
  ["low", "보충 필요"],
  ["all", "모든 품목"],
];
function OrderForm({ data, runAction, onClose, onSaved }) {
  const [form, setForm] = useState({
    supplierId: "",
    date: todayInSeoul(),
    deliveryDate: "",
    notes: "",
  });
  const [selected, setSelected] = useState({}),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [scope, setScope] = useState("supplier");
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [requestClose, closeGuard] = useCloseGuard(dirty, onClose);
  const update = (key, v) => {
    setForm((f) => ({ ...f, [key]: v }));
    setDirty(true);
  };
  const requestedQty = {};
  for (const r of data.purchaseRequests || [])
    if (r.status === "requested")
      requestedQty[r.itemId] = (requestedQty[r.itemId] || 0) + Number(r.quantity);
  const isLow = (i) => Number(i.qty) <= Number(i.min);
  const ours = (i) => i.supplierId === form.supplierId;
  const items = data.items
    .filter((i) => i.active !== false)
    .sort(
      (a, b) =>
        Number(ours(b)) - Number(ours(a)) ||
        Number(isLow(b) || !!requestedQty[b.id]) -
          Number(isLow(a) || !!requestedQty[a.id]) ||
        a.name.localeCompare(b.name, "ko"),
    );
  const shown = items.filter(
    (i) =>
      (scope === "all" ||
        (scope === "low" ? isLow(i) : ours(i) || !i.supplierId)) &&
      (!category ||
        (i.categoryId ||
          (i.kind === "판매 상품" ? "cat-sale" : "cat-service")) ===
          category) &&
      matchesSearch(search, [i.name, i.spec, i.barcode]),
  );
  const toggle = (item, checked) => {
    setSelected((old) => {
      const next = { ...old };
      if (checked)
        next[item.id] = { quantity: 1, unitCost: item.purchasePrice || 0 };
      else delete next[item.id];
      return next;
    });
    setDirty(true);
  };
  const changeLine = (id, key, v) => {
    setSelected((old) => ({ ...old, [id]: { ...old[id], [key]: v } }));
    setDirty(true);
  };
  const count = Object.keys(selected).length;
  const amount = Object.values(selected).reduce(
    (s, l) => s + Number(l.quantity) * Number(l.unitCost),
    0,
  );
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction("purchase.create", {
        ...form,
        lines: Object.entries(selected).map(([itemId, l]) => ({
          itemId,
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
        })),
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="발주 등록"
      size="wide"
      dirty={dirty}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <span className="po-total">
            <span className="small muted">{count}품목 합계</span>
            <strong className="num">
              <Money value={amount} />
            </strong>
          </span>
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            취소
          </Button>
          <Button
            type="submit"
            form="purchase-new"
            variant="primary"
            busy={busy}
            disabled={!count}
          >
            발주 저장
          </Button>
        </>
      }
    >
      <form id="purchase-new" onSubmit={submit} className="po-form">
        <fieldset className="po-fieldset" disabled={busy}>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="po-grid-3">
            <Field label="발주 거래처">
              <select
                required
                value={form.supplierId}
                onChange={(e) => {
                  update("supplierId", e.target.value);
                  setSelected({});
                }}
              >
                <option value="">거래처 선택</option>
                {(data.suppliers || [])
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="발주일">
              <DateInput
                required
                value={form.date}
                max={todayInSeoul()}
                onChange={(e) => update("date", e.target.value)}
              />
            </Field>
            <Field label="납품 예정일">
              <DateInput
                min={form.date}
                value={form.deliveryDate}
                onChange={(e) => update("deliveryDate", e.target.value)}
              />
            </Field>
          </div>
          {!data.suppliers?.some((s) => s.active) && (
            <div className="alert">
              거래처 탭에서 사용 중인 거래처를 먼저 등록하세요
            </div>
          )}
          {form.supplierId ? (
            <section className="po-pick-section" aria-labelledby="po-pick-title">
              <div className="po-pick-head">
                <h3 id="po-pick-title">
                  {ORDER_SCOPES.find(([id]) => id === scope)?.[1]}
                </h3>
                <span className="small muted">
                  보충이 필요한 품목을 먼저 보여줘요
                </span>
              </div>
              <div className="po-pick-filters">
                <label className="input-icon po-search">
                  <Icon name="search" />
                  <input
                    type="search"
                    aria-label="발주 품목 검색"
                    placeholder="품목 이름이나 바코드"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="품목 분류"
                  className="po-pick-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">전체 분류</option>
                  {(data.itemCategories || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="chip-row" role="group" aria-label="품목 범위">
                  {ORDER_SCOPES.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className="chip"
                      aria-pressed={scope === id}
                      onClick={() => setScope(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="po-picks">
                {shown.map((i) => {
                  const line = selected[i.id];
                  const qty = Number(line?.quantity) || 0;
                  const low = isLow(i);
                  return (
                    <div
                      className={`po-pick ${line ? "is-selected" : ""}`}
                      key={i.id}
                    >
                      <input
                        type="checkbox"
                        className="po-pick-check"
                        aria-label={`${i.name} 발주 선택`}
                        checked={!!line}
                        onChange={(e) => toggle(i, e.target.checked)}
                      />
                      <span className="po-pick-name">
                        <strong>{i.name}</strong>
                        <span
                          className={`small ${low ? "tone-warn-text" : "muted"}`}
                        >
                          {quantity(i.qty)}
                          {i.unit} 남음{low ? " 보충 필요" : ""}
                        </span>
                        {requestedQty[i.id] > 0 && (
                          <span className="small tone-warn-text">
                            구매 요청 {requestedQty[i.id]}개
                          </span>
                        )}
                      </span>
                      <span className="po-pick-stepper">
                        <button
                          type="button"
                          className="po-step"
                          aria-label={`${i.name} 하나 줄이기`}
                          disabled={!line || qty <= 1}
                          onClick={() =>
                            changeLine(i.id, "quantity", String(qty - 1))
                          }
                        >
                          <Icon name="minus" size={20} />
                        </button>
                        <input
                          required
                          type="number"
                          className="po-step-input num"
                          aria-label={`${i.name} 발주 개수`}
                          inputMode="numeric"
                          min="1"
                          max="1000000"
                          step="1"
                          disabled={!line}
                          value={line ? line.quantity : 0}
                          onChange={(e) =>
                            changeLine(i.id, "quantity", e.target.value)
                          }
                        />
                        <button
                          type="button"
                          className="po-step"
                          aria-label={`${i.name} 하나 늘리기`}
                          onClick={() =>
                            line
                              ? changeLine(i.id, "quantity", String(qty + 1))
                              : toggle(i, true)
                          }
                        >
                          <Icon name="plus" size={20} />
                        </button>
                      </span>
                      <strong className="po-pick-amount num">
                        <Money
                          value={line ? qty * Number(line.unitCost || 0) : 0}
                        />
                      </strong>
                      {line && (
                        <label className="po-pick-cost">
                          <span className="small muted">개당</span>
                          <input
                            required
                            type="number"
                            inputMode="numeric"
                            aria-label={`${i.name} 개당 금액 (원)`}
                            min="0"
                            max="1000000000"
                            step="1"
                            value={line.unitCost}
                            onChange={(e) =>
                              changeLine(i.id, "unitCost", e.target.value)
                            }
                          />
                          <span className="small muted">
                            원
                            {!(Number(i.packSize || 1) === 1 && i.unit === "개") &&
                              ` (1개 ${quantity(i.packSize || 1)}${i.unit})`}
                          </span>
                        </label>
                      )}
                    </div>
                  );
                })}
                {!shown.length && (
                  <p className="help">
                    조건에 맞는 품목이 없어요. 모든 품목을 누르거나 재고
                    화면에서 품목의 사용 상태와 기본 거래처를 확인하세요
                  </p>
                )}
              </div>
              {Object.keys(selected).some(
                (id) => !shown.some((i) => i.id === id),
              ) && (
                <div className="alert po-hidden-alert">
                  <span>검색 조건 밖에도 고른 품목이 있어요</span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      setCategory("");
                      setScope("all");
                    }}
                  >
                    선택 품목 확인
                  </Button>
                </div>
              )}
            </section>
          ) : (
            <p className="help">
              거래처를 고르면 그 거래처 품목이 보여요. 발주만 등록하면 재고는
              늘지 않아요
            </p>
          )}
          <Field label="발주 메모">
            <textarea
              maxLength={500}
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          </Field>
        </fieldset>
      </form>
      {closeGuard}
    </Modal>
  );
}
// Purchase-order print body (PrintPurchaseOrder board); base styles come from print.js.
const PRINT_ORDER_STYLE = `<style>
  .po-print { display: flex; flex-direction: column; gap: 32px; }
  .po-print .doc-head { margin: 0; }
  .po-print h1 { margin: 0; font-size: 40px; line-height: 48px; letter-spacing: 0.24em; }
  .po-print .meta { margin: 0; }
  .po-print .meta h2, .po-print-note h2 { margin: 0 0 12px; }
  .po-print .meta dt { font-size: 14px; line-height: 20px; font-weight: 500; }
  .po-print-lines { padding: 12px 16px; border-radius: 12px; background: #F4F4F6; display: flex; flex-direction: column; gap: 12px; }
  .po-print-row { display: grid; grid-template-columns: minmax(0, 1fr) 96px 64px 96px 112px; gap: 12px; }
  .po-print-row > span:not(:first-child) { text-align: right; white-space: nowrap; }
  .po-print-row.is-head { color: #555; font-size: 12px; line-height: 16px; font-weight: 600; }
  .po-print-row:not(.is-head) > span:first-child { font-weight: 600; }
  .po-print-sum { margin-top: -16px; padding: 0 16px; display: flex; justify-content: space-between; align-items: baseline; }
  .po-print-sum strong:first-child { font-size: 16px; line-height: 24px; font-weight: 600; }
  .po-print-sum strong:last-child { font-size: 18px; line-height: 1.25; font-weight: 700; }
  .po-print-note { display: flex; flex-direction: column; gap: 8px; }
  .po-print-note h2 { margin: 0; }
  .po-print .footer { margin-top: 0; }
  .po-print .footer > span:first-child { font-size: 16px; line-height: 24px; font-weight: 600; }
  .po-print-seal { width: 72px; height: 72px; border-radius: 12px; border: 1px dashed #8B8B96; display: flex; align-items: center; justify-content: center; color: #555; }
</style>`;
function printOrder(o, store) {
  const lines = o.lines.filter((l) => l.quantity - cancelled(o, l) > 0);
  const rows = lines
    .map((l) => {
      const count = l.quantity - cancelled(o, l);
      return `<div class="po-print-row"><span>${escapeHtml(l.itemName)}</span><span>${escapeHtml(
        `${quantity(l.packSize)}${l.unit}`,
      )}</span><span>${count}개</span><span>${printMoney(
        l.unitCost,
      )}</span><span>${printMoney(count * l.unitCost)}</span></div>`;
    })
    .join("");
  const amount = lines.reduce(
    (s, l) => s + (l.quantity - cancelled(o, l)) * l.unitCost,
    0,
  );
  const notes = String(o.notes || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("");
  const storeName = escapeHtml(store?.name || "");
  printDocument(
    `발주서 ${o.date}`,
    `${PRINT_ORDER_STYLE}<div class="po-print">
    <header class="doc-head"><div style="display:flex;flex-direction:column;gap:8px">
      ${logoTag(store)}<span class="brand"><span class="brand-dot"></span>${storeName}</span>
      <h1>발주서</h1></div></header>
    <div class="meta">
      <section><h2>수신: ${escapeHtml(o.supplierName)} 귀하</h2>
        <dl><dt>발주일</dt><dd>${escapeHtml(o.date)}</dd><dt>납품 요청일</dt><dd>${escapeHtml(
          o.deliveryDate || "협의",
        )}</dd><dt>발주 번호</dt><dd>${escapeHtml(o.id.slice(0, 8))}</dd><dt>담당</dt><dd>${escapeHtml(
          o.actorName,
        )}</dd></dl></section>
      <section><h2>발신</h2>${storeBlock(store)}</section>
    </div>
    <p>아래와 같이 발주합니다.</p>
    <section class="po-print-lines" aria-label="발주 품목">
      <div class="po-print-row is-head"><span>품목</span><span>포장 용량</span><span>수량</span><span>단가</span><span>금액</span></div>
      ${rows}
    </section>
    <div class="po-print-sum"><strong>합계</strong><strong>${printMoney(amount)}</strong></div>
    ${notes ? `<section class="po-print-note"><h2>요청 사항</h2>${notes}</section>` : ""}
    <footer class="footer"><span>${storeName}</span><span class="po-print-seal" aria-label="직인 자리">(인)</span></footer>
    </div>`,
  );
}

// Non-modal side panel: the list stays usable while one order is open.
function OrderPanel({
  order: o,
  orderNo,
  store,
  receipts,
  canManage,
  onClose,
  onAction,
}) {
  const titleId = useId();
  const moreId = useId();
  const receivedId = useId();
  const logId = useId();
  const headingRef = useRef(null);
  const [logOpen, setLogOpen] = useState(true);
  useEffect(() => {
    headingRef.current?.focus();
  }, [o.id]);
  const history = receipts.filter((r) => r.orderId === o.id);
  const [ship, shipTone] = shipChip(o, receipts);
  const hasPending =
    !o.cancelled && o.lines.some((l) => pending(o, l, receipts) > 0);
  const canReturn = o.lines.some((l) => received(l, receipts) > returned(o, l));
  const canCancel =
    paidAmount(o) === 0 && !o.lines.some((l) => received(l, receipts) > 0);
  const due = balance(o);
  const facts = [
    ["발주 번호", `발주 ${orderNo}`],
    ["납품 예정일", o.deliveryDate || "미정"],
    ["등록자", o.actorName],
    ...(o.paid && o.paidDate ? [["지급일", o.paidDate]] : []),
    ...(o.notes ? [["메모", o.notes]] : []),
  ];
  const more = canManage && !o.cancelled;
  return (
    <section
      className="panel po-detail"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="po-detail-head">
        <div className="po-detail-title">
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>
            {o.supplierName}
          </h2>
          <span className="muted">{dateLabel(o.date)} 발주</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="닫기"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="pob-detail-body">
        <div className="pob-detail-col">
          <div className="po-detail-status">
            <Badge tone={shipTone}>{ship}</Badge>
            <span className="small muted">{payText(o)}</span>
          </div>
          <dl className="pob-facts pob-facts-2">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="po-lines">
            {o.lines.map((l) => {
              const ordered = l.quantity - cancelled(o, l);
              const got = received(l, receipts);
              const pct =
                ordered > 0 ? Math.min(100, (got / ordered) * 100) : 0;
              const done = ordered > 0 && got >= ordered;
              return (
                <div
                  key={l.id}
                  className={`po-line ${done ? "is-done" : got > 0 ? "is-partial" : ""}`}
                >
                  <div className="po-line-top">
                    <strong>{l.itemName}</strong>
                    <span className="num">
                      <Money
                        value={
                          (l.quantity - cancelled(o, l) - returned(o, l)) *
                          l.unitCost
                        }
                      />
                    </span>
                  </div>
                  <span className="po-bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="pob-line-notes">
                    <span className="pob-line-state">
                      {ordered <= 0
                        ? "발주 수량을 모두 취소했어요"
                        : done
                          ? `${ordered}개 모두 입고`
                          : `${ordered}개 중 ${got}개 입고`}
                    </span>
                    {!(l.packSize === 1 && l.unit === "개") && (
                      <span className="small muted">
                        1개 {quantity(l.packSize)}
                        {l.unit}
                      </span>
                    )}
                    {cancelled(o, l) > 0 && (
                      <span className="small muted">
                        잔량 취소 {cancelled(o, l)}개
                      </span>
                    )}
                    {returned(o, l) > 0 && (
                      <span className="small muted">
                        반품 {returned(o, l)}개
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <dl className="po-money">
            <div>
              <dt>정산 금액</dt>
              <dd>
                <Money value={total(o)} />
              </dd>
            </div>
            <div>
              <dt>순지급액</dt>
              <dd>
                <Money value={paidAmount(o)} />
              </dd>
            </div>
            <div>
              <dt>{due < 0 ? "돌려받을 금액" : "남은 지급액"}</dt>
              <dd className={due !== 0 ? "tone-warn-text" : ""}>
                <Money value={Math.abs(due)} />
              </dd>
            </div>
          </dl>
          {more && (
            <div className="pob-more" role="group" aria-labelledby={moreId}>
              <span id={moreId} className="field-label">
                다른 처리
              </span>
              <div className="pob-more-buttons">
                {!o.shipped && hasPending && (
                  <button
                    type="button"
                    className="pob-outline-btn"
                    onClick={() => onAction("ship")}
                  >
                    배송 시작 기록
                  </button>
                )}
                <button
                  type="button"
                  className="pob-outline-btn"
                  onClick={() => onAction("settlement")}
                >
                  분할 지급과 환급
                </button>
                {hasPending && (
                  <button
                    type="button"
                    className="pob-outline-btn"
                    onClick={() => onAction("closeRemaining")}
                  >
                    미입고 잔량 취소
                  </button>
                )}
                {canReturn && (
                  <button
                    type="button"
                    className="pob-outline-btn"
                    onClick={() => onAction("return")}
                  >
                    거래처 반품
                  </button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    className="pob-outline-btn is-danger"
                    onClick={() => onAction("cancel")}
                  >
                    발주 취소
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="pob-detail-col pob-detail-side">
          <section className="pob-section" aria-labelledby={receivedId}>
            <h3 id={receivedId}>실제 입고 내역</h3>
            {history.length ? (
              <ul className="po-history">
                {history.map((r) => {
                  const line = o.lines.find((l) => l.id === r.orderLineId);
                  return (
                    <li key={r.id} className="po-history-row">
                      <span className="po-history-text">
                        <strong>{line?.itemName || "품목"}</strong>
                        <span className="num">
                          {quantity(r.qty)}
                          {line?.unit} 입고
                        </span>
                        <span className="small muted num">{r.date}</span>
                        <span className="small muted">{r.actorName}</span>
                        {r.memo && (
                          <span className="small muted">{r.memo}</span>
                        )}
                      </span>
                      {r.status === "cancelled" ? (
                        <Badge>입고 취소</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          className="pob-history-cancel"
                          onClick={() => onAction("receiptCancel", r.id)}
                        >
                          이 입고 취소
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="help">
                아직 입고되지 않았어요. 실제 받은 수량만 입력해요
              </p>
            )}
            <p className="help">
              잘못 넣은 입고는 취소한 뒤 다시 등록해요. 이미 쓴 재고 때문에
              음수가 되면 취소할 수 없어요
            </p>
          </section>
          <section className="pob-section">
            <h3 className="pob-toggle-title">
              <button
                type="button"
                className="pob-toggle"
                aria-expanded={logOpen}
                aria-controls={logId}
                onClick={() => setLogOpen((v) => !v)}
              >
                발주 처리 이력
                <Icon name={logOpen ? "chevron-up" : "chevron-down"} />
              </button>
            </h3>
            {logOpen && (
              <ol id={logId} className="pob-log">
                {o.changes
                  .slice()
                  .reverse()
                  .map((c, i) => (
                    <li key={i}>
                      <span className="pob-log-top">
                        <strong>{c.action}</strong>
                        <span className="small muted num">
                          {c.date || c.at.slice(0, 10)}
                        </span>
                      </span>
                      <span className="small muted">{c.actorName}</span>
                      {Number.isSafeInteger(c.paymentDelta) && (
                        <span className="small muted num">
                          {c.paymentDelta.toLocaleString("ko-KR")}원
                        </span>
                      )}
                      {c.reason && (
                        <span className="small muted">{c.reason}</span>
                      )}
                      {c.lines?.map((l, index) => (
                        <span key={index} className="small muted num">
                          {l.itemName || "품목"} {l.quantity}개
                        </span>
                      ))}
                    </li>
                  ))}
              </ol>
            )}
          </section>
        </div>
      </div>
      <div className="pob-detail-foot">
        <Button
          variant="ghost"
          className="pob-print"
          onClick={() => printOrder(o, store, orderNo)}
        >
          <Icon name="print" />
          발주서 인쇄
        </Button>
        {canManage && !o.cancelled && due > 0 && (
          <Button variant="secondary" onClick={() => onAction("payment")}>
            대금 지급 기록
          </Button>
        )}
        {hasPending && (
          <Button variant="primary" onClick={() => onAction("receive")}>
            입고 수량 입력
          </Button>
        )}
      </div>
    </section>
  );
}
const won = (value) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
const PAY_METHODS = [
  ["계좌이체", "계좌이체"],
  ["현금", "현금"],
  ["카드", "카드"],
];
const SETTLEMENT_KINDS = [
  ["payment", "대금 지급"],
  ["refund", "거래처 환급 수령"],
  ["void", "입력 정정"],
];
// Chip radio group (arrow keys move the choice), labelled by a visible field label.
function ChipChoice({ label, options, value, onChange }) {
  const id = useId();
  const refs = useRef([]);
  const selected = Math.max(
    0,
    options.findIndex(([v]) => v === value),
  );
  const move = (index) => {
    const next = (index + options.length) % options.length;
    onChange(options[next][0]);
    refs.current[next]?.focus();
  };
  return (
    <div className="field">
      <span id={id} className="field-label">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="chip-row">
        {options.map(([option, text], index) => (
          <button
            key={option}
            ref={(el) => (refs.current[index] = el)}
            type="button"
            role="radio"
            className="chip pob-radio"
            aria-checked={value === option}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(index + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(index - 1);
              }
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
// Whole-number stepper: [−] [input] [+]; the input's accessible name is `label`.
function CountStepper({ label, value, max, onChange }) {
  const count = Number(value) || 0;
  const set = (next) =>
    onChange(String(Math.max(0, Math.min(max, next))) || "");
  return (
    <span className="pob-stepper">
      <button
        type="button"
        className="po-step"
        aria-label={`${label} 하나 줄이기`}
        disabled={count <= 0}
        onClick={() => set(count - 1)}
      >
        <Icon name="minus" />
      </button>
      <input
        className={`pob-count num ${count > 0 ? "" : "is-zero"}`}
        type="number"
        inputMode="numeric"
        aria-label={label}
        min="0"
        max={max}
        step="1"
        value={value || ""}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="po-step"
        aria-label={`${label} 하나 늘리기`}
        disabled={count >= max}
        onClick={() => set(count + 1)}
      >
        <Icon name="plus" />
      </button>
    </span>
  );
}
function OrderAction({
  kind,
  order: o,
  orderNo,
  receiptId,
  receipts,
  runAction,
  onClose,
  onSaved,
}) {
  const [date, setDate] = useState(todayInSeoul()),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [amounts, setAmounts] = useState({}),
    [method, setMethod] = useState(PAY_METHODS[0][0]);
  const [settlementKind, setSettlementKind] = useState(
      balance(o) < 0 ? "refund" : "payment",
    ),
    [paymentAmount, setPaymentAmount] = useState(String(Math.abs(balance(o)))),
    [paymentId, setPaymentId] = useState("");
  const lineMode = ["receive", "closeRemaining", "return"].includes(kind);
  const maxFor = (l) =>
    kind === "return"
      ? received(l, receipts) - returned(o, l)
      : pending(o, l, receipts);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const [requestClose, closeGuard] = useCloseGuard(dirty, onClose);
  const titles = {
    receive: "입고 수량 입력",
    closeRemaining: "미입고 잔량 취소",
    return: "거래처 반품",
    settlement: "분할 지급과 환급",
    ship: "배송 시작 기록",
    cancel: "발주 취소",
    payment: o.paid ? "지급 기록 정정" : "대금 지급 기록",
    receiptCancel: "발주 입고 취소",
  };
  const saveLabel =
    kind === "receive" ? "발주 입고 저장" : `${titles[kind]} 저장`;
  const setAmount = (lineId, value) => {
    setAmounts((a) => ({ ...a, [lineId]: value }));
    setDirty(true);
  };
  const due = balance(o);
  const settlementMax =
    settlementKind === "refund" ? Math.max(0, -due) : Math.max(0, due);
  const voidable = o.changes.filter(
    (c) =>
      c.paymentId &&
      c.paymentDelta &&
      !c.voids &&
      !o.changes.some((v) => v.voids === c.paymentId),
  );
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let p = { id: o.id };
      if (lineMode)
        p = {
          ...p,
          date,
          memo: reason,
          reason,
          lines: Object.entries(amounts)
            .filter(([, v]) => Number(v) > 0)
            .map(([lineId, v]) => ({ lineId, quantity: Number(v) })),
        };
      if (kind === "settlement")
        p = {
          ...p,
          kind: settlementKind,
          amount: Number(paymentAmount),
          date,
          reason,
          reference,
          paymentId,
        };
      // The server keeps no payment-method field, so the method is saved with the memo.
      if (kind === "payment")
        p = {
          ...p,
          paid: !o.paid,
          paidDate: date,
          reason: o.paid ? reason : `${reason} (${method})`,
          reference,
        };
      if (kind === "cancel" || kind === "receiptCancel")
        p = { ...p, reason, receiptId };
      await runAction(`purchase.${kind}`, p);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const rows = lineMode
    ? o.lines.filter((l) =>
        kind === "receive"
          ? l.quantity - cancelled(o, l) > 0
          : maxFor(l) > 0,
      )
    : [];
  const picked = rows.filter((l) => Number(amounts[l.id]) > 0);
  const pickedCount = picked.reduce((s, l) => s + Number(amounts[l.id]), 0);
  const pickedCost = picked.reduce(
    (s, l) => s + Number(amounts[l.id]) * l.unitCost,
    0,
  );
  const countLabel = (l) =>
    `${l.itemName} ${kind === "return" ? "반품" : kind === "closeRemaining" ? "취소" : "이번 입고"} 개수`;
  // Payable balance after this settlement is saved (negative = refund owed to us).
  const settlementDelta =
    settlementKind === "void"
      ? -(voidable.find((c) => c.paymentId === paymentId)?.paymentDelta || 0)
      : (settlementKind === "refund" ? -1 : 1) * (Number(paymentAmount) || 0);
  const nextDue = due - settlementDelta;
  let summary = null;
  if (kind === "receive")
    summary = (
      <span className="pob-foot-sum">
        <span className="small muted">이번 입고</span>
        <strong className="num">
          {picked.length ? `${picked.length}품목 ${pickedCount}개` : "없음"}
        </strong>
      </span>
    );
  if (kind === "return")
    summary = (
      <span className="pob-foot-sum">
        <span className="small muted">이번 반품</span>
        <strong className="num">
          {pickedCount ? `${pickedCount}개 ${won(pickedCost)}` : "없음"}
        </strong>
      </span>
    );
  if (kind === "settlement")
    summary = (
      <span className="pob-foot-sum">
        <span className="small muted">
          {nextDue < 0 ? "저장하면 돌려받을 금액" : "저장하면 남은 지급액"}
        </span>
        <strong className="num">{won(Math.abs(nextDue))}</strong>
      </span>
    );
  return (
    <Modal
      title={titles[kind]}
      subtitle={`${o.supplierName} 발주 ${orderNo}`}
      size="wide"
      dirty={dirty}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          {summary}
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            돌아가기
          </Button>
          <Button
            type="submit"
            form="purchase-operation"
            variant={
              ["cancel", "receiptCancel"].includes(kind) ? "danger" : "primary"
            }
            busy={busy}
          >
            {saveLabel}
          </Button>
        </>
      }
    >
      <form
        id="purchase-operation"
        className="po-form"
        onSubmit={submit}
        onChange={() => setDirty(true)}
      >
        <fieldset className="po-fieldset" disabled={busy}>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          {!["payment", "settlement"].includes(kind) && (
            <div className="pob-order-row">
              <span className="pob-order-text">
                <strong>{dateLabel(o.date)} 발주</strong>
                {kind === "receive" && (
                  <span className="small muted">
                    실제 받은 개수만 넣어 주세요. 남은 개수보다 많이 넣을 수
                    없어요
                  </span>
                )}
              </span>
              <span className="pob-order-side">
                <span className="small muted">발주 총 금액</span>
                <strong className="num">{won(total(o))}</strong>
              </span>
            </div>
          )}
          {["closeRemaining", "return"].includes(kind) && (
            <p className="help">
              {kind === "return"
                ? "실제로 거래처에 돌려보낸 개수를 넣어 주세요. 재고와 매입 금액이 줄고, 환급은 분할 지급과 환급에서 따로 기록해요"
                : "더 받지 않을 잔량만 취소해요. 이미 받은 물품의 재고는 그대로예요"}
            </p>
          )}
          {kind === "receive" && (
            <div className="pob-date-grid">
              <Field label="입고일">
                <DateInput
                  required
                  min={o.date}
                  max={todayInSeoul()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="입고 메모 (선택)">
                <input
                  maxLength={500}
                  placeholder="예: 박스 하나 찌그러져 도착"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            </div>
          )}
          {["closeRemaining", "return"].includes(kind) && (
            <Field label="처리일" className="pob-date-field">
              <DateInput
                required
                min={o.date}
                max={todayInSeoul()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          )}
          {lineMode && (
            <PickedLines
              kind={kind}
              order={o}
              rows={rows}
              amounts={amounts}
              receipts={receipts}
              maxFor={maxFor}
              countLabel={countLabel}
              setAmount={setAmount}
            />
          )}
          {kind === "settlement" && (
            <>
              <dl className="pob-facts pob-facts-3">
                <div>
                  <dt>현재 순지급액</dt>
                  <dd>{won(paidAmount(o))}</dd>
                </div>
                <div>
                  <dt>남은 지급액</dt>
                  <dd className={due > 0 ? "tone-warn-text" : "is-zero"}>
                    {won(Math.max(0, due))}
                  </dd>
                </div>
                <div>
                  <dt>돌려받을 금액</dt>
                  <dd className={due < 0 ? "tone-warn-text" : "is-zero"}>
                    {won(Math.max(0, -due))}
                  </dd>
                </div>
              </dl>
              <p className="help">
                실제 송금이나 환급 결과를 기록해요. 잘못 넣은 기록은 입력
                정정으로 취소 이력을 남겨요
              </p>
              <ChipChoice
                label="정산 구분"
                options={SETTLEMENT_KINDS}
                value={settlementKind}
                onChange={(next) => {
                  setSettlementKind(next);
                  setDirty(true);
                  setPaymentAmount(
                    String(
                      next === "refund" ? Math.max(0, -due) : Math.max(0, due),
                    ),
                  );
                }}
              />
              <div className="po-grid-3">
                {settlementKind === "void" ? (
                  <Field label="정정할 기록">
                    <select
                      required
                      value={paymentId}
                      onChange={(e) => setPaymentId(e.target.value)}
                    >
                      <option value="">선택하세요</option>
                      {voidable.map((c) => (
                        <option key={c.paymentId} value={c.paymentId}>
                          {c.date || c.at.slice(0, 10)}{" "}
                          {c.paymentDelta.toLocaleString("ko-KR")}원 (
                          {c.reason || c.action})
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field
                    label="이번 정산 금액"
                    help={`최대 ${won(settlementMax)}`}
                  >
                    <span className="pob-suffix">
                      <input
                        required
                        className="num"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        max={settlementMax}
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                      />
                      <span className="pob-unit" aria-hidden="true">
                        원
                      </span>
                    </span>
                  </Field>
                )}
                <Field label="정산일">
                  <DateInput
                    required
                    max={todayInSeoul()}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
                <Field label="거래 참조번호 (선택)">
                  <input
                    value={reference}
                    maxLength={100}
                    placeholder="이체 번호"
                    onChange={(e) => setReference(e.target.value)}
                  />
                </Field>
              </div>
            </>
          )}
          {kind === "ship" && (
            <p className="help">
              거래처에서 배송을 시작한 걸 확인한 뒤 기록해 주세요. 실제 재고는
              입고 수량을 넣을 때 늘어요
            </p>
          )}
          {kind === "payment" && (
            <>
              {!o.paid && (
                <div className="pob-pay-card">
                  <span className="pob-stat">
                    <span className="small muted">이번에 기록할 남은 대금</span>
                    <strong className="pob-big num">
                      {won(Math.max(0, due))}
                    </strong>
                  </span>
                  <span className="pob-pay-side">
                    <span className="small muted">
                      발주 총 금액 {won(total(o))}
                    </span>
                    <span className="small muted">
                      이미 지급 {won(paidAmount(o))}
                    </span>
                  </span>
                </div>
              )}
              <p className="help">
                {o.paid
                  ? "지급 기록을 미지급으로 정정해요. 실제 이체 취소나 환불은 거래처와 따로 처리해 주세요"
                  : "남은 대금을 실제로 모두 지급한 뒤 기록해 주세요. 일부만 지급했다면 분할 지급과 환급을 써요"}
              </p>
              <div className={o.paid ? "" : "po-grid-2"}>
                {!o.paid && (
                  <Field label="실제 지급일">
                    <DateInput
                      required
                      max={todayInSeoul()}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                )}
                <Field label="이체 확인 번호 (선택)">
                  <input
                    maxLength={100}
                    placeholder="은행 앱의 거래 번호"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </Field>
              </div>
              {!o.paid && (
                <ChipChoice
                  label="지급 수단"
                  options={PAY_METHODS}
                  value={method}
                  onChange={(next) => {
                    setMethod(next);
                    setDirty(true);
                  }}
                />
              )}
            </>
          )}
          {!["ship", "receive"].includes(kind) && (
            <Field
              label={
                ["payment", "settlement"].includes(kind)
                  ? "메모 (필수)"
                  : "처리 사유 (필수)"
              }
            >
              <textarea
                required
                rows="2"
                maxLength={kind === "payment" ? 480 : 500}
                placeholder={
                  {
                    closeRemaining: "예: 거래처 품절",
                    return: "예: 파손품 반품",
                    settlement: "예: 1차 분할 지급, 반품 환급 입금 확인",
                    payment: "예: 11월분 잔금 이체",
                    cancel: "예: 거래처 사정으로 주문 취소",
                    receiptCancel: "예: 입고 수량을 잘못 넣었어요",
                  }[kind]
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
        </fieldset>
      </form>
      {closeGuard}
    </Modal>
  );
}
// Line rows with a count stepper (PurchaseReceive and PurchaseCancelReturn boards).
function PickedLines({
  kind,
  order: o,
  rows,
  amounts,
  receipts,
  maxFor,
  countLabel,
  setAmount,
}) {
  const groupId = useId();
  return (
    <div className="pob-lines" role="group" aria-labelledby={groupId}>
      <span id={groupId} className="field-label">
        {kind === "receive"
          ? "이번에 받은 개수"
          : kind === "return"
            ? "반품할 개수"
            : "취소할 개수"}
      </span>
      {rows.map((l) => {
        const max = maxFor(l);
        const value = amounts[l.id] || "";
        const count = Number(value) || 0;
        const ordered = l.quantity - cancelled(o, l);
        const got = received(l, receipts);
        const pack = `1개 ${quantity(l.packSize)}${l.unit}`;
        let notes;
        if (kind === "receive") notes = [pack];
        else if (kind === "closeRemaining")
          notes = [
            `${ordered}개 중 ${got}개 입고`,
            count > 0 ? `매입 금액 ${won(count * l.unitCost)} 줄어요` : pack,
          ];
        else
          notes = [
            `받은 ${got - returned(o, l)}개`,
            count > 0
              ? `재고 ${quantity(count * l.packSize)}${l.unit}와 매입 금액 ${won(count * l.unitCost)} 줄어요`
              : pack,
          ];
        return (
          <div
            key={l.id}
            className={`pob-line-row ${count > 0 ? "is-picked" : ""}`}
          >
            <span className="pob-line-name">
              <strong>{l.itemName}</strong>
              {notes.map((note) => (
                <span key={note} className="small muted">
                  {note}
                </span>
              ))}
            </span>
            {kind === "receive" ? (
              <>
                <span className="pob-line-stat">
                  <span className="small muted">발주</span>
                  <span className="num">{ordered}개</span>
                </span>
                <span className="pob-line-stat is-got">
                  <span className="small muted">받음</span>
                  <span className="num">{got}개</span>
                </span>
                <span className={`pob-line-stat ${max > 0 ? "is-left" : "is-none"}`}>
                  <span className="small muted">남음</span>
                  <span className="num">{max}개</span>
                </span>
              </>
            ) : (
              <span className="pob-line-stat is-wide">
                <span className="small muted">처리 가능</span>
                <span className="num">{max}개</span>
              </span>
            )}
            <span className="pob-line-control">
              {max > 0 ? (
                <CountStepper
                  label={countLabel(l)}
                  value={value}
                  max={max}
                  onChange={(next) => setAmount(l.id, next)}
                />
              ) : (
                <Badge tone="success">모두 받았어요</Badge>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RequestList({ data, canManage, runAction, notify }) {
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const statusLabel = { requested: "대기", ordered: "발주 반영", rejected: "반려" };
  const statusTone = { requested: "warning", ordered: "success", rejected: "muted" };
  const requests = (data.purchaseRequests || [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.status === "requested") - Number(a.status === "requested") ||
        String(b.createdAt).localeCompare(String(a.createdAt)),
    );
  async function decide(request, status, reason = "") {
    setBusy(request.id);
    setError("");
    try {
      await runAction("purchase.requestDecide", {
        id: request.id,
        status,
        note: reason,
      });
      setRejecting(null);
      setNote("");
      notify(status === "ordered" ? "발주 반영으로 표시했습니다." : "구매 요청을 반려했습니다.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel po-master">
      <p className="help">
        직원이 재고 화면에서 요청한 품목이에요. 거래처에 발주한 뒤 발주 반영으로
        표시하세요
      </p>
      {error && !rejecting && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {requests.length ? (
        <div className="table-wrap">
          <table className="table commerce-table commerce-mobile-cards po-table">
            <thead>
              <tr>
                <th>품목</th>
                <th className="numeric">수량</th>
                <th>요청자 / 요청일</th>
                <th>메모</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const item = (data.items || []).find((i) => i.id === r.itemId);
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{item?.name || r.itemName}</strong>
                      {item && (
                        <>
                          <span className="po-secondary">
                            지금 {quantity(item.qty)}
                            {item.unit}
                          </span>
                          <span className="po-secondary">
                            기준 {quantity(item.min)}
                            {item.unit}
                          </span>
                        </>
                      )}
                    </td>
                    <td data-label="수량" className="numeric">
                      {r.quantity}개
                    </td>
                    <td data-label="요청자 / 요청일">
                      {r.requestedBy}
                      <span className="po-secondary">
                        {String(r.createdAt).slice(0, 10)}
                      </span>
                    </td>
                    <td data-label="메모">
                      {r.note || "없음"}
                      {r.decisionNote && (
                        <span className="po-secondary">
                          처리 메모 {r.decisionNote}
                        </span>
                      )}
                    </td>
                    <td data-label="상태">
                      <Badge tone={statusTone[r.status]}>
                        {statusLabel[r.status]}
                      </Badge>
                      {r.decidedBy && (
                        <span className="po-secondary">{r.decidedBy}</span>
                      )}
                    </td>
                    <td>
                      {canManage && r.status === "requested" ? (
                        <div className="po-row-actions">
                          <Button
                            variant="secondary"
                            busy={busy === r.id}
                            onClick={() => decide(r, "ordered")}
                            aria-label={`${r.itemName} 발주 반영`}
                          >
                            발주 반영
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!!busy}
                            onClick={() => {
                              setError("");
                              setRejecting(r);
                            }}
                            aria-label={`${r.itemName} 요청 반려`}
                          >
                            반려
                          </Button>
                        </div>
                      ) : (
                        <span className="muted">없음</span>
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
          title="구매 요청이 없어요"
          description="재고 화면에서 품목별 구매 요청을 누르면 여기에 모여요"
        />
      )}
      {rejecting && (
        <RejectDialog
          request={rejecting}
          item={(data.items || []).find((i) => i.id === rejecting.itemId)}
          note={note}
          setNote={setNote}
          busy={busy === rejecting.id}
          locked={!!busy}
          error={error}
          onClose={() => setRejecting(null)}
          onReject={() => decide(rejecting, "rejected", note)}
        />
      )}
    </section>
  );
}

// RequestReject board: request facts, then the reason shown to the requester.
function RejectDialog({
  request: r,
  item,
  note,
  setNote,
  busy,
  locked,
  error,
  onClose,
  onReject,
}) {
  const [asking, setAsking] = useState(false);
  const close = () => (note ? setAsking(true) : onClose());
  const low = item && Number(item.qty) <= Number(item.min);
  const facts = [
    ["요청 수량", `${r.quantity}개`],
    ["요청자", r.requestedBy || "기존 기록"],
    ["요청일", String(r.createdAt || "").slice(0, 10)],
    ...(item
      ? [
          ["지금 재고", `${quantity(item.qty)}${item.unit}`, low],
          ["보충 기준", `${quantity(item.min)}${item.unit}`],
        ]
      : []),
    ...(r.note ? [["요청 메모", r.note]] : []),
  ];
  return (
    <Modal
      title={`${r.itemName} 요청 반려`}
      size="wide"
      onClose={locked ? undefined : onClose}
      dirty={!!note}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={locked}>
            취소
          </Button>
          <Button
            variant="danger"
            busy={busy}
            disabled={!note.trim()}
            onClick={onReject}
          >
            반려
          </Button>
        </>
      }
    >
      <div className="po-form po-fieldset">
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        <dl className="pob-facts pob-facts-3">
          {facts.map(([label, value, warn]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={warn ? "tone-warn-text" : ""}>{value}</dd>
            </div>
          ))}
        </dl>
        <Field label="반려 사유" help="요청한 직원에게 보여요">
          <textarea
            className="textarea"
            rows="3"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      {asking && (
        <ConfirmDialog
          title="작성 중인 내용을 닫을까요?"
          onClose={() => setAsking(false)}
          onConfirm={onClose}
          confirmLabel="내용 버리고 닫기"
          variant="danger"
        >
          저장하지 않은 변경사항이 사라집니다.
        </ConfirmDialog>
      )}
    </Modal>
  );
}

function PurchaseSummary({ orders }) {
  const today = todayInSeoul();
  const [from, setFrom] = useViewState(
    "purchases",
    "summaryFrom",
    `${today.slice(0, 7)}-01`,
  );
  const [to, setTo] = useViewState("purchases", "summaryTo", today);
  const inRange = orders.filter(
    (o) => !o.cancelled && (!from || o.date >= from) && (!to || o.date <= to),
  );
  const bySupplier = new Map();
  const byItem = new Map();
  for (const o of inRange) {
    const s = bySupplier.get(o.supplierName) || {
      name: o.supplierName,
      count: 0,
      amount: 0,
      paid: 0,
      balance: 0,
    };
    s.count += 1;
    s.amount += total(o);
    s.paid += paidAmount(o);
    s.balance += balance(o);
    bySupplier.set(o.supplierName, s);
    for (const l of o.lines) {
      const net = l.quantity - cancelled(o, l) - returned(o, l);
      const key = `${l.itemId}`;
      const it = byItem.get(key) || {
        name: l.itemName,
        unit: l.unit,
        quantity: 0,
        volume: 0,
        amount: 0,
      };
      it.quantity += net;
      it.volume += net * l.packSize;
      it.amount += net * l.unitCost;
      byItem.set(key, it);
    }
  }
  const suppliers = [...bySupplier.values()].sort((a, b) => b.amount - a.amount);
  const items = [...byItem.values()].sort((a, b) => b.amount - a.amount);
  const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
  return (
    <section className="panel po-master">
      <div className="po-filters">
        <Field label="발주 시작일">
          <DateInput
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="발주 종료일">
          <DateInput
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      <p className="help">
        발주일 기준이고 취소한 발주는 빼요. 금액은 미입고 잔량 취소와 거래처
        반품을 뺀 정산 금액이에요
      </p>
      <h2 className="po-summary-title">거래처별 매입</h2>
      {suppliers.length ? (
        <div className="table-wrap">
          <table className="table commerce-table commerce-mobile-cards po-table">
            <thead>
              <tr>
                <th>거래처</th>
                <th className="numeric">발주 건수</th>
                <th className="numeric">발주액</th>
                <th className="numeric">지급액</th>
                <th className="numeric">미지급</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.name}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td data-label="발주 건수" className="numeric">
                    {s.count}건
                  </td>
                  <td data-label="발주액" className="numeric">
                    <Money value={s.amount} />
                  </td>
                  <td data-label="지급액" className="numeric">
                    <Money value={s.paid} />
                  </td>
                  <td data-label="미지급" className="numeric">
                    <strong>
                      <Money value={s.balance} />
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>합계</td>
                <td className="numeric">{sum(suppliers, "count")}건</td>
                <td className="numeric">
                  <Money value={sum(suppliers, "amount")} />
                </td>
                <td className="numeric">
                  <Money value={sum(suppliers, "paid")} />
                </td>
                <td className="numeric">
                  <Money value={sum(suppliers, "balance")} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <EmptyState
          title="기간 안에 발주가 없어요"
          description="조회 기간을 바꿔 보세요"
        />
      )}
      {items.length > 0 && (
        <>
          <h2 className="po-summary-title">품목별 매입</h2>
          <div className="table-wrap">
            <table className="table commerce-table commerce-mobile-cards po-table">
              <thead>
                <tr>
                  <th>품목</th>
                  <th className="numeric">수량</th>
                  <th className="numeric">총 용량</th>
                  <th className="numeric">금액</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.name}>
                    <td>
                      <strong>{it.name}</strong>
                    </td>
                    <td data-label="수량" className="numeric">
                      {it.quantity}개
                    </td>
                    <td data-label="총 용량" className="numeric">
                      {quantity(it.volume)}
                      {it.unit}
                    </td>
                    <td data-label="금액" className="numeric">
                      <Money value={it.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
