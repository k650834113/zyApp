import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  CashierMemberOption,
  CatalogItemSummary,
  MonthlyCardDetails,
  OrderPaymentMethod,
  OrderPricingTier,
  RechargeGiftTierSummary,
  SalesOrderSummary,
  SessionUser,
  WalletDetails
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type CatalogCartLine = {
  kind: 'catalog'
  id: string
  item: CatalogItemSummary
  quantity: number
  pricingTier: OrderPricingTier
  personalAdmissionBenefit: boolean
}

type CustomCartLine = {
  kind: 'custom'
  id: string
  name: string
  unitPriceFen: number
  quantity: number
}

type CartLine = CatalogCartLine | CustomCartLine

const benefitLabels = {
  none: '正常计费',
  birthday: '生日免费',
  monthly_card: '月卡免费',
  repeat_admission: '当天再次入场免费'
} as const

function formatFen(value: number): string {
  return `¥${(value / 100).toFixed(2)}`
}

function yuanToFen(value: string): number {
  const normalized = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('金额格式不正确，最多保留两位小数')
  }
  const [yuan = '0', decimal = ''] = normalized.split('.')
  const fen = Number(yuan) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(fen) || fen <= 0) {
    throw new Error('金额必须大于 0')
  }
  return fen
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

function cashierError(reason: unknown): string {
  const message = readableError(reason)
  return /Wallet balance is insufficient|储值余额不足/i.test(message)
    ? '用户余额不足'
    : message
}

function expectedLineTotal(line: CartLine): number {
  if (line.kind === 'custom') return line.unitPriceFen * line.quantity
  const unitPrice =
    line.pricingTier === 'advanced'
      ? line.item.advancedPriceFen
      : line.item.regularPriceFen
  return unitPrice * line.quantity
}

function birthdayText(member: CashierMemberOption): string {
  return member.birthdayMonth === null || member.birthdayDay === null
    ? '未登记'
    : `${member.birthdayMonth} 月 ${member.birthdayDay} 日`
}

function monthlyCardText(details: MonthlyCardDetails | null): string {
  const card = details?.current
  if (!card) return '无有效月卡'
  if (card.status === 'paused') return '已暂停'
  return `有效至 ${new Date(card.expiresAt).toLocaleDateString('zh-CN')}`
}

function orderMemberLabel(
  order: SalesOrderSummary,
  members: CashierMemberOption[]
): string {
  const memberId = order.walletMemberId ?? order.customerMemberId
  const nickname =
    order.memberNickname ??
    members.find((member) => member.id === memberId)?.nickname ??
    null
  if (nickname) return `会员：${nickname}`
  return order.paymentMethod === 'cash' ? '现金订单' : '会员储值订单'
}

