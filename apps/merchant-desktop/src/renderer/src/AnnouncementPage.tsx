import { useEffect, useState, type FormEvent } from 'react'
import type {
  AnnouncementSummary,
  CreateAnnouncementRequest,
  SessionUser
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type AnnouncementEditor = {
  current: AnnouncementSummary | null
  title: string
  content: string
  pinned: boolean
  visibleFrom: string
  visibleUntil: string
  reason: string
}

const visibilityLabels: Record<AnnouncementSummary['visibility'], string> = {
  draft: '草稿',
  scheduled: '等待发布',
  active: '展示中',
  ended: '已结束',
  disabled: '已停用'
}

function toInputDateTime(value: string): string {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatTime(value: string | null): string {
  if (!value) return '长期有效'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function defaultEditor(): AnnouncementEditor {
  const now = new Date()
  now.setSeconds(0, 0)
  return {
    current: null,
    title: '',
    content: '',
    pinned: false,
    visibleFrom: toInputDateTime(now.toISOString()),
    visibleUntil: '',
    reason: ''
  }
}

function editorFor(announcement: AnnouncementSummary): AnnouncementEditor {
  return {
    current: announcement,
    title: announcement.title,
    content: announcement.content,
    pinned: announcement.pinned,
    visibleFrom: toInputDateTime(announcement.visibleFrom),
    visibleUntil: announcement.visibleUntil
      ? toInputDateTime(announcement.visibleUntil)
      : '',
    reason: ''
  }
}

function saveRequest(editor: AnnouncementEditor): CreateAnnouncementRequest {
  return {
    title: editor.title,
    content: editor.content,
    pinned: editor.pinned,
    visibleFrom: new Date(editor.visibleFrom).toISOString(),
    ...(editor.visibleUntil
      ? { visibleUntil: new Date(editor.visibleUntil).toISOString() }
      : {})
  }
}

export function AnnouncementPage({
  session
}: {
  session: SessionUser
}): React.JSX.Element {
  const [announcements, setAnnouncements] = useState<AnnouncementSummary[]>([])
  const [editor, setEditor] = useState<AnnouncementEditor | null>(null)
  const [statusAction, setStatusAction] = useState<AnnouncementSummary | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canManage = session.permissions.includes('content.manage')

  async function load(): Promise<void> {
    try {
      setAnnouncements(await getDesktopApi().listAnnouncements())
      setError(null)
    } catch (value) {
      setError(readableError(value))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!editor || busy) return
    setBusy(true)
    setError(null)
    try {
      const request = saveRequest(editor)
      const saved = editor.current
        ? await getDesktopApi().updateAnnouncement({
            announcementId: editor.current.id,
            ...request,
            reason: editor.reason
          })
        : await getDesktopApi().createAnnouncement(request)
      setNotice(`${saved.title} 已保存`)
      setEditor(null)
      await load()
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!statusAction || busy) return
    setBusy(true)
    setError(null)
    try {
      await getDesktopApi().setAnnouncementStatus({
        announcementId: statusAction.id,
        status: statusAction.status === 'published' ? 'disabled' : 'published',
        reason: statusReason
      })
      setStatusAction(null)
      setStatusReason('')
      await load()
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">顾客端公开公告与展示时段</p>
          <h1>公告管理</h1>
        </div>
        {canManage ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditor(defaultEditor())}
          >
            新增公告
          </button>
        ) : null}
      </header>

      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <section className="content-card-grid">
        {announcements.length === 0 ? (
          <div className="empty-row">暂无公告</div>
        ) : null}
        {announcements.map((announcement) => (
          <article className="content-card" key={announcement.id}>
            <div className="content-card-head">
              <div className="activity-tags">
                {announcement.pinned ? <span>置顶</span> : null}
              </div>
              <em className={`activity-visibility ${announcement.visibility}`}>
                {visibilityLabels[announcement.visibility]}
              </em>
            </div>
            <h2>{announcement.title}</h2>
            <p>{announcement.content}</p>
            <small>
              {formatTime(announcement.visibleFrom)} 至{' '}
              {formatTime(announcement.visibleUntil)}
            </small>
            {canManage ? (
              <div className="activity-actions">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setEditor(editorFor(announcement))}
                >
                  编辑
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setStatusReason('')
                    setStatusAction(announcement)
                  }}
                >
                  {announcement.status === 'published' ? '停用' : '发布'}
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      {editor ? (
        <div className="modal-backdrop">
          <form
            className="modal-card content-editor"
            onSubmit={(event) => void save(event)}
          >
            <div className="form-heading">
              <span>公告</span>
              <h2>{editor.current ? '编辑公告' : '新增公告草稿'}</h2>
            </div>
            <label>
              <span>标题</span>
              <input
                required
                minLength={2}
                maxLength={100}
                value={editor.title}
                onChange={(event) => setEditor({
                  ...editor,
                  title: event.currentTarget.value
                })}
              />
            </label>
            <label>
              <span>内容</span>
              <textarea
                required
                minLength={2}
                maxLength={5000}
                value={editor.content}
                onChange={(event) => setEditor({
                  ...editor,
                  content: event.currentTarget.value
                })}
              />
            </label>
            <div className="field-grid two-columns">
              <label>
                <span>开始显示</span>
                <input
                  required
                  type="datetime-local"
                  value={editor.visibleFrom}
                  onChange={(event) => setEditor({
                    ...editor,
                    visibleFrom: event.currentTarget.value
                  })}
                />
              </label>
              <label>
                <span>结束显示（选填）</span>
                <input
                  type="datetime-local"
                  value={editor.visibleUntil}
                  onChange={(event) => setEditor({
                    ...editor,
                    visibleUntil: event.currentTarget.value
                  })}
                />
              </label>
            </div>
            <label className="checkbox-field">
              <input
                checked={editor.pinned}
                type="checkbox"
                onChange={(event) => setEditor({
                  ...editor,
                  pinned: event.currentTarget.checked
                })}
              />
              <span>置顶</span>
            </label>
            {editor.current ? (
              <label>
                <span>修改原因</span>
                <textarea
                  required
                  minLength={2}
                  maxLength={200}
                  value={editor.reason}
                  onChange={(event) => setEditor({
                    ...editor,
                    reason: event.currentTarget.value
                  })}
                />
              </label>
            ) : null}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditor(null)}
              >
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                保存草稿
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {statusAction ? (
        <div className="modal-backdrop">
          <form
            className="modal-card"
            onSubmit={(event) => void changeStatus(event)}
          >
            <div className="form-heading">
              <span>店长确认</span>
              <h2>{statusAction.title}</h2>
            </div>
            <label>
              <span>操作原因</span>
              <textarea
                required
                minLength={2}
                maxLength={200}
                value={statusReason}
                onChange={(event) => setStatusReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setStatusAction(null)}
              >
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                确认
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
