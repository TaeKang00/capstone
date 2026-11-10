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
import "./DateInput.css";

const toMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const label = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Native time input (typing and form validity stay native) with a dark popover list
 * of times instead of the browser's picker. `interval` is in minutes.
 */
export const TimeInput = forwardRef(function TimeInput(
  { className = "", interval = 30, pickerLabel, onKeyDown, ...props },
  forwardedRef,
) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  useImperativeHandle(forwardedRef, () => inputRef.current);
  const inactive = props.disabled || props.readOnly;
  const name = pickerLabel || props["aria-label"] || "";
  const min = toMinutes(props.min) ?? 0;
  const max = toMinutes(props.max) ?? 24 * 60 - 1;
  const step = Math.max(5, Number(interval) || 30);
  const options = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) options.push(t);
  const current = toMinutes(props.value ?? inputRef.current?.value);

  function close(restoreFocus = false) {
    if (panelRef.current?.hidePopover && panelRef.current.matches(":popover-open"))
      panelRef.current.hidePopover();
    setOpen(false);
    if (restoreFocus) inputRef.current?.focus({ preventScroll: true });
  }
  function commit(minutes) {
    const input = inputRef.current;
    if (!input || inactive) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, label(minutes));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close(true);
  }
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    if (panel.showPopover && !panel.matches(":popover-open")) panel.showPopover();
    function position() {
      const anchor = (inputRef.current || rootRef.current)?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 12;
      const width = Math.max(160, Math.min(anchor.width, window.innerWidth - margin * 2));
      panel.style.width = `${width}px`;
      const height = panel.getBoundingClientRect().height;
      const below = window.innerHeight - anchor.bottom - margin;
      const above = anchor.top - margin;
      const top = below >= height || below >= above ? anchor.bottom + 8 : anchor.top - height - 8;
      panel.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`;
      panel.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
    }
    position();
    const target =
      panel.querySelector('[aria-selected="true"]') ||
      [...panel.querySelectorAll("[data-minutes]")].find((el) => Number(el.dataset.minutes) >= (current ?? 600)) ||
      panel.querySelector("[data-minutes]");
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);
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
  const listKey = (event) => {
    const items = [...panelRef.current.querySelectorAll("[data-minutes]")];
    const index = items.indexOf(document.activeElement);
    const move = { ArrowDown: 1, ArrowUp: -1, PageDown: 4, PageUp: -4 }[event.key];
    if (move) {
      event.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, index + move))]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items.at(-1))?.focus();
    }
  };
  return (
    <span
      ref={rootRef}
      className="date-input-control time-input-control"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
      onBlur={(event) => {
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <input
        {...props}
        ref={inputRef}
        type="time"
        step={props.step ?? 60}
        className={`date-input-native ${className}`}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && ((event.altKey && event.key === "ArrowDown") || event.key === "F4")) {
            event.preventDefault();
            if (!inactive) setOpen(true);
          }
        }}
      />
      <button
        type="button"
        className="date-input-trigger"
        aria-label={`${name ? `${name} ` : ""}시간 고르기`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={inactive}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <Icon name="clock" size={20} />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={id}
          popover="manual"
          role="listbox"
          aria-label={`${name ? `${name} ` : ""}시간`}
          className="date-picker-panel time-picker-panel"
          onKeyDown={listKey}
        >
          {options.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="option"
              data-minutes={minutes}
              aria-selected={minutes === current}
              className="time-picker-option"
              onClick={() => commit(minutes)}
            >
              {label(minutes)}
            </button>
          ))}
          {!options.length && <span className="time-picker-empty">고를 수 있는 시간이 없어요</span>}
        </div>
      )}
    </span>
  );
});
export default TimeInput;
