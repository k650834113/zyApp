import { useEffect, useState } from 'react'
import type {
  ApplicationUpdateStatus,
  CloudConnectionStatus,
  DataEnvironment,
  InboundSyncConflictSummary,
  TenantStoreAdminSummary,
  EmployeeStoreAccessSummary,
  EmployeeRole,
  EmployeeStatus,
  BusinessTemplateSummary,
  BusinessTemplateType
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import { EnvironmentSwitcher } from './EnvironmentSwitcher'
import { ConflictDiff } from './ConflictDiff'
import { configuredCloudBaseUrl } from '../../shared/public-endpoints'

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '暂无'
}

function stateLabel(status: CloudConnectionStatus): string {
  if (!status.configured) return '未配置'
  if (status.runtimeMode === 'cloud_online') return '云端在线'
  if (status.runtimeMode === 'local_offline') return '离线营业'
  if (status.runtimeMode === 'reconciling') return '重连同步'
  if (status.runtimeMode === 'result_pending') return '结果待确认'
  if (status.runtimeMode === 'mirror_error') return '镜像异常'
  if (status.runtimeMode === 'configuration_error') return '配置异常'
  return '连接中'
}

const aggregateLabels: Record<string, string> = {
  activity: '活动资料',
  announcement: '公告',
  board_game: '桌游资料',
  catalog: '收费项目',
  employee: '员工资料',
  employee_pc_credential: '员工 PC 登录凭据',
  employee_mobile_access: '员工移动端权限',
  member: '会员资料',
  wallet: '储值账户',
  monthly_card: '月卡',
  sales_order: '消费单',
  store: '门店资料'
}

function conflictTitle(conflict: InboundSyncConflictSummary): string {
  return `${aggregateLabels[conflict.aggregateType] ?? '业务资料'}需要人工合并`
}

function conflictDescription(conflict: InboundSyncConflictSummary): string {
  if (conflict.resolutionMode === 'financial_balance') return '请核对实际收款及两侧数值。系统将按所选数值生成关联原异常的更正流水，保留原始记录；核对期间云端再发生变化会要求重新选择。'
  if (conflict.canKeepLocal === false) return '原移动端业务已处理或已由其他设备领取。请核对原业务结果，采用云端记录关闭本机待处理项，不能重复收款。'
  if (conflict.resolutionMode === 'financial_command') return '这笔业务已被云端整笔拒绝，尚未扣款。可采用云端并取消本笔，或保留本机操作、按最新云端余额重新提交整笔业务。'
  if (conflict.direction === 'outbound') {
    return conflict.resolutionSupported
      ? '这次本机修改未被云端接受。请对照两侧资料，选择需要保留的版本。'
      : '这笔操作未被云端接受，请对照两侧记录核对。资金异常需要通过更正流水处理。'
  }
  if (conflict.errorMessage === 'Local pending changes exist for the same aggregate') {
    return '本机和云端同时修改了这条资料。请先完成本机上传，再选择保留本机或采用云端。'
  }
  if (conflict.errorMessage.startsWith('Automatic cloud apply failed:')) {
    return `云端资料未能安全写入本机：${conflict.errorMessage.slice(29)}`
  }
  return `云端资料未能安全写入本机：${conflict.errorMessage}`
}

type Props = {
  dataEnvironment: DataEnvironment
}

