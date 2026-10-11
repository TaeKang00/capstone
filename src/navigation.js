import { useCallback, useEffect, useRef, useState } from "react";

const pages = new Set([
  "dashboard",
  "appointments",
  "customers",
  "payments",
  "inventory",
  "purchases",
]);
const fromLocation = () => {
  const candidate = window.location.hash.slice(2);
  return window.location.hash.startsWith("#/") && pages.has(candidate)
    ? candidate
    : "dashboard";
};
export function canVisit(page, role) {
  if (!pages.has(page)) return false;
  if (role === "designer")
    return ["dashboard", "appointments", "customers", "payroll"].includes(page);
  if (role === "reception") return !["staff", "settings"].includes(page);
  return true;
}
function dirty() {
  return !!document.querySelector('[data-dirty="true"]');
}
function busy() {
  return !!document.querySelector('[data-busy="true"]');
}

// History holds page names only. Customer searches, draft values and record IDs never enter the URL.
export function useWorkspaceNavigation(role, notify) {
  const [page, setPage] = useState(fromLocation),
    [routeContext, setRouteContext] = useState({}),
    [pendingNavigation, setPendingNavigation] = useState(null);
  const current = useRef(null),
    skipRestore = useRef(false),
    allowHistory = useRef(false),
    roleRef = useRef(role);
  roleRef.current = role;
  if (!current.current)
    current.current = {
      page: fromLocation(),
      index: history.state?.salonNavigation?.index || 0,
    };
  const apply = useCallback((target, context = {}) => {
    setPage(target);
    setRouteContext(context);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => {
      if (!document.querySelector('[role="dialog"]'))
        document.getElementById("main")?.focus();
    });
  }, []);
  const move = useCallback(
    (target, context = {}, replace = false) => {
      const destination =
        pages.has(target) && canVisit(target, roleRef.current)
          ? target
          : "dashboard";
      const entry = {
        page: destination,
        index:
          current.current.index +
          (!replace && destination !== current.current.page ? 1 : 0),
      };
      const method =
        replace || destination === current.current.page
          ? "replaceState"
          : "pushState";
      history[method](
        { ...history.state, salonNavigation: entry },
        "",
        `#/${destination}`,
      );
      current.current = entry;
      apply(destination, context);
    },
    [apply],
  );
  const navigate = useCallback(
    (target, context = {}) => {
      if (busy()) {
        notify("저장 중입니다. 처리가 끝난 뒤 이동해 주세요.", "warning");
        return;
      }
      if (dirty()) {
        setPendingNavigation({ target, context });
        return;
      }
      move(target, context);
    },
    [move, notify],
  );
  useEffect(() => {
    history.replaceState(
      { ...history.state, salonNavigation: current.current },
      "",
      `#/${current.current.page}`,
    );
    const popped = () => {
      if (skipRestore.current) {
        skipRestore.current = false;
        return;
      }
      const target = fromLocation();
      let entry = history.state?.salonNavigation;
      if (!entry || entry.page !== target) {
        entry = { page: target, index: current.current.index + 1 };
        history.replaceState(
          { ...history.state, salonNavigation: entry },
          "",
          `#/${target}`,
        );
      }
      const delta = current.current.index - entry.index;
      if (!allowHistory.current && (dirty() || busy()) && delta !== 0) {
        skipRestore.current = true;
        history.go(delta);
        if (busy())
          notify("저장 중입니다. 처리가 끝난 뒤 이동해 주세요.", "warning");
        else setPendingNavigation({ target, context: {}, historyEntry: entry });
        return;
      }
      allowHistory.current = false;
      current.current = entry;
      if (!canVisit(target, roleRef.current)) {
        move("dashboard", {}, true);
        return;
      }
      apply(target, {});
    };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, [apply, move, notify]);
  useEffect(() => {
    if (role && !canVisit(current.current.page, role))
      move("dashboard", {}, true);
  }, [role, move]);
  const confirmNavigation = () => {
    if (!pendingNavigation) return;
    if (pendingNavigation.historyEntry) {
      allowHistory.current = true;
      history.go(pendingNavigation.historyEntry.index - current.current.index);
    } else move(pendingNavigation.target, pendingNavigation.context);
    setPendingNavigation(null);
  };
  const resetNavigation = () => {
    setPendingNavigation(null);
    move("dashboard", {}, true);
  };
  return {
    page,
    routeContext,
    navigate,
    pendingNavigation,
    confirmNavigation,
    cancelNavigation: () => setPendingNavigation(null),
    resetNavigation,
  };
}
