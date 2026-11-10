import React, { useEffect, useId, useRef, useState } from "react";
import { api, timeLabel } from "../api";
import { useViewState } from "../components/ViewState";
import Icon from "../components/Icon";
import { DateInput } from "../components/DateInput.jsx";
import { Button, EmptyState, Field, Modal, ConfirmDialog } from "../components/ui";
import "./Staff.css";

const days = ["일", "월", "화", "수", "목", "금", "토"];
const roleNames = {
  owner: "원장",
  manager: "매니저",
  designer: "디자이너",
  reception: "접수",
};
const roleHelp = {
  owner: "모든 메뉴와 원장 관리를 쓸 수 있어요",
  manager: "예약, 고객, 결제, 재고 같은 매장 운영을 모두 쓸 수 있어요",
  designer: "디자이너는 본인 예약과 고객만 볼 수 있어요",
  reception: "예약, 고객, 결제, 재고, 근태를 쓸 수 있어요",
};
const accessHelp = {
  owner: "모든 메뉴와 원장 관리를 쓸 수 있어요",
  manager: "예약, 고객, 결제, 재고 같은 매장 운영을 모두 쓸 수 있어요",
  designer: "오늘, 내 예약, 고객, 근태를 쓸 수 있어요",
  reception: "예약, 고객, 결제, 재고, 근태를 쓸 수 있어요",
};
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
  hireDate: "",
  resignDate: "",
  birthDate: "",
  team: "",
  title: "",
  address: "",
  annualLeave: 15,
};
const minutes = (value) =>
  value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const allowedRoles = (user) =>
  ["owner", "manager", "designer", "reception"].filter(
    (role) => user.role === "owner" || role !== "owner",
  );

/** "월요일부터 토요일까지" for a consecutive run, otherwise "주 N일". */
export function workingDaysLabel(list = []) {
  const sorted = [...new Set(list)].sort((a, b) => a - b);
  if (!sorted.length) return "근무 요일 없음";
  if (sorted.length === 7) return "매일";
  if (sorted.length === 1) return `${days[sorted[0]]}요일만`;
  // Treat the week as circular so 화요일부터 일요일까지 reads naturally.
  for (let start = 0; start < 7; start++) {
    if (!sorted.includes(start) || sorted.includes((start + 6) % 7)) continue;
    const run = Array.from(
      { length: sorted.length },
      (_, i) => (start + i) % 7,
    );
    if (run.every((day) => sorted.includes(day)))
      return `${days[run[0]]}요일부터 ${days[run.at(-1)]}요일까지`;
  }
  return `주 ${sorted.length}일`;
}
const monthLabel = (date) => {
  if (!date) return "미등록";
  const [year, month] = date.split("-");
  return `${year}년 ${Number(month)}월`;
};

