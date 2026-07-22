import { useEffect, useState, type FormEvent } from 'react'
import type { ApplicationState, DataEnvironment, SessionUser } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import { DeviceOnboardingPanel } from './DeviceOnboardingPanel'

type Props = {
  onLogin(session: SessionUser): void
  environment: DataEnvironment
  onStateChange(state: ApplicationState): void
}

export function LoginScreen({ onLogin, environment, onStateChange }: Props): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberPassword, setRememberPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showDeviceSettings, setShowDeviceSettings] = useState(false)

  useEffect(() => {
    getDesktopApi()
      .getSavedLogin()
      .then((credentials) => {
        if (!credentials) return
        setUsername(credentials.username)
        setPassword(credentials.password)
        setRememberPassword(true)
      })
      .catch((reason: unknown) => setError(readableError(reason)))
  }, [])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      onLogin(
        await getDesktopApi().login({
          username,
          password,
          rememberPassword
        })
      )
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-layout login-layout">
      <section className="auth-story">
        <div className="brand large">
          <span className="brand-mark">ZY</span>
          <div>
            <strong>桌游吧管理收银</strong>
            <small>PC 本地经营版</small>
          </div>
        </div>
        <div className="story-copy">
          <p className="eyebrow light">离线可用</p>
          <h1>开店、收银、记账，都从这里开始。</h1>
          <p>员工账号只在授权范围内操作；停用账号后立即禁止再次登录，历史记录仍完整保留。</p>
        </div>
      </section>

      <section className="auth-panel">
        {showDeviceSettings ? (
          <DeviceOnboardingPanel
            environment={environment}
            onComplete={onStateChange}
            onCancel={() => setShowDeviceSettings(false)}
          />
        ) : (
        <form className="form-card login-card" onSubmit={(event) => void submit(event)}>
          <div className="form-heading">
            <span>员工入口</span>
            <h2>登录门店</h2>
            <p>请输入店长分配的账号和密码。</p>
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <label>
            <span>登录账号</span>
            <input
              required
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </label>
          <label className="checkbox-field login-remember">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.currentTarget.checked)}
            />
            <span>在这台收银电脑上保存密码</span>
          </label>
          <p className="login-security-hint">
            密码使用当前 Windows 用户的系统密钥加密保存。
          </p>
          <p className="login-security-hint">
            请先在页面顶部选择生产或测试环境。首次云端接入需由店长登录后使用一次性设备注册码；其他电脑使用已联网设备生成的门店加入码。
          </p>
          <button className="primary-button full" disabled={submitting} type="submit">
            {submitting ? '正在登录...' : '登录'}
          </button>
          <button
            className="secondary-button full"
            type="button"
            onClick={() => setShowDeviceSettings(true)}
          >
            设备与门店设置
          </button>
        </form>
        )}
      </section>
    </div>
  )
}
