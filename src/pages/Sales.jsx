import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, download } from "../api";
import { Button, Field, Badge, EmptyState, Money } from "../components/ui";
import { DateRangePicker, niceDate } from "../components/DateRangePicker.jsx";
import { Icon } from "../components/Icon";
import {
  todayInSeoul,
  money,
  methodNames,
  monthStart,
  matchesSearch,
} from "./commerce-utils";
import { useViewState } from "../components/ViewState";
import "./Commerce.css";
import "./Sales.css";

const DAY = 86400000;
const shift = (value, days) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const weekStart = (value) =>
  shift(value, -new Date(`${value}T00:00:00Z`).getUTCDay());
const monthsBack = (value, n) => {
  const d = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1 - n, 1));
  return d.toISOString().slice(0, 10);
};
const lastMonth = (today) => {
  const to = shift(monthStart(today), -1);
  return { from: monthStart(to), to };
};
const span = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const short = (n) =>
  Math.abs(n) >= 10000 ? `${Math.round(n / 10000).toLocaleString("ko-KR")}만` : String(Math.round(n));
const DIMS = [
  ["staff", "디자이너별", "디자이너"],
  ["service", "시술별", "시술과 상품"],
  ["method", "결제 수단별", "결제 수단"],
];
const METRICS = [
  ["net", "순매출"],
  ["count", "건수"],
  ["avg", "객단가"],
];
const GRAINS = [
  ["day", "일별", "하루 단위"],
  ["week", "주별", "주 단위"],
  ["month", "월별", "최근 6개월 월 단위"],
];
const LIMIT = 10;

function periodsFor(today) {
  return [
    ["week", "이번 주", { from: weekStart(today), to: today }],
    ["month", "이번 달", { from: monthStart(today), to: today }],
    ["last", "지난달", lastMonth(today)],
    ["year", "올해", { from: `${today.slice(0, 4)}-01-01`, to: today }],
  ];
}

