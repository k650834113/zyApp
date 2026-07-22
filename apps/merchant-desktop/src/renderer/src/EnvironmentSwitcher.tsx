import { useState } from 'react'
import type { DataEnvironment } from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type Props = {
  environment: DataEnvironment
  compact?: boolean
}

export function EnvironmentSwitcher({
  environment,
  compact = false
}: Props): React.JSX.Element {
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function switchTo(target: DataEnvironment): Promise<void> {
    if (target === environment) return
    setSwitching(true)
    setError(null)
    try {
      await getDesktopApi().switchDataEnvironment({ environment: target })
    } catch (reason) {
      setError(readableError(reason))
      setSwitching(false)
    }
  }

  return (
    <div
      className={`environment-switcher environment-${environment} ${
        compact ? 'compact' : ''
      }`}
    >
      <div className="environment-copy">
        <strong>{environment === 'production' ? '生产环境' : '测试环境'}</strong>
        {!compact ? (
          <span>
            {environment === 'production'
              ? '正式经营数据'
              : '练习数据，不计入正式经营'}
          </span>
        ) : null}
      </div>
      <div className="environment-segments" role="group" aria-label="数据环境">
        <button
          className={environment === 'production' ? 'active' : ''}
          disabled={switching}
          type="button"
          onClick={() => void switchTo('production')}
        >
          生产
        </button>
        <button
          className={environment === 'test' ? 'active' : ''}
          disabled={switching}
          type="button"
          onClick={() => void switchTo('test')}
        >
          测试
        </button>
      </div>
      {error ? <span className="environment-error">{error}</span> : null}
    </div>
  )
}
