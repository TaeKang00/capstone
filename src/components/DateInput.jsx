import React, {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "./Icon";
import { today as todayInSeoul } from "../api";
import "./DateInput.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (number) => String(number).padStart(2, "0");
const dayKey = (date) =>
  `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const monthKey = (date) => dayKey(date).slice(0, 7);
function makeDate(year, month = 0, day = 1) {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}
function parseDate(value, monthOnly = false) {
  const match = String(value || "").match(
    monthOnly ? /^(\d{4})-(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/,
  );
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3] || 1),
  ];
  const date = makeDate(year, month - 1, day);
  return year >= 1 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}
function moveMonth(date, amount) {
  const first = makeDate(date.getFullYear(), date.getMonth() + amount);
  return makeDate(
    first.getFullYear(),
    first.getMonth(),
    Math.min(
      date.getDate(),
      makeDate(first.getFullYear(), first.getMonth() + 1, 0).getDate(),
    ),
  );
}

/** Retains the native editable input and its validation, with an accessible calendar. */
export const DateInput = forwardRef(function DateInput(
  { type = "date", pickerLabel, className = "", onKeyDown, ...props },
  forwardedRef,
) {
  const monthOnly = type === "month";
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const focusNext = useRef(false);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(monthOnly ? "months" : "days");
  const [focused, setFocused] = useState(() => parseDate(todayInSeoul()));
  const [view, setView] = useState(focused);
  const minimum = parseDate(props.min, monthOnly) || makeDate(1);
  const maximum =
    parseDate(props.max, monthOnly) || makeDate(9999, 11, monthOnly ? 1 : 31);
  const todayDate = parseDate(todayInSeoul());
  const today = monthOnly
    ? makeDate(todayDate.getFullYear(), todayDate.getMonth())
    : todayDate;
  const selected = parseDate(props.value ?? props.defaultValue, monthOnly);
  const allowed = (date) => date >= minimum && date <= maximum;
  const clamp = (date) =>
    date < minimum ? minimum : date > maximum ? maximum : date;
  const monthAllowed = (date) =>
    makeDate(date.getFullYear(), date.getMonth() + 1, 0) >= minimum &&
    makeDate(date.getFullYear(), date.getMonth()) <= maximum;
  const inactive = props.disabled || props.readOnly;
  const name = pickerLabel || props["aria-label"] || "";
  const title = `${name ? `${name} ` : ""}${monthOnly ? "월 선택" : "날짜 선택"}`;

  useImperativeHandle(forwardedRef, () => inputRef.current);

  function close(restoreFocus = false) {
    if (
      panelRef.current?.hidePopover &&
      panelRef.current.matches(":popover-open")
    )
      panelRef.current.hidePopover();
    setOpen(false);
    if (restoreFocus) inputRef.current?.focus({ preventScroll: true });
  }

  function show() {
    if (inactive) return;
    const current = parseDate(inputRef.current?.value, monthOnly) || today;
    const next = clamp(current);
    setFocused(next);
    setView(next);
    setMode(monthOnly ? "months" : "days");
    focusNext.current = true;
    setOpen(true);
  }

  function commit(date) {
    const input = inputRef.current;
    if (!input || inactive) return;
    // Use the real input event so controlled handlers and form validity keep working.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, date ? (monthOnly ? monthKey(date) : dayKey(date)) : "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close(true);
  }

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    if (panel.showPopover && !panel.matches(":popover-open"))
      panel.showPopover();
    function position() {
      // Anchor to the visible field so the calendar opens below it, never over it.
      const anchor = (inputRef.current || rootRef.current)?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 12;
      const width = Math.min(336, window.innerWidth - margin * 2);
      panel.style.width = `${width}px`;
      const height = panel.getBoundingClientRect().height;
      const below = window.innerHeight - anchor.bottom - margin;
      const above = anchor.top - margin;
      const top =
        below >= height || below >= above
          ? anchor.bottom + 8
          : anchor.top - height - 8;
      panel.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`;
      panel.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
      panel.style.maxHeight = `${window.innerHeight - margin * 2}px`;
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    if (focusNext.current) {
      focusNext.current = false;
      const key = mode === "months" ? monthKey(focused) : dayKey(focused);
      (
        panel.querySelector(`[data-date-key="${key}"]:not(:disabled)`) ||
        panel.querySelector("button:not(:disabled)")
      )?.focus({ preventScroll: true });
    }
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, view, mode, focused]);

  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!rootRef.current?.contains(event.target)) close();
    };
    const otherModal = () => close();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("erp-modal-open", otherModal);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("erp-modal-open", otherModal);
    };
  }, [open]);

  useEffect(() => {
    if (inactive && open) close();
  }, [inactive, open]);

  function navigate(amount) {
    const next = clamp(
      moveMonth(view, mode === "months" ? amount * 12 : amount),
    );
    setView(next);
    setFocused(next);
  }

  function gridKey(event) {
    let next;
    const months = mode === "months";
    switch (event.key) {
      case "ArrowLeft":
        next = months
          ? moveMonth(focused, -1)
          : makeDate(
              focused.getFullYear(),
              focused.getMonth(),
              focused.getDate() - 1,
            );
        break;
      case "ArrowRight":
        next = months
          ? moveMonth(focused, 1)
          : makeDate(
              focused.getFullYear(),
              focused.getMonth(),
              focused.getDate() + 1,
            );
        break;
      case "ArrowUp":
        next = months
          ? moveMonth(focused, -3)
          : makeDate(
              focused.getFullYear(),
              focused.getMonth(),
              focused.getDate() - 7,
            );
        break;
      case "ArrowDown":
        next = months
          ? moveMonth(focused, 3)
          : makeDate(
              focused.getFullYear(),
              focused.getMonth(),
              focused.getDate() + 7,
            );
        break;
      case "Home":
        next = months
          ? makeDate(focused.getFullYear())
          : makeDate(
              focused.getFullYear(),
              focused.getMonth(),
              focused.getDate() - focused.getDay(),
            );
        break;
      case "End":
        next = months
          ? makeDate(focused.getFullYear(), 11)
          : makeDate(
              focused.getFullYear(),
              focused.getMonth(),
              focused.getDate() + 6 - focused.getDay(),
            );
        break;
      case "PageUp":
        next = moveMonth(focused, months || event.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        next = moveMonth(focused, months || event.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    next = clamp(next);
    focusNext.current = true;
    setFocused(next);
    setView(next);
  }

  function chooseMonth(date) {
    if (monthOnly) commit(date);
    else {
      const next = clamp(date);
      focusNext.current = true;
      setFocused(next);
      setView(next);
      setMode("days");
    }
  }

  const year = view.getFullYear();
  const month = view.getMonth();
  const start = makeDate(year, month, 1 - makeDate(year, month).getDay());
  const rows = Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 7 }, (_, col) =>
      makeDate(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + row * 7 + col,
      ),
    ),
  );
  const previous =
    mode === "months" ? makeDate(year - 1, 11, 31) : makeDate(year, month, 0);
  const next =
    mode === "months" ? makeDate(year + 1) : makeDate(year, month + 1);
  const focusedKey = mode === "months" ? monthKey(focused) : dayKey(focused);

  return (
    <span
      ref={rootRef}
      className="date-input-control"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
      onBlur={(event) => {
        if (
          open &&
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          close();
      }}
    >
      <input
        {...props}
        ref={inputRef}
        type={type}
        className={`date-input-native ${className}`}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            ((event.altKey && event.key === "ArrowDown") || event.key === "F4")
          ) {
            event.preventDefault();
            show();
          }
        }}
      />
      <button
        type="button"
        className="date-input-trigger"
        aria-label={`${name ? `${name} ` : ""}${monthOnly ? "월 선택 열기" : "달력 열기"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={inactive}
        onClick={() => (open ? close(true) : show())}
      >
        <Icon name="calendar" size={20} />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={id}
          popover="manual"
          role="dialog"
          aria-label={title}
          className="date-picker-panel"
        >
          <div className="date-picker-heading">
            <button
              type="button"
              className="date-picker-nav"
              aria-label={mode === "months" ? "이전 연도" : "이전 달"}
              disabled={previous < minimum || previous.getFullYear() < 1}
              onClick={() => navigate(-1)}
            >
              <Icon name="chevron-left" size={20} />
            </button>
            {mode === "days" ? (
              <button
                type="button"
                className="date-picker-period"
                aria-label={`${year}년 ${month + 1}월, 월 선택으로 전환`}
                onClick={() => {
                  setMode("months");
                  focusNext.current = true;
                }}
              >
                {year}년 {month + 1}월
                <Icon name="chevron-down" size={20} />
              </button>
            ) : (
              <strong className="date-picker-period" aria-live="polite">
                {year}년
              </strong>
            )}
            <button
              type="button"
              className="date-picker-nav"
              aria-label={mode === "months" ? "다음 연도" : "다음 달"}
              disabled={next > maximum || next.getFullYear() > 9999}
              onClick={() => navigate(1)}
            >
              <Icon name="chevron-right" size={20} />
            </button>
          </div>
          <span className="date-picker-announcement" aria-live="polite">
            {year}년 {mode === "days" ? `${month + 1}월` : "월 선택"}
          </span>
          {mode === "days" ? (
            <div
              role="grid"
              aria-label={`${year}년 ${month + 1}월`}
              className="date-picker-grid"
              onKeyDown={gridKey}
            >
              <div role="row" className="date-picker-week">
                {WEEKDAYS.map((day, index) => (
                  <span
                    role="columnheader"
                    key={day}
                    className={index === 0 ? "date-picker-sunday" : ""}
                  >
                    {day}
                  </span>
                ))}
              </div>
              {rows.map((row, index) => (
                <div role="row" className="date-picker-week" key={index}>
                  {row.map((date) => {
                    const key = dayKey(date);
                    const isSelected = selected && key === dayKey(selected);
                    const isToday = key === dayKey(today);
                    return (
                      <span
                        role="gridcell"
                        aria-selected={Boolean(isSelected)}
                        key={key}
                      >
                        <button
                          type="button"
                          data-date-key={key}
                          aria-label={`${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`}
                          aria-current={isToday ? "date" : undefined}
                          className={`date-picker-day${date.getMonth() !== month ? " is-outside" : ""}${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}${date.getDay() === 0 ? " is-sunday" : ""}`}
                          disabled={!allowed(date)}
                          tabIndex={key === focusedKey ? 0 : -1}
                          onClick={() => commit(date)}
                          onFocus={() => setFocused(date)}
                        >
                          {date.getDate()}
                        </button>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div
              role="grid"
              aria-label={`${year}년 월 선택`}
              className="date-picker-month-grid"
              onKeyDown={gridKey}
            >
              {Array.from({ length: 4 }, (_, row) => (
                <div role="row" className="date-picker-month-row" key={row}>
                  {Array.from({ length: 3 }, (_, col) => {
                    const date = makeDate(year, row * 3 + col);
                    const key = monthKey(date);
                    const isSelected = selected && key === monthKey(selected);
                    return (
                      <span
                        role="gridcell"
                        aria-selected={Boolean(isSelected)}
                        key={key}
                      >
                        <button
                          type="button"
                          data-date-key={key}
                          aria-label={`${year}년 ${date.getMonth() + 1}월`}
                          aria-current={
                            key === monthKey(today) ? "date" : undefined
                          }
                          className={`date-picker-month${key === monthKey(today) ? " is-today" : ""}${isSelected ? " is-selected" : ""}`}
                          disabled={!monthAllowed(date)}
                          tabIndex={key === focusedKey ? 0 : -1}
                          onClick={() => chooseMonth(date)}
                          onFocus={() => setFocused(clamp(date))}
                        >
                          {date.getMonth() + 1}월
                        </button>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <div className="date-picker-footer">
            <button
              type="button"
              disabled={!allowed(today)}
              onClick={() => commit(today)}
            >
              {monthOnly ? "이번 달" : "오늘"}
            </button>
            {!props.required && (
              <button
                type="button"
                className="date-picker-clear"
                disabled={!inputRef.current?.value}
                onClick={() => commit(null)}
              >
                선택 지우기
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  );
});

export default DateInput;