function RadioChips({ labelId, options, value, onChange, disabled }) {
  const refs = useRef([]);
  const current = Math.max(
    0,
    options.findIndex(([id]) => id === value),
  );
  const move = (event, index) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next][0]);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className="people-chip-row"
    >
      {options.map(([id, label], index) => (
        <button
          key={id}
          ref={(node) => (refs.current[index] = node)}
          type="button"
          role="radio"
          className="people-choice"
          aria-checked={value === id}
          tabIndex={index === current ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(id)}
          onKeyDown={(event) => move(event, index)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Staff({ data, user, refresh, notify, runAction, navigate }) {
  const [users, setUsers] = useState([]),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(null),
    [account, setAccount] = useState(null),
    [change, setChange] = useState(null),
    [busy, setBusy] = useState(false);
  const [storedFilter, setFilter] = useViewState("staff", "filter", "active");
  const filter = ["active", "pending", "inactive"].includes(storedFilter)
    ? storedFilter
    : "active";
  const [query, setQuery] = useViewState("staff", "query", "");
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
  const loginOf = (staff) => users.find((entry) => entry.staffId === staff.id);
  const activeCount = data.staff.filter((s) => s.status === "active").length;
  const pendingCount = data.staff.filter(
    (s) => s.status === "active" && !loginOf(s),
  ).length;
  const filteredStaff = data.staff.filter((staff) => {
    const login = loginOf(staff);
    const matchesStatus =
      filter === "pending"
        ? staff.status === "active" && !login
        : staff.status === filter;
    const search = query.trim().toLocaleLowerCase();
    return (
      matchesStatus &&
      (!search ||
        [staff.name, staff.phone, login?.loginId || login?.email].some(
          (value) =>
            String(value || "")
              .toLocaleLowerCase()
              .includes(search),
        ))
    );
  });
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
    <div className="people-page">
      <header className="people-head">
        <div className="people-head-text">
          <span className="muted">재직 {activeCount}명</span>
          <h1 className="people-title">직원</h1>
        </div>
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
          직원 등록
        </Button>
      </header>
      {error && (
        <div className="alert alert-warning people-alert" role="alert">
          <span>{error}</span>
          <Button variant="ghost" onClick={load}>
            다시 확인
          </Button>
        </div>
      )}
      <div className="people-toolbar">
        <div role="group" aria-label="보기" className="chip-row">
          {[
            ["active", "재직"],
            ["pending", "계정 미발급", pendingCount],
            ["inactive", "퇴사"],
          ].map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              {count > 0 && <span className="people-chip-count">{count}</span>}
            </button>
          ))}
        </div>
        <div className="people-search">
          <label className="input-icon">
            <Icon name="search" size={20} />
            <input
              type="search"
              aria-label="직원 검색"
              value={query}
              placeholder="이름, 연락처, 아이디"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {query && (
            <button
              type="button"
              className="icon-btn"
              aria-label="검색 초기화"
              onClick={() => setQuery("")}
            >
              <Icon name="close" size={20} />
            </button>
          )}
          <span className="muted small people-count" role="status">
            {filteredStaff.length}명
          </span>
        </div>
      </div>
      {filteredStaff.length > 0 ? (
        <div className="people-grid">
          {filteredStaff.map((staff) => {
            const login = loginOf(staff),
              locked = user.role === "manager" && staff.role === "owner",
              resigned = staff.status !== "active";
            const badge = resigned
              ? ["퇴사", "status-muted"]
              : !login
                ? ["계정 없음", "status-warn"]
                : login.active
                  ? ["계정 있음", "status-ok"]
                  : ["로그인 차단", "status-danger"];
            return (
              <article className="staff-card people-card" key={staff.id}>
                <div className="people-card-head">
                  <span className="people-avatar" aria-hidden="true">
                    {staff.name.slice(0, 1)}
                  </span>
                  <span className="people-card-name">
                    <strong>{staff.name}</strong>
                    <span className="muted small">
                      {staff.title || roleNames[staff.role] || staff.role}
                    </span>
                    {staff.team && (
                      <span className="muted small">{staff.team}</span>
                    )}
                  </span>
                  <span className={`people-badge ${badge[1]}`}>{badge[0]}</span>
                </div>
                <div className="people-facts">
                  <div className="people-fact">
                    <span className="muted small">근무</span>
                    <span className="people-fact-value">
                      {workingDaysLabel(staff.workingDays)}
                    </span>
                    <span className="muted small num">
                      {timeLabel(staff.startMinutes)}–
                      {timeLabel(staff.endMinutes)}
                    </span>
                  </div>
                  <div className="people-fact">
                    <span className="muted small">
                      {resigned && staff.resignDate ? "퇴사" : "입사"}
                    </span>
                    <span className="people-fact-value">
                      {monthLabel(
                        resigned && staff.resignDate
                          ? staff.resignDate
                          : staff.hireDate,
                      )}
                    </span>
                  </div>
                </div>
                <div className="people-card-actions">
                  <Button
                    variant="secondary"
                    onClick={() => setEditing({ ...blank, ...staff })}
                    disabled={locked}
                  >
                    정보 수정
                  </Button>
                  {!login ? (
                    <Button
                      variant="primary"
                      onClick={() => setAccount({ staff, mode: "create" })}
                      disabled={locked || resigned}
                    >
                      계정 발급
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => setAccount({ staff, login, mode: "edit" })}
                      disabled={locked}
                    >
                      계정 관리
                    </Button>
                  )}
                  <button
                    type="button"
                    className="icon-btn people-pay-btn"
                    aria-label="급여 보기"
                    title="급여 보기"
                    onClick={() => navigate("payroll", { staffId: staff.id })}
                  >
                    <Icon name="payroll" size={20} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="해당하는 직원이 없어요"
          description={
            query
              ? "이름, 연락처, 아이디를 다시 확인하거나 검색어를 지워 주세요."
              : filter === "pending"
                ? "재직 직원 모두에게 계정이 있어요."
                : filter === "inactive"
                  ? "퇴사한 직원이 없어요."
                  : "직원을 등록하고 근무 요일과 시간을 정해 주세요."
          }
        />
      )}
      {editing && (
        <StaffForm
          initial={editing}
          user={user}
          linked={users.some((u) => u.staffId === editing.id)}
          save={save}
          close={() => setEditing(null)}
          notify={notify}
        />
      )}
      {account && (
        <AccountForm
          {...account}
          user={user}
          close={() => setAccount(null)}
          onToggleLogin={(login) => {
            setAccount(null);
            setChange(login);
          }}
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
          <p>{change.name}님의 계정에 적용돼요.</p>
          <p>이미 로그인된 기기의 세션도 끝나요.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function StaffForm({ initial, user, linked, save, close, notify }) {
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState(false);
  const roleLabelId = useId(),
    dayLabelId = useId(),
    statusLabelId = useId();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const field = (key) => ({
    value: form[key] ?? "",
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await save({
        ...form,
        annualLeave:
          form.annualLeave === "" || form.annualLeave == null
            ? 15
            : Number(form.annualLeave),
      });
      notify("직원 정보를 저장했습니다.");
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const roles = allowedRoles(user);
  const timeField = (key, label) => (
    <div className="people-time" key={key}>
      <Field label={label}>
        <input
          type="time"
          className="num"
          required={
            (key === "startMinutes" || key === "endMinutes") &&
            form[key] !== 1440
          }
          disabled={form[key] === 1440}
          value={
            form[key] == null || form[key] === 1440 ? "" : timeLabel(form[key])
          }
          onChange={(e) => setForm({ ...form, [key]: minutes(e.target.value) })}
        />
      </Field>
      {(key === "endMinutes" || key === "breakEnd") && (
        <label className="check people-midnight small">
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
          자정에 종료
        </label>
      )}
    </div>
  );
  return (
    <Modal
      title={form.id ? "직원 정보 수정" : "직원 등록"}
      onClose={busy ? undefined : close}
      dirty={dirty}
      size="wide"
      footer={
        <div className="people-dialog-footer">
          <span className="muted">
            {form.id ? "" : "저장한 뒤 바로 계정을 발급할 수 있어요"}
          </span>
          <div className="people-dialog-buttons">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => (dirty ? setDiscard(true) : close())}
            >
              취소
            </Button>
            <Button form="staff-form" type="submit" variant="primary" busy={busy}>
              직원 저장
            </Button>
          </div>
        </div>
      }
    >
      <form id="staff-form" className="people-form" onSubmit={submit}>
        <fieldset disabled={busy} className="people-fieldset">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="people-grid-2">
            <Field label="이름">
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
            <Field label="직위">
              <input
                maxLength={40}
                placeholder="예: 실장, 디자이너"
                {...field("title")}
              />
            </Field>
            <Field label="소속 팀">
              <input maxLength={40} placeholder="예: 1팀" {...field("team")} />
            </Field>
            <Field label="주소" className="people-span-2">
              <input maxLength={200} {...field("address")} />
            </Field>
          </div>
          <div className="people-group">
            <span id={roleLabelId} className="people-group-label">
              역할
            </span>
            <RadioChips
              labelId={roleLabelId}
              options={roles.map((role) => [role, roleNames[role]])}
              value={form.role}
              disabled={linked}
              onChange={(role) => setForm({ ...form, role })}
            />
            <span className="muted small">
              {linked
                ? "계정이 연결되어 있어 역할은 계정 관리에서 바꿀 수 있어요"
                : roleHelp[form.role]}
            </span>
          </div>
          <div className="people-group">
            <span id={dayLabelId} className="people-group-label">
              근무 요일
            </span>
            <div role="group" aria-labelledby={dayLabelId} className="people-days">
              {days.map((day, index) => (
                <button
                  type="button"
                  key={day}
                  className="people-day"
                  aria-pressed={form.workingDays.includes(index)}
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
          <div className="people-grid-4">
            {timeField("startMinutes", "근무 시작")}
            {timeField("endMinutes", "근무 종료")}
            {timeField("breakStart", "휴게 시작")}
            {timeField("breakEnd", "휴게 종료")}
          </div>
          <div className="people-grid-3">
            <Field label="입사일">
              <DateInput
                className="input"
                type="date"
                value={form.hireDate || ""}
                onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
              />
            </Field>
            <Field label="연간 연차">
              <span className="input-icon people-suffix">
                <input
                  type="number"
                  className="num"
                  min={0}
                  max={60}
                  step={1}
                  inputMode="numeric"
                  value={form.annualLeave ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      annualLeave:
                        e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                />
                <span aria-hidden="true">일</span>
              </span>
            </Field>
            <Field label="생년월일" help="증명서에 쓰여요">
              <DateInput
                className="input"
                type="date"
                value={form.birthDate || ""}
                onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
              />
            </Field>
          </div>
          {form.id && (
            <div className="people-group">
              <span id={statusLabelId} className="people-group-label">
                재직 상태
              </span>
              <RadioChips
                labelId={statusLabelId}
                options={[
                  ["active", "재직"],
                  ["inactive", "퇴사"],
                ]}
                value={form.status}
                onChange={(status) => setForm({ ...form, status })}
              />
              {form.status === "inactive" && (
                <div className="people-grid-3">
                  <Field label="퇴사일">
                    <DateInput
                      className="input"
                      type="date"
                      value={form.resignDate || ""}
                      onChange={(e) =>
                        setForm({ ...form, resignDate: e.target.value })
                      }
                    />
                  </Field>
                </div>
              )}
              <span className="muted small">
                남은 예약이 있으면 담당자를 먼저 바꾼 뒤 퇴사로 바꿔 주세요
              </span>
            </div>
          )}
        </fieldset>
      </form>
      {discard && (
        <ConfirmDialog
          title="작성을 취소할까요?"
          onClose={() => setDiscard(false)}
          onConfirm={close}
          confirmLabel="내용 버리고 닫기"
          variant="danger"
        >
          저장하지 않은 직원 정보가 사라져요.
        </ConfirmDialog>
      )}
    </Modal>
  );
}

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function temporaryPassword() {
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map(
    (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length],
  );
  return `salon-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

function AccountForm({ staff, login, mode, user, close, done, onToggleLogin }) {
  const initial = {
    name: staff.name,
    loginId: login?.loginId || login?.email || "",
    role: login?.role || staff.role,
    password: "",
    staffId: staff.id,
  };
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState(false);
  const roleLabelId = useId();
  const create = mode === "create";
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = create
        ? form
        : {
            role: form.role,
            ...(form.password ? { password: form.password } : {}),
          };
      await api(create ? "/users" : `/users/${login.id}`, {
        method: create ? "POST" : "PATCH",
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
      title={create ? "계정 발급" : "계정 관리"}
      onClose={busy ? undefined : close}
      dirty={dirty}
      size="wide"
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => (dirty ? setDiscard(true) : close())}
          >
            취소
          </Button>
          <Button
            form="account-form"
            type="submit"
            variant="primary"
            busy={busy}
            disabled={!create && !dirty}
          >
            {create ? "계정 발급" : "계정 저장"}
          </Button>
        </>
      }
    >
      <form id="account-form" className="people-form" onSubmit={submit}>
        <fieldset disabled={busy} className="people-fieldset">
          {error && (
            <div role="alert" className="alert alert-danger">
              {error}
            </div>
          )}
          <div className="people-identity">
            <span className="people-avatar" aria-hidden="true">
              {staff.name.slice(0, 1)}
            </span>
            <span className="people-card-name">
              <span className="people-identity-name">{staff.name}</span>
              <span className="muted small">
                {staff.title || roleNames[staff.role]}
              </span>
            </span>
            {!create && (
              <span
                className={`people-badge ${login.active ? "status-ok" : "status-danger"}`}
              >
                {login.active ? "로그인 가능" : "로그인 차단"}
              </span>
            )}
          </div>
          <Field
            label="로그인 아이디"
            help={create ? "영문과 숫자 3자 이상" : "아이디는 바꿀 수 없어요"}
          >
            <input
              required
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={create ? 254 : undefined}
              disabled={!create}
              value={form.loginId}
              onChange={(e) => setForm({ ...form, loginId: e.target.value })}
            />
          </Field>
          <Field
            label={create ? "임시 비밀번호" : "새 임시 비밀번호"}
            help={
              create
                ? "12자 이상이에요. 첫 로그인 때 직원이 직접 바꿔요"
                : "비밀번호를 재설정할 때만 입력해요"
            }
          >
            <span className="people-password">
              <input
                required={create}
                minLength={12}
                maxLength={128}
                type="text"
                className="num"
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <Button
                variant="secondary"
                onClick={() => setForm({ ...form, password: temporaryPassword() })}
              >
                새로 만들기
              </Button>
            </span>
          </Field>
          <div className="people-group">
            <span id={roleLabelId} className="people-group-label">
              접근 권한
            </span>
            <RadioChips
              labelId={roleLabelId}
              options={allowedRoles(user).map((role) => [role, roleNames[role]])}
              value={form.role}
              onChange={(role) => setForm({ ...form, role })}
            />
          </div>
          <div className="people-role-note">
            <span className="people-role-title">{roleNames[form.role]} 권한</span>
            <span>{accessHelp[form.role]}</span>
          </div>
          {!create && (
            <span className="muted small">
              권한을 바꾸거나 비밀번호를 재설정하면 이 직원의 기존 로그인이 끝나요
            </span>
          )}
          {!create && login.id !== user.id && (
            <div className="people-login-row">
              <span className="people-card-name">
                <span className="people-identity-name">로그인</span>
                <span className="muted small">
                  {login.active
                    ? "차단하면 바로 로그아웃돼요"
                    : "지금은 로그인할 수 없어요"}
                </span>
              </span>
              <Button
                variant={login.active ? "danger" : "secondary"}
                onClick={() => onToggleLogin(login)}
              >
                {login.active ? "로그인 차단" : "차단 해제"}
              </Button>
            </div>
          )}
        </fieldset>
      </form>
      {discard && (
        <ConfirmDialog
          title="작성을 취소할까요?"
          onClose={() => setDiscard(false)}
          onConfirm={close}
          confirmLabel="내용 버리고 닫기"
          variant="danger"
        >
          입력한 계정 정보가 사라져요.
        </ConfirmDialog>
      )}
    </Modal>
  );
}
