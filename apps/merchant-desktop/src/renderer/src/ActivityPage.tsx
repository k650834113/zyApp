import {ActivityLotteryPanel} from './ActivityLotteryPanel'
import { useEffect, useState, type FormEvent } from 'react'
import type {
  ActivitySummary,
  ActivityType,
  CreateActivityRequest,
  SessionUser
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type Editor = {
  activity: ActivitySummary | null
  title: string
  summary: string
  content: string
  activityType: ActivityType
  startsAt: string
  endsAt: string
  pinned: boolean
  regularYuan: string
  advancedYuan: string
  allowStoredValue: boolean
  allowWechat: boolean
  rechargeTiers: string
  reason: string
}

type ConfirmAction =
  | { type: 'status'; activity: ActivitySummary }
  | { type: 'apply-tiers'; activity: ActivitySummary }

const visibilityLabels: Record<ActivitySummary['visibility'], string> = {
  draft: '草稿',
  scheduled: '等待开始',
  active: '进行中',
  ended: '已结束',
  disabled: '已停用'
}

function formatFen(value: number): string {
  return `¥${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

function optionalYuanToFen(value: string): number | undefined {
  const normalized = value.trim()
  if (!normalized) return undefined
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('价格格式不正确，最多保留两位小数')
  }
  const [yuanPart = '0', decimalPart = ''] = normalized.split('.')
  const fen = Number(yuanPart) * 100 + Number(decimalPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(fen) || fen < 0) throw new Error('价格不能小于 0')
  return fen
}

function parseRechargeTiers(value: string): CreateActivityRequest['rechargeTiers'] {
  if (!value.trim()) return []
  const tiers = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+(?:\.\d{1,2})?)\s*[:：,，]\s*(\d+(?:\.\d{1,2})?)$/.exec(
        line
      )
      if (!match) {
        throw new Error(`充值档位“${line}”格式不正确，请使用 300:20`)
      }
      const principalFen = optionalYuanToFen(match[1] ?? '')
      const giftFen = optionalYuanToFen(match[2] ?? '')
      if (!principalFen || giftFen === undefined) {
        throw new Error('充值本金必须大于 0')
      }
      return { principalFen, giftFen }
    })
  if (new Set(tiers.map((tier) => tier.principalFen)).size !== tiers.length) {
    throw new Error('同一个充值本金只能设置一个赠送档位')
  }
  return tiers.sort((left, right) => left.principalFen - right.principalFen)
}

function toInputDateTime(value: string): string {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function defaultEditor(): Editor {
  const starts = new Date()
  starts.setMinutes(0, 0, 0)
  const ends = new Date(starts.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    activity: null,
    title: '',
    summary: '',
    content: '',
    activityType: 'recharge',
    startsAt: toInputDateTime(starts.toISOString()),
    endsAt: toInputDateTime(ends.toISOString()),
    pinned: false,
    regularYuan: '',
    advancedYuan: '',
    allowStoredValue: true,
    allowWechat: true,
    rechargeTiers: '300:20\n500:50\n1000:200',
    reason: ''
  }
}

function editorFor(activity: ActivitySummary): Editor {
  return {
    activity,
    title: activity.title,
    summary: activity.summary,
    content: activity.content,
    activityType: activity.activityType,
    startsAt: toInputDateTime(activity.startsAt),
    endsAt: toInputDateTime(activity.endsAt),
    pinned: activity.pinned,
    regularYuan:
      activity.regularPriceFen === null ? '' : String(activity.regularPriceFen / 100),
    advancedYuan:
      activity.advancedPriceFen === null
        ? ''
        : String(activity.advancedPriceFen / 100),
    allowStoredValue: activity.allowStoredValue,
    allowWechat: activity.allowWechat,
    rechargeTiers: activity.rechargeTiers
      .map((tier) => `${tier.principalFen / 100}:${tier.giftFen / 100}`)
      .join('\n'),
    reason: ''
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function ActivityPage({
  session
}: {
  session: SessionUser
}): React.JSX.Element {
  const [lotteryActivity,setLotteryActivity]=useState<ActivitySummary|null>(null)
  const [activities, setActivities] = useState<ActivitySummary[]>([])
  const [editor, setEditor] = useState<Editor | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const canManage = session.permissions.includes('activity.manage')

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setActivities(await getDesktopApi().listActivities())
      setError(null)
    } catch (value) {
      setError(readableError(value))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function replaceActivity(updated: ActivitySummary): void {
    setActivities((current) =>
      current.map((activity) => (activity.id === updated.id ? updated : activity))
    )
  }

  async function submitEditor(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!editor || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const regularPriceFen = optionalYuanToFen(editor.regularYuan)
      const advancedPriceFen = optionalYuanToFen(editor.advancedYuan)
      const request: CreateActivityRequest = {
        title: editor.title,
        summary: editor.summary,
        content: editor.content,
        activityType: editor.activityType,
        startsAt: new Date(editor.startsAt).toISOString(),
        endsAt: new Date(editor.endsAt).toISOString(),
        pinned: editor.pinned,
        ...(regularPriceFen === undefined ? {} : { regularPriceFen }),
        ...(advancedPriceFen === undefined ? {} : { advancedPriceFen }),
        allowStoredValue: editor.allowStoredValue,
        allowWechat: editor.allowWechat,
        rechargeTiers:
          editor.activityType === 'recharge'
            ? parseRechargeTiers(editor.rechargeTiers)
            : []
      }
      if (editor.activity) {
        const updated = await getDesktopApi().updateActivity({
          activityId: editor.activity.id,
          ...request,
          reason: editor.reason
        })
        replaceActivity(updated)
        setNotice(`${updated.title} 已更新，已发生的充值记录不会改变`)
      } else {
        const created = await getDesktopApi().createActivity(request)
        setActivities((current) => [created, ...current])
        setNotice(`${created.title} 已保存为草稿`)
      }
      setEditor(null)
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  async function submitConfirm(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!confirmAction || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (confirmAction.type === 'status') {
        const nextStatus =
          confirmAction.activity.status === 'published' ? 'disabled' : 'published'
        const updated = await getDesktopApi().setActivityStatus({
          activityId: confirmAction.activity.id,
          status: nextStatus,
          reason
        })
        replaceActivity(updated)
        setNotice(
          nextStatus === 'published'
            ? `${updated.title} 已发布，将按开始和结束时间自动显示`
            : `${updated.title} 已停用`
        )
      } else {
        await getDesktopApi().applyActivityRechargeTiers({
          activityId: confirmAction.activity.id,
          reason
        })
        setNotice(
          `${confirmAction.activity.title} 的充值档位已应用，之后的新充值按该规则计算`
        )
      }
      setConfirmAction(null)
      setReason('')
      await load()
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {lotteryActivity&&<ActivityLotteryPanel activity={lotteryActivity} canManage={canManage} onClose={()=>setLotteryActivity(null)}/>}
      <header className="page-header">
        <div>
          <p className="eyebrow">宣传内容与充值活动快照</p>
          <h1>活动管理</h1>
        </div>
        {canManage ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => setEditor(defaultEditor())}
          >
            新增活动
          </button>
        ) : (
          <div className="release-tag">店员只读</div>
        )}
      </header>

      <div className="activity-guidance">
        发布活动不会自动修改充值赠送规则。充值活动需要店长单独点击“应用充值规则”，
        修改后的规则只影响之后的新充值。
      </div>
      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <section className="activity-grid">
        {loading ? <div className="empty-row">正在读取活动...</div> : null}
        {!loading && activities.length === 0 ? (
          <div className="empty-row">暂无活动，可先建立节假日充值活动草稿</div>
        ) : null}
        {activities.map((activity) => (
          <article
            className={`activity-card visibility-${activity.visibility}`}
            key={activity.id}
          >
            <div className="activity-card-head">
              <div className="activity-tags">
                <span>{activity.activityType === 'recharge' ? '充值活动' : '普通活动'}</span>
                {activity.pinned ? <span>置顶</span> : null}
              </div>
              <em className={`activity-visibility ${activity.visibility}`}>
                {visibilityLabels[activity.visibility]}
              </em>
            </div>
            <h2>{activity.title}</h2><button type="button" className="secondary-button" onClick={()=>setLotteryActivity(activity)}>报名与抽奖</button>
            <p className="activity-summary">{activity.summary}</p>
            <div className="activity-schedule">
              <span>{formatTime(activity.startsAt)}</span>
              <span>至</span>
              <span>{formatTime(activity.endsAt)}</span>
            </div>
            {activity.rechargeTiers.length > 0 ? (
              <div className="activity-tier-list">
                {activity.rechargeTiers.map((tier) => (
                  <span key={tier.id}>
                    充 {formatFen(tier.principalFen)} 赠 {formatFen(tier.giftFen)}
                  </span>
                ))}
              </div>
            ) : null}
            {activity.regularPriceFen !== null ||
            activity.advancedPriceFen !== null ? (
              <div className="activity-price-row">
                <span>
                  普通价{' '}
                  {activity.regularPriceFen === null
                    ? '未设置'
                    : formatFen(activity.regularPriceFen)}
                </span>
                <span>
                  高级会员价{' '}
                  {activity.advancedPriceFen === null
                    ? '未设置'
                    : formatFen(activity.advancedPriceFen)}
                </span>
              </div>
            ) : null}
            <div className="activity-payment-row">
              {activity.allowStoredValue ? <span>可用储值</span> : null}
              {activity.allowWechat ? <span>可用微信</span> : null}
            </div>
            <details>
              <summary>查看活动正文</summary>
              <p>{activity.content}</p>
            </details>
            {canManage ? (
              <div className="activity-actions">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setEditor(editorFor(activity))}
                >
                  编辑
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setConfirmAction({ type: 'status', activity })}
                >
                  {activity.status === 'published' ? '停用' : '发布'}
                </button>
                {activity.activityType === 'recharge' ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setConfirmAction({ type: 'apply-tiers', activity })
                    }
                  >
                    应用充值规则
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </section>

      {editor ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal-card activity-editor"
            onSubmit={(event) => void submitEditor(event)}
          >
            <div className="form-heading">
              <span>活动配置</span>
              <h2>{editor.activity ? `编辑 ${editor.activity.title}` : '新增活动草稿'}</h2>
              <p>活动时间按当前电脑时区录入，保存时统一转换为标准时间。</p>
            </div>
            <div className="activity-editor-scroll">
              <label>
                <span>活动标题</span>
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={editor.title}
                  onChange={(event) =>
                    setEditor({ ...editor, title: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                <span>活动摘要</span>
                <textarea
                  required
                  minLength={2}
                  maxLength={300}
                  value={editor.summary}
                  onChange={(event) =>
                    setEditor({ ...editor, summary: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                <span>活动正文</span>
                <textarea
                  required
                  minLength={2}
                  maxLength={5000}
                  value={editor.content}
                  onChange={(event) =>
                    setEditor({ ...editor, content: event.currentTarget.value })
                  }
                />
              </label>
              <div className="field-grid two-columns">
                <label>
                  <span>活动类型</span>
                  <select
                    value={editor.activityType}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        activityType: event.currentTarget.value as ActivityType
                      })
                    }
                  >
                    <option value="recharge">充值活动</option>
                    <option value="general">普通图文活动</option>
                  </select>
                </label>
                <label className="checkbox-field activity-pin">
                  <input
                    checked={editor.pinned}
                    type="checkbox"
                    onChange={(event) =>
                      setEditor({ ...editor, pinned: event.currentTarget.checked })
                    }
                  />
                  <span>在顾客端置顶</span>
                </label>
              </div>
              <div className="field-grid two-columns">
                <label>
                  <span>开始时间</span>
                  <input
                    required
                    type="datetime-local"
                    value={editor.startsAt}
                    onChange={(event) =>
                      setEditor({ ...editor, startsAt: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  <span>结束时间</span>
                  <input
                    required
                    type="datetime-local"
                    value={editor.endsAt}
                    onChange={(event) =>
                      setEditor({ ...editor, endsAt: event.currentTarget.value })
                    }
                  />
                </label>
              </div>
              <div className="field-grid two-columns">
                <label>
                  <span>普通价格（元，选填）</span>
                  <input
                    inputMode="decimal"
                    value={editor.regularYuan}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        regularYuan: event.currentTarget.value
                      })
                    }
                  />
                </label>
                <label>
                  <span>高级会员价（元，选填）</span>
                  <input
                    inputMode="decimal"
                    value={editor.advancedYuan}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        advancedYuan: event.currentTarget.value
                      })
                    }
                  />
                </label>
              </div>
              <div className="activity-payment-options">
                <label className="checkbox-field">
                  <input
                    checked={editor.allowStoredValue}
                    type="checkbox"
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        allowStoredValue: event.currentTarget.checked
                      })
                    }
                  />
                  <span>允许储值支付</span>
                </label>
                <label className="checkbox-field">
                  <input
                    checked={editor.allowWechat}
                    type="checkbox"
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        allowWechat: event.currentTarget.checked
                      })
                    }
                  />
                  <span>允许微信支付</span>
                </label>
              </div>
              {editor.activityType === 'recharge' ? (
                <label>
                  <span>充值赠送档位（每行一个，格式 300:20）</span>
                  <textarea
                    required
                    value={editor.rechargeTiers}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        rechargeTiers: event.currentTarget.value
                      })
                    }
                  />
                </label>
              ) : null}
              {editor.activity ? (
                <label>
                  <span>修改原因</span>
                  <textarea
                    required
                    minLength={2}
                    maxLength={200}
                    value={editor.reason}
                    onChange={(event) =>
                      setEditor({ ...editor, reason: event.currentTarget.value })
                    }
                  />
                </label>
              ) : null}
            </div>
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

      {confirmAction ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal-card"
            onSubmit={(event) => void submitConfirm(event)}
          >
            <div className="form-heading">
              <span>店长确认</span>
              <h2>
                {confirmAction.type === 'apply-tiers'
                  ? `应用 ${confirmAction.activity.title} 的充值规则`
                  : `${
                      confirmAction.activity.status === 'published' ? '停用' : '发布'
                    } ${confirmAction.activity.title}`}
              </h2>
              <p>
                {confirmAction.type === 'apply-tiers'
                  ? '此操作会替换当前充值赠送档位，但不会修改历史充值。'
                  : '发布后将根据活动开始和结束时间自动显示或隐藏。'}
              </p>
            </div>
            <label>
              <span>操作原因</span>
              <textarea
                required
                autoFocus
                minLength={2}
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirmAction(null)}
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
