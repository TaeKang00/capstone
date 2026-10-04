import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
        typeof node.type === "string" &&
        ["input", "select", "textarea"].includes(node.type) &&
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
      <span className="empty-icon" aria-hidden="true">
        ＋
      </span>
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
}) {
  const ref = useRef(null);
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const target =
      ref.current?.querySelector(
        "input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled])",
      ) ||
      ref.current?.querySelector("button:not([disabled])") ||
      ref.current;
    target?.focus();
    const key = (event) => {
      if (
        !ref.current ||
        ref.current.closest(".modal-backdrop") !==
          [...document.querySelectorAll(".modal-backdrop")].at(-1)
      )
        return;
      if (event.key === "Escape") {
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
      document.body.style.overflow = previousOverflow;
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
          className={`modal ${size === "wide" ? "modal-wide" : ""}`}
        >
          <header className="modal-header">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="닫기"
              onClick={() => closeRef.current()}
            >
              ×
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
          저장하지 않은 변경사항이 사라집니다.
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
}) {
  return (
    <Modal
      title={title}
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
      <div className="stack">{children}</div>
    </Modal>
  );
}