export function CloudConnectionPage({
  dataEnvironment
}: Props): React.JSX.Element {
  const [status, setStatus] = useState<CloudConnectionStatus | null>(null)
  const [updateStatus, setUpdateStatus] =
    useState<ApplicationUpdateStatus | null>(null)
  const [inboundConflicts, setInboundConflicts] = useState<
    InboundSyncConflictSummary[]
  >([])
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:3100')
  const [enrollmentSecret, setEnrollmentSecret] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [createdPairingCode, setCreatedPairingCode] = useState<{
    code: string
    expiresAt: string
  } | null>(null)
  const [tenantStores, setTenantStores] = useState<TenantStoreAdminSummary[]>([])
  const [employeeAccess, setEmployeeAccess] = useState<EmployeeStoreAccessSummary[]>([])
  const [businessTemplates, setBusinessTemplates] = useState<BusinessTemplateSummary[]>([])
  const [tenantAdminAvailable, setTenantAdminAvailable] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [storeActivation, setStoreActivation] = useState<{
    storeName: string
    code: string
    expiresAt: string
  } | null>(null)
  const [accessEmployeeId, setAccessEmployeeId] = useState('')
  const [accessStoreId, setAccessStoreId] = useState('')
  const [accessRole, setAccessRole] = useState<EmployeeRole>('staff')
  const [accessStatus, setAccessStatus] = useState<EmployeeStatus>('active')
  const [templateType, setTemplateType] = useState<BusinessTemplateType>('monthly_card_plan')
  const [templateName, setTemplateName] = useState('标准月卡方案')
  const [templatePayload, setTemplatePayload] = useState(
    JSON.stringify({ priceFen: 20000, durationDays: 30, scopeType: 'store' }, null, 2)
  )
  const [overrideTemplateId, setOverrideTemplateId] = useState('')
  const [overridePayload, setOverridePayload] = useState('{}')
  const [accessReason, setAccessReason] = useState('跨店工作授权')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inboundResolution, setInboundResolution] = useState<{
    conflict: InboundSyncConflictSummary
    resolution: 'keep_local' | 'apply_cloud'
  } | null>(null)
  const [inboundResolutionReason, setInboundResolutionReason] = useState('')

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh(false)
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!error && !notice) return
    const timer = window.setTimeout(() => {
      setError(null)
      setNotice(null)
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [error, notice])

  async function refresh(showError = true): Promise<void> {
    try {
      const [next, nextUpdate, nextInboundConflicts] = await Promise.all([
        getDesktopApi().getCloudConnectionStatus(),
        getDesktopApi().getApplicationUpdateStatus(),
        getDesktopApi().listInboundSyncConflicts()
      ])
      setStatus(next)
      setUpdateStatus(nextUpdate)
      setInboundConflicts(nextInboundConflicts)
      setBaseUrl(
        next.baseUrl ?? configuredCloudBaseUrl(next.environment)
      )
      if (next.configured) {
        try {
          const [stores, access, templates] = await Promise.all([
            getDesktopApi().listTenantStores(),
            getDesktopApi().listEmployeeStoreAccess(),
            getDesktopApi().listBusinessTemplates()
          ])
          setTenantAdminAvailable(true)
          setTenantStores(stores)
          setEmployeeAccess(access)
          setBusinessTemplates(templates)
          if (!accessStoreId && stores[0]) setAccessStoreId(stores[0].id)
          if (!accessEmployeeId && access[0]) setAccessEmployeeId(access[0].employeeId)
          if (!overrideTemplateId && templates[0]) setOverrideTemplateId(templates[0].id)
        } catch {
          setTenantAdminAvailable(false)
          setTenantStores([])
          setEmployeeAccess([])
          setBusinessTemplates([])
        }
      }
    } catch (reason) {
      if (showError) setError(readableError(reason))
    }
  }

  async function enroll(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const next = await getDesktopApi().enrollCloudConnection({
        requestId: crypto.randomUUID(),
        baseUrl,
        enrollmentSecret
      })
      setStatus(next)
      setEnrollmentSecret('')
      setNotice(
        next.pendingOperations > 0
          ? `设备连接成功，仍有 ${next.pendingOperations} 条操作等待云端处理`
          : '设备连接并同步成功'
      )
    } catch (reason) {
      setError(readableError(reason))
      await refresh(false)
    } finally {
      setLoading(false)
    }
  }

  async function syncNow(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const next = await getDesktopApi().syncCloudNow()
      setStatus(next)
      const manualConflicts = next.pendingConflicts + next.inboundConflicts
      setNotice(
        manualConflicts > 0
          ? `同步已完成；仍有 ${manualConflicts} 条重大或异常冲突，请在下方状态卡和资料合并区核对`
          : next.pendingOperations > 0
            ? `已上传并查询回执，尚有 ${next.pendingOperations} 条等待处理`
            : '同步完成，本机没有待上传操作或待合并冲突'
      )
    } catch (reason) {
      setError(readableError(reason))
      await refresh(false)
    } finally {
      setLoading(false)
    }
  }

  async function createPairingCode(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().createCloudPairingCode()
      setCreatedPairingCode({ code: result.code, expiresAt: result.expiresAt })
      setNotice('一次性加入码已生成，请在 15 分钟内输入到新设备')
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function createStore(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().createTenantStore({
        requestId: crypto.randomUUID(),
        storeName: newStoreName
      })
      setStoreActivation({
        storeName: result.store.name,
        code: result.activationCode,
        expiresAt: result.expiresAt
      })
      setNewStoreName('')
      setNotice('新门店已在当前商户下创建，请在 30 分钟内使用启用码接入首台设备')
      await refresh(false)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function updateEmployeeAccess(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().setEmployeeStoreAccess({
        requestId: crypto.randomUUID(),
        employeeId: accessEmployeeId,
        storeId: accessStoreId,
        role: accessRole,
        status: accessStatus,
        reason: accessReason
      })
      setNotice(
        `${result.displayName} 在“${result.storeName}”的授权已更新为${
          result.role === 'manager' ? '店长' : '店员'
        }/${result.status === 'active' ? '启用' : '停用'}`
      )
      await refresh(false)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  function parseTemplatePayload(value: string): Record<string, unknown> {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('模板配置必须是 JSON 对象')
    }
    return parsed as Record<string, unknown>
  }

  async function saveTemplate(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      await getDesktopApi().saveBusinessTemplate({
        requestId: crypto.randomUUID(),
        id: crypto.randomUUID(),
        templateType,
        name: templateName.trim(),
        payload: parseTemplatePayload(templatePayload),
        active: true
      })
      setNotice('商户模板已保存；各门店同步后会继承，门店覆盖仍保留来源关系')
      await refresh(false)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function saveTemplateOverride(): Promise<void> {
    if (!overrideTemplateId) return
    setLoading(true)
    setError(null)
    try {
      await getDesktopApi().saveBusinessTemplateOverride({
        requestId: crypto.randomUUID(),
        templateId: overrideTemplateId,
        payload: parseTemplatePayload(overridePayload),
        active: true
      })
      setNotice('当前门店覆盖已保存，并保留商户模板来源')
      await refresh(false)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function joinCloudStore(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().joinCloudStore({
        requestId: crypto.randomUUID(),
        baseUrl,
        pairingCode
      })
      if (result) setNotice('已加入云门店，程序正在重启')
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function prepareEmptyCutover(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await getDesktopApi().prepareEmptyCloudCutover()
      if (!result) return
      setNotice('空云主库已启用，程序正在重启')
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function claimOfflineLease(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const lease = await getDesktopApi().claimOfflineFinancialLease()
      setNotice(
        `本设备已设为离线财务主收银，有效至 ${formatTime(lease.expiresAt)}`
      )
      await refresh(false)
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setLoading(false)
    }
  }

  async function checkUpdate(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const next = await getDesktopApi().checkApplicationUpdate()
      setUpdateStatus(next)
      setNotice(
        next.state === 'available'
          ? `发现新版本 ${next.availableVersion}`
          : '当前已经是最新版本'
      )
    } catch (reason) {
      setError(readableError(reason))
      await refresh(false)
    } finally {
      setLoading(false)
    }
  }

  async function downloadUpdate(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const next = await getDesktopApi().downloadApplicationUpdate()
      setUpdateStatus(next)
      if (next.state === 'downloaded') {
        setNotice('更新已下载，可在合适时间重启安装')
      }
    } catch (reason) {
      setError(readableError(reason))
      await refresh(false)
    } finally {
      setLoading(false)
    }
  }

  async function installUpdate(): Promise<void> {
    setLoading(true)
    setError(null)
    setNotice('正在创建升级保护备份，随后程序会自动重启')
    try {
      await getDesktopApi().installApplicationUpdate()
    } catch (reason) {
      setError(readableError(reason))
      setNotice(null)
      setLoading(false)
    }
  }

  async function resolveInbound(
    conflict: InboundSyncConflictSummary,
    resolution: 'keep_local' | 'apply_cloud',
    reason: string
  ): Promise<void> {
    if (reason.trim().length < 2) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await getDesktopApi().resolveInboundSyncConflict({
        ...(conflict.reviewToken ? { reviewToken: conflict.reviewToken } : {}),
        sequence: conflict.sequence,
        resolution,
        reason
      })
      setNotice(
        conflict.resolutionMode === 'financial_balance' ? '更正记录已提交，请核对最新云端结果'
          : conflict.resolutionMode === 'financial_command'
          ? resolution === 'keep_local' ? '已重新提交整笔业务，请核对最新同步结果' : '已取消未执行的业务，保留云端记录'
          : resolution === 'keep_local'
          ? '已重新提交本机资料并记录处理原因'
          : '已应用云端资料并完成冲突审计'
      )
      await refresh(false)
      setInboundResolution(null)
      setInboundResolutionReason('')
    } catch (reasonValue) {
      setError(readableError(reasonValue))
    } finally {
      setLoading(false)
    }
  }

  const tenantEmployees = [...new Map(
    employeeAccess.map((access) => [access.employeeId, access])
  ).values()]

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
          <p className="eyebrow">在线软件与离线营业</p>
          <h1>云端连接</h1>
        </div>
        <div
          className={`release-tag cloud-state-${status?.state ?? 'not_configured'}`}
        >
          {status ? stateLabel(status) : '读取中'}
        </div>
      </header>

      <section className="environment-management-panel">
        <div>
          <strong>本机数据环境</strong>
          <span>切换前会检查待同步操作、备份当前数据库并重启程序</span>
        </div>
        <EnvironmentSwitcher environment={dataEnvironment} compact />
      </section>

      <section className="cloud-status-grid">
        <article className="panel cloud-status-card">
          <span>本机待上传</span>
          <strong>{status?.pendingOperations ?? 0}</strong>
          <small>已在本地事务安全保存，可继续离线营业</small>
        </article>
        <article className="panel cloud-status-card">
          <span>上传需人工核对</span>
          <strong>{status?.pendingConflicts ?? 0}</strong>
          <small>云端已拒绝这些本机操作，再次点击同步不会自动覆盖</small>
        </article>
        <article className="panel cloud-status-card">
          <span>连续确认序号</span>
          <strong>{status?.lastConfirmedDeviceSeq ?? 0}</strong>
          <small>仅业务事实真正落库后才推进</small>
        </article>
        <article className="panel cloud-status-card">
          <span>最近同步成功</span>
          <strong className="cloud-time">
            {formatTime(status?.lastSuccessAt ?? null)}
          </strong>
          <small>后台每 15 秒自动检查一次</small>
        </article>
        <article className="panel cloud-status-card">
          <span>离线财务主收银</span>
          <strong>
            {status?.offlineFinancialWriteAllowed ? '本设备' : '其他设备/未设置'}
          </strong>
          <small>
            租约到期 {formatTime(status?.offlineFinancialLeaseExpiresAt ?? null)}
          </small>
        </article>
        <article className="panel cloud-status-card">
          <span>本地镜像状态</span>
          <strong>{status?.mirrorRepairRequired ? '需要修复' : '正常'}</strong>
          <small>
            镜像游标 {status?.mirrorCursor ?? '0'} · 待确认{' '}
            {status?.pendingOutcomes ?? 0}
          </small>
        </article>
        <article className="panel cloud-status-card">
          <span>待应用云端事件</span>
          <strong>{status?.pendingInboundEvents ?? 0}</strong>
          <small>来自其他设备的事件已安全落库，等待明确的业务合并规则</small>
        </article>
        <article className="panel cloud-status-card">
          <span>云端资料待合并</span>
          <strong>{status?.inboundConflicts ?? 0}</strong>
          <small>普通跨端更新自动刷新；真实差异在此核对处理</small>
        </article>
        <article className="panel cloud-status-card">
          <span>云端拉取游标</span>
          <strong className="cloud-time">{status?.pullCursor ?? '尚未拉取'}</strong>
          <small>只有整页事件成功保存后才会推进</small>
        </article>
      </section>

      <section className="cloud-management-grid">
        <article className="panel cloud-connection-panel">
          <div className="panel-heading">
            <div>
              <h2>{status?.configured ? '重新注册设备' : '注册当前收银设备'}</h2>
              <p>
                正式服务器必须使用 HTTPS。本机开发服务允许使用
                `http://127.0.0.1`。
              </p>
            </div>
          </div>
          <div className="cloud-form-grid">
            <label>
              云端 API 地址
              <input
                autoComplete="url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
            <label>
              一次性设备注册码
              <input
                autoComplete="off"
                type="password"
                value={enrollmentSecret}
                onChange={(event) => setEnrollmentSecret(event.target.value)}
              />
            </label>
          </div>
          <p className="cloud-security-note">
            首台设备向部署管理员获取短期一次性注册码；注册码不会保存，
            长期服务器主密钥不会发送到收银电脑。其他设备使用下方门店加入码。
            服务器返回的设备令牌只由 Electron 主进程使用 Windows 加密存储。
          </p>
          <div className="cloud-actions">
            <button
              className="primary-button"
              disabled={
                loading ||
                baseUrl.trim().length < 8 ||
                enrollmentSecret.length < 32
              }
              type="button"
              onClick={() => void enroll()}
            >
              {status?.configured ? '重新注册并轮换凭证' : '连接并注册设备'}
            </button>
            <button
              className="secondary-button"
              disabled={loading || !status?.configured}
              type="button"
              onClick={() => void syncNow()}
            >
              立即同步
            </button>
            <button
              className="secondary-button"
              disabled={loading || !status?.configured}
              type="button"
              onClick={() => void claimOfflineLease()}
            >
              设为离线财务主收银
            </button>
            <button
              className="danger-button"
              disabled={loading || !status?.configured}
              type="button"
              onClick={() => void prepareEmptyCutover()}
            >
              归档本地库并连接云主库
            </button>
          </div>
          <hr />
          <div className="panel-heading">
            <div>
              <h2>多设备加入同一门店</h2>
              <p>已联网设备由店长生成一次性加入码；新设备输入加入码后建立独立镜像和设备凭据，不会清空云库。</p>
            </div>
          </div>
          {createdPairingCode ? (
            <div className="cloud-pairing-code">
              <strong>{createdPairingCode.code}</strong>
              <small>有效至 {formatTime(createdPairingCode.expiresAt)}</small>
            </div>
          ) : null}
          <div className="cloud-form-grid">
            <label>
              一次性门店加入码
              <input
                autoComplete="off"
                value={pairingCode}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              />
            </label>
          </div>
          <div className="cloud-actions">
            <button
              className="secondary-button"
              disabled={loading || !status?.configured || status.runtimeMode !== 'cloud_online'}
              type="button"
              onClick={() => void createPairingCode()}
            >
              为新设备生成加入码
            </button>
            <button
              className="primary-button"
              disabled={loading || pairingCode.replaceAll('-', '').trim().length !== 16}
              type="button"
              onClick={() => void joinCloudStore()}
            >
              使用加入码加入现有门店
            </button>
          </div>
        </article>

        <article className="panel cloud-detail-panel">
          <div className="panel-heading">
            <div>
              <h2>连接详情</h2>
              <p>这里只显示非敏感状态，不展示设备令牌。</p>
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
          <dl className="cloud-detail-list">
            <div>
              <dt>云端地址</dt>
              <dd>{status?.baseUrl ?? '尚未配置'}</dd>
            </div>
            <div>
              <dt>本机设备号</dt>
              <dd>{status?.deviceId ?? '门店尚未初始化'}</dd>
            </div>
            <div>
              <dt>凭证匹配</dt>
              <dd>{status?.credentialMatchesDevice ? '正常' : '未配置或不匹配'}</dd>
            </div>
            <div>
              <dt>最近上传</dt>
              <dd>{formatTime(status?.lastPushAt ?? null)}</dd>
            </div>
            <div>
              <dt>最近拉取回执</dt>
              <dd>{formatTime(status?.lastPullAt ?? null)}</dd>
            </div>
            <div>
              <dt>冲突操作</dt>
              <dd>{status?.conflictedOperations ?? 0}</dd>
            </div>
          </dl>
          {status?.lastError ? (
            <div className="cloud-error-detail">
              <strong>最近错误</strong>
              <p>{status.lastError}</p>
            </div>
          ) : null}
        </article>
      </section>

      {tenantAdminAvailable ? <section className="panel tenant-admin-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">商户多门店</p>
            <h2>新建门店与员工门店授权</h2>
            <p>新门店始终属于当前商户；普通门店加入码不能创建门店。同一员工可在不同门店拥有不同角色。</p>
          </div>
        </div>
        <div className="tenant-admin-grid">
          <div>
            <h3>创建新门店</h3>
            <label>
              门店名称
              <input
                value={newStoreName}
                maxLength={60}
                placeholder="例如：人民广场店"
                onChange={(event) => setNewStoreName(event.currentTarget.value)}
              />
            </label>
            <button
              className="primary-button"
              disabled={loading || !status?.configured || newStoreName.trim().length < 1}
              type="button"
              onClick={() => void createStore()}
            >
              创建并生成首设备启用码
            </button>
            {storeActivation ? (
              <div className="cloud-pairing-code">
                <span>{storeActivation.storeName}</span>
                <strong>{storeActivation.code}</strong>
                <small>有效至 {formatTime(storeActivation.expiresAt)}</small>
              </div>
            ) : null}
            <ul className="tenant-store-list">
              {tenantStores.map((store) => (
                <li key={store.id}>
                  <strong>{store.name}</strong>
                  <span>{store.currentStore ? '当前门店' : store.status === 'active' ? '已启用' : '已停用'}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>员工门店授权</h3>
            <div className="cloud-form-grid">
              <label>
                员工
                <select value={accessEmployeeId} onChange={(event) => setAccessEmployeeId(event.currentTarget.value)}>
                  {tenantEmployees.map((employee) => (
                    <option key={employee.employeeId} value={employee.employeeId}>
                      {employee.displayName}（{employee.username}）
                    </option>
                  ))}
                </select>
              </label>
              <label>
                门店
                <select value={accessStoreId} onChange={(event) => setAccessStoreId(event.currentTarget.value)}>
                  {tenantStores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
              </label>
              <label>
                角色
                <select value={accessRole} onChange={(event) => setAccessRole(event.currentTarget.value as EmployeeRole)}>
                  <option value="staff">店员</option>
                  <option value="manager">店长</option>
                </select>
              </label>
              <label>
                状态
                <select value={accessStatus} onChange={(event) => setAccessStatus(event.currentTarget.value as EmployeeStatus)}>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <label>
                授权原因
                <input value={accessReason} maxLength={200} onChange={(event) => setAccessReason(event.currentTarget.value)} />
              </label>
            </div>
            <button
              className="primary-button"
              disabled={loading || !accessEmployeeId || !accessStoreId || !accessReason.trim()}
              type="button"
              onClick={() => void updateEmployeeAccess()}
            >
              保存门店授权
            </button>
            <div className="employee-access-list">
              {employeeAccess.map((access) => (
                <div key={`${access.employeeId}:${access.storeId}`}>
                  <strong>{access.displayName}</strong>
                  <span>{access.storeName}</span>
                  <small>{access.role === 'manager' ? '店长' : '店员'} · {access.status === 'active' ? '启用' : '停用'} · v{access.authorizationVersion}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="tenant-admin-grid business-template-grid">
          <div>
            <h3>商户业务模板</h3>
            <label>
              模板类型
              <select value={templateType} onChange={(event) => setTemplateType(event.currentTarget.value as BusinessTemplateType)}>
                <option value="recharge_gift_tier">充值赠送档位</option>
                <option value="monthly_card_plan">月卡方案</option>
                <option value="activity">活动</option>
              </select>
            </label>
            <label>模板名称<input value={templateName} onChange={(event) => setTemplateName(event.currentTarget.value)} /></label>
            <label>模板 JSON<textarea rows={7} value={templatePayload} onChange={(event) => setTemplatePayload(event.currentTarget.value)} /></label>
            <button className="primary-button" disabled={loading || !templateName.trim()} type="button" onClick={() => void saveTemplate()}>
              新建商户模板
            </button>
          </div>
          <div>
            <h3>当前门店覆盖</h3>
            <label>
              来源模板
              <select value={overrideTemplateId} onChange={(event) => setOverrideTemplateId(event.currentTarget.value)}>
                {businessTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name} · {template.templateType}</option>
                ))}
              </select>
            </label>
            <label>覆盖 JSON<textarea rows={7} value={overridePayload} onChange={(event) => setOverridePayload(event.currentTarget.value)} /></label>
            <button className="secondary-button" disabled={loading || !overrideTemplateId} type="button" onClick={() => void saveTemplateOverride()}>
              保存门店覆盖
            </button>
            <div className="employee-access-list">
              {businessTemplates.map((template) => (
                <div key={template.id}>
                  <strong>{template.name}</strong>
                  <span>{template.templateType}</span>
                  <small>{template.overridePayload ? '当前门店已覆盖' : '继承商户模板'}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section> : null}

      <section className="panel inbound-conflict-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">仅保留需要人工判断的冲突</p>
            <h2>云端资料合并</h2>
            <p>正常跨端更新自动刷新。只有无法自动合并的修改才出现在这里；请对照本机和云端的不同字段，再决定采用哪一侧。</p>
          </div>
        </div>
        {inboundConflicts.length === 0 ? (
          <div className="empty-state">当前没有需要人工合并的云端资料。</div>
        ) : (
          <div className="inbound-conflict-list">
            {inboundConflicts.map((conflict) => (
              <article key={conflict.sequence}>
                <div>
                  <strong>{conflictTitle(conflict)}</strong>
                  <span>
                    云端操作：{conflict.eventType}
                  </span>
                  <small>
                    云端时间 {formatTime(conflict.occurredAt)} · 资料编号 {conflict.aggregateId}
                  </small>
                  <p>{conflictDescription(conflict)}</p>
                  <ConflictDiff conflict={conflict} />
                </div>
                {conflict.resolutionSupported !== false ? <div className="cloud-actions">
                  <button
                    className="secondary-button"
                    disabled={loading || conflict.canKeepLocal === false}
                    type="button"
                    onClick={() => {
                      setInboundResolution({ conflict, resolution: 'keep_local' })
                      setInboundResolutionReason('')
                    }}
                  >
                    {conflict.resolutionMode === 'financial_command' ? '保留本机操作并重试' : '保留本机版本'}
                  </button>
                  <button
                    className="primary-button"
                    disabled={loading}
                    type="button"
                    onClick={() => {
                      setInboundResolution({ conflict, resolution: 'apply_cloud' })
                      setInboundResolutionReason('')
                    }}
                  >
                    {conflict.resolutionMode === 'financial_command' ? '采用云端并取消本笔' : '采用云端版本'}
                  </button>
                </div> : <p>请核对实际收款及会员身份，再由店长进行账务更正；保留原始流水供追查。</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      {inboundResolution ? (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="inbound-resolution-title"
            aria-modal="true"
            className="modal-card cloud-conflict-resolution-dialog"
            role="dialog"
            onSubmit={(event) => {
              event.preventDefault()
              void resolveInbound(
                inboundResolution.conflict,
                inboundResolution.resolution,
                inboundResolutionReason
              )
            }}
          >
            <div>
              <p className="eyebrow">云端资料合并确认</p>
              <h2 id="inbound-resolution-title">
                {inboundResolution.resolution === 'apply_cloud'
                  ? '采用云端版本'
                  : '保留本机版本'}
              </h2>
              <p>{conflictTitle(inboundResolution.conflict)}</p>
              <p>{conflictDescription(inboundResolution.conflict)}</p>
              <ConflictDiff conflict={inboundResolution.conflict} />
            </div>
            <label>
              <span>处理原因（2–200 字）</span>
              <textarea
                autoFocus
                maxLength={200}
                minLength={2}
                required
                rows={4}
                value={inboundResolutionReason}
                onChange={(event) => setInboundResolutionReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary-button"
                disabled={loading}
                type="button"
                onClick={() => {
                  setInboundResolution(null)
                  setInboundResolutionReason('')
                }}
              >
                取消
              </button>
              <button className="primary-button" disabled={loading} type="submit">
                {loading ? '处理中…' : '确认处理'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <section className="panel application-update-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PC 客户端在线升级</p>
            <h2>程序更新</h2>
            <p>
              启动时会自动检查更新，无需登录；选择立即更新后下载并安装，安装前自动创建数据库保护备份。
            </p>
          </div>
          <div className={`release-tag update-state-${updateStatus?.state ?? 'disabled'}`}>
            {updateStatus?.state === 'checking'
              ? '检查中'
              : updateStatus?.state === 'available'
                ? '有新版本'
                : updateStatus?.state === 'downloading'
                  ? '下载中'
                  : updateStatus?.state === 'downloaded'
                    ? '等待安装'
                    : updateStatus?.state === 'error'
                      ? '更新异常'
                      : updateStatus?.state === 'idle'
                        ? '已启用'
                        : '未启用'}
          </div>
        </div>
        <div className="application-update-details">
          <div>
            <span>当前版本</span>
            <strong>{updateStatus?.currentVersion ?? '-'}</strong>
          </div>
          <div>
            <span>可用版本</span>
            <strong>{updateStatus?.availableVersion ?? '暂无'}</strong>
          </div>
          <div>
            <span>下载进度</span>
            <strong>
              {updateStatus?.downloadPercent === null ||
              updateStatus?.downloadPercent === undefined
                ? '-'
                : `${updateStatus.downloadPercent.toFixed(1)}%`}
            </strong>
          </div>
        </div>
        {updateStatus?.state === 'downloading' ? (
          <progress
            className="application-update-progress"
            max={100}
            value={updateStatus.downloadPercent ?? 0}
          />
        ) : null}
        {updateStatus?.lastError ? (
          <div className="cloud-error-detail">
            <strong>最近更新错误</strong>
            <p>{updateStatus.lastError}</p>
          </div>
        ) : null}
        <div className="cloud-actions">
          <button
            className="secondary-button"
            disabled={
              loading ||
              updateStatus?.state === 'disabled' ||
              updateStatus?.state === 'downloading'
            }
            type="button"
            onClick={() => void checkUpdate()}
          >
            检查更新
          </button>
          <button
            className="secondary-button"
            disabled={loading || updateStatus?.state !== 'available'}
            type="button"
            onClick={() => void downloadUpdate()}
          >
            下载更新
          </button>
          <button
            className="primary-button"
            disabled={loading || updateStatus?.state !== 'downloaded'}
            type="button"
            onClick={() => void installUpdate()}
          >
            重启并安装
          </button>
        </div>
      </section>
    </>
  )
}