function useJson(path, deps, enabled = true) {
  const [state, setState] = useState({ busy: true, error: "", value: null });
  useEffect(() => {
    if (!enabled || !path) return;
    let live = true;
    const controller = new AbortController();
    setState((s) => ({ ...s, busy: true, error: "" }));
    api(path, { signal: controller.signal })
      .then((value) => live && setState({ busy: false, error: "", value }))
      .catch((err) => {
        if (live && err.name !== "AbortError")
          setState((s) => ({ ...s, busy: false, error: err.message }));
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [path, enabled, ...deps]);
  return state;
}

function TrendChart({ name, points }) {
  const [hover, setHover] = useState(null);
  const W = 1200, left = 56, right = 1188, top = 16, bottom = 248;
  // The SVG scales with its box, so tick labels are sized in view units to render at 14px.
  const plotRef = useRef(null);
  const [tick, setTick] = useState(14);
  useEffect(() => {
    const node = plotRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const update = () => node.clientWidth && setTick((14 * W) / node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const vmax = Math.max(0, ...points.map((p) => p.v));
  const vmin = Math.min(0, ...points.map((p) => p.v));
  const range = vmax - vmin || 1;
  const nice = Math.pow(10, Math.floor(Math.log10(range)));
  const ymax = vmax > 0 ? Math.ceil(vmax / nice) * nice : 0;
  const ymin = vmin < 0 ? Math.floor(vmin / nice) * nice : 0;
  const yspan = ymax - ymin || 1;
  const step = points.length > 1 ? (right - left) / (points.length - 1) : 0;
  const xy = points.map((p, i) => ({
    x: points.length > 1 ? left + i * step : (left + right) / 2,
    y: bottom - ((p.v - ymin) / yspan) * (bottom - top),
  }));
  const zero = bottom - ((0 - ymin) / yspan) * (bottom - top);
  const line = xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = xy.length
    ? `${line} L${xy.at(-1).x.toFixed(1)} ${zero.toFixed(1)} L${xy[0].x.toFixed(1)} ${zero.toFixed(1)} Z`
    : "";
  const every = Math.max(1, Math.ceil(points.length / 10));
  const grid = [0, 0.5, 1].map((f) => {
    const value = ymin + yspan * f;
    const y = bottom - f * (bottom - top);
    return { y, value };
  });
  const hit = Math.max(step, 24);
  const h = hover != null && hover < points.length ? hover : null;
  return (
    <div className="sales-trend-plot" ref={plotRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} 280`} role="img" aria-label={`${name} 순매출 선 그래프`}>
        {grid.map((g) => (
          <g key={g.y}>
            <line x1={left} x2={right} y1={g.y} y2={g.y} stroke="#1D1D24" strokeWidth="1" />
            <text x={left - 8} y={g.y + 4} textAnchor="end" fill="#8B8B96" fontSize={tick}>
              {short(g.value)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % every === 0 ? (
            <text key={p.key} x={xy[i].x} y="276" textAnchor="middle" fill="#8B8B96" fontSize={tick}>
              {p.tick}
            </text>
          ) : null,
        )}
        <path d={area} fill="rgba(76,125,255,.10)" stroke="none" />
        <path d={line} fill="none" stroke="#4C7DFF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.length === 1 && <circle cx={xy[0].x} cy={xy[0].y} r="4" fill="#4C7DFF" />}
        {h != null && (
          <>
            <line x1={xy[h].x} x2={xy[h].x} y1={top} y2={bottom} stroke="#2A2A33" strokeWidth="1" />
            <circle cx={xy[h].x} cy={xy[h].y} r="6" fill="#4C7DFF" stroke="#111116" strokeWidth="2" />
          </>
        )}
        {points.map((p, i) => (
          <rect
            key={p.key}
            x={xy[i].x - hit / 2}
            y="0"
            width={hit}
            height="256"
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {h != null && (
        <div
          className="sales-trend-tip"
          role="status"
          style={{ left: `${Math.min(90, Math.max(10, (xy[h].x / W) * 100)).toFixed(1)}%` }}
        >
          <span>{points[h].label}</span>
          <strong>{won(points[h].v)}</strong>
          <span>{points[h].c ? `${points[h].c}건` : "기록 없음"}</span>
        </div>
      )}
    </div>
  );
}

function group(days, series, counts, grain) {
  if (grain === "day")
    return days.map((day, i) => ({
      key: day,
      label: niceDate(day),
      tick: days[0].slice(0, 7) === days.at(-1).slice(0, 7) ? `${Number(day.slice(8))}일` : `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`,
      v: series[i],
      c: counts[i],
    }));
  const buckets = new Map();
  days.forEach((day, i) => {
    const key = grain === "week" ? weekStart(day) : day.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, { key, first: day, last: day, v: 0, c: 0 });
    const b = buckets.get(key);
    b.last = day;
    b.v += series[i];
    b.c += counts[i];
  });
  return [...buckets.values()].map((b, i) =>
    grain === "week"
      ? { ...b, label: `${niceDate(b.first)}부터 ${niceDate(b.last)}까지`, tick: `${i + 1}주` }
      : { ...b, label: `${b.key.slice(0, 4)}년 ${Number(b.key.slice(5))}월`, tick: `${Number(b.key.slice(5))}월` },
  );
}

export default function Sales({ data, user, navigate, version, routeContext, notify }) {
  const today = todayInSeoul();
  const periods = periodsFor(today);
  const [range, setRange] = useViewState("sales", "range2", { from: monthStart(today), to: today, period: "month" });
  const [dim, setDim] = useViewState("sales", "dim", "staff");
  const [metric, setMetric] = useViewState("sales", "metric", "net");
  const [grain, setGrain] = useViewState("sales", "grain", "day");
  const [picked, setPicked] = useState(null);
  const [more, setMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [eventKind, setEventKind] = useViewState("sales", "eventKind", "all");
  const [eventMethod, setEventMethod] = useViewState("sales", "eventMethod", "all");
  const [eventQuery, setEventQuery] = useViewState("sales", "eventQuery", "");
  const [limit, setLimit] = useState(50);
  const permitted = ["owner", "manager", "reception"].includes(user.role);
  const usedContext = useRef(null);
  useEffect(() => {
    if (!routeContext || routeContext === usedContext.current) return;
    usedContext.current = routeContext;
    if (routeContext.from && routeContext.to && routeContext.from <= routeContext.to) {
      setRange({ from: routeContext.from, to: routeContext.to, period: "custom" });
      setEventKind("all");
      setEventMethod("all");
      setEventQuery("");
      setLimit(50);
    }
  }, [routeContext]);
  const query = new URLSearchParams({ from: range.from, to: range.to }).toString();
  const reportState = useJson(`/reports?${query}`, [reload, version], permitted);
  const breakdownState = useJson(`/reports/breakdown?${query}`, [reload, version], permitted);
  const monthFrom = (() => {
    const back = monthsBack(range.to, 5);
    const from = back < range.from ? back : monthStart(range.from);
    return span(from, range.to) > 367 ? monthStart(range.to) : from;
  })();
  const monthState = useJson(
    `/reports/breakdown?${new URLSearchParams({ from: monthFrom, to: range.to })}`,
    [reload, version],
    permitted && grain === "month",
  );
  const report = reportState.value;
  const breakdown = breakdownState.value;
  const busy = reportState.busy || breakdownState.busy;
  const error = reportState.error || breakdownState.error;
  useEffect(() => {
    setPicked(null);
    setMore(false);
  }, [dim, range.from, range.to]);
  if (!permitted)
    return (
      <EmptyState
        title="매출 조회 권한이 없습니다"
        description="매장 매출은 원장, 매니저, 접수 직원이 확인할 수 있습니다."
      />
    );
  const dimLabel = DIMS.find(([k]) => k === dim)[2];
  const metricLabel = METRICS.find(([k]) => k === metric)[1];
  const rows = (breakdown?.dims?.[dim] || []).map((row) => ({
    ...row,
    avg: row.count ? Math.round(row.net / row.count) : 0,
  }));
  const total = breakdown?.total || { net: 0, count: 0, prevNet: 0 };
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name, "ko"));
  const fmt = (row) => (metric === "count" ? `${row.count}건` : won(row[metric]));
  let list = sorted;
  if (!more && sorted.length > LIMIT) {
    const rest = sorted.slice(LIMIT - 1);
    const folded = {
      key: "__rest",
      folded: true,
      name: `나머지 ${rest.length}개`,
      net: rest.reduce((t, r) => t + r.net, 0),
      count: rest.reduce((t, r) => t + r.count, 0),
    };
    folded.avg = folded.count ? Math.round(folded.net / folded.count) : 0;
    list = [...sorted.slice(0, LIMIT - 1), folded];
  }
  const max = Math.max(1, ...list.map((r) => r[metric]));
  const selected = sorted.find((r) => r.key === picked) || sorted[0] || null;
  const positiveTotal = rows.reduce((t, r) => t + Math.max(0, r.net), 0) || 1;
  const change = (now, before) =>
    before > 0
      ? (() => {
          const pct = Math.round(((now - before) / before) * 100);
          return pct === 0
            ? ["지난 기간과 같아요", ""]
            : pct > 0
              ? [`${pct}% 늘었어요`, "tone-up"]
              : [`${-pct}% 줄었어요`, "tone-down"];
        })()
      : ["지난 기간 기록이 없어요", "muted"];
  const seriesSource = (source) => {
    if (!source) return null;
    if (!selected) return { days: source.days, series: source.total.series, counts: source.total.seriesCount };
    const row = source.dims[dim].find((r) => r.key === selected.key);
    return {
      days: source.days,
      series: row ? row.series : source.days.map(() => 0),
      counts: row ? row.seriesCount : source.days.map(() => 0),
    };
  };
  const trendSource = grain === "month" ? seriesSource(monthState.value) : seriesSource(breakdown);
  const points = trendSource && trendSource.days.length ? group(trendSource.days, trendSource.series, trendSource.counts, grain) : [];
  const trendName = selected ? selected.name : "매장 전체";
  const [totalChange, totalTone] = change(total.net, total.prevNet);
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
  const exportUrl = `/export?${new URLSearchParams({ from: range.from, to: range.to })}`;
  const exportReport = async () => {
    setExporting(true);
    try {
      await download(exportUrl, `매출_${range.from}_${range.to}.csv`);
    } catch (err) {
      notify?.(err.message, "danger");
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="sales-page">
      <header className="sales-head">
        <h1 className="page-title">매출</h1>
        <div className="sales-range">
          <div className="seg" role="group" aria-label="빠른 기간">
            {periods.map(([key, label, value]) => (
              <button
                key={key}
                type="button"
                aria-pressed={range.period === key}
                onClick={() => {
                  setRange({ ...value, period: key });
                  setLimit(50);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <DateRangePicker
            label="조회 기간"
            from={range.from}
            to={range.to}
            today={today}
            onChange={(value) => {
              setRange({ ...value, period: "custom" });
              setLimit(50);
            }}
          />
          <Button variant="secondary" onClick={exportReport} busy={exporting}>
            <Icon name="download" size={20} />
            CSV 내보내기
          </Button>
        </div>
      </header>
      {error && (
        <div className="alert alert-danger" role="alert">
          <strong>매출을 불러오지 못했습니다.</strong>
          <p>{error}</p>
          <Button variant="secondary" onClick={() => setReload((n) => n + 1)}>
            다시 불러오기
          </Button>
        </div>
      )}
      {busy && !report && (
        <div className="panel" role="status" aria-live="polite">
          매출과 환불 내역을 모으고 있어요
        </div>
      )}
      {report && breakdown && (
        <>
          <div className="home-stats sales-stats">
            <div className="home-stat">
              <span className="home-stat-label">순매출</span>
              <strong className="home-stat-value"><Money value={report.net} /></strong>
              <span className={`small ${totalTone}`}>{totalChange}</span>
            </div>
            <div className="home-stat">
              <span className="home-stat-label">결제 건수</span>
              <strong className="home-stat-value">{report.count}건</strong>
              <span className="small muted">객단가 {money(report.count ? Math.round(report.gross / report.count) : 0)}</span>
            </div>
            <div className="home-stat">
              <span className="home-stat-label">환불</span>
              <strong className="home-stat-value"><Money value={report.refunds} /></strong>
              <span className="small muted">결제 {money(report.gross)}</span>
            </div>
          </div>
          <div className="sales-filters">
            <div className="chip-row" role="group" aria-label="무엇별로 볼까요">
              {DIMS.map(([key, label]) => (
                <button key={key} type="button" className="chip" aria-pressed={dim === key} onClick={() => setDim(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="기준">
              {METRICS.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="sales-grid">
            <section className="panel sales-rank" aria-labelledby="sales-rank-title">
              <div className="sales-panel-title">
                <h2 id="sales-rank-title">{`${dimLabel}별 ${metricLabel}`}</h2>
                <span className="small muted">{`${rows.length}개 항목 ${metricLabel} 높은 순`}</span>
              </div>
              {rows.length ? (
                <div className="sales-bars" role="list" aria-label={`${dimLabel}별 ${metricLabel}`}>
                  {list.map((row, index) => {
                    const on = !row.folded && selected && row.key === selected.key;
                    return (
                      <div role="listitem" key={row.key}>
                        <button
                          type="button"
                          className={`sales-bar${on ? " is-on" : ""}${row.folded ? " is-folded" : ""}`}
                          aria-pressed={row.folded ? undefined : on}
                          aria-label={row.folded ? `${row.name} 펼치기 ${fmt(row)}` : `${row.name} ${fmt(row)}`}
                          onClick={() => (row.folded ? setMore(true) : setPicked(row.key))}
                        >
                          <span className="sales-bar-rank">{row.folded ? "" : index + 1}</span>
                          <span className="sales-bar-name">{row.name}</span>
                          <span className="sales-bar-track" aria-hidden="true">
                            <span style={{ width: `${Math.max(2, Math.round((Math.max(0, row[metric]) / max) * 100))}%` }} />
                          </span>
                          <span className="sales-bar-value">{fmt(row)}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">이 기간에는 결제 기록이 없어요</p>
              )}
              {sorted.length > LIMIT && (
                <button type="button" className="text-btn sales-more" onClick={() => setMore(!more)}>
                  {more ? `상위 ${LIMIT - 1}개만 보기` : `나머지 ${sorted.length - LIMIT + 1}개 펼치기`}
                </button>
              )}
            </section>
            {selected && (
              <aside className="panel sales-detail" aria-labelledby="sales-detail-title">
                <div className="sales-panel-title">
                  <span className="small muted">{dimLabel}</span>
                  <h2 id="sales-detail-title">{selected.name}</h2>
                </div>
                <div className="sales-detail-stats">
                  {[
                    ["순매출", won(selected.net)],
                    ["비중", `${((Math.max(0, selected.net) / positiveTotal) * 100).toFixed(1)}%`],
                    ["건수", `${selected.count}건`],
                    ["객단가", won(selected.avg)],
                  ].map(([label, value]) => (
                    <div className="inset" key={label}>
                      <span className="small muted">{label}</span>
                      <strong className="num">{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="inset sales-detail-change">
                  <span className="small muted">지난 같은 기간과 비교</span>
                  <strong className={change(selected.net, selected.prevNet)[1]}>
                    {change(selected.net, selected.prevNet)[0]}
                  </strong>
                </div>
                {dim !== "method" && selected.top?.length > 0 && (
                  <div className="inset sales-detail-top">
                    <span className="small muted">{dim === "staff" ? "많이 한 시술" : "많이 한 디자이너"}</span>
                    {selected.top.map((x) => (
                      <div key={x.name}>
                        <span>{x.name}</span>
                        <span className="num">{x.count}건</span>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            )}
          </div>
          <section className="panel sales-trend" aria-labelledby="sales-trend-title">
            <div className="panel-head">
              <div className="sales-panel-title">
                <h2 id="sales-trend-title">{`${trendName} 날짜별 순매출`}</h2>
                <span className="small muted">{GRAINS.find(([k]) => k === grain)[2]}</span>
              </div>
              <div className="seg" role="group" aria-label="단위">
                {GRAINS.map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={grain === key} onClick={() => setGrain(key)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {grain === "month" && monthState.busy && !monthState.value ? (
              <p className="muted" role="status">월별 흐름을 모으고 있어요</p>
            ) : (
              <TrendChart name={trendName} points={points} />
            )}
            <span className="small muted">점 위에 마우스를 올리면 그날 숫자가 보여요</span>
          </section>
          <section className="panel" aria-labelledby="sales-method-title">
            <div className="sales-panel-title">
              <h2 id="sales-method-title">결제 수단별 정산</h2>
              <span className="small muted">단말기 마감표와 현금 시재를 맞춰 보세요</span>
            </div>
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
                      <td data-label="결제" className="numeric"><Money value={entry.gross} /></td>
                      <td data-label="환불" className="numeric"><Money value={entry.refunds} /></td>
                      <td data-label="순수납" className="numeric"><strong><Money value={entry.net} /></strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card sales-events">
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
                      placeholder="고객명, 담당자, 승인번호"
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
                검색 합계는 아래 목록 기준이에요. 위쪽 매출과 CSV는 고른 기간의
                모든 거래를 담아요.
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
                          <th className="optional-mobile">승인번호</th>
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
                              data-label="승인번호"
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
    </div>
  );
}
