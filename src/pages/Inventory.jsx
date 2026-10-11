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
  quantity,
  displayTime,
  matchesSearch,
} from "./commerce-utils";
import { useViewState } from "../components/ViewState";
import "./Commerce.css";

const stockStatus = (item) =>
  Number(item.qty) <= 0
    ? "품절"
    : Number(item.qty) <= Number(item.min)
      ? "보충 필요"
      : "정상";
const stockTone = (item) =>
  Number(item.qty) <= 0
    ? "danger"
    : Number(item.qty) <= Number(item.min)
      ? "warning"
      : "success";
const unitStep = (item) => (item?.unit === "개" ? "1" : ".001");

export default function Inventory({
  data,
  user,
  runAction,
  notify,
  routeContext,
  navigate,
}) {
  const canWrite = user.role !== "designer";
  const canManage = ["owner", "manager"].includes(user.role);
  const [tab, setTab] = useViewState("inventory", "tab", "stock");
  const [query, setQuery] = useViewState("inventory", "query", "");
  const [filter, setFilter] = useViewState("inventory", "filter", "active");
  const [categoryFilter, setCategoryFilter] = useViewState(
    "inventory",
    "category",
    "",
  );
  const [itemFilter, setItemFilter] = useViewState(
    "inventory",
    "itemFilter",
    "",
  );
  const [from, setFrom] = useViewState("inventory", "from", "");
  const [to, setTo] = useViewState("inventory", "to", todayInSeoul());
  const [limit, setLimit] = useState(50);
  const [dialog, setDialog] = useState(null);
  const usedContext = useRef(null);
  useEffect(() => {
    if (!routeContext || routeContext === usedContext.current) return;
    usedContext.current = routeContext;
    if (routeContext.stock === "low") {
      setTab("stock");
      setFilter("low");
      setQuery("");
    }
  }, [routeContext]);
  const items = data.items || [];
  const receipts = data.receipts || [];
  const active = items.filter((i) => i.active !== false);
  const low = active.filter((i) => Number(i.qty) <= Number(i.min));
  const empty = active.filter((i) => Number(i.qty) <= 0);
  const todayReceipts = receipts.filter(
    (r) => r.date === todayInSeoul() && r.status !== "cancelled",
  );
  const filteredItems = items
    .filter(
      (item) =>
        (filter === "all" ||
          (filter === "inactive"
            ? item.active === false
            : item.active !== false)) &&
        (!categoryFilter ||
          (item.categoryId ||
            (item.kind === "판매 상품" ? "cat-sale" : "cat-service")) ===
            categoryFilter) &&
        (filter !== "low" || Number(item.qty) <= Number(item.min)) &&
        (!query ||
          `${item.name} ${item.kind} ${item.unit}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort(
      (a, b) =>
        Number(a.qty > a.min) - Number(b.qty > b.min) ||
        a.name.localeCompare(b.name, "ko"),
    );
  const filteredReceipts = useMemo(
    () =>
      receipts
        .filter(
          (r) =>
            (!itemFilter || r.itemId === itemFilter) &&
            (!from || r.date >= from) &&
            (!to || r.date <= to) &&
            (!query ||
              [items.find((i) => i.id === r.itemId)?.name, r.memo, r.actorName]
                .join(" ")
                .toLowerCase()
                .includes(query.toLowerCase())),
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            String(b.changes?.[0]?.at || b.id).localeCompare(
              String(a.changes?.[0]?.at || a.id),
            ),
        ),
    [receipts, items, itemFilter, from, to, query],
  );
  const filteredLogs = useMemo(
    () =>
      (data.logs || [])
        .filter((log) => {
          const date = (log.dt || log.at || "").slice(0, 10);
          return (
            (!itemFilter || log.itemId === itemFilter) &&
            (!from || date >= from) &&
            (!to || date <= to) &&
            (!query ||
              [
                items.find((i) => i.id === log.itemId)?.name,
                log.reason,
                log.kind,
                log.actorName,
              ]
                .join(" ")
                .toLowerCase()
                .includes(query.toLowerCase()))
          );
        })
        .sort((a, b) =>
          String(b.at || b.dt).localeCompare(String(a.at || a.dt)),
        ),
    [data.logs, items, itemFilter, from, to, query],
  );
  const currentReceipt = dialog?.receiptId
    ? receipts.find((r) => r.id === dialog.receiptId)
    : null;
  const currentItem = dialog?.itemId
    ? items.find((i) => i.id === dialog.itemId)
    : currentReceipt
      ? items.find((i) => i.id === currentReceipt.itemId)
      : null;
  const saved = (message) => {
    setDialog(null);
    notify(message);
  };
  const switchTab = (value) => {
    setTab(value);
    setQuery("");
    setLimit(50);
  };
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">재고 · 입고</h1>
          <p className="page-description">
            수동 입고와 재고 현황, 보충이 필요한 품목을 확인합니다.
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate("purchases")}>발주 · 거래처</Button>
          {canManage && (
            <Button onClick={() => navigate("settings", { tab: "services" })}>
              시술 · 재료 설정
            </Button>
          )}
          {canManage && (
            <Button
              variant="secondary"
              onClick={() => setDialog({ kind: "item" })}
            >
              품목 등록
            </Button>
          )}
          {canWrite && (
            <Button
              variant="primary"
              onClick={() => setDialog({ kind: "receipt" })}
              disabled={!active.length}
            >
              + 수동 입고
            </Button>
          )}
        </div>
      </header>
      <div className="commerce-stats">
        <div className="stat-card">
          <span className="muted">관리 중인 품목</span>
          <strong>
            {active.length}
            <small>개</small>
          </strong>
          <span className="muted">시술 재료 · 판매 상품</span>
        </div>
        <div className="stat-card">
          <span className="muted">보충이 필요한 품목</span>
          <strong>
            {low.length}
            <small>개</small>
          </strong>
          <span className="muted">현재 수량 ≤ 보충 기준</span>
        </div>
        <div className="stat-card">
          <span className="muted">품절 품목</span>
          <strong>
            {empty.length}
            <small>개</small>
          </strong>
          <span className="muted">입고 후 사용 가능</span>
        </div>
        <div className="stat-card">
          <span className="muted">오늘의 입고</span>
          <strong>
            {todayReceipts.length}
            <small>건</small>
          </strong>
          <span className="muted">취소된 입고 제외</span>
        </div>
      </div>
      {low.length > 0 && (
        <div className="alert alert-warning commerce-banner">
          <strong>보충할 품목이 {low.length}개 있습니다.</strong>
          <p>
            재고가 보충 기준과 같거나 적으면 표시됩니다. 실제 물건을 수령한 뒤
            수량을 입력하세요.
          </p>
          <div className="commerce-low-list">
            {low.slice(0, 8).map((item) => (
              <button
                key={item.id}
                onClick={() =>
                  canWrite
                    ? setDialog({ kind: "receipt", itemId: item.id })
                    : (setTab("stock"),
                      setQuery(item.name),
                      setFilter("active"))
                }
              >
                <span className="commerce-low-name">{item.name}</span>
                <span className="commerce-low-status">
                  {quantity(item.qty)} / {quantity(item.min)}
                  {item.unit}
                  {canWrite ? " · + 입고" : ""}
                </span>
              </button>
            ))}
            {low.length > 8 && (
              <button
                onClick={() => {
                  setTab("stock");
                  setFilter("low");
                  setQuery("");
                }}
              >
                보충 필요 전체 보기 ({low.length}개)
              </button>
            )}
          </div>
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="재고 조회 종류">
        <button
          className={`tab ${tab === "stock" ? "active" : ""}`}
          role="tab"
          aria-selected={tab === "stock"}
          onClick={() => switchTab("stock")}
        >
          현재 재고
        </button>
        <button
          className={`tab ${tab === "receipts" ? "active" : ""}`}
          role="tab"
          aria-selected={tab === "receipts"}
          onClick={() => switchTab("receipts")}
        >
          입고 기록<span className="commerce-tab-count">{receipts.length}</span>
        </button>
        <button
          className={`tab ${tab === "logs" ? "active" : ""}`}
          role="tab"
          aria-selected={tab === "logs"}
          onClick={() => switchTab("logs")}
        >
          재고 변동 이력
        </button>
      </div>
      <section className="card">
        <div className="card-body">
          <div className="commerce-filters">
            <div className="search-field">
              <Field label="검색">
                <input
                  type="search"
                  className="input"
                  placeholder={
                    tab === "stock"
                      ? "품목 이름, 구분"
                      : "품목 이름, 기록자, 메모"
                  }
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(50);
                  }}
                />
              </Field>
            </div>
            {tab === "stock" && (
              <Field label="품목 분류별 조회">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">전체 분류</option>
                  {(data.itemCategories || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active ? "" : " · 미사용"}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {tab === "stock" ? (
              <Field label="품목 상태">
                <select
                  className="select"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="active">사용 중인 품목</option>
                  <option value="low">보충 필요 · 품절</option>
                  <option value="inactive">중지한 품목</option>
                  <option value="all">전체 품목</option>
                </select>
              </Field>
            ) : (
              <>
                <Field label="품목">
                  <select
                    className="select"
                    value={itemFilter}
                    onChange={(e) => {
                      setItemFilter(e.target.value);
                      setLimit(50);
                    }}
                  >
                    <option value="">전체 품목</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="시작일">
                  <DateInput
                    className="input"
                    type="date"
                    max={to}
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setLimit(50);
                    }}
                  />
                </Field>
                <Field label="종료일">
                  <DateInput
                    className="input"
                    type="date"
                    min={from}
                    max={todayInSeoul()}
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setLimit(50);
                    }}
                  />
                </Field>
              </>
            )}
          </div>
          {tab === "stock" &&
            (filteredItems.length ? (
              <div className="table-wrap">
                <table className="table commerce-table commerce-mobile-cards">
                  <thead>
                    <tr>
                      <th>품목</th>
                      <th>상태</th>
                      <th className="numeric">현재 재고</th>
                      <th className="numeric">보충 기준</th>
                      <th className="numeric optional-column">판매 단가</th>
                      <th>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          <span className="commerce-secondary">
                            {data.itemCategories?.find(
                              (c) =>
                                c.id ===
                                (item.categoryId ||
                                  (item.kind === "판매 상품"
                                    ? "cat-sale"
                                    : "cat-service")),
                            )?.name || item.kind}{" "}
                            · {item.kind}
                            <span className="commerce-secondary">
                              1개 입고 = {quantity(item.packSize || 1)}
                              {item.unit}
                            </span>
                          </span>
                        </td>
                        <td data-label="상태">
                          {item.active === false ? (
                            <Badge tone="muted">사용 중지</Badge>
                          ) : (
                            <Badge tone={stockTone(item)}>
                              {stockStatus(item)}
                            </Badge>
                          )}
                        </td>
                        <td data-label="현재 재고" className="numeric">
                          <span className="commerce-stock-number">
                            {quantity(item.qty)}
                            <small>{item.unit}</small>
                          </span>
                        </td>
                        <td data-label="보충 기준" className="numeric">
                          {quantity(item.min)}
                          {item.unit}
                          {canWrite && (
                            <div>
                              <button
                                className="commerce-tag-button"
                                onClick={() =>
                                  setDialog({
                                    kind: "threshold",
                                    itemId: item.id,
                                  })
                                }
                                aria-label={`${item.name} 보충 기준 변경`}
                              >
                                변경
                              </button>
                            </div>
                          )}
                        </td>
                        <td
                          data-label="판매 단가"
                          className="numeric optional-column"
                        >
                          {item.kind === "판매 상품" ? (
                            <Money value={item.price} />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <div className="commerce-actions">
                            {canWrite && item.active !== false && (
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  setDialog({
                                    kind: "receipt",
                                    itemId: item.id,
                                  })
                                }
                                aria-label={`${item.name} 입고`}
                              >
                                입고
                              </Button>
                            )}
                            {canWrite && (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setDialog({ kind: "adjust", itemId: item.id })
                                }
                                aria-label={`${item.name} 재고 실사`}
                              >
                                실사
                              </Button>
                            )}
                            {canManage && (
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setDialog({ kind: "item", itemId: item.id })
                                }
                                aria-label={`${item.name} 품목 수정`}
                              >
                                수정
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={
                  items.length
                    ? "조건에 맞는 품목이 없습니다"
                    : "관리할 품목을 등록해 주세요"
                }
                description={
                  items.length
                    ? "검색어나 품목 상태 필터를 변경해 보세요."
                    : "시술 재료와 판매 상품을 등록한 다음 실제 재고를 입고하세요."
                }
                action={
                  canManage && (
                    <Button onClick={() => setDialog({ kind: "item" })}>
                      첫 품목 등록
                    </Button>
                  )
                }
              />
            ))}
          {tab === "receipts" &&
            (filteredReceipts.length ? (
              <>
                <div className="table-wrap">
                  <table className="table commerce-table commerce-mobile-cards">
                    <thead>
                      <tr>
                        <th>입고일 / 품목</th>
                        <th>상태</th>
                        <th className="numeric">입고 수량</th>
                        <th className="optional-mobile">기록자</th>
                        <th className="optional-column">메모</th>
                        <th>기록</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReceipts.slice(0, limit).map((r) => {
                        const item = items.find((i) => i.id === r.itemId);
                        return (
                          <tr key={r.id}>
                            <td>
                              <strong>{item?.name || "기존 품목"}</strong>
                              <span className="commerce-secondary">
                                {r.date}
                              </span>
                            </td>
                            <td data-label="상태">
                              <Badge
                                tone={
                                  r.status === "cancelled" ? "muted" : "success"
                                }
                              >
                                {r.status === "cancelled"
                                  ? "취소"
                                  : "입고 완료"}
                              </Badge>
                              {r.revision > 0 && (
                                <span className="commerce-secondary">
                                  정정 {r.revision}회
                                </span>
                              )}
                            </td>
                            <td data-label="입고 수량" className="numeric">
                              {quantity(r.qty)}
                              {item?.unit}
                            </td>
                            <td data-label="기록자" className="optional-mobile">
                              {r.actorName || "기존 기록"}
                            </td>
                            <td data-label="메모" className="optional-column">
                              {r.memo || "—"}
                            </td>
                            <td>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setDialog({
                                    kind: "receipt-detail",
                                    receiptId: r.id,
                                  })
                                }
                                aria-label={`${item?.name || "품목"} ${r.date} 입고 상세`}
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
                {filteredReceipts.length > limit && (
                  <Button
                    variant="secondary"
                    onClick={() => setLimit((n) => n + 50)}
                  >
                    더 보기 ({limit} / {filteredReceipts.length})
                  </Button>
                )}
              </>
            ) : (
              <EmptyState
                title="입고 기록이 없습니다"
                description="실제 수령한 수량을 수동 입고로 기록하면 이곳에서 확인할 수 있습니다."
              />
            ))}
          {tab === "logs" &&
            (filteredLogs.length ? (
              <>
                <div className="table-wrap">
                  <table className="table commerce-table commerce-mobile-cards">
                    <thead>
                      <tr>
                        <th>품목 / 변동 시각</th>
                        <th>유형</th>
                        <th className="numeric">변동량</th>
                        <th className="numeric">변동 후 재고</th>
                        <th className="optional-mobile">기록자</th>
                        <th>사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.slice(0, limit).map((log) => {
                        const item = items.find((i) => i.id === log.itemId);
                        return (
                          <tr key={log.id}>
                            <td>
                              <strong>{item?.name || "기존 품목"}</strong>
                              <span className="commerce-secondary">
                                {log.at ? displayTime(log.at) : log.dt}
                              </span>
                            </td>
                            <td data-label="유형">
                              <Badge
                                tone={
                                  log.delta > 0
                                    ? "success"
                                    : log.delta < 0
                                      ? "warning"
                                      : "muted"
                                }
                              >
                                {log.kind}
                              </Badge>
                            </td>
                            <td data-label="변동량" className="numeric">
                              {Number(log.delta) > 0 ? "+" : ""}
                              {quantity(log.delta)}
                              {item?.unit}
                            </td>
                            <td data-label="변동 후 재고" className="numeric">
                              {log.after == null
                                ? "—"
                                : `${quantity(log.after)}${item?.unit || ""}`}
                            </td>
                            <td data-label="기록자" className="optional-mobile">
                              {log.actorName || "기존 기록"}
                            </td>
                            <td data-label="사유">
                              {log.beforeMin != null && (
                                <span className="commerce-secondary">
                                  보충 기준 {quantity(log.beforeMin)} →{" "}
                                  {quantity(log.afterMin)}
                                  {item?.unit}
                                </span>
                              )}
                              {log.reason || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredLogs.length > limit && (
                  <Button
                    variant="secondary"
                    onClick={() => setLimit((n) => n + 50)}
                  >
                    더 보기 ({limit} / {filteredLogs.length})
                  </Button>
                )}
              </>
            ) : (
              <EmptyState
                title="재고 변동 이력이 없습니다"
                description="입고, 판매, 시술 사용, 실사 조정, 보충 기준 변경을 시간순으로 확인할 수 있습니다."
              />
            ))}
        </div>
      </section>
      {dialog?.kind === "item" && (
        <ItemForm
          data={data}
          item={currentItem}
          runAction={runAction}
          onClose={() => setDialog(null)}
          onSaved={() =>
            saved(
              currentItem
                ? "품목 정보를 수정했습니다."
                : "품목을 등록했습니다. 실제 수령 수량을 입고해 주세요.",
            )
          }
        />
      )}
      {dialog?.kind === "receipt" && (
        <ReceiptForm
          items={items}
          initialItem={currentItem}
          runAction={runAction}
          onClose={() => setDialog(null)}
          onSaved={() => saved("입고 수량을 기록했습니다.")}
        />
      )}
      {["threshold", "adjust"].includes(dialog?.kind) && currentItem && (
        <StockForm
          item={currentItem}
          kind={dialog.kind}
          runAction={runAction}
          onClose={() => setDialog(null)}
          onSaved={() =>
            saved(
              dialog.kind === "threshold"
                ? "보충 기준을 변경했습니다."
                : "실사 재고를 반영했습니다.",
            )
          }
        />
      )}
      {dialog?.kind === "receipt-detail" && currentReceipt && (
        <ReceiptDetail
          receipt={currentReceipt}
          item={currentItem}
          canWrite={canWrite && !currentReceipt.orderId}
          onClose={() => setDialog(null)}
          onCorrect={() =>
            setDialog({ kind: "correct", receiptId: currentReceipt.id })
          }
          onCancel={() =>
            setDialog({ kind: "cancel", receiptId: currentReceipt.id })
          }
        />
      )}
      {["correct", "cancel"].includes(dialog?.kind) && currentReceipt && (
        <ReceiptChangeForm
          kind={dialog.kind}
          receipt={currentReceipt}
          item={currentItem}
          runAction={runAction}
          onClose={() =>
            setDialog({ kind: "receipt-detail", receiptId: currentReceipt.id })
          }
          onSaved={() =>
            saved(
              dialog.kind === "cancel"
                ? "입고를 취소했습니다."
                : "입고 수량을 정정했습니다.",
            )
          }
        />
      )}
    </>
  );
}

function ItemForm({ data, item, runAction, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: item?.name || "",
    categoryId:
      item?.categoryId ||
      (item?.kind === "판매 상품" ? "cat-sale" : "cat-service"),
    supplierId: item?.supplierId || "",
    packSize: String(item?.packSize || 1),
    purchasePrice: String(item?.purchasePrice || 0),
    kind: item?.kind || "시술 재료",
    unit: item?.unit || "개",
    min: String(item?.min || 0),
    price: String(item?.price || 0),
    active: item?.active !== false,
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
      await runAction("inventory.item", {
        ...form,
        ...(item ? { id: item.id } : {}),
        packSize: Number(form.packSize),
        purchasePrice: Number(form.purchasePrice),
        min: Number(form.min),
        price: Number(form.price),
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
      title={item ? "품목 수정" : "새 품목 등록"}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button
            variant="primary"
            type="submit"
            form="inventory-item"
            busy={busy}
          >
            {item ? "변경 저장" : "품목 등록"}
          </Button>
        </>
      }
    >
      <form id="inventory-item" onSubmit={submit} className="stack">
        <fieldset disabled={busy} className="commerce-fieldset">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <Field label="품목 이름">
            <input
              className="input"
              required
              autoFocus
              maxLength={100}
              placeholder="예: 프리미엄 샴푸 500ml"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <div className="commerce-form-grid">
            <Field label="품목 분류">
              <select
                required
                value={form.categoryId}
                onChange={(e) => update("categoryId", e.target.value)}
              >
                {(data.itemCategories || [])
                  .filter((c) => c.active || c.id === form.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.active ? "" : " · 미사용"}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="기본 거래처">
              <select
                value={form.supplierId}
                onChange={(e) => update("supplierId", e.target.value)}
              >
                <option value="">미지정</option>
                {(data.suppliers || [])
                  .filter((s) => s.active || s.id === form.supplierId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.active ? "" : " · 미사용"}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="품목 구분">
              <select
                className="select"
                value={form.kind}
                onChange={(e) => update("kind", e.target.value)}
              >
                <option>시술 재료</option>
                <option>판매 상품</option>
              </select>
            </Field>
            <Field
              label="관리 단위"
              help={
                item
                  ? "기존 재고 기록의 정확성을 위해 단위를 유지합니다."
                  : "g·ml은 소수점 셋째 자리까지 기록할 수 있습니다."
              }
            >
              <select
                className="select"
                disabled={!!item}
                value={form.unit}
                onChange={(e) => {
                  update("unit", e.target.value);
                  if (e.target.value === "개") update("packSize", "1");
                }}
              >
                <option>개</option>
                <option>g</option>
                <option>ml</option>
              </select>
            </Field>
            <Field
              label={`1개당 용량 (${form.unit})`}
              help="예: 500ml 제품은 500 입력. 3개 입고하면 1,500ml로 반영됩니다."
            >
              <input
                required
                type="number"
                min={unitStep(form)}
                max="1000000000"
                step={unitStep(form)}
                disabled={form.unit === "개"}
                value={form.packSize}
                onChange={(e) => update("packSize", e.target.value)}
              />
            </Field>
            <Field
              label="1개 입고 단가 (원)"
              help="발주 금액 계산에 사용하며, 발주할 때 수정할 수 있습니다."
            >
              <input
                required
                type="number"
                min="0"
                max="1000000000"
                step="1"
                value={form.purchasePrice}
                onChange={(e) => update("purchasePrice", e.target.value)}
              />
            </Field>
            <Field
              label={`보충 기준 (${form.unit})`}
              help="현재 재고가 이 수량 이하이면 보충이 표시됩니다."
            >
              <input
                className="input"
                type="number"
                required
                min="0"
                max="1000000000"
                step={unitStep(form)}
                value={form.min}
                onChange={(e) => update("min", e.target.value)}
              />
            </Field>
            <Field
              label="판매 단가 (원)"
              help={
                form.kind === "시술 재료"
                  ? "시술 재료는 판매 수납 목록에 표시되지 않습니다."
                  : "관리 단위 1개·1g·1ml당 판매 금액입니다."
              }
            >
              <input
                className="input"
                type="number"
                required
                min="0"
                step="1"
                value={form.price}
                onChange={(e) => update("price", e.target.value)}
              />
            </Field>
          </div>
          {item && (
            <label className="commerce-check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => update("active", e.target.checked)}
              />
              <span>
                사용 중인 품목으로 표시합니다. 사용을 중지해도 기존 입고·판매
                기록은 유지됩니다.
              </span>
            </label>
          )}
          <p className="commerce-note">
            {item
              ? `현재 재고 ${quantity(item.qty)}${item.unit}. 실제 수량은 입고 또는 실사에서 변경합니다.`
              : "새 품목의 재고는 0으로 시작합니다. 등록 후 실제 수령한 수량을 입고하세요."}
          </p>
        </fieldset>
      </form>
    </Modal>
  );
}

function ReceiptForm({ items, initialItem, runAction, onClose, onSaved }) {
  const [form, setForm] = useState({
    itemId: initialItem?.id || "",
    packageMode: (initialItem?.packSize || 1) > 1,
    qty: "",
    date: todayInSeoul(),
    memo: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const searchRef = useRef(null);
  const focusNext = useRef(false);
  useEffect(() => {
    if (!busy && focusNext.current) {
      focusNext.current = false;
      searchRef.current?.focus();
    }
  }, [busy]);
  const item = items.find((i) => i.id === form.itemId);
  const update = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const keepOpen = e.nativeEvent.submitter?.value === "continue";
    setBusy(true);
    setError("");
    try {
      await runAction("inventory.receipt", {
        ...form,
        qty: Number(form.qty),
        ...(form.packageMode ? { packQty: Number(form.qty) } : {}),
      });
      if (keepOpen) {
        setSavedMessage(
          `${item?.name || "품목"} ${quantity(form.qty)}${form.packageMode ? "개" : item?.unit || ""} 입고를 저장했습니다. 다음 품목을 선택하세요.`,
        );
        setForm((current) => ({ ...current, itemId: "", qty: "" }));
        setItemQuery("");
        setDirty(false);
        focusNext.current = true;
      } else onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="수동 입고"
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button
            variant="secondary"
            type="submit"
            form="inventory-receipt"
            value="continue"
            disabled={busy}
          >
            입고 저장 후 다음 품목
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="inventory-receipt"
            busy={busy}
          >
            입고 저장
          </Button>
        </>
      }
    >
      <form id="inventory-receipt" onSubmit={submit} className="stack">
        <fieldset disabled={busy} className="commerce-fieldset">
          <p className="commerce-note">
            매장에 실제 도착한 물건의 수량을 입력하세요. 저장하면 현재 재고에
            더해지고 로그인한 직원이 기록자로 남습니다.
          </p>
          <p className="commerce-note">
            여러 품목을 받았다면 ‘입고 저장 후 다음 품목’을 사용하세요. 입고일과
            메모는 유지되고 품목·수량은 비워집니다.
          </p>
          {savedMessage && (
            <div className="alert alert-success" role="status">
              {savedMessage}
            </div>
          )}
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <Field label="입고 품목 검색">
            <input
              className="input"
              type="search"
              ref={searchRef}
              value={itemQuery}
              placeholder="품목 이름으로 검색"
              onChange={(e) => setItemQuery(e.target.value)}
            />
          </Field>
          <Field
            label="입고 품목"
            help="검색어를 바꿔도 선택한 품목은 유지됩니다. 입고할 품목과 단위를 확인하세요."
          >
            <select
              className="select"
              required
              value={form.itemId}
              onChange={(e) => {
                update("itemId", e.target.value);
                update(
                  "packageMode",
                  (items.find((i) => i.id === e.target.value)?.packSize || 1) >
                    1,
                );
                update("qty", "");
              }}
            >
              <option value="">품목을 선택하세요</option>
              {items
                .filter(
                  (i) =>
                    i.active !== false &&
                    (i.id === form.itemId ||
                      matchesSearch(itemQuery, [i.name, i.kind, i.unit])),
                )
                .map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.name} · 현재 {quantity(i.qty)}
                    {i.unit}
                  </option>
                ))}
            </select>
          </Field>
          {itemQuery &&
            !items.some(
              (i) =>
                i.active !== false &&
                matchesSearch(itemQuery, [i.name, i.kind, i.unit]),
            ) && (
              <p className="commerce-note" role="status">
                검색에 맞는 품목이 없습니다. 검색어를 지우거나 품목 등록 여부를
                확인하세요.
              </p>
            )}
          {item && item.unit !== "개" && (
            <Field label="입고 입력 방식">
              <select
                value={form.packageMode ? "package" : "volume"}
                onChange={(e) => {
                  update("packageMode", e.target.value === "package");
                  update("qty", "");
                }}
              >
                <option value="package">
                  개수로 입력 (1개 = {quantity(item.packSize || 1)}
                  {item.unit})
                </option>
                <option value="volume">
                  총 용량으로 직접 입력 ({item.unit})
                </option>
              </select>
            </Field>
          )}
          <div className="commerce-form-grid">
            <Field
              label={`추가할 수량${item ? ` (${form.packageMode ? "개" : item.unit})` : ""}`}
            >
              <input
                className="input"
                type="number"
                inputMode="decimal"
                required
                min={form.packageMode ? "1" : unitStep(item)}
                max="1000000000"
                step={form.packageMode ? "1" : unitStep(item)}
                value={form.qty}
                placeholder="이번에 받은 수량"
                onChange={(e) => update("qty", e.target.value)}
              />
            </Field>
            <Field label="입고일">
              <DateInput
                className="input"
                type="date"
                required
                max={todayInSeoul()}
                value={form.date}
                onChange={(e) => update("date", e.target.value)}
              />
            </Field>
          </div>
          {item && (
            <div className="alert">
              현재 {quantity(item.qty)}
              {item.unit} + 입고{" "}
              {quantity(
                Number(form.qty) * (form.packageMode ? item.packSize || 1 : 1),
              )}
              {item.unit} →{" "}
              <strong>
                저장 후{" "}
                {quantity(
                  Number(item.qty) +
                    Number(form.qty || 0) *
                      (form.packageMode ? item.packSize || 1 : 1),
                )}
                {item.unit}
              </strong>
            </div>
          )}
          <Field label="메모 (선택)">
            <textarea
              className="textarea"
              maxLength={1000}
              placeholder="예: 공급업체, 거래명세표 번호, 검수 내용"
              value={form.memo}
              onChange={(e) => update("memo", e.target.value)}
            />
          </Field>
        </fieldset>
      </form>
    </Modal>
  );
}

function StockForm({ item, kind, runAction, onClose, onSaved }) {
  const isAdjust = kind === "adjust";
  const [qty, setQty] = useState(String(isAdjust ? item.qty : item.min));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction(`inventory.${kind}`, {
        itemId: item.id,
        qty: Number(qty),
        ...(isAdjust ? { reason } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const delta = Number(qty || 0) - Number(item.qty);
  return (
    <Modal
      title={isAdjust ? "재고 실사 조정" : "보충 기준 변경"}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button
            variant="primary"
            type="submit"
            form="inventory-stock"
            busy={busy}
          >
            변경 저장
          </Button>
        </>
      }
    >
      <form id="inventory-stock" onSubmit={submit} className="stack">
        <fieldset disabled={busy} className="commerce-fieldset">
          <h3>{item.name}</h3>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <p className="commerce-note">
            {isAdjust
              ? `전산 재고는 ${quantity(item.qty)}${item.unit}입니다. 선반·창고를 확인한 실제 총수량을 입력하세요. 차이만 재고에 반영합니다.`
              : `현재 보충 기준은 ${quantity(item.min)}${item.unit}입니다. 현재 재고가 기준과 같거나 적으면 보충 필요로 표시됩니다.`}
          </p>
          <Field
            label={`${isAdjust ? "실제로 남아 있는 총수량" : "새 보충 기준"} (${item.unit})`}
          >
            <input
              className="input"
              type="number"
              inputMode="decimal"
              required
              min="0"
              max="1000000000"
              step={unitStep(item)}
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          {isAdjust && (
            <>
              <div className="alert">
                조정 수량{" "}
                <strong>
                  {delta > 0 ? "+" : ""}
                  {quantity(delta)}
                  {item.unit}
                </strong>{" "}
                · 조정 후 {quantity(qty)}
                {item.unit}
              </div>
              <Field label="조정 사유 (필수)">
                <textarea
                  className="textarea"
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="예: 월말 실사, 파손·폐기 확인"
                />
              </Field>
            </>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

function ReceiptDetail({
  receipt,
  item,
  canWrite,
  onClose,
  onCorrect,
  onCancel,
}) {
  return (
    <Modal
      title="입고 상세"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          {canWrite && receipt.status !== "cancelled" && (
            <>
              <Button variant="secondary" onClick={onCorrect}>
                수량 정정
              </Button>
              <Button variant="danger" onClick={onCancel}>
                입고 취소
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="commerce-detail-top">
        <div>
          <h3>{item?.name || "기존 품목"}</h3>
          <strong>
            {quantity(receipt.qty)}
            {item?.unit}
          </strong>
        </div>
        <Badge tone={receipt.status === "cancelled" ? "muted" : "success"}>
          {receipt.status === "cancelled" ? "취소된 입고" : "입고 완료"}
        </Badge>
      </div>
      <dl className="commerce-definition">
        <dt>입고일</dt>
        <dd>{receipt.date}</dd>
        <dt>최초 기록자</dt>
        <dd>{receipt.actorName || "기존 기록"}</dd>
        <dt>입고 번호</dt>
        <dd>{receipt.id}</dd>
        <dt>현재 재고</dt>
        <dd>
          {quantity(item?.qty)}
          {item?.unit}
        </dd>
        <dt>메모</dt>
        <dd className="commerce-prewrap">{receipt.memo || "없음"}</dd>
      </dl>
      {receipt.orderId && (
        <p className="alert">
          발주에 연결된 입고입니다. 발주 · 거래처의 발주 상세에서 입고 취소 및
          재등록을 할 수 있습니다.
        </p>
      )}
      <h3 className="commerce-section-title">입고 · 정정 이력</h3>
      <ul className="commerce-timeline">
        {(receipt.changes || []).map((change, index) => (
          <li key={index}>
            <strong>
              {change.kind} · {change.actorName || "기존 기록"}
            </strong>
            <span className="commerce-secondary">{displayTime(change.at)}</span>
            <p>
              기록 수량 {quantity(change.beforeQty)} →{" "}
              {quantity(change.afterQty)}
              {item?.unit}
              {change.delta != null &&
                ` · 재고 ${change.delta > 0 ? "+" : ""}${quantity(change.delta)}${item?.unit || ""}`}
            </p>
            {change.reason && <p>{change.reason}</p>}
          </li>
        ))}
      </ul>
      <p className="commerce-note">
        수량 정정은 기존 기록과의 차이만 반영합니다. 이미 사용한 수량 때문에
        재고가 음수가 되면 정정·취소할 수 없습니다.
      </p>
    </Modal>
  );
}

function ReceiptChangeForm({
  kind,
  receipt,
  item,
  runAction,
  onClose,
  onSaved,
}) {
  const cancel = kind === "cancel";
  const [qty, setQty] = useState(String(receipt.qty));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const originalRevision = useState(receipt.revision || 0)[0];
  const afterStock =
    Number(item?.qty || 0) +
    (cancel ? -Number(receipt.qty) : Number(qty || 0) - Number(receipt.qty));
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction(`inventory.${kind}`, {
        receiptId: receipt.id,
        expectedRevision: originalRevision,
        reason,
        ...(cancel ? {} : { qty: Number(qty) }),
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
      title={cancel ? "입고 취소" : "입고 수량 정정"}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button
            variant={cancel ? "danger" : "primary"}
            type="submit"
            form="receipt-change"
            busy={busy}
            disabled={afterStock < 0}
          >
            {cancel ? "입고 취소 저장" : "정정 저장"}
          </Button>
        </>
      }
    >
      <form id="receipt-change" onSubmit={submit} className="stack">
        <fieldset disabled={busy} className="commerce-fieldset">
          <h3>
            {item?.name || "기존 품목"} · {receipt.date}
          </h3>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="alert alert-warning">
            {cancel
              ? `기록된 입고 ${quantity(receipt.qty)}${item?.unit || ""}를 취소하고 현재 재고에서 차감합니다. 취소 이력은 보관됩니다.`
              : `현재 입고 기록은 ${quantity(receipt.qty)}${item?.unit || ""}입니다. 추가 수량이 아닌 올바른 입고 총수량을 입력해 주세요.`}
          </div>
          {!cancel && (
            <Field label={`정정할 입고 총수량 (${item?.unit || "개"})`}>
              <input
                className="input"
                required
                type="number"
                inputMode="decimal"
                min={unitStep(item)}
                max="1000000000"
                step={unitStep(item)}
                value={qty}
                onChange={(e) => {
                  setQty(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
          )}
          <p className="commerce-note">
            현재 재고 {quantity(item?.qty)}
            {item?.unit} → 처리 후 {quantity(afterStock)}
            {item?.unit}
          </p>
          {afterStock < 0 && (
            <div className="alert alert-danger" role="alert">
              이미 사용한 수량 때문에 재고가 음수가 됩니다. 실제 재고와 입고
              기록을 다시 확인해 주세요.
            </div>
          )}
          {(receipt.revision || 0) !== originalRevision && (
            <div className="alert alert-warning">
              다른 직원이 이 기록을 변경했습니다. 창을 닫고 최신 기록을 다시
              확인해 주세요.
            </div>
          )}
          <Field label={`${cancel ? "취소" : "정정"} 사유 (필수)`}>
            <textarea
              className="textarea"
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setDirty(true);
              }}
              placeholder={
                cancel
                  ? "예: 중복 입고 기록 확인"
                  : "예: 거래명세표 확인 후 수량 오입력 정정"
              }
            />
          </Field>
        </fieldset>
      </form>
    </Modal>
  );
}
