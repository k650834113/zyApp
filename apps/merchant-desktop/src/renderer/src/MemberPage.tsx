import { useEffect, useState, type FormEvent } from 'react'
import type {
  CreateMemberRequest,
  MemberSummary,
  MemberTier,
  SessionUser
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type Action =
  | { type: 'tier'; member: MemberSummary; tier: MemberTier }
  | { type: 'birthday'; member: MemberSummary }
  | { type: 'disable'; member: MemberSummary }

const emptyCreateRequest: CreateMemberRequest = {
  phone: '',
  nickname: '',
  confirmedAtLeast14: true,
  note: ''
}

function birthdayText(member: MemberSummary): string {
  if (member.birthdayMonth === null || member.birthdayDay === null) {
    return '未登记'
  }
  return `${member.birthdayMonth} 月 ${member.birthdayDay} 日`
}

export function MemberPage({ session }: { session: SessionUser }): React.JSX.Element {
  const [members, setMembers] = useState<MemberSummary[]>([])
  const [query, setQuery] = useState('')
  const [createRequest, setCreateRequest] = useState<CreateMemberRequest>(emptyCreateRequest)
  const [createBirthdayMonth, setCreateBirthdayMonth] = useState('')
  const [createBirthdayDay, setCreateBirthdayDay] = useState('')
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [birthdayMonth, setBirthdayMonth] = useState('1')
  const [birthdayDay, setBirthdayDay] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(searchQuery = query): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setMembers(await getDesktopApi().searchMembers({ query: searchQuery, limit: 50 }))
    } catch (reasonValue) {
      setError(readableError(reasonValue))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('')
  }, [])

  async function submitSearch(event: FormEvent): Promise<void> {
    event.preventDefault()
    await load(query)
  }

  async function submitCreate(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setNotice(null)
    try {
      const birthdayMonth = createBirthdayMonth.trim()
      const birthdayDay = createBirthdayDay.trim()
      const createPayload: CreateMemberRequest = { ...createRequest }
      if (birthdayMonth || birthdayDay) {
        if (!birthdayMonth || !birthdayDay) {
          throw new Error('生日月份和日期需要同时填写')
        }
        createPayload.birthdayMonth = Number(birthdayMonth)
        createPayload.birthdayDay = Number(birthdayDay)
      }
      const restored = members.some(
        (member) => member.phone === createPayload.phone && member.status === 'disabled'
      )
      const member = await getDesktopApi().createMember(createPayload)
      setMembers((current) =>
        current.some((item) => item.id === member.id)
          ? current.map((item) => (item.id === member.id ? member : item))
          : [member, ...current]
      )
      setCreateRequest(emptyCreateRequest)
      setCreateBirthdayMonth('')
      setCreateBirthdayDay('')
      setNotice(`会员 ${member.nickname} 已${restored ? '恢复' : '建立'}`)
    } catch (reasonValue) {
      setError(readableError(reasonValue))
    }
  }

  function replaceMember(updated: MemberSummary): void {
    setMembers((current) =>
      current.map((member) => (member.id === updated.id ? updated : member))
    )
  }

  async function submitAction(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!action) {
      return
    }
    setError(null)
    setNotice(null)
    try {
      const updated =
        action.type === 'tier'
          ? await getDesktopApi().adjustMemberTier({
              memberId: action.member.id,
              tier: action.tier,
              reason
            })
          : action.type === 'birthday'
            ? await getDesktopApi().correctMemberBirthday({
                memberId: action.member.id,
                month: Number(birthdayMonth),
                day: Number(birthdayDay),
                reason
              })
            : await getDesktopApi().disableMember({
                memberId: action.member.id,
                reason
              })
      replaceMember(updated)
      setNotice(
        action.type === 'tier'
          ? `${updated.nickname} 已调整为${updated.tier === 'advanced' ? '高级会员' : '普通会员'}`
          : action.type === 'birthday'
            ? `${updated.nickname} 的生日已修正`
            : `${updated.nickname} 已注销`
      )
      setAction(null)
      setReason('')
    } catch (reasonValue) {
      setError(readableError(reasonValue))
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">会员资料</p>
          <h1>会员中心</h1>
        </div>
        <div className="release-tag">当前显示 {members.length} 人</div>
      </header>

      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <section className="member-layout">
        <article className="panel">
          <form className="member-search" onSubmit={(event) => void submitSearch(event)}>
            <label>
              <span>手机号、会员号或昵称</span>
              <input
                maxLength={60}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="留空可查看最近更新的会员"
              />
            </label>
            <button className="primary-button" type="submit">查询</button>
          </form>

          <div className="member-table">
            <div className="member-row table-head">
              <span>会员</span>
              <span>状态</span>
              <span>等级</span>
              <span>生日</span>
              <span>备注</span>
              <span>操作</span>
            </div>
            {loading ? <div className="empty-row">正在读取会员...</div> : null}
            {!loading && members.length === 0 ? (
              <div className="empty-row">没有找到会员</div>
            ) : null}
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <div>
                  <strong>{member.nickname}</strong>
                  <small>{member.phone} · {member.memberNumber}</small>
                  {member.ageGate === 'recharge_disabled' ? (
                    <small className="member-age-warning">
                      未完成监护人核验，禁止储值充值
                    </small>
                  ) : null}
                </div>
                <span className={`status-pill ${member.status}`}>
                  {member.status === 'active' ? '启用' : '已注销'}
                </span>
                <span className={`tier-pill ${member.tier}`}>
                  {member.tier === 'advanced' ? '高级' : '普通'}
                </span>
                <span>{birthdayText(member)}</span>
                <span className="member-note">{member.note || '无'}</span>
                <div className="row-actions">
                  {member.status === 'active' ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setAction({
                          type: 'tier',
                          member,
                          tier: member.tier === 'advanced' ? 'ordinary' : 'advanced'
                        })
                      }
                    >
                      调整等级
                    </button>
                  ) : null}
                  {session.role === 'manager' && member.status === 'active' ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setBirthdayMonth(String(member.birthdayMonth ?? 1))
                        setBirthdayDay(String(member.birthdayDay ?? 1))
                        setAction({ type: 'birthday', member })
                      }}
                    >
                      修正生日
                    </button>
                  ) : null}
                  {session.role === 'manager' && member.status === 'active' ? (
                    <button
                      className="text-button danger-text"
                      type="button"
                      onClick={() => setAction({ type: 'disable', member })}
                    >
                      注销会员
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </article>

        <form className="panel create-member" onSubmit={(event) => void submitCreate(event)}>
          <div className="panel-heading">
            <div>
              <h2>新增会员</h2>
              <p>线下建会员默认已确认满 14 周岁；手机号是会员唯一身份。</p>
            </div>
          </div>
          <label>
            <span>手机号</span>
            <input
              required
              inputMode="numeric"
              pattern="1[0-9]{10}"
              minLength={11}
              maxLength={11}
              value={createRequest.phone}
              onChange={(event) =>
                setCreateRequest({ ...createRequest, phone: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>昵称</span>
            <input
              required
              maxLength={40}
              value={createRequest.nickname}
              onChange={(event) =>
                setCreateRequest({ ...createRequest, nickname: event.currentTarget.value })
              }
            />
          </label>
          <div className="field-grid two-columns">
            <label>
              <span>生日月份（选填）</span>
              <input
                inputMode="numeric"
                min={1}
                max={12}
                type="number"
                value={createBirthdayMonth}
                onChange={(event) => setCreateBirthdayMonth(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>生日日期（选填）</span>
              <input
                inputMode="numeric"
                min={1}
                max={31}
                type="number"
                value={createBirthdayDay}
                onChange={(event) => setCreateBirthdayDay(event.currentTarget.value)}
              />
            </label>
          </div>
          <label>
            <span>内部备注（选填）</span>
            <textarea
              maxLength={500}
              value={createRequest.note ?? ''}
              onChange={(event) =>
                setCreateRequest({ ...createRequest, note: event.currentTarget.value })
              }
            />
          </label>
          <label className="checkbox-field">
            <input
              required
              type="checkbox"
              checked={createRequest.confirmedAtLeast14}
              onChange={(event) =>
                setCreateRequest({
                  ...createRequest,
                  confirmedAtLeast14: event.currentTarget.checked
                })
              }
            />
            <span>已询问并确认顾客已满 14 周岁</span>
          </label>
          <button className="primary-button full" type="submit">建立普通会员</button>
        </form>
      </section>

      {action ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={(event) => void submitAction(event)}>
            <div className="form-heading">
              <span>{action.type === 'tier' ? '会员等级' : '店长操作'}</span>
              <h2>
                {action.type === 'tier'
                  ? `将 ${action.member.nickname} 调整为${
                      action.tier === 'advanced' ? '高级会员' : '普通会员'
                    }`
                  : action.type === 'birthday'
                    ? `修正 ${action.member.nickname} 的生日`
                    : `注销 ${action.member.nickname}`}
              </h2>
            </div>
            {action.type === 'birthday' ? (
              <div className="field-grid two-columns">
                <label>
                  <span>月</span>
                  <input
                    required
                    type="number"
                    min={1}
                    max={12}
                    value={birthdayMonth}
                    onChange={(event) => setBirthdayMonth(event.currentTarget.value)}
                  />
                </label>
                <label>
                  <span>日</span>
                  <input
                    required
                    type="number"
                    min={1}
                    max={31}
                    value={birthdayDay}
                    onChange={(event) => setBirthdayDay(event.currentTarget.value)}
                  />
                </label>
              </div>
            ) : null}
            <label>
              <span>
                {action.type === 'tier'
                  ? '调整原因'
                  : action.type === 'birthday'
                    ? '修正原因'
                    : '注销原因'}
              </span>
              <textarea
                required
                autoFocus={action.type !== 'birthday'}
                minLength={2}
                maxLength={200}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setAction(null)}>
                取消
              </button>
              <button className="primary-button" type="submit">确认</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
