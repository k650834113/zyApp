import { useState, type FormEvent } from 'react'
import type { ApplicationState, BootstrapStoreRequest } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type Props = {
  onComplete(state: ApplicationState): void
}

const initialRequest: BootstrapStoreRequest = {
  storeName: '',
  deviceName: '主收银台',
  managerUsername: 'manager',
  managerDisplayName: '',
  managerPassword: ''
}

export function SetupScreen({ onComplete }: Props): React.JSX.Element {
  const [request, setRequest] = useState(initialRequest)
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    if (request.managerPassword !== passwordConfirmation) {
      setError('两次输入的店长密码不一致')
      return
    }

    setSubmitting(true)
    try {
      onComplete(await getDesktopApi().bootstrapStore(request))
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="brand large">
          <span className="brand-mark">ZY</span>
          <div>
            <strong>桌游吧管理收银</strong>
            <small>PC 本地经营版</small>
          </div>
        </div>
        <div className="story-copy">
          <p className="eyebrow light">首次启动</p>
          <h1>先把门店和第一位店长安顿好。</h1>
          <p>这些资料保存在当前环境，完成后即可离线登录。首台设备接入云端时会归档旧业务并建立空云镜像；其他电脑应使用门店加入码。</p>
        </div>
        <div className="security-note">
          <strong>本地可靠性</strong>
          <span>密码使用 scrypt 哈希保存，初始化、审计和同步操作在同一事务中完成。</span>
        </div>
      </section>

      <section className="auth-panel">
        <form className="form-card setup-card" onSubmit={(event) => void submit(event)}>
          <div className="form-heading">
            <span>步骤 1 / 1</span>
            <h2>初始化门店</h2>
            <p>以后只有店长能修改员工、价格和经营配置。</p>
          </div>

          {error ? <div className="form-error">{error}</div> : null}

          <div className="field-grid two-columns">
            <label>
              <span>门店名称</span>
              <input
                required
                maxLength={60}
                autoFocus
                value={request.storeName}
                onChange={(event) =>
                  setRequest({ ...request, storeName: event.currentTarget.value })
                }
                placeholder="例如：欢乐桌游吧"
              />
            </label>
            <label>
              <span>设备名称</span>
              <input
                required
                maxLength={60}
                value={request.deviceName}
                onChange={(event) =>
                  setRequest({ ...request, deviceName: event.currentTarget.value })
                }
              />
            </label>
          </div>

          <div className="divider"><span>店长账号</span></div>

          <div className="field-grid two-columns">
            <label>
              <span>店长姓名</span>
              <input
                required
                maxLength={40}
                value={request.managerDisplayName}
                onChange={(event) =>
                  setRequest({ ...request, managerDisplayName: event.currentTarget.value })
                }
                placeholder="用于操作记录"
              />
            </label>
            <label>
              <span>登录账号</span>
              <input
                required
                minLength={3}
                maxLength={32}
                value={request.managerUsername}
                onChange={(event) =>
                  setRequest({ ...request, managerUsername: event.currentTarget.value })
                }
              />
            </label>
            <label>
              <span>店长密码</span>
              <input
                required
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={request.managerPassword}
                onChange={(event) =>
                  setRequest({ ...request, managerPassword: event.currentTarget.value })
                }
                placeholder="至少 8 位，包含文字和数字"
              />
            </label>
            <label>
              <span>确认密码</span>
              <input
                required
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.currentTarget.value)}
              />
            </label>
          </div>

          <button className="primary-button full" disabled={submitting} type="submit">
            {submitting ? '正在初始化...' : '完成初始化'}
          </button>
        </form>
      </section>
    </div>
  )
}
