import { AutomaticBackup } from "../components/AutomaticBackup";
import { RecoveryAccessPanel } from "../components/AccountRecovery";
import { TimeInput } from "../components/TimeInput.jsx";
import React, { useEffect, useId, useState } from "react";
import { api, download, timeLabel, today } from "../api";
import { useViewState } from "../components/ViewState";
import Icon from "../components/Icon";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Money,
  ConfirmDialog,
} from "../components/ui";
import { closeDialogFrom } from "../workforce-utils";
import "./Settings.css";
const weekday = ["일", "월", "화", "수", "목", "금", "토"];
const asMinutes = (value) =>
  value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const SECTIONS = [
  ["store", "매장 정보"],
  ["services", "시술 메뉴"],
  ["rates", "4대보험 요율"],
  ["audit", "변경 기록"],
  ["backup", "백업과 복구", "owner"],
  ["help", "사용 안내"],
];
export default function Settings(props) {
  const { user, routeContext } = props;
  const sections = SECTIONS.filter(([, , role]) => !role || user.role === role);
  const [tab, setTab] = useViewState(
    "settings",
    "tab",
    sections.some(([id]) => id === routeContext?.tab) ? routeContext.tab : "store",
  );
  const [pendingTab, setPendingTab] = useState(null);
  useEffect(() => {
    const requested = routeContext?.tab;
    if (sections.some(([id]) => id === requested)) setTab(requested);
  }, [routeContext?.tab, user.role]);
  return (
    <div className="st-page">
      <h1 className="page-title">설정</h1>
      <div className="st-layout">
        <nav className="st-nav" aria-label="설정 메뉴">
          {sections.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => {
                if (id !== tab) {
                  document.querySelector('[data-dirty="true"]')
                    ? setPendingTab(id)
                    : setTab(id);
                }
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="st-content">
          {tab === "store" && <StoreSettings {...props} part="store" />}
          {tab === "rates" && <StoreSettings {...props} part="rates" />}
          {tab === "services" && <ServiceSettings {...props} />}
          {tab === "audit" && <Audit />}
          {tab === "backup" && user.role === "owner" && <DataSettings {...props} />}
          {tab === "help" && <Help />}
        </div>
      </div>
      {pendingTab && (
        <ConfirmDialog
          title="저장하지 않은 설정이 있습니다"
          confirmLabel="변경 버리고 이동"
          variant="danger"
          onClose={() => setPendingTab(null)}
          onConfirm={() => {
            setTab(pendingTab);
            setPendingTab(null);
          }}
        >
          다른 설정으로 이동하면 저장하지 않은 내용이 사라집니다.
        </ConfirmDialog>
      )}
    </div>
  );
}
const ALERT_DEFAULTS = {
  lowStock: true,
  pendingRequests: true,
  unpaid: true,
};
const ALERT_LABELS = {
  lowStock: ["부족 재고", "보충 기준 아래 품목 개수"],
  pendingRequests: ["휴가 승인 대기", "원장 관리 메뉴에 개수 표시"],
  unpaid: ["수납 대기", "시술을 마친 손님 개수"],
};
const RATE_DEFAULTS = {
  pension: 4.75,
  health: 3.595,
  care: 13.14,
  employment: 0.9,
};
const RATE_LABELS = {
  pension: ["국민연금", "근로자 부담 %"],
  health: ["건강보험", "근로자 부담 %"],
  care: ["장기요양", "건강보험료 대비 %"],
  employment: ["고용보험", "근로자 부담 %"],
};
/** A labelled on/off row: title, one help line, switch on the right. */
function SwitchRow({ label, help, checked, onChange, disabled }) {
  const id = useId();
  return (
    <div className="st-switch-row">
      <span className="st-switch-text">
        <span id={`${id}-label`} className="st-switch-label">
          {label}
        </span>
        {help && (
          <span id={`${id}-help`} className="small muted">
            {help}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={help ? `${id}-help` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}
const dayNames = (days) =>
  days
    .slice()
    .sort()
    .map((day) => `${weekday[day]}요일`)
    .join(", ");
function StoreSettings({ data, version, runAction, notify, part = "store" }) {
  const [form, setForm] = useState({ ...data.store }),
    [initial, setInitial] = useState(data.store),
    [baseVersion, setBaseVersion] = useState(version),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [resetting, setResetting] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const changedFields = Object.keys(data.store).filter(
    (key) => JSON.stringify(data.store[key]) !== JSON.stringify(initial[key]),
  );
  const remoteChanged = dirty && changedFields.length > 0;
  const settingLabels = {
    name: "매장 이름",
    phone: "전화번호",
    address: "매장 주소",
    open: "영업 시작",
    close: "영업 종료",
    slotMinutes: "예약 시간 간격",
    closedWeekdays: "정기 휴무일",
    businessNumber: "사업자등록번호",
    representative: "대표자",
    payrollRates: "4대보험 요율",
  };
  const alerts = { ...ALERT_DEFAULTS, ...(form.alerts || {}) };
  const rates = { ...RATE_DEFAULTS, ...(form.payrollRates || {}) };
  const [logoError, setLogoError] = useState("");
  const chooseLogo = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setLogoError("");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      return setLogoError("PNG, JPG, WEBP 이미지만 쓸 수 있어요");
    if (file.size > 100 * 1024)
      return setLogoError(
        "100KB 이하 이미지를 골라 주세요. 가로 400px 이하로 줄이면 대부분 맞아요",
      );
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo: String(reader.result) }));
    reader.onerror = () => setLogoError("이미지를 읽지 못했어요");
    reader.readAsDataURL(file);
  };
  const settingValue = (key, value) =>
    key === "closedWeekdays"
      ? dayNames(value || []) || "휴무 없음"
      : ["open", "close"].includes(key)
        ? timeLabel(value)
        : key === "slotMinutes"
          ? `${value}분`
          : key === "payrollRates"
            ? Object.entries({ ...RATE_DEFAULTS, ...(value || {}) })
                .map(([rate, number]) => `${RATE_LABELS[rate][0]} ${number}%`)
                .join(", ")
            : value || "미입력";
  const resetForm = () => {
    setForm({ ...data.store });
    setInitial(data.store);
    setBaseVersion(version);
    setError("");
    setResetting(false);
  };
  useEffect(() => {
    const guard = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) {
      setForm({ ...data.store });
      setInitial(data.store);
      setBaseVersion(version);
    }
  }, [data.store, version]);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await runAction(
        "store.save",
        form,
        undefined,
        baseVersion,
      );
      setForm({ ...result.data.store });
      setInitial(result.data.store);
      setBaseVersion(result.version);
      notify(part === "rates" ? "4대보험 요율을 저장했습니다." : "매장 정보를 저장했습니다.");
    } catch (err) {
      setError(err.message);
      if (err.status === 409) setBaseVersion(undefined);
    } finally {
      setBusy(false);
    }
  };
  const field = (key) => ({
    value: form[key] || "",
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });
  const closed = form.closedWeekdays || [];
  const titleId = part === "rates" ? "rates-title" : "store-title";
  return (
    <section className="panel st-panel" aria-labelledby={titleId}>
      <form className="st-form" data-dirty={dirty} onSubmit={submit}>
        <fieldset disabled={busy} className="st-fieldset">
          {error && (
            <div role="alert" className="alert alert-warning">
              {error}
            </div>
          )}
          {remoteChanged && (
            <div role="alert" className="alert alert-warning st-remote">
              <strong>다른 직원이 매장 설정을 변경했습니다.</strong>
              <span>최신 값과 지금 입력한 값을 비교한 뒤 저장하거나 최신 설정을 불러오세요</span>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>항목</th>
                      <th>서버의 최신 값</th>
                      <th>현재 입력</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changedFields
                      .filter((key) => settingLabels[key])
                      .map((key) => (
                        <tr key={key}>
                          <td>{settingLabels[key]}</td>
                          <td>{settingValue(key, data.store[key])}</td>
                          <td>{settingValue(key, form[key])}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div>
                <Button onClick={() => setResetting(true)}>최신 설정 불러오기</Button>
              </div>
            </div>
          )}
          {part === "rates" ? (
            <div className="st-group">
              <h2 id={titleId}>4대보험 요율</h2>
              <div className="st-grid-2">
                {Object.entries(RATE_LABELS).map(([key, [label, unit]]) => (
                  <Field key={key} label={`${label} (${unit})`}>
                    <input
                      type="number"
                      min="0"
                      max="30"
                      step="0.001"
                      required
                      value={rates[key]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          payrollRates: {
                            ...rates,
                            [key]: e.target.value === "" ? "" : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              <span className="small muted">
                급여명세의 4대보험 공제 계산이 이 값을 써요. 해마다 고시되는 요율을 확인해
                고쳐 주세요
              </span>
            </div>
          ) : (
            <>
              <div className="st-group">
                <h2 id={titleId}>매장 정보</h2>
                <div className="st-grid-2">
                  <Field label="매장 이름">
                    <input required maxLength={100} {...field("name")} />
                  </Field>
                  <Field label="전화번호">
                    <input type="tel" maxLength={30} {...field("phone")} />
                  </Field>
                  <Field label="대표자">
                    <input maxLength={60} placeholder="선택" {...field("representative")} />
                  </Field>
                  <Field label="사업자등록번호">
                    <input
                      maxLength={12}
                      inputMode="numeric"
                      placeholder="000-00-00000"
                      {...field("businessNumber")}
                    />
                  </Field>
                </div>
                <Field label="매장 주소">
                  <input maxLength={500} {...field("address")} />
                </Field>
                <span className="small muted">
                  사업자등록번호는 증명서, 영수증, 발주서에 나와요
                </span>
              </div>
              <div className="st-group">
                <h2>영업시간</h2>
                <div className="st-grid-3">
                  <Field label="영업 시작">
                    <TimeInput
                      required
                      step="60"
                      value={form.open == null ? "" : timeLabel(form.open)}
                      onChange={(e) => setForm({ ...form, open: asMinutes(e.target.value) })}
                    />
                  </Field>
                  <Field label="영업 종료">
                    <TimeInput
                      required
                      disabled={form.close === 1440}
                      step="60"
                      value={
                        form.close == null
                          ? ""
                          : form.close === 1440
                            ? "00:00"
                            : timeLabel(form.close)
                      }
                      onChange={(e) => setForm({ ...form, close: asMinutes(e.target.value) })}
                    />
                  </Field>
                  <Field label="예약 시간 간격">
                    <select
                      value={form.slotMinutes}
                      onChange={(e) => setForm({ ...form, slotMinutes: Number(e.target.value) })}
                    >
                      {[5, 10, 15, 20, 30, 60].map((v) => (
                        <option value={v} key={v}>
                          {v}분
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <SwitchRow
                  label="자정까지 영업"
                  help="영업 종료를 24:00로 정해요"
                  checked={form.close === 1440}
                  onChange={(on) => setForm({ ...form, close: on ? 1440 : 1200 })}
                />
              </div>
              <div className="st-group">
                <h2 id="days-title">영업 요일</h2>
                <div className="st-days" role="group" aria-labelledby="days-title">
                  {weekday.map((day, index) => (
                    <button
                      key={day}
                      type="button"
                      className="st-day"
                      aria-pressed={!closed.includes(index)}
                      aria-label={`${day}요일 영업`}
                      onClick={() =>
                        setForm({
                          ...form,
                          closedWeekdays: closed.includes(index)
                            ? closed.filter((d) => d !== index)
                            : [...closed, index].sort(),
                        })
                      }
                    >
                      {day}
                    </button>
                  ))}
                </div>
                <span className="small muted">
                  {closed.length
                    ? `${dayNames(closed)}은 정기 휴무예요`
                    : "쉬는 요일 없이 매일 영업해요"}
                </span>
                <span className="small muted">
                  쉬는 요일에는 새 예약을 받지 않아요. 그날 남은 예약은 먼저 옮겨 주세요
                </span>
              </div>
              <div className="st-group">
                <h2 id="logo-title">매장 로고</h2>
                <div className="st-logo">
                  {form.logo ? (
                    <img src={form.logo} alt="현재 매장 로고" />
                  ) : (
                    <span className="st-logo-empty muted">로고 없음</span>
                  )}
                  <label className="btn btn-secondary st-logo-pick">
                    이미지 선택
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={chooseLogo}
                    />
                  </label>
                  {form.logo && (
                    <Button variant="ghost" onClick={() => setForm({ ...form, logo: "" })}>
                      로고 삭제
                    </Button>
                  )}
                </div>
                <span
                  className={logoError ? "small error" : "small muted"}
                  role={logoError ? "alert" : undefined}
                >
                  {logoError || "PNG, JPG, WEBP 100KB 이하. 메뉴와 인쇄 문서에 나와요"}
                </span>
              </div>
              <div className="st-group">
                <h2>화면 알림</h2>
                {Object.entries(ALERT_LABELS).map(([key, [label, help]]) => (
                  <SwitchRow
                    key={key}
                    label={label}
                    help={help}
                    checked={alerts[key] !== false}
                    onChange={(on) =>
                      setForm({ ...form, alerts: { ...alerts, [key]: on } })
                    }
                  />
                ))}
                <span className="small muted">
                  끈 알림은 메뉴 숫자와 오늘 화면에 나오지 않아요
                </span>
              </div>
              <span className="small muted">
                직원별 근무시간과 휴게시간은 직원 메뉴에서 정해요. 매장 영업시간과 직원
                근무시간이 모두 맞아야 예약할 수 있어요
              </span>
            </>
          )}
          <div className="st-actions">
            {dirty && <span className="small muted">저장하지 않은 변경이 있어요</span>}
            <Button variant="secondary" disabled={!dirty} onClick={() => setResetting(true)}>
              되돌리기
            </Button>
            <Button type="submit" variant="primary" busy={busy} disabled={!dirty}>
              저장
            </Button>
          </div>
        </fieldset>
      </form>
      {resetting && (
        <ConfirmDialog
          title="저장된 매장 설정으로 되돌릴까요?"
          variant="danger"
          confirmLabel="저장된 설정 불러오기"
          onClose={() => setResetting(false)}
          onConfirm={resetForm}
        >
          입력 중인 변경을 버리고 서버에 마지막으로 저장된 매장 정보를 불러옵니다.
        </ConfirmDialog>
      )}
    </section>
  );
}
function ServiceSettings({ data, runAction, notify }) {
  const [editing, setEditing] = useState(null),
    [filter, setFilter] = useState("active");
  const rows = data.services.filter((s) => filter === "all" || s.active);
  return (
    <section className="panel st-panel" aria-labelledby="services-title">
      <div className="panel-head">
        <h2 id="services-title">시술 메뉴</h2>
        <Button
          variant="primary"
          aria-label="＋ 시술 등록"
          onClick={() =>
            setEditing({
              name: "",
              price: 0,
              duration: 30,
              materials: [],
              active: true,
            })
          }
        >
          <Icon name="plus" size={16} /> 시술 등록
        </Button>
      </div>
      <div className="st-toolbar">
        <div className="seg" role="group" aria-label="표시 범위">
          {[
            ["active", "예약 받는 시술"],
            ["all", "전체"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="small muted">재료를 연결하면 수납할 때 그만큼 재고에서 빠져요</span>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>시술 이름</th>
                <th>가격</th>
                <th>걸리는 시간</th>
                <th>재료</th>
                <th>상태</th>
                <th aria-label="관리" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td>
                    <Money value={s.price} />
                  </td>
                  <td>{durationLabel(s.duration)}</td>
                  <td>{s.materials.length ? `${s.materials.length}가지` : "없음"}</td>
                  <td>
                    <Badge tone={s.active ? "success" : "muted"}>
                      {s.active ? "예약 받는 중" : "숨김"}
                    </Badge>
                  </td>
                  <td className="st-row-action">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          ...s,
                          materials: s.materials.map((m) => ({ ...m })),
                        })
                      }
                    >
                      수정
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="시술 메뉴를 등록해 주세요"
          description="커트, 펌, 염색처럼 시술마다 가격과 걸리는 시간을 정해요."
        />
      )}
      {editing && (
        <ServiceForm
          initial={editing}
          data={data}
          runAction={runAction}
          notify={notify}
          close={() => setEditing(null)}
        />
      )}
    </section>
  );
}
const durationLabel = (minutes) => {
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
};
const amountLabel = (value) =>
  Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
function ServiceForm({ initial, data, runAction, notify, close }) {
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [picking, setPicking] = useState(false);
  const materials = data.items.filter(
    (i) => i.kind === "시술 재료" && i.active !== false,
  );
  const addable = materials.filter(
    (i) => !form.materials.some((m) => m.itemId === i.id),
  );
  const itemOf = (id) => data.items.find((i) => i.id === id);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction("service.save", {
        ...form,
        price: Number(form.price),
        duration: Number(form.duration),
        materials: form.materials.map((m) => ({
          ...m,
          quantity: Number(m.quantity),
        })),
      });
      notify("시술 메뉴를 저장했습니다.");
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={form.id ? "시술 메뉴 수정" : "시술 메뉴 등록"}
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
      onClose={busy ? undefined : close}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={closeDialogFrom}>
            취소
          </Button>
          <Button type="submit" form="service-form" variant="primary" busy={busy}>
            시술 저장
          </Button>
        </>
      }
    >
      <form className="st-dialog" id="service-form" onSubmit={submit}>
        <fieldset disabled={busy} className="st-dialog">
          {error && (
            <div role="alert" className="alert alert-warning">
              {error}
            </div>
          )}
          <div className="st-basic">
            <Field label="시술 이름">
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="가격">
              <span className="st-unit">
                <input
                  required
                  type="number"
                  min="0"
                  max="1000000000"
                  step="1"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
                <span aria-hidden="true">원</span>
              </span>
            </Field>
            <Field label="걸리는 시간">
              <span className="st-unit">
                <input
                  required
                  type="number"
                  min="5"
                  max="1440"
                  step="1"
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: e.target.value })}
                />
                <span aria-hidden="true">분</span>
              </span>
            </Field>
          </div>
          <div className="st-group st-group-tight">
            <div className="st-group-head">
              <span className="st-switch-label">한 번에 쓰는 재료</span>
              <Button
                variant="ghost"
                aria-expanded={picking}
                disabled={!addable.length}
                onClick={() => setPicking(!picking)}
              >
                재료 추가
              </Button>
            </div>
            {picking && addable.length > 0 && (
              <div className="st-pick" role="group" aria-label="추가할 재료">
                {addable.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className="st-pick-item"
                    onClick={() => {
                      setForm({
                        ...form,
                        materials: [...form.materials, { itemId: i.id, quantity: 1 }],
                      });
                      setPicking(false);
                    }}
                  >
                    <span className="st-switch-label">{i.name}</span>
                    <span className="small muted">
                      재고 {amountLabel(i.qty)}
                      {i.unit}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {form.materials.map((m, index) => {
              const item = itemOf(m.itemId);
              const name = item?.name || "삭제된 재료";
              return (
                <div className="st-material" key={`${m.itemId}-${index}`}>
                  <span className="st-material-name">
                    <span className="st-switch-label">{name}</span>
                    <span className="small muted">
                      {item
                        ? item.active === false
                          ? "사용을 멈춘 재료"
                          : `재고 ${amountLabel(item.qty)}${item.unit}`
                        : "재고 정보 없음"}
                    </span>
                  </span>
                  <span className="st-unit">
                    <input
                      required
                      type="number"
                      aria-label={`${name} 사용량`}
                      min={item?.unit === "개" ? "1" : "0.001"}
                      max="1000000000"
                      step={item?.unit === "개" ? "1" : "0.001"}
                      value={m.quantity}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          materials: form.materials.map((v, i) =>
                            i === index ? { ...v, quantity: e.target.value } : v,
                          ),
                        })
                      }
                    />
                    {item?.unit && <span aria-hidden="true">{item.unit}</span>}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${name} 빼기`}
                    onClick={() =>
                      setForm({
                        ...form,
                        materials: form.materials.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Icon name="close" />
                  </button>
                </div>
              );
            })}
            {!form.materials.length && (
              <p className="st-empty">
                {materials.length
                  ? "연결한 재료가 없어요"
                  : "재고 메뉴에서 시술 재료를 먼저 등록해 주세요"}
              </p>
            )}
            <span className="small muted">수납하면 이만큼 재고에서 빠져요</span>
            <span className="small muted">환불해도 이미 쓴 재료는 재고로 돌아오지 않아요</span>
          </div>
          <SwitchRow
            label="예약 받기"
            help="끄면 새 예약에서 숨겨요"
            checked={form.active}
            onChange={(on) => setForm({ ...form, active: on })}
          />
        </fieldset>
      </form>
    </Modal>
  );
}
function Audit() {
  const [entries, setEntries] = useState(null),
    [error, setError] = useState(""),
    [kind, setKind] = useState("changes");
  const load = (target = kind) =>
    api(`/audit?limit=200${target === "auth" ? "&kind=auth" : ""}`)
      .then((r) => {
        setEntries(r.entries);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    setEntries(null);
    load(kind);
  }, [kind]);
  return (
    <section className="panel st-panel" aria-labelledby="audit-title">
      <div className="panel-head">
        <h2 id="audit-title">{kind === "auth" ? "접속 기록" : "최근 활동 기록"}</h2>
        <Button variant="ghost" onClick={() => load()}>
          <Icon name="refresh" size={16} /> 새로고침
        </Button>
      </div>
      <div className="seg" role="group" aria-label="기록 종류">
        {[
          ["changes", "데이터 변경"],
          ["auth", "접속 기록"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={kind === id}
            onClick={() => setKind(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "auth" && (
        <span className="small muted">
          로그인 성공과 실패, 공용 화면 전환, 원장 관리 재인증을 최근 순으로 보여 줘요.
          모르는 실패 기록이 반복되면 비밀번호를 바꿔 주세요
        </span>
      )}
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}
      {entries === null ? (
        <p className="st-empty">기록을 불러오는 중이에요</p>
      ) : entries.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>일시</th>
                <th>담당자</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {new Intl.DateTimeFormat("ko-KR", {
                      timeZone: "Asia/Seoul",
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(e.at))}
                  </td>
                  <td>{e.actorName}</td>
                  <td>
                    {e.action === "auth.failed" && (
                      <>
                        <Badge tone="danger">실패</Badge>{" "}
                      </>
                    )}
                    {e.summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="활동 기록이 없습니다" />
      )}
    </section>
  );
}
function DataSettings({ data, runAction, notify }) {
  const [legacy, setLegacy] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const downloadBackup = async () => {
    setDownloading(true);
    try {
      await download("/backup", `salon-backup-${today()}.sqlite`);
    } catch (err) {
      notify(err.message, "danger");
    } finally {
      setDownloading(false);
    }
  };
  let localAvailable = false;
  try {
    localAvailable = !!localStorage.getItem("salon-erp-prototype-v2");
  } catch {}
  const empty =
    ![
      "customers",
      "appointments",
      "transactions",
      "refunds",
      "items",
      "services",
      "receipts",
      "logs",
      "payroll",
    ].some((key) => data[key]?.length) &&
    data.staff.length === 1 &&
    !data.legacyImport;
  const prepareLegacy = (value) => {
    const parsed = value?.data && !value?.resv ? value.data : value;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.schemaVersion != null ||
      ![
        "staff",
        "services",
        "customers",
        "items",
        "resv",
        "txns",
        "logs",
      ].every((key) => Array.isArray(parsed[key]))
    )
      throw new Error(
        "이전 v2 브라우저 저장 버전에서 내보낸 JSON 자료를 선택해 주세요. 데이터베이스 백업 파일은 서버 복원 절차로 사용합니다.",
      );
    return parsed;
  };
  const loadLocal = () => {
    setLegacy(null);
    try {
      const parsed = JSON.parse(localStorage.getItem("salon-erp-prototype-v2"));
      if (!parsed) throw new Error("이 브라우저에 이전 자료가 없습니다.");
      setLegacy(prepareLegacy(parsed));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  const importData = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await runAction("legacy.import", { data: legacy });
      notify("이전 자료를 가져왔습니다. 예약, 수납, 재고를 확인해 주세요.");
      setLegacy(null);
      setConfirm(false);
    } catch (e) {
      setError(e.message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  const file = async (e) => {
    const uploaded = e.target.files?.[0];
    if (!uploaded) return;
    setLegacy(null);
    setError("");
    try {
      if (uploaded.size > 1800000)
        throw new Error("이전 JSON 자료는 1.8MB 이하로 준비해 주세요.");
      setLegacy(prepareLegacy(JSON.parse(await uploaded.text())));
    } catch (err) {
      setError("이전 자료를 읽지 못했습니다. " + err.message);
    } finally {
      e.target.value = "";
    }
  };
  return (
    <div className="st-stack">
      <RecoveryAccessPanel />
      <section className="panel st-panel" aria-labelledby="backup-title">
        <div className="panel-head">
          <h2 id="backup-title">데이터베이스 백업</h2>
          <Badge>원장 전용</Badge>
        </div>
        <AutomaticBackup />
        <span className="muted">
          직원 계정과 매장 운영 데이터를 함께 보관해요. 정기적으로 내려받아 접근이 제한된
          외부 저장소에 보관해 주세요
        </span>
        <div>
          <Button variant="primary" onClick={downloadBackup} busy={downloading}>
            <Icon name="download" size={16} /> 데이터베이스 백업 다운로드
          </Button>
        </div>
        <span className="small muted">
          백업에는 고객과 직원 개인정보가 들어 있어요. 복원은 서버를 멈춘 뒤 운영 안내서
          절차로 진행해요. 서버 디스크 하나에만 백업을 두지 마세요
        </span>
      </section>
      <section className="panel st-panel" aria-labelledby="legacy-title">
        <div className="panel-head">
          <h2 id="legacy-title">이전 v2 자료 가져오기</h2>
        </div>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        {!empty && (
          <div className="alert alert-warning st-remote">
            <strong>이 매장에는 이미 운영 자료가 있습니다.</strong>
            <span>
              이전 자료 가져오기는 처음 등록한 빈 매장에서만 할 수 있어요. 지금 자료를
              덮어쓰거나 합치지 않아요. 아래에서는 가져올 파일의 요약만 볼 수 있어요
            </span>
          </div>
        )}
        <span className="small muted">
          이전 브라우저 저장 버전의 자료를 처음 등록한 빈 매장으로 옮겨요. 시술이나 고객을
          등록하기 전에 진행하세요. 브라우저에 있던 자료는 가져온 뒤에도 지워지지 않아요
        </span>
        <div className="st-legacy-row">
          <Button disabled={!localAvailable} onClick={loadLocal}>
            이 브라우저의 이전 자료 읽기
          </Button>
          <Field label="이전 v2 JSON 파일">
            <input type="file" accept="application/json,.json" onChange={file} />
          </Field>
        </div>
        {!localAvailable && (
          <span className="small muted">
            이 브라우저에는 이전 자료가 없어요. 이전 앱을 쓰던 브라우저에서 내보낸 JSON
            파일을 골라 주세요. 접속 주소나 컴퓨터가 바뀌면 브라우저 자료를 찾을 수 없어요
          </span>
        )}
        {legacy && (
          <div className="inset st-legacy-summary">
            <dl className="kv">
              <dt>고객</dt>
              <dd>{legacy.customers.length}명</dd>
              <dt>예약</dt>
              <dd>{legacy.resv.length}건</dd>
              <dt>수납</dt>
              <dd>{legacy.txns.length}건</dd>
              <dt>재고</dt>
              <dd>{legacy.items.length}품목</dd>
            </dl>
            <div>
              <Button disabled={!empty} onClick={() => setConfirm(true)} variant="primary">
                검증 후 가져오기
              </Button>
            </div>
          </div>
        )}
      </section>
      {confirm && (
        <ConfirmDialog
          title="이전 자료를 이 매장으로 가져올까요?"
          onClose={() => !busy && setConfirm(false)}
          onConfirm={importData}
          busy={busy}
          confirmLabel="자료 가져오기"
        >
          자료 전체의 형식과 연결을 검증합니다. 현재 재고 수량을 그대로 가져오며, 이미
          운영 데이터가 있는 매장에는 가져올 수 없습니다.
        </ConfirmDialog>
      )}
    </div>
  );
}
function Help() {
  const steps = [
    "매장 이름과 영업시간, 쉬는 요일을 정해요.",
    "직원 정보를 등록하고 로그인 권한에서 개인 계정을 발급해요.",
    "재고 품목과 보충 기준을 등록하고 실제 입고 수량을 넣어요.",
    "시술마다 가격, 걸리는 시간, 쓰는 재료를 정해요.",
    "고객을 등록하고 담당자와 시술을 골라 예약해요.",
    "방문과 시술 상태를 바꾸고 단말기 승인 후 수납을 기록해요.",
    "하루를 마감할 때 결제수단별 매출과 단말기를 맞춰 봐요.",
    "월말에 급여명세의 지급과 공제 항목을 검토하고 확정해요.",
  ];
  const notes = [
    [
      "수납과 환불",
      "이 ERP는 단말기 결제 결과를 기록해요. 카드 승인과 취소는 실제 단말기에서 먼저 처리해 주세요. 금액이 틀렸다면 수납 상세의 금액 정정과 재수납을 써요. 재료와 상품 재고를 다시 빼지 않아요.",
    ],
    [
      "수동 입고",
      "입고 등록은 실제 받은 수량을 넣는 방식이에요. 현재 수량이 보충 기준 이하이면 보충 필요로 보여 줘요. 재고 실사는 현재 총수량을 다시 맞추는 기능이고 사유가 남아요.",
    ],
    [
      "계정과 개인정보",
      "공용 PC에서는 직원 본인 인증 후 업무를 기록해요. 계정, 전체 급여, 백업은 원장 관리에서만 열 수 있고, 직원은 본인 인증 후 자기 확정 급여만 볼 수 있어요. 확인한 뒤 지금 잠그기를 누르고, 퇴사자의 계정은 꺼 주세요. 고객의 민감정보와 카드번호는 메모에 넣지 마세요.",
    ],
  ];
  return (
    <section className="panel st-panel" aria-labelledby="help-title">
      <div className="panel-head">
        <h2 id="help-title">처음 사용하는 순서</h2>
      </div>
      <ol className="st-steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {notes.map(([title, body]) => (
        <div key={title} className="inset st-note">
          <strong>{title}</strong>
          <span>{body}</span>
        </div>
      ))}
      <span className="small muted">
        급여의 세금과 사회보험 공제는 검토한 금액을 직접 넣어요. 외부 카드 승인, 문자 발송,
        온라인 고객 예약, 세무 신고 연동은 이 버전에 없어요
      </span>
    </section>
  );
}
