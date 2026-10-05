import { DateInput } from "../components/DateInput.jsx";
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button, Field, Badge, EmptyState, Money } from "../components/ui";
import {
  todayInSeoul,
  money,
  methodNames,
  monthStart,
  matchesSearch,
} from "./commerce-utils";
import { useViewState } from "../components/ViewState";
import "./Commerce.css";

function priorDay(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
function priorMonth(date) {
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  value.setUTCDate(0);
  const to = value.toISOString().slice(0, 10);
  return { from: monthStart(to), to };
}

export default function Sales({ data, user, navigate, version, routeContext }) {
  const today = todayInSeoul();
  const [draft, setDraft] = useViewState("sales", "draft", {
    from: monthStart(),
    to: today,
    staffId: "",
  });
  const [range, setRange] = useViewState("sales", "range", {
    from: monthStart(),
    to: today,
    staffId: "",
  });
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [eventKind, setEventKind] = useViewState("sales", "eventKind", "all");
  const [eventMethod, setEventMethod] = useViewState(
    "sales",
    "eventMethod",
    "all",
  );
  const [eventQuery, setEventQuery] = useViewState("sales", "eventQuery", "");
  const [limit, setLimit] = useState(50);
  const permitted = ["owner", "manager", "reception"].includes(user.role);
  const usedContext = useRef(null);
  useEffect(() => {
    if (!routeContext || routeContext === usedContext.current) return;
    usedContext.current = routeContext;
    if (
      routeContext.from &&
      routeContext.to &&
      routeContext.from <= routeContext.to
    ) {
      const next = {
        from: routeContext.from,
        to: routeContext.to,
        staffId: routeContext.staffId || "",
      };
      setDraft(next);
      setRange(next);
      setEventKind("all");
      setEventMethod("all");
      setEventQuery("");
      setLimit(50);
    }
  }, [routeContext]);
  useEffect(() => {
    if (!permitted) return;
    let live = true;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      ...(range.staffId ? { staffId: range.staffId } : {}),
    });
    api(`/reports?${params}`, { signal: controller.signal })
      .then((result) => {
        if (live) setReport(result);
      })
      .catch((err) => {
        if (live && err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [range, reload, version, permitted]);
  function submit(e) {
    e.preventDefault();
    if (!draft.from || !draft.to)
      return setError("조회 시작일과 종료일을 선택해 주세요.");
    if (draft.from > draft.to)
      return setError("시작일은 종료일 이전이어야 합니다.");
    setRange({ ...draft });
    setLimit(50);
  }
  function quick(value) {
    const next = {
      ...draft,
      ...(value === "today"
        ? { from: today, to: today }
        : value === "yesterday"
          ? { from: priorDay(today), to: priorDay(today) }
          : value === "lastMonth"
            ? priorMonth(today)
            : { from: monthStart(), to: today }),
    };
    setDraft(next);
    setRange(next);
    setLimit(50);
  }
  if (!permitted)
    return (
      <EmptyState
        title="매출 조회 권한이 없습니다"
        description="매장 매출은 원장, 매니저, 접수 직원이 확인할 수 있습니다."
      />
    );
  const events = report
    ? [
        ...(report.transactions || []).map((tx) => ({
          ...tx,
          eventType: "sale",
          amount: tx.total,
          transactionId: tx.id,
        })),
        ...(report.refundEntries || []).map((r) => ({
          ...r,
          eventType: "refund",
          staffId: (data.transactions || []).find(
            (tx) => tx.id === r.transactionId,
          )?.staffId,
          customerName:
            r.customerName ||
            (data.transactions || []).find((tx) => tx.id === r.transactionId)
              ?.customerName ||
            "방문 고객",
        })),
      ]
        .filter(
          (e) =>
            (eventKind === "all" || e.eventType === eventKind) &&
            (eventMethod === "all" || e.method === eventMethod) &&
            matchesSearch(eventQuery, [
              e.customerName,
              e.reference,
              e.transactionId,
              data.staff.find((staff) => staff.id === e.staffId)?.name,
              data.transactions.find((tx) => tx.id === e.transactionId)
                ?.reference,
            ]),
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            String(b.time || b.createdAt).localeCompare(
              String(a.time || a.createdAt),
            ),
        )
    : [];
  const matchingSales = events
    .filter((event) => event.eventType === "sale")
    .reduce((sum, event) => sum + event.amount, 0);
  const matchingRefunds = events
    .filter((event) => event.eventType === "refund")
    .reduce((sum, event) => sum + event.amount, 0);
  const days = report?.daily || [];
  const chartMax = Math.max(
    1,
    ...days.map((d) => Math.max(d.gross, d.refunds)),
  );
  const chartDays = days.length <= 45 ? days : [];
  const exportUrl = `/api/export?${new URLSearchParams({ from: range.from, to: range.to, ...(range.staffId ? { staffId: range.staffId } : {}) })}`;
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">매출 · 정산</h1>
          <p className="page-description">
            결제와 환불을 실제 처리한 날짜로 집계합니다.
          </p>
        </div>
        {report && !busy && !error && (
          <a href={exportUrl} className="btn btn-secondary" download>
            조회 기간 CSV 내려받기
          </a>
        )}
      </header>
      <section className="card commerce-banner">
        <div className="card-body">
          <form onSubmit={submit}>
            <div className="commerce-filters">
              <Field label="조회 시작일">
                <DateInput
                  className="input"
                  type="date"
                  required
                  max={draft.to}
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </Field>
              <Field label="조회 종료일">
                <DateInput
                  className="input"
                  type="date"
                  required
                  min={draft.from}
                  max={today}
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </Field>
              <Field label="담당 직원">
                <select
                  className="select"
                  value={draft.staffId}
                  onChange={(e) =>
                    setDraft({ ...draft, staffId: e.target.value })
                  }
                >
                  <option value="">매장 전체</option>
                  {data.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.status === "inactive" ? " (비활성)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Button variant="primary" type="submit" busy={busy}>
                조회
              </Button>
            </div>
            <div className="commerce-actions" aria-label="빠른 기간 선택">
              <Button variant="ghost" onClick={() => quick("today")}>
                오늘
              </Button>
              <Button variant="ghost" onClick={() => quick("yesterday")}>
                어제
              </Button>
              <Button variant="ghost" onClick={() => quick("month")}>
                이번 달
              </Button>
              <Button variant="ghost" onClick={() => quick("lastMonth")}>
                지난달
              </Button>
            </div>
            {(draft.from !== range.from ||
              draft.to !== range.to ||
              draft.staffId !== range.staffId) && (
              <p className="commerce-note" role="status">
                조회 조건이 변경되었습니다. ‘조회’를 누르면 아래 매출에
                반영됩니다.
              </p>
            )}
          </form>
        </div>
      </section>
      {error && (
        <div className="alert alert-danger commerce-banner" role="alert">
          <strong>매출을 불러오지 못했습니다.</strong>
          <p>{error}</p>
          <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
            다시 불러오기
          </Button>
        </div>
      )}
      {busy && (
        <div className="card">
          <div className="card-body" role="status" aria-live="polite">
            매출과 환불 내역을 집계하고 있습니다…
          </div>
        </div>
      )}
      {!busy && !error && report && (
        <>
          <p className="commerce-note">
            {range.from} ~ {range.to} ·{" "}
            {range.staffId
              ? data.staff.find((s) => s.id === range.staffId)?.name ||
                "선택 직원"
              : "매장 전체"}{" "}
            · 금액 단위: 원
          </p>
          <div className="commerce-stats">
            <div className="stat-card">
              <span className="muted">결제 매출</span>
              <strong>
                <Money value={report.gross} />
              </strong>
              <span className="muted">기간 내 원 결제 금액</span>
            </div>
            <div className="stat-card">
              <span className="muted">환불 금액</span>
              <strong>
                <Money value={report.refunds} />
              </strong>
              <span className="muted">이전 기간 결제의 환불 포함</span>
            </div>
            <div className="stat-card">
              <span className="muted">순매출</span>
              <strong>
                <Money value={report.net} />
              </strong>
              <span className="muted">결제 매출 − 환불 금액</span>
            </div>
            <div className="stat-card">
              <span className="muted">결제 건수</span>
              <strong>
                {report.count}
                <small>건</small>
              </strong>
              <span className="muted">
                건당 평균{" "}
                {money(
                  report.count ? Math.round(report.gross / report.count) : 0,
                )}
              </span>
            </div>
          </div>
          {!report.count && !(report.refundEntries || []).length && (
            <div className="commerce-banner">
              <EmptyState
                title="이 기간에는 결제·환불 기록이 없습니다"
                description="조회 기간을 바꾸거나 수납 기록을 등록하면 매출이 표시됩니다."
                action={
                  <Button onClick={() => navigate("payments")}>
                    수납 화면으로
                  </Button>
                }
              />
            </div>
          )}
          <section className="card">
            <div className="card-header">
              <div>
                <h2>일별 매출 흐름</h2>
                <p className="commerce-note">
                  결제와 환불을 별도로 표시합니다. 환불이 결제보다 많으면
                  순매출은 음수가 될 수 있습니다.
                </p>
              </div>
            </div>
            <div className="card-body">
              {chartDays.length > 0 && (
                <>
                  <div className="commerce-legend">
                    <span>
                      <i />
                      결제
                    </span>
                    <span>
                      <i className="refund" />
                      환불
                    </span>
                  </div>
                  <div
                    className="commerce-bar-chart"
                    role="img"
                    aria-label="일별 결제와 환불 금액 막대 그래프. 정확한 금액은 아래 표에서 확인할 수 있습니다."
                  >
                    {chartDays.map((d) => (
                      <div
                        className="commerce-bar-column"
                        key={d.date}
                        title={`${d.date} 결제 ${money(d.gross)}, 환불 ${money(d.refunds)}, 순매출 ${money(d.net)}`}
                      >
                        <div className="bars">
                          <div
                            className="bar"
                            style={{ height: `${(d.gross / chartMax) * 100}%` }}
                          />
                          <div
                            className="bar refund"
                            style={{
                              height: `${(d.refunds / chartMax) * 100}%`,
                            }}
                          />
                        </div>
                        <small>{d.date.slice(5)}</small>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {days.length > 45 && (
                <p className="commerce-note">
                  긴 기간의 매출은 아래 일별 표에서 확인하세요. 그래프는 45일
                  이내 기간에서 표시됩니다.
                </p>
              )}
              {days.length ? (
                <div className="table-wrap commerce-report-table">
                  <table className="table commerce-table commerce-compact-table">
                    <caption className="sr-only">
                      일별 결제·환불 및 순매출
                    </caption>
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th className="numeric optional-mobile">결제 매출</th>
                        <th className="numeric optional-mobile">환불 금액</th>
                        <th className="numeric">순매출</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...days].reverse().map((day) => (
                        <tr key={day.date}>
                          <td>
                            {day.date}
                            {day.date === today && (
                              <span className="commerce-secondary">오늘</span>
                            )}
                            <span className="commerce-only-mobile commerce-secondary">
                              결제 {money(day.gross)}
                              <br />
                              환불 {money(day.refunds)}
                            </span>
                          </td>
                          <td className="numeric optional-mobile">
                            <Money value={day.gross} />
                          </td>
                          <td className="numeric optional-mobile">
                            <Money value={day.refunds} />
                          </td>
                          <td className="numeric">
                            <strong>
                              <Money value={day.net} />
                            </strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="commerce-note">표시할 일별 기록이 없습니다.</p>
              )}
            </div>
          </section>
          <div className="commerce-summary-grid">
            <section className="card">
              <div className="card-header">
                <h2>결제 수단별 정산</h2>
              </div>
              <div className="card-body">
                <div className="table-wrap">
                  <table className="table commerce-table commerce-mobile-cards">
                    <thead>
                      <tr>
                        <th>수단</th>
                        <th className="numeric">결제</th>
                        <th className="numeric">환불</th>
                        <th className="numeric">순수납</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.byMethod || []).map((entry) => (
                        <tr key={entry.method}>
                          <td>{methodNames[entry.method] || entry.method}</td>
                          <td data-label="결제" className="numeric">
                            <Money value={entry.gross} />
                          </td>
                          <td data-label="환불" className="numeric">
                            <Money value={entry.refunds} />
                          </td>
                          <td data-label="순수납" className="numeric">
                            <strong>
                              <Money value={entry.net} />
                            </strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="commerce-note">
                  단말기 마감표·현금 시재·입금 내역과 비교하세요. 카드사 수수료
                  및 입금 예정액은 포함하지 않습니다.
                </p>
              </div>
            </section>
            <section className="card">
              <div className="card-header">
                <h2>담당 직원별 순매출</h2>
              </div>
              <div className="card-body">
                {(report.byStaff || []).length ? (
                  <div className="table-wrap">
                    <table className="table commerce-table commerce-mobile-cards">
                      <thead>
                        <tr>
                          <th>담당 직원</th>
                          <th className="numeric">결제 건수</th>
                          <th className="numeric">순매출</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(report.byStaff || []).map((entry) => (
                          <tr key={entry.staffId}>
                            <td>
                              {entry.name ||
                                data.staff.find((s) => s.id === entry.staffId)
                                  ?.name ||
                                "기존 담당자"}
                            </td>
                            <td data-label="결제 건수" className="numeric">
                              {entry.count}건
                            </td>
                            <td data-label="순매출" className="numeric">
                              <strong>
                                <Money value={entry.total} />
                              </strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="commerce-note">직원별 매출이 없습니다.</p>
                )}
                <p className="commerce-note">
                  수납에 지정된 담당자 기준입니다. 급여·수당은 직원별
                  급여명세에서 별도로 확인하세요.
                </p>
              </div>
            </section>
          </div>
          <section className="card">
            <div className="card-header">
              <h2>정산 거래 내역</h2>
              <span className="muted">{events.length}건</span>
            </div>
            <div className="card-body">
              <div className="commerce-filters">
                <div className="search-field">
                  <Field label="정산 거래 검색">
                    <input
                      className="input"
                      type="search"
                      value={eventQuery}
                      placeholder="고객명, 담당자, 승인 · 거래번호"
                      onChange={(e) => {
                        setEventQuery(e.target.value);
                        setLimit(50);
                      }}
                    />
                  </Field>
                </div>
                <Field label="거래 유형">
                  <select
                    className="select"
                    value={eventKind}
                    onChange={(e) => {
                      setEventKind(e.target.value);
                      setLimit(50);
                    }}
                  >
                    <option value="all">결제 + 환불</option>
                    <option value="sale">결제만</option>
                    <option value="refund">환불만</option>
                  </select>
                </Field>
                <Field label="결제 수단">
                  <select
                    className="select"
                    value={eventMethod}
                    onChange={(e) => {
                      setEventMethod(e.target.value);
                      setLimit(50);
                    }}
                  >
                    <option value="all">전체 수단</option>
                    {Object.entries(methodNames).map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
                {(eventQuery ||
                  eventKind !== "all" ||
                  eventMethod !== "all") && (
                  <Button
                    onClick={() => {
                      setEventQuery("");
                      setEventKind("all");
                      setEventMethod("all");
                      setLimit(50);
                    }}
                  >
                    거래 검색 초기화
                  </Button>
                )}
              </div>
              <div className="commerce-result-summary" role="status">
                <strong>검색 결과 {events.length}건</strong>
                <span>결제 {money(matchingSales)}</span>
                <span>환불 {money(matchingRefunds)}</span>
                <strong>순수납 {money(matchingSales - matchingRefunds)}</strong>
              </div>
              <p className="commerce-note">
                검색 합계는 아래 거래 목록 기준입니다. 상단 매출과 CSV는 조회
                기간·담당 직원에 해당하는 전체 거래를 포함합니다.
              </p>
              {events.length ? (
                <>
                  <div className="table-wrap">
                    <table className="table commerce-table commerce-mobile-cards">
                      <thead>
                        <tr>
                          <th>처리일 / 고객</th>
                          <th>거래</th>
                          <th>수단</th>
                          <th className="numeric">금액</th>
                          <th className="optional-mobile">승인 · 거래번호</th>
                          <th>기록</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.slice(0, limit).map((event) => (
                          <tr key={`${event.eventType}-${event.id}`}>
                            <td>
                              <strong>
                                {event.customerName || "방문 고객"}
                              </strong>
                              <span className="commerce-secondary">
                                {event.date} {event.time}
                              </span>
                            </td>
                            <td data-label="거래">
                              <Badge
                                tone={
                                  event.eventType === "refund"
                                    ? "warning"
                                    : "success"
                                }
                              >
                                {event.eventType === "refund" ? "환불" : "결제"}
                              </Badge>
                            </td>
                            <td data-label="수단">
                              {methodNames[event.method]}
                            </td>
                            <td data-label="금액" className="numeric">
                              {event.eventType === "refund" ? "−" : ""}
                              <Money value={event.amount} />
                            </td>
                            <td
                              data-label="승인 · 거래번호"
                              className="optional-mobile"
                            >
                              {event.reference || "—"}
                            </td>
                            <td>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  navigate("payments", {
                                    transactionId: event.transactionId,
                                  })
                                }
                              >
                                상세
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {events.length > limit && (
                    <Button
                      variant="secondary"
                      onClick={() => setLimit((n) => n + 50)}
                    >
                      더 보기 ({limit} / {events.length})
                    </Button>
                  )}
                </>
              ) : (
                <EmptyState
                  title="조건에 맞는 거래가 없습니다"
                  description="검색어, 거래 유형 또는 결제 수단을 변경해 주세요."
                />
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
