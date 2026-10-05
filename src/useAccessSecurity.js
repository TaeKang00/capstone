import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  getSession,
  getPrivateAccess,
  setPrivateAccess,
  invalidateRequests,
} from "./api";

const accessChannel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("salon-access")
    : null;
const seenEvents = new Set();
if (accessChannel)
  accessChannel.onmessage = (event) =>
    window.dispatchEvent(
      new CustomEvent("salon-access-message", { detail: event.data }),
    );
// Only the event kind crosses tabs. Credentials and protected state remain in memory.
export function broadcastAccess(kind) {
  const message = { kind, nonce: crypto.randomUUID() };
  accessChannel?.postMessage(message);
  try {
    localStorage.setItem("salon-access-event", JSON.stringify(message));
  } catch {
    /* BroadcastChannel also delivers without storage. */
  }
}
export function useAccessSecurity({
  session,
  onSession,
  onClear,
  notify,
  navigate,
}) {
  const [access, updateAccess] = useState(null);
  const [gate, setGate] = useState(null);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState("");
  const callbacks = useRef({ onSession, onClear, notify, navigate });
  callbacks.current = { onSession, onClear, notify, navigate };
  const lockingRef = useRef(false);
  const gateRef = useRef(null);
  gateRef.current = gate;
  const lastTouch = useRef(0);
  const target = useRef({ page: "staff", context: {} });
  const clearPrivate = useCallback(() => {
    const previous = getPrivateAccess();
    if (previous || gateRef.current) invalidateRequests();
    gateRef.current = null;
    setPrivateAccess(null);
    updateAccess(null);
    setGate(null);
    return previous;
  }, []);
  const closePrivate = useCallback(
    (options = {}, remote = false) => {
      const previous = clearPrivate();
      if (previous && !remote) {
        broadcastAccess("private-locked");
        api("/auth/private/lock", {
          method: "POST",
          privateAccess: previous,
          allowStale: true,
          keepalive: true,
        }).catch(() => {});
      }
      if (options.target)
        callbacks.current.navigate(options.target, options.context);
    },
    [clearPrivate],
  );
  const lockWork = useCallback(async () => {
    if (lockingRef.current) return;
    lockingRef.current = true;
    invalidateRequests();
    clearPrivate();
    callbacks.current.onClear();
    setLocking(true);
    setLockError("");
    broadcastAccess("work-locking");
    try {
      let next;
      try {
        next = await api("/auth/lock", { method: "POST" });
      } catch (error) {
        if (error.code !== "STALE_RESPONSE") throw error;
        next = await api("/auth/me");
      }
      await callbacks.current.onSession(next);
      broadcastAccess("session-changed");
      setLocking(false);
    } catch (error) {
      if (error.status === 401) setLocking(false);
      else setLockError(error.message);
    } finally {
      lockingRef.current = false;
    }
  }, [clearPrivate]);
  const authenticated = useCallback(
    async (value) => {
      clearPrivate();
      callbacks.current.onClear();
      await callbacks.current.onSession(value);
      broadcastAccess("session-changed");
    },
    [clearPrivate],
  );
  const operator = useCallback(
    async (page = "dashboard", context = {}) => {
      if (getSession()?.mode === "work") await lockWork();
      if (getSession()?.mode === "shared")
        setGate({ kind: "operator", page, context });
    },
    [lockWork],
  );
  const requestPrivate = useCallback(
    (kind = "owner", page = "staff", context = {}) => {
      setGate({ kind, page, context });
    },
    [],
  );
  const unlocked = useCallback(
    (value) => {
      // Pending authentication cannot restore a view after a local/cross-tab lock.
      invalidateRequests();
      setPrivateAccess(value);
      updateAccess(value);
      target.current = {
        page: gate?.page || "staff",
        context: gate?.context || {},
      };
      setGate(null);
      callbacks.current.onClear();
      lastTouch.current = 0;
      broadcastAccess("private-opened");
    },
    [gate],
  );
  const operatorAuthenticated = async (value) => {
    const destination = gate;
    await authenticated(value);
    if (!value.user.mustChangePassword && destination)
      callbacks.current.navigate(destination.page, destination.context);
  };
  useEffect(() => {
    const privateExpired = () => {
      closePrivate();
      callbacks.current.notify(
        "보호 화면이 잠겼습니다. 다시 본인 인증해 주세요.",
        "warning",
      );
    };
    const workExpired = async (event) => {
      invalidateRequests();
      clearPrivate();
      callbacks.current.onClear();
      if (event.detail?.user) await callbacks.current.onSession(event.detail);
      else await lockWork();
    };
    const expired = () => {
      clearPrivate();
      setLocking(false);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") closePrivate();
    };
    const leave = () => closePrivate();
    const remote = async (event) => {
      let message;
      if (event.type === "salon-access-message") message = event.detail;
      else {
        if (event.key !== "salon-access-event" || !event.newValue) return;
        try {
          message = JSON.parse(event.newValue);
        } catch {
          return;
        }
      }
      if (!message?.nonce || seenEvents.has(message.nonce)) return;
      seenEvents.add(message.nonce);
      if (seenEvents.size > 100)
        seenEvents.delete(seenEvents.values().next().value);
      if (["private-opened", "private-locked"].includes(message.kind)) {
        closePrivate({}, true);
        return;
      }
      if (message.kind === "work-locking" && lockingRef.current) return;
      invalidateRequests();
      clearPrivate();
      callbacks.current.onClear();
      setLocking(true);
      if (message.kind === "work-locking") return;
      try {
        await callbacks.current.onSession(await api("/auth/me"));
        setLocking(false);
        setLockError("");
      } catch (error) {
        if (error.status === 401) {
          window.dispatchEvent(new Event("session-expired"));
          setLocking(false);
        } else setLockError(error.message);
      }
    };
    window.addEventListener("private-access-expired", privateExpired);
    window.addEventListener("work-session-locked", workExpired);
    window.addEventListener("session-expired", expired);
    window.addEventListener("storage", remote);
    window.addEventListener("salon-access-message", remote);
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("private-access-expired", privateExpired);
      window.removeEventListener("work-session-locked", workExpired);
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("storage", remote);
      window.removeEventListener("salon-access-message", remote);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("popstate", leave);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [clearPrivate, closePrivate, lockWork]);
  useEffect(() => {
    if (!session || session.user.mustChangePassword) return;
    let active = true;
    const touch = () => {
      if (
        !active ||
        lockingRef.current ||
        document.visibilityState !== "visible" ||
        Date.now() - lastTouch.current < 20000
      )
        return;
      lastTouch.current = Date.now();
      const currentSession = getSession();
      if (currentSession?.mode === "work")
        api("/auth/activity", { method: "POST" })
          .then((next) => {
            if (getSession() === currentSession)
              Object.assign(currentSession, next);
          })
          .catch(() => {});
      const grant = getPrivateAccess();
      if (grant)
        api("/auth/private/activity", { method: "POST", privateAccess: grant })
          .then((next) => {
            if (getPrivateAccess()?.accessToken === grant.accessToken)
              Object.assign(grant, next);
          })
          .catch(() => {});
    };
    const timer = setInterval(() => {
      const grant = getPrivateAccess(),
        currentSession = getSession();
      if (grant && Date.now() >= Math.min(grant.expiresAt, grant.idleExpiresAt))
        closePrivate();
      if (
        currentSession?.mode === "work" &&
        currentSession.idleExpiresAt &&
        Date.now() >= currentSession.idleExpiresAt
      )
        lockWork();
    }, 1000);
    for (const event of ["pointerdown", "keydown", "wheel", "input"])
      document.addEventListener(event, touch, { passive: true });
    return () => {
      active = false;
      clearInterval(timer);
      for (const event of ["pointerdown", "keydown", "wheel", "input"])
        document.removeEventListener(event, touch);
    };
  }, [session, closePrivate, lockWork]);
  return {
    access,
    gate,
    locking,
    lockError,
    target: target.current,
    lockWork,
    closePrivate,
    authenticated,
    requestPrivate,
    operator,
    unlocked,
    operatorAuthenticated,
    dismissGate: clearPrivate,
  };
}
