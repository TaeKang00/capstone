import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button } from "./ui";

/** "11월 10일 03:00" in Seoul time. */
function backupTime(value) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${Number(p.month)}월 ${Number(p.day)}일 ${p.hour}:${p.minute}`;
}

/** 자동 백업 card inside 데이터베이스 백업 (SettingsBackup.dc.html). */
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
    <>
      <div className="auto-backup">
        <div className="auto-backup-head">
          <h3>자동 백업</h3>
          {status && (
            <Badge tone={status.enabled ? "success" : "muted"}>
              {status.enabled ? "켜짐" : "꺼짐"}
            </Badge>
          )}
        </div>
        {error && (
          <p role="alert" className="alert alert-danger">
            {error}
          </p>
        )}
        {!status && !error && <span className="muted">상태를 불러오는 중이에요</span>}
        {status && (
          <>
            {status.enabled ? (
              <>
                <span>서버가 켜져 있으면 하루 한 번 백업해요</span>
                {status.retention != null && (
                  <span>최근 {status.retention}개를 보관해요</span>
                )}
              </>
            ) : (
              <span>자동 백업이 꺼져 있어요. 서버 설정을 확인해 주세요</span>
            )}
            <div className="auto-backup-facts">
              <span className="auto-backup-fact">
                <span className="small muted">마지막 성공</span>
                <span className="auto-backup-value num">
                  {status.lastSuccess ? backupTime(status.lastSuccess) : "아직 없어요"}
                </span>
              </span>
              {status.directory && (
                <span className="auto-backup-fact">
                  <span className="small muted">서버 보관 위치</span>
                  <span className="auto-backup-path" title={status.directory}>
                    {status.directory}
                  </span>
                </span>
              )}
            </div>
            {status.lastError && (
              <p role="alert" className="alert alert-danger">
                {status.lastError}
              </p>
            )}
            <div>
              <Button onClick={run} busy={busy} disabled={!status.enabled}>
                지금 서버에 백업
              </Button>
            </div>
          </>
        )}
      </div>
      <span className="small muted">
        서버를 꺼 두면 자동 백업도 쉬어요. 같은 디스크의 백업은 PC 고장에 대비할 수 없어요
      </span>
    </>
  );
}
