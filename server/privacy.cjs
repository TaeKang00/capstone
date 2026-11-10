"use strict";
const { randomBytes } = require("node:crypto");
const { publicUser, problem, digest } = require("./auth.cjs");
const { readState } = require("./db.cjs");

const PRIVATE_ACTIONS = new Set([
  "staff.save",
  "service.save",
  "store.save",
  "legacy.import",
  "payroll.save",
  "payroll.finalize",
  "payroll.reopen",
  "payroll.paid",
  "attendance.save",
  "attendance.delete",
  "request.decide",
  "expense.save",
  "expense.void",
  "expense.import",
  "certificate.issue",
]);
const SHARED_USER = Object.freeze({
  id: "shared",
  name: "공용 업무",
  loginId: "",
  email: "",
  role: "shared",
  staffId: null,
  active: true,
  mustChangePassword: false,
});
function publicStaff(staff) {
  const {
    id,
    name,
    role,
    status,
    workingDays,
    startMinutes,
    endMinutes,
    breakStart,
    breakEnd,
  } = staff;
  return {
    id,
    name,
    role,
    status,
    workingDays,
    startMinutes,
    endMinutes,
    breakStart,
    breakEnd,
  };
}
function publicStore(store) {
  const {
    name,
    phone,
    address,
    timeZone,
    open,
    close,
    slotMinutes,
    closedWeekdays,
    logo,
    alerts,
  } = store;
  return {
    name,
    phone,
    address,
    timeZone,
    open,
    close,
    slotMinutes,
    closedWeekdays,
    logo: logo || "",
    alerts: alerts || {},
  };
}
function safeEmptyState(envelope) {
  return {
    version: envelope.version,
    data: {
      schemaVersion: envelope.data.schemaVersion,
      store: publicStore(envelope.data.store),
      staff: [],
      services: [],
      customers: [],
      appointments: [],
      transactions: [],
      refunds: [],
      items: [],
      receipts: [],
      logs: [],
      inventoryOperations: [],
      payroll: [],
      payrolls: [],
      attendance: [],
      staffRequests: [],
      notices: [],
      expenses: [],
      certificates: [],
      purchaseRequests: [],
      staffHistory: [],
      seq: {},
    },
  };
}
function sharedState(envelope, date) {
  const result = safeEmptyState(envelope);
  result.data.staff = envelope.data.staff
    .filter((s) => s.status === "active")
    .map(publicStaff);
  result.data.services = envelope.data.services.map(
    ({ id, name, duration, active }) => ({ id, name, duration, active }),
  );
  result.data.appointments = envelope.data.appointments
    .filter((a) => a.date === date)
    .map((a) => ({
      id: a.id,
      date: a.date,
      start: a.start,
      duration: a.duration,
      staffId: a.staffId,
      serviceIds: a.serviceIds,
      status: a.status,
      guestName: "예약 고객",
      customerId: null,
      guestPhone: "",
      notes: "",
      changes: [],
    }));
  return result;
}
function adminState(envelope) {
  const result = structuredClone(envelope);
  delete result.data.legacyArchive;
  return result;
}
function personalState(envelope, user) {
  const result = safeEmptyState(envelope);
  result.data.staff = envelope.data.staff
    .filter((s) => s.id === user.staff_id)
    .map(publicStaff);
  for (const key of ["payroll", "payrolls"])
    result.data[key] = structuredClone(
      (envelope.data[key] || []).filter(
        (p) =>
          p.staffId === user.staff_id &&
          ["finalized", "paid"].includes(p.status),
      ),
    );
  result.data.certificates = structuredClone(
    (envelope.data.certificates || []).filter(
      (c) => c.staffId === user.staff_id,
    ),
  );
  return result;
}

