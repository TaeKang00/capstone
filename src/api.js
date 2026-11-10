let session = null;
let privateAccess = null;
let authEpoch = 0;
let privateEpoch = 0;
export const getSession = () => session;
export const getPrivateAccess = () => privateAccess;
export const invalidateRequests = () => {
  authEpoch += 1;
};
export const setSession = (value) => {
  const same =
    session &&
    value &&
    session.user.id === value.user.id &&
    session.mode === value.mode &&
    session.csrfToken === value.csrfToken;
  if (same) Object.assign(session, value);
  else {
    session = value;
    authEpoch += 1;
  }
};
export const setPrivateAccess = (value) => {
  if (privateAccess?.accessToken !== value?.accessToken) privateEpoch += 1;
  privateAccess = value;
};
const stale = () =>
  Object.assign(
    new Error("화면이 잠겼거나 계정이 바뀌었어요. 다시 인증해 주세요."),
    { code: "STALE_RESPONSE" },
  );
async function request(path, options = {}, blob = false) {
  const {
    privateAccess: explicitAccess,
    allowStale = false,
    ...fetchOptions
  } = options;
  const access =
    explicitAccess === undefined
      ? path.startsWith("/auth/")
        ? null
        : privateAccess
      : explicitAccess;
  const requestedAuth = authEpoch,
    requestedPrivate = privateEpoch;
  const current = () =>
    allowStale ||
    (authEpoch === requestedAuth &&
      (!access ||
        (privateEpoch === requestedPrivate &&
          privateAccess?.accessToken === access.accessToken)));
  if (!current()) throw stale();
  const headers = { ...fetchOptions.headers };
  if (
    ["POST", "PUT", "PATCH"].includes(fetchOptions.method?.toUpperCase()) &&
    fetchOptions.body === undefined
  )
    fetchOptions.body = {};
  if (
    fetchOptions.body !== undefined &&
    typeof fetchOptions.body !== "string"
  ) {
    fetchOptions.body = JSON.stringify(fetchOptions.body);
    headers["Content-Type"] = "application/json";
  }
  if (session?.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;
  if (access?.accessToken) headers["X-Private-Token"] = access.accessToken;
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...fetchOptions,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    if (!current()) throw stale();
    throw Object.assign(
      new Error(
        "서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
      ),
      { code: "NETWORK" },
    );
  }
  if (!current()) throw stale();
  if (response.status === 204) return null;
  let result;
  try {
    result =
      response.ok && blob ? await response.blob() : await response.json();
  } catch {
    throw Object.assign(
      new Error(
        "서버 응답을 끝까지 받지 못했습니다. 같은 내용으로 다시 시도하면 저장 여부를 확인합니다.",
      ),
      { code: "NETWORK" },
    );
  }
  if (!current()) throw stale();
  if (!response.ok) {
    const error = Object.assign(
      new Error(
        result?.error?.message ||
          "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      ),
      {
        status: response.status,
        code: result?.error?.code,
        fields: result?.error?.fields,
      },
    );
    if (!allowStale && error.code === "WORK_LOCKED")
      window.dispatchEvent(
        new CustomEvent("work-session-locked", {
          detail: result.error.session,
        }),
      );
    if (
      !allowStale &&
      access &&
      ["PRIVATE_AUTH_REQUIRED", "PRIVATE_SESSION_EXPIRED"].includes(error.code)
    )
      window.dispatchEvent(new Event("private-access-expired"));
    if (
      !allowStale &&
      response.status === 401 &&
      !["/auth/login", "/auth/me", "/auth/private/unlock"].includes(path)
    )
      window.dispatchEvent(new Event("session-expired"));
    throw error;
  }
  if (result?.session?.mode === "shared" && session?.mode === "work") {
    window.dispatchEvent(
      new CustomEvent("work-session-locked", { detail: result.session }),
    );
    throw stale();
  }
  return result;
}
export const api = (path, options) => request(path, options);
export async function download(path, filename, options = {}) {
  const auth = authEpoch,
    grant = privateEpoch;
  const blob = await request(path, options, true);
  if (auth !== authEpoch || grant !== privateEpoch) throw stale();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const won = (value) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
export const timeLabel = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export const roleLabel = (role) =>
  ({
    owner: "원장",
    manager: "매니저",
    designer: "디자이너",
    reception: "접수 직원",
  })[role] || role;
