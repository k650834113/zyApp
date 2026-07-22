import { useEffect, useState, type FormEvent } from 'react'
import type { ApplicationState, DataEnvironment } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import { configuredCloudBaseUrl } from '../../shared/public-endpoints'

type Props = {
  environment: DataEnvironment
  onComplete(state: ApplicationState): void
  onCancel?(): void
}

export function DeviceOnboardingPanel({
  environment,
  onComplete,
  onCancel
}: Props): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(
    configuredCloudBaseUrl(environment)
  )
  const [pairingCode, setPairingCode] = useState('')
  const [requestId, setRequestId] = useState<string>(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getDesktopApi().getDeviceOnboardingState().then((state) => {
      if (state.baseUrl) setBaseUrl(state.baseUrl)
      if (state.requestId) setRequestId(state.requestId)
      if (state.lastError) setError(state.lastError)
    }).catch((reason: unknown) => setError(readableError(reason)))
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await getDesktopApi().joinCloudStoreBeforeLogin({
        requestId,
        baseUrl,
        pairingCode
      })
      onComplete(await getDesktopApi().getApplicationState())
      onCancel?.()
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form-card login-card" onSubmit={(event) => void submit(event)}>
      <div className="form-heading">
        <span>设备与门店设置</span>
        <h2>加入已有云门店</h2>
        <p>无需创建临时门店或临时店长。已有门店使用 15 分钟加入码；商户管理员新建门店后使用 30 分钟启用码。</p>
      </div>
      <div className="form-info">
        当前环境：{environment === 'production' ? '生产环境' : '测试环境'}。加入码只能用于对应环境。
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <label>
        <span>云端地址</span>
        <input
          required
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>门店加入码 / 新门店启用码</span>
        <input
          required
          autoFocus
          autoComplete="off"
        placeholder="输入 16 位加入码或 32 位启用码"
          value={pairingCode}
          onChange={(event) => setPairingCode(event.currentTarget.value.toUpperCase())}
        />
      </label>
      <p className="login-security-hint">
        加入成功后将建立独立 SQLite 镜像，并使用云端已有员工账号首次在线登录。
      </p>
      <button className="primary-button full" disabled={submitting} type="submit">
        {submitting ? '正在加入并建立镜像...' : '加入门店'}
      </button>
      {onCancel ? (
        <button className="secondary-button full" disabled={submitting} type="button" onClick={onCancel}>
          返回
        </button>
      ) : null}
    </form>
  )
}
