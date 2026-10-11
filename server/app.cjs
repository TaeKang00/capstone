"use strict";
const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const {
  openDatabase,
  transaction,
  readState,
  writeState,
  audit,
  backup,
} = require("./db.cjs");
const {
  COOKIE_NAME,
  publicUser,
  problem,
  hashPassword,
  verifyPassword,
  digest,
  setSessionCookie,
  createSession,
  getSession,
  constantEqual,
} = require("./auth.cjs");

const ROLES = ["owner", "manager", "designer", "reception"];
const {
  createPrivacy,
  PRIVATE_ACTIONS,
  sharedState,
  adminState,
  personalState,
  publicStaff,
} = require("./privacy.cjs");
const ALL_ACTIONS = new Set([
  "supplier.save",
  "category.save",
  "purchase.create",
  "purchase.ship",
  "purchase.receive",
  "purchase.receiptCancel",
  "purchase.cancel",
  "purchase.payment",
  "customer.save",
  "customer.archive",
  "appointment.save",
  "appointment.status",
  "staff.save",
  "service.save",
  "store.save",
  "legacy.import",
  "payment.create",
  "payment.correct",
  "payment.refund",
  "inventory.receipt",
  "inventory.correct",
  "inventory.cancel",
  "inventory.threshold",
  "inventory.adjust",
  "inventory.item",
  "payroll.save",
  "payroll.finalize",
  "payroll.reopen",
  "payroll.paid",
]);
function text(value, label, max = 200, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw problem(422, "INVALID_FIELD", `${label}을(를) 확인해 주세요.`);
  return value.trim();
}
function loginIdentifier(body) {
  const value = body.loginId ?? body.email;
  const identifier = text(value, "아이디", 254, true).toLowerCase();
  // Existing email-based accounts continue to work after the UI switches to IDs.
  if (
    !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(identifier) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
  )
    throw problem(
      422,
      "INVALID_LOGIN_ID",
      "아이디는 영문·숫자·점·밑줄·하이픈으로 3~32자 입력해 주세요.",
    );
  return identifier;
}
function loginInput(body) {
  const value = body.loginId ?? body.email;
  return typeof value === "string"
    ? value.trim().toLowerCase().slice(0, 254)
    : "";
}
function actorFor(row) {
  return { id: row.id, name: row.name, role: row.role, staffId: row.staff_id };
}
function today() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function loopback(address) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}
function filterState(envelope, user) {
  const data = structuredClone(envelope.data);
  delete data.legacyArchive;
  data.payroll = [];
  data.payrolls = [];
  // Only inventory fields are exposed; legacy/unstructured logs may contain private data.
  data.logs = (data.logs || [])
    .filter(
      (log) =>
        data.items?.some((i) => i.id === log.itemId) &&
        Number.isFinite(log.delta),
    )
    .map(
      ({
        id,
        dt,
        at,
        itemId,
        delta,
        kind,
        after,
        beforeStock,
        ref,
        actorId,
        actorName,
        reason,
        receiptId,
        beforeMin,
        afterMin,
      }) => ({
        id,
        dt,
        at,
        itemId,
        delta,
        kind,
        after,
        beforeStock,
        ref,
        actorId,
        actorName,
        reason,
        receiptId,
        beforeMin,
        afterMin,
      }),
    );
  data.staff = (data.staff || []).map(publicStaff);
  if (user.role === "designer") {
    data.appointments = (data.appointments || []).filter(
      (x) => x.staffId === user.staff_id,
    );
    data.transactions = (data.transactions || []).filter(
      (x) => x.staffId === user.staff_id,
    );
    const ids = new Set(data.transactions.map((x) => x.id));
    data.refunds = (data.refunds || []).filter((x) => ids.has(x.transactionId));
    data.suppliers = [];
    data.purchaseOrders = [];
    data.receipts = [];
    data.logs = [];
    data.inventoryOperations = [];
  }
  return { data, version: envelope.version };
}
function ensureActorStillActive(db, req) {
  if (req.privateGrant) return req.privacy.requireOwner(req).user;
  return req.privacy.requireWork(req);
}
function permission(type, payload, req, state) {
  if (!ALL_ACTIONS.has(type))
    throw problem(404, "UNKNOWN_ACTION", "지원하지 않는 작업입니다.");
  const role = req.user.role;
  if (role === "designer") {
    if (
      !["customer.save", "appointment.save", "appointment.status"].includes(
        type,
      )
    )
      throw problem(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
    if (type.startsWith("appointment.")) {
      const existing = payload.id
        ? state.appointments.find((x) => x.id === payload.id)
        : null;
      if (
        (existing && existing.staffId !== req.user.staff_id) ||
        (type === "appointment.save" && payload.staffId !== req.user.staff_id)
      )
        throw problem(403, "FORBIDDEN", "본인 담당 예약만 변경할 수 있습니다.");
    }
  }
  if (
    role === "reception" &&
    ((!/^(customer|appointment|payment|inventory)\./.test(type) &&
      !["purchase.receive", "purchase.receiptCancel"].includes(type)) ||
      type === "inventory.item")
  )
    throw problem(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  if (type === "legacy.import" && role !== "owner")
    throw problem(403, "FORBIDDEN", "원장만 이전 데이터를 가져올 수 있습니다.");
  if (type === "staff.save") {
    const target = state.staff.find((x) => x.id === payload.id);
    if (
      role !== "owner" &&
      (payload.role === "owner" || target?.role === "owner")
    )
      throw problem(
        403,
        "FORBIDDEN",
        "원장 직원 정보는 원장만 변경할 수 있습니다.",
      );
    const linked =
      payload.id &&
      req.db.prepare("SELECT * FROM users WHERE staff_id=?").get(payload.id);
    if (linked && payload.role !== linked.role)
      throw problem(
        409,
        "LINKED_ACCOUNT_ROLE",
        "로그인 계정이 있는 직원의 권한은 계정 관리에서 변경해 주세요.",
      );
    if (linked?.id === req.user.id && payload.status === "inactive")
      throw problem(
        409,
        "SELF_DISABLE",
        "현재 로그인한 본인의 직원 정보를 비활성화할 수 없습니다.",
      );
    if (
      linked?.role === "owner" &&
      payload.status === "inactive" &&
      req.db
        .prepare("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1")
        .get().n <= 1
    )
      throw problem(
        409,
        "LAST_OWNER",
        "마지막 원장 계정은 비활성화할 수 없습니다.",
      );
  }
}
function summary(type, payload) {
  const labels = {
    "supplier.save": "거래처 저장",
    "category.save": "품목 분류 저장",
    "purchase.create": "발주 등록",
    "purchase.ship": "발주 배송 시작",
    "purchase.receive": "발주 입고",
    "purchase.receiptCancel": "발주 입고 취소",
    "purchase.cancel": "발주 취소",
    "purchase.payment": "거래처 대금 지급 기록",
    "customer.save": "고객 정보 저장",
    "customer.archive": "고객 보관 상태 변경",
    "appointment.save": "예약 저장",
    "appointment.status": "예약 상태 변경",
    "staff.save": "직원 정보 저장",
    "service.save": "시술 메뉴 저장",
    "store.save": "매장 설정 변경",
    "legacy.import": "이전 데이터 가져오기",
    "payment.create": "수납 기록",
    "payment.correct": "수납 정보 정정",
    "payment.refund": "환불 기록",
    "inventory.receipt": "수동 입고",
    "inventory.correct": "입고 수량 정정",
    "inventory.cancel": "입고 취소",
    "inventory.threshold": "보충 기준 변경",
    "inventory.adjust": "재고 실사 조정",
    "inventory.item": "재고 품목 저장",
    "payroll.save": "급여명세서 저장",
    "payroll.finalize": "급여명세서 확정",
    "payroll.reopen": "급여명세서 확정 취소",
    "payroll.paid": "급여 지급 완료 기록",
  };
  const id =
    payload.id || payload.transactionId || payload.receiptId || payload.itemId;
  return `${labels[type] || type}${id ? ` (${String(id).slice(0, 80)})` : ""}`;
}
function validRange(query) {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const from = query.from || today();
  const to = query.to || from;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !date.test(from) ||
    !date.test(to) ||
    from > to ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to))
  )
    throw problem(422, "INVALID_DATE", "조회 시작일과 종료일을 확인해 주세요.");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 3660)
    throw problem(
      422,
      "INVALID_RANGE",
      "조회 기간은 10년 이내로 선택해 주세요.",
    );
  return {
    from,
    to,
    ...(typeof query.staffId === "string" && query.staffId
      ? { staffId: query.staffId }
      : {}),
  };
}
const csvCell = (value) => {
  const raw = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

function createApp(options = {}) {
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  const origin = (options.origin ?? process.env.APP_ORIGIN ?? "").replace(
    /\/$/,
    "",
  );
  const bootstrapToken =
    options.bootstrapToken ?? process.env.BOOTSTRAP_TOKEN ?? "";
  const sessionHours = options.sessionHours ?? 12;
  if (production && (!origin || new URL(origin).protocol !== "https:"))
    throw new Error("Production APP_ORIGIN must be a complete HTTPS origin.");
  if (production && bootstrapToken && bootstrapToken.length < 24)
    throw new Error(
      "Production BOOTSTRAP_TOKEN must be at least 24 characters.",
    );
  if (origin && new URL(origin).origin !== origin)
    throw new Error("APP_ORIGIN must contain an origin only, with no path.");
  const db = openDatabase(
    options.dbPath ?? process.env.DB_PATH ?? path.resolve("data/salon.sqlite"),
  );
  const privacy = createPrivacy(db, options);
  const newSession = (userId) =>
    createSession(db, userId, sessionHours, {
      now: privacy.now(),
      idleMs: privacy.workIdleMs,
    });
  const app = express();
  app.disable("x-powered-by");
  const asyncRoute = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
  const rate = new Map();
  function throttle(req, bucket, limit, minutes) {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    if (rate.size > 10000)
      for (const [key, value] of rate) if (value.until <= now) rate.delete(key);
    const entry = rate.get(key);
    if (!entry || entry.until <= now) {
      rate.set(key, { count: 1, until: now + minutes * 60000 });
      return;
    }
    entry.count += 1;
    if (entry.count > limit)
      throw problem(
        429,
        "RATE_LIMITED",
        `요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.`,
      );
  }
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'",
    );
    if (production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    if (req.path.startsWith("/api/"))
      res.setHeader("Cache-Control", "no-store");
    if (
      req.path.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      const requestOrigin = req.headers.origin;
      let allowed = !requestOrigin;
      if (requestOrigin) {
        allowed = production
          ? requestOrigin === origin
          : requestOrigin === origin ||
            requestOrigin === `${req.protocol}://${req.get("host")}`;
        if (!production && !origin) {
          try {
            const url = new URL(requestOrigin);
            allowed ||=
              ["http:", "https:"].includes(url.protocol) &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
              loopback(req.socket.remoteAddress);
          } catch {}
        }
      }
      if (!allowed || req.headers["sec-fetch-site"] === "cross-site")
        return next(
          problem(
            403,
            "INVALID_ORIGIN",
            "허용되지 않은 접속 경로입니다. 매장 ERP 주소에서 다시 시도해 주세요.",
          ),
        );
      if (!req.is("application/json") && req.path !== "/api/auth/logout")
        return next(
          problem(415, "JSON_REQUIRED", "JSON 형식의 요청이 필요합니다."),
        );
    }
    req.db = db;
    req.privacy = privacy;
    next();
  });
  app.use(express.json({ limit: "2mb", strict: true }));
  app.get("/api/health", (req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  });
  app.get("/api/bootstrap", (req, res) => {
    const needsSetup = !db.prepare("SELECT 1 FROM users LIMIT 1").get();
    res.json({
      needsSetup,
      setupAllowed:
        needsSetup &&
        (production ? !!bootstrapToken : loopback(req.socket.remoteAddress)),
      requiresToken: production,
    });
  });
  const respondSession = (res, user, session) => {
    setSessionCookie(res, session.token, production, sessionHours);
    res.json({
      user: publicUser(user),
      csrfToken: session.csrfToken,
      mode: session.mode,
      idleExpiresAt: session.idleExpiresAt,
    });
  };
  app.post(
    "/api/bootstrap",
    asyncRoute(async (req, res) => {
      throttle(req, "bootstrap", 8, 15);
      if (db.prepare("SELECT 1 FROM users LIMIT 1").get())
        throw problem(
          409,
          "ALREADY_CONFIGURED",
          "이미 초기 설정이 완료되었습니다. 로그인해 주세요.",
        );
      if (
        (production &&
          (!bootstrapToken ||
            !constantEqual(req.body.setupToken, bootstrapToken))) ||
        (!production && !loopback(req.socket.remoteAddress))
      )
        throw problem(
          403,
          "SETUP_DENIED",
          "초기 설정 권한을 확인해 주세요. 운영 서버에서는 설치 토큰이 필요합니다.",
        );
      const name = text(req.body.name, "이름", 80, true);
      const storeName = text(req.body.storeName, "매장명", 100, true);
      const email = loginIdentifier(req.body);
      const hash = await hashPassword(req.body.password, {
        allowDemo: !production && email === "admin",
      });
      const id = randomUUID();
      const staffId = randomUUID();
      let session;
      let user;
      transaction(db, () => {
        if (db.prepare("SELECT 1 FROM users LIMIT 1").get())
          throw problem(
            409,
            "ALREADY_CONFIGURED",
            "초기 설정이 이미 완료되었습니다.",
          );
        db.prepare(
          "INSERT INTO users(id,name,email,password_hash,role,staff_id,created_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          id,
          name,
          email,
          hash,
          "owner",
          staffId,
          new Date().toISOString(),
        );
        const initial = require("./operations.cjs").initialState({
          storeName,
          ownerName: name,
          ownerStaffId: staffId,
        });
        initial.payroll ||= [];
        writeState(db, initial, 1);
        user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
        session = newSession(id);
        audit(db, actorFor(user), "bootstrap", "매장 및 첫 원장 계정 등록");
      });
      res.status(201);
      respondSession(res, user, session);
    }),
  );
  app.post(
    "/api/auth/login",
    asyncRoute(async (req, res) => {
      throttle(req, "login-global", 100, 15);
      const email = loginInput(req.body);
      throttle(req, `login-${digest(email).slice(0, 24)}`, 15, 15);
      const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
      const dummyHash =
        "scrypt$00000000000000000000000000000000$" + "00".repeat(64);
      const valid = await verifyPassword(
        req.body.password,
        user?.password_hash || dummyHash,
      );
      if (!valid || !user?.active)
        throw problem(
          401,
          "INVALID_LOGIN",
          "아이디 또는 비밀번호가 올바르지 않습니다.",
        );
      const staff = readState(db)?.data.staff.find(
        (x) => x.id === user.staff_id,
      );
      if (!staff || staff.status !== "active")
        throw problem(
          401,
          "INVALID_LOGIN",
          "아이디 또는 비밀번호가 올바르지 않습니다.",
        );
      let session;
      transaction(db, () => {
        const current = db
          .prepare("SELECT * FROM users WHERE id=? AND active=1")
          .get(user.id);
        if (
          !current ||
          current.password_hash !== user.password_hash ||
          current.role !== user.role ||
          current.must_change_password !== user.must_change_password
        )
          throw problem(
            401,
            "INVALID_LOGIN",
            "계정 정보가 변경되었습니다. 다시 로그인해 주세요.",
          );
        const previous = getSession(db, req, privacy.now());
        if (previous) {
          privacy.revokeSession(previous.token_hash);
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            previous.token_hash,
          );
        }
        session = newSession(user.id);
        audit(db, actorFor(user), "auth.login", "로그인");
      });
      respondSession(res, user, session);
    }),
  );
  app.use("/api", (req, res, next) => {
    try {
      const session = getSession(db, req, privacy.now());
      if (!session) throw problem(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
      const staff = readState(db)?.data.staff.find(
        (x) => x.id === session.staff_id,
      );
      if (!staff || staff.status !== "active")
        throw problem(401, "ACCOUNT_INACTIVE", "비활성화된 직원 계정입니다.");
      privacy.refreshMode(session);
      req.baseUser = session;
      req.user = session;
      if (
        !["GET", "HEAD"].includes(req.method) &&
        !constantEqual(req.headers["x-csrf-token"], session.csrf_token)
      )
        throw problem(
          403,
          "INVALID_CSRF",
          "로그인 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
        );
      if (
        session.mode === "work" &&
        session.must_change_password &&
        !["/auth/me", "/auth/password", "/auth/logout", "/auth/lock"].includes(
          req.path,
        )
      )
        throw problem(
          403,
          "PASSWORD_CHANGE_REQUIRED",
          "임시 비밀번호를 새 비밀번호로 변경해 주세요.",
        );
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/auth/me", (req, res) =>
    res.json(privacy.sessionShape(req.baseUser)),
  );
  app.post("/api/auth/logout", (req, res) => {
    privacy.revokeSession(req.baseUser.token_hash);
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
      req.user.token_hash,
    );
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/",
    });
    res.status(204).end();
  });
  app.post(
    "/api/auth/password",
    asyncRoute(async (req, res) => {
      privacy.requireWork(req);
      throttle(req, "password", 10, 15);
      if (
        !(await verifyPassword(
          req.body.currentPassword,
          req.user.password_hash,
        ))
      )
        throw problem(
          422,
          "WRONG_PASSWORD",
          "현재 비밀번호가 올바르지 않습니다.",
        );
      if (req.body.currentPassword === req.body.newPassword)
        throw problem(
          422,
          "SAME_PASSWORD",
          "현재 비밀번호와 다른 비밀번호를 입력해 주세요.",
        );
      const hash = await hashPassword(req.body.newPassword);
      let user;
      let session;
      transaction(db, () => {
        ensureActorStillActive(db, req);
        db.prepare(
          "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?",
        ).run(hash, req.user.id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
        privacy.revokeUser(req.user.id);
        session = newSession(req.user.id);
        user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
        audit(
          db,
          actorFor(user),
          "auth.password",
          "비밀번호 변경 및 기존 세션 종료",
        );
      });
      respondSession(res, user, session);
    }),
  );
  app.post("/api/auth/lock", (req, res) => {
    audit(db, actorFor(req.baseUser), "auth.lock", "공용 화면으로 전환");
    res.json(privacy.lock(req.baseUser));
  });
  app.post("/api/auth/activity", (req, res) => res.json(privacy.activity(req)));
  app.post(
    "/api/auth/private/unlock",
    asyncRoute(async (req, res) => {
      const { scope } = req.body;
      if (!["owner", "personal"].includes(scope))
        throw problem(422, "INVALID_SCOPE", "보호 영역을 확인해 주세요.");
      throttle(req, "private-global", 100, 15);
      const email = loginInput(req.body);
      throttle(req, `private-${digest(email).slice(0, 24)}`, 10, 15);
      const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
      const valid = await verifyPassword(
        req.body.password,
        user?.password_hash ||
          "scrypt$00000000000000000000000000000000$" + "00".repeat(64),
      );
      if (
        !valid ||
        !user?.active ||
        user.must_change_password ||
        (scope === "owner" && user.role !== "owner")
      )
        throw problem(
          403,
          "PRIVATE_LOGIN_FAILED",
          "이 영역에 접근할 수 있는 계정과 비밀번호를 확인해 주세요.",
        );
      let result;
      transaction(db, () => {
        const current = db
          .prepare("SELECT * FROM users WHERE id=? AND active=1")
          .get(user.id);
        const staff =
          current &&
          readState(db)?.data.staff.find((s) => s.id === current.staff_id);
        if (
          !current ||
          current.password_hash !== user.password_hash ||
          current.role !== user.role ||
          current.must_change_password ||
          staff?.status !== "active"
        )
          throw problem(
            403,
            "PRIVATE_LOGIN_FAILED",
            "계정이 변경되었습니다. 다시 인증해 주세요.",
          );
        result = privacy.issue(req, scope, current);
        audit(
          db,
          actorFor(current),
          `auth.private.${scope}`,
          "보호 영역 본인 재인증",
        );
      });
      res.json(result);
    }),
  );
  app.post("/api/auth/private/lock", (req, res) => {
    privacy.privateLock(req);
    res.status(204).end();
  });
  app.post("/api/auth/private/activity", (req, res) =>
    res.json(privacy.privateActivity(req)),
  );
  app.get("/api/state", (req, res) => {
    const session = privacy.liveBase(req);
    const result =
      session.mode === "shared"
        ? sharedState(readState(db), today())
        : filterState(readState(db), session);
    res.json({ ...result, session: privacy.sessionShape(session) });
  });
  app.get("/api/admin/state", (req, res) => {
    privacy.requireOwner(req);
    res.json(adminState(readState(db)));
  });
  app.get("/api/personal/state", (req, res) => {
    const { user } = privacy.grantFor(req, "personal");
    res.json(personalState(readState(db), user));
  });
  app.post("/api/actions/:type", (req, res, next) => {
    try {
      const { type } = req.params;
      if (PRIVATE_ACTIONS.has(type)) privacy.requireOwner(req);
      else privacy.requireWork(req);
      const { payload, version, requestId } = req.body;
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !Number.isSafeInteger(version) ||
        typeof requestId !== "string" ||
        !/^[\w-]{12,100}$/.test(requestId)
      )
        throw problem(
          422,
          "INVALID_ACTION",
          "작업 정보 또는 저장 버전이 올바르지 않습니다.",
        );
      const signature = digest(JSON.stringify({ type, payload }));
      let result;
      transaction(db, () => {
        ensureActorStillActive(db, req);
        const current = readState(db);
        permission(type, payload, req, current.data);
        const previous = db
          .prepare(
            "SELECT signature,response FROM requests WHERE actor_id=? AND request_id=?",
          )
          .get(req.user.id, requestId);
        if (previous) {
          if (previous.signature !== signature)
            throw problem(
              409,
              "REQUEST_ID_REUSED",
              "같은 요청 번호에 다른 내용이 포함되어 있습니다. 새 요청으로 다시 시도해 주세요.",
            );
          result = current;
          return;
        }
        if (version !== current.version)
          throw problem(
            409,
            "VERSION_CONFLICT",
            "다른 직원이 정보를 변경했습니다. 최신 내용을 확인하고 다시 저장해 주세요.",
          );
        const ctx = {
          actor: actorFor(req.user),
          today: today(),
          now: new Date().toISOString(),
          requestId,
        };
        let data;
        if (/^(supplier|category|purchase)\./.test(type))
          data = require("./procurement.cjs").applyProcurement(
            current.data,
            type,
            payload,
            ctx,
          );
        else if (/^(payment|inventory)\./.test(type))
          data = require("./commerce.cjs").applyCommerce(
            current.data,
            type,
            payload,
            ctx,
          );
        else if (type.startsWith("payroll."))
          data = require("./payroll.cjs").applyPayroll(
            current.data,
            type,
            payload,
            ctx,
          );
        else
          data = require("./operations.cjs").applyOperation(
            current.data,
            type,
            payload,
            ctx,
          );
        result = { data, version: current.version + 1 };
        if (type === "staff.save") {
          for (const staff of data.staff) {
            db.prepare("UPDATE users SET name=? WHERE staff_id=?").run(
              staff.name,
              staff.id,
            );
            if (staff.status !== "active")
              db.prepare(
                "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE staff_id=?)",
              ).run(staff.id);
          }
        }
        writeState(db, data, result.version);
        audit(db, ctx.actor, type, summary(type, payload));
        db.prepare(
          "INSERT INTO requests(actor_id,request_id,signature,response,created_at) VALUES(?,?,?,?,?)",
        ).run(
          req.user.id,
          requestId,
          signature,
          JSON.stringify({ version: result.version }),
          ctx.now,
        );
      });
      res.json(
        req.privateGrant
          ? adminState(result)
          : {
              ...filterState(result, req.user),
              session: privacy.sessionShape(req.baseUser),
            },
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/reports", (req, res, next) => {
    try {
      privacy.requireOwner(req);
      res.json(
        require("./commerce.cjs").getReport(
          readState(db).data,
          validRange(req.query),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/export", (req, res, next) => {
    try {
      privacy.requireOwner(req);
      const range = validRange(req.query);
      const report = require("./commerce.cjs").getReport(
        readState(db).data,
        range,
      );
      const rows = [["유형", "거래번호", "일자", "고객", "결제수단", "금액"]];
      for (const t of report.transactions || [])
        rows.push(["수납", t.id, t.date, t.customerName, t.method, t.total]);
      for (const r of report.refundEntries || [])
        rows.push(["환불", r.transactionId, r.date, "", r.method, -r.amount]);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="sales-${range.from}-${range.to}.csv"`,
      );
      res.send(
        "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/users", (req, res, next) => {
    try {
      privacy.requireOwner(req);
      const users = db
        .prepare("SELECT * FROM users ORDER BY created_at,id")
        .all()
        .map(publicUser);
      res.json({ users });
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/api/users",
    asyncRoute(async (req, res) => {
      privacy.requireOwner(req);
      throttle(req, "users", 30, 15);
      const name = text(req.body.name, "이름", 80, true);
      const email = loginIdentifier(req.body);
      const role = req.body.role;
      const staffId = text(req.body.staffId, "직원", 100, true);
      if (
        !ROLES.includes(role) ||
        (role === "owner" && req.user.role !== "owner")
      )
        throw problem(
          403,
          "FORBIDDEN",
          "지정한 권한으로 계정을 만들 수 없습니다.",
        );
      const hash = await hashPassword(req.body.password);
      let user;
      transaction(db, () => {
        ensureActorStillActive(db, req);
        const current = readState(db);
        const staff = current.data.staff.find((x) => x.id === staffId);
        if (!staff || staff.status !== "active")
          throw problem(
            422,
            "INVALID_STAFF",
            "활성 직원 정보를 먼저 등록해 주세요.",
          );
        if (staff.role === "owner" && req.user.role !== "owner")
          throw problem(
            403,
            "FORBIDDEN",
            "원장 직원의 계정은 원장만 등록할 수 있습니다.",
          );
        if (
          db
            .prepare("SELECT 1 FROM users WHERE email=? OR staff_id=?")
            .get(email, staffId)
        )
          throw problem(
            409,
            "ACCOUNT_EXISTS",
            "이 아이디 또는 직원은 이미 로그인 계정이 있습니다.",
          );
        const id = randomUUID();
        db.prepare(
          "INSERT INTO users(id,name,email,password_hash,role,staff_id,must_change_password,created_at) VALUES(?,?,?,?,?,?,1,?)",
        ).run(id, name, email, hash, role, staffId, new Date().toISOString());
        staff.role = role;
        staff.name = name;
        writeState(db, current.data, current.version + 1);
        user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
        audit(
          db,
          actorFor(req.user),
          "user.create",
          `${name} 계정 등록 (${role})`,
        );
      });
      res.status(201).json({ user: publicUser(user) });
    }),
  );
  app.patch(
    "/api/users/:id",
    asyncRoute(async (req, res) => {
      privacy.requireOwner(req);
      throttle(req, "users", 30, 15);
      const { active, role, password } = req.body;
      if (active === undefined && role === undefined && password === undefined)
        throw problem(422, "EMPTY_UPDATE", "변경할 계정 정보가 없습니다.");
      if (active !== undefined && typeof active !== "boolean")
        throw problem(422, "INVALID_ACTIVE", "계정 활성 여부를 확인해 주세요.");
      if (role !== undefined && !ROLES.includes(role))
        throw problem(422, "INVALID_ROLE", "계정 권한을 확인해 주세요.");
      const hash = password === undefined ? null : await hashPassword(password);
      let updated;
      transaction(db, () => {
        ensureActorStillActive(db, req);
        const user = db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(req.params.id);
        if (!user)
          throw problem(404, "USER_NOT_FOUND", "계정을 찾을 수 없습니다.");
        if (
          req.user.role !== "owner" &&
          (user.role === "owner" || role === "owner")
        )
          throw problem(
            403,
            "FORBIDDEN",
            "원장 계정과 권한은 원장만 변경할 수 있습니다.",
          );
        if (
          user.id === req.user.id &&
          (active === false || (role && role !== user.role) || hash)
        )
          throw problem(
            409,
            "SELF_ACCOUNT_CHANGE",
            "본인의 권한·활성 상태는 다른 원장에게 요청해 주세요. 비밀번호는 내 비밀번호 변경에서 수정할 수 있습니다.",
          );
        if (
          user.role === "owner" &&
          user.active &&
          (active === false || (role && role !== "owner")) &&
          db
            .prepare(
              "SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1",
            )
            .get().n <= 1
        )
          throw problem(
            409,
            "LAST_OWNER",
            "마지막 원장 계정은 유지해야 합니다.",
          );
        const nextRole = role ?? user.role;
        const nextActive = active === undefined ? user.active : Number(active);
        const current = readState(db);
        const staff = current.data.staff.find((x) => x.id === user.staff_id);
        if (!staff)
          throw problem(409, "INVALID_STAFF", "연결된 직원 정보가 없습니다.");
        if (nextActive && staff.status !== "active")
          throw problem(
            409,
            "INACTIVE_STAFF",
            "직원 정보를 활성화한 다음 로그인 계정을 활성화해 주세요.",
          );
        db.prepare(
          "UPDATE users SET role=?,active=?,password_hash=?,must_change_password=? WHERE id=?",
        ).run(
          nextRole,
          nextActive,
          hash || user.password_hash,
          hash ? 1 : user.must_change_password,
          user.id,
        );
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
        privacy.revokeUser(user.id);
        staff.role = nextRole;
        writeState(db, current.data, current.version + 1);
        updated = db.prepare("SELECT * FROM users WHERE id=?").get(user.id);
        audit(
          db,
          actorFor(req.user),
          "user.update",
          `${user.name} 계정 ${hash ? "비밀번호 초기화" : "권한/활성 상태 변경"}`,
        );
      });
      res.json({ user: publicUser(updated) });
    }),
  );
  app.get("/api/audit", (req, res, next) => {
    try {
      privacy.requireOwner(req);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      res.json({
        entries: db
          .prepare(
            "SELECT id,at,actor_name actorName,action,summary FROM audit ORDER BY id DESC LIMIT ?",
          )
          .all(Math.floor(limit)),
      });
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/api/backup",
    asyncRoute(async (req, res, next) => {
      privacy.requireOwner(req);
      throttle(req, "backup", 5, 60);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "salon-backup-"));
      const filename = path.join(directory, "salon.sqlite");
      try {
        await backup(db, filename);
        privacy.requireOwner(req);
        fs.chmodSync(filename, 0o600);
        audit(
          db,
          actorFor(req.user),
          "backup.download",
          "데이터베이스 백업 다운로드",
        );
        res.download(filename, `salon-backup-${today()}.sqlite`, (error) => {
          fs.rmSync(directory, { recursive: true, force: true });
          if (error && !res.headersSent) next(error);
        });
      } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
      }
    }),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "요청한 API를 찾을 수 없습니다." },
    }),
  );
  const dist = options.distPath ?? path.resolve(__dirname, "../dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    app.use(
      express.static(dist, {
        index: false,
        maxAge: 0,
        setHeaders(res, filename) {
          if (filename.includes(`${path.sep}assets${path.sep}`))
            res.setHeader(
              "Cache-Control",
              "public, max-age=31536000, immutable",
            );
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method === "GET" && req.accepts("html")) {
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(path.join(dist, "index.html"));
      } else next();
    });
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error.status && error.status >= 400 && error.status < 600
        ? error.status
        : error.type === "entity.too.large"
          ? 413
          : 500;
    const message =
      status === 500
        ? "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
        : error.type === "entity.parse.failed"
          ? "요청 JSON 형식이 올바르지 않습니다."
          : error.message;
    if (status === 500 && options.onError) options.onError(error);
    res.status(status).json({
      error: {
        code:
          error.code || (status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST"),
        message,
        ...(error.session ? { session: error.session } : {}),
      },
    });
  });
  return { app, db, close: () => db.close() };
}
module.exports = { createApp, filterState, csvCell };
