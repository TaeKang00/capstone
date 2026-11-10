import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Field, Modal, ConfirmDialog } from "./ui";
import { Icon } from "./Icon";
import { PasswordField, PasswordRules } from "./PasswordField";

export function RecoveryAccessPanel() {
  const [available, setAvailable] = useState(false),
    [code, setCode] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api("/admin/recovery")
      .then((r) => {
        if (live) setAvailable(r.available);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function issue() {
    setBusy(true);
    setError("");
    try {
      const r = await api("/admin/recovery", { method: "POST" });
      setCode(r.code);
      setAvailable(true);
      setConfirm(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function save() {
    const blob = new Blob(
      [
        `살롱 데스크 원장 계정 복구 코드\n${code}\n\n로그인 화면 → 아이디나 비밀번호를 잊었어요에서 사용하세요. 일회용이며 재발급·비밀번호 변경 후에는 기존 코드를 사용할 수 없습니다.\n공용 PC나 ERP 자료 폴더에 보관하지 마세요.\n`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "살롱데스크_원장_복구코드.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel recovery-panel" aria-labelledby="recovery-title">
      <div className="recovery-head">
        <span className="modal-icon modal-icon-accent" aria-hidden="true">
          <Icon name="lock" />
        </span>
        <span className="recovery-head-text">
          <span className="recovery-title-row">
            <h2 id="recovery-title">원장 계정 복구 코드</h2>
            <span className={`status-pill status-${available ? "ok" : "muted"}`}>
              {available ? "발급됨" : "없음"}
            </span>
          </span>
          <span className="muted">아이디와 비밀번호를 잊었을 때 쓰는 일회용 코드예요</span>
        </span>
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          <Icon name="refresh" size={16} />
          {available ? "복구 코드 재발급" : "복구 코드 발급"}
        </Button>
      </div>
      {error && (
        <p className="alert alert-danger" role="alert">
          {error}
        </p>
      )}
      {code && (
        <div className="recovery-code">
          <Field label="일회용 복구 코드" help="이 화면을 닫으면 다시 볼 수 없어요. 지금 꼭 저장해 두세요">
            <input
              className="input num recovery-code-input"
              value={code}
              readOnly
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Button variant="primary" onClick={save}>
            <Icon name="download" size={16} />
            복구 코드 파일 저장
          </Button>
        </div>
      )}
      <div className="confirm-body">
        <span>원장만 열 수 있는 곳에 보관해 주세요</span>
        <span className="muted">공용 PC나 매장 자료 폴더에는 두지 마세요</span>
        <span className="muted">새로 발급하면 이전 코드는 못 써요</span>
        <span className="muted">비밀번호를 바꾸면 새 코드를 받아야 해요</span>
      </div>
        {confirm && (
          <ConfirmDialog
            title="복구 코드를 발급할까요?"
            confirmLabel="새 코드 발급"
            onClose={busy ? undefined : () => setConfirm(false)}
            onConfirm={issue}
            busy={busy}
          >
            <span>지금 있는 복구 코드는 쓸 수 없게 돼요</span>
            <span className="muted">새 코드는 한 번만 보여요</span>
            <span className="muted">새 코드를 안전한 곳에 보관해 주세요</span>
          </ConfirmDialog>
        )}
    </section>
  );
}
export function AccountRecoveryDialog({ onClose, onRecovered }) {
  const [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirmation)
      return setError("새 비밀번호 확인이 일치하지 않아요.");
    setBusy(true);
    setError("");
    try {
      const r = await api("/auth/recover", {
        method: "POST",
        body: { code, newPassword: password },
      });
      setResult(r);
      setCode("");
      setPassword("");
      setConfirmation("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="아이디와 비밀번호 찾기"
      icon="lock"
      subtitle={result ? "계정을 찾았어요" : "복구 코드로 아이디를 확인하고 비밀번호를 바꿔요"}
      onClose={busy ? undefined : onClose}
      footer={
        result ? (
          <Button onClick={() => onRecovered(result.loginId)} variant="primary">
            로그인으로 돌아가기
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              취소
            </Button>
            <Button type="submit" form="account-recovery" variant="primary" busy={busy}>
              원장 계정 복구
            </Button>
          </>
        )
      }
    >
      {result ? (
        <>
          <div className="recovery-result">
            <span className="field-label">원장 아이디</span>
            <strong>{result.loginId}</strong>
          </div>
          <div className="confirm-body">
            <span>새 비밀번호로 바꿨어요</span>
            <span className="muted">다른 기기에 로그인된 계정은 로그아웃돼요</span>
            <span className="muted">쓴 복구 코드는 다시 쓸 수 없어요</span>
          </div>
        </>
      ) : (
        <form id="account-recovery" className="stack" onSubmit={submit}>
          <fieldset className="stack" disabled={busy}>
            <div className="confirm-body">
              <span>원장 계정만 여기서 찾을 수 있어요</span>
              <span className="muted">직원 계정은 원장에게 재설정을 요청해 주세요</span>
            </div>
            {error && (
              <p role="alert" className="alert alert-danger">
                {error}
              </p>
            )}
            <Field label="원장 복구 코드" help="설정에서 미리 받아 둔 일회용 코드예요">
              <input
                className="input num"
                required
                autoComplete="off"
                maxLength={100}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field label="새 비밀번호">
              <PasswordField
                label="새 비밀번호"
                minLength={12}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="새 비밀번호 확인">
              <PasswordField
                label="새 비밀번호 확인"
                minLength={12}
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Field>
            <PasswordRules value={password} confirm={confirmation} />
            <div className="confirm-body">
              <span>복구 코드가 없나요?</span>
              <span className="muted">서버 운영자에게 복구를 요청해 주세요</span>
              <span className="muted">로컬 시연 계정은 서버를 끈 뒤 npm run setup:demo로 다시 만들 수 있어요</span>
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
