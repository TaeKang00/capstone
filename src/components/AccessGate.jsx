import React, { useId, useRef, useState } from "react";
import { api } from "../api";
import { Button, Field, Modal } from "./ui";
import { Icon } from "./Icon";
import "./AccessGate.css";

const COPY = {
  operator: {
    title: "작업자 로그인",
    description: "본인 계정으로 업무를 시작해 주세요. 저장한 내용에는 실제 작업자가 기록됩니다.",
    submit: "작업자 로그인",
    note: "업무가 끝나거나 자리를 비울 때는 공용 화면으로 돌아가 주세요.",
  },
  owner: {
    title: "원장 관리 잠금 해제",
    description: "급여와 계정 권한을 관리하려면 원장 계정으로 다시 인증해 주세요.",
    submit: "원장 인증",
    note: "관리 화면을 나가거나 사용하지 않으면 자동으로 잠깁니다.",
  },
  personal: {
    title: "내 급여명세 본인 인증",
    description: "현재 로그인한 본인의 확정된 급여명세만 확인할 수 있습니다.",
    submit: "본인 인증",
    note: "급여 화면을 나가거나 사용하지 않으면 자동으로 잠깁니다.",
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
    !personal || (session?.mode === "work" && Boolean(session?.user?.email));
  const formId = useId();
  const passwordRef = useRef(null);
  const pending = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        email: personal ? session.user.email : email.trim(),
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
        <p className="access-gate-description">{copy.description}</p>
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        {!personalAvailable ? (
          <div className="alert alert-warning" role="alert">
            먼저 직원 본인 계정으로 작업자 로그인한 뒤 내 급여명세를 열어 주세요.
          </div>
        ) : (
          <>
            {personal ? (
              <div className="access-gate-account">
                <span className="access-gate-account-label">인증할 계정</span>
                <strong>{session.user.name}</strong>
                <span>{session.user.email}</span>
              </div>
            ) : (
              <Field label={kind === "owner" ? "원장 계정 이메일" : "계정 이메일"}>
                <input
                  type="email"
                  name="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
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
        <p className="access-gate-note">
          <Icon name="lock" size={16} />
          <span>{copy.note}</span>
        </p>
      </form>
    </Modal>
  );
}
