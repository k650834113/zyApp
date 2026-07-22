import { useState, type FormEvent } from 'react'
import type {
  LegacyFinancialHistorySummary,
  MemberSummary,
  RechargeGiftTierSummary,
  SessionUser,
  WalletDetails,
  WalletLedgerEntry,
  WalletRechargeSummary
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

function yuanToFen(value: string): number {
  const normalized = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('金额格式不正确，最多保留两位小数')
  }
  const [yuanPart = '0', decimalPart = ''] = normalized.split('.')
  const result = Number(yuanPart) * 100 + Number(decimalPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error('金额必须大于 0')
  }
  return result
}

function yuanToNonNegativeFen(value: string): number {
  const normalized = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('金额格式不正确，最多保留两位小数')
  }
  const [yuanPart = '0', decimalPart = ''] = normalized.split('.')
  const result = Number(yuanPart) * 100 + Number(decimalPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('金额不能小于 0')
  }
  return result
}

function formatFen(value: number): string {
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  return `${sign}¥${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

function calculateGiftPreview(
  principalFen: number,
  tiers: RechargeGiftTierSummary[]
): number {
  const active = tiers
    .filter((tier) => tier.active)
    .sort((left, right) => left.principalFen - right.principalFen)
  const highest = active.at(-1)
  if (!highest) return 0
  let remainder = principalFen
  let giftFen = 0
  if (remainder >= highest.principalFen) {
    const count = Math.floor(remainder / highest.principalFen)
    giftFen += count * highest.giftFen
    remainder -= count * highest.principalFen
  }
  const remainderTier = active
    .filter((tier) => tier.principalFen <= remainder)
    .sort(
      (left, right) =>
        right.giftFen - left.giftFen || right.principalFen - left.principalFen
    )[0]
  return giftFen + (remainderTier?.giftFen ?? 0)
}

function ledgerName(entry: WalletLedgerEntry): string {
  switch (entry.entryType) {
    case 'cash_recharge':
      return '现金充值'
    case 'wechat_recharge':
      return '微信充值'
    case 'consumption_debit':
      return '储值扣款'
    case 'cash_recharge_reversal':
      return '充值冲正'
    case 'order_refund_credit':
      return '订单退款'
    case 'manual_adjustment':
      return '人工调整'
    case 'legacy_opening':
      return '旧库期初'
  }
}

function legacyHistoryName(entry: LegacyFinancialHistorySummary): string {
  if (entry.sourceTable === 'activity_logs') return `旧系统操作：${entry.eventType}`
  if (entry.eventType === 'top-up') return '旧系统充值'
  if (entry.eventType === 'deduction') return '旧系统扣款'
  return `旧系统交易：${entry.eventType}`
}

function legacyHistoryAmount(entry: LegacyFinancialHistorySummary): number | null {
  if (entry.amountFen === null) return null
  return entry.eventType === 'deduction' ? -entry.amountFen : entry.amountFen
}

export function WalletPage({ session }: { session: SessionUser }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<MemberSummary[]>([])
  const [selectedMember, setSelectedMember] = useState<MemberSummary | null>(null)
  const [details, setDetails] = useState<WalletDetails | null>(null)
  const [rechargeYuan, setRechargeYuan] = useState('500')
  const [rechargeReason, setRechargeReason] = useState('')
  const [debitYuan, setDebitYuan] = useState('')
  const [debitReason, setDebitReason] = useState('')
  const [reversal, setReversal] = useState<WalletRechargeSummary | null>(null)
  const [reversalReason, setReversalReason] = useState('')
  const [tierEditor, setTierEditor] = useState<
    Array<{ principalYuan: string; giftYuan: string }> | null
  >(null)
  const [tierReason, setTierReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canApprove = session.permissions.includes('refund.approve')

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    try {
      setMembers(await getDesktopApi().searchMembers({ query, limit: 20 }))
    } catch (reason) {
      setError(readableError(reason))
    }
  }

  async function selectMember(member: MemberSummary): Promise<void> {
    setError(null)
    setNotice(null)
    try {
      const nextDetails = await getDesktopApi().getWalletDetails({ memberId: member.id })
      setSelectedMember(member)
      setDetails(nextDetails)
      setMembers([])
    } catch (reason) {
      setError(readableError(reason))
    }
  }

  async function refresh(): Promise<void> {
    if (!selectedMember) return
    setDetails(await getDesktopApi().getWalletDetails({ memberId: selectedMember.id }))
  }

  async function submitRecharge(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selectedMember || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const principalFen = yuanToFen(rechargeYuan)
      const result = await getDesktopApi().cashRecharge({
        requestId: crypto.randomUUID(),
        memberId: selectedMember.id,
        principalFen,
        ...(rechargeReason.trim() ? { reason: rechargeReason.trim() } : {})
      })
      setNotice(
        `现金充值 ${formatFen(principalFen)} 成功，赠送 ${formatFen(
          result.giftDeltaFen
        )}`
      )
      setRechargeReason('')
      await refresh()
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setBusy(false)
    }
  }

  async function submitDebit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!selectedMember || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const amountFen = yuanToFen(debitYuan)
      const result = await getDesktopApi().debitWallet({
        requestId: crypto.randomUUID(),
        memberId: selectedMember.id,
        amountFen,
        reason: debitReason
      })
      setNotice(
        `扣款 ${formatFen(amountFen)} 成功，当前余额 ${formatFen(
          result.wallet.totalBalanceFen
        )}`
      )
      setDebitYuan('')
      setDebitReason('')
      await refresh()
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setBusy(false)
    }
  }

  async function submitReversal(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!reversal || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = canApprove
        ? await getDesktopApi().directFinancialRefund({
            requestId: crypto.randomUUID(),
            targetType: 'cash_recharge',
            targetId: reversal.id,
            ...(reversalReason.trim() ? { reason: reversalReason.trim() } : {})
          })
        : await getDesktopApi().createFinancialRefundRequest({
            requestId: crypto.randomUUID(),
            targetType: 'cash_recharge',
            targetId: reversal.id,
            ...(reversalReason.trim() ? { reason: reversalReason.trim() } : {})
          })
      setNotice(
        result.status === 'completed'
          ? `充值已冲正，应退现金 ${formatFen(result.refundPrincipalFen)}`
          : `${result.requestNumber} 已提交店长审批，应退剩余本金 ${formatFen(
              result.refundPrincipalFen
            )}`
      )
      setReversal(null)
      setReversalReason('')
      await refresh()
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setBusy(false)
    }
  }

  async function submitGiftTiers(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!tierEditor || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const tiers = tierEditor.map((tier) => ({
        principalFen: yuanToFen(tier.principalYuan),
        giftFen: yuanToNonNegativeFen(tier.giftYuan)
      }))
      await getDesktopApi().updateRechargeGiftTiers({ tiers, reason: tierReason })
      setNotice('充值赠送档位已更新，之后的充值立即使用新规则')
      setTierEditor(null)
      setTierReason('')
      await refresh()
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setBusy(false)
    }
  }

  let giftPreview = 0
  try {
    giftPreview =
      details === null
        ? 0
        : calculateGiftPreview(yuanToFen(rechargeYuan), details.giftTiers)
  } catch {
    giftPreview = 0
  }
  const rechargeAllowed =
    selectedMember?.ageGate !== 'recharge_disabled'

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">本金与赠送金分账</p>
          <h1>储值账户</h1>
        </div>
        <div className="release-tag">指定收银 PC 离线可用</div>
      </header>

      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <form className="wallet-member-search panel" onSubmit={(event) => void search(event)}>
        <label>
          <span>先查询会员</span>
          <input
            required
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="手机号、会员号或昵称"
          />
        </label>
        <button className="primary-button" type="submit">查询</button>
      </form>

      {members.length > 0 ? (
        <section className="member-search-results panel">
          {members.map((member) => (
            <button type="button" key={member.id} onClick={() => void selectMember(member)}>
              <strong>{member.nickname}</strong>
              <span>{member.phone} · {member.memberNumber}</span>
              <em>{member.tier === 'advanced' ? '高级会员' : '普通会员'}</em>
            </button>
          ))}
        </section>
      ) : null}

      {selectedMember && details ? (
        <>
          <section className="wallet-summary">
            <article className="wallet-member-card">
              <span>当前会员</span>
              <h2>{selectedMember.nickname}</h2>
              <p>{selectedMember.phone} · {selectedMember.memberNumber}</p>
            </article>
            <article>
              <span>本金余额</span>
              <strong>{formatFen(details.wallet.principalBalanceFen)}</strong>
            </article>
            <article>
              <span>赠送余额</span>
              <strong>{formatFen(details.wallet.giftBalanceFen)}</strong>
            </article>
            <article className="total">
              <span>可用合计</span>
              <strong>{formatFen(details.wallet.totalBalanceFen)}</strong>
            </article>
          </section>

          <section className="wallet-action-grid">
            <form className="panel" onSubmit={(event) => void submitRecharge(event)}>
              <div className="panel-heading">
                <div>
                  <h2>现金充值</h2>
                  <p>赠送规则按本次有效档位自动计算并保存快照。</p>
                </div>
                {session.role === 'manager' ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setTierEditor(
                        details.giftTiers
                          .filter((tier) => tier.active)
                          .map((tier) => ({
                            principalYuan: String(tier.principalFen / 100),
                            giftYuan: String(tier.giftFen / 100)
                          }))
                      )
                    }
                  >
                    设置赠送档位
                  </button>
                ) : null}
              </div>
              {!rechargeAllowed ? (
                <p className="member-age-warning">
                  该会员未完成年龄确认或监护人核验，当前禁止储值充值。
                </p>
              ) : null}
              <div className="quick-amounts">
                {[100, 300, 500, 1000].map((amount) => (
                  <button
                    type="button"
                    key={amount}
                    onClick={() => setRechargeYuan(String(amount))}
                  >
                    {amount} 元
                  </button>
                ))}
              </div>
              <label>
                <span>实收现金（元）</span>
                <input
                  required
                  inputMode="decimal"
                  value={rechargeYuan}
                  onChange={(event) => setRechargeYuan(event.currentTarget.value)}
                />
              </label>
              <div className="gift-preview">
                本次预计赠送 <strong>{formatFen(giftPreview)}</strong>
              </div>
              <label>
                <span>备注（选填）</span>
                <input
                  maxLength={200}
                  value={rechargeReason}
                  onChange={(event) => setRechargeReason(event.currentTarget.value)}
                />
              </label>
              <button
                className="primary-button full"
                disabled={busy || !rechargeAllowed}
                type="submit"
              >
                确认已收现金并充值
              </button>
            </form>

            <form className="panel" onSubmit={(event) => void submitDebit(event)}>
              <div className="panel-heading">
                <div>
                  <h2>储值扣款</h2>
                  <p>赠送余额优先；总余额不足时整笔失败。</p>
                </div>
              </div>
              <label>
                <span>扣款金额（元）</span>
                <input
                  required
                  inputMode="decimal"
                  value={debitYuan}
                  onChange={(event) => setDebitYuan(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>扣款原因</span>
                <textarea
                  required
                  minLength={2}
                  maxLength={200}
                  value={debitReason}
                  onChange={(event) => setDebitReason(event.currentTarget.value)}
                  placeholder="例如：前台零食饮料消费"
                />
              </label>
              <button className="primary-button full" disabled={busy} type="submit">
                确认扣款
              </button>
            </form>
          </section>

          <section className="wallet-history-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>储值流水</h2>
                  <p>原记录不可删除，冲正会生成新的反向流水。</p>
                </div>
              </div>
              <div className="wallet-ledger">
                {details.ledger.length === 0 ? (
                  <div className="empty-row">暂无储值流水</div>
                ) : null}
                {details.ledger.map((entry) => (
                  <div className="wallet-ledger-row" key={entry.id}>
                    <div>
                      <strong>{ledgerName(entry)}</strong>
                      <small>{new Date(entry.occurredAt).toLocaleString('zh-CN')}</small>
                    </div>
                    <span>{entry.reason}</span>
                    <div className="ledger-amounts">
                      <em>{formatFen(entry.principalDeltaFen)} 本金</em>
                      <em>{formatFen(entry.giftDeltaFen)} 赠送</em>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>现金充值冲正</h2>
                  <p>
                    {canApprove
                      ? '店长可直接退还剩余本金，并收回尚未消费的赠送金。'
                      : '店员提交申请，店长审批后才会生成反向流水。'}
                  </p>
                </div>
              </div>
              <div className="recharge-list">
                {details.recharges.map((recharge) => (
                  <div key={recharge.id}>
                    <span>
                      {formatFen(recharge.principalFen)} + 赠送 {formatFen(recharge.giftFen)}
                    </span>
                    <small>
                      剩余本金 {formatFen(recharge.remainingPrincipalFen)}
                    </small>
                    <button
                      className="text-button"
                      disabled={
                        recharge.status === 'reversed' ||
                        recharge.remainingPrincipalFen <= 0
                      }
                      type="button"
                      onClick={() => setReversal(recharge)}
                    >
                      {recharge.status === 'reversed'
                        ? '已冲正'
                        : canApprove
                          ? '直接冲正'
                          : '申请冲正'}
                    </button>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel legacy-wallet-history">
              <div className="panel-heading">
                <div>
                  <h2>旧系统历史</h2>
                  <p>仅用于查询和核对，不会再次改变当前余额。</p>
                </div>
              </div>
              <div className="wallet-ledger">
                {details.legacyHistory.length === 0 ? (
                  <div className="empty-row">暂无旧系统历史</div>
                ) : null}
                {details.legacyHistory.map((entry) => {
                  const amount = legacyHistoryAmount(entry)
                  return (
                    <div className="wallet-ledger-row" key={entry.id}>
                      <div>
                        <strong>{legacyHistoryName(entry)}</strong>
                        <small>
                          {entry.occurredAtNormalized
                            ? new Date(entry.occurredAtNormalized).toLocaleString('zh-CN')
                            : entry.occurredAtRaw ?? '时间未知'}
                        </small>
                      </div>
                      <span>{entry.description ?? '无备注'}</span>
                      <div className="ledger-amounts">
                        <em>{amount === null ? '无金额' : formatFen(amount)}</em>
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>
          </section>
        </>
      ) : (
        <div className="wallet-empty">
          <strong>请选择会员后操作储值</strong>
          <span>现金充值和扣款都会记录当前员工、设备、时间与原因。</span>
        </div>
      )}

      {reversal ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={(event) => void submitReversal(event)}>
            <div className="form-heading">
              <span>{canApprove ? '店长直接处理' : '提交店长审批'}</span>
              <h2>冲正现金充值</h2>
              <p>
                应退剩余本金 {formatFen(reversal.remainingPrincipalFen)}，同时收回未消费赠送
                {formatFen(reversal.remainingGiftFen)}。
              </p>
            </div>
            <label>
              <span>冲正原因（选填）</span>
              <textarea
                autoFocus
                maxLength={200}
                value={reversalReason}
                onChange={(event) => setReversalReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setReversal(null)}>
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                {canApprove ? '确认冲正' : '提交申请'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {tierEditor ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card tier-modal" onSubmit={(event) => void submitGiftTiers(event)}>
            <div className="form-heading">
              <span>店长配置</span>
              <h2>充值赠送档位</h2>
              <p>达到最高档后可重复最高档，余数再命中至多一个可用档位。</p>
            </div>
            <div className="tier-editor">
              {tierEditor.map((tier, index) => (
                <div key={index}>
                  <label>
                    <span>充值本金（元）</span>
                    <input
                      required
                      inputMode="decimal"
                      value={tier.principalYuan}
                      onChange={(event) => {
                        const principalYuan = event.currentTarget.value
                        setTierEditor((current) =>
                          current?.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, principalYuan }
                              : item
                          ) ?? null
                        )
                      }}
                    />
                  </label>
                  <label>
                    <span>赠送（元）</span>
                    <input
                      required
                      inputMode="decimal"
                      value={tier.giftYuan}
                      onChange={(event) => {
                        const giftYuan = event.currentTarget.value
                        setTierEditor((current) =>
                          current?.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, giftYuan }
                              : item
                          ) ?? null
                        )
                      }}
                    />
                  </label>
                  <button
                    className="text-button danger-text"
                    type="button"
                    onClick={() =>
                      setTierEditor((current) =>
                        current?.filter((_item, itemIndex) => itemIndex !== index) ?? null
                      )
                    }
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <button
              className="secondary-button full tier-add"
              type="button"
              onClick={() =>
                setTierEditor((current) => [
                  ...(current ?? []),
                  { principalYuan: '', giftYuan: '' }
                ])
              }
            >
              新增档位
            </button>
            <label>
              <span>修改原因</span>
              <textarea
                required
                minLength={2}
                maxLength={200}
                value={tierReason}
                onChange={(event) => setTierReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setTierEditor(null)}
              >
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                保存档位
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
