import type { InboundSyncConflictSummary } from '@zyapp/contracts'

const labels: Record<string, string> = {
  planName: '月卡名称', priceFen: '购买金额', paymentMethod: '支付方式', purchasedAt: '购买时间', startsAt: '生效时间',
  orderNumber: '订单号', totalFen: '订单金额', items: '商品明细', completedAt: '完成时间',
  nickname: '会员昵称', phone: '手机号', title: '标题', content: '正文', name: '名称',
  status: '状态', tier: '会员等级', note: '备注', updatedAt: '修改时间',
  principalBalanceFen: '本金余额', giftBalanceFen: '赠送余额', totalBalanceFen: '总余额',
  principalDeltaFen: '本金变动', giftDeltaFen: '赠送变动', usageCount: '月卡使用次数',
  expiresAt: '到期时间', pausedAt: '暂停时间', birthdayMonth: '生日月份', birthdayDay: '生日日期',
  regularPriceFen: '普通价格', advancedPriceFen: '会员价格', wallet: '储值账户',
  reason: '原因', memberId: '会员编号', accountId: '账户编号', fields: '冲突字段',
  serverVersion: '云端版本', id: '资料编号', visibleFrom: '展示开始', visibleUntil: '展示结束'
}
const values: Record<string, string> = { cash: '现金', stored_value: '储值余额', wechat: '微信', store: '本店', tenant: '全部门店', not_executed: '云端没有执行此项业务', active: '有效', paused: '已暂停', expired: '已过期',
  refunded: '已退款', disabled: '已停用', ordinary: '普通会员', advanced: '高级会员', draft: '草稿', published: '已发布' }
function flatten(value: Record<string, unknown> | null | undefined, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [raw, item] of Object.entries(value ?? {})) {
    if (/password|credential|token|verifier|hash/i.test(raw) || ['atomicGroup','mobileCommand','operationId','payment','metadata','action','cloudCommand'].includes(raw)) continue
    const key = prefix + raw.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    if (item && typeof item === 'object' && !Array.isArray(item)) Object.assign(result, flatten(item as Record<string, unknown>, `${key}.`))
    else result[key] = item
  }
  return result
}
function format(key: string, value: unknown): string {
  if (value === undefined) return '未提供'
  if (value === null || value === '') return '未填写'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (/Fen$/.test(key) && Number.isFinite(Number(value))) return `¥${(Number(value) / 100).toFixed(2)}`
  return values[String(value)] ?? (typeof value === 'object' ? JSON.stringify(value) : String(value))
}
export function ConflictDiff({ conflict }: { conflict: InboundSyncConflictSummary }): React.JSX.Element {
  const local = flatten(conflict.localSnapshot)
  const cloud = flatten(conflict.cloudSnapshot)
  const keys = [...new Set([...Object.keys(local), ...Object.keys(cloud)])]
  const changed = keys.filter(key => JSON.stringify(local[key]) !== JSON.stringify(cloud[key]))
  return <div className="conflict-diff">
    <strong>{conflict.displayName || '资料差异'} · {changed.length} 处不同</strong>
    {!conflict.cloudSnapshot ? <p>云端未返回完整数据，不能仅凭异常编码决定覆盖。请先刷新同步。</p> : null}
    <table><thead><tr><th>字段</th><th>本机记录</th><th>云端记录</th></tr></thead>
      <tbody>{changed.map(key => <tr key={key}><th>{key.split('.').map(part => labels[part] ?? part).join(' / ')}</th>
        <td>{format(key, local[key])}</td><td>{format(key, cloud[key])}</td></tr>)}</tbody></table>
    {changed.length === 0 ? <p>当前记录已无字段差异，请核对同步状态及发生时间。</p> : null}
  </div>
}
