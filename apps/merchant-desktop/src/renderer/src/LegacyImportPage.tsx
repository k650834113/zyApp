import { useEffect, useState } from 'react'
import type {
  LegacyCatalogImportResolution,
  LegacyImportPreflightResult,
  LegacyImportResult,
  LegacyMemberImportResolution
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type CompletedPreflight = Exclude<
  LegacyImportPreflightResult,
  { canceled: true }
>

function formatFen(value: number): string {
  return `¥${(value / 100).toFixed(2)}`
}

function defaultMemberResolutions(
  preflight: CompletedPreflight
): LegacyMemberImportResolution[] {
  return preflight.memberConflicts.map((conflict) => ({
    legacyId: conflict.legacyId,
    nickname: 'keep_current',
    birthday: 'keep_current',
    balance: 'keep_current',
    monthlyCard: 'keep_current'
  }))
}

function defaultCatalogResolutions(
  preflight: CompletedPreflight
): LegacyCatalogImportResolution[] {
  return preflight.catalogConflicts.map((conflict) => ({
    legacyId: conflict.legacyId,
    choice: 'keep_current'
  }))
}

export function LegacyImportPage(): React.JSX.Element {
  const [preflight, setPreflight] = useState<CompletedPreflight | null>(null)
  const [memberResolutions, setMemberResolutions] = useState<
    LegacyMemberImportResolution[]
  >([])
  const [catalogResolutions, setCatalogResolutions] = useState<
    LegacyCatalogImportResolution[]
  >([])
  const [confirmed, setConfirmed] = useState(false)
  const [result, setResult] = useState<LegacyImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!error) return
    const timeoutId = window.setTimeout(() => setError(null), 10_000)
    return () => window.clearTimeout(timeoutId)
  }, [error])

  async function selectDatabase(): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const next = await getDesktopApi().preflightLegacyImport()
      if (next.canceled) return
      setPreflight(next)
      setMemberResolutions(defaultMemberResolutions(next))
      setCatalogResolutions(defaultCatalogResolutions(next))
      setConfirmed(false)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setBusy(false)
    }
  }

  function updateMemberResolution(
    legacyId: string,
    update: Partial<LegacyMemberImportResolution>
  ): void {
    setMemberResolutions((current) =>
      current.map((resolution) =>
        resolution.legacyId === legacyId
          ? { ...resolution, ...update }
          : resolution
      )
    )
    setConfirmed(false)
  }

  function updateCatalogResolution(
    legacyId: string,
    choice: LegacyCatalogImportResolution['choice']
  ): void {
    setCatalogResolutions((current) =>
      current.map((resolution) =>
        resolution.legacyId === legacyId
          ? { ...resolution, choice }
          : resolution
      )
    )
    setConfirmed(false)
  }

  async function executeImport(): Promise<void> {
    if (!preflight || !confirmed || busy || preflight.alreadyImported) return
    setBusy(true)
    setError(null)
    try {
      const imported = await getDesktopApi().executeLegacyImport({
        token: preflight.token,
        memberResolutions,
        catalogResolutions
      })
      setResult(imported)
      setPreflight(null)
      setConfirmed(false)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">阶段 1B · 只读预检与无损合并</p>
          <h1>旧数据库导入</h1>
        </div>
        <button
          className="primary-button"
          disabled={busy}
          type="button"
          onClick={() => void selectDatabase()}
        >
          {busy ? '正在处理...' : '选择旧数据库并检查'}
        </button>
      </header>

      {error ? <div className="viewport-toast error">{error}</div> : null}

      <section className="panel legacy-intro">
        <div className="panel-heading">
          <div>
            <h2>导入规则</h2>
            <p>旧文件始终只读；正式合并前会自动备份当前数据库。</p>
          </div>
        </div>
        <div className="legacy-rule-grid">
          <span>手机号是会员唯一标识</span>
          <span>旧余额导入为期初本金</span>
          <span>历史原始行与校验值完整封存</span>
          <span>同一文件哈希禁止重复导入</span>
        </div>
      </section>

      {result ? (
        <section className="panel legacy-result">
          <div className="panel-heading">
            <div>
              <h2>导入完成</h2>
              <p>批次 {result.batchId}</p>
            </div>
            <span className="release-tag">导入已留痕</span>
          </div>
          <div className="legacy-summary-grid">
            <article><span>新增会员</span><strong>{result.importedMembers}</strong></article>
            <article><span>合并会员</span><strong>{result.mergedMembers}</strong></article>
            <article><span>导入余额</span><strong>{formatFen(result.openingBalanceFen)}</strong></article>
            <article><span>历史记录</span><strong>{result.importedFinancialHistory}</strong></article>
            <article><span>月卡记录</span><strong>{result.importedMonthlyCards}</strong></article>
            <article><span>收费项目</span><strong>{result.importedCatalogItems}</strong></article>
          </div>
          <p className="legacy-backup-path">导入前备份：{result.backupPath}</p>
        </section>
      ) : null}

      {preflight ? (
        <>
          <section className="panel legacy-preflight">
            <div className="panel-heading">
              <div>
                <h2>{preflight.sourceName}</h2>
                <p>
                  SHA-256 {preflight.sourceSha256.slice(0, 16)}... ·{' '}
                  {preflight.sourceSizeBytes.toLocaleString('zh-CN')} 字节
                </p>
              </div>
              <span className="release-tag">
                {preflight.alreadyImported ? '当前库已导入过' : '预检通过'}
              </span>
            </div>
            <div className="legacy-summary-grid">
              <article><span>会员</span><strong>{preflight.summary.members}</strong></article>
              <article><span>旧库余额</span><strong>{formatFen(preflight.summary.storedBalanceFen)}</strong></article>
              <article><span>交易</span><strong>{preflight.summary.transactions}</strong></article>
              <article><span>活动日志</span><strong>{preflight.summary.activityLogs}</strong></article>
              <article><span>有效月卡</span><strong>{preflight.summary.activeMonthlyCards}</strong></article>
              <article><span>核对异常</span><strong>{preflight.summary.reconciliationIssues}</strong></article>
            </div>
            {preflight.warnings.map((warning) => (
              <div className="legacy-warning" key={warning}>{warning}</div>
            ))}
            <details className="legacy-assumptions">
              <summary>查看导入假设</summary>
              {preflight.assumptions.map((assumption) => (
                <p key={assumption}>{assumption}</p>
              ))}
            </details>
          </section>

          {preflight.memberConflicts.length > 0 ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>会员合并冲突</h2>
                  <p>当前数据库优先；只有明确选择采用旧库时才覆盖或增加。</p>
                </div>
                <span className="release-tag">
                  {preflight.memberConflicts.length} 项
                </span>
              </div>
              <div className="legacy-conflict-list">
                {preflight.memberConflicts.map((conflict) => {
                  const resolution = memberResolutions.find(
                    (item) => item.legacyId === conflict.legacyId
                  )
                  if (!resolution) return null
                  return (
                    <article className="legacy-conflict-card" key={conflict.legacyId}>
                      <div className="legacy-conflict-title">
                        <strong>{conflict.phone}</strong>
                        <span>{conflict.conflicts.join(' / ')}</span>
                      </div>
                      {conflict.conflicts.includes('nickname') ? (
                        <label>
                          <span>昵称：当前“{conflict.currentNickname}” / 旧库“{conflict.legacyNickname}”</span>
                          <select
                            value={resolution.nickname}
                            onChange={(event) =>
                              updateMemberResolution(conflict.legacyId, {
                                nickname: event.currentTarget.value as LegacyMemberImportResolution['nickname']
                              })
                            }
                          >
                            <option value="keep_current">保留当前昵称</option>
                            <option value="use_legacy">采用旧库昵称</option>
                          </select>
                        </label>
                      ) : null}
                      {conflict.conflicts.includes('birthday') ? (
                        <label>
                          <span>生日：当前 {conflict.currentBirthday} / 旧库 {conflict.legacyBirthday}</span>
                          <select
                            value={resolution.birthday}
                            onChange={(event) =>
                              updateMemberResolution(conflict.legacyId, {
                                birthday: event.currentTarget.value as LegacyMemberImportResolution['birthday']
                              })
                            }
                          >
                            <option value="keep_current">保留当前生日</option>
                            <option value="use_legacy">采用旧库生日</option>
                          </select>
                        </label>
                      ) : null}
                      {conflict.conflicts.includes('balance') ? (
                        <label>
                          <span>
                            余额：当前 {formatFen(conflict.currentBalanceFen)} / 旧库{' '}
                            {formatFen(conflict.legacyBalanceFen)}
                          </span>
                          <select
                            value={resolution.balance}
                            onChange={(event) =>
                              updateMemberResolution(conflict.legacyId, {
                                balance: event.currentTarget.value as LegacyMemberImportResolution['balance']
                              })
                            }
                          >
                            <option value="keep_current">保留当前余额，不重复增加</option>
                            <option value="add_legacy">把旧库余额追加为期初本金</option>
                          </select>
                        </label>
                      ) : null}
                      {conflict.conflicts.includes('monthly_card') ? (
                        <label>
                          <span>当前与旧库均有有效月卡</span>
                          <select
                            value={resolution.monthlyCard}
                            onChange={(event) =>
                              updateMemberResolution(conflict.legacyId, {
                                monthlyCard: event.currentTarget.value as LegacyMemberImportResolution['monthlyCard']
                              })
                            }
                          >
                            <option value="keep_current">保留当前有效月卡</option>
                            <option value="use_legacy">停用当前卡并采用旧库月卡</option>
                          </select>
                        </label>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          {preflight.catalogConflicts.length > 0 ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>收费项目冲突</h2>
                  <p>同名但价格不同，可保留当前项目或另建“旧库”项目。</p>
                </div>
              </div>
              <div className="legacy-conflict-list">
                {preflight.catalogConflicts.map((conflict) => {
                  const resolution = catalogResolutions.find(
                    (item) => item.legacyId === conflict.legacyId
                  )
                  if (!resolution) return null
                  return (
                    <article className="legacy-conflict-card" key={conflict.legacyId}>
                      <div className="legacy-conflict-title">
                        <strong>{conflict.legacyName}</strong>
                        <span>
                          当前 {formatFen(conflict.currentRegularPriceFen)} /{' '}
                          {formatFen(conflict.currentAdvancedPriceFen)}，旧库{' '}
                          {formatFen(conflict.legacyRegularPriceFen)} /{' '}
                          {formatFen(conflict.legacyAdvancedPriceFen)}
                        </span>
                      </div>
                      <select
                        value={resolution.choice}
                        onChange={(event) =>
                          updateCatalogResolution(
                            conflict.legacyId,
                            event.currentTarget.value as LegacyCatalogImportResolution['choice']
                          )
                        }
                      >
                        <option value="keep_current">保留当前项目</option>
                        <option value="import_as_new">另建旧库项目</option>
                      </select>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section className="panel legacy-confirm">
            <label className="checkbox-row">
              <input
                checked={confirmed}
                disabled={preflight.alreadyImported}
                type="checkbox"
                onChange={(event) => setConfirmed(event.currentTarget.checked)}
              />
              <span>
                我已核对人数、余额、月卡、异常项和冲突选择，并确认先备份后执行合并。
              </span>
            </label>
            <button
              className="primary-button"
              disabled={!confirmed || busy || preflight.alreadyImported}
              type="button"
              onClick={() => void executeImport()}
            >
              {preflight.alreadyImported ? '当前数据库已导入过旧库' : '备份并正式导入'}
            </button>
          </section>
        </>
      ) : null}
    </>
  )
}
