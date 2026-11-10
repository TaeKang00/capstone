import React, { useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { DateInput } from "./DateInput.jsx";
import { PrivateWorkspaceContext } from "./PrivateWorkspaceContext";
let scrollLocks = 0,
  originalOverflow = "";
export function lockBodyScroll() {
  if (scrollLocks++ === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--scrollLocks === 0) document.body.style.overflow = originalOverflow;
  };
}
export function Button({
  variant = "secondary",
  busy,
  disabled,
  children,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`btn btn-${variant} ${className}`}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
export function Field({ label, help, error, children, className = "" }) {
  const id = useId();
  const helpId = `${id}-hint`;
  const labelId = `${id}-label`;
  let controlId;
  const decorate = (nodes) =>
    React.Children.map(nodes, (node) => {
      if (!React.isValidElement(node) || controlId) return node;
      if (
        ((typeof node.type === "string" &&
          ["input", "select", "textarea"].includes(node.type)) ||
          node.type === DateInput) &&
        node.props.type !== "hidden"
      ) {
        controlId = node.props.id || id;
        const description =
          [node.props["aria-describedby"], help || error ? helpId : ""]
            .filter(Boolean)
            .join(" ") || undefined;
        return React.cloneElement(node, {
          id: controlId,
          "aria-describedby": description,
          "aria-invalid": error ? true : node.props["aria-invalid"],
          ...(node.type === DateInput && typeof label === "string"
            ? { pickerLabel: label }
            : {}),
        });
      }
      return node.props.children
        ? React.cloneElement(node, {}, decorate(node.props.children))
        : node;
    });
  const contents = decorate(children);
  return (
    <div className={`field ${className}`}>
      <label id={labelId} className="field-label" htmlFor={controlId}>
        {label}
      </label>
      {controlId ? (
        contents
      ) : (
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={help || error ? helpId : undefined}
        >
          {contents}
        </div>
      )}
      {(error || help) && (
        <span id={helpId} className={error ? "error" : "help"}>
          {error || help}
        </span>
      )}
    </div>
  );
}
export function Badge({ tone = "muted", children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Money({ value }) {
  return (
    <span className="amount">
      {Number(value || 0).toLocaleString("ko-KR")}
      <small>원</small>
    </span>
  );
}
export function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  footer,
  dirty = false,
  size,
  icon,
  tone = "accent",
  subtitle,
}) {
  const ref = useRef(null);
  const lockPrivateWorkspace = useContext(PrivateWorkspaceContext);
  const titleId = useId();
  const [discard, setDiscard] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const closeRef = useRef();
  closeRef.current = () => {
    if (typeof onClose === "function") dirty ? setDiscard(true) : onClose();
  };
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("erp-modal-open", { detail: titleId }),
    );
    const before = document.activeElement;
    const unlockScroll = lockBodyScroll();
    const target =
      ref.current?.querySelector(
        "input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled])",
      ) ||
      ref.current?.querySelector("button:not([disabled])") ||
      ref.current;
    target?.focus();
    const key = (event) => {
      if (
        event.defaultPrevented ||
        !ref.current ||
        ref.current.closest(".modal-backdrop") !==
          [...document.querySelectorAll(".modal-backdrop")].at(-1)
      )
        return;
      if (event.key === "Escape") {
        // The first Escape belongs to an expanded native dropdown.
        if (
          CSS.supports("selector(select:open)") &&
          ref.current.querySelector("select:open")
        )
          return;
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const controls = [
          ...ref.current.querySelectorAll(
            'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
          ),
        ].filter((el) => el.getClientRects().length);
        const first = controls[0],
          last = controls.at(-1);
        if (!controls.length) event.preventDefault();
        else if (!ref.current.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const unload = (event) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      window.dispatchEvent(
        new CustomEvent("erp-modal-close", { detail: titleId }),
      );
      unlockScroll();
      document.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", unload);
      before?.focus?.();
    };
  }, []);
  return createPortal(
    <>
      <div
        className="modal-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) closeRef.current();
        }}
      >
        <section
          ref={ref}
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-labelledby={titleId}
          data-dirty={dirty}
          data-busy={typeof onClose !== "function"}
          className={`modal ${size === "wide" ? "modal-wide" : ""}`}
        >
          <header className={`modal-header${icon ? " has-icon" : ""}`}>
            {icon && (
              <span className={`modal-icon modal-icon-${tone}`} aria-hidden="true">
                <Icon name={icon} />
              </span>
            )}
            <span className="modal-title">
              <h2 id={titleId}>{title}</h2>
              {subtitle && <span className="modal-subtitle">{subtitle}</span>}
            </span>
            {lockPrivateWorkspace && (
              <button
                type="button"
                className="icon-btn private-dialog-lock"
                aria-label="보호 화면 잠그기"
                title="보호 화면 잠그기"
                onClick={() => lockPrivateWorkspace()}
              >
                <Icon name="lock" />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label="닫기"
              onClick={() => closeRef.current()}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </section>
      </div>
      {discard && (
        <ConfirmDialog
          title="작성 중인 내용을 닫을까요?"
          onClose={() => setDiscard(false)}
          onConfirm={onClose}
          confirmLabel="내용 버리고 닫기"
          variant="danger"
        >
          <span>저장하지 않은 내용이 사라져요</span>
          <span className="muted">닫으면 되돌릴 수 없어요</span>
        </ConfirmDialog>
      )}
    </>,
    document.body,
  );
}
export function ConfirmDialog({
  title,
  children,
  onConfirm,
  onClose,
  busy,
  confirmLabel = "확인",
  variant = "primary",
  icon,
}) {
  return (
    <Modal
      title={title}
      icon={icon || (variant === "danger" ? "alert" : "info")}
      tone={variant === "danger" ? "danger" : "accent"}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            돌아가기
          </Button>
          <Button variant={variant} onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm-body">{children}</div>
    </Modal>
  );
}
