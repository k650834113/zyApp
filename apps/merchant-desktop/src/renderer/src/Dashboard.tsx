import type { ApplicationState } from '@zyapp/contracts'

const modules = [
  ['会员中心', '查询、等级与生日权益', '已完成'],
  ['储值账户', '现金充值与追加账本', '已完成'],
  ['月卡', '购买、暂停与权益使用', '已完成'],
  ['收费目录', '入场费、商品与会员价', '已完成'],
  ['收银', '入场、商品与拆单结账', '已完成'],
  ['退款审批', '申请、审批与凭证', '已完成'],
  ['经营报表', '营业、储值与月卡汇总', '已完成'],
  ['备份恢复', '自动备份、恢复与诊断', '当前模块']
]

export function Dashboard({ state }: { state: ApplicationState }): React.JSX.Element {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">PC 本地经营版</p>
          <h1>今天，先把门店稳稳接住。</h1>
        </div>
        <div className="release-tag">阶段 1C 候选版</div>
      </header>

      <section className="hero-grid">
        <article className="hero-card primary">
          <span>当前里程碑</span>
          <h2>门店本地版已形成收银、报表、备份和恢复闭环</h2>
          <p>下一步通过安装包核对营业数据、自动备份、恢复回滚和脱敏诊断，再进入云端联机开发。</p>
        </article>
        <article className="hero-card">
          <span>本地数据</span>
          <strong>Schema v{state.system.schemaVersion}</strong>
          <p>SQLite {state.system.sqliteVersion} · {state.system.journalMode}</p>
        </article>
      </section>

      <section className="section-heading">
        <div>
          <p className="eyebrow">首发模块</p>
          <h2>经营核心</h2>
        </div>
        <span>本机离线运行</span>
      </section>

      <section className="module-grid">
        {modules.map(([name, description, moduleState], index) => (
          <article key={name}>
            <div className="module-index">{String(index + 1).padStart(2, '0')}</div>
            <h3>{name}</h3>
            <p>{description}</p>
            <span className={moduleState === '当前模块' ? 'module-state current' : 'module-state'}>
              {moduleState}
            </span>
          </article>
        ))}
      </section>
    </>
  )
}
