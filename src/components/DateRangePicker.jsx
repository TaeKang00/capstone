import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import "./DateInput.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const niceDate = (value) =>
  `${Number(value.slice(5, 7))}월 ${Number(value.slice(8, 10))}일`;
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

/** Pill trigger that expands a range calendar: pick start, pick end, then 적용. */
export function DateRangePicker({ from, to, today, max, maxDays = 367, onChange, label = "기간" }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => [Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1]);
  const [draft, setDraft] = useState({ from: null, to: null });
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const down = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        ref.current?.querySelector(".range-picker-trigger")?.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const toggle = () => {
    if (!open) {
      setView([Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1]);
      setDraft({ from: null, to: null });
    }
    setOpen(!open);
  };
  const [y, m] = view;
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dFrom = draft.from || from;
  const dTo = draft.from ? draft.to : to;
  const picking = draft.from && !draft.to;
  const tooLong = dFrom && dTo && daysBetween(dFrom, dTo) > maxDays;
  const pick = (value) => {
    if (!draft.from || draft.to) setDraft({ from: value, to: null });
    else if (value < draft.from) setDraft({ from: value, to: draft.from });
    else setDraft({ from: draft.from, to: value });
  };
  const hint = picking
    ? "끝나는 날을 골라 주세요"
    : tooLong
      ? `${maxDays}일 이내로 골라 주세요`
      : dFrom && dTo
        ? `${daysBetween(dFrom, dTo)}일 동안`
        : "시작하는 날을 골라 주세요";
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(iso(y, m, d));
  const move = (amount) => {
    const next = new Date(Date.UTC(y, m + amount, 1));
    setView([next.getUTCFullYear(), next.getUTCMonth()]);
  };
  const text = from === to ? niceDate(from) : `${niceDate(from)}부터 ${niceDate(to)}까지`;
  return (
    <div className="range-picker" ref={ref}>
      <button
        type="button"
        className="range-picker-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label} ${text} 달력 열기`}
        onClick={toggle}
      >
        <Icon name="calendar" size={20} />
        {text}
        <Icon name={open ? "chevron-up" : "chevron-down"} size={20} />
      </button>
      {open && (
        <div className="range-picker-panel" role="dialog" aria-label={`${label} 고르기`}>
          <div className="range-picker-head">
            <button type="button" aria-label="이전 달" onClick={() => move(-1)}>
              <Icon name="chevron-left" />
            </button>
            <strong aria-live="polite">{`${y}년 ${m + 1}월`}</strong>
            <button type="button" aria-label="다음 달" onClick={() => move(1)}>
              <Icon name="chevron-right" />
            </button>
          </div>
          <div className="range-picker-week" aria-hidden="true">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="range-picker-days">
            {cells.map((value, index) => {
              if (!value)
                return <button key={`b${index}`} type="button" className="is-blank" disabled tabIndex={-1} aria-hidden="true" />;
              const edge = value === dFrom || value === dTo;
              const inside = dFrom && dTo && value > dFrom && value < dTo;
              return (
                <button
                  key={value}
                  type="button"
                  data-date-key={value}
                  className={`${inside ? "is-inside" : ""} ${value === today ? "is-today" : ""}`}
                  aria-pressed={edge}
                  aria-label={`${niceDate(value)}${value === today ? " 오늘" : ""}`}
                  disabled={!!max && value > max}
                  onClick={() => pick(value)}
                >
                  {Number(value.slice(8))}
                </button>
              );
            })}
          </div>
          <span className="range-picker-hint" role="status">{hint}</span>
          <div className="range-picker-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              취소
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!picking || !!tooLong || !draft.from}
              onClick={() => {
                setOpen(false);
                onChange({ from: draft.from, to: draft.to });
              }}
            >
              적용
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default DateRangePicker;
