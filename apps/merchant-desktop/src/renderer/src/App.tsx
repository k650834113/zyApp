import { useEffect, useState } from 'react'
import type { ApplicationState, SessionUser } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'
import { AppShell } from './AppShell'
import { LoginScreen } from './LoginScreen'
import { SetupScreen } from './SetupScreen'
import { EnvironmentSwitcher } from './EnvironmentSwitcher'
import { DeviceOnboardingPanel } from './DeviceOnboardingPanel'
import { StoreProfileSwitcher } from './StoreProfileSwitcher'

export function App(): React.JSX.Element {
  const [state, setState] = useState<ApplicationState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [entryMode, setEntryMode] = useState<'offline' | 'cloud'>('offline')

  useEffect(() => {
    getDesktopApi().getApplicationState().then(setState).catch((reason: unknown) => {
      setError(readableError(reason))
    })
  }, [])

  if (error) {
    return (
      <div className="fatal-screen">
        <div className="form-card">
          <p className="eyebrow">启动失败</p>
          <h1>本地服务没有准备好</h1>
          <div className="form-error">{error}</div>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="loading-screen">
        <span className="loading-mark">ZY</span>
        <p>正在检查本地数据库...</p>
      </div>
    )
  }

  if (!state.initialized) {
    return (
      <div className="environment-entry">
        <EnvironmentSwitcher environment={state.system.dataEnvironment} />
        <StoreProfileSwitcher
          activeProfileId={state.system.activeStoreProfileId}
          onStateChange={setState}
        />
        <div className="entry-mode-actions">
          <button
            className={entryMode === 'offline' ? 'primary-button' : 'secondary-button'}
            type="button"
            onClick={() => setEntryMode('offline')}
          >
            建立纯离线门店
          </button>
          <button
            className={entryMode === 'cloud' ? 'primary-button' : 'secondary-button'}
            type="button"
            onClick={() => setEntryMode('cloud')}
          >
            设备与门店设置
          </button>
        </div>
        {entryMode === 'offline' ? (
          <SetupScreen onComplete={setState} />
        ) : (
          <DeviceOnboardingPanel
            environment={state.system.dataEnvironment}
            onComplete={setState}
          />
        )}
      </div>
    )
  }

  if (!state.session) {
    return (
      <div className="environment-entry">
        <EnvironmentSwitcher environment={state.system.dataEnvironment} />
        <StoreProfileSwitcher
          activeProfileId={state.system.activeStoreProfileId}
          onStateChange={setState}
        />
        <LoginScreen
          onLogin={(session: SessionUser) => setState({ ...state, session })}
          environment={state.system.dataEnvironment}
          onStateChange={setState}
        />
      </div>
    )
  }

  return <AppShell state={state} onLogout={() => setState({ ...state, session: null })} />
}
