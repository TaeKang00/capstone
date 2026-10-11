import React, { useState } from "react";
import {
  Button,
  Field,
  Modal,
  Badge,
  Money,
  EmptyState,
} from "../components/ui";
import { DateInput } from "../components/DateInput";
import { useViewState } from "../components/ViewState";
import { todayInSeoul, quantity } from "./commerce-utils";
import "../procurement.js";
import "./Commerce.css";
import "./Purchases.css";
const { received, total, status, labels } = globalThis.SalonProcurement;
const lineStatus = (o, l, receipts) =>
  o.cancelled
    ? "cancelled"
    : received(l, receipts) >= l.quantity
      ? "delivered"
      : received(l, receipts) > 0
        ? "waiting"
        : o.shipped
          ? "shipping"
          : "waiting";
const tone = (s) =>
  s === "delivered" ? "success" : s === "cancelled" ? "muted" : "warning";

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
  const [dialog, setDialog] = useState(null);
  const [limit, setLimit] = useState(50);
  const suppliers = data.suppliers || [],
    categories = data.itemCategories || [],
    orders = data.purchaseOrders || [],
    receipts = data.receipts || [];
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
        (payment === "all" || (payment === "paid" ? o.paid : !o.paid)),
    )
    .flatMap((o) =>
      o.lines.map((l) => ({ o, l, state: lineStatus(o, l, receipts) })),
    )
    .filter(
      ({ o, l, state }) =>
        (delivery === "all" || delivery === state) &&
        match(o.supplierName, l.itemName, o.notes, o.id),
    );
  const masters = (tab === "suppliers" ? suppliers : categories).filter(
    (s) =>
      (active === "all" || s.active === (active === "active")) &&
      match(s.name, s.contact || "", s.phone || ""),
  );
  const current = dialog?.id ? orders.find((o) => o.id === dialog.id) : null;
  const saved = () => {
    setDialog(null);
    notify("저장했습니다.");
  };
  const changeTab = (value) => {
    setTab(value);
    setQuery("");
    setLimit(50);
  };
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">발주 · 거래처</h1>
          <p className="page-description">
            필요한 품목을 발주하고 실제 입고와 대금 지급을 확인합니다.
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate("inventory")}>
            재고 · 품목 관리
          </Button>
          {canManage && (
            <Button
              variant="primary"
              onClick={() =>
                setDialog({
                  kind:
                    tab === "orders"
                      ? "new"
                      : tab === "suppliers"
                        ? "supplier"
                        : "category",
                })
              }
            >
              {tab === "orders"
                ? "+ 발주 등록"
                : tab === "suppliers"
                  ? "+ 거래처 등록"
                  : "+ 분류 등록"}
            </Button>
          )}
        </div>
      </header>
      <div className="commerce-stats">
        <div className="stat-card">
          <span>입고 대기 발주</span>
          <strong>
            {
              orders.filter(
                (o) => !o.cancelled && status(o, receipts) !== "delivered",
              ).length
            }
            <small>건</small>
          </strong>
          <span className="muted">부분 입고 포함</span>
        </div>
        <div className="stat-card">
          <span>입고 완료 발주</span>
          <strong>
            {orders.filter((o) => status(o, receipts) === "delivered").length}
            <small>건</small>
          </strong>
          <span className="muted">전체 수량 수령</span>
        </div>
        <div className="stat-card">
          <span>대금 미지급</span>
          <strong>
            <Money
              value={orders
                .filter((o) => !o.cancelled && !o.paid)
                .reduce((s, o) => s + total(o), 0)}
            />
          </strong>
          <span className="muted">실제 이체 후 지급 기록</span>
        </div>
        <div className="stat-card">
          <span>거래 중인 거래처</span>
          <strong>
            {suppliers.filter((s) => s.active).length}
            <small>곳</small>
          </strong>
          <span className="muted">사용 중인 거래처</span>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="발주 관리 메뉴">
        {[
          ["orders", "발주 내역"],
          ["suppliers", "거래처"],
          ["categories", "품목 분류"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => changeTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="card purchase-card">
        <div className="commerce-filters">
          <Field label="검색">
            <input
              type="search"
              placeholder={
                tab === "orders" ? "거래처, 품목, 발주 메모" : "이름으로 검색"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(50);
              }}
            />
          </Field>
          {tab === "orders" ? (
            <>
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
                      {s.active ? "" : " · 미사용"}
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
            </>
          ) : (
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
          )}
        </div>
        {tab === "orders" ? (
          <>
            <p className="help">
              수량을 일부만 받았다면 ‘대기 · 부분 입고’로 표시합니다. 배송완료는
              해당 품목의 발주 수량을 모두 입고하면 자동으로 반영됩니다.
            </p>
            {rows.length ? (
              <div className="table-wrap">
                <table className="table commerce-table commerce-mobile-cards">
                  <thead>
                    <tr>
                      {[
                        "발주일 / 거래처",
                        "품목",
                        "수량 / 입고",
                        "제품 총 금액",
                        "납품 예정일",
                        "배송 / 지급",
                        "관리",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, limit).map(({ o, l, state }) => (
                      <tr key={l.id}>
                        <td data-label="발주일 / 거래처">
                          <strong>{o.supplierName}</strong>
                          <span className="commerce-secondary">
                            {o.date} · {o.id.slice(0, 8)}
                          </span>
                        </td>
                        <td data-label="품목">
                          {l.itemName}
                          <span className="commerce-secondary">
                            1개 = {quantity(l.packSize)}
                            {l.unit}
                          </span>
                        </td>
                        <td data-label="수량 / 입고">
                          {l.quantity}개 발주
                          <span className="commerce-secondary">
                            {received(l, receipts)}개 입고 · 잔량{" "}
                            {l.quantity - received(l, receipts)}개
                          </span>
                        </td>
                        <td data-label="제품 총 금액">
                          <Money value={l.quantity * l.unitCost} />
                          <span className="commerce-secondary">
                            개당 <Money value={l.unitCost} />
                          </span>
                        </td>
                        <td data-label="납품 예정일">
                          {o.deliveryDate || "미정"}
                        </td>
                        <td data-label="배송 / 지급">
                          <Badge tone={tone(state)}>{labels[state]}</Badge>
                          {state === "waiting" && received(l, receipts) > 0 && (
                            <span className="commerce-secondary">
                              부분 입고
                            </span>
                          )}
                          <span className="commerce-secondary">
                            {o.paid ? "대금 지급 완료" : "대금 미지급"}
                          </span>
                        </td>
                        <td>
                          <Button
                            aria-label={`${o.supplierName} ${l.itemName} 발주 상세`}
                            onClick={() =>
                              setDialog({ kind: "detail", id: o.id })
                            }
                          >
                            상세 · 입고
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="7">
                        조회한 품목 {rows.length}건 · 총 금액{" "}
                        <Money
                          value={rows.reduce(
                            (s, { o, l }) =>
                              s + (o.cancelled ? 0 : l.quantity * l.unitCost),
                            0,
                          )}
                        />{" "}
                        <span className="help">취소 제외</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <EmptyState
                title="조회할 발주가 없습니다"
                description="거래처와 품목을 등록한 다음 필요한 품목을 체크해서 발주하세요."
              />
            )}
            {rows.length > limit && (
              <Button onClick={() => setLimit((v) => v + 50)}>
                발주 더 보기
              </Button>
            )}
          </>
        ) : (
          <>
            {tab === "categories" && (
              <p className="help">
                품목을 묶어 조회하는 분류입니다. 시술 재료·판매 상품 용도는
                품목에서 별도로 선택합니다. 미사용 분류는 새 품목에 선택할 수
                없습니다.
              </p>
            )}
            {masters.length ? (
              <div className="table-wrap">
                <table className="table">
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
                              {s.contact || "—"}
                              <span className="commerce-secondary">
                                {s.phone || "—"}
                              </span>
                            </td>
                            <td>{s.note || "—"}</td>
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
                              aria-label={`${s.name} 수정`}
                              onClick={() =>
                                setDialog({
                                  kind:
                                    tab === "suppliers"
                                      ? "supplier"
                                      : "category",
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
                title="조회 결과가 없습니다"
                description="사용 상태와 검색 조건을 확인하거나 새로 등록하세요."
              />
            )}
          </>
        )}
      </section>
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
      {dialog?.kind === "detail" && current && (
        <OrderDetail
          order={current}
          receipts={receipts}
          canManage={canManage}
          onClose={() => setDialog(null)}
          onAction={(kind, receiptId) =>
            setDialog({ kind, id: current.id, receiptId })
          }
        />
      )}
      {["receive", "ship", "cancel", "payment", "receiptCancel"].includes(
        dialog?.kind,
      ) &&
        current && (
          <OrderAction
            kind={dialog.kind}
            order={current}
            receiptId={dialog.receiptId}
            receipts={receipts}
            runAction={runAction}
            onClose={() => setDialog({ kind: "detail", id: current.id })}
            onSaved={() => {
              setDialog({ kind: "detail", id: current.id });
              notify("발주 내역에 반영했습니다.");
            }}
          />
        )}
    </>
  );
}
function MasterForm({ kind, initial, runAction, onClose, onSaved }) {
  const [form, setForm] = useState(
    initial || { name: "", contact: "", phone: "", note: "", active: true },
  );
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  return (
    <Modal
      title={`${kind === "supplier" ? "거래처" : "품목 분류"} ${initial ? "수정" : "등록"}`}
      dirty={dirty}
      onClose={busy ? undefined : onClose}
      footer={
        <Button
          type="submit"
          form="purchase-master"
          variant="primary"
          busy={busy}
        >
          저장
        </Button>
      }
    >
      <form id="purchase-master" onSubmit={submit}>
        <fieldset className="stack commerce-fieldset" disabled={busy}>
          {error && (
            <div role="alert" className="alert alert-danger">
              {error}
            </div>
          )}
          <Field label={kind === "supplier" ? "거래처 이름" : "분류 이름"}>
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          {kind === "supplier" && (
            <>
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
                  maxLength={30}
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                />
              </Field>
              <Field label="거래처 메모">
                <textarea
                  maxLength={500}
                  value={form.note}
                  onChange={(e) => update("note", e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="사용 상태">
            <select
              value={String(form.active)}
              onChange={(e) => update("active", e.target.value === "true")}
            >
              <option value="true">사용</option>
              <option value="false">미사용</option>
            </select>
          </Field>
          <p className="help">
            미사용으로 바꿔도 기존 품목과 발주 이력은 보관됩니다.
          </p>
        </fieldset>
      </form>
    </Modal>
  );
}
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
    [onlyLow, setOnlyLow] = useState(false);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = (key, v) => {
    setForm((f) => ({ ...f, [key]: v }));
    setDirty(true);
  };
  const items = data.items
    .filter((i) => i.active !== false)
    .sort(
      (a, b) =>
        Number(b.supplierId === form.supplierId) -
        Number(a.supplierId === form.supplierId),
    );
  const shown = items.filter(
    (i) =>
      (!category ||
        (i.categoryId ||
          (i.kind === "판매 상품" ? "cat-sale" : "cat-service")) ===
          category) &&
      (!onlyLow || i.qty <= i.min) &&
      i.name.toLowerCase().includes(search.toLowerCase()),
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
      title="간편 발주 등록"
      size="wide"
      dirty={dirty}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <span>
            {Object.keys(selected).length}개 품목 · 총 금액{" "}
            <Money value={amount} />
          </span>
          <Button
            type="submit"
            form="purchase-new"
            variant="primary"
            busy={busy}
            disabled={!Object.keys(selected).length}
          >
            발주 등록
          </Button>
        </>
      }
    >
      <form id="purchase-new" onSubmit={submit}>
        <fieldset className="stack commerce-fieldset" disabled={busy}>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <p className="help">
            거래처를 선택한 뒤 필요한 품목을 체크하세요. 기본 거래처가 일치하는
            품목이 먼저 표시됩니다. 발주만 등록하면 재고는 늘어나지 않습니다.
          </p>
          <div className="commerce-form-grid">
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
              ‘거래처’ 탭에서 사용 중인 거래처를 먼저 등록하세요.
            </div>
          )}
          {form.supplierId && (
            <>
              <div className="commerce-form-grid">
                <Field label="발주 품목 검색">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </Field>
                <Field label="품목 분류">
                  <select
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
                </Field>
              </div>
              <label className="commerce-check">
                <input
                  type="checkbox"
                  checked={onlyLow}
                  onChange={(e) => setOnlyLow(e.target.checked)}
                />
                보충이 필요한 품목만 보기
              </label>
              <div className="purchase-items">
                {shown.map((i) => (
                  <div
                    className={`purchase-pick ${selected[i.id] ? "is-selected" : ""}`}
                    key={i.id}
                  >
                    <label className="commerce-check">
                      <input
                        type="checkbox"
                        aria-label={`${i.name} 발주 선택`}
                        checked={!!selected[i.id]}
                        onChange={(e) => toggle(i, e.target.checked)}
                      />
                      <span>
                        <strong>{i.name}</strong>
                        <span className="commerce-secondary">
                          1개 = {quantity(i.packSize || 1)}
                          {i.unit} · 현재 {quantity(i.qty)}
                          {i.unit}
                        </span>
                      </span>
                    </label>
                    {selected[i.id] && (
                      <div className="commerce-form-grid">
                        <Field label={`${i.name} 발주 개수`}>
                          <input
                            required
                            type="number"
                            min="1"
                            max="1000000"
                            step="1"
                            value={selected[i.id].quantity}
                            onChange={(e) =>
                              changeLine(i.id, "quantity", e.target.value)
                            }
                          />
                        </Field>
                        <Field label={`${i.name} 개당 금액 (원)`}>
                          <input
                            required
                            type="number"
                            min="0"
                            max="1000000000"
                            step="1"
                            value={selected[i.id].unitCost}
                            onChange={(e) =>
                              changeLine(i.id, "unitCost", e.target.value)
                            }
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                ))}
                {!shown.length && (
                  <p className="help">
                    조건에 맞는 품목이 없습니다. 재고 · 품목 관리에서 품목의
                    사용 상태와 기본 거래처를 확인하세요.
                  </p>
                )}
              </div>
              {Object.keys(selected).some(
                (id) => !shown.some((i) => i.id === id),
              ) && (
                <div className="alert">
                  검색 조건 밖에도 선택한 품목이 있습니다.{" "}
                  <Button
                    onClick={() => {
                      setSearch("");
                      setCategory("");
                      setOnlyLow(false);
                    }}
                  >
                    선택 품목 확인
                  </Button>
                </div>
              )}
            </>
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
    </Modal>
  );
}
function OrderDetail({ order: o, receipts, canManage, onClose, onAction }) {
  const state = status(o, receipts),
    history = receipts.filter((r) => r.orderId === o.id);
  return (
    <Modal
      title="발주 상세"
      size="wide"
      onClose={onClose}
      footer={
        <>
          {!o.cancelled && state !== "delivered" && (
            <Button variant="primary" onClick={() => onAction("receive")}>
              입고 수량 입력
            </Button>
          )}
          {canManage && !o.cancelled && (
            <>
              <Button onClick={() => onAction("payment")}>
                {o.paid ? "지급 기록 정정" : "대금 지급 기록"}
              </Button>
              {!o.shipped && state !== "delivered" && (
                <Button onClick={() => onAction("ship")}>배송 시작 기록</Button>
              )}
              {!o.paid && !o.lines.some((l) => received(l, receipts) > 0) && (
                <Button variant="danger" onClick={() => onAction("cancel")}>
                  발주 취소
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="purchase-detail-summary">
          <h3>{o.supplierName}</h3>
          <Badge tone={tone(state)}>{labels[state]}</Badge>
          <span>
            {o.paid ? `대금 지급 완료 · ${o.paidDate}` : "대금 미지급"}
          </span>
        </div>
        <p>
          발주일 {o.date} · 납품 예정 {o.deliveryDate || "미정"} · 등록자{" "}
          {o.actorName}
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>품목 / 규격</th>
                <th>발주</th>
                <th>입고 / 미입고</th>
                <th>제품 총 금액</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.itemName}
                    <span className="commerce-secondary">
                      1개 = {quantity(l.packSize)}
                      {l.unit}
                    </span>
                  </td>
                  <td>{l.quantity}개</td>
                  <td>
                    {received(l, receipts)}개 /{" "}
                    {l.quantity - received(l, receipts)}개
                  </td>
                  <td>
                    <Money value={l.quantity * l.unitCost} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="4">
                  총 금액 <Money value={total(o)} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {o.notes && <p className="purchase-note">{o.notes}</p>}
        <h3>실제 입고 내역</h3>
        {history.length ? (
          history.map((r) => (
            <div key={r.id} className="purchase-history">
              <span>
                {r.date} ·{" "}
                {o.lines.find((l) => l.id === r.orderLineId)?.itemName}
                <strong>
                  {" "}
                  {quantity(r.qty)}
                  {o.lines.find((l) => l.id === r.orderLineId)?.unit}
                </strong>
                <span className="commerce-secondary">
                  {r.actorName} · {r.memo || "메모 없음"}
                </span>
              </span>
              {r.status === "cancelled" ? (
                <Badge>입고 취소</Badge>
              ) : (
                <Button onClick={() => onAction("receiptCancel", r.id)}>
                  이 입고 취소
                </Button>
              )}
            </div>
          ))
        ) : (
          <p className="help">
            아직 입고되지 않았습니다. 실제 받은 수량만 입력하세요.
          </p>
        )}
        <p className="help">
          잘못 입력한 입고는 취소 후 다시 등록하세요. 이미 사용한 재고로 인해
          수량이 음수가 되는 취소는 제한됩니다.
        </p>
        <details>
          <summary>발주 처리 이력</summary>
          {o.changes
            .slice()
            .reverse()
            .map((c, i) => (
              <p key={i}>
                {c.at.slice(0, 10)} · {c.actorName} · {c.action}
                {c.reason ? ` · ${c.reason}` : ""}
              </p>
            ))}
        </details>
      </div>
    </Modal>
  );
}
function OrderAction({
  kind,
  order: o,
  receiptId,
  receipts,
  runAction,
  onClose,
  onSaved,
}) {
  const [date, setDate] = useState(todayInSeoul()),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [amounts, setAmounts] = useState({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false);
  const titles = {
    receive: "발주 입고",
    ship: "배송 시작 기록",
    cancel: "발주 취소",
    payment: o.paid ? "지급 기록 정정" : "대금 지급 기록",
    receiptCancel: "발주 입고 취소",
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let p = { id: o.id };
      if (kind === "receive")
        p = {
          ...p,
          date,
          memo: reason,
          lines: Object.entries(amounts)
            .filter(([, v]) => Number(v) > 0)
            .map(([lineId, v]) => ({ lineId, quantity: Number(v) })),
        };
      if (kind === "payment")
        p = { ...p, paid: !o.paid, paidDate: date, reason, reference };
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
  return (
    <Modal
      title={titles[kind]}
      dirty={dirty}
      onClose={busy ? undefined : onClose}
      footer={
        <Button
          type="submit"
          form="purchase-operation"
          variant={
            ["cancel", "receiptCancel"].includes(kind) ? "danger" : "primary"
          }
          busy={busy}
        >
          {titles[kind]} 저장
        </Button>
      }
    >
      <form
        id="purchase-operation"
        onSubmit={submit}
        onChange={() => setDirty(true)}
      >
        <fieldset className="stack commerce-fieldset" disabled={busy}>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <p>
            <strong>{o.supplierName}</strong> · 발주 총 금액{" "}
            <Money value={total(o)} />
          </p>
          {kind === "receive" && (
            <>
              <p className="help">
                수령하지 않은 품목은 비워 두세요. 미입고 잔량보다 많이 입력할 수
                없습니다.
              </p>
              <Field label="입고일">
                <DateInput
                  required
                  min={o.date}
                  max={todayInSeoul()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              {o.lines
                .filter((l) => received(l, receipts) < l.quantity)
                .map((l) => (
                  <Field
                    key={l.id}
                    label={`${l.itemName} 이번 입고 개수`}
                    help={`미입고 ${l.quantity - received(l, receipts)}개 · 입력 시 ${quantity(Number(amounts[l.id] || 0) * l.packSize)}${l.unit} 증가`}
                  >
                    <input
                      type="number"
                      min="0"
                      max={l.quantity - received(l, receipts)}
                      step="1"
                      value={amounts[l.id] || ""}
                      placeholder="실제 받은 개수"
                      onChange={(e) =>
                        setAmounts((a) => ({ ...a, [l.id]: e.target.value }))
                      }
                    />
                  </Field>
                ))}
            </>
          )}
          {kind === "ship" && (
            <p>
              거래처에서 배송을 시작한 것을 확인한 뒤 기록하세요. 실제 재고는
              입고 수량을 입력할 때 늘어납니다.
            </p>
          )}
          {kind === "payment" && (
            <>
              <p>
                {o.paid
                  ? "ERP의 지급 기록을 미지급으로 정정합니다. 실제 이체 취소나 환불은 거래처와 별도로 처리하세요."
                  : "실제로 발주 대금 전액을 지급한 뒤 기록하세요. 이 화면에서 은행 이체가 실행되지는 않습니다."}
              </p>
              {!o.paid && (
                <Field label="대금 지급일">
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
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </>
          )}
          {kind !== "ship" && (
            <Field
              label={kind === "receive" ? "입고 메모" : "처리 사유 / 메모"}
            >
              <textarea
                required={kind !== "receive"}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
