import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "./ui";
export function AutomaticBackup() {
  const [status, setStatus] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      api("/admin/backup-status")
        .then((r) => {
          if (live) {
            setStatus(r);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    refresh();
    const t = setInterval(refresh, 60000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  async function run() {
    setBusy(true);
    setError("");
    try {
      setStatus(await api("/admin/backup-run", { method: "POST" }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <h3>자동 백업 상태</h3>
      {error && (
        <p role="alert" className="alert alert-danger">
          {error}
        </p>
      )}
      {status && (
        <>
          <p>
            {status.enabled
              ? `서버 실행 중 하루 한 번 자동 백업 · 최근 ${status.retention}개 보관`
              : "자동 백업이 꺼져 있습니다. 서버 설정을 확인하세요."}
          </p>
          <p>
            마지막 성공:{" "}
            {status.lastSuccess
              ? new Date(status.lastSuccess).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })
              : "아직 백업되지 않았습니다."}
          </p>
          {status.lastError && (
            <p role="alert" className="alert alert-danger">
              {status.lastError}
            </p>
          )}
          {status.directory && (
            <p className="help">서버 보관 위치: {status.directory}</p>
          )}
          <p className="help">
            서버를 꺼 두면 실행되지 않습니다. 같은 디스크의 백업은 PC 고장에
            대비할 수 없으므로 아래 다운로드로 별도 저장소에도 보관하세요.
          </p>
          <div>
            <Button onClick={run} busy={busy} disabled={!status.enabled}>
              지금 서버에 백업
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
