import { useEffect, useRef, useState } from 'react'
import type {
  ApplicationState,
  CloudConnectionStatus
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import { Dashboard } from './Dashboard'
import { EmployeePage } from './EmployeePage'
import { MemberPage } from './MemberPage'
import { WalletPage } from './WalletPage'
import { MonthlyCardPage } from './MonthlyCardPage'
import { CatalogPage } from './CatalogPage'
import { ActivityPage } from './ActivityPage'
import { AnnouncementPage } from './AnnouncementPage'
import { BoardGamePage } from './BoardGamePage'
import { CashierPage } from './CashierPage'
import { RefundPage } from './RefundPage'
import { LegacyImportPage } from './LegacyImportPage'
import { ReportPage } from './ReportPage'
import { BackupPage } from './BackupPage'
import { CloudConnectionPage } from './CloudConnectionPage'
import { StoreProfilePage } from './StoreProfilePage'
import { TransactionsPage } from './TransactionsPage'

type Page =
  | 'dashboard'
  | 'employees'
  | 'members'
  | 'wallet'
  | 'monthly-card'
  | 'catalog'
  | 'activity'
  | 'announcements'
  | 'board-games'
  | 'cashier'
  | 'refund'
  | 'report'
  | 'backup'
  | 'cloud'
  | 'store-profile'
  | 'legacy-import'
  | 'transactions'

type Props = {
  state: ApplicationState
  onLogout(): void
}

export function AppShell({ state, onLogout }: Props): React.JSX.Element {
  const [page, setPage] = useState<Page>('cashier')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [currentDatabasePath, setCurrentDatabasePath] = useState(
    state.system.databasePath
  )
  const [storeName, setStoreName] = useState(
    state.session?.storeName ?? ''
  )
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cloudStatus, setCloudStatus] =
    useState<CloudConnectionStatus | null>(null)
  const previousCloudStatus = useRef<CloudConnectionStatus | null>(null)
  const [conflictPrompt, setConflictPrompt] = useState<{
    upload: number
    inbound: number
  } | null>(null)
  const session = state.session
  if (!session) {
    throw new Error('Authenticated shell requires a session')
  }

  const canManageEmployees = session.permissions.includes('identity.employee.manage')
  const canReadMembers = session.permissions.includes('member.profile.read')
  const canUseWallet =
    session.permissions.includes('wallet.recharge.cash') ||
    session.permissions.includes('wallet.ledger.debit')
  const canReadCatalog = session.permissions.includes('catalog.read')
  const canReadActivity = session.permissions.includes('activity.read')
  const canReadContent = session.permissions.includes('content.read')
  const canUseCashier = session.permissions.includes('order.create')
  const canUseRefund = session.permissions.includes('refund.request')
  const canReadReports = session.permissions.includes('report.read')
  const canReadTransactions = canUseCashier || canUseWallet || canReadReports
  const canMoveDatabase = session.permissions.includes('system.backup.manage')
  const canManageCloud = session.permissions.includes('system.cloud.manage')
  const canManageStoreProfile = session.permissions.includes(
    'store.profile.manage'
  )

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const next = await getDesktopApi().getCloudConnectionStatus()
        if (active) {
          const previous = previousCloudStatus.current
          const previousConflicts = previous
            ? previous.pendingConflicts + previous.inboundConflicts
            : 0
          const nextConflicts = next.pendingConflicts + next.inboundConflicts
          const reconnected = next.runtimeMode === 'cloud_online' &&
            previous !== null &&
            previous.runtimeMode !== 'cloud_online'
          if (
            canManageCloud &&
            nextConflicts > 0 &&
            previous !== null &&
            (
              reconnected ||
              nextConflicts > previousConflicts
            )
          ) {
            setConflictPrompt({
              upload: next.pendingConflicts,
              inbound: next.inboundConflicts
            })
          }
          previousCloudStatus.current = next
          setCloudStatus(next)
        }
      } catch {
        // The page-level cloud settings surface configuration errors.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  const cloudModeLabel = !cloudStatus
    ? '云端状态读取中'
    : cloudStatus.runtimeMode === 'cloud_online'
      ? '云端在线 · 本地镜像正常'
      : cloudStatus.runtimeMode === 'local_offline'
        ? '离线营业 · 后台重连中'
        : cloudStatus.runtimeMode === 'reconciling'
          ? '正在合并离线操作'
          : cloudStatus.runtimeMode === 'result_pending'
            ? '存在结果待确认操作'
            : cloudStatus.runtimeMode === 'mirror_error'
              ? '本地镜像需要修复'
              : cloudStatus.runtimeMode === 'configuration_error'
                ? '云端配置异常'
                : cloudStatus.runtimeMode === 'connecting'
                  ? '正在连接云端'
                  : '尚未配置云端'

  async function logout(): Promise<void> {
    try {
      await getDesktopApi().logout()
      onLogout()
    } catch (reason) {
      setError(readableError(reason))
    }
  }

  async function relocateDatabase(): Promise<void> {
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().relocateDatabase()
      if (result.canceled) return
      setCurrentDatabasePath(result.databasePath)
      setNotice(
        `数据库已移动到 ${result.databasePath}；迁移前备份：${result.backupPath ?? '无'}${
          result.oldDatabaseRetained ? '。旧文件未能删除，请人工检查。' : ''
        }`
      )
    } catch (reason) {
      setError(readableError(reason))
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {conflictPrompt ? (
        <div className="modal-backdrop cloud-conflict-prompt-backdrop">
          <section
            aria-labelledby="cloud-conflict-prompt-title"
            aria-modal="true"
            className="modal-card cloud-conflict-prompt"
            role="dialog"
          >
            <div className="form-heading">
              <span>云端重连后需要确认</span>
              <h2 id="cloud-conflict-prompt-title">发现需要人工合并的资料</h2>
            </div>
            <p>
              桌游与公告的普通冲突已经自动采用云端版本。当前仍有
              {conflictPrompt.upload > 0
                ? ` ${conflictPrompt.upload} 条本机上传被云端拒绝`
                : ''}
              {conflictPrompt.upload > 0 && conflictPrompt.inbound > 0 ? '，以及' : ''}
              {conflictPrompt.inbound > 0
                ? ` ${conflictPrompt.inbound} 条云端资料需要合并`
                : ''}
              。资金、月卡、订单和退款不会自动覆盖。
            </p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConflictPrompt(null)}
              >
                稍后处理
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  setConflictPrompt(null)
                  setPage('cloud')
                }}
              >
                前往云端资料合并
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <aside className="sidebar">
        <div className="sidebar-heading">
          <div className="brand">
            <span className="brand-mark">ZY</span>
            <div className="brand-copy">
              <strong>{storeName}</strong>
              <small>管理收银</small>
            </div>
          </div>
          <button
            aria-label="切换边栏"
            className="sidebar-toggle"
            title={sidebarCollapsed ? '展开边栏' : '收起边栏'}
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? '>' : '<'}
          </button>
        </div>
        <nav>
          {canUseCashier ? (
            <button
              className={page === 'cashier' ? 'active' : ''}
              type="button"
              onClick={() => setPage('cashier')}
              title="收银"
            >
              <span className="nav-short">收</span>
              <span className="nav-label">收银</span>
            </button>
          ) : null}
          <button
            className={page === 'dashboard' ? 'active' : ''}
            type="button"
            onClick={() => setPage('dashboard')}
            title="工作台"
          >
            <span className="nav-short">台</span>
            <span className="nav-label">工作台</span>
          </button>
          {canManageEmployees ? (
            <button
              className={page === 'employees' ? 'active' : ''}
              type="button"
              onClick={() => setPage('employees')}
              title="员工权限"
            >
              <span className="nav-short">员</span>
              <span className="nav-label">员工权限</span>
            </button>
          ) : null}
          {canReadMembers ? (
            <button
              className={page === 'members' ? 'active' : ''}
              type="button"
              onClick={() => setPage('members')}
              title="会员中心"
            >
              <span className="nav-short">会</span>
              <span className="nav-label">会员中心</span>
            </button>
          ) : null}
          {canUseWallet ? (
            <button
              className={page === 'wallet' ? 'active' : ''}
              type="button"
              onClick={() => setPage('wallet')}
              title="储值账户"
            >
              <span className="nav-short">储</span>
              <span className="nav-label">储值账户</span>
            </button>
          ) : null}
          {canReadTransactions ? (
            <button
              className={page === 'transactions' ? 'active' : ''}
              type="button"
              onClick={() => setPage('transactions')}
              title="交易明细"
            >
              <span className="nav-short">账</span>
              <span className="nav-label">交易明细</span>
            </button>
          ) : null}
          <button
            className={page === 'monthly-card' ? 'active' : ''}
            type="button"
            onClick={() => setPage('monthly-card')}
            title="月卡"
          >
            <span className="nav-short">月</span>
            <span className="nav-label">月卡</span>
          </button>
          {canReadCatalog ? (
            <button
              className={page === 'catalog' ? 'active' : ''}
              type="button"
              onClick={() => setPage('catalog')}
              title="收费目录"
            >
              <span className="nav-short">目</span>
              <span className="nav-label">收费目录</span>
            </button>
          ) : null}
          {canReadActivity ? (
            <button
              className={page === 'activity' ? 'active' : ''}
              type="button"
              onClick={() => setPage('activity')}
              title="活动管理"
            >
              <span className="nav-short">活</span>
              <span className="nav-label">活动管理</span>
            </button>
          ) : null}
          {canReadContent ? (
            <>
              <button
                className={page === 'announcements' ? 'active' : ''}
                type="button"
                onClick={() => setPage('announcements')}
                title="公告管理"
              >
                <span className="nav-short">告</span>
                <span className="nav-label">公告管理</span>
              </button>
              <button
                className={page === 'board-games' ? 'active' : ''}
                type="button"
                onClick={() => setPage('board-games')}
                title="桌游管理"
              >
                <span className="nav-short">游</span>
                <span className="nav-label">桌游管理</span>
              </button>
            </>
          ) : null}
          {canManageStoreProfile ? (
            <button
              className={page === 'store-profile' ? 'active' : ''}
              type="button"
              onClick={() => setPage('store-profile')}
              title="门店设置"
            >
              <span className="nav-short">店</span>
              <span className="nav-label">门店设置</span>
            </button>
          ) : null}
          {canUseRefund ? (
            <button
              className={page === 'refund' ? 'active' : ''}
              type="button"
              onClick={() => setPage('refund')}
              title="退款"
            >
              <span className="nav-short">退</span>
              <span className="nav-label">退款</span>
            </button>
          ) : null}
          {canReadReports ? (
            <button
              className={page === 'report' ? 'active' : ''}
              type="button"
              onClick={() => setPage('report')}
              title="营业报表"
            >
              <span className="nav-short">报</span>
              <span className="nav-label">营业报表</span>
            </button>
          ) : null}
          {canMoveDatabase ? (
            <button
              className={page === 'backup' ? 'active' : ''}
              type="button"
              onClick={() => setPage('backup')}
              title="备份恢复"
            >
              <span className="nav-short">备</span>
              <span className="nav-label">备份恢复</span>
            </button>
          ) : null}
          {canManageCloud ? (
            <button
              className={page === 'cloud' ? 'active' : ''}
              type="button"
              onClick={() => setPage('cloud')}
              title="云端连接"
            >
              <span className="nav-short">云</span>
              <span className="nav-label">云端连接</span>
            </button>
          ) : null}
          {canMoveDatabase ? (
            <button
              className={page === 'legacy-import' ? 'active' : ''}
              type="button"
              onClick={() => setPage('legacy-import')}
              title="旧库导入"
            >
              <span className="nav-short">导</span>
              <span className="nav-label">旧库导入</span>
            </button>
          ) : null}
        </nav>
        <div className="sidebar-foot account-summary">
          <div className="account-copy">
            <strong>{session.displayName}</strong>
            <span>{session.role === 'manager' ? '店长' : '店员'} · @{session.username}</span>
          </div>
          <button title="退出登录" type="button" onClick={() => void logout()}>
            <span className="nav-short">退</span>
            <span className="nav-label">退出</span>
          </button>
        </div>
      </aside>

      <main>
        <div
          className={`global-cloud-status cloud-runtime-${
            cloudStatus?.runtimeMode ?? 'connecting'
          }`}
        >
          <div>
            <span className="cloud-status-dot" aria-hidden="true" />
            <strong>{cloudModeLabel}</strong>
            {cloudStatus ? (
              <small>
                待上传 {cloudStatus.pendingOperations} · 冲突{' '}
                {cloudStatus.pendingConflicts + cloudStatus.inboundConflicts}
                {cloudStatus.mirrorRepairRequired ? ' · 镜像待修复' : ''}
              </small>
            ) : null}
          </div>
          {canManageCloud ? (
            <button className="text-button" type="button" onClick={() => setPage('cloud')}>
              云端设置
            </button>
          ) : null}
        </div>
        {state.system.dataEnvironment === 'test' ? (
          <div className="test-environment-banner">
            测试环境：当前收银、会员和同步数据不会进入正式经营数据库
          </div>
        ) : null}
        {error ? <div className="form-error page-message">{error}</div> : null}
        {notice ? <div className="success-banner page-message">{notice}</div> : null}
        {page === 'dashboard' ? <Dashboard state={state} /> : null}
        {page === 'employees' && canManageEmployees ? (
          <EmployeePage session={session} />
        ) : null}
        {page === 'members' && canReadMembers ? <MemberPage session={session} /> : null}
        {page === 'wallet' && canUseWallet ? <WalletPage session={session} /> : null}
        {page === 'transactions' && canReadTransactions ? <TransactionsPage /> : null}
        {page === 'monthly-card' ? <MonthlyCardPage session={session} /> : null}
        {page === 'catalog' && canReadCatalog ? <CatalogPage session={session} /> : null}
        {page === 'activity' && canReadActivity ? (
          <ActivityPage session={session} />
        ) : null}
        {page === 'announcements' && canReadContent ? (
          <AnnouncementPage session={session} />
        ) : null}
        {page === 'board-games' && canReadContent ? (
          <BoardGamePage session={session} />
        ) : null}
        {page === 'store-profile' && canManageStoreProfile ? (
          <StoreProfilePage onStoreNameChanged={setStoreName} />
        ) : null}
        {page === 'cashier' && canUseCashier ? <CashierPage session={session} /> : null}
        {page === 'refund' && canUseRefund ? <RefundPage session={session} /> : null}
        {page === 'report' && canReadReports ? <ReportPage /> : null}
        {page === 'backup' && canMoveDatabase ? <BackupPage /> : null}
        {page === 'cloud' && canManageCloud ? (
          <CloudConnectionPage dataEnvironment={state.system.dataEnvironment} />
        ) : null}
        {page === 'legacy-import' && canMoveDatabase ? (
          <LegacyImportPage />
        ) : null}
        <footer>
          <span>版本 {state.system.appVersion}</span>
          <div className="database-location">
            <span className="database-path">{currentDatabasePath}</span>
            {canMoveDatabase ? (
              <button
                className="text-button"
                type="button"
                onClick={() => void relocateDatabase()}
              >
                更改数据库位置
              </button>
            ) : null}
          </div>
        </footer>
      </main>
    </div>
  )
}
