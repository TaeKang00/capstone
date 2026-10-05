import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button, ConfirmDialog } from "./ui";
import { Icon } from "./Icon";
import { ViewStateProvider } from "./ViewState";
import { PrivateWorkspaceContext } from "./PrivateWorkspaceContext";
import Staff from "../pages/Staff";
import Payroll from "../pages/Payroll";
import Settings from "../pages/Settings";
import Sales from "../pages/Sales";
import "./PrivateWorkspace.css";

const pages = {
  staff: Staff,
  payroll: Payroll,
  settings: Settings,
  sales: Sales,
};
const navigation = [
  ["staff", "직원 · 계정", "staff"],
  ["payroll", "급여명세", "payroll"],
  ["sales", "매출 · 정산", "chart"],
  ["settings", "설정 · 백업", "settings"],
];

export default function PrivateWorkspace({
  access,
  initialPage = "staff",
  initialContext = {},
  onLock,
}) {
  const owner = access.scope === "owner" && access.user.role === "owner";
  const [page, setPage] = useState(
    owner && pages[initialPage] ? initialPage : "payroll",
  );
  const [context, setContext] = useState(initialContext);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState(null);
  const stateRef = useRef(null);
  const live = useRef(true);
  const pending = useRef(new Map());
  const modalVersions = useRef(new Map());
  const mainRef = useRef(null);
  const scopePath = owner ? "/admin/state" : "/personal/state";
  const notify = useCallback((message, tone = "success") => {
    if (live.current) setToast({ message, tone });
  }, []);
  const acceptState = useCallback((value) => {
    if (!live.current) return;
    stateRef.current = value;
    setState(value);
    setError("");
  }, []);
  const refresh = useCallback(async () => {
    const result = await api(scopePath, { privateAccess: access });
    acceptState(result);
    return result;
  }, [access, scopePath, acceptState]);
  useEffect(() => {
    live.current = true;
    mainRef.current?.focus();
    return () => {
      live.current = false;
      stateRef.current = null;
      pending.current.clear();
      modalVersions.current.clear();
    };
  }, []);
  useEffect(() => {
    refresh().catch((err) => {
      if (live.current) setError(err.message);
    });
  }, [refresh]);
  useEffect(() => {
    const opened = (event) =>
      modalVersions.current.set(event.detail, stateRef.current?.version);
    const closed = (event) => modalVersions.current.delete(event.detail);
    window.addEventListener("erp-modal-open", opened);
    window.addEventListener("erp-modal-close", closed);
    return () => {
      window.removeEventListener("erp-modal-open", opened);
      window.removeEventListener("erp-modal-close", closed);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const runAction = useCallback(
    async (type, payload, requestId, expectedVersion) => {
      if (!owner) throw new Error("내 급여명세에서는 조회만 할 수 있습니다.");
      const key = JSON.stringify([type, payload]);
      const id = requestId || pending.current.get(key) || crypto.randomUUID();
      pending.current.set(key, id);
      try {
        const result = await api(`/actions/${type}`, {
          method: "POST",
          privateAccess: access,
          body: {
            payload,
            version:
              expectedVersion ??
              [...modalVersions.current.values()].find(
                (value) => value != null,
              ) ??
              stateRef.current?.version,
            requestId: id,
          },
        });
        if (!live.current) throw new Error("관리 화면이 잠겼습니다.");
        pending.current.delete(key);
        acceptState(result);
        for (const modal of modalVersions.current.keys())
          modalVersions.current.set(modal, result.version);
        return result;
      } catch (err) {
        if (err.code !== "NETWORK") pending.current.delete(key);
        if (live.current && err.status === 409) {
          const latest = await refresh().catch(() => null);
          if (latest)
            for (const modal of modalVersions.current.keys())
              modalVersions.current.set(modal, latest.version);
          err.message += " 최신 내용을 확인한 뒤 다시 저장해 주세요.";
        }
        throw err;
      }
    },
    [access, owner, acceptState, refresh],
  );
  const move = (target, nextContext = {}) => {
    setPendingNavigation(null);
    if (!owner || !pages[target]) {
      onLock({ target, context: nextContext });
      return;
    }
    setPage(target);
    setContext(nextContext);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => mainRef.current?.focus());
  };
  const navigate = (target, nextContext = {}) => {
    if (document.querySelector('[data-busy="true"]')) {
      notify("저장 중입니다. 처리가 끝난 뒤 이동해 주세요.", "warning");
      return;
    }
    if (document.querySelector('[data-dirty="true"]')) {
      setPendingNavigation({ target, context: nextContext });
      return;
    }
    move(target, nextContext);
  };
  const reload = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch (err) {
      if (live.current) setError(err.message);
    } finally {
      if (live.current) setRefreshing(false);
    }
  };
  const Page = owner ? pages[page] : Payroll;
  return (
    <PrivateWorkspaceContext.Provider value={onLock}>
      <ViewStateProvider>
        <div className="private-workspace">
          <header className="private-workspace-header">
            <div className="private-workspace-identity">
              <span className="private-workspace-lock">
                <Icon name="lock" size={19} />
              </span>
              <div>
                <strong>{owner ? "원장 관리" : "내 급여명세"}</strong>
                <span>{access.user.name} · 본인 인증됨</span>
              </div>
            </div>
            <Button variant="primary" onClick={() => onLock()}>
              <Icon name="lock" size={15} /> 지금 잠그기
            </Button>
          </header>
          <div className="private-workspace-notice">
            <p>
              확인이 끝나면 잠가 주세요. 화면을 떠나거나 일정 시간 사용하지
              않으면 자동으로 잠깁니다.
            </p>
            <span>잠그면 저장하지 않은 내용은 지워집니다.</span>
          </div>
          {owner && (
            <nav
              className="private-workspace-navigation"
              aria-label="원장 관리 메뉴"
            >
              {navigation.map(([id, label, icon]) => (
                <button
                  key={id}
                  type="button"
                  aria-current={page === id ? "page" : undefined}
                  onClick={() => navigate(id)}
                >
                  <Icon name={icon} size={17} /> {label}
                </button>
              ))}
            </nav>
          )}
          <main
            id="private-main"
            ref={mainRef}
            tabIndex={-1}
            className="private-workspace-content"
          >
            {error && (
              <div
                className="alert alert-danger private-workspace-error"
                role="alert"
              >
                <span>{error}</span>
                <Button onClick={reload} busy={refreshing}>
                  다시 불러오기
                </Button>
              </div>
            )}
            {!state && !error && (
              <p role="status" className="muted">
                본인 인증된 자료를 불러오고 있습니다…
              </p>
            )}
            {state && (
              <Page
                key={page}
                data={state.data}
                version={state.version}
                user={access.user}
                personalOnly={!owner}
                runAction={runAction}
                refresh={refresh}
                notify={notify}
                navigate={navigate}
                routeContext={context}
              />
            )}
          </main>
          {toast && (
            <div role="status" className={`toast toast-${toast.tone}`}>
              {toast.message}
            </div>
          )}
          {pendingNavigation && (
            <ConfirmDialog
              title="저장하지 않은 내용이 있습니다"
              confirmLabel="변경 버리고 이동"
              variant="danger"
              onClose={() => setPendingNavigation(null)}
              onConfirm={() =>
                move(pendingNavigation.target, pendingNavigation.context)
              }
            >
              다른 화면으로 이동하면 저장하지 않은 내용이 사라집니다.
            </ConfirmDialog>
          )}
        </div>
      </ViewStateProvider>
    </PrivateWorkspaceContext.Provider>
  );
}
