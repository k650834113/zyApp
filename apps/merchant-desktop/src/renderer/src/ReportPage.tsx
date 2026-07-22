import { useEffect, useState } from 'react'
import type { BusinessReport } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

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

function itemTypeLabel(value: BusinessReport['items'][number]['itemType']): string {
  return {
    admission: '入场费',
    product: '商品',
    service: '服务',
    activity: '活动'
  }[value]
}

export function ReportPage(): React.JSX.Element {
  const today = shanghaiToday()
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [scope, setScope] = useState<'store' | 'tenant'>('store')
  const [report, setReport] = useState<BusinessReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void loadReport(today, today)
  }, [])

  useEffect(() => {
    if (!error && !notice) return
    const timer = window.setTimeout(() => {
      setError(null)
      setNotice(null)
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [error, notice])

  async function loadReport(nextFrom = fromDate, nextTo = toDate): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setReport(
        await getDesktopApi().getBusinessReport({
          fromDate: nextFrom,
          toDate: nextTo,
          scope
        })
      )
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function exportExcel(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().exportBusinessReportExcel({
        requestId: crypto.randomUUID(),
        fromDate,
        toDate,
        scope
      })
      if (!result.canceled) {
        setNotice(`营业报表已导出：${result.filePath}`)
      }
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
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
      {notice ? (
        <div className="viewport-toast success">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            关闭
          </button>
        </div>
      ) : null}

      <header className="page-header">
        <div>
          <p className="eyebrow">店长财务视图</p>
          <h1>营业报表</h1>
        </div>
        <div className="release-tag">自然日 · Asia/Shanghai</div>
      </header>

      <section className="panel report-filter">
        <label>
          报表范围
          <select
            value={scope}
            onChange={(event) =>
              setScope(event.currentTarget.value as 'store' | 'tenant')
            }
          >
            <option value="store">当前门店</option>
            <option value="tenant">全部门店（跨店结算）</option>
          </select>
        </label>
        <label>
          开始日期
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>
        <button
          className="primary-button"
          disabled={loading}
          type="button"
          onClick={() => void loadReport()}
        >
          {loading ? '处理中…' : '查询'}
        </button>
        <button
          className="secondary-button"
          disabled={loading || !report}
          type="button"
          onClick={() => void exportExcel()}
        >
          导出 Excel
        </button>
      </section>

      {report ? (
        <>
          <section className="report-summary">
            <article className="report-kpi primary">
              <span>现金实际净流入</span>
              <strong>{formatFen(report.actualCashInflowFen)}</strong>
              <small>现金订单 + 充值本金 + 月卡，扣除对应退款</small>
            </article>
            <article className="report-kpi">
              <span>订单净销售</span>
              <strong>{formatFen(report.order.netSalesFen)}</strong>
              <small>
                {report.order.orderCount} 单 · 退款 {report.order.refundCount} 单
              </small>
            </article>
            <article className="report-kpi">
              <span>充值本金净额</span>
              <strong>
                {formatFen(
                  report.wallet.rechargePrincipalFen -
                    report.wallet.rechargeRefundPrincipalFen
                )}
              </strong>
              <small>赠送金额不计入现金收入</small>
            </article>
            <article className="report-kpi">
              <span>月卡净销售</span>
              <strong>{formatFen(report.monthlyCard.netSalesFen)}</strong>
              <small>当前有效或暂停 {report.monthlyCard.activeCount} 张</small>
            </article>
          </section>

          <section className="report-detail-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>订单与支付</h2>
                  <p>订单收入按完成时间，退款按退款完成时间</p>
                </div>
              </div>
              <div className="report-facts">
                <span>订单销售</span>
                <strong>{formatFen(report.order.grossSalesFen)}</strong>
                <span>订单退款</span>
                <strong>{formatFen(report.order.refundFen)}</strong>
                <span>现金订单净额</span>
                <strong>{formatFen(report.payment.cashNetFen)}</strong>
                <span>储值订单净额</span>
                <strong>{formatFen(report.payment.storedValueNetFen)}</strong>
                <span>平均客单</span>
                <strong>{formatFen(report.order.averageOrderFen)}</strong>
                <span>入场人次</span>
                <strong>{report.order.admissionQuantity}</strong>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>储值</h2>
                  <p>充值现金流与储值消费分开核对</p>
                </div>
              </div>
              <div className="report-facts">
                <span>充值本金</span>
                <strong>{formatFen(report.wallet.rechargePrincipalFen)}</strong>
                <span>充值赠送</span>
                <strong>{formatFen(report.wallet.rechargeGiftFen)}</strong>
                <span>充值退款本金</span>
                <strong>{formatFen(report.wallet.rechargeRefundPrincipalFen)}</strong>
                <span>退款收回赠送</span>
                <strong>{formatFen(report.wallet.reclaimedGiftFen)}</strong>
                <span>储值消费</span>
                <strong>{formatFen(report.wallet.consumptionDebitFen)}</strong>
                <span>订单退款退回储值</span>
                <strong>{formatFen(report.wallet.orderRefundCreditFen)}</strong>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading">
                <div>
                  <h2>月卡</h2>
                  <p>销售、退款和使用次数独立统计</p>
                </div>
              </div>
              <div className="report-facts">
                <span>销售张数</span>
                <strong>{report.monthlyCard.soldCount}</strong>
                <span>销售金额</span>
                <strong>{formatFen(report.monthlyCard.grossSalesFen)}</strong>
                <span>退款张数</span>
                <strong>{report.monthlyCard.refundCount}</strong>
                <span>退款金额</span>
                <strong>{formatFen(report.monthlyCard.refundFen)}</strong>
                <span>使用次数</span>
                <strong>{report.monthlyCard.usageCount}</strong>
                <span>当前有效及暂停</span>
                <strong>{report.monthlyCard.activeCount}</strong>
              </div>
            </article>
          </section>

          <section className="panel report-items">
            <div className="panel-heading">
              <div>
                <h2>项目明细</h2>
                <p>
                  {report.fromDate} 至 {report.toDate}，使用订单和退款当时的项目快照
                </p>
              </div>
            </div>
            <div className="report-item-table">
              <div className="report-item-row head">
                <span>项目</span>
                <span>类型</span>
                <span>售出</span>
                <span>退款</span>
                <span>销售金额</span>
                <span>退款金额</span>
                <span>净销售</span>
              </div>
              {report.items.length === 0 ? (
                <div className="empty-row">所选日期内暂无营业记录</div>
              ) : (
                report.items.map((item) => (
                  <div
                    className="report-item-row"
                    key={`${item.itemType}:${item.itemName}`}
                  >
                    <strong>{item.itemName}</strong>
                    <span>{itemTypeLabel(item.itemType)}</span>
                    <span>{item.soldQuantity}</span>
                    <span>{item.refundedQuantity}</span>
                    <span>{formatFen(item.grossSalesFen)}</span>
                    <span>{formatFen(item.refundFen)}</span>
                    <strong>{formatFen(item.netSalesFen)}</strong>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </>
  )
}
