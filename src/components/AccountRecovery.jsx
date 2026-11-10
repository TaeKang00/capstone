import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Field, Modal, ConfirmDialog } from "./ui";

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
    <section className="card">
      <div className="card-header">
        <h2>원장 계정 복구</h2>
      </div>
      <div className="card-body stack">
        <p>
          아이디와 비밀번호를 잊었을 때 사용할 일회용 복구 코드입니다. 원장만
          접근할 수 있는 별도 장소에 보관하세요.
        </p>
        <p className="help">
          {available
            ? "복구 코드가 발급되어 있습니다."
            : "사용 가능한 복구 코드가 없습니다."}{" "}
          비밀번호를 변경하면 새 코드를 발급받아야 합니다.
        </p>
        {error && (
          <p className="alert alert-danger" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button onClick={() => setConfirm(true)}>
            {available ? "복구 코드 재발급" : "복구 코드 발급"}
          </Button>
        </div>
        {code && (
          <>
            <Field label="일회용 복구 코드">
              <input
                className="input"
                value={code}
                readOnly
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <p className="help">
              이 화면을 닫으면 코드를 다시 볼 수 없습니다. 새로 발급하면 이전
              코드는 무효가 됩니다.
            </p>
            <div>
              <Button onClick={save}>복구 코드 파일 저장</Button>
            </div>
          </>
        )}
        {confirm && (
          <ConfirmDialog
            title="복구 코드를 발급할까요?"
            confirmLabel="새 코드 발급"
            onClose={busy ? undefined : () => setConfirm(false)}
            onConfirm={issue}
            busy={busy}
          >
            기존 복구 코드는 사용할 수 없게 됩니다. 새 코드를 안전한 곳에 보관해
            주세요.
          </ConfirmDialog>
        )}
      </div>
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
      return setError("새 비밀번호 확인이 일치하지 않습니다.");
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
      onClose={busy ? undefined : onClose}
      footer={
        result ? (
          <Button onClick={() => onRecovered(result.loginId)} variant="primary">
            로그인으로 돌아가기
          </Button>
        ) : (
          <Button
            type="submit"
            form="account-recovery"
            variant="primary"
            busy={busy}
          >
            원장 계정 복구
          </Button>
        )
      }
    >
      {result ? (
        <div className="stack">
          <p>
            원장 아이디: <strong>{result.loginId}</strong>
          </p>
          <p>{result.message}</p>
        </div>
      ) : (
        <form id="account-recovery" className="stack" onSubmit={submit}>
          <fieldset className="stack commerce-fieldset" disabled={busy}>
            <p>
              직원 계정은 원장에게 재설정을 요청하세요. 원장은 설정에서 미리
              발급받은 복구 코드로 아이디 확인과 비밀번호 재설정을 할 수
              있습니다.
            </p>
            <p className="help">
              복구 코드도 없으면 서버 운영자에게 복구를 요청하세요. 로컬 시연
              계정은 서버 종료 후 프로젝트 폴더에서 npm run setup:demo로
              재설정할 수 있습니다.
            </p>
            {error && (
              <p role="alert" className="alert alert-danger">
                {error}
              </p>
            )}
            <Field label="원장 복구 코드">
              <input
                className="input"
                required
                autoComplete="off"
                maxLength={100}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field label="새 비밀번호">
              <input
                className="input"
                required
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="새 비밀번호 확인">
              <input
                className="input"
                required
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Field>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
