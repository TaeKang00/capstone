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
import PrivateWorkspace from "./components/PrivateWorkspace";
import { SharedDesk } from "./components/SharedDesk";
import { AccessGate } from "./components/AccessGate";
import { PasswordField, PasswordRules } from "./components/PasswordField";
import { useAccessSecurity, broadcastAccess } from "./useAccessSecurity";
const pages = {
  dashboard: Dashboard,
  appointments: Appointments,
  customers: Customers,
  payments: Payments,
  inventory: Inventory,
  purchases: Purchases,
  attendance: Attendance,
};
// [page, short visible label, icon, full accessible name]
const navigation = [
  ["dashboard", "오늘", "workspace", "오늘의 매장"],
  ["appointments", "예약", "calendar", "예약 일정"],
  ["customers", "고객", "users", "고객 관리"],
  ["payments", "수납", "credit-card", "수납 · 환불"],
  ["inventory", "재고", "inventory", "재고 · 입고"],
  ["purchases", "발주", "truck", "발주 · 거래처"],
  ["attendance", "근태", "clock", "근태 · 휴가"],
];
const bottomTabs = [
  ["dashboard", "오늘", "workspace"],
  ["appointments", "예약", "calendar"],
  ["customers", "고객", "users"],
  ["attendance", "근태", "clock"],
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

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const down = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return [open, setOpen, ref];
}
function HeaderAlerts({ alerts, onGo }) {
  const [open, setOpen, ref] = usePopover();
  return (
    <div className="header-pop" ref={ref}>
      <button
        type="button"
        className="icon-btn header-bell"
        aria-label={alerts.length ? `알림 ${alerts.length}건` : "알림"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" />
        {alerts.length > 0 && <span className="header-bell-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="header-popover" role="region" aria-label="알림">
          <div className="header-popover-head">
            <p className="header-popover-title">알림</p>
            {alerts.length > 0 && <span className="small muted">{alerts.length}건</span>}
          </div>
          {alerts.length === 0 ? (
            <p className="muted">확인할 알림이 없어요</p>
          ) : (
            <ul className="header-alert-list">
              {alerts.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onGo(...item.go);
                    }}
                  >
                    <span className={`todo-dot tone-${item.tone}`} aria-hidden="true" />
                    <span className="todo-text">
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
function HeaderMenu({ user, refreshing, syncError, lastSynced, onPassword, onOperator, onLogout, onRefresh }) {
  const [open, setOpen, ref] = usePopover();
  const pick = (fn) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="header-pop" ref={ref}>
      <button
        type="button"
        className="header-avatar"
        aria-label={`${user.name} 내 메뉴`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        {user.name.slice(0, 1)}
      </button>
      {open && (
        <div className="header-popover header-menu" role="menu" aria-label="내 메뉴">
          <div className="header-menu-user">
            <strong>{user.name}</strong>
            <small>{roleLabel(user.role)}</small>
          </div>
          <button type="button" role="menuitem" onClick={pick(onPassword)}>
            <Icon name="lock" size={16} />내 비밀번호 변경
          </button>
          <button type="button" role="menuitem" onClick={pick(onOperator)}>
            <Icon name="swap" size={16} />작업자 전환
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={refreshing}
            title={
              lastSynced
                ? `마지막 확인 ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(lastSynced)}`
                : undefined
            }
            onClick={pick(onRefresh)}
          >
            <Icon name="refresh" size={16} />
            {syncError ? "연결 확인" : "새로고침"}
            {lastSynced && (
              <span className="header-menu-meta">
                {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(lastSynced)} 확인
              </span>
            )}
          </button>
          <button type="button" role="menuitem" onClick={pick(onLogout)}>
            <Icon name="logout" size={16} />로그아웃
          </button>
        </div>
      )}
    </div>
  );
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
    [syncError, setSyncError] = useState(false),
    [globalQuery, setGlobalQuery] = useState("");
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
  const securityRef = useRef(null);
  const [viewEpoch, setViewEpoch] = useState(0);
  const navigate = useCallback(
    (target, context = {}) => {
      setDrawer(false);
      if (
        ["staff", "payroll", "sales", "settings", "hr"].includes(
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
        <span className="loading-icon" aria-hidden="true">
          <Icon name="lock" />
        </span>
        <h1>화면이 잠겼어요</h1>
        <p>{security.lockError || "공용 화면으로 바꾸고 있어요"}</p>
        <Button variant="secondary" onClick={security.lockWork}>
          <Icon name="refresh" size={16} />
          잠금 상태 다시 확인
        </Button>
        <span className="loading-hint">바뀌지 않으면 다시 확인을 눌러 주세요</span>
      </div>
    );
  if (loading)
    return (
      <div className="loading-screen">
        <span className="brand-dot" aria-hidden="true" />
        <strong className="loading-title">매장 데스크를 준비하고 있어요</strong>
        <p>잠시만 기다려 주세요</p>
        <span className="loading-bar" aria-hidden="true"><span /></span>
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
            <span className="toast-dot" aria-hidden="true" />
            <span>{toast.message}</span>
          </div>
        )}
      </>
    );
  if (session.user.mustChangePassword)
    return (
      <div className="auth-layout">
        <header className="auth-header">
          <span className="auth-brand">
            <span className="brand-dot" aria-hidden="true" />
            <strong>살롱 데스크</strong>
          </span>
          <span className="auth-chip">{session.user.name}</span>
        </header>
        <section className="auth-form-side">
          <div className="auth-card">
            <div className="auth-card-head">
              <h1>새 비밀번호를 설정해 주세요</h1>
              <p className="muted">처음 로그인했거나 비밀번호가 초기화된 계정이에요</p>
            </div>
            <PasswordForm forced onSuccess={security.authenticated} />
            <Button onClick={doLogout} variant="ghost" className="btn-block">
              로그아웃
            </Button>
          </div>
        </section>
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
            <span className="toast-dot" aria-hidden="true" />
            <span>{toast.message}</span>
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
  const unpaid =
    alerts.unpaid === false
      ? 0
      : (data?.appointments || []).filter(
          (a) =>
            a.date === today() &&
            !a.transactionId &&
            ["checked_in", "in_service", "completed"].includes(a.status),
        ).length;
  const counts = {
    inventory: [low, true],
    payments: [unpaid, true],
  };
  const lead = ["owner", "manager"].includes(user.role);
  const pendingRequests =
    alerts.pendingRequests === false ? 0 : data?.pendingRequestCount || 0;
  const purchaseRequests = lead || user.role === "reception"
    ? (data?.purchaseRequests || []).filter((row) => row.status === "requested").length
    : 0;
  const headerAlerts = [
    pendingRequests > 0 && {
      key: "requests",
      tone: "accent",
      title: `휴가 승인 ${pendingRequests}건`,
      detail: "원장 관리에서 승인해요",
      go: ["hr", { tab: "requests" }],
    },
    allowed("payments", user.role) && unpaid > 0 && {
      key: "unpaid",
      tone: "warn",
      title: `수납 대기 ${unpaid}건`,
      detail: "시술을 마친 손님",
      go: ["payments", { pending: true }],
    },
    allowed("inventory", user.role) && low > 0 && {
      key: "stock",
      tone: "warn",
      title: `보충할 재고 ${low}품목`,
      detail: "재고에서 확인해요",
      go: ["inventory", { stock: "low" }],
    },
    allowed("purchases", user.role) && purchaseRequests > 0 && {
      key: "purchase",
      tone: "warn",
      title: `구매 요청 ${purchaseRequests}건`,
      detail: "발주에서 확인해요",
      go: ["purchases", {}],
    },
  ].filter(Boolean);
  const day = today();
  const team = lead
    ? (data?.staff || [])
        .filter((s) => s.status === "active")
        .map((s) => {
          const record = (data?.attendance || []).find(
            (row) => row.staffId === s.id && row.date === day,
          );
          const leave = (data?.staffRequests || []).find(
            (row) =>
              row.staffId === s.id &&
              row.kind === "leave" &&
              row.status === "approved" &&
              row.from <= day &&
              row.to >= day,
          );
          const state = leave
            ? ["휴가", "off"]
            : record && record.clockOut == null
              ? ["근무 중", "on"]
              : record
                ? ["퇴근", "off"]
                : ["미출근", "warn"];
          return { id: s.id, name: s.name, state };
        })
    : [];
  const navItem = ([key, label, icon, name]) => {
    const [count, alert] = counts[key] || [0, false];
    return (
      <button
        key={key}
        className={`nav-item ${activePage === key ? "active" : ""}`}
        aria-current={activePage === key ? "page" : undefined}
        aria-label={count ? `${name} ${count}건` : name}
        onClick={() => navigate(key)}
      >
        <span className="nav-icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
        {label}
        {count > 0 && (
          <span className={`nav-count ${alert ? "nav-count-alert" : ""}`}>
            {count}
          </span>
        )}
      </button>
    );
  };
  const nav = (
    <>
      <nav aria-label="주 메뉴" className="sidebar-menu">
        {navigation
          .filter(([key]) => allowed(key, user.role))
          .map(navItem)}
      </nav>
      {team.length > 0 && (
        <section className="sidebar-section" aria-label="지금 근무 중">
          <p className="nav-group">지금 근무 중</p>
          <ul className="team-list">
            {team.map((member) => (
              <li key={member.id}>
                <span className={`team-avatar team-${member.state[1]}`}>
                  {member.name.slice(0, 1)}
                </span>
                <span className="team-name">{member.name}</span>
                <span className="team-state">{member.state[0]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="sidebar-section" aria-label="보호 영역">
        <p className="nav-group">보호 영역</p>
        <button
          className="nav-item"
          onClick={() => {
            setDrawer(false);
            security.requestPrivate("personal", "payroll");
          }}
        >
          <span className="nav-icon" aria-hidden="true">
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
          <span className="nav-icon" aria-hidden="true">
            <Icon name="lock" />
          </span>
          원장 관리
        </button>
      </section>
      <p className="sidebar-note">5분 동안 쓰지 않으면 공용 화면으로 잠겨요</p>
    </>
  );
  const searchCustomers = (event) => {
    event.preventDefault();
    navigate("customers", { query: globalQuery.trim() });
  };
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
      <div className="app-shell">
        <header className="app-header">
          <button
            className="icon-btn menu-toggle"
            aria-label="메뉴 열기"
            aria-expanded={drawer}
            aria-controls="mobile-navigation"
            onClick={() => setDrawer(true)}
          >
            <Icon name="menu" size={20} />
          </button>
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
              <span className="brand-dot" aria-hidden="true" />
            )}
            <span className="brand-name">{data?.store?.name || "살롱 데스크"}</span>
          </a>
          <form className="app-search" role="search" onSubmit={searchCustomers}>
            <Icon name="search" size={20} />
            <input
              type="search"
              aria-label="손님 찾기"
              placeholder="손님 이름이나 전화번호"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
            />
          </form>
          <div className="app-header-actions">
            {data?.services?.some((s) => s.active) && (
              <Button
                variant="primary"
                className="header-cta"
                aria-label="＋ 예약 등록"
                onClick={() => navigate("appointments", { create: true })}
              >
                <Icon name="plus" size={16} />
                예약 등록
              </Button>
            )}
            <HeaderAlerts alerts={headerAlerts} onGo={navigate} />
            <Button
              variant="secondary"
              className="header-lock"
              onClick={security.lockWork}
            >
              <Icon name="lock" size={16} />
              공용 화면 잠금
            </Button>
            <HeaderMenu
              user={user}
              refreshing={refreshing}
              syncError={syncError}
              lastSynced={lastSynced}
              onPassword={() => setPasswordModal(true)}
              onOperator={() => security.operator()}
              onLogout={() => setLogoutModal(true)}
              onRefresh={async () => {
                setRefreshing(true);
                try {
                  await refresh();
                  notify("최신 내용을 불러왔어요");
                } catch (e) {
                  notify(e.message, "danger");
                } finally {
                  setRefreshing(false);
                }
              }}
            />
          </div>
        </header>
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
            {(!online || syncError) && (
              <div role="alert" className="connection-banner">
                <Icon name="alert" />
                <span className="connection-banner-text">
                  <strong>
                    {!online
                      ? "인터넷 연결이 끊겼어요"
                      : "서버의 최신 내용을 확인하지 못했어요"}
                  </strong>
                  <span className="muted">지금 화면은 마지막으로 확인한 자료예요</span>
                </span>
                <Button
                  variant="secondary"
                  busy={refreshing}
                  onClick={async () => {
                    setRefreshing(true);
                    try {
                      await refresh();
                      setLoadError("");
                      notify("최신 내용을 불러왔어요");
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
                  매장 데이터를 불러오는 중이에요
                </div>
              )}
            </main>
            <footer className="app-footer">
              <span>{data?.store?.name || "살롱 데스크"}</span>
              <button
                className="text-btn"
                onClick={() =>
                  notify(
                    "고객과 직원 정보는 업무 목적으로만 열람해 주세요. 자리를 비울 때는 화면을 잠가 주세요.",
                    "warning",
                  )
                }
              >
                개인정보 취급 안내
              </button>
            </footer>
          </div>
        </div>
        <nav className="bottom-tabs" aria-label="빠른 메뉴">
          {(lead
            ? [...bottomTabs.slice(0, 2), ["hr", "승인", "check"]]
            : bottomTabs
          )
            .filter(([key]) => key === "hr" || allowed(key, user.role))
            .map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                aria-current={activePage === key ? "page" : undefined}
                aria-label={key === "hr" && pendingRequests ? `승인 ${pendingRequests}건` : undefined}
                onClick={() => (key === "hr" ? navigate("hr", { tab: "requests" }) : navigate(key))}
              >
                <Icon name={icon} size={20} />
                {label}
                {key === "hr" && pendingRequests > 0 && (
                  <span className="bottom-tab-count" aria-hidden="true">{pendingRequests}</span>
                )}
              </button>
            ))}
          <button type="button" onClick={() => setDrawer(true)}>
            <Icon name="menu" size={20} />
            더보기
          </button>
        </nav>
      </div>
      {toast && (
        <div
          role={toast.tone === "danger" ? "alert" : "status"}
          className={`toast toast-${toast.tone}`}
        >
          <span className="toast-dot" aria-hidden="true" />
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
          title="저장하지 않은 내용이 있어요"
          confirmLabel="변경 버리고 이동"
          variant="danger"
          onClose={cancelNavigation}
          onConfirm={confirmNavigation}
        >
          다른 화면으로 가면 아직 저장하지 않은 입력이 사라져요
        </ConfirmDialog>
      )}
      {passwordModal && (
        <Modal title="내 비밀번호 변경" onClose={() => setPasswordModal(false)}>
          <PasswordForm
            onCancel={() => setPasswordModal(false)}
            owner={user.role === "owner"}
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
          icon="logout"
        >
          <span>저장하지 않은 입력은 사라져요</span>
          <span className="muted">함께 쓰는 컴퓨터라면 일을 마친 뒤 꼭 로그아웃해 주세요</span>
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
        <span className="auth-brand">
          <span className="brand-dot" aria-hidden="true" />
          <strong>살롱 데스크</strong>
        </span>
        <span className="auth-chip">{setup ? "처음 설정" : "직원 전용"}</span>
      </header>
      <section className="auth-form-side">
        <div className="auth-card">
          <div className="auth-card-head">
            <h1>{setup ? "매장 초기 설정" : "로그인"}</h1>
            <p className="muted">
              {setup
                ? "매장과 첫 원장 계정을 만들어요"
                : "기록에 내 이름이 남아요"}
            </p>
            {setup && <p className="muted">직원 계정은 로그인한 뒤에 발급해요</p>}
          </div>
          {(externalError || error) && (
            <div className="auth-alert" role="alert">
              <Icon name="alert" />
              <span className="auth-alert-text">
                {externalError ? (
                  <>
                    <strong>서버에 연결하지 못했어요</strong>
                    <span>{externalError}</span>
                  </>
                ) : (
                  <span>{error}</span>
                )}
              </span>
              {externalError && (
                <Button variant="primary" onClick={retry}>
                  다시 연결
                </Button>
              )}
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
              <Field label="아이디" help={setup ? "로그인할 때 쓰는 이름이에요" : undefined}>
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

              >
                <PasswordField
                  label="비밀번호"
                  minLength={
                    setup &&
                    (bootstrap?.requiresToken ||
                      form.loginId.trim().toLowerCase() !== "admin")
                      ? 12
                      : undefined
                  }
                  autoComplete={setup ? "new-password" : "current-password"}
                  {...field("password")}
                />
              </Field>
              {setup && (
                <Field label="비밀번호 확인">
                  <PasswordField label="비밀번호 확인" autoComplete="new-password" {...field("confirm")} />
                </Field>
              )}
              {setup && <PasswordRules value={form.password} confirm={form.confirm} />}
              {setup && bootstrap.requiresToken && (
                <Field
                  label="초기 등록 토큰"
                  help="서버에 설정한 BOOTSTRAP_TOKEN을 넣어 주세요"
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
                <button
                  type="button"
                  className="btn btn-ghost btn-block auth-help"
                  onClick={() => setRecovering(true)}
                >
                  아이디나 비밀번호를 잊었어요
                </button>
              )}
            </form>
          )}
          <div className="auth-note">
            {setup ? (
              <>
                <span>로컬 시연에서는 아이디로 admin을 쓸 수 있어요</span>
                <span className="muted">운영할 때는 12자 이상 비밀번호를 써 주세요</span>
              </>
            ) : (
              <>
                <span>내 계정으로만 로그인해 주세요</span>
                <span className="muted">함께 쓰는 PC는 자리를 비울 때 잠가 주세요</span>
              </>
            )}
          </div>
        </div>
        <footer className="auth-footer">살롱 데스크 v2.0</footer>
      </section>
    </div>
  );
}
function PasswordForm({ onSuccess, forced, onCancel, owner }) {
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
      return setError("새 비밀번호 확인이 일치하지 않아요.");
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
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <form className={`stack password-form${forced ? " is-forced" : ""}`} onSubmit={submit}>
      {error && (
        <div role="alert" className="alert alert-warning">
          {error}
        </div>
      )}
      <Field
        label={forced ? "임시 비밀번호" : "현재 비밀번호"}
        help={forced ? "원장에게 받은 비밀번호예요" : undefined}
      >
        <PasswordField
          label={forced ? "임시 비밀번호" : "현재 비밀번호"}
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={set("currentPassword")}
        />
      </Field>
      <Field label="새 비밀번호">
        <PasswordField
          label="새 비밀번호"
          minLength={12}
          autoComplete="new-password"
          value={form.newPassword}
          onChange={set("newPassword")}
        />
      </Field>
      <Field label="새 비밀번호 확인">
        <PasswordField
          label="새 비밀번호 확인"
          minLength={12}
          autoComplete="new-password"
          value={form.confirm}
          onChange={set("confirm")}
        />
      </Field>
      <PasswordRules value={form.newPassword} confirm={form.confirm} />
      <div className="auth-note">
        <span>바꾸면 다른 기기는 로그아웃돼요</span>
        {owner && <span className="muted">원장이라면 복구 코드도 새로 받아 주세요</span>}
      </div>
      <div className="password-form-actions">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            취소
          </Button>
        )}
        <Button variant="primary" type="submit" busy={busy}>
          비밀번호 변경
        </Button>
      </div>
    </form>
  );
}