function createPrivacy(
  db,
  {
    now = Date.now,
    workIdleMs = 300000,
    privateIdleMs = 180000,
    privateAbsoluteMs = 600000,
  } = {},
) {
  workIdleMs = Math.min(300000, workIdleMs);
  privateIdleMs = Math.min(180000, privateIdleMs);
  privateAbsoluteMs = Math.min(600000, privateAbsoluteMs);
  const grants = new Map();
  const sessionShape = (session) => ({
    user: session.mode === "shared" ? SHARED_USER : publicUser(session),
    csrfToken: session.csrf_token,
    mode: session.mode,
    idleExpiresAt: session.mode === "shared" ? null : session.idle_expires_at,
  });
  function revokeSession(tokenHash) {
    for (const [token, grant] of grants)
      if (grant.sessionHash === tokenHash) grants.delete(token);
  }
  function revokeUser(id) {
    for (const [token, grant] of grants)
      if (grant.userId === id || grant.baseUserId === id) grants.delete(token);
  }
  function lock(session) {
    db.prepare(
      "UPDATE sessions SET mode='shared',idle_expires_at=0 WHERE token_hash=?",
    ).run(session.token_hash);
    revokeSession(session.token_hash);
    session.mode = "shared";
    session.idle_expires_at = 0;
    return sessionShape(session);
  }
  function refreshMode(session) {
    if (session.mode !== "shared" && session.idle_expires_at <= now())
      lock(session);
    return session;
  }
  function liveBase(req) {
    const session = db
      .prepare(
        `SELECT u.*, s.token_hash, s.csrf_token, s.mode, s.idle_expires_at, s.expires_at
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`,
      )
      .get(req.baseUser.token_hash, now());
    const staff =
      session &&
      readState(db)?.data.staff.find((s) => s.id === session.staff_id);
    if (
      !session ||
      session.password_hash !== req.baseUser.password_hash ||
      session.role !== req.baseUser.role ||
      !staff ||
      staff.status !== "active"
    )
      throw problem(
        401,
        "SESSION_EXPIRED",
        "로그인이 만료되었습니다. 다시 로그인해 주세요.",
      );
    return refreshMode(session);
  }
  function requireWork(req) {
    const session = liveBase(req);
    if (session.mode === "shared") {
      const error = problem(
        423,
        "WORK_LOCKED",
        "공용 화면입니다. 직원 본인 계정으로 로그인해 주세요.",
      );
      error.session = sessionShape(session);
      throw error;
    }
    return session;
  }
  function grantFor(req, scope) {
    const session = liveBase(req);
    const token = req.headers["x-private-token"];
    const key = typeof token === "string" ? digest(token) : "";
    const grant = grants.get(key);
    if (
      !grant ||
      grant.sessionHash !== session.token_hash ||
      (scope && grant.scope !== scope)
    )
      throw problem(
        403,
        "PRIVATE_AUTH_REQUIRED",
        "본인 비밀번호로 보호 영역을 다시 열어 주세요.",
      );
    const user = db
      .prepare("SELECT * FROM users WHERE id=? AND active=1")
      .get(grant.userId);
    const staff =
      user && readState(db)?.data.staff.find((s) => s.id === user.staff_id);
    if (
      grant.expiresAt <= now() ||
      grant.idleExpiresAt <= now() ||
      !user ||
      user.password_hash !== grant.passwordHash ||
      user.role !== grant.role ||
      user.must_change_password ||
      staff?.status !== "active" ||
      (grant.scope === "owner" && user.role !== "owner") ||
      (grant.scope === "personal" &&
        (session.mode !== "work" || session.id !== user.id))
    ) {
      grants.delete(key);
      throw problem(
        403,
        "PRIVATE_SESSION_EXPIRED",
        "보호 영역이 잠겼습니다. 비밀번호를 다시 입력해 주세요.",
      );
    }
    return { grant, user, key };
  }
  function requireOwner(req) {
    const verified = grantFor(req, "owner");
    req.privateGrant = verified.grant;
    req.user = verified.user;
    return verified;
  }
  function issue(req, scope, user) {
    const base = liveBase(req);
    if (scope === "personal" && (base.mode !== "work" || base.id !== user.id))
      throw problem(
        403,
        "PERSONAL_ACCOUNT_REQUIRED",
        "현재 작업자 본인 계정으로 인증해 주세요.",
      );
    revokeSession(base.token_hash);
    for (const [key, grant] of grants)
      if (grant.expiresAt <= now() || grant.idleExpiresAt <= now())
        grants.delete(key);
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = now() + privateAbsoluteMs;
    const grant = {
      scope,
      userId: user.id,
      role: user.role,
      passwordHash: user.password_hash,
      sessionHash: base.token_hash,
      baseUserId: base.id,
      expiresAt,
      idleExpiresAt: Math.min(expiresAt, now() + privateIdleMs),
    };
    grants.set(digest(accessToken), grant);
    return {
      accessToken,
      scope,
      user: publicUser(user),
      expiresAt,
      idleExpiresAt: grant.idleExpiresAt,
    };
  }
  return {
    now,
    workIdleMs,
    sessionShape,
    refreshMode,
    liveBase,
    lock,
    revokeSession,
    revokeUser,
    requireWork,
    grantFor,
    requireOwner,
    issue,
    activity(req) {
      const session = requireWork(req);
      session.idle_expires_at = now() + workIdleMs;
      db.prepare(
        "UPDATE sessions SET idle_expires_at=? WHERE token_hash=?",
      ).run(session.idle_expires_at, session.token_hash);
      return sessionShape(session);
    },
    privateActivity(req) {
      const { grant } = grantFor(req);
      grant.idleExpiresAt = Math.min(grant.expiresAt, now() + privateIdleMs);
      return {
        scope: grant.scope,
        expiresAt: grant.expiresAt,
        idleExpiresAt: grant.idleExpiresAt,
      };
    },
    privateLock(req) {
      // An old tab closing must not revoke a newer grant on the same cookie.
      // Missing, expired or already-revoked tokens remain an idempotent no-op.
      const token = req.headers["x-private-token"];
      if (typeof token !== "string") return;
      const key = digest(token);
      const grant = grants.get(key);
      if (grant?.sessionHash === req.baseUser.token_hash) grants.delete(key);
    },
  };
}
module.exports = {
  createPrivacy,
  PRIVATE_ACTIONS,
  sharedState,
  adminState,
  personalState,
  publicStaff,
};
