import { useEffect, useState } from 'react'
import type {
  ApplicationState,
  StoreConfigurationSummary
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type Props = {
  activeProfileId: string
  onStateChange(state: ApplicationState): void
}

export function StoreProfileSwitcher({
  activeProfileId,
  onStateChange
}: Props): React.JSX.Element {
  const [profiles, setProfiles] = useState<StoreConfigurationSummary[]>([])
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDesktopApi()
      .listStoreProfiles()
      .then(setProfiles)
      .catch((reason: unknown) => setError(readableError(reason)))
  }, [activeProfileId])

  async function switchTo(profileId: string): Promise<void> {
    if (profileId === activeProfileId) return
    setSwitching(true)
    setError(null)
    try {
      const state = await getDesktopApi().switchStoreProfile({ profileId })
      onStateChange(state)
      setProfiles(await getDesktopApi().listStoreProfiles())
    } catch (reason) {
      setError(readableError(reason))
    } finally {
      setSwitching(false)
    }
  }

  const active = profiles.find((profile) => profile.profileId === activeProfileId)

  return (
    <div className="store-profile-switcher">
      <div className="store-profile-copy">
        <strong>当前门店</strong>
        <span>{active?.storeName ?? '正在读取门店配置...'}</span>
      </div>
      {profiles.length > 1 ? (
        <label>
          <span>登录前切换</span>
          <select
            aria-label="选择门店"
            disabled={switching}
            value={activeProfileId}
            onChange={(event) => void switchTo(event.currentTarget.value)}
          >
            {profiles.map((profile) => (
              <option key={profile.profileId} value={profile.profileId}>
                {profile.storeName}{profile.initialized ? '' : '（未初始化）'}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="store-profile-isolation">已启用独立门店数据配置</span>
      )}
      {switching ? <span className="store-profile-status">正在安全切换...</span> : null}
      {error ? <span className="environment-error">{error}</span> : null}
    </div>
  )
}
