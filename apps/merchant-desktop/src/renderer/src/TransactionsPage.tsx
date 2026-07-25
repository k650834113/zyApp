import { useEffect, useState, type FormEvent } from 'react'
import type {
  RechargeTransactionSummary,
  SalesOrderSummary
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type TransactionTab = 'sales' | 'recharges'

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}

function formatFen(value: number): string {
  return `¥${(value / 100).toFixed(2)}`
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

const rechargeStatusLabels: Record<RechargeTransactionSummary['status'], string> = {
  pending_payment: '待支付',
  settled: '已到账',
  failed: '失败',
  expired: '已失效'
}

export function TransactionsPage(): React.JSX.Element {
  const today = shanghaiToday()
  const [tab, setTab] = useState<TransactionTab>('sales')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [sales, setSales] = useState<SalesOrderSummary[]>([])
  const [recharges, setRecharges] = useState<RechargeTransactionSummary[]>([])
  const [selectedSale, setSelectedSale] = useState<SalesOrderSummary | null>(null)
  const [selectedRecharge, setSelectedRecharge] =
    useState<RechargeTransactionSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(nextTab = tab): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const request = {
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        limit: 200
      }
      if (nextTab === 'sales') {
        const records = await getDesktopApi().listSalesTransactions(request)
        setSales(records)
        setSelectedSale((current) =>
          records.find((record) => record.id === current?.id) ?? null
        )
      } else {
        const records = await getDesktopApi().listRechargeTransactions(request)
        setRecharges(records)
        setSelectedRecharge((current) =>
          records.find((record) => record.id === current?.id) ?? null
        )
      }
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('sales')
  }, [])

  function switchTab(nextTab: TransactionTab): void {
    setTab(nextTab)
    setSelectedSale(null)
    setSelectedRecharge(null)
    void load(nextTab)
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    void load()
  }

  return (
    <>
      {error ? (
        <div className="viewport-toast error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      ) : null}

      <header className="page-header">
        <div>
          <p className="eyebrow">门店资金与消费记录</p>
          <h1>交易明细</h1>
        </div>
        <div className="release-tag">Asia/Shanghai · 最多 200 条</div>
      </header>

      <section className="panel transaction-workspace">
        <div className="content-tabs transaction-tabs">
          <button
            className={tab === 'sales' ? 'active' : ''}
            type="button"
            onClick={() => switchTab('sales')}
          >
            消费单
          </button>
          <button
            className={tab === 'recharges' ? 'active' : ''}
            type="button"
            onClick={() => switchTab('recharges')}
          >
            储值单
          </button>
        </div>

        <form className="transaction-filter" onSubmit={submit}>
          <label className="transaction-query">
            搜索
            <input
              placeholder={
                tab === 'sales'
                  ? '订单号、会员名、会员号或手机号'
                  : '充值单号、会员名、会员号或手机号'
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            开始日期
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? '同步中…' : '查询并同步'}
          </button>
        </form>

        <div className="transaction-result-heading">
          <strong>{tab === 'sales' ? '消费记录' : '储值记录'}</strong>
          <span>
            {tab === 'sales' ? sales.length : recharges.length} 条
          </span>
        </div>

        {tab === 'sales' ? (
          <div className="transaction-layout">
            <div className="transaction-table">
              <div className="transaction-row table-head">
                <span>时间 / 单号</span>
                <span>会员</span>
                <span>支付方式</span>
                <span>金额</span>
              </div>
              {sales.map((record) => (
                <button
                  className={`transaction-row ${
                    selectedSale?.id === record.id ? 'selected' : ''
                  }`}
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedSale(record)}
                >
                  <span>
                    <strong>{formatTime(record.completedAt)}</strong>
                    <small>{record.orderNumber}</small>
                  </span>
                  <span>{record.memberNickname ?? '游客'}</span>
                  <span>{record.paymentMethod === 'cash' ? '现金' : '储值余额'}</span>
                  <strong>{formatFen(record.totalFen)}</strong>
                </button>
              ))}
              {!loading && sales.length === 0 ? (
                <div className="transaction-empty">当前条件下没有消费单</div>
              ) : null}
            </div>
            <aside className="transaction-detail">
              {selectedSale ? (
                <>
                  <p className="eyebrow">消费单详情</p>
                  <h2>{selectedSale.orderNumber}</h2>
                  <dl>
                    <div>
                      <dt>会员</dt>
                      <dd>{selectedSale.memberNickname ?? '游客'}</dd>
                    </div>
                    <div>
                      <dt>支付</dt>
                      <dd>
                        {selectedSale.paymentMethod === 'cash' ? '现金' : '储值余额'}
                      </dd>
                    </div>
                    <div>
                      <dt>合计</dt>
                      <dd>{formatFen(selectedSale.totalFen)}</dd>
                    </div>
                  </dl>
                  <div className="transaction-line-items">
                    {selectedSale.items.map((item) => (
                      <div key={item.id}>
                        <span>
                          {item.itemName} × {item.quantity}
                        </span>
                        <strong>{formatFen(item.lineTotalFen)}</strong>
                      </div>
                    ))}
                  </div>
                  {selectedSale.note ? (
                    <p className="transaction-note">备注：{selectedSale.note}</p>
                  ) : null}
                </>
              ) : (
                <div className="transaction-detail-placeholder">
                  选择一条消费单查看收费项目
                </div>
              )}
            </aside>
          </div>
        ) : (
          <div className="transaction-layout">
            <div className="transaction-table">
              <div className="transaction-row recharge table-head">
                <span>时间 / 单号</span>
                <span>会员</span>
                <span>渠道</span>
                <span>状态</span>
                <span>到账</span>
              </div>
              {recharges.map((record) => (
                <button
                  className={`transaction-row recharge ${
                    selectedRecharge?.id === record.id ? 'selected' : ''
                  }`}
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedRecharge(record)}
                >
                  <span>
                    <strong>{formatTime(record.createdAt)}</strong>
                    <small>{record.orderNumber}</small>
                  </span>
                  <span>
                    <strong>{record.memberNickname}</strong>
                    <small>{record.phoneMasked}</small>
                  </span>
                  <span>{record.channel === 'cash' ? '前台现金' : '微信支付'}</span>
                  <span className={`transaction-status ${record.status}`}>
                    {rechargeStatusLabels[record.status]}
                  </span>
                  <strong>{formatFen(record.totalCreditFen)}</strong>
                </button>
              ))}
              {!loading && recharges.length === 0 ? (
                <div className="transaction-empty">当前条件下没有储值单</div>
              ) : null}
            </div>
            <aside className="transaction-detail">
              {selectedRecharge ? (
                <>
                  <p className="eyebrow">储值单详情</p>
                  <h2>{selectedRecharge.orderNumber}</h2>
                  <dl>
                    <div>
                      <dt>会员</dt>
                      <dd>
                        {selectedRecharge.memberNickname} · {selectedRecharge.phoneMasked}
                      </dd>
                    </div>
                    <div>
                      <dt>充值本金</dt>
                      <dd>{formatFen(selectedRecharge.principalFen)}</dd>
                    </div>
                    <div>
                      <dt>赠送金额</dt>
                      <dd>{formatFen(selectedRecharge.giftFen)}</dd>
                    </div>
                    <div>
                      <dt>实际到账</dt>
                      <dd>{formatFen(selectedRecharge.totalCreditFen)}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>{rechargeStatusLabels[selectedRecharge.status]}</dd>
                    </div>
                    <div>
                      <dt>支付流水号</dt>
                      <dd>{selectedRecharge.providerTransactionId ?? '—'}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <div className="transaction-detail-placeholder">
                  选择一条储值单查看本金、赠送和支付流水
                </div>
              )}
            </aside>
          </div>
        )}
      </section>
    </>
  )
}
