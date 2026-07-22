import { useEffect, useState } from 'react'
import type {
  StoreBusinessStatusOverride,
  StoreProfileSummary
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

function timeValue(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(
    minute % 60
  ).padStart(2, '0')}`
}

function minuteValue(value: string): number {
  const parts = value.split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1])
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error('营业时间格式不正确')
  }
  return hour * 60 + minute
}

type Props = {
  onStoreNameChanged(name: string): void
}

export function StoreProfilePage({
  onStoreNameChanged
}: Props): React.JSX.Element {
  const [profile, setProfile] = useState<StoreProfileSummary | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [openingTime, setOpeningTime] = useState('13:00')
  const [closingTime, setClosingTime] = useState('23:00')
  const [statusOverride, setStatusOverride] =
    useState<StoreBusinessStatusOverride>('automatic')
  const [customStatusText, setCustomStatusText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function loadForm(next: StoreProfileSummary): void {
    setProfile(next)
    setName(next.name)
    setAddress(next.address ?? '')
    setContactPhone(next.contactPhone ?? '')
    setOpeningTime(timeValue(next.businessOpenMinute))
    setClosingTime(timeValue(next.businessCloseMinute))
    setStatusOverride(next.statusOverride)
    setCustomStatusText(next.customStatusText ?? '')
  }

  function showError(reason: unknown): void {
    setError(readableError(reason))
    window.setTimeout(() => setError(null), 10_000)
  }

  useEffect(() => {
    void getDesktopApi()
      .getStoreProfile()
      .then(loadForm)
      .catch(showError)
  }, [])

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await getDesktopApi().updateStoreProfile({
        name,
        address,
        contactPhone,
        businessOpenMinute: minuteValue(openingTime),
        businessCloseMinute: minuteValue(closingTime),
        statusOverride,
        customStatusText,
        reason: '店长更新门店公开资料'
      })
      loadForm(updated)
      onStoreNameChanged(updated.name)
      setNotice('门店资料已保存，将在联网后同步到顾客端。')
      window.setTimeout(() => setNotice(null), 10_000)
    } catch (reason) {
      showError(reason)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      {error ? <div className="viewport-toast error">{error}</div> : null}
      {notice ? <div className="viewport-toast success">{notice}</div> : null}

      <header className="page-header">
        <div>
          <p className="eyebrow">PC 与小程序共用资料</p>
          <h1>门店设置</h1>
        </div>
        <div className="release-tag">店长可编辑</div>
      </header>

      <section className="store-profile-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>公开资料</h2>
              <p>这些内容会显示在后续顾客微信小程序中。</p>
            </div>
          </div>
          <div className="field-grid two-columns">
            <label>
              门店名称
              <input
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              联系电话
              <input
                maxLength={50}
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
              />
            </label>
          </div>
          <label>
            门店地址
            <input
              maxLength={300}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          <div className="field-grid two-columns">
            <label>
              每日开始营业
              <input
                type="time"
                value={openingTime}
                onChange={(event) => setOpeningTime(event.target.value)}
              />
            </label>
            <label>
              每日结束营业
              <input
                type="time"
                value={closingTime}
                onChange={(event) => setClosingTime(event.target.value)}
              />
            </label>
          </div>
          <div className="field-grid two-columns">
            <label>
              当前营业状态
              <select
                value={statusOverride}
                onChange={(event) =>
                  setStatusOverride(
                    event.target.value as StoreBusinessStatusOverride
                  )
                }
              >
                <option value="automatic">按营业时间自动判断</option>
                <option value="open">临时强制显示营业中</option>
                <option value="closed">临时强制显示休息中</option>
              </select>
            </label>
            <label>
              自定义状态文字
              <input
                maxLength={100}
                placeholder="留空则显示今日营业中/当前休息中"
                value={customStatusText}
                onChange={(event) => setCustomStatusText(event.target.value)}
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              className="primary-button"
              disabled={saving || !profile}
              type="button"
              onClick={() => void save()}
            >
              {saving ? '保存中...' : '保存门店资料'}
            </button>
          </div>
        </article>

        <article className="panel store-profile-preview">
          <div className="panel-heading">
            <div>
              <h2>当前配置</h2>
              <p>营业时段支持跨过午夜，例如 18:00 至次日 02:00。</p>
            </div>
          </div>
          <dl className="cloud-detail-list">
            <div>
              <dt>营业时间</dt>
              <dd>{openingTime}-{closingTime}</dd>
            </div>
            <div>
              <dt>判断方式</dt>
              <dd>
                {statusOverride === 'automatic'
                  ? '自动'
                  : statusOverride === 'open'
                    ? '强制营业'
                    : '强制休息'}
              </dd>
            </div>
            <div>
              <dt>状态文字</dt>
              <dd>{customStatusText.trim() || '使用系统默认文字'}</dd>
            </div>
            <div>
              <dt>最近保存</dt>
              <dd>
                {profile
                  ? new Date(profile.updatedAt).toLocaleString('zh-CN')
                  : '读取中'}
              </dd>
            </div>
          </dl>
        </article>
      </section>
    </section>
  )
}
