import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, Button, ConfirmDialog, EmptyState, Field, Modal } from "../components/ui";
import { Icon } from "../components/Icon";
import { useViewState } from "../components/ViewState";
import { timestampLabel } from "./operations-utils";
import "./Workforce.css";

// Read receipts are fetched separately so reading never changes the shared business version.
export function useNoticeReads(version, enabled = true) {
  const [reads, setReads] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    api("/notices/reads")
      .then((result) => live && setReads(result.reads))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [version, enabled]);
  useEffect(() => {
    // Keeps the sidebar badge and the notice page in step after a notice is opened.
    const update = (event) => setReads(event.detail);
    window.addEventListener("erp-notice-reads", update);
    return () => window.removeEventListener("erp-notice-reads", update);
  }, []);
  return [reads, setReads];
}

export default function Notices({ data, user, version, runAction, notify }) {
  const lead = ["owner", "manager"].includes(user.role);
  const [reads, setReads] = useNoticeReads(version);
  const [query, setQuery] = useViewState("notices", "query", "");
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [archive, setArchive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const notices = (data.notices || [])
    .filter((row) => !row.archived)
    .filter((row) => {
      const search = query.trim().toLocaleLowerCase();
      return (
        !search ||
        `${row.title} ${row.body}`.toLocaleLowerCase().includes(search)
      );
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const isRead = (id) =>
    reads.some((row) => row.noticeId === id && row.userId === user.id);
  const readers = (id) => reads.filter((row) => row.noticeId === id);
  const activeStaff = data.staff.filter((row) => row.status === "active").length;
  const show = async (notice) => {
    setOpen(notice);
    if (!isRead(notice.id))
      try {
        const result = await api(`/notices/${notice.id}/read`, {
          method: "POST",
          body: {},
        });
        setReads(result.reads);
        window.dispatchEvent(
          new CustomEvent("erp-notice-reads", { detail: result.reads }),
        );
      } catch {}
  };
  return (
    <div className="workforce-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">공지사항</h1>
          <p className="page-description">
            매장 운영 안내와 전달 사항을 확인합니다. 공지를 열면 확인 여부가
            기록됩니다.
          </p>
        </div>
        {lead && (
          <div className="page-actions">
            <Button
              variant="primary"
              onClick={() => setEditing({ title: "", body: "", pinned: false })}
            >
              <Icon name="plus" size={15} /> 공지 작성
            </Button>
          </div>
        )}
      </div>
      {error && (
        <div className="alert alert-warning" role="alert">
          {error}
        </div>
      )}
      <div className="toolbar">
        <Field label="공지 검색">
          <input
            type="search"
            value={query}
            placeholder="제목 · 내용"
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <span className="help toolbar-count" role="status">
          {notices.length}건 · 읽지 않음{" "}
          {notices.filter((row) => !isRead(row.id)).length}건
        </span>
      </div>
      {notices.length ? (
        <ul className="notice-list">
          {notices.map((notice) => (
            <li key={notice.id}>
              <button
                type="button"
                className={`notice-item card ${isRead(notice.id) ? "" : "unread"}`}
                onClick={() => show(notice)}
              >
                <span className="notice-title">
                  {notice.pinned && <Badge tone="warning">고정</Badge>}
                  {!isRead(notice.id) && (
                    <span className="unread-dot" aria-label="읽지 않음" />
                  )}
                  <strong>{notice.title}</strong>
                </span>
                <span className="notice-preview">{notice.body}</span>
                <span className="help">
                  {notice.authorName} · {timestampLabel(notice.createdAt)}
                  {lead &&
                    ` · 확인 ${readers(notice.id).length}/${activeStaff}명`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={query ? "검색 결과가 없습니다" : "등록된 공지가 없습니다"}
          description={
            lead
              ? "휴무 안내, 신규 시술 가격, 재고 사용 규칙 등을 공지로 남겨 보세요."
              : "새 공지가 올라오면 여기에 표시됩니다."
          }
        />
      )}
      {open && (
        <Modal
          title={open.title}
          onClose={() => setOpen(null)}
          footer={
            lead && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setArchive(open);
                    setOpen(null);
                  }}
                >
                  보관
                </Button>
                <Button
                  onClick={() => {
                    setEditing(open);
                    setOpen(null);
                  }}
                >
                  수정
                </Button>
              </>
            )
          }
        >
          <p className="help">
            {open.authorName} · {timestampLabel(open.createdAt)}
            {open.updatedAt !== open.createdAt &&
              ` · 수정 ${timestampLabel(open.updatedAt)}`}
          </p>
          <div className="notice-body">{open.body}</div>
          {lead && (
            <div className="notice-readers">
              <strong>확인한 직원 {readers(open.id).length}명</strong>
              <p className="help">
                {readers(open.id)
                  .map((row) => row.userName)
                  .join(", ") || "아직 확인한 직원이 없습니다."}
              </p>
            </div>
          )}
        </Modal>
      )}
      {editing && (
        <NoticeForm
          initial={editing}
          runAction={runAction}
          notify={notify}
          close={() => setEditing(null)}
        />
      )}
      {archive && (
        <ConfirmDialog
          title="공지를 보관할까요?"
          confirmLabel="보관"
          variant="danger"
          busy={busy}
          onClose={() => setArchive(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await runAction("notice.archive", { id: archive.id });
              notify("공지를 보관했습니다.");
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
              setArchive(null);
            }
          }}
        >
          보관한 공지는 직원 목록에서 사라집니다. 변경 이력은 남습니다.
        </ConfirmDialog>
      )}
    </div>
  );
}

function NoticeForm({ initial, runAction, notify, close }) {
  const [form, setForm] = useState({
    id: initial.id,
    title: initial.title,
    body: initial.body,
    pinned: !!initial.pinned,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty =
    form.title !== initial.title ||
    form.body !== initial.body ||
    form.pinned !== !!initial.pinned;
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await runAction("notice.save", form);
      notify("공지를 저장했습니다.");
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={form.id ? "공지 수정" : "공지 작성"}
      onClose={busy ? undefined : close}
      dirty={dirty}
      footer={
        <Button form="notice-form" type="submit" variant="primary" busy={busy}>
          저장
        </Button>
      }
    >
      <form id="notice-form" className="stack" onSubmit={submit}>
        {error && (
          <div className="alert alert-warning" role="alert">
            {error}
          </div>
        )}
        <Field label="제목">
          <input
            required
            maxLength={120}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="내용">
          <textarea
            required
            rows={8}
            maxLength={5000}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={form.pinned}
            onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
          />
          목록 상단에 고정
        </label>
      </form>
    </Modal>
  );
}
