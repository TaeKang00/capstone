import React, { useEffect, useState } from "react";
import { api, timeLabel } from "../api";
import { useViewState } from "../components/ViewState";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Money,
  ConfirmDialog,
} from "../components/ui";
const weekday = ["일", "월", "화", "수", "목", "금", "토"];
const asMinutes = (value) =>
  value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
export default function Settings(props) {
  const { data, user, routeContext } = props;
  const [tab, setTab] = useViewState(
    "settings",
    "tab",
    routeContext?.tab || "store",
  );
  const [pendingTab, setPendingTab] = useState(null);
  useEffect(() => {
    const requested = routeContext?.tab;
    if (
      [
        "store",
        "services",
        "audit",
        "help",
        ...(user.role === "owner" ? ["backup"] : []),
      ].includes(requested)
    )
      setTab(requested);
  }, [routeContext?.tab, user.role]);
  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">YOUR SALON, YOUR WAY</div>
          <h1 className="page-title">매장 설정</h1>
          <p className="page-description">
            운영 기준을 정리하면 예약·수납·재고가 함께 움직입니다.
          </p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="설정 메뉴">
          {[
            ["store", "매장 · 영업시간"],
            ["services", "시술 · 가격표"],
            ["audit", "활동 기록"],
            ...(user.role === "owner" ? [["backup", "백업 · 이전 자료"]] : []),
            ["help", "사용 안내"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
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
        <div style={{ minWidth: 0 }}>
          {tab === "store" && <StoreSettings {...props} />}{" "}
          {tab === "services" && <ServiceSettings {...props} />}{" "}
          {tab === "audit" && <Audit />}
          {tab === "backup" && <DataSettings {...props} />}{" "}
          {tab === "help" && <Help data={data} />}
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
    </>
  );
}
function StoreSettings({ data, version, runAction, notify }) {
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
    phone: "매장 전화",
    address: "매장 주소",
    open: "영업 시작",
    close: "영업 종료",
    slotMinutes: "예약 시간 간격",
    closedWeekdays: "정기 휴무일",
  };
  const settingValue = (key, value) =>
    key === "closedWeekdays"
      ? value.map((day) => weekday[day]).join(" · ") || "휴무 없음"
      : ["open", "close"].includes(key)
        ? timeLabel(value)
        : key === "slotMinutes"
          ? `${value}분`
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
      notify("매장 운영 설정을 저장했습니다.");
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
  return (
    <section className="card">
      <div className="card-header">
        <h2>매장 정보와 영업시간</h2>
        <Badge>한국 표준시</Badge>
      </div>
      <div className="card-body">
        <form
          className="stack form-section"
          data-dirty={dirty}
          onSubmit={submit}
        >
          <fieldset
            disabled={busy}
            className="stack"
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            {error && (
              <div role="alert" className="alert alert-warning">
                {error}
              </div>
            )}
            {remoteChanged && (
              <div role="alert" className="alert alert-warning">
                <strong>다른 직원이 매장 설정을 변경했습니다.</strong>
                <p>
                  최신 값과 현재 입력을 비교한 뒤 저장하거나 최신 설정을
                  불러오세요.
                </p>
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
                <Button onClick={() => setResetting(true)}>
                  최신 설정 불러오기
                </Button>
              </div>
            )}
            <div className="grid grid-2">
              <Field label="매장 이름">
                <input required maxLength={100} {...field("name")} />
              </Field>
              <Field label="매장 전화">
                <input type="tel" maxLength={30} {...field("phone")} />
              </Field>
            </div>
            <Field label="매장 주소">
              <input maxLength={500} {...field("address")} />
            </Field>
            <div className="grid grid-3">
              <Field label="영업 시작">
                <input
                  required
                  type="time"
                  step="60"
                  value={form.open == null ? "" : timeLabel(form.open)}
                  onChange={(e) =>
                    setForm({ ...form, open: asMinutes(e.target.value) })
                  }
                />
              </Field>
              <Field
                label="영업 종료"
                help={
                  form.close === 1440
                    ? "당일 자정(24:00)까지 영업합니다."
                    : undefined
                }
              >
                <input
                  required
                  disabled={form.close === 1440}
                  type="time"
                  step="60"
                  value={
                    form.close == null
                      ? ""
                      : form.close === 1440
                        ? "00:00"
                        : timeLabel(form.close)
                  }
                  onChange={(e) =>
                    setForm({ ...form, close: asMinutes(e.target.value) })
                  }
                />
              </Field>
              <Field label="예약 시간 간격">
                <select
                  value={form.slotMinutes}
                  onChange={(e) =>
                    setForm({ ...form, slotMinutes: Number(e.target.value) })
                  }
                >
                  {[5, 10, 15, 20, 30, 60].map((v) => (
                    <option value={v} key={v}>
                      {v}분
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.close === 1440}
                onChange={(e) =>
                  setForm({ ...form, close: e.target.checked ? 1440 : 1200 })
                }
              />
              자정(24:00)에 영업 종료
            </label>
            <div className="field">
              <span className="field-label">정기 휴무일</span>
              <div className="day-toggle">
                {weekday.map((day, index) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={form.closedWeekdays.includes(index)}
                    className={
                      form.closedWeekdays.includes(index) ? "active" : ""
                    }
                    onClick={() =>
                      setForm({
                        ...form,
                        closedWeekdays: form.closedWeekdays.includes(index)
                          ? form.closedWeekdays.filter((d) => d !== index)
                          : [...form.closedWeekdays, index].sort(),
                      })
                    }
                  >
                    {day}
                  </button>
                ))}
              </div>
              <span className="help">
                선택한 요일에는 새 예약을 받지 않습니다. 예약이 남아 있는 날짜에
                영향을 주는 변경은 먼저 예약을 조정해 주세요.
              </span>
            </div>
            <div className="alert">
              직원별 근무시간과 휴게시간은 직원 관리에서 따로 설정합니다. 매장
              영업시간과 직원 근무시간에 모두 맞아야 예약할 수 있습니다.
            </div>
            <div className="row">
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={!dirty}
              >
                매장 설정 저장
              </Button>
              {dirty && (
                <>
                  <Button onClick={() => setResetting(true)}>변경 취소</Button>
                  <span className="help">
                    저장하지 않은 변경사항이 있습니다.
                  </span>
                </>
              )}
            </div>
          </fieldset>
        </form>
      </div>
      {resetting && (
        <ConfirmDialog
          title="저장된 매장 설정으로 되돌릴까요?"
          variant="danger"
          confirmLabel="저장된 설정 불러오기"
          onClose={() => setResetting(false)}
          onConfirm={resetForm}
        >
          입력 중인 변경사항을 버리고 서버에 마지막으로 저장된 매장 정보를
          불러옵니다.
        </ConfirmDialog>
      )}
    </section>
  );
}
function ServiceSettings({ data, runAction, notify }) {
  const [editing, setEditing] = useState(null),
    [filter, setFilter] = useState("active");
  return (
    <section className="card">
      <div className="card-header">
        <h2>시술 메뉴와 가격</h2>
        <Button
          variant="primary"
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
          ＋ 시술 등록
        </Button>
      </div>
      <div className="card-body">
        <div className="toolbar">
          <Field label="표시 범위">
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="active">사용 중</option>
              <option value="all">전체</option>
            </select>
          </Field>
          <p className="help">
            소모 재료를 연결하면 수납 시 설정한 수량만큼 재고가 차감됩니다.
          </p>
        </div>
        {data.services.filter((s) => filter === "all" || s.active).length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>시술명</th>
                  <th>금액</th>
                  <th>소요시간</th>
                  <th>연결 재료</th>
                  <th>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {data.services
                  .filter((s) => filter === "all" || s.active)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>
                        <Money value={s.price} />
                      </td>
                      <td>{s.duration}분</td>
                      <td>{s.materials.length}품목</td>
                      <td>
                        <Badge tone={s.active ? "success" : "muted"}>
                          {s.active ? "사용 중" : "중지"}
                        </Badge>
                      </td>
                      <td>
                        <Button
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
            description="커트·펌·염색 등 시술별 가격과 소요시간을 설정합니다."
          />
        )}
      </div>
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
function ServiceForm({ initial, data, runAction, notify, close }) {
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const materials = data.items.filter(
    (i) => i.kind === "시술 재료" && i.active !== false,
  );
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
        <Button type="submit" form="service-form" variant="primary" busy={busy}>
          시술 저장
        </Button>
      }
    >
      <form className="stack" id="service-form" onSubmit={submit}>
        <fieldset
          disabled={busy}
          className="stack"
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          {error && (
            <div role="alert" className="alert alert-warning">
              {error}
            </div>
          )}
          <Field label="시술 이름">
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="grid grid-2">
            <Field label="기본 가격 (원)">
              <input
                required
                type="number"
                min="0"
                max="1000000000"
                step="1"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </Field>
            <Field label="소요시간 (분)">
              <input
                required
                type="number"
                min="5"
                max="1440"
                step="1"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
              />
            </Field>
          </div>
          <Field label="사용 상태">
            <select
              value={String(form.active)}
              onChange={(e) =>
                setForm({ ...form, active: e.target.value === "true" })
              }
            >
              <option value="true">사용 중</option>
              <option value="false">사용 중지</option>
            </select>
          </Field>
          <p className="help">
            사용을 중지하면 새 예약·수납의 시술 선택에서 숨겨집니다. 기존
            예약·결제 기록은 보관됩니다.
          </p>
          <div className="separator" />
          <div className="row">
            <h3 style={{ margin: 0 }}>시술 1회 소모 재료</h3>
            <Button
              onClick={() =>
                setForm({
                  ...form,
                  materials: [
                    ...form.materials,
                    {
                      itemId:
                        materials.find(
                          (i) => !form.materials.some((m) => m.itemId === i.id),
                        )?.id || "",
                      quantity: 1,
                    },
                  ],
                })
              }
              disabled={
                !materials.some(
                  (i) => !form.materials.some((m) => m.itemId === i.id),
                )
              }
            >
              재료 추가
            </Button>
          </div>
          {form.materials.map((m, index) => (
            <div className="row" key={index}>
              <Field label="재료">
                <select
                  required
                  value={m.itemId}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      materials: form.materials.map((v, i) =>
                        i === index ? { ...v, itemId: e.target.value } : v,
                      ),
                    })
                  }
                >
                  {data.items
                    .filter(
                      (i) =>
                        i.kind === "시술 재료" &&
                        (i.active !== false || i.id === m.itemId),
                    )
                    .map((i) => (
                      <option
                        key={i.id}
                        value={i.id}
                        disabled={form.materials.some(
                          (selected, position) =>
                            position !== index && selected.itemId === i.id,
                        )}
                      >
                        {i.name} ({i.unit})
                        {i.active === false ? " · 사용 중지" : ""}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="소모 수량">
                <input
                  required
                  type="number"
                  min={
                    data.items.find((i) => i.id === m.itemId)?.unit === "개"
                      ? "1"
                      : "0.001"
                  }
                  max="1000000000"
                  step={
                    data.items.find((i) => i.id === m.itemId)?.unit === "개"
                      ? "1"
                      : "0.001"
                  }
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
              </Field>
              <Button
                variant="ghost"
                onClick={() =>
                  setForm({
                    ...form,
                    materials: form.materials.filter((_, i) => i !== index),
                  })
                }
                aria-label={`${index + 1}번째 재료 제거`}
              >
                제거
              </Button>
            </div>
          ))}
          <p className="help">
            재료는 재고·입고 화면에서 먼저 등록하세요. 시술 수납 후 환불하더라도
            이미 사용한 시술 재료는 자동 복구하지 않습니다.
          </p>
        </fieldset>
      </form>
    </Modal>
  );
}
function Audit() {
  const [entries, setEntries] = useState(null),
    [error, setError] = useState("");
  const load = () =>
    api("/audit?limit=200")
      .then((r) => {
        setEntries(r.entries);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="card">
      <div className="card-header">
        <h2>최근 활동 기록</h2>
        <Button onClick={load}>새로고침</Button>
      </div>
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}
      {entries === null ? (
        <p className="card-body muted">기록을 불러오는 중입니다…</p>
      ) : entries.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>일시 (KST)</th>
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
                  <td>{e.summary}</td>
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
      notify("이전 자료를 가져왔습니다. 예약·수납·재고를 확인해 주세요.");
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
    <div className="stack">
      <section className="card">
        <div className="card-header">
          <h2>데이터베이스 백업</h2>
          <Badge>원장 전용</Badge>
        </div>
        <div className="card-body stack">
          <p className="muted">
            직원 계정과 매장 운영 데이터를 함께 보관합니다. 정기적으로 내려받아
            접근이 제한된 외부 저장소에 보관해 주세요.
          </p>
          <div>
            <a className="btn btn-primary" href="/api/backup" download>
              데이터베이스 백업 다운로드
            </a>
          </div>
          <p className="help">
            백업에는 고객·직원 개인정보가 포함됩니다. 복원은 서버를 중지한 뒤
            운영 안내서의 절차로 진행합니다. 서버 디스크 하나에만 백업을 두지
            마세요.
          </p>
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <h2>이전 v2 자료 가져오기</h2>
        </div>
        <div className="card-body stack">
          {error && (
            <div className="alert alert-warning" role="alert">
              {error}
            </div>
          )}
          {!empty && (
            <div className="alert alert-warning">
              <strong>이 매장에는 이미 운영 자료가 있습니다.</strong>
              <br />
              이전 자료 가져오기는 최초 등록 직후의 빈 매장에서만 가능합니다.
              현재 자료를 덮어쓰거나 합치지 않습니다. 아래에서는 가져올 파일의
              요약만 확인할 수 있습니다.
            </div>
          )}
          <p className="help">
            이전 브라우저 저장 버전의 자료를 최초 등록 직후 빈 매장으로
            옮깁니다. 시술이나 고객을 등록하기 전에 진행하세요. 기존 브라우저
            자료는 가져온 후에도 자동 삭제되지 않습니다.
          </p>
          <div className="row">
            <Button disabled={!localAvailable} onClick={loadLocal}>
              이 브라우저의 이전 자료 읽기
            </Button>
            <Field label="이전 v2 JSON 파일">
              <input
                type="file"
                accept="application/json,.json"
                onChange={file}
              />
            </Field>
          </div>
          {!localAvailable && (
            <p className="help">
              이 브라우저에는 이전 자료가 없습니다. 이전 앱을 사용했던
              브라우저에서 내보낸 JSON 파일을 선택해 주세요. 접속 주소나
              컴퓨터가 달라지면 브라우저 자료를 자동으로 찾을 수 없습니다.
            </p>
          )}
          {legacy && (
            <div className="alert">
              고객 {legacy.customers.length}명 · 예약 {legacy.resv.length}건 ·
              수납 {legacy.txns.length}건 · 재고 {legacy.items.length}품목
              <br />
              <Button
                disabled={!empty}
                onClick={() => setConfirm(true)}
                variant="primary"
              >
                검증 후 가져오기
              </Button>
            </div>
          )}
        </div>
      </section>
      {confirm && (
        <ConfirmDialog
          title="이전 자료를 이 매장으로 가져올까요?"
          onClose={() => !busy && setConfirm(false)}
          onConfirm={importData}
          busy={busy}
          confirmLabel="자료 가져오기"
        >
          자료 전체의 형식과 연결을 검증합니다. 현재 재고 수량을 그대로
          가져오며, 이미 운영 데이터가 있는 매장에는 가져올 수 없습니다.
        </ConfirmDialog>
      )}
    </div>
  );
}
function Help({ data }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2>처음 사용하는 순서</h2>
      </div>
      <div className="card-body stack">
        <ol
          className="help"
          style={{ fontSize: 14, lineHeight: 2.2, paddingLeft: 20 }}
        >
          <li>매장 이름·영업시간·휴무일을 설정합니다.</li>
          <li>직원을 등록하고 근무시간과 로그인 계정을 발급합니다.</li>
          <li>재고 품목과 입고 기준을 등록하고 실제 입고 수량을 입력합니다.</li>
          <li>시술별 가격·소요시간·소모 재료를 설정합니다.</li>
          <li>고객을 등록하고 담당자와 시술을 선택해 예약합니다.</li>
          <li>방문·시술 상태를 바꾸고 단말기 승인 후 수납을 기록합니다.</li>
          <li>일 마감 시 결제수단별 매출과 단말기를 대조합니다.</li>
          <li>월말에 급여명세의 지급·공제 항목을 검토하고 확정합니다.</li>
        </ol>
        <div className="alert">
          <strong>수납과 환불</strong>
          <br />이 ERP는 단말기 결제 결과를 기록합니다. 카드 승인·취소는 실제
          단말기에서 먼저 처리해 주세요. 금액이 틀렸다면 해당 항목을 환불한 뒤
          올바른 금액으로 새 수납을 등록합니다.
        </div>
        <div className="alert">
          <strong>수동 입고</strong>
          <br />
          입고 등록은 실제 받은 수량을 입력하는 방식입니다. 현재 수량이 입고
          기준 이하이면 보충 필요로 표시합니다. 재고 실사는 현재 총수량을 다시
          맞추는 기능이며 사유가 기록됩니다.
        </div>
        <div className="alert">
          <strong>계정과 개인정보</strong>
          <br />
          계정은 직원별로 사용하고 퇴사 시 비활성화해 주세요. 고객의 민감정보와
          카드번호는 메모에 입력하지 마세요. 일상 업무 중 자리를 비울 때는
          로그아웃합니다.
        </div>
        <p className="help">
          급여의 세금·사회보험 공제는 검토한 금액을 직접 입력합니다. 외부 카드
          승인, 문자 발송, 온라인 고객 예약, 세무 신고 연동은 이 버전에 포함되지
          않습니다.
        </p>
      </div>
    </section>
  );
}
