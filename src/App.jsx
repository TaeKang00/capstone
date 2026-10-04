import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, getSession, setSession, roleLabel, today } from "./api";
import { Button, Field, Modal, ConfirmDialog } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import Appointments from "./pages/Appointments";
import Customers from "./pages/Customers";
import Payments from "./pages/Payments";
import Inventory from "./pages/Inventory";
import Sales from "./pages/Sales";
import Staff from "./pages/Staff";
import Settings from "./pages/Settings";
import Payroll from "./pages/Payroll";
const pages = {
  dashboard: Dashboard,
  appointments: Appointments,
  customers: Customers,
  payments: Payments,
  sales: Sales,
  inventory: Inventory,
  staff: Staff,
  payroll: Payroll,
  settings: Settings,
};
const navigation = [
  ["dashboard", "오늘의 매장", "◫", "업무"],
  ["appointments", "예약 일정", "▦"],
  ["customers", "고객 관리", "◎"],
  ["payments", "수납 · 환불", "₩"],
  ["sales", "매출 · 정산", "▥", "운영"],
  ["inventory", "재고 · 입고", "▤"],
  ["staff", "직원 관리", "♧"],
  ["payroll", "급여명세", "▧"],
  ["settings", "매장 설정", "⚙"],
];
function allowed(page, role) {
  if (role === "designer")
    return ["dashboard", "appointments", "customers", "payroll"].includes(page);
  if (role === "reception") return !["staff", "settings"].includes(page);
  return true;
}
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
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [page, setPage] = useState("dashboard"),
    [routeContext, setRouteContext] = useState({}),
    [drawer, setDrawer] = useState(false),
    [toast, setToast] = useState(null),
    [passwordModal, setPasswordModal] = useState(false),
    [logoutModal, setLogoutModal] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [refreshing, setRefreshing] = useState(false);
  const notify = useCallback(
    (message, tone = "success") => setToast({ message, tone, key: Date.now() }),
    [],
  );
  const acceptState = (value) => {
    stateRef.current = value;
    setState(value);
  };
  const refresh = useCallback(async (background = false) => {
    const requestedSession = getSession();
    const result = await api("/state");
    if (
      getSession() === requestedSession &&
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
      if (getSession()?.user.id !== result.user.id) {
        pending.current.clear();
        acceptState(null);
        setPage("dashboard");
        setRouteContext({});
      }
      setBootstrap({
        needsSetup: false,
        setupAllowed: false,
        requiresToken: false,
      });
      setSession(result);
      updateSession(result);
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
      updateSession(null);
      acceptState(null);
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
  }, [notify]);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
      document.body.style.overflow = priorOverflow;
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
  const changePage = useCallback((target, context = {}) => {
    setPage(target);
    setRouteContext(context);
    setDrawer(false);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => document.getElementById("main")?.focus());
  }, []);
  const navigate = useCallback(
    (target, context = {}) => {
      if (document.querySelector('[data-dirty="true"]')) {
        setPendingNavigation({ target, context });
        return;
      }
      changePage(target, context);
    },
    [changePage],
  );
  const doLogout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
      setSession(null);
      updateSession(null);
      acceptState(null);
      setLogoutModal(false);
      pending.current.clear();
      setPage("dashboard");
    } catch (e) {
      notify(e.message, "danger");
    }
  };
  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">S</div>
        <p>매장 데스크를 준비하고 있습니다…</p>
      </div>
    );
  if (!session)
    return (
      <>
        <AuthScreen
          bootstrap={bootstrap}
          onSuccess={authenticate}
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
          <div className="eyebrow">계정 보안</div>
          <h1>새 비밀번호를 설정해 주세요</h1>
          <p className="muted">
            처음 로그인하거나 관리자가 비밀번호를 재설정한 계정입니다.
          </p>
          <PasswordForm forced onSuccess={authenticate} />
          <Button onClick={doLogout} variant="ghost">
            로그아웃
          </Button>
        </div>
      </div>
    );
  const user = session.user,
    data = state?.data;
  const activePage = allowed(page, user.role) ? page : "dashboard",
    Page = pages[activePage];
  const low =
    data?.items?.filter(
      (i) => i.active !== false && Number(i.qty) <= Number(i.min),
    ).length || 0;
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
        <span className="brand-mark">S</span>
        <span>
          살롱 데스크<small>SALON WORKSPACE</small>
        </span>
      </a>
      <div className="store-label">
        <span className="status-dot" />
        {data?.store?.name || "우리 매장"}
        <small>매장 운영 공간</small>
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
                  {icon}
                </span>
                {label}
                {key === "inventory" && low > 0 && (
                  <span className="nav-count">{low}</span>
                )}
              </button>
            </React.Fragment>
          ))}
      </nav>
      <div className="sidebar-help">
        <strong>일의 흐름을 한눈에.</strong>
        <p>
          예약부터 마감까지
          <br />
          매장의 하루를 함께합니다.
        </p>
      </div>
    </>
  );
  return (
    <>
      <a href="#main" className="skip-link">
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
                ×
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
                ☰
              </button>
              <span className="topbar-title">
                {navigation.find(([id]) => id === activePage)?.[1]}
              </span>
              <span className="topbar-date">
                {today().replaceAll("-", ". ")}
              </span>
            </div>
            <div className="row topbar-tools">
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
          {!online && (
            <div role="alert" className="connection-banner">
              인터넷 연결이 끊겼습니다. 연결 후 저장 내역을 확인해 주세요.
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
            ×
          </button>
        </div>
      )}
      {pendingNavigation && (
        <ConfirmDialog
          title="저장하지 않은 설정이 있습니다"
          confirmLabel="변경 버리고 이동"
          variant="danger"
          onClose={() => setPendingNavigation(null)}
          onConfirm={() => {
            changePage(pendingNavigation.target, pendingNavigation.context);
            setPendingNavigation(null);
          }}
        >
          다른 화면으로 이동하면 아직 저장하지 않은 설정이 사라집니다.
        </ConfirmDialog>
      )}
      {passwordModal && (
        <Modal title="내 비밀번호 변경" onClose={() => setPasswordModal(false)}>
          <PasswordForm
            onSuccess={async (result) => {
              await authenticate(result);
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
  const [form, setForm] = useState({
      storeName: "",
      name: "",
      email: "",
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
        body: setup ? form : { email: form.email, password: form.password },
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
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">S</span>
          <span>
            살롱 데스크<small>SALON WORKSPACE</small>
          </span>
        </div>
        <div className="auth-story-copy">
          <div className="eyebrow">YOUR SALON, IN FLOW</div>
          <h1>
            좋은 하루의 시작,
            <br />
            정돈된 매장 운영.
          </h1>
          <p>
            고객을 맞이하는 순간부터
            <br />
            오늘의 마감을 끝내는 시간까지.
          </p>
          <div className="story-lines">
            <span>
              01 <strong>예약과 고객</strong> 한 흐름으로
            </span>
            <span>
              02 <strong>수납과 재고</strong> 정확하게
            </span>
            <span>
              03 <strong>직원과 급여</strong> 투명하게
            </span>
          </div>
        </div>
        <div className="auth-story-bottom">
          매장의 시간을 고객에게 돌려드립니다.
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-card">
          <div className="eyebrow">{setup ? "FIRST STEP" : "WELCOME BACK"}</div>
          <h1>{setup ? "우리 매장을 시작하세요" : "다시 만나 반갑습니다"}</h1>
          <p className="muted">
            {setup
              ? "매장과 첫 원장 계정을 등록합니다. 직원 계정은 로그인 후 발급할 수 있습니다."
              : "업무용 계정으로 로그인해 오늘의 매장을 확인하세요."}
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
              <Field label="이메일">
                <input
                  required
                  type="email"
                  maxLength={254}
                  autoComplete="username"
                  placeholder="name@salon.com"
                  {...field("email")}
                />
              </Field>
              <Field
                label="비밀번호"
                help={
                  setup ? "12자 이상, 128자 이하로 입력해 주세요." : undefined
                }
              >
                <div className="password-input">
                  <input
                    required
                    minLength={setup ? 12 : undefined}
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
                  비밀번호를 잊으셨나요? 원장 또는 매니저에게 계정 재설정을
                  요청해 주세요. 원장 계정은 운영 안내서의 복구 절차를
                  이용하세요.
                </p>
              )}
            </form>
          )}
          <div className="auth-note">
            <span className="status-dot" />
            직원 전용 업무 공간 · 고객 정보 보호를 위해 공용 계정 사용을
            피해주세요.
          </div>
        </div>
        <footer className="auth-footer">SALON DESK · v2.0</footer>
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