export function CashierPage({ session }: { session: SessionUser }): React.JSX.Element {
  const [catalog, setCatalog] = useState<CatalogItemSummary[]>([])
  const [orders, setOrders] = useState<SalesOrderSummary[]>([])
  const [members, setMembers] = useState<CashierMemberOption[]>([])
  const [memberQuery, setMemberQuery] = useState('')
  const [selectedMember, setSelectedMember] = useState<CashierMemberOption | null>(null)
  const [walletDetails, setWalletDetails] = useState<WalletDetails | null>(null)
  const [monthlyCard, setMonthlyCard] = useState<MonthlyCardDetails | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [customOpen, setCustomOpen] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [memberAction, setMemberAction] = useState<'recharge' | 'monthly' | null>(
    null
  )
  const [rechargeYuan, setRechargeYuan] = useState('500')
  const [rechargeReason, setRechargeReason] = useState('')
  const [monthlyReason, setMonthlyReason] = useState('顾客线下申请')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const filteredMembers = useMemo(() => {
    const normalized = memberQuery.trim().toLowerCase()
    if (!normalized) return members
    return members.filter((member) =>
      [member.nickname, member.phone, member.memberNumber].some((value) =>
        value.toLowerCase().includes(normalized)
      )
    )
  }, [memberQuery, members])

  const expectedTotalFen = useMemo(
    () => cart.reduce((sum, line) => sum + expectedLineTotal(line), 0),
    [cart]
  )

  const rechargeGiftPreviewFen = useMemo(() => {
    if (!walletDetails) return 0
    try {
      return calculateGiftPreview(
        yuanToFen(rechargeYuan),
        walletDetails.giftTiers
      )
    } catch {
      return 0
    }
  }, [rechargeYuan, walletDetails])

  async function selectMember(member: CashierMemberOption): Promise<void> {
    setSelectedMember(member)
    setPaymentMethod('stored_value')
    setError(null)
    try {
      const [wallet, card] = await Promise.all([
        getDesktopApi().getWalletDetails({ memberId: member.id }),
        getDesktopApi().getMonthlyCardDetails({ memberId: member.id })
      ])
      setWalletDetails(wallet)
      setMonthlyCard(card)
    } catch (reason) {
      setWalletDetails(null)
      setMonthlyCard(null)
      setError(cashierError(reason))
    }
  }

  async function refreshSelectedMember(memberId: string): Promise<void> {
    const [wallet, card, memberOptions] = await Promise.all([
      getDesktopApi().getWalletDetails({ memberId }),
      getDesktopApi().getMonthlyCardDetails({ memberId }),
      getDesktopApi().listCashierMembers()
    ])
    setWalletDetails(wallet)
    setMonthlyCard(card)
    setMembers(memberOptions)
    setSelectedMember(
      memberOptions.find((member) => member.id === memberId) ?? null
    )
  }

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const [catalogItems, recentOrders, memberOptions] = await Promise.all([
        getDesktopApi().listCatalogItems(),
        getDesktopApi().listRecentOrders({ limit: 20 }),
        getDesktopApi().listCashierMembers()
      ])
      setCatalog(catalogItems)
      setOrders(recentOrders)
      setMembers(memberOptions)
      setError(null)
      const firstMember = memberOptions[0]
      if (firstMember) await selectMember(firstMember)
    } catch (reason) {
      setError(cashierError(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!error) return

    const timeoutId = window.setTimeout(() => {
      setError(null)
    }, 10_000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [error])

  function clearMember(): void {
    setSelectedMember(null)
    setWalletDetails(null)
    setMonthlyCard(null)
    setPaymentMethod('cash')
    setMemberAction(null)
    setCart((current) =>
      current.filter(
        (line) => line.kind !== 'catalog' || !line.personalAdmissionBenefit
      )
    )
  }

  function addCatalogItem(
    item: CatalogItemSummary,
    personalAdmissionBenefit = false
  ): void {
    const pricingTier: OrderPricingTier =
      selectedMember?.tier === 'advanced' ? 'advanced' : 'regular'
    if (personalAdmissionBenefit) {
      setCart((current) => [
        ...current.filter(
          (line) => line.kind !== 'catalog' || !line.personalAdmissionBenefit
        ),
        {
          kind: 'catalog',
          id: crypto.randomUUID(),
          item,
          quantity: 1,
          pricingTier,
          personalAdmissionBenefit: true
        }
      ])
      return
    }
    setCart((current) => {
      const existing = current.find(
        (line) =>
          line.kind === 'catalog' &&
          !line.personalAdmissionBenefit &&
          line.item.id === item.id &&
          line.pricingTier === pricingTier
      )
      if (!existing) {
        return [
          ...current,
          {
            kind: 'catalog',
            id: crypto.randomUUID(),
            item,
            quantity: 1,
            pricingTier,
            personalAdmissionBenefit: false
          }
        ]
      }
      return current.map((line) =>
        line.id === existing.id
          ? { ...line, quantity: Math.min(999, line.quantity + 1) }
          : line
      )
    })
  }

  function submitCustomCollection(event: FormEvent): void {
    event.preventDefault()
    try {
      const unitPriceFen = yuanToFen(customAmount)
      const name = customName.trim()
      if (name.length < 1) throw new Error('请填写自定义收款名称')
      setCart((current) => [
        ...current,
        {
          kind: 'custom',
          id: crypto.randomUUID(),
          name,
          unitPriceFen,
          quantity: 1
        }
      ])
      setCustomOpen(false)
      setCustomName('')
      setCustomAmount('')
      setError(null)
    } catch (reason) {
      setError(cashierError(reason))
    }
  }

  function updateLineQuantity(id: string, quantity: number): void {
    setCart((current) =>
      current.map((line) =>
        line.id === id
          ? { ...line, quantity: Math.max(1, Math.min(999, quantity)) }
          : line
      )
    )
  }

  async function completeOrder(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy || cart.length === 0) return
    if (paymentMethod === 'stored_value' && !selectedMember) {
      setError('储值支付需要先选择付款会员')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const order = await getDesktopApi().createSalesOrder({
        requestId: crypto.randomUUID(),
        ...(selectedMember ? { customerMemberId: selectedMember.id } : {}),
        paymentMethod,
        ...(paymentMethod === 'stored_value' && selectedMember
          ? { walletMemberId: selectedMember.id }
          : {}),
        lines: cart.map((line) =>
          line.kind === 'custom'
            ? {
                customName: line.name,
                customUnitPriceFen: line.unitPriceFen,
                quantity: line.quantity,
                pricingTier: 'regular'
              }
            : {
                catalogItemId: line.item.id,
                quantity: line.quantity,
                pricingTier: line.pricingTier,
                ...(line.personalAdmissionBenefit
                  ? { personalAdmissionBenefit: true }
                  : {})
              }
        ),
        ...(note.trim() ? { note: note.trim() } : {})
      })
      setOrders((current) => [order, ...current].slice(0, 20))
      setCart([])
      setNote('')
      setNotice(
        `${order.orderNumber} 已完成，实收 ${formatFen(order.totalFen)}`
      )
      if (selectedMember) {
        await refreshSelectedMember(selectedMember.id)
      } else {
        setMembers(await getDesktopApi().listCashierMembers())
      }
    } catch (reason) {
      setError(cashierError(reason))
    } finally {
      setBusy(false)
    }
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
      await refreshSelectedMember(selectedMember.id)
      setRechargeReason('')
      setMemberAction(null)
      setNotice(
        `${selectedMember.nickname} 充值 ${formatFen(principalFen)} 成功，赠送 ${formatFen(
          result.giftDeltaFen
        )}`
      )
    } catch (reason) {
      setError(cashierError(reason))
    } finally {
      setBusy(false)
    }
  }

  async function purchaseMonthlyCard(): Promise<void> {
    if (!selectedMember || !monthlyCard || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await getDesktopApi().purchaseMonthlyCard({
        requestId: crypto.randomUUID(),
        memberId: selectedMember.id,
        reason: '前台现金购买月卡'
      })
      await refreshSelectedMember(selectedMember.id)
      setMemberAction(null)
      setNotice(
        `${selectedMember.nickname} 月卡已开通，请收现金 ${formatFen(
          monthlyCard.plan.priceFen
        )}`
      )
    } catch (reason) {
      setError(cashierError(reason))
    } finally {
      setBusy(false)
    }
  }

  async function changeMonthlyCardStatus(): Promise<void> {
    const card = monthlyCard?.current
    if (!selectedMember || !card || busy) return
    if (monthlyReason.trim().length < 2) {
      setError('月卡操作原因至少填写 2 个字')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const request = {
        requestId: crypto.randomUUID(),
        cardId: card.id,
        reason: monthlyReason.trim()
      }
      if (card.status === 'active') {
        await getDesktopApi().pauseMonthlyCard(request)
      } else if (card.status === 'paused') {
        await getDesktopApi().resumeMonthlyCard(request)
      } else {
        throw new Error('当前月卡不能执行暂停或恢复')
      }
      await refreshSelectedMember(selectedMember.id)
      setMemberAction(null)
      setNotice(
        card.status === 'active'
          ? `${selectedMember.nickname} 的月卡已暂停`
          : `${selectedMember.nickname} 的月卡已恢复并顺延`
      )
    } catch (reason) {
      setError(cashierError(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">会员列表与快捷收费</p>
          <h1>前台收银</h1>
        </div>
        <span className="release-tag">每张消费单独立结算</span>
      </header>
      {error ? (
        <div className="viewport-toast error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭错误提示" type="button" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      ) : null}
      {notice && !error ? (
        <div className="viewport-toast success" role="status">
          <span>{notice}</span>
          <button aria-label="关闭成功提示" type="button" onClick={() => setNotice(null)}>
            关闭
          </button>
        </div>
      ) : null}

      <section className="cashier-workbench">
        <aside className="panel cashier-member-pane">
          <div className="panel-heading">
            <div>
              <h2>会员列表</h2>
              <p>最近活跃会员默认靠前</p>
            </div>
            <button className="text-button" type="button" onClick={clearMember}>
              散客收银
            </button>
          </div>
          <label>
            <span>搜索会员</span>
            <input
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.currentTarget.value)}
              placeholder="手机号、会员号或昵称"
            />
          </label>
          <div className="cashier-member-list">
            {loading ? <div className="empty-row">正在读取会员...</div> : null}
            {!loading && filteredMembers.length === 0 ? (
              <div className="empty-row">没有找到会员</div>
            ) : null}
            {filteredMembers.map((member, index) => (
              <button
                className={selectedMember?.id === member.id ? 'active' : ''}
                key={member.id}
                type="button"
                onClick={() => void selectMember(member)}
              >
                <span>
                  <strong>{member.nickname}</strong>
                  <small>{member.phone}</small>
                </span>
                <em>{index < 10 && member.lastActiveAt ? '近期' : ''}</em>
              </button>
            ))}
          </div>
        </aside>

        <div className="cashier-detail-column">
          <form className="panel cashier-order-panel" onSubmit={(event) => void completeOrder(event)}>
            <div className="panel-heading">
              <div>
                <h2>本张消费单</h2>
                <p>每次确认收款都会形成一张独立消费单</p>
              </div>
              <span>{cart.length} 项</span>
            </div>
            <div className="cashier-member-inline">
              <div className="cashier-member-identity">
                <strong>{selectedMember ? selectedMember.nickname : '散客收银'}</strong>
                <span>
                  {selectedMember
                    ? `${selectedMember.phone} · ${selectedMember.memberNumber}`
                    : '本张消费单不关联会员资料'}
                </span>
                {selectedMember?.ageGate === 'recharge_disabled' ? (
                  <small className="member-age-warning">
                    未完成监护人核验，禁止储值充值
                  </small>
                ) : null}
              </div>
              {selectedMember ? (
                <>
                  <span className={`tier-pill ${selectedMember.tier}`}>
                    {selectedMember.tier === 'advanced' ? '高级会员' : '普通会员'}
                  </span>
                  <div className="cashier-inline-fact">
                    <span>储值</span>
                    <strong>
                      {walletDetails
                        ? formatFen(walletDetails.wallet.totalBalanceFen)
                        : '读取中'}
                    </strong>
                  </div>
                  <div className="cashier-inline-fact">
                    <span>月卡</span>
                    <strong>{monthlyCardText(monthlyCard)}</strong>
                  </div>
                  <div className="cashier-inline-fact">
                    <span>生日</span>
                    <strong>{birthdayText(selectedMember)}</strong>
                  </div>
                  <div className="cashier-member-actions">
                    {session.permissions.includes('wallet.recharge.cash') ? (
                      <button
                        className="secondary-button"
                        disabled={!walletDetails}
                        type="button"
                        onClick={() => setMemberAction('recharge')}
                      >
                        充值
                      </button>
                    ) : null}
                    {session.permissions.includes('monthly-card.manage') ? (
                      <button
                        className="secondary-button"
                        disabled={!monthlyCard}
                        type="button"
                        onClick={() => setMemberAction('monthly')}
                      >
                        月卡
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
            <div className="cart-lines">
              {cart.length === 0 ? (
                <div className="empty-row">从下方快捷收费区加入项目</div>
              ) : null}
              {cart.map((line) => (
                <div className="cart-line" key={line.id}>
                  <div className="cart-line-title">
                    <strong>{line.kind === 'custom' ? line.name : line.item.name}</strong>
                    <span>
                      {line.kind === 'custom'
                        ? `自定义收款 · 单价 ${formatFen(line.unitPriceFen)}`
                        : line.personalAdmissionBenefit
                          ? '本人权益，结账时自动判断生日、月卡或再次入场'
                          : '收费目录项目'}
                    </span>
                  </div>
                  {line.kind === 'catalog' ? (
                    <label>
                      <span>计价</span>
                      <select
                        disabled={line.personalAdmissionBenefit}
                        value={line.pricingTier}
                        onChange={(event) =>
                          setCart((current) =>
                            current.map((item) =>
                              item.id === line.id && item.kind === 'catalog'
                                ? {
                                    ...item,
                                    pricingTier: event.currentTarget
                                      .value as OrderPricingTier
                                  }
                                : item
                            )
                          )
                        }
                      >
                        <option value="regular">普通价</option>
                        <option value="advanced">高级会员价</option>
                      </select>
                    </label>
                  ) : (
                    <span className="custom-line-label">固定金额</span>
                  )}
                  <label>
                    <span>数量</span>
                    <input
                      disabled={
                        line.kind === 'catalog' && line.personalAdmissionBenefit
                      }
                      type="number"
                      min={1}
                      max={999}
                      value={line.quantity}
                      onChange={(event) =>
                        updateLineQuantity(line.id, Number(event.currentTarget.value))
                      }
                    />
                  </label>
                  <strong>{formatFen(expectedLineTotal(line))}</strong>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setCart((current) =>
                        current.filter((item) => item.id !== line.id)
                      )
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
            <div className="cashier-payment">
              <label>
                <span>支付方式</span>
                <select
                  value={paymentMethod}
                  onChange={(event) =>
                    setPaymentMethod(event.currentTarget.value as OrderPaymentMethod)
                  }
                >
                  <option value="cash">现金</option>
                  <option value="stored_value" disabled={!selectedMember}>
                    会员储值
                  </option>
                </select>
              </label>
              <label>
                <span>订单备注（选填）</span>
                <textarea
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.currentTarget.value)}
                />
              </label>
            </div>
            <div className="cashier-total">
              <div>
                <span>预计应收</span>
                <strong>{formatFen(expectedTotalFen)}</strong>
                <small>本人入场权益以结账后的实收金额为准</small>
              </div>
              <button
                className="primary-button"
                disabled={busy || cart.length === 0}
                type="submit"
              >
                {busy ? '正在结账...' : '确认收款'}
              </button>
            </div>
          </form>

          <section className="panel cashier-quick-charge">
            <div className="panel-heading">
              <div>
                <h2>快捷收费</h2>
                <p>常用收费项目和特殊情况自定义收款</p>
              </div>
              <button
                className="primary-button"
                type="button"
                onClick={() => setCustomOpen(true)}
              >
                自定义收款
              </button>
            </div>
            <div className="cashier-catalog-grid">
              {catalog.map((item) => {
                const enabled =
                  item.status === 'active' && item.availability === 'available'
                return (
                  <article className={enabled ? '' : 'unavailable'} key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        普通 {formatFen(item.regularPriceFen)} · 高级{' '}
                        {formatFen(item.advancedPriceFen)}
                      </span>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={!enabled}
                      type="button"
                      onClick={() => addCatalogItem(item)}
                    >
                      {enabled ? '加入' : '不可售'}
                    </button>
                    {item.itemType === 'admission' && selectedMember && enabled ? (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => addCatalogItem(item, true)}
                      >
                        本人入场
                      </button>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </section>
        </div>

        <section className="panel recent-orders cashier-history">
          <div className="panel-heading">
            <div>
              <h2>历史消费单</h2>
              <p>项目名称、价格和权益规则均保存结账快照</p>
            </div>
          </div>
          <div className="recent-order-list">
            {orders.length === 0 ? <div className="empty-row">暂无已完成订单</div> : null}
            {orders.map((order) => (
              <article key={order.id}>
                <div>
                  <strong>{order.orderNumber}</strong>
                  <span>{new Date(order.completedAt).toLocaleString('zh-CN')}</span>
                  <span className="recent-order-payer">
                    {orderMemberLabel(order, members)}
                  </span>
                </div>
                <div>
                  {order.items.map((item) => (
                    <span key={item.id}>
                      {item.itemName} × {item.quantity}
                      {item.benefitType !== 'none'
                        ? ` · ${benefitLabels[item.benefitType]}`
                        : ''}
                    </span>
                  ))}
                </div>
                <em>{order.paymentMethod === 'cash' ? '现金' : '储值'}</em>
                <strong>{formatFen(order.totalFen)}</strong>
              </article>
            ))}
          </div>
        </section>
      </section>

      {customOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={submitCustomCollection}>
            <div className="form-heading">
              <span>特殊情况</span>
              <h2>添加自定义收款</h2>
              <p>项目名称和金额会作为正式订单快照保存，可正常退款和统计。</p>
            </div>
            <label>
              <span>收款名称</span>
              <input
                required
                autoFocus
                maxLength={60}
                value={customName}
                onChange={(event) => setCustomName(event.currentTarget.value)}
                placeholder="例如：包场补差价"
              />
            </label>
            <label>
              <span>单价（元）</span>
              <input
                required
                inputMode="decimal"
                value={customAmount}
                onChange={(event) => setCustomAmount(event.currentTarget.value)}
                placeholder="0.00"
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCustomOpen(false)}
              >
                取消
              </button>
              <button className="primary-button" type="submit">
                加入消费单
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {memberAction === 'recharge' && selectedMember && walletDetails ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card cashier-service-modal" onSubmit={(event) => void submitRecharge(event)}>
            <div className="form-heading">
              <span>收银页快捷操作</span>
              <h2>为 {selectedMember.nickname} 现金充值</h2>
              <p>
                当前余额 {formatFen(walletDetails.wallet.totalBalanceFen)}，赠送规则按有效档位自动计算。
              </p>
            </div>
            <div className="quick-amounts">
              {[100, 300, 500, 1000].map((amount) => (
                <button
                  key={amount}
                  type="button"
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
                autoFocus
                inputMode="decimal"
                value={rechargeYuan}
                onChange={(event) => setRechargeYuan(event.currentTarget.value)}
              />
            </label>
            <div className="gift-preview">
              本次预计赠送 <strong>{formatFen(rechargeGiftPreviewFen)}</strong>
            </div>
            <label>
              <span>备注（选填）</span>
              <input
                maxLength={200}
                value={rechargeReason}
                onChange={(event) => setRechargeReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setMemberAction(null)}
              >
                取消
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                确认已收现金并充值
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {memberAction === 'monthly' && selectedMember && monthlyCard ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card cashier-service-modal">
            <div className="form-heading">
              <span>收银页快捷操作</span>
              <h2>{selectedMember.nickname} 的月卡</h2>
              <p>
                {monthlyCard.current
                  ? monthlyCardText(monthlyCard)
                  : `${formatFen(monthlyCard.plan.priceFen)} · ${monthlyCard.plan.durationDays} 天 · 仅现金购买`}
              </p>
            </div>
            {monthlyCard.current ? (
              <>
                <div className="cashier-monthly-facts">
                  <div>
                    <span>状态</span>
                    <strong>
                      {monthlyCard.current.status === 'active' ? '生效中' : '已暂停'}
                    </strong>
                  </div>
                  <div>
                    <span>到期时间</span>
                    <strong>
                      {new Date(monthlyCard.current.expiresAt).toLocaleString('zh-CN')}
                    </strong>
                  </div>
                  <div>
                    <span>已使用</span>
                    <strong>{monthlyCard.current.usageCount} 次</strong>
                  </div>
                </div>
                <label>
                  <span>操作原因</span>
                  <input
                    minLength={2}
                    maxLength={200}
                    value={monthlyReason}
                    onChange={(event) => setMonthlyReason(event.currentTarget.value)}
                  />
                </label>
              </>
            ) : (
              <div className="cashier-monthly-purchase">
                <strong>{monthlyCard.plan.name}</strong>
                <span>
                  请先线下收取现金 {formatFen(monthlyCard.plan.priceFen)}，确认后立即生效。
                </span>
              </div>
            )}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setMemberAction(null)}
              >
                取消
              </button>
              {monthlyCard.current ? (
                <button
                  className="primary-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void changeMonthlyCardStatus()}
                >
                  {monthlyCard.current.status === 'active' ? '暂停月卡' : '恢复并顺延'}
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void purchaseMonthlyCard()}
                >
                  确认收取现金并开通
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
