import { useEffect, useState, type FormEvent } from 'react'
import type {
  FinancialRefundSummary,
  RefundSummary,
  RefundableOrderSummary,
  SessionUser
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type ReviewAction = {
  refund: RefundSummary
  mode: 'approve' | 'reject'
}

type FinancialReviewAction = {
  refund: FinancialRefundSummary
  mode: 'approve' | 'reject'
}

const statusLabels = {
  pending: '待审批',
  completed: '已完成',
  rejected: '已驳回'
} as const

function formatFen(value: number): string {
  return `¥${(value / 100).toFixed(2)}`
}

export function RefundPage({ session }: { session: SessionUser }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState<RefundableOrderSummary | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [specialProductOverride, setSpecialProductOverride] = useState(false)
  const [refunds, setRefunds] = useState<RefundSummary[]>([])
  const [financialRefunds, setFinancialRefunds] = useState<FinancialRefundSummary[]>([])
  const [review, setReview] = useState<ReviewAction | null>(null)
  const [financialReview, setFinancialReview] =
    useState<FinancialReviewAction | null>(null)
  const [reviewReason, setReviewReason] = useState('')
  const [reviewSpecial, setReviewSpecial] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canApprove = session.permissions.includes('refund.approve')

  async function loadRefunds(): Promise<void> {
    try {
      setRefunds(await getDesktopApi().listRefunds({ limit: 50 }))
    } catch (value) {
      setError(readableError(value))
    }
  }

  async function loadFinancialRefunds(): Promise<void> {
    try {
      setFinancialRefunds(await getDesktopApi().listFinancialRefunds({ limit: 50 }))
    } catch (value) {
      setError(readableError(value))
    }
  }

  useEffect(() => {
    void Promise.all([loadRefunds(), loadFinancialRefunds()])
  }, [])

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const found = await getDesktopApi().findRefundableOrder({ query: query.trim() })
      setOrder(found)
      setQuantities({})
      setReason('')
      setSpecialProductOverride(false)
    } catch (value) {
      setOrder(null)
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  function selectedItems(): Array<{ orderItemId: string; quantity: number }> {
    return Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }))
  }

  async function refreshOrder(orderId: string): Promise<void> {
    setOrder(await getDesktopApi().findRefundableOrder({ query: orderId }))
    setQuantities({})
  }

  async function submitRefund(direct: boolean): Promise<void> {
    if (!order || busy) return
    const items = selectedItems()
    if (items.length === 0) {
      setError('请至少选择一个退款项目和数量')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const refund =
        direct && canApprove
          ? await getDesktopApi().directRefund({
              requestId: crypto.randomUUID(),
              orderId: order.id,
              items,
              ...(specialProductOverride ? { specialProductOverride: true } : {}),
              ...(reason.trim() ? { reason: reason.trim() } : {})
            })
          : await getDesktopApi().createRefundRequest({
              requestId: crypto.randomUUID(),
              orderId: order.id,
              items,
              ...(reason.trim() ? { reason: reason.trim() } : {})
            })
      setNotice(
        direct
          ? `${refund.refundNumber} 已完成，原渠道退回 ${formatFen(refund.totalFen)}`
          : `${refund.refundNumber} 已提交店长审批`
      )
      setReason('')
      setSpecialProductOverride(false)
      await Promise.all([loadRefunds(), refreshOrder(order.id)])
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  async function reviewRefund(): Promise<void> {
    if (!review || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const updated =
        review.mode === 'approve'
          ? await getDesktopApi().approveRefund({
              requestId: crypto.randomUUID(),
              refundId: review.refund.id,
              ...(reviewSpecial ? { specialProductOverride: true } : {}),
              ...(reviewReason.trim() ? { reason: reviewReason.trim() } : {})
            })
          : await getDesktopApi().rejectRefund({
              requestId: crypto.randomUUID(),
              refundId: review.refund.id,
              reason: reviewReason.trim()
            })
      setNotice(
        updated.status === 'completed'
          ? `${updated.refundNumber} 已完成退款`
          : `${updated.refundNumber} 已驳回`
      )
      setReview(null)
      setReviewReason('')
      setReviewSpecial(false)
      await loadRefunds()
      if (order?.id === updated.orderId) await refreshOrder(updated.orderId)
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  async function reviewFinancialRefund(): Promise<void> {
    if (!financialReview || busy) return
    if (
      financialReview.mode === 'approve' &&
      financialReview.refund.requiresSpecialOverride &&
      !reviewSpecial
    ) {
      setError('该月卡已经使用，审批时必须勾选特殊退款')
      return
    }
    if (
      financialReview.mode === 'approve' &&
      financialReview.refund.requiresSpecialOverride &&
      reviewReason.trim().length < 2
    ) {
      setError('月卡特殊退款必须填写至少 2 个字的原因')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const updated =
        financialReview.mode === 'approve'
          ? await getDesktopApi().approveFinancialRefund({
              requestId: crypto.randomUUID(),
              financialRefundId: financialReview.refund.id,
              ...(reviewSpecial ? { specialOverride: true } : {}),
              ...(reviewReason.trim() ? { reason: reviewReason.trim() } : {})
            })
          : await getDesktopApi().rejectFinancialRefund({
              requestId: crypto.randomUUID(),
              financialRefundId: financialReview.refund.id,
              reason: reviewReason.trim()
            })
      setNotice(
        updated.status === 'completed'
          ? `${updated.requestNumber} 已完成，请按原渠道退现金 ${formatFen(
              updated.refundPrincipalFen
            )}`
          : `${updated.requestNumber} 已驳回`
      )
      setFinancialReview(null)
      setReviewReason('')
      setReviewSpecial(false)
      await loadFinancialRefunds()
    } catch (value) {
      setError(readableError(value))
    } finally {
      setBusy(false)
    }
  }

  async function exportEvidence(
    refund: RefundSummary,
    evidenceType: 'pdf' | 'excel'
  ): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().exportRefundEvidence({
        requestId: crypto.randomUUID(),
        refundId: refund.id,
        evidenceType
      })
      if (!result.canceled) {
        setNotice(`${refund.refundNumber} 凭证已保存到 ${result.filePath ?? ''}`)
        await loadRefunds()
      }
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
          <p className="eyebrow">原订单、原项目、原支付渠道</p>
          <h1>退款管理</h1>
        </div>
        <div className="release-tag">
          {canApprove ? '店长审批与直接退款' : '店员退款申请'}
        </div>
      </header>

      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <section className="refund-layout">
        <div className="refund-left">
          <form className="panel refund-search" onSubmit={(event) => void search(event)}>
            <div className="panel-heading">
              <div>
                <h2>查询原订单</h2>
                <p>输入完整订单号，退款窗口为订单完成后 720 小时</p>
              </div>
            </div>
            <div className="member-search">
              <label>
                <span>订单号</span>
                <input
                  required
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="例如 O20260611-XXXXXXXX"
                />
              </label>
              <button className="secondary-button" disabled={busy} type="submit">
                查询
              </button>
            </div>
          </form>

          {order ? (
            <section className="panel refundable-order">
              <div className="panel-heading">
                <div>
                  <h2>{order.orderNumber}</h2>
                  <p>
                    {order.paymentMethod === 'cash' ? '现金原路退回' : '退回原会员储值账户'}
                    {' · '}
                    最晚 {new Date(order.refundableUntil).toLocaleString('zh-CN')}
                  </p>
                </div>
                <strong>{formatFen(order.totalFen)}</strong>
              </div>
              {!order.withinRefundWindow ? (
                <div className="form-error">该订单已超过 720 小时退款窗口</div>
              ) : null}
              <div className="refundable-item-list">
                {order.items.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.itemName}</strong>
                      <span>
                        {item.itemType === 'product' ? '已交付商品' : '可按普通规则退款'}
                        {' · '}
                        单价 {formatFen(item.appliedUnitPriceFen)}
                      </span>
                    </div>
                    <div>
                      <small>原数量</small>
                      <strong>{item.quantity}</strong>
                    </div>
                    <div>
                      <small>审批中</small>
                      <strong>{item.pendingRefundQuantity}</strong>
                    </div>
                    <div>
                      <small>已退</small>
                      <strong>{item.completedRefundQuantity}</strong>
                    </div>
                    <label>
                      <span>本次退</span>
                      <input
                        type="number"
                        min={0}
                        max={item.refundableQuantity}
                        disabled={
                          !order.withinRefundWindow ||
                          item.refundableQuantity === 0 ||
                          item.appliedUnitPriceFen === 0
                        }
                        value={quantities[item.id] ?? 0}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [item.id]: Math.max(
                              0,
                              Math.min(
                                item.refundableQuantity,
                                Number(event.currentTarget.value)
                              )
                            )
                          }))
                        }
                      />
                    </label>
                  </article>
                ))}
              </div>
              <label>
                <span>退款原因（普通退款选填）</span>
                <textarea
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.currentTarget.value)}
                />
              </label>
              {canApprove ? (
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={specialProductOverride}
                    onChange={(event) =>
                      setSpecialProductOverride(event.currentTarget.checked)
                    }
                  />
                  <span>店长特殊退款：允许退款已交付商品（必须填写原因）</span>
                </label>
              ) : null}
              <div className="refund-submit-actions">
                <span>
                  本次预计退款{' '}
                  <strong>
                    {formatFen(
                      order.items.reduce(
                        (sum, item) =>
                          sum + (quantities[item.id] ?? 0) * item.appliedUnitPriceFen,
                        0
                      )
                    )}
                  </strong>
                </span>
                {!canApprove ? (
                  <button
                    className="primary-button"
                    disabled={busy || !order.withinRefundWindow}
                    type="button"
                    onClick={() => void submitRefund(false)}
                  >
                    提交退款申请
                  </button>
                ) : (
                  <>
                    <button
                      className="secondary-button"
                      disabled={busy || !order.withinRefundWindow}
                      type="button"
                      onClick={() => void submitRefund(false)}
                    >
                      仅提交申请
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy || !order.withinRefundWindow}
                      type="button"
                      onClick={() => void submitRefund(true)}
                    >
                      店长直接退款
                    </button>
                  </>
                )}
              </div>
            </section>
          ) : null}

          <section className="panel financial-refund-list">
            <div className="panel-heading">
              <div>
                <h2>月卡与充值退款</h2>
                <p>月卡限购买后 24 小时；充值按当前剩余本金重新核对。</p>
              </div>
            </div>
            {financialRefunds.length === 0 ? (
              <div className="empty-row">暂无月卡或充值退款记录</div>
            ) : null}
            {financialRefunds.map((refund) => (
              <article key={refund.id}>
                <div className="refund-list-head">
                  <div>
                    <strong>{refund.requestNumber}</strong>
                    <span>
                      {refund.memberNickname} · {refund.memberPhone}
                    </span>
                  </div>
                  <em className={`refund-status ${refund.status}`}>
                    {statusLabels[refund.status]}
                  </em>
                </div>
                <div className="financial-refund-facts">
                  <span>
                    {refund.targetType === 'monthly_card' ? '月卡退款' : '现金充值冲正'}
                  </span>
                  <strong>{formatFen(refund.refundPrincipalFen)}</strong>
                  {refund.reclaimGiftFen > 0 ? (
                    <small>同时收回赠送金 {formatFen(refund.reclaimGiftFen)}</small>
                  ) : null}
                </div>
                {refund.requiresSpecialOverride ? (
                  <p className="refund-warning">已使用月卡，必须由店长特殊审批并填写原因。</p>
                ) : null}
                {refund.requestReason ? <p>{refund.requestReason}</p> : null}
                {refund.status === 'pending' && canApprove ? (
                  <div className="row-actions">
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setFinancialReview({ refund, mode: 'reject' })
                        setReviewReason('')
                        setReviewSpecial(false)
                      }}
                    >
                      驳回
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setFinancialReview({ refund, mode: 'approve' })
                        setReviewReason(refund.requestReason ?? '')
                        setReviewSpecial(refund.requiresSpecialOverride)
                      }}
                    >
                      审批并退款
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        </div>

        <section className="panel refund-list">
          <div className="panel-heading">
            <div>
              <h2>退款记录</h2>
              <p>原订单不会被改写</p>
            </div>
          </div>
          {refunds.length === 0 ? <div className="empty-row">暂无退款记录</div> : null}
          {refunds.map((refund) => (
            <article key={refund.id}>
              <div className="refund-list-head">
                <div>
                  <strong>{refund.refundNumber}</strong>
                  <span>{refund.orderNumber}</span>
                </div>
                <em className={`refund-status ${refund.status}`}>
                  {statusLabels[refund.status]}
                </em>
              </div>
              <div className="refund-list-items">
                {refund.items.map((item) => (
                  <span key={item.id}>
                    {item.itemName} × {item.quantity}
                  </span>
                ))}
              </div>
              <div className="refund-list-total">
                <span>{refund.paymentMethod === 'cash' ? '现金' : '储值'}退款</span>
                <strong>{formatFen(refund.totalFen)}</strong>
              </div>
              {refund.requestReason ? <p>{refund.requestReason}</p> : null}
              {refund.status === 'pending' && canApprove ? (
                <div className="row-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setReview({ refund, mode: 'reject' })
                      setReviewReason('')
                      setReviewSpecial(false)
                    }}
                  >
                    驳回
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setReview({ refund, mode: 'approve' })
                      setReviewReason(refund.requestReason ?? '')
                      setReviewSpecial(false)
                    }}
                  >
                    审批并退款
                  </button>
                </div>
              ) : null}
              {refund.status === 'completed' && canApprove ? (
                <div className="row-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    type="button"
                    onClick={() => void exportEvidence(refund, 'pdf')}
                  >
                    导出 PDF
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    type="button"
                    onClick={() => void exportEvidence(refund, 'excel')}
                  >
                    导出 Excel
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </section>

      {review ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal-card"
            onSubmit={(event) => {
              event.preventDefault()
              void reviewRefund()
            }}
          >
            <div className="form-heading">
              <span>{review.refund.refundNumber}</span>
              <h2>{review.mode === 'approve' ? '审批并执行退款' : '驳回退款申请'}</h2>
              <p>金额 {formatFen(review.refund.totalFen)}，支付渠道不可更改。</p>
            </div>
            <label>
              <span>{review.mode === 'approve' ? '审批说明' : '驳回原因'}</span>
              <textarea
                required={review.mode === 'reject' || reviewSpecial}
                minLength={review.mode === 'reject' || reviewSpecial ? 2 : undefined}
                maxLength={500}
                value={reviewReason}
                onChange={(event) => setReviewReason(event.currentTarget.value)}
              />
            </label>
            {review.mode === 'approve' &&
            review.refund.items.some((item) => item.itemType === 'product') ? (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={reviewSpecial}
                  onChange={(event) => setReviewSpecial(event.currentTarget.checked)}
                />
                <span>允许已交付商品特殊退款</span>
              </label>
            ) : null}
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setReview(null)}>
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                确认
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {financialReview ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="modal-card"
            onSubmit={(event) => {
              event.preventDefault()
              void reviewFinancialRefund()
            }}
          >
            <div className="form-heading">
              <span>{financialReview.refund.requestNumber}</span>
              <h2>
                {financialReview.mode === 'approve'
                  ? '审批并执行退款'
                  : '驳回退款申请'}
              </h2>
              <p>
                {financialReview.refund.memberNickname} ·{' '}
                {financialReview.refund.memberPhone}，应退现金{' '}
                {formatFen(financialReview.refund.refundPrincipalFen)}。
              </p>
            </div>
            <label>
              <span>
                {financialReview.mode === 'approve' ? '审批说明' : '驳回原因'}
              </span>
              <textarea
                required={
                  financialReview.mode === 'reject' ||
                  financialReview.refund.requiresSpecialOverride
                }
                minLength={
                  financialReview.mode === 'reject' ||
                  financialReview.refund.requiresSpecialOverride
                    ? 2
                    : undefined
                }
                maxLength={500}
                value={reviewReason}
                onChange={(event) => setReviewReason(event.currentTarget.value)}
              />
            </label>
            {financialReview.mode === 'approve' &&
            financialReview.refund.requiresSpecialOverride ? (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={reviewSpecial}
                  onChange={(event) => setReviewSpecial(event.currentTarget.checked)}
                />
                <span>确认在 24 小时内对已使用月卡执行店长特殊退款</span>
              </label>
            ) : null}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setFinancialReview(null)}
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
