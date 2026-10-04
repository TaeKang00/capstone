import React, { useEffect, useState } from "react";
import { api, roleLabel, timeLabel } from "../api";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  ConfirmDialog,
} from "../components/ui";
const days = ["일", "월", "화", "수", "목", "금", "토"];
const blank = {
  name: "",
  phone: "",
  role: "designer",
  status: "active",
  workingDays: [1, 2, 3, 4, 5, 6],
  startMinutes: 600,
  endMinutes: 1200,
  breakStart: null,
  breakEnd: null,
};
const minutes = (value) =>
  value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
export default function Staff({
  data,
  user,
  runAction,
  refresh,
  notify,
  navigate,
}) {
  const [users, setUsers] = useState([]),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("active"),
    [editing, setEditing] = useState(null),
    [account, setAccount] = useState(null),
    [change, setChange] = useState(null),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/users")
      .then((r) => {
        setUsers(r.users);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const save = async (payload) => {
    const result = await runAction("staff.save", payload);
    await load();
    return result;
  };
  const changeAccount = async () => {
    setBusy(true);
    try {
      await api(`/users/${change.id}`, {
        method: "PATCH",
        body: { active: !change.active },
      });
      await load();
      await refresh();
      setChange(null);
      notify("계정 상태를 변경했습니다.");
    } catch (e) {
      setError(e.message);
      setChange(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">TEAM & ACCESS</div>
          <h1 className="page-title">직원 관리</h1>
          <p className="page-description">
            근무 일정과 로그인 권한을 관리합니다. 퇴사 기록과 과거 매출은
            보관됩니다.
          </p>
        </div>
        <div className="page-actions">
          <Button onClick={() => navigate("payroll")}>급여명세</Button>
          <Button
            variant="primary"
            onClick={() =>
              setEditing({
                ...blank,
                startMinutes: data.store.open,
                endMinutes: data.store.close,
              })
            }
          >
            ＋ 직원 등록
          </Button>
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">재직 직원</div>
          <div className="stat-value">
            {data.staff.filter((s) => s.status === "active").length}
            <small>명</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">디자이너</div>
          <div className="stat-value">
            {
              data.staff.filter(
                (s) => s.status === "active" && s.role === "designer",
              ).length
            }
            <small>명</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">로그인 계정</div>
          <div className="stat-value">
            {users.filter((u) => u.active).length}
            <small>개</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">계정 발급 대기</div>
          <div className="stat-value">
            {
              data.staff.filter(
                (s) =>
                  s.status === "active" &&
                  !users.some((u) => u.staffId === s.id),
              ).length
            }
            <small>명</small>
          </div>
        </div>
      </div>
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}{" "}
          <Button variant="ghost" onClick={load}>
            다시 확인
          </Button>
        </div>
      )}
      <div className="tabs">
        {[
          ["active", "재직 직원"],
          ["inactive", "퇴사·비활성"],
          ["all", "전체"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`tab ${filter === id ? "active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="staff-grid">
        {data.staff
          .filter((s) => filter === "all" || s.status === filter)
          .map((staff) => {
            const login = users.find((u) => u.staffId === staff.id),
              locked = user.role === "manager" && staff.role === "owner";
            return (
              <section className="card staff-card" key={staff.id}>
                <div className="row">
                  <span className="avatar">{staff.name.slice(0, 1)}</span>
                  <div>
                    <h3>{staff.name}</h3>
                    <span className="help">{roleLabel(staff.role)}</span>
                  </div>
                  <div style={{ marginLeft: "auto" }}>
                    <Badge
                      tone={staff.status === "active" ? "success" : "muted"}
                    >
                      {staff.status === "active" ? "재직" : "비활성"}
                    </Badge>
                  </div>
                </div>
                <div className="staff-meta">
                  <div>{staff.phone || "연락처 미등록"}</div>
                  <div>
                    {staff.workingDays.map((day) => days[day]).join(" · ")} /{" "}
                    {timeLabel(staff.startMinutes)}–
                    {timeLabel(staff.endMinutes)}
                  </div>
                  <div>
                    휴게{" "}
                    {staff.breakStart == null
                      ? "미설정"
                      : `${timeLabel(staff.breakStart)}–${timeLabel(staff.breakEnd)}`}
                  </div>
                  <div>
                    {login
                      ? `${login.email} · ${login.active ? "계정 활성" : "로그인 차단"}`
                      : "로그인 계정 미발급"}
                  </div>
                </div>
                <div className="staff-actions">
                  <Button
                    onClick={() => setEditing({ ...staff })}
                    disabled={locked}
                  >
                    직원 정보
                  </Button>
                  {!login ? (
                    <Button
                      onClick={() => setAccount({ staff, mode: "create" })}
                      disabled={locked || staff.status !== "active"}
                    >
                      계정 발급
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setAccount({ staff, login, mode: "edit" })
                        }
                        disabled={locked}
                      >
                        계정 관리
                      </Button>
                      {login.id !== user.id && (
                        <Button
                          variant="ghost"
                          onClick={() => setChange(login)}
                          disabled={locked}
                        >
                          {login.active ? "로그인 차단" : "차단 해제"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </section>
            );
          })}
      </div>
      {!data.staff.some((s) => filter === "all" || s.status === filter) && (
        <EmptyState
          title="해당하는 직원이 없습니다"
          description="직원을 등록하고 근무 요일·시간을 설정하세요."
        />
      )}
      <div className="alert" style={{ marginTop: 24 }}>
        <strong>권한 안내</strong>
        <br />
        원장: 매장 전체·백업 / 매니저: 운영·직원·급여 / 접수 직원:
        예약·수납·재고·확정된 본인 급여명세 / 디자이너: 본인 예약·고객·확정된
        본인 급여명세. 계정과 연결된 직원의 역할은 계정 관리에서 변경합니다.
      </div>
      {editing && (
        <StaffForm
          initial={editing}
          user={user}
          linked={users.some((u) => u.staffId === editing.id)}
          save={save}
          close={() => setEditing(null)}
          notify={notify}
        />
      )}{" "}
      {account && (
        <AccountForm
          {...account}
          user={user}
          close={() => setAccount(null)}
          done={async () => {
            await load();
            await refresh();
            notify("로그인 계정을 저장했습니다.");
          }}
        />
      )}
      {change && (
        <ConfirmDialog
          title={
            change.active
              ? "직원 로그인을 차단할까요?"
              : "직원 로그인 차단을 해제할까요?"
          }
          variant={change.active ? "danger" : "primary"}
          confirmLabel={change.active ? "로그인 차단" : "차단 해제"}
          busy={busy}
          onClose={() => !busy && setChange(null)}
          onConfirm={changeAccount}
        >
          {change.name}님의 계정에 적용됩니다. 이미 로그인된 기기의 세션도
          종료됩니다.
        </ConfirmDialog>
      )}
    </>
  );
}
function StaffForm({ initial, user, linked, save, close, notify }) {
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await save(form);
      notify("직원 정보를 저장했습니다.");
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={form.id ? "직원 정보 수정" : "직원 등록"}
      onClose={busy ? undefined : close}
      dirty={dirty}
      footer={
        <Button form="staff-form" type="submit" variant="primary" busy={busy}>
          직원 저장
        </Button>
      }
    >
      <form id="staff-form" className="stack" onSubmit={submit}>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        <div className="grid grid-2">
          <Field label="직원 이름">
            <input required maxLength={60} {...field("name")} />
          </Field>
          <Field label="연락처">
            <input
              type="tel"
              maxLength={30}
              placeholder="010-0000-0000"
              {...field("phone")}
            />
          </Field>
        </div>
        <div className="grid grid-2">
          <Field
            label="역할"
            help={
              linked
                ? "계정이 연결되어 있어 계정 관리에서 변경할 수 있습니다."
                : undefined
            }
          >
            <select {...field("role")} disabled={linked}>
              {["owner", "manager", "designer", "reception"]
                .filter((role) => user.role === "owner" || role !== "owner")
                .map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="재직 상태">
            <select {...field("status")}>
              <option value="active">재직</option>
              <option value="inactive">퇴사·비활성</option>
            </select>
          </Field>
        </div>
        <div className="field">
          <span className="field-label">근무 요일</span>
          <div className="day-toggle">
            {days.map((day, index) => (
              <button
                type="button"
                key={day}
                aria-pressed={form.workingDays.includes(index)}
                className={form.workingDays.includes(index) ? "active" : ""}
                onClick={() =>
                  setForm({
                    ...form,
                    workingDays: form.workingDays.includes(index)
                      ? form.workingDays.filter((d) => d !== index)
                      : [...form.workingDays, index].sort(),
                  })
                }
              >
                {day}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-2">
          {[
            ["startMinutes", "근무 시작"],
            ["endMinutes", "근무 종료"],
            ["breakStart", "휴게 시작 (선택)"],
            ["breakEnd", "휴게 종료 (선택)"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <div>
                <input
                  type="time"
                  required={
                    (key === "startMinutes" || key === "endMinutes") &&
                    form[key] !== 1440
                  }
                  disabled={form[key] === 1440}
                  value={
                    form[key] == null || form[key] === 1440
                      ? ""
                      : timeLabel(form[key])
                  }
                  onChange={(e) =>
                    setForm({ ...form, [key]: minutes(e.target.value) })
                  }
                />
                {(key === "endMinutes" || key === "breakEnd") && (
                  <label className="check" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={form[key] === 1440}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          [key]: e.target.checked
                            ? 1440
                            : key === "endMinutes"
                              ? 1200
                              : null,
                        })
                      }
                    />
                    자정 (24:00)에 종료
                  </label>
                )}
              </div>
            </Field>
          ))}
        </div>
        <p className="help">
          근무시간 밖 예약과 겹치는 예약은 등록할 수 없습니다. 앞으로 남은
          예약이 있다면 담당자를 먼저 변경한 뒤 비활성화해 주세요.
        </p>
      </form>
    </Modal>
  );
}
function AccountForm({ staff, login, mode, user, close, done }) {
  const initial = {
    name: staff.name,
    email: login?.email || "",
    role: login?.role || staff.role,
    password: "",
    staffId: staff.id,
  };
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body =
        mode === "create"
          ? form
          : {
              role: form.role,
              ...(form.password ? { password: form.password } : {}),
            };
      await api(mode === "create" ? "/users" : `/users/${login.id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        body,
      });
      await done();
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${staff.name} · ${mode === "create" ? "계정 발급" : "계정 관리"}`}
      onClose={busy ? undefined : close}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
      footer={
        <Button
          form="account-form"
          type="submit"
          variant="primary"
          busy={busy}
          disabled={
            mode === "edit" && JSON.stringify(form) === JSON.stringify(initial)
          }
        >
          계정 저장
        </Button>
      }
    >
      <form id="account-form" className="stack" onSubmit={submit}>
        {error && (
          <div role="alert" className="alert alert-warning">
            {error}
          </div>
        )}
        <Field label="로그인 이메일">
          <input
            required
            type="email"
            disabled={mode === "edit"}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="접근 권한">
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {["owner", "manager", "designer", "reception"]
              .filter((role) => user.role === "owner" || role !== "owner")
              .map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
          </select>
        </Field>
        <Field
          label={
            mode === "create"
              ? "임시 비밀번호"
              : "새 임시 비밀번호 (재설정할 때만 입력)"
          }
          help="12~128자. 직원에게 별도 전달해 주세요. 다음 로그인 시 본인이 새 비밀번호를 설정해야 합니다."
        >
          <input
            required={mode === "create"}
            minLength={12}
            maxLength={128}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <div className="alert alert-warning">
          권한 변경 또는 비밀번호 재설정 시 해당 직원의 기존 로그인은
          종료됩니다.
        </div>
      </form>
    </Modal>
  );
}
