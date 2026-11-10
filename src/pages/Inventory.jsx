import { DateInput } from "../components/DateInput.jsx";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Button,
  Modal,
  Field,
  Badge,
  EmptyState,
  Money,
  ConfirmDialog,
} from "../components/ui";
import Icon from "../components/Icon";
import {
  todayInSeoul,
  quantity,
  displayTime,
  matchesSearch,
} from "./commerce-utils";
import { useViewState } from "../components/ViewState";
import "./Commerce.css";
import "./Inventory.css";
import "./InventoryBoards.css";

// Signed amount with a real minus sign, e.g. "−50ml", "+800g".
const signed = (value, unit = "") =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${quantity(Math.abs(value))}${unit}`;
// Korean particles after a quantity with a unit ("400ml가", "500g이", "3개를").
const hasFinal = (text) => {
  const last = String(text).slice(-1);
  if (/[gm]/i.test(last)) return true;
  if (/[a-z]/i.test(last)) return false;
  if (/\d/.test(last)) return "013678".includes(last);
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
};
const subject = (text) => `${text}${hasFinal(text) ? "이" : "가"}`;
const object = (text) => `${text}${hasFinal(text) ? "을" : "를"}`;
const copula = (text) => `${text}${hasFinal(text) ? "이에요" : "예요"}`;
const isLow = (item) => Number(item.qty) <= Number(item.min);
const stockStatus = (item) =>
  Number(item.qty) <= 0 ? "품절" : isLow(item) ? "보충 필요" : "정상";
const stockTone = (item) =>
  Number(item.qty) <= 0 ? "danger" : isLow(item) ? "warning" : "success";
const unitStep = (item) => (item?.unit === "개" ? "1" : ".001");
const categoryOf = (item) =>
  item.categoryId || (item.kind === "판매 상품" ? "cat-sale" : "cat-service");
// Bar length: twice the refill threshold reads as a full shelf.
const stockPercent = (item) => {
  const qty = Number(item.qty) || 0;
  const min = Number(item.min) || 0;
  if (qty <= 0) return 0;
  if (min <= 0) return 100;
  return Math.max(4, Math.min(100, Math.round((qty / (min * 2)) * 100)));
};
// Monday of the week containing an ISO date (YYYY-MM-DD).
const weekStart = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};
const STOCK_FILTERS = [
  ["active", "전체"],
  ["low", "보충 필요"],
  ["service", "시술 재료"],
  ["sale", "판매 상품"],
  ["inactive", "사용 중지"],
];

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
  const searchRef = useRef(null);
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
  const today = todayInSeoul();
  const items = data.items || [];
  const receipts = data.receipts || [];
  const categories = data.itemCategories || [];
  const active = items.filter((i) => i.active !== false);
  const low = active.filter(isLow);
  const empty = active.filter((i) => Number(i.qty) <= 0);
  const thisWeek = weekStart(today);
  const weekReceipts = receipts.filter(
    (r) => r.status !== "cancelled" && r.date >= thisWeek && r.date <= today,
  );
  const pendingRequests = (data.purchaseRequests || []).filter(
    (entry) => entry.status === "requested",
  );
  const requested = new Set(pendingRequests.map((entry) => entry.itemId));
  const categoryName = (item) =>
    categories.find((c) => c.id === categoryOf(item))?.name || item.kind;
  const filteredItems = items
    .filter((item) => {
      const inactive = item.active === false;
      if (filter === "inactive" ? !inactive : filter !== "all" && inactive)
        return false;
      if (filter === "low" && !isLow(item)) return false;
      if (filter === "service" && item.kind !== "시술 재료") return false;
      if (filter === "sale" && item.kind !== "판매 상품") return false;
      if (categoryFilter && categoryOf(item) !== categoryFilter) return false;
      return (
        !query ||
        matchesSearch(query, [
          item.name,
          item.kind,
          item.unit,
          item.spec,
          item.barcode,
        ])
      );
    })
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
  // Barcode scanners type the code and press Enter: jump straight to receiving that item.
  const scanned = (event) => {
    if (event.key !== "Enter" || tab !== "stock") return;
    const code = query.trim();
    const match = code && items.find((item) => item.barcode === code);
    if (!match) return;
    event.preventDefault();
    if (canWrite && match.active !== false)
      setDialog({ kind: "receipt", itemId: match.id });
    else setQuery(match.name);
  };
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
  const tabs = [
    ["stock", "현재 재고"],
    ["receipts", "입고 기록"],
    ["logs", "재고 변동 이력"],
  ];
  return (
    <div className="inv-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">품목 {active.length}개</p>
          <h1 className="page-title">재고</h1>
        </div>
        <div className="page-actions">
          {canManage && (
            <Button
              variant="ghost"
              className="inv-wide-only"
              onClick={() => navigate("settings", { tab: "services" })}
            >
              시술과 재료 설정
            </Button>
          )}
          {canManage && (
            <Button
              variant="secondary"
              className="inv-wide-only"
              onClick={() => setDialog({ kind: "item" })}
            >
              품목 등록
            </Button>
          )}
          {canWrite && (
            <Button
              variant="primary"
              className="inv-receipt-action"
              onClick={() => setDialog({ kind: "receipt" })}
              disabled={!active.length}
            >
              <Icon name="plus" />
              입고 기록
            </Button>
          )}
        </div>
      </header>
      <div className="home-stats inv-stats">
        <button
          type="button"
          className="home-stat"
          onClick={() => {
            switchTab("stock");
            setFilter("low");
          }}
        >
          <span className="home-stat-label">보충 필요</span>
          <strong
            className={`home-stat-value ${low.length ? "tone-warn-text" : ""}`}
          >
            {low.length}품목
          </strong>
          {empty.length > 0 && (
            <span className="small muted">품절 {empty.length}품목</span>
          )}
        </button>
        <button
          type="button"
          className="home-stat"
          onClick={() => navigate("purchases", { tab: "requests" })}
        >
          <span className="home-stat-label">구매 요청</span>
          <strong className="home-stat-value">{pendingRequests.length}건</strong>
        </button>
        <button
          type="button"
          className="home-stat inv-wide-only"
          onClick={() => switchTab("receipts")}
        >
          <span className="home-stat-label">이번 주 입고</span>
          <strong className="home-stat-value">{weekReceipts.length}건</strong>
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="재고 조회 종류">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={`tab ${tab === id ? "active" : ""}`}
            role="tab"
            aria-selected={tab === id}
            onClick={() => switchTab(id)}
          >
            {label}
            {id === "receipts" && (
              <span className="inv-tab-count">{receipts.length}</span>
            )}
          </button>
        ))}
      </div>
      <section
        className="panel inv-panel"
        aria-label={tabs.find(([id]) => id === tab)?.[1]}
      >
        <div className="inv-filters">
          <label className="input-icon inv-search">
            <Icon name="search" />
            <span className="sr-only">검색</span>
            <input
              ref={searchRef}
              type="search"
              placeholder={
                tab === "stock"
                  ? "품목 이름이나 바코드"
                  : "품목 이름, 기록자, 메모"
              }
              onKeyDown={scanned}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(50);
              }}
            />
          </label>
          {tab === "stock" ? (
            <>
              <button
                type="button"
                className="icon-btn inv-scan inv-narrow-only"
                aria-label="바코드 찍기"
                onClick={() => searchRef.current?.focus()}
              >
                <Icon name="barcode" />
              </button>
              <span className="inv-scan-help inv-narrow-only">
                바코드를 찍으면 바로 그 품목의 입고 창이 열려요
              </span>
              <select
                className="inv-filter-select"
                aria-label="품목 분류별 조회"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">전체 분류</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.active ? "" : " (미사용)"}
                  </option>
                ))}
              </select>
              <div className="chip-row" role="group" aria-label="품목 상태">
                {STOCK_FILTERS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="chip"
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                    {id === "low" && low.length > 0 && (
                      <span className="inv-chip-count inv-narrow-only">
                        {low.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="inv-filter-fields">
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
                  max={today}
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setLimit(50);
                  }}
                />
              </Field>
            </div>
          )}
        </div>
        {tab === "stock" &&
          (filteredItems.length ? (
            <table className="inv-cards">
              <thead className="sr-only">
                <tr>
                  <th scope="col">품목</th>
                  <th scope="col">재고</th>
                  <th scope="col">관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const inactive = item.active === false;
                  const tone = inactive ? "muted" : stockTone(item);
                  const pack = Number(item.packSize) || 1;
                  const canRequest = !inactive && !requested.has(item.id);
                  return (
                    <tr key={item.id} className={`inv-card inv-tone-${tone}`}>
                      <td className="inv-card-head">
                        <span className="inv-card-title">
                          <strong>{item.name}</strong>
                          <span className="small muted">
                            {categoryName(item)}
                          </span>
                          {item.spec && (
                            <span className="small muted">{item.spec}</span>
                          )}
                        </span>
                        <span className="inv-card-badges">
                          <Badge tone={tone}>
                            {inactive ? "사용 중지" : stockStatus(item)}
                          </Badge>
                          {requested.has(item.id) && (
                            <Badge tone="muted">구매 요청됨</Badge>
                          )}
                        </span>
                      </td>
                      <td className="inv-card-stock">
                        <strong className="inv-qty num">
                          {quantity(item.qty)}
                          {item.unit}
                        </strong>
                        <span className="inv-bar" aria-hidden="true">
                          <span style={{ width: `${stockPercent(item)}%` }} />
                        </span>
                        <span className="inv-card-line">
                          <span className="small muted">
                            기준 {quantity(item.min)}
                            {item.unit}
                          </span>
                          {canWrite && (
                            <button
                              type="button"
                              className="inv-link"
                              onClick={() =>
                                setDialog({
                                  kind: "threshold",
                                  itemId: item.id,
                                })
                              }
                              aria-label={`${item.name} 보충 기준 변경`}
                            >
                              기준 변경
                            </button>
                          )}
                        </span>
                        {!(pack === 1 && item.unit === "개") && (
                          <span className="small muted">
                            1개 입고하면 {quantity(pack)}
                            {item.unit}
                          </span>
                        )}
                        {item.kind === "판매 상품" && (
                          <span className="small muted">
                            판매가 <Money value={item.price} />
                          </span>
                        )}
                      </td>
                      <td className="inv-card-actions">
                        {canWrite && (
                          <span className="inv-card-buttons">
                            {!inactive && (
                              <Button
                                variant="primary"
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
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setDialog({ kind: "adjust", itemId: item.id })
                              }
                              aria-label={`${item.name} 재고 실사`}
                            >
                              실사
                            </Button>
                          </span>
                        )}
                        {(canRequest || canManage) && (
                          <span className="inv-card-more">
                            {!canRequest && (
                              <span
                                className="inv-card-spacer"
                                aria-hidden="true"
                              />
                            )}
                            {canRequest && (
                              <button
                                type="button"
                                className="text-btn inv-request-btn"
                                onClick={() =>
                                  setDialog({
                                    kind: "request",
                                    itemId: item.id,
                                  })
                                }
                                aria-label={`${item.name} 구매 요청`}
                              >
                                구매 요청
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                className="text-btn inv-edit-btn"
                                onClick={() =>
                                  setDialog({ kind: "item", itemId: item.id })
                                }
                                aria-label={`${item.name} 품목 수정`}
                              >
                                <Icon name="edit" />
                                <span className="inv-edit-text">수정</span>
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title={
                items.length
                  ? "조건에 맞는 품목이 없어요"
                  : "관리할 품목을 등록해 주세요"
              }
              description={
                items.length
                  ? "검색어나 상태 필터를 바꿔 보세요"
                  : "시술 재료와 판매 상품을 등록한 다음 받은 수량을 입고하세요"
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
                <table className="table commerce-table commerce-mobile-cards inv-table">
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
                            <span className="commerce-secondary">{r.date}</span>
                          </td>
                          <td data-label="상태">
                            <Badge
                              tone={
                                r.status === "cancelled" ? "muted" : "success"
                              }
                            >
                              {r.status === "cancelled" ? "취소" : "입고 완료"}
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
                            {r.memo || "없음"}
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
                  className="inv-more"
                  onClick={() => setLimit((n) => n + 50)}
                >
                  더 보기 ({limit} / {filteredReceipts.length})
                </Button>
              )}
            </>
          ) : (
            <EmptyState
              title="입고 기록이 없어요"
              description="받은 수량을 입고 기록으로 남기면 여기에서 볼 수 있어요"
            />
          ))}
        {tab === "logs" &&
          (filteredLogs.length ? (
            <>
              <div className="table-wrap">
                <table className="table commerce-table commerce-mobile-cards inv-table">
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
                              ? "없음"
                              : `${quantity(log.after)}${item?.unit || ""}`}
                          </td>
                          <td data-label="기록자" className="optional-mobile">
                            {log.actorName || "기존 기록"}
                          </td>
                          <td data-label="사유">
                            {log.beforeMin != null && (
                              <span className="commerce-secondary">
                                보충 기준 {quantity(log.beforeMin)}에서{" "}
                                {quantity(log.afterMin)}
                                {item?.unit}로
                              </span>
                            )}
                            {log.reason || "없음"}
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
                  className="inv-more"
                  onClick={() => setLimit((n) => n + 50)}
                >
                  더 보기 ({limit} / {filteredLogs.length})
                </Button>
              )}
            </>
          ) : (
            <EmptyState
              title="재고 변동 이력이 없어요"
              description="입고, 판매, 시술 사용, 실사 조정, 보충 기준 변경이 시간순으로 쌓여요"
            />
          ))}
      </section>
      {canManage && (
        <div className="inv-narrow-links inv-narrow-only">
          <button
            type="button"
            className="text-btn"
            onClick={() => setDialog({ kind: "item" })}
          >
            품목 등록
          </button>
          <button
            type="button"
            className="text-btn"
            onClick={() => navigate("settings", { tab: "services" })}
          >
            시술과 재료 설정
          </button>
        </div>
      )}
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
      {dialog?.kind === "request" && currentItem && (
        <PurchaseRequestForm
          item={currentItem}
          runAction={runAction}
          onClose={() => setDialog(null)}
          onSaved={() =>
            saved("구매 요청을 등록했습니다. 매니저가 발주에 반영합니다.")
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
    </div>
  );
}

function ChipRadios({ label, options, value, onChange, disabled, help }) {
  const id = useId();
  const refs = useRef([]);
  const selected = Math.max(0, options.indexOf(value));
  const move = (index) => {
    const next = (index + options.length) % options.length;
    onChange(options[next]);
    refs.current[next]?.focus();
  };
  return (
    <div className="field">
      <span id={`${id}-label`} className="field-label">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={help ? `${id}-help` : undefined}
        className="chip-row"
      >
        {options.map((option, index) => (
          <button
            key={option}
            ref={(el) => (refs.current[index] = el)}
            type="button"
            role="radio"
            className="chip inv-radio"
            aria-checked={value === option}
            tabIndex={index === selected ? 0 : -1}
            disabled={disabled}
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
            {option}
          </button>
        ))}
      </div>
      {help && (
        <span id={`${id}-help`} className="help">
          {help}
        </span>
      )}
    </div>
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
    barcode: item?.barcode || "",
    spec: item?.spec || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [requestClose, closeGuard] = useCloseGuard(dirty, onClose);
  const activeId = useId();
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
  const pack = form.unit === "개" ? 1 : Number(form.packSize) || 0;
  return (
    <Modal
      title={item ? "품목 수정" : "품목 등록"}
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="inventory-item"
            busy={busy}
          >
            {item ? "변경 저장" : "품목 저장"}
          </Button>
        </>
      }
    >
      <form id="inventory-item" onSubmit={submit} className="inv-form">
        <fieldset disabled={busy} className="inv-fieldset">
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
              placeholder="예: 트리트먼트 원액"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <div className="inv-grid-2">
            <ChipRadios
              label="품목 구분"
              options={["시술 재료", "판매 상품"]}
              value={form.kind}
              onChange={(value) => update("kind", value)}
            />
            <ChipRadios
              label="관리 단위"
              options={["ml", "g", "개"]}
              value={form.unit}
              disabled={!!item}
              help={item ? "기존 기록을 지키려고 단위는 그대로 둬요" : undefined}
              onChange={(value) => {
                update("unit", value);
                if (value === "개") update("packSize", "1");
              }}
            />
          </div>
          <div className="inv-grid-3">
            {form.unit !== "개" && (
              <Field label={`1개당 용량 (${form.unit})`}>
                <input
                  required
                  type="number"
                  inputMode="decimal"
                  min={unitStep(form)}
                  max="1000000000"
                  step={unitStep(form)}
                  value={form.packSize}
                  onChange={(e) => update("packSize", e.target.value)}
                />
              </Field>
            )}
            <Field label="1개 입고 단가 (원)">
              <input
                required
                type="number"
                inputMode="numeric"
                min="0"
                max="1000000000"
                step="1"
                value={form.purchasePrice}
                onChange={(e) => update("purchasePrice", e.target.value)}
              />
            </Field>
            <Field label={`보충 기준 (${form.unit})`}>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                required
                min="0"
                max="1000000000"
                step={unitStep(form)}
                value={form.min}
                onChange={(e) => update("min", e.target.value)}
              />
            </Field>
            {form.kind === "판매 상품" && (
              <Field
                label="판매 단가 (원)"
                help={form.unit === "개" ? "1개 가격" : `1${form.unit} 가격`}
              >
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  required
                  min="0"
                  step="1"
                  value={form.price}
                  onChange={(e) => update("price", e.target.value)}
                />
              </Field>
            )}
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
                      {s.active ? "" : " (미사용)"}
                    </option>
                  ))}
              </select>
            </Field>
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
                      {c.active ? "" : " (미사용)"}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="바코드 (선택)">
              <input
                className="input"
                maxLength={64}
                inputMode="numeric"
                autoComplete="off"
                placeholder="스캐너로 찍어도 돼요"
                value={form.barcode}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                onChange={(e) => update("barcode", e.target.value.trim())}
              />
            </Field>
            <Field label="규격 (선택)">
              <input
                className="input"
                maxLength={100}
                placeholder="예: 500ml 펌프형"
                value={form.spec}
                onChange={(e) => update("spec", e.target.value)}
              />
            </Field>
          </div>
          <div className="inset inv-summary">
            {pack > 0 && (
              <strong>
                1개 입고하면 재고가 {quantity(pack)}
                {form.unit} 늘어요
              </strong>
            )}
            <span className="muted">
              재고가 {quantity(form.min)}
              {form.unit} 이하가 되면 보충 알림이 떠요
            </span>
            <span className="small muted">
              {item
                ? `지금 재고는 ${quantity(item.qty)}${item.unit}예요. 수량은 입고나 실사로 바꿔요`
                : "새 품목은 재고 0에서 시작해요. 저장한 뒤 받은 수량을 입고하세요"}
            </span>
          </div>
          {item && (
            <div className="inv-switch-row">
              <span className="inv-switch-text">
                <span id={activeId}>사용 중인 품목</span>
                <span className="small muted">
                  사용을 멈춰도 지난 입고와 판매 기록은 남아요
                </span>
              </span>
              <button
                type="button"
                role="switch"
                className="switch"
                aria-checked={form.active}
                aria-labelledby={activeId}
                onClick={() => update("active", !form.active)}
              />
            </div>
          )}
        </fieldset>
      </form>
      {closeGuard}
    </Modal>
  );
}

function PurchaseRequestForm({ item, runAction, onClose, onSaved }) {
  const [form, setForm] = useState({ quantity: "1", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = form.quantity !== "1" || !!form.note;
  const [requestClose, closeGuard] = useCloseGuard(dirty, onClose);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction("purchase.request", {
        itemId: item.id,
        quantity: Number(form.quantity),
        note: form.note,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const qtyLabelId = useId();
  const pack = Number(item.packSize) || 1;
  const count = Number(form.quantity) || 0;
  const tone = stockTone(item);
  const bump = (direction) =>
    setForm((f) => ({
      ...f,
      quantity: String(
        Math.min(9999, Math.max(1, (Number(f.quantity) || 0) + direction)),
      ),
    }));
  return (
    <Modal
      title={`${item.name} 구매 요청`}
      subtitle={item.kind}
      size="wide"
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            취소
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="purchase-request"
            busy={busy}
          >
            요청 등록
          </Button>
        </>
      }
    >
      <form id="purchase-request" onSubmit={submit} className="inv-form">
        <fieldset disabled={busy} className="inv-fieldset">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className={`invb-stock-card invb-tone-${tone}`}>
            <span className="invb-stat">
              <span className="invb-label">지금 남은 양</span>
              <strong className="invb-big invb-now num">
                {quantity(item.qty)}
                {item.unit}
              </strong>
            </span>
            <span className="invb-stat">
              <span className="invb-label">보충 기준</span>
              <strong className="invb-big num">
                {quantity(item.min)}
                {item.unit}
              </strong>
            </span>
            <span className="invb-stock-foot">
              <span className="inv-bar" aria-hidden="true">
                <span style={{ width: `${stockPercent(item)}%` }} />
              </span>
              <span className="invb-label">
                발주 담당자가 확인한 뒤 거래처에 주문해요
              </span>
            </span>
          </div>
          <div
            className="invb-qty-box"
            role="group"
            aria-labelledby={qtyLabelId}
          >
            <span id={qtyLabelId} className="field-label">
              요청 수량 (포장 개수)
            </span>
            <div className="invb-qty-row">
              <div className="stepper">
                <button
                  type="button"
                  aria-label="하나 줄이기"
                  disabled={count <= 1}
                  onClick={() => bump(-1)}
                >
                  <Icon name="minus" />
                </button>
                <input
                  className="inv-qty-input num"
                  type="number"
                  required
                  min="1"
                  max="9999"
                  step="1"
                  inputMode="numeric"
                  aria-labelledby={qtyLabelId}
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                />
                <button
                  type="button"
                  aria-label="하나 늘리기"
                  disabled={count >= 9999}
                  onClick={() => bump(1)}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <span className="invb-qty-result" aria-live="polite">
                {count > 0 && (
                  <strong className="tone-up">
                    {quantity(count * pack)}
                    {item.unit} 요청해요
                  </strong>
                )}
                <span className="invb-label">
                  1개 = {quantity(pack)}
                  {item.unit}
                </span>
              </span>
            </div>
          </div>
          <Field label="메모 (선택)">
            <textarea
              className="textarea"
              rows="3"
              maxLength={300}
              placeholder="예: 다음 주 염색 예약이 많아요"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
        </fieldset>
      </form>
      {closeGuard}
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
  const qtyRef = useRef(null);
  const focusNext = useRef(false);
  const qtyId = useId();
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
  const pick = (itemId) => {
    const next = items.find((i) => i.id === itemId);
    setForm((f) => ({
      ...f,
      itemId,
      packageMode: (next?.packSize || 1) > 1,
      qty: "",
    }));
    setDirty(true);
  };
  const searchable = (i) => [i.name, i.kind, i.unit, i.spec, i.barcode];
  const candidates = items.filter(
    (i) => i.active !== false && matchesSearch(itemQuery, searchable(i)),
  );
  // A scanner types the barcode and presses Enter; a single text match is picked the same way.
  const searchKey = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = itemQuery.trim();
    const byCode =
      code &&
      items.find((i) => i.active !== false && i.barcode && i.barcode === code);
    const target =
      byCode || (code && candidates.length === 1 ? candidates[0] : null);
    if (!target) return;
    pick(target.id);
    qtyRef.current?.focus();
  };
  const multiplier = form.packageMode ? Number(item?.packSize) || 1 : 1;
  const added = Number(form.qty || 0) * multiplier;
  const after = Number(item?.qty || 0) + added;
  const step =
    form.packageMode || !item || item.unit === "개"
      ? 1
      : Number(item.packSize) || 1;
  const bump = (direction) => {
    const next = Math.max(
      0,
      Math.round(((Number(form.qty) || 0) + direction * step) * 1000) / 1000,
    );
    update("qty", next ? String(next) : "");
  };
  const qtyLabel = form.packageMode
    ? "받은 포장 개수"
    : item && item.unit !== "개"
      ? `받은 총 용량 (${item.unit})`
      : "받은 개수";
  const stepLabel =
    step === 1 ? "하나" : `${quantity(step)}${item?.unit || ""}`;
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
          `${item?.name || "품목"} ${quantity(form.qty)}${form.packageMode ? "개" : item?.unit || ""} 입고를 저장했어요. 다음 품목을 고르세요`,
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
      title="입고 기록"
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
            저장하고 하나 더
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
      <form id="inventory-receipt" onSubmit={submit} className="inv-form">
        <fieldset disabled={busy} className="inv-fieldset inv-receipt">
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
          <div className="field">
            <span className="field-label" aria-hidden="true">
              품목
            </span>
            <label className="input-icon">
              <Icon name="search" />
              <input
                type="search"
                ref={searchRef}
                aria-label="입고 품목 검색"
                value={itemQuery}
                placeholder="품목 이름이나 바코드"
                autoComplete="off"
                onKeyDown={searchKey}
                onChange={(e) => setItemQuery(e.target.value)}
              />
            </label>
            <select
              className="select"
              aria-label="입고 품목"
              required
              value={form.itemId}
              onChange={(e) => pick(e.target.value)}
            >
              <option value="">품목을 고르세요</option>
              {items
                .filter(
                  (i) =>
                    i.active !== false &&
                    (i.id === form.itemId || candidates.includes(i)),
                )
                .map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.name} (지금 {quantity(i.qty)}
                    {i.unit})
                  </option>
                ))}
            </select>
            {itemQuery && !candidates.length ? (
              <span className="help" role="status">
                검색에 맞는 품목이 없어요. 검색어를 지우거나 품목 등록을
                확인하세요
              </span>
            ) : (
              <span className="help">바코드를 찍으면 바로 골라져요</span>
            )}
          </div>
          <div className="inv-qty-box">
            <div className="inv-qty-head">
              <label htmlFor={qtyId} className="muted">
                {qtyLabel}
              </label>
              {item && item.unit !== "개" && (
                <div className="seg" role="group" aria-label="입고 입력 방식">
                  {[
                    [true, "포장 개수"],
                    [false, "총 용량"],
                  ].map(([mode, label]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={form.packageMode === mode}
                      onClick={() => {
                        update("packageMode", mode);
                        update("qty", "");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="inv-qty-row">
              <div className="stepper">
                <button
                  type="button"
                  aria-label={`${stepLabel} 줄이기`}
                  disabled={!item || !(Number(form.qty) > 0)}
                  onClick={() => bump(-1)}
                >
                  <Icon name="minus" />
                </button>
                <input
                  id={qtyId}
                  ref={qtyRef}
                  className="inv-qty-input num"
                  type="number"
                  inputMode="decimal"
                  required
                  min={form.packageMode ? "1" : unitStep(item)}
                  max="1000000000"
                  step={form.packageMode ? "1" : unitStep(item)}
                  value={form.qty}
                  placeholder="0"
                  onChange={(e) => update("qty", e.target.value)}
                />
                <button
                  type="button"
                  aria-label={`${stepLabel} 늘리기`}
                  disabled={!item}
                  onClick={() => bump(1)}
                >
                  <Icon name="plus" />
                </button>
              </div>
              <div className="inv-delta" aria-live="polite">
                {!item ? (
                  <span className="small muted">
                    품목을 고르면 늘어날 양이 보여요
                  </span>
                ) : added > 0 ? (
                  <>
                    <strong className="tone-up">
                      {quantity(added)}
                      {item.unit} 늘어요
                    </strong>
                    <span className="small muted">
                      {quantity(item.qty)}
                      {item.unit}에서 {quantity(after)}
                      {item.unit}로
                    </span>
                  </>
                ) : (
                  <span className="small muted">
                    지금 {quantity(item.qty)}
                    {item.unit} 있어요
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="inv-grid-2">
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
            <Field label="메모 (선택)">
              <input
                className="input"
                maxLength={1000}
                placeholder="예: 발주 12 일부 도착"
                value={form.memo}
                onChange={(e) => update("memo", e.target.value)}
              />
            </Field>
          </div>
          <p className="help">
            여러 품목을 받았다면 저장하고 하나 더를 누르세요. 입고일과 메모는
            그대로 남아요
          </p>
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
  const [requestClose, closeGuard] = useCloseGuard(dirty, onClose);
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
  const nextItem = { ...item, min: qty === "" ? item.min : Number(qty) };
  const preview = (target) => {
    const amount = `${quantity(target.qty)}${target.unit}`;
    const current = Number(target.qty),
      min = Number(target.min);
    return {
      tone: stockTone(target),
      status: stockStatus(target),
      line:
        current <= 0
          ? "재고가 없어요"
          : current < min
            ? `${subject(amount)} 기준보다 적어요`
            : current === min
              ? `${subject(amount)} 기준과 같아요`
              : `${subject(amount)} 기준보다 많아요`,
    };
  };
  const before = preview(item),
    after = preview(nextItem);
  return (
    <Modal
      title={isAdjust ? "재고 실사 조정" : "보충 기준 변경"}
      size="wide"
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            취소
          </Button>
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
      <form id="inventory-stock" onSubmit={submit} className="inv-form">
        <fieldset disabled={busy} className="inv-fieldset">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="invb-head-row">
            <span className="invb-head-text">
              <strong>{item.name}</strong>
              <span className="invb-label">
                {isAdjust
                  ? "선반과 창고를 확인한 실제 총수량을 넣으면 차이만 반영해요"
                  : "재고가 기준과 같거나 적으면 보충 필요로 표시돼요"}
              </span>
            </span>
            <span className="invb-head-side">
              <span className="invb-label">
                {isAdjust ? "전산 재고" : "지금 재고"}
              </span>
              <strong className="num">
                {quantity(item.qty)}
                {item.unit}
              </strong>
            </span>
          </div>
          <div className="inv-grid-2">
            {!isAdjust && (
              <div className="field">
                <span className="field-label">지금 보충 기준</span>
                <span className="invb-readonly num">
                  <span>{quantity(item.min)}</span>
                  <span className="invb-unit">{item.unit}</span>
                </span>
              </div>
            )}
            <Field
              label={`${isAdjust ? "실제로 남아 있는 총수량" : "새 보충 기준"} (${item.unit})`}
              help={
                isAdjust
                  ? "조정할 차이가 아니라 남은 전체 양을 넣어 주세요"
                  : undefined
              }
            >
              <span className="invb-suffix">
                <input
                  className="input num"
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
                <span className="invb-unit" aria-hidden="true">
                  {item.unit}
                </span>
              </span>
            </Field>
            {isAdjust && (
              <div
                className={`invb-result ${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}`}
                aria-live="polite"
              >
                <strong className="invb-big num">
                  {delta === 0 ? "변동 없음" : `${signed(delta, item.unit)} 조정`}
                </strong>
                <span className="invb-label">
                  조정 후 {quantity(qty)}
                  {item.unit}
                </span>
              </div>
            )}
          </div>
          {!isAdjust && (
            <div className="invb-preview">
              <span className="field-label">바꾸면 이렇게 보여요</span>
              <div className="invb-preview-row" aria-live="polite">
                {[
                  ["지금", before, item.min, ""],
                  ["바꾼 뒤", after, nextItem.min, " is-next"],
                ].map(([label, view, min, extra], index) => (
                  <React.Fragment key={label}>
                    {index === 1 && (
                      <span className="invb-preview-arrow" aria-hidden="true">
                        <Icon name="arrow-right" />
                      </span>
                    )}
                    <div className={`invb-preview-card${extra}`}>
                      <span className="invb-preview-top">
                        <span className="invb-label">{label}</span>
                        <Badge tone={view.tone}>{view.status}</Badge>
                      </span>
                      <strong className="num">
                        기준 {quantity(min)}
                        {item.unit}
                      </strong>
                      <span className="invb-label">{view.line}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
          {isAdjust && (
            <>
              <Field label="조정 사유 (필수)">
                <textarea
                  className="textarea"
                  rows="3"
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="예: 월말 실사, 파손 폐기 확인"
                />
              </Field>
            </>
          )}
        </fieldset>
      </form>
      {closeGuard}
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
  const cancelled = receipt.status === "cancelled";
  const historyId = useId();
  const unit = item?.unit || "";
  const changes = (receipt.changes || []).slice().reverse();
  const dotTone = (kind = "") =>
    kind.includes("취소") ? "danger" : kind.includes("정정") ? "accent" : "ok";
  return (
    <Modal
      title="입고 상세"
      size="wide"
      onClose={onClose}
      footer={
        <>
          {canWrite && !cancelled && (
            <Button
              variant="danger"
              className="invb-footer-start"
              onClick={onCancel}
            >
              입고 취소
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            닫기
          </Button>
          {canWrite && !cancelled && (
            <Button variant="primary" onClick={onCorrect}>
              수량 정정
            </Button>
          )}
        </>
      }
    >
      <div className="inv-form inv-fieldset">
        <div className="inv-detail-top">
          <span className="inv-card-title">
            <strong>{item?.name || "기존 품목"}</strong>
            <span className="invb-big num">
              {quantity(receipt.qty)}
              {unit}
            </span>
          </span>
          <Badge tone={cancelled ? "muted" : "success"}>
            {cancelled ? "취소된 입고" : "입고 완료"}
          </Badge>
        </div>
        <dl className="invb-facts">
          <div>
            <dt>입고일</dt>
            <dd className="num">{receipt.date}</dd>
          </div>
          <div>
            <dt>최초 기록자</dt>
            <dd>{receipt.actorName || "기존 기록"}</dd>
          </div>
          <div>
            <dt>입고 번호</dt>
            <dd className="inv-break">{receipt.id}</dd>
          </div>
          <div>
            <dt>현재 재고</dt>
            <dd className="num">
              {quantity(item?.qty)}
              {unit}
            </dd>
          </div>
          <div>
            <dt>메모</dt>
            <dd className="inv-prewrap">{receipt.memo || "없음"}</dd>
          </div>
        </dl>
        {receipt.orderId && (
          <p className="alert">
            발주에 연결된 입고예요. 발주 화면의 발주 상세에서 취소하고 다시
            등록할 수 있어요
          </p>
        )}
        <section className="invb-history" aria-labelledby={historyId}>
          <h3 id={historyId}>입고와 정정 이력</h3>
          <ol className="invb-timeline">
            {changes.map((change, index) => (
              <li key={index} className={`is-${dotTone(change.kind)}`}>
                <div className="invb-timeline-card">
                  <span className="invb-timeline-top">
                    <strong>{change.kind}</strong>
                    <span className="invb-label num">
                      {displayTime(change.at)}
                    </span>
                  </span>
                  <span className="invb-label">
                    {change.actorName || "기존 기록"}
                  </span>
                  <span className="num">
                    기록 수량 {quantity(change.beforeQty)}
                    {unit}에서 {quantity(change.afterQty)}
                    {unit}로
                  </span>
                  {change.delta != null && (
                    <span className="invb-label num">
                      재고 {signed(Number(change.delta), unit)}
                    </span>
                  )}
                  {change.reason && (
                    <span className="inv-prewrap">{change.reason}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <span className="invb-label">
            수량 정정은 기존 기록과의 차이만 반영해요
          </span>
          <span className="invb-label">
            이미 쓴 수량 때문에 재고가 음수가 되면 정정하거나 취소할 수 없어요
          </span>
        </section>
      </div>
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
  const [requestClose, closeGuard] = useCloseGuard(dirty, onClose);
  const originalRevision = useState(receipt.revision || 0)[0];
  const unit = item?.unit || "";
  const qtyDelta = Number(qty || 0) - Number(receipt.qty);
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
      size="wide"
      onClose={busy ? undefined : onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={requestClose} disabled={busy}>
            돌아가기
          </Button>
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
      <form id="receipt-change" onSubmit={submit} className="inv-form">
        <fieldset disabled={busy} className="inv-fieldset">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="inset inv-summary">
            <strong>{item?.name || "기존 품목"}</strong>
            <span className="invb-sub">{receipt.date} 입고</span>
            <span className="invb-label">
              {cancel
                ? `기록된 ${object(`${quantity(receipt.qty)}${unit}`)} 재고에서 빼요. 취소 이력은 남아요`
                : `지금 기록은 ${copula(`${quantity(receipt.qty)}${unit}`)}. 더할 양이 아니라 올바른 총수량을 넣어 주세요`}
            </span>
          </div>
          <div className="inv-grid-2">
            {!cancel && (
              <Field
                label={`정정할 입고 총수량 (${item?.unit || "개"})`}
                help={
                  qtyDelta === 0
                    ? "기존 기록과 같아요"
                    : `재고에는 차이 ${signed(qtyDelta, unit)}만 반영돼요`
                }
              >
                <span className="invb-suffix">
                  <input
                    className="input num"
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
                  <span className="invb-unit" aria-hidden="true">
                    {unit}
                  </span>
                </span>
              </Field>
            )}
            <div className="invb-result is-plain" aria-live="polite">
              <span className="invb-label">처리 후 재고</span>
              <strong className="invb-big num">
                {quantity(afterStock)}
                {unit}
              </strong>
              <span className="invb-label">
                지금 {quantity(item?.qty)}
                {unit}
              </span>
            </div>
            {cancel && (
              <div className="invb-result is-plain">
                <span className="invb-label">재고에서 빠지는 양</span>
                <strong className="invb-big num tone-down">
                  {signed(-Number(receipt.qty), unit)}
                </strong>
                <span className="invb-label">입고 기록은 취소됨으로 남아요</span>
              </div>
            )}
          </div>
          {afterStock < 0 && (
            <div className="alert alert-danger" role="alert">
              이미 사용한 수량 때문에 재고가 음수가 됩니다. 실제 재고와 입고
              기록을 다시 확인해 주세요.
            </div>
          )}
          {(receipt.revision || 0) !== originalRevision && (
            <div className="alert alert-warning">
              다른 직원이 이 기록을 바꿨어요. 창을 닫고 최신 기록을 다시
              확인하세요
            </div>
          )}
          <Field label={`${cancel ? "취소" : "정정"} 사유 (필수)`}>
            <textarea
              className="textarea"
              rows="3"
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
      {closeGuard}
    </Modal>
  );
}
