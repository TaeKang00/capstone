let session = null;
export const getSession = () => session;
export const setSession = (value) => {
  session = value;
};
export async function api(path, options = {}) {
  const requestSession = session;
  const headers = { ...options.headers };
  if (options.body !== undefined && typeof options.body !== "string") {
    options = { ...options, body: JSON.stringify(options.body) };
    headers["Content-Type"] = "application/json";
  }
  if (session?.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: "same-origin",
    });
  } catch {
    const error = new Error(
      "서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
    );
    error.code = "NETWORK";
    throw error;
  }
  if (response.status === 204) return null;
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error(
      "서버 응답을 끝까지 받지 못했습니다. 같은 내용으로 다시 시도하면 저장 여부를 확인합니다.",
    );
    error.code = "NETWORK";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      result?.error?.message ||
        "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
    error.status = response.status;
    error.code = result?.error?.code;
    error.fields = result?.error?.fields;
    if (
      session === requestSession &&
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/me"
    )
      window.dispatchEvent(new Event("session-expired"));
    throw error;
  }
  return result;
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
