import { useEffect, useState } from 'react'
import type { BackupFileSummary, BackupOverview } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function kindLabel(kind: BackupFileSummary['kind']): string {
  if (kind === 'pre_environment_switch') return '环境切换前'
  return {
    automatic: '自动',
    manual: '手动',
    pre_restore: '恢复前',
    pre_upgrade: '升级前',
    pre_import: '导入前',
    pre_move: '迁移前',
    unknown: '历史'
  }[kind]
}

export function BackupPage(): React.JSX.Element {
  const [overview, setOverview] = useState<BackupOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (!error && !notice) return
    const timer = window.setTimeout(() => {
      setError(null)
      setNotice(null)
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [error, notice])

  async function refresh(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setOverview(await getDesktopApi().getBackupOverview())
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function createBackup(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().createBackup({
        requestId: crypto.randomUUID()
      })
      setNotice(
        result.secondaryError
          ? `主备份已完成；第二目录复制失败：${result.secondaryError}`
          : `备份已完成：${result.backup.fileName}`
      )
      await refresh()
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function changeSecondaryDirectory(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().setSecondaryBackupDirectory()
      if (!result.canceled) {
        setNotice(
          result.settings.secondaryDirectory
            ? '第二备份目录已更新'
            : '第二备份目录已清除'
        )
        await refresh()
      }
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function restoreDatabase(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().restoreDatabase({
        requestId: crypto.randomUUID()
      })
      if (!result.canceled) {
        setNotice('数据库恢复完成，正在重新加载登录页面')
      }
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function exportDiagnostics(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().exportDiagnostics()
      if (!result.canceled) {
        setNotice(`脱敏诊断包已导出：${result.filePath}`)
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
          <p className="eyebrow">本地数据保护</p>
          <h1>备份与恢复</h1>
        </div>
        <div className="release-tag">店长权限</div>
      </header>

      <section className="backup-action-grid">
        <article className="panel backup-action-card primary">
          <span>立即保护当前数据</span>
          <h2>手动备份</h2>
          <p>使用 SQLite 一致性备份，完成后自动计算 SHA-256 并检查数据库完整性。</p>
          <button
            className="primary-button"
            disabled={loading}
            type="button"
            onClick={() => void createBackup()}
          >
            立即备份
          </button>
        </article>
        <article className="panel backup-action-card">
          <span>异盘或外置设备</span>
          <h2>第二备份目录</h2>
          <p className="backup-path">
            {overview?.settings.secondaryDirectory ?? '尚未设置'}
          </p>
          <button
            className="secondary-button"
            disabled={loading}
            type="button"
            onClick={() => void changeSecondaryDirectory()}
          >
            设置或清除
          </button>
        </article>
        <article className="panel backup-action-card warning">
          <span>恢复前自动保护当前数据</span>
          <h2>恢复数据库</h2>
          <p>候选文件通过 SQLite、Schema 和门店校验后才会替换；失败会自动回滚。</p>
          <button
            className="secondary-button"
            disabled={loading}
            type="button"
            onClick={() => void restoreDatabase()}
          >
            选择备份并恢复
          </button>
        </article>
        <article className="panel backup-action-card">
          <span>不包含会员资料和财务明细</span>
          <h2>脱敏诊断包</h2>
          <p>导出版本、数据库健康、表数量、备份状态和脱敏日志，供排查故障使用。</p>
          <button
            className="secondary-button"
            disabled={loading}
            type="button"
            onClick={() => void exportDiagnostics()}
          >
            导出诊断包
          </button>
        </article>
      </section>

      <section className="panel backup-list-panel">
        <div className="panel-heading">
          <div>
            <h2>本机备份</h2>
            <p>
              主目录：{overview?.settings.primaryDirectory ?? '读取中'}。自动备份每 6
              小时检查一次。
            </p>
          </div>
          <button
            className="text-button"
            disabled={loading}
            type="button"
            onClick={() => void refresh()}
          >
            刷新
          </button>
        </div>
        <div className="backup-table">
          <div className="backup-row head">
            <span>时间与类型</span>
            <span>文件</span>
            <span>大小</span>
            <span>Schema</span>
            <span>校验</span>
            <span>第二目录</span>
          </div>
          {!overview || overview.backups.length === 0 ? (
            <div className="empty-row">暂无备份，完成门店初始化后会自动生成</div>
          ) : (
            overview.backups.map((backup) => (
              <div className="backup-row" key={backup.filePath}>
                <div>
                  <strong>{new Date(backup.createdAt).toLocaleString('zh-CN')}</strong>
                  <small>{kindLabel(backup.kind)}</small>
                </div>
                <span className="backup-file-name" title={backup.filePath}>
                  {backup.fileName}
                </span>
                <span>{formatBytes(backup.sizeBytes)}</span>
                <span>v{backup.schemaVersion}</span>
                <em className={backup.integrityOk ? 'ok' : 'bad'}>
                  {backup.integrityOk ? '正常' : '异常'}
                </em>
                <span>
                  {overview.settings.secondaryDirectory
                    ? backup.secondaryCopy
                      ? '已复制'
                      : '未复制'
                    : '未设置'}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  )
}
