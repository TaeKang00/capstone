import { AccountRecoveryDialog } from "./components/AccountRecovery";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  getSession,
  getPrivateAccess,
  setSession,
  setPrivateAccess,
  invalidateRequests,
  roleLabel,
  today,
} from "./api";
import {
  Button,
  Field,
  Modal,
  ConfirmDialog,
  lockBodyScroll,
} from "./components/ui";
import { ViewStateProvider } from "./components/ViewState";
import { canVisit as allowed, useWorkspaceNavigation } from "./navigation";
import { Icon } from "./components/Icon";
import Dashboard from "./pages/Dashboard";
import Appointments from "./pages/Appointments";
import Customers from "./pages/Customers";
import Payments from "./pages/Payments";
import Purchases from "./pages/Purchases";
import Inventory from "./pages/Inventory";
import Attendance from "./pages/Attendance";
import Notices, { useNoticeReads } from "./pages/Notices";
import PrivateWorkspace from "./components/PrivateWorkspace";
import { SharedDesk } from "./components/SharedDesk";
import { AccessGate } from "./components/AccessGate";
import { useAccessSecurity, broadcastAccess } from "./useAccessSecurity";
const pages = {
  dashboard: Dashboard,
  appointments: Appointments,
  customers: Customers,
  payments: Payments,
  inventory: Inventory,
  purchases: Purchases,
  attendance: Attendance,
  notices: Notices,
};
const navigation = [
  ["dashboard", "오늘의 매장", "workspace", "업무"],
  ["appointments", "예약 일정", "calendar"],
  ["customers", "고객 관리", "users"],
  ["payments", "수납 · 환불", "credit-card"],
  ["attendance", "근태 · 휴가", "clock"],
  ["notices", "공지사항", "bell"],
  ["sales", "매출 · 정산", "chart", "운영"],
  ["inventory", "재고 · 입고", "inventory"],
  ["purchases", "발주 · 거래처", "inventory"],
  ["staff", "직원 관리", "staff"],
  ["payroll", "급여명세", "payroll"],
  ["settings", "매장 설정", "settings"],
];
class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="card empty-state">
        <h2>화면을 불러오지 못했습니다</h2>
        <p>
          이미 저장한 내역은 서버에 보관되어 있습니다. 새로고침한 뒤 다시 확인해
          주세요.
        </p>
        <Button onClick={() => location.reload()}>새로고침</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const [session, updateSession] = useState(null),
    [bootstrap, setBootstrap] = useState(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [state, setState] = useState(null),
    stateRef = useRef(null),
    pending = useRef(new Map());
  const drawerRef = useRef(null),
    modalVersions = useRef(new Map());
  const [drawer, setDrawer] = useState(false),
    [toast, setToast] = useState(null),
    [passwordModal, setPasswordModal] = useState(false),
    [logoutModal, setLogoutModal] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [refreshing, setRefreshing] = useState(false),
    [lastSynced, setLastSynced] = useState(null),
    [syncError, setSyncError] = useState(false);
  const notify = useCallback(
    (message, tone = "success") => setToast({ message, tone, key: Date.now() }),
    [],
  );
  const {
    page,
    routeContext,
    navigate: routeNavigate,
    pendingNavigation,
    confirmNavigation,
    cancelNavigation,
    resetNavigation,
  } = useWorkspaceNavigation(session?.user.role, notify);
  const workReady =
    !!session &&
    session.mode === "work" &&
    !session.user.mustChangePassword &&
    !!state;
  const [noticeReads] = useNoticeReads(state?.version, workReady);
  const securityRef = useRef(null);
  const [viewEpoch, setViewEpoch] = useState(0);
  const navigate = useCallback(
    (target, context = {}) => {
      setDrawer(false);
      if (
        ["staff", "payroll", "sales", "settings", "hr", "finance"].includes(
          target,
        )
      ) {
        securityRef.current.requestPrivate(
          target === "payroll" && getSession()?.user.role !== "owner"
            ? "personal"
            : "owner",
          target,
          context,
        );
      } else routeNavigate(target, context);
    },
    [routeNavigate],
  );
  const acceptState = (value) => {
    stateRef.current = value;
    setState(value);
    if (value) {
      setLastSynced(Date.now());
      setSyncError(false);
    }
  };
  const refresh = useCallback(async (background = false) => {
    if (getPrivateAccess()) return null;
    const requestedSession = getSession();
    let result;
    try {
      result = await api("/state");
    } catch (error) {
      if (
        getSession() === requestedSession &&
        error.status !== 401 &&
        error.code !== "STALE_RESPONSE"
      )
        setSyncError(true);
      throw error;
    }
    if (
      getSession() === requestedSession &&
      !getPrivateAccess() &&
      !(
        background &&
        (document.querySelector('[role="dialog"]') ||
          document.querySelector('[data-dirty="true"]'))
      )
    )
      acceptState(result);
    return result;
  }, []);
  const authenticate = useCallback(
    async (result) => {
      if (
        getSession()?.user.id !== result.user.id ||
        getSession()?.mode !== result.mode
      ) {
        pending.current.clear();
        acceptState(null);
      }
      setBootstrap({
        needsSetup: false,
        setupAllowed: false,
        requiresToken: false,
      });
      setSession(result);
      updateSession({ ...getSession() });
      setLoadError("");
      if (!result.user.mustChangePassword) {
        try {
          await refresh();
        } catch (e) {
          setLoadError(e.message);
        }
      }
    },
    [refresh],
  );
  const clearWork = useCallback(() => {
    acceptState(null);
    pending.current.clear();
    modalVersions.current.clear();
    setDrawer(false);
    setPasswordModal(false);
    setLogoutModal(false);
    setToast(null);
    resetNavigation();
    setViewEpoch((value) => value + 1);
  }, []);
  const security = useAccessSecurity({
    session,
    onSession: authenticate,
    onClear: clearWork,
    notify,
    navigate: routeNavigate,
  });
  securityRef.current = security;
  const securityGate = security.gate && (
    <AccessGate
      key={security.gate.kind}
      kind={security.gate.kind}
      session={session}
      onAuthenticated={security.operatorAuthenticated}
      onUnlocked={security.unlocked}
      onClose={security.dismissGate}
    />
  );
  useEffect(() => {
    if (
      session &&
      !session.user.mustChangePassword &&
      !security.access &&
      !security.locking &&
      !state
    )
      refresh().catch(() => {});
  }, [session, security.access, security.locking, state, refresh]);
  const initialize = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const info = await api("/bootstrap");
      setBootstrap(info);
      if (!info.needsSetup) {
        try {
          await authenticate(await api("/auth/me"));
        } catch (error) {
          if (error.status !== 401) throw error;
        }
      }
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [authenticate]);
  useEffect(() => {
    initialize();
  }, [initialize]);
  useEffect(() => {
    const opened = (e) =>
      modalVersions.current.set(e.detail, stateRef.current?.version);
    const closed = (e) => modalVersions.current.delete(e.detail);
    window.addEventListener("erp-modal-open", opened);
    window.addEventListener("erp-modal-close", closed);
    return () => {
      window.removeEventListener("erp-modal-open", opened);
      window.removeEventListener("erp-modal-close", closed);
    };
  }, []);
  useEffect(() => {
    const expired = () => {
      setSession(null);
      setPrivateAccess(null);
      updateSession(null);
      clearWork();
      notify("로그인이 만료되었습니다. 다시 로그인해 주세요.", "warning");
    };
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("session-expired", expired);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [notify, clearWork]);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement;
    const unlockScroll = lockBodyScroll();
    drawerRef.current?.querySelector("button")?.focus();
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrawer(false);
      }
      if (e.key === "Tab") {
        const els = [
          ...drawerRef.current.querySelectorAll("button,a[href]"),
        ].filter((el) => el.getClientRects().length);
        if (e.shiftKey && document.activeElement === els[0]) {
          e.preventDefault();
          els.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault();
          els[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      unlockScroll();
      document.removeEventListener("keydown", key);
      previous?.focus?.();
    };
  }, [drawer]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!session || session.user.mustChangePassword) return;
    const update = () => {
      if (
        !getPrivateAccess() &&
        document.visibilityState === "visible" &&
        !document.querySelector('[role="dialog"]') &&
        !document.querySelector('[data-dirty="true"]')
      )
        refresh(true).catch(() => {});
    };
    window.addEventListener("focus", update);
    const timer = setInterval(update, 45000);
    return () => {
      window.removeEventListener("focus", update);
      clearInterval(timer);
    };
  }, [session, refresh]);
  const runAction = useCallback(
    async (type, payload, requestId, expectedVersion) => {
      const requestedSession = getSession();
      const key = JSON.stringify([type, payload]);
      const id = requestId || pending.current.get(key) || crypto.randomUUID();
      pending.current.set(key, id);
      try {
        const result = await api(`/actions/${type}`, {
          method: "POST",
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
        if (getSession() !== requestedSession)
          throw new Error(
            "로그인 계정이 변경되었습니다. 현재 계정의 내역을 다시 확인해 주세요.",
          );
        pending.current.delete(key);
        acceptState(result);
        for (const key of modalVersions.current.keys())
          modalVersions.current.set(key, result.version);
        return result;
      } catch (e) {
        if (e.code !== "NETWORK") pending.current.delete(key);
        if (e.status === 409) {
          const latest = await refresh().catch(() => null);
          if (latest)
            for (const key of modalVersions.current.keys())
              modalVersions.current.set(key, latest.version);
          e.message += " 최신 내용을 확인한 뒤 다시 저장해 주세요.";
        }
        throw e;
      }
    },
    [refresh],
  );
  const doLogout = async () => {
    try {
      security.closePrivate();
      invalidateRequests();
      await api("/auth/logout", { method: "POST" });
      setSession(null);
      updateSession(null);
      acceptState(null);
      setLogoutModal(false);
      pending.current.clear();
      resetNavigation();
      broadcastAccess("session-changed");
    } catch (e) {
      notify(e.message, "danger");
    }
  };
  if (security.locking)
    return (
      <div className="loading-screen">
        <Icon name="lock" size={24} />
        <h1>화면이 잠겼습니다</h1>
        <p>{security.lockError || "공용 화면으로 전환하고 있습니다."}</p>
        <Button onClick={security.lockWork}>잠금 상태 다시 확인</Button>
      </div>
    );
  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Icon name="workspace" size={19} />
        </div>
        <p>매장 데스크를 준비하고 있습니다…</p>
      </div>
    );
  if (!session)
    return (
      <>
        <AuthScreen
          bootstrap={bootstrap}
          onSuccess={security.authenticated}
          error={loadError}
          retry={initialize}
        />
        {toast && (
          <div role="status" className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        )}
      </>
    );
  if (session.user.mustChangePassword)
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>새 비밀번호를 설정해 주세요</h1>
          <p className="muted">
            처음 로그인하거나 관리자가 비밀번호를 재설정한 계정입니다.
          </p>
          <PasswordForm forced onSuccess={security.authenticated} />
          <Button onClick={doLogout} variant="ghost">
            로그아웃
          </Button>
        </div>
      </div>
    );
  if (security.access)
    return (
      <ErrorBoundary key={security.access.accessToken}>
        <PrivateWorkspace
          key={security.access.accessToken}
          access={security.access}
          initialPage={security.target.page}
          initialContext={security.target.context}
          onLock={security.closePrivate}
        />
      </ErrorBoundary>
    );
  if (session.mode === "shared")
    return (
      <>
        <SharedDesk
          data={state?.data}
          onLogin={security.operator}
          onOwner={(target) => security.requestPrivate("owner", target)}
        />
        {securityGate}
        {toast && (
          <div role="status" className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        )}
      </>
    );
  const user = session.user,
    data = state?.data;
  const activePage = allowed(page, user.role) ? page : "dashboard",
    Page = pages[activePage];
  const alerts = data?.store?.alerts || {};
  const low =
    alerts.lowStock === false
      ? 0
      : data?.items?.filter(
          (i) => i.active !== false && Number(i.qty) <= Number(i.min),
        ).length || 0;
  const unreadNotices =
    alerts.unreadNotices === false
      ? 0
      : (data?.notices || []).filter(
          (notice) =>
            !notice.archived &&
            !noticeReads.some(
              (row) => row.noticeId === notice.id && row.userId === user.id,
            ),
        ).length;
  const counts = { inventory: low, notices: unreadNotices };
  const nav = (
    <>
      <a
        className="brand"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          navigate("dashboard");
        }}
      >
        {data?.store?.logo ? (
          <img className="brand-logo" src={data.store.logo} alt="" />
        ) : (
          <span className="brand-mark">
            <Icon name="workspace" size={19} />
          </span>
        )}
        <span>
          살롱 데스크<small>매장 관리</small>
        </span>
      </a>
      <div className="store-label">
        <span className="store-caption">현재 매장</span>
        <strong>{data?.store?.name || "우리 매장"}</strong>
      </div>
      <nav aria-label="주 메뉴">
        {navigation
          .filter(([key]) => allowed(key, user.role))
          .map(([key, label, icon, group]) => (
            <React.Fragment key={key}>
              {group && <p className="nav-group">{group}</p>}
              <button
                className={`nav-item ${activePage === key ? "active" : ""}`}
                aria-current={activePage === key ? "page" : undefined}
                onClick={() => navigate(key)}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Icon name={icon} />
                </span>
                {label}
                {counts[key] > 0 && (
                  <span className="nav-count" aria-label={`${counts[key]}건`}>
                    {counts[key]}
                  </span>
                )}
              </button>
            </React.Fragment>
          ))}
        <p className="nav-group">보호 영역</p>
        <button
          className="nav-item"
          onClick={() => {
            setDrawer(false);
            security.requestPrivate("personal", "payroll");
          }}
        >
          <span className="nav-icon">
            <Icon name="payroll" />
          </span>
          내 급여명세
        </button>
        <button
          className="nav-item"
          onClick={() => {
            setDrawer(false);
            security.requestPrivate("owner", "staff");
          }}
        >
          <span className="nav-icon">
            <Icon name="lock" />
          </span>
          원장 관리
        </button>
      </nav>
    </>
  );
  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        본문으로 바로가기
      </a>
      <div className="app-layout">
        <aside className="sidebar">{nav}</aside>
        {drawer && (
          <div className="drawer-backdrop" onClick={() => setDrawer(false)}>
            <aside
              ref={drawerRef}
              id="mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label="매장 메뉴"
              className="sidebar mobile-drawer"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="icon-btn drawer-close"
                onClick={() => setDrawer(false)}
                aria-label="메뉴 닫기"
              >
                <Icon name="close" />
              </button>
              {nav}
            </aside>
          </div>
        )}
        <div className="workspace">
          <header className="topbar">
            <div className="row">
              <button
                className="icon-btn menu-toggle"
                aria-label="메뉴 열기"
                aria-expanded={drawer}
                aria-controls="mobile-navigation"
                onClick={() => setDrawer(true)}
              >
                <Icon name="menu" size={20} />
              </button>
              <span className="topbar-title">
                {navigation.find(([id]) => id === activePage)?.[1]}
              </span>
              <span className="topbar-date">
                {today().replaceAll("-", ". ")}
              </span>
            </div>
            <div className="row topbar-tools">
              {lastSynced && (
                <span
                  className="sync-status"
                  title="서버에서 마지막으로 확인한 시각"
                >
                  {syncError
                    ? "연결 확인 필요"
                    : `동기화 ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(lastSynced)}`}
                </span>
              )}
              <Button
                variant="ghost"
                busy={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await refresh();
                    notify("최신 내용을 불러왔습니다.");
                  } catch (e) {
                    notify(e.message, "danger");
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                새로고침
              </Button>
              <button
                className="user-chip"
                onClick={() => setPasswordModal(true)}
                title="내 비밀번호 변경"
              >
                <span className="avatar">{user.name.slice(0, 1)}</span>
                <span>
                  {user.name}
                  <small>{roleLabel(user.role)}</small>
                </span>
              </button>
              <Button variant="ghost" onClick={() => setLogoutModal(true)}>
                로그아웃
              </Button>
            </div>
          </header>
          <div className="work-access-bar">
            <span>
              <strong>{user.name}</strong> 계정으로 업무 기록 중 · 5분간 미사용
              시 잠금
            </span>
            <div className="row">
              <Button variant="ghost" onClick={() => security.operator()}>
                작업자 전환
              </Button>
              <Button onClick={security.lockWork}>
                <Icon name="lock" size={15} />
                공용 화면 잠금
              </Button>
            </div>
          </div>
          {(!online || syncError) && (
            <div role="alert" className="connection-banner">
              <span>
                {!online
                  ? "인터넷 연결이 끊겼습니다."
                  : "서버의 최신 내용을 확인하지 못했습니다."}{" "}
                현재 화면은 마지막으로 확인한 자료입니다.
              </span>
              <Button
                variant="ghost"
                busy={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await refresh();
                    setLoadError("");
                    notify("최신 내용을 불러왔습니다.");
                  } catch (e) {
                    notify(e.message, "danger");
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                연결 다시 확인
              </Button>
            </div>
          )}
          <main id="main" className="main-content" tabIndex={-1}>
            {loadError && (
              <div className="alert alert-warning" role="alert">
                {loadError}{" "}
                <Button
                  onClick={() =>
                    refresh()
                      .then(() => setLoadError(""))
                      .catch((e) => setLoadError(e.message))
                  }
                >
                  다시 불러오기
                </Button>
              </div>
            )}
            {data ? (
              <ViewStateProvider key={`${user.id}-${viewEpoch}`}>
                <ErrorBoundary key={activePage}>
                  <Page
                    data={data}
                    user={user}
                    version={state.version}
                    noticeReads={noticeReads}
                    runAction={runAction}
                    refresh={refresh}
                    notify={notify}
                    navigate={navigate}
                    routeContext={routeContext}
                  />
                </ErrorBoundary>
              </ViewStateProvider>
            ) : (
              <div className="empty-state">
                매장 데이터를 불러오는 중입니다…
              </div>
            )}
          </main>
          <footer className="app-footer">
            <span>
              © {new Date().getFullYear()} {data?.store?.name || "살롱 데스크"}
            </span>
            <span>
              살롱 데스크 v2.0 <span className="footer-dot">·</span> 매장 내부
              업무용 <span className="footer-dot">·</span> 한국 표준시 (KST)
            </span>
            <button
              className="text-btn"
              onClick={() =>
                notify(
                  "고객·직원 정보는 업무 목적으로만 열람해 주세요. 자리 비움 시 로그아웃하고, 백업 파일은 접근이 제한된 저장소에 보관하세요.",
                  "warning",
                )
              }
            >
              개인정보 취급 안내
            </button>
          </footer>
        </div>
      </div>
      {toast && (
        <div
          role={toast.tone === "danger" ? "alert" : "status"}
          className={`toast toast-${toast.tone}`}
        >
          <span>{toast.message}</span>
          <button
            className="icon-btn"
            aria-label="알림 닫기"
            onClick={() => setToast(null)}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {securityGate}
      {pendingNavigation && (
        <ConfirmDialog
          title="저장하지 않은 내용이 있습니다"
          confirmLabel="변경 버리고 이동"
          variant="danger"
          onClose={cancelNavigation}
          onConfirm={confirmNavigation}
        >
          다른 화면으로 이동하면 아직 저장하지 않은 입력이 사라집니다.
        </ConfirmDialog>
      )}
      {passwordModal && (
        <Modal title="내 비밀번호 변경" onClose={() => setPasswordModal(false)}>
          <PasswordForm
            onSuccess={async (result) => {
              await security.authenticated(result);
              setPasswordModal(false);
              notify("비밀번호를 변경했습니다. 다른 기기는 로그아웃됩니다.");
            }}
          />
        </Modal>
      )}
      {logoutModal && (
        <ConfirmDialog
          title="로그아웃할까요?"
          confirmLabel="로그아웃"
          onClose={() => setLogoutModal(false)}
          onConfirm={doLogout}
        >
          로그아웃하면 저장하지 않은 입력은 사라집니다. 공용 컴퓨터에서는 업무를
          마친 뒤 로그아웃해 주세요.
        </ConfirmDialog>
      )}
    </>
  );
}
function AuthScreen({ bootstrap, onSuccess, error: externalError, retry }) {
  const setup = bootstrap?.needsSetup;
  const [recovering, setRecovering] = useState(false);
  const [form, setForm] = useState({
      storeName: "",
      name: "",
      loginId: "admin",
      password: "",
      confirm: "",
      setupToken: "",
    }),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = (name) => ({
    value: form[name],
    onChange: (e) => setForm({ ...form, [name]: e.target.value }),
  });
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (setup && form.password !== form.confirm)
      return setError("비밀번호 확인이 일치하지 않습니다.");
    setBusy(true);
    try {
      const result = await api(setup ? "/bootstrap" : "/auth/login", {
        method: "POST",
        body: setup ? form : { loginId: form.loginId, password: form.password },
      });
      await onSuccess(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      {recovering && (
        <AccountRecoveryDialog
          onClose={() => setRecovering(false)}
          onRecovered={(loginId) => {
            setRecovering(false);
            setForm((f) => ({ ...f, loginId, password: "" }));
            setError("");
          }}
        />
      )}
      <header className="auth-header">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="workspace" size={19} />
          </span>
          <span>
            살롱 데스크<small>매장 관리</small>
          </span>
        </div>
      </header>
      <section className="auth-form-side">
        <div className="auth-card">
          <h1>{setup ? "매장 초기 설정" : "로그인"}</h1>
          <p className="muted">
            {setup
              ? "매장과 첫 원장 계정을 등록합니다. 직원 계정은 로그인 후 발급할 수 있습니다."
              : "직원 계정으로 로그인해 주세요."}
          </p>
          {(externalError || error) && (
            <div className="alert alert-warning" role="alert">
              {externalError || error}
              {externalError && <Button onClick={retry}>다시 연결</Button>}
            </div>
          )}
          {setup && !bootstrap.setupAllowed ? (
            <div className="alert alert-warning">
              초기 등록이 허용되지 않았습니다. 서버 운영자가 초기 등록 설정을
              확인해야 합니다.
            </div>
          ) : (
            <form className="stack" onSubmit={submit}>
              {setup && (
                <div className="grid grid-2">
                  <Field label="매장 이름">
                    <input
                      required
                      maxLength={80}
                      placeholder="예: 오늘 헤어"
                      {...field("storeName")}
                    />
                  </Field>
                  <Field label="원장 이름">
                    <input
                      required
                      maxLength={60}
                      autoComplete="name"
                      {...field("name")}
                    />
                  </Field>
                </div>
              )}
              <Field label="아이디">
                <input
                  required
                  type="text"
                  maxLength={254}
                  autoComplete="username"
                  placeholder="예: admin"
                  autoCapitalize="none"
                  spellCheck={false}
                  {...field("loginId")}
                />
              </Field>
              <Field
                label="비밀번호"
                help={
                  setup
                    ? !bootstrap?.requiresToken &&
                      form.loginId.trim().toLowerCase() === "admin"
                      ? "로컬 시연 계정은 admin을 사용할 수 있습니다. 운영 비밀번호는 12자 이상으로 설정해 주세요."
                      : "12자 이상, 128자 이하로 입력해 주세요."
                    : undefined
                }
              >
                <div className="password-input">
                  <input
                    required
                    minLength={
                      setup &&
                      (bootstrap?.requiresToken ||
                        form.loginId.trim().toLowerCase() !== "admin")
                        ? 12
                        : undefined
                    }
                    maxLength={128}
                    type={show ? "text" : "password"}
                    aria-label="비밀번호"
                    autoComplete={setup ? "new-password" : "current-password"}
                    {...field("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? "비밀번호 숨기기" : "비밀번호 표시"}
                  >
                    {show ? "숨기기" : "표시"}
                  </button>
                </div>
              </Field>
              {setup && (
                <Field label="비밀번호 확인">
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    {...field("confirm")}
                  />
                </Field>
              )}
              {setup && bootstrap.requiresToken && (
                <Field
                  label="초기 등록 토큰"
                  help="서버 환경에 설정한 BOOTSTRAP_TOKEN을 입력하세요."
                >
                  <input
                    required
                    type="password"
                    autoComplete="off"
                    {...field("setupToken")}
                  />
                </Field>
              )}
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={!bootstrap}
                className="btn-block"
              >
                {setup ? "매장 만들고 시작하기" : "로그인"}
              </Button>
              {!setup && (
                <p className="help auth-help">
                  <button
                    type="button"
                    className="commerce-tag-button"
                    onClick={() => setRecovering(true)}
                  >
                    아이디·비밀번호 찾기
                  </button>
                </p>
              )}
            </form>
          )}
          <div className="auth-note">
            <Icon name="lock" size={14} />
            매장 직원 전용 · 개인 계정으로 이용해 주세요.
          </div>
        </div>
        <footer className="auth-footer">살롱 데스크 · v2.0</footer>
      </section>
    </div>
  );
}
function PasswordForm({ onSuccess, forced }) {
  const [form, setForm] = useState({
      currentPassword: "",
      newPassword: "",
      confirm: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.newPassword !== form.confirm)
      return setError("새 비밀번호 확인이 일치하지 않습니다.");
    setBusy(true);
    try {
      await onSuccess(
        await api("/auth/password", { method: "POST", body: form }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      {error && (
        <div role="alert" className="alert alert-warning">
          {error}
        </div>
      )}
      {[
        ["currentPassword", forced ? "임시 비밀번호" : "현재 비밀번호"],
        ["newPassword", "새 비밀번호"],
        ["confirm", "새 비밀번호 확인"],
      ].map(([key, label]) => (
        <Field
          key={key}
          label={label}
          help={
            key === "newPassword"
              ? "12~128자. 변경하면 다른 기기의 로그인은 해제됩니다."
              : undefined
          }
        >
          <input
            required
            type="password"
            minLength={key === "currentPassword" ? undefined : 12}
            maxLength={128}
            autoComplete={
              key === "currentPassword" ? "current-password" : "new-password"
            }
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </Field>
      ))}
      <Button variant="primary" type="submit" busy={busy}>
        비밀번호 변경
      </Button>
    </form>
  );
}
