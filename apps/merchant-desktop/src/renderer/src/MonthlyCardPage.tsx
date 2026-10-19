import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MemberSummary, MonthlyCardDetails, SessionUser } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import { MemberSelection } from './member-selection'

function formatFen(value: number): string {
  return `¥${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

const statusText = {
  active: '生效中',
  paused: '已暂停',
  expired: '已到期',
  refunded: '已退款',
  voided: '已作废'
} as const

export function MonthlyCardPage({ session }: { session: SessionUser }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberSummary[]>([])
  const [member, setMember] = useState<MemberSummary | null>(null)
  const [details, setDetails] = useState<MonthlyCardDetails | null>(null)
  const [reason, setReason] = useState('')
  const [extensionDays, setExtensionDays] = useState(30)
  const [refundSpecialOverride, setRefundSpecialOverride] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selection = useRef(new MemberSelection())
  const submitting = useRef(false)
  useEffect(() => () => { selection.current.select(null) }, [])
  useEffect(() => getDesktopApi().onCloudDataChanged(() => {
    if (!submitting.current) void refresh().catch(() => {})
  }), [member])
  const canApprove = session.permissions.includes('refund.approve')
  const canExtend = session.role === 'manager'
  const extendableCard =
    details?.current ??
    details?.history.find((card) => card.status === 'expired') ??
    null

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    try {
      setResults(await getDesktopApi().searchMembers({ query, limit: 20 }))
    } catch (value) {
      setError(readableError(value))
    }
  }

  async function selectMember(nextMember: MemberSummary): Promise<void> {
    if (submitting.current) return
    const generation = selection.current.select(nextMember.id)
    setMember(nextMember)
    setDetails(null)
    setError(null)
    setNotice(null)
    setReason('')
    setRefundSpecialOverride(false)
    try {
      const next = await getDesktopApi().getMonthlyCardDetails({ memberId: nextMember.id })
      if (!selection.current.accepts(generation, nextMember.id)) return
      setDetails(next)
      setResults([])
    } catch (reason) {
      if (selection.current.accepts(generation, nextMember.id)) setError(readableError(reason))
    }
  }

  async function refresh(): Promise<void> {
    const memberId = selection.current.memberId
    if (!memberId) return
    const generation = selection.current.capture()
    const next = await getDesktopApi().getMonthlyCardDetails({ memberId })
    if (selection.current.accepts(generation, memberId)) setDetails(next)
  }

  async function purchase(): Promise<void> {
    if (!member || submitting.current || !details || selection.current.memberId !== member.id) return
    submitting.current = true
    setBusy(true)
    try {
      await getDesktopApi().purchaseMonthlyCard({
        requestId: crypto.randomUUID(),
        memberId: member.id,
        reason: '前台现金购买月卡'
      })
      setNotice(`月卡购买成功，请收现金 ${formatFen(details?.plan.priceFen ?? 20_000)}`)
      setError(null)
      await refresh()
    } catch (value) {
      setError(readableError(value))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  async function action(type: 'pause' | 'resume' | 'use'): Promise<void> {
    const card = details?.current
    if (!card || submitting.current || !details || selection.current.memberId !== card.memberId) return
    if (reason.trim().length < 2) {
      setError('请先填写至少 2 个字的操作原因')
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      const request = {
        requestId: crypto.randomUUID(),
        cardId: card.id,
        reason: reason.trim()
      }
      if (type === 'pause') await getDesktopApi().pauseMonthlyCard(request)
      if (type === 'resume') await getDesktopApi().resumeMonthlyCard(request)
      if (type === 'use') await getDesktopApi().useMonthlyCard(request)
      setNotice(
        type === 'pause'
          ? '月卡已暂停，当天立即不能使用'
          : type === 'resume'
            ? '月卡已恢复，到期时间已顺延'
            : '已记录本人月卡免入场权益'
      )
      setReason('')
      setError(null)
      await refresh()
    } catch (value) {
      setError(readableError(value))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  async function submitRefund(direct: boolean): Promise<void> {
    const card = details?.current
    if (!card || submitting.current || !details || selection.current.memberId !== card.memberId) return
    if (direct && card.usageCount > 0 && !refundSpecialOverride) {
      setError('该月卡已经使用，店长直接退款时必须勾选特殊退款')
      return
    }
    if (direct && refundSpecialOverride && reason.trim().length < 2) {
      setError('月卡特殊退款必须填写至少 2 个字的原因')
      return
    }
    submitting.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const requestId = crypto.randomUUID()
      const refund =
        direct && canApprove
          ? await getDesktopApi().directFinancialRefund({
              requestId,
              targetType: 'monthly_card',
              targetId: card.id,
              ...(refundSpecialOverride ? { specialOverride: true } : {}),
              ...(reason.trim() ? { reason: reason.trim() } : {})
            })
          : await getDesktopApi().createFinancialRefundRequest({
              requestId,
              targetType: 'monthly_card',
              targetId: card.id,
              ...(reason.trim() ? { reason: reason.trim() } : {})
            })
      setNotice(
        refund.status === 'completed'
          ? `月卡已退款，请退现金 ${formatFen(refund.refundPrincipalFen)}`
          : `${refund.requestNumber} 已提交店长审批`
      )
      setReason('')
      setRefundSpecialOverride(false)
      await refresh()
    } catch (value) {
      setError(readableError(value))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  async function extendCard(): Promise<void> {
    if (!extendableCard || submitting.current || !details || selection.current.memberId !== extendableCard.memberId) return
    if (!Number.isInteger(extensionDays) || extensionDays < 1 || extensionDays > 365) {
      setError('延长天数必须为 1-365 的整数')
      return
    }
    if (reason.trim().length < 2) {
      setError('请填写至少 2 个字的延长原因')
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      const card = await getDesktopApi().extendMonthlyCard({
        requestId: crypto.randomUUID(),
        cardId: extendableCard.id,
        days: extensionDays,
        reason: reason.trim()
      })
      setNotice(`月卡已延长 ${extensionDays} 天，新到期时间：${new Date(card.expiresAt).toLocaleString('zh-CN')}`)
      setReason('')
      setError(null)
      await refresh()
    } catch (value) {
      setError(readableError(value))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">本人免入场</p>
          <h1>月卡</h1>
        </div>
        <div className="release-tag">购买日起 30 天</div>
      </header>
      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <form className="wallet-member-search panel" onSubmit={(event) => void search(event)}>
        <label>
          <span>查询会员</span>
          <input
            required
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="手机号、会员号或昵称"
          />
        </label>
        <button className="primary-button" type="submit">查询</button>
      </form>
      {results.length > 0 ? (
        <section className="member-search-results panel">
          {results.map((item) => (
            <button type="button" key={item.id} onClick={() => void selectMember(item)}>
              <strong>{item.nickname}</strong>
              <span>{item.phone} · {item.memberNumber}</span>
              <em>{item.tier === 'advanced' ? '高级会员' : '普通会员'}</em>
            </button>
          ))}
        </section>
      ) : null}

      {member && details ? (
        <section className="monthly-card-grid">
          <article className="panel monthly-card-main">
            <div className="panel-heading">
              <div>
                <h2>{member.nickname}</h2>
                <p>{member.phone} · {member.memberNumber}</p>
              </div>
              {details.current ? (
                <span className={`status-pill ${details.current.status}`}>
                  {statusText[details.current.status]}
                </span>
              ) : null}
            </div>
            {details.current ? (
              <>
                <div className="card-facts">
                  <div><span>购买金额</span><strong>{formatFen(details.current.priceFen)}</strong></div>
                  <div><span>支付方式</span><strong>{details.current.paymentMethod === 'wechat' ? '微信支付' : '现金'}</strong></div>
                  <div><span>到期时间</span><strong>{new Date(details.current.expiresAt).toLocaleString('zh-CN')}</strong></div>
                  <div><span>已使用</span><strong>{details.current.usageCount} 次</strong></div>
                </div>
                <label>
                  <span>本次操作原因</span>
                  <input
                    maxLength={200}
                    value={reason}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    placeholder="例如：顾客申请暂停"
                  />
                </label>
                {canApprove && details.current.usageCount > 0 ? (
                  <label className="checkbox-field monthly-refund-warning">
                    <input
                      type="checkbox"
                      checked={refundSpecialOverride}
                      onChange={(event) =>
                        setRefundSpecialOverride(event.currentTarget.checked)
                      }
                    />
                    <span>该月卡已经使用；店长特殊退款需勾选并填写原因</span>
                  </label>
                ) : null}
                {details.current.paymentMethod === 'wechat' ? (
                  <p className="monthly-refund-warning">
                    微信支付月卡不能在 PC 端按现金退款，请通过微信支付退款流程处理。
                  </p>
                ) : null}
                <div className="monthly-actions">
                  {details.current.status === 'active' ? (
                    <>
                      <button className="primary-button" disabled={busy} type="button" onClick={() => void action('use')}>
                        记录本人免入场
                      </button>
                      <button className="secondary-button" disabled={busy} type="button" onClick={() => void action('pause')}>
                        暂停
                      </button>
                    </>
                  ) : (
                    <button className="primary-button" disabled={busy} type="button" onClick={() => void action('resume')}>
                      恢复并顺延
                    </button>
                  )}
                  {details.current.paymentMethod === 'wechat' ? null : !canApprove ? (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      type="button"
                      onClick={() => void submitRefund(false)}
                    >
                      提交退款申请
                    </button>
                  ) : (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        type="button"
                        onClick={() => void submitRefund(false)}
                      >
                        仅提交申请
                      </button>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        type="button"
                        onClick={() => void submitRefund(true)}
                      >
                        店长直接退款
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="purchase-card">
                <strong>{details.plan.name}</strong>
                <span>{formatFen(details.plan.priceFen)} · {details.plan.durationDays} 天</span>
                <p>仅支持现金购买，不能使用储值余额。</p>
                <button className="primary-button" disabled={busy} type="button" onClick={() => void purchase()}>
                  确认收取现金并开通
                </button>
              </div>
            )}
            {canExtend && extendableCard && extendableCard.status !== 'refunded' && extendableCard.status !== 'voided' ? (
              <div className="purchase-card monthly-extension-card">
                <strong>店长人工延长</strong>
                <label>
                  <span>延长天数（单次 1-365 天）</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    step={1}
                    value={extensionDays}
                    onChange={(event) => setExtensionDays(Number(event.currentTarget.value))}
                  />
                </label>
                <p>
                  延长前：{new Date(extendableCard.expiresAt).toLocaleString('zh-CN')}；
                  延长后：{new Date(Math.max(new Date(extendableCard.expiresAt).getTime(), Date.now()) + extensionDays * 24 * 60 * 60 * 1000).toLocaleString('zh-CN')}
                </p>
                <label>
                  <span>延长原因</span>
                  <input
                    maxLength={200}
                    value={reason}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    placeholder="例如：停业补偿或店长修正"
                  />
                </label>
                <button className="secondary-button" disabled={busy} type="button" onClick={() => void extendCard()}>
                  确认延长
                </button>
              </div>
            ) : null}
          </article>

          <article className="panel">
            <div className="panel-heading"><div><h2>月卡记录</h2><p>状态变化与权益使用均不可删除。</p></div></div>
            <div className="card-event-list">
              {details.events.length === 0 ? <div className="empty-row">暂无记录</div> : null}
              {details.events.map((event) => (
                <div key={event.id}>
                  <strong>{event.eventType === 'reconciled' ? '差异核对更正' : event.eventType}</strong>
                  <span>{event.reason}</span>
                  <small>{new Date(event.occurredAt).toLocaleString('zh-CN')}</small>
                </div>
              ))}
            </div>
            <div className="legacy-monthly-history">
              <div className="panel-heading">
                <div>
                  <h2>旧系统月卡</h2>
                  <p>保留旧计划名称和原有效期；付款渠道未知。</p>
                </div>
              </div>
              <div className="card-event-list">
                {details.legacyHistory.length === 0 ? (
                  <div className="empty-row">暂无旧系统月卡记录</div>
                ) : null}
                {details.legacyHistory.map((card) => (
                  <div key={card.id}>
                    <strong>{card.planName}</strong>
                    <span>{card.status === 'active' ? '导入时有效' : '已到期'}</span>
                    <small>
                      {new Date(card.startsAt).toLocaleDateString('zh-CN')} 至{' '}
                      {new Date(card.expiresAt).toLocaleDateString('zh-CN')}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </section>
      ) : null}
    </>
  )
}
