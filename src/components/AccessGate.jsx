import React, { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import { Button, Field, Modal } from "./ui";
import { Icon } from "./Icon";
import "./AccessGate.css";

const COPY = {
  operator: {
    title: "작업자 로그인",
    description: "본인 계정으로 업무를 시작해 주세요",
    submit: "작업자 로그인",
    notes: ["저장한 내용에는 로그인한 작업자가 남아요", "자리를 비울 때는 공용 화면으로 돌아가 주세요"],
    icon: "user",
  },
  owner: {
    title: "원장 관리 열기",
    description: "직원, 급여, 매출은 원장만 볼 수 있어요",
    submit: "열기",
    notes: ["3분 동안 쓰지 않으면 다시 잠겨요", "다른 탭으로 옮겨도 잠겨요"],
    icon: "lock",
  },
  personal: {
    title: "내 급여명세 본인 인증",
    description: "확정된 내 급여명세만 볼 수 있어요",
    submit: "본인 인증",
    notes: ["3분 동안 쓰지 않으면 다시 잠겨요", "다른 탭으로 옮겨도 잠겨요"],
    icon: "payroll",
  },
};

export function AccessGate({
  kind = "operator",
  session,
  onAuthenticated,
  onUnlocked,
  onClose,
}) {
  const copy = COPY[kind] || COPY.operator;
  const personal = kind === "personal";
  const personalAvailable =
    !personal ||
    (session?.mode === "work" &&
      Boolean(session?.user?.loginId || session?.user?.email));
  const formId = useId();
  const passwordRef = useRef(null);
  const pending = useRef(false);
  // A signed-in owner only re-enters the password; shared PCs still type the ID.
  const [loginId, setLoginId] = useState(
    kind === "owner" &&
      session?.mode === "work" &&
      session?.user?.role === "owner"
      ? session.user.loginId || session.user.email || ""
      : "",
  );
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (loginId) passwordRef.current?.focus();
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (pending.current || !personalAvailable) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const credentials = {
        loginId: personal
          ? session.user.loginId || session.user.email
          : loginId.trim(),
        password,
      };
      const result = await api(
        kind === "operator" ? "/auth/login" : "/auth/private/unlock",
        {
          method: "POST",
          body:
            kind === "operator" ? credentials : { ...credentials, scope: kind },
        },
      );
      setPassword("");
      if (kind === "operator") await onAuthenticated(result);
      else await onUnlocked(result);
    } catch (failure) {
      setPassword("");
      setError(failure.message || "인증하지 못했습니다. 다시 시도해 주세요.");
      requestAnimationFrame(() => passwordRef.current?.focus());
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={copy.title}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            busy={busy}
            disabled={!personalAvailable}
          >
            {copy.submit}
          </Button>
        </>
      }
    >
      <form id={formId} className="access-gate" onSubmit={submit}>
        <div className="access-gate-intro">
          <span className="access-gate-icon" aria-hidden="true">
            <Icon name={copy.icon} />
          </span>
          <p className="access-gate-description">{copy.description}</p>
        </div>
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        {!personalAvailable ? (
          <div className="alert alert-warning" role="alert">
            먼저 직원 본인 계정으로 작업자 로그인한 뒤 내 급여명세를 열어
            주세요.
          </div>
        ) : (
          <>
            {personal ? (
              <div className="access-gate-account">
                <span className="access-gate-account-label">인증할 계정</span>
                <strong>{session.user.name}</strong>
                <span>{session.user.loginId || session.user.email}</span>
              </div>
            ) : (
              <Field
                label={kind === "owner" ? "원장 아이디" : "아이디"}
              >
                <input
                  type="text"
                  name="loginId"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  disabled={busy}
                  maxLength={254}
                  required
                />
              </Field>
            )}
            <Field label="비밀번호">
              <input
                ref={passwordRef}
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                maxLength={128}
                required
              />
            </Field>
          </>
        )}
        <div className="access-gate-note">
          {copy.notes.map((line, index) => (
            <span key={line} className={index ? "muted" : ""}>
              {line}
            </span>
          ))}
        </div>
      </form>
    </Modal>
  );
}
