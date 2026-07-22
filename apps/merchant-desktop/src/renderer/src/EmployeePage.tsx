import { useEffect, useState, type FormEvent } from 'react'
import type {
  CreateEmployeeRequest,
  EmployeeStatus,
  EmployeeSummary,
  SessionUser
} from '@zyapp/contracts'
import { getDesktopApi, readableError } from './api'

type Action =
  | { type: 'status'; employee: EmployeeSummary; status: EmployeeStatus }
  | { type: 'password'; employee: EmployeeSummary }
  | {
      type: 'mobile'
      employee: EmployeeSummary
      mode: 'enable' | 'reset' | 'disable'
    }

const emptyCreateRequest: CreateEmployeeRequest = {
  username: '',
  displayName: '',
  password: '',
  role: 'staff'
}

export function EmployeePage({ session }: { session: SessionUser }): React.JSX.Element {
  const [employees, setEmployees] = useState<EmployeeSummary[]>([])
  const [createRequest, setCreateRequest] = useState(emptyCreateRequest)
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setEmployees(await getDesktopApi().listEmployees())
    } catch (reasonValue) {
      setError(readableError(reasonValue))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function submitCreate(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setNotice(null)
    try {
      const employee = await getDesktopApi().createEmployee(createRequest)
      setEmployees((current) => [...current, employee])
      setCreateRequest(emptyCreateRequest)
      setNotice(`员工 ${employee.displayName} 已创建`)
    } catch (reasonValue) {
      setError(readableError(reasonValue))
    }
  }

  async function submitAction(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!action) {
      return
    }

    setError(null)
    setNotice(null)
    try {
      if (action.type === 'status') {
        const updated = await getDesktopApi().setEmployeeStatus({
          employeeId: action.employee.id,
          status: action.status,
          reason
        })
        setEmployees((current) =>
          current.map((employee) => (employee.id === updated.id ? updated : employee))
        )
        setNotice(
          `${updated.displayName} 已${updated.status === 'active' ? '启用' : '停用'}`
        )
      } else if (action.type === 'password') {
        await getDesktopApi().resetEmployeePassword({
          employeeId: action.employee.id,
          newPassword,
          reason
        })
        setNotice(`${action.employee.displayName} 的密码已重置`)
      } else {
        const updated = await getDesktopApi().configureEmployeeMobileAccess({
          employeeId: action.employee.id,
          enabled: action.mode !== 'disable',
          ...(action.mode !== 'disable' ? { newPassword } : {}),
          reason
        })
        setEmployees((current) =>
          current.map((employee) => (employee.id === updated.id ? updated : employee))
        )
        setNotice(
          action.mode === 'disable'
            ? `${updated.displayName} 的移动登录已关闭`
            : `${updated.displayName} 的移动登录密码已设置`
        )
      }
      setAction(null)
      setReason('')
      setNewPassword('')
    } catch (reasonValue) {
      setError(readableError(reasonValue))
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">店长功能</p>
          <h1>员工与权限</h1>
        </div>
        <div className="release-tag">{employees.length} 个账号</div>
      </header>

      {error ? <div className="form-error page-message">{error}</div> : null}
      {notice ? <div className="success-banner page-message">{notice}</div> : null}

      <section className="management-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>员工账号</h2>
              <p>停用后立即禁止重新登录，历史操作不会删除。</p>
            </div>
          </div>
          <div className="employee-table">
            <div className="employee-row table-head">
              <span>员工</span>
              <span>角色</span>
              <span>状态</span>
              <span>移动登录</span>
              <span>操作</span>
            </div>
            {loading ? <div className="empty-row">正在读取员工...</div> : null}
            {!loading && employees.length === 0 ? (
              <div className="empty-row">暂无员工账号</div>
            ) : null}
            {employees.map((employee) => (
              <div className="employee-row" key={employee.id}>
                <div>
                  <strong>{employee.displayName}</strong>
                  <small>@{employee.username}</small>
                </div>
                <span>{employee.role === 'manager' ? '店长' : '店员'}</span>
                <span className={`status-pill ${employee.status}`}>
                  {employee.status === 'active' ? '启用' : '停用'}
                </span>
                <span className={`status-pill ${employee.mobileAccessEnabled ? 'active' : 'disabled'}`}>
                  {employee.mobileAccessEnabled ? '已开启' : '未开启'}
                </span>
                <div className="row-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setAction({ type: 'password', employee })}
                  >
                    重置密码
                  </button>
                  {employee.mobileAccessEnabled ? (
                    <>
                      <button
                        className="text-button"
                        disabled={employee.status !== 'active'}
                        type="button"
                        onClick={() =>
                          setAction({ type: 'mobile', employee, mode: 'reset' })
                        }
                      >
                        重设移动密码
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          setAction({ type: 'mobile', employee, mode: 'disable' })
                        }
                      >
                        关闭移动登录
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-button"
                      disabled={employee.status !== 'active'}
                      type="button"
                      onClick={() =>
                        setAction({ type: 'mobile', employee, mode: 'enable' })
                      }
                    >
                      启用移动登录
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={employee.id === session.id}
                    type="button"
                    onClick={() =>
                      setAction({
                        type: 'status',
                        employee,
                        status: employee.status === 'active' ? 'disabled' : 'active'
                      })
                    }
                  >
                    {employee.status === 'active' ? '停用' : '启用'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <form className="panel create-employee" onSubmit={(event) => void submitCreate(event)}>
          <div className="panel-heading">
            <div>
              <h2>新增员工</h2>
              <p>店员无法查看报表、修改价格或审批退款。</p>
            </div>
          </div>
          <label>
            <span>员工姓名</span>
            <input
              required
              maxLength={40}
              value={createRequest.displayName}
              onChange={(event) =>
                setCreateRequest({ ...createRequest, displayName: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>登录账号</span>
            <input
              required
              minLength={3}
              maxLength={32}
              value={createRequest.username}
              onChange={(event) =>
                setCreateRequest({ ...createRequest, username: event.currentTarget.value })
              }
            />
          </label>
          <label>
            <span>初始密码</span>
            <input
              required
              type="password"
              minLength={8}
              maxLength={128}
              value={createRequest.password}
              onChange={(event) =>
                setCreateRequest({ ...createRequest, password: event.currentTarget.value })
              }
              placeholder="至少 8 位，包含文字和数字"
            />
          </label>
          <label>
            <span>角色</span>
            <select
              value={createRequest.role}
              onChange={(event) =>
                setCreateRequest({
                  ...createRequest,
                  role: event.currentTarget.value === 'manager' ? 'manager' : 'staff'
                })
              }
            >
              <option value="staff">店员</option>
              <option value="manager">店长</option>
            </select>
          </label>
          <button className="primary-button full" type="submit">创建员工</button>
        </form>
      </section>

      {action ? (
        <div className="modal-backdrop" role="presentation">
          <form className="modal-card" onSubmit={(event) => void submitAction(event)}>
            <div className="form-heading">
              <span>
                {action.type === 'mobile'
                  ? '移动端权限'
                  : action.type === 'password'
                    ? '安全操作'
                    : '账号状态'}
              </span>
              <h2>
                {action.type === 'password'
                  ? `重置 ${action.employee.displayName} 的密码`
                  : action.type === 'status'
                    ? `${action.status === 'active' ? '启用' : '停用'} ${action.employee.displayName}`
                    : action.mode === 'disable'
                      ? `关闭 ${action.employee.displayName} 的移动登录`
                      : `${action.mode === 'reset' ? '重设' : '设置'} ${action.employee.displayName} 的移动密码`}
              </h2>
            </div>
            {action.type === 'mobile' ? (
              <p className="modal-hint">
                移动端密码独立于收银 PC 密码，不会读取或上传现有 PC 登录密码。
              </p>
            ) : null}
            {action.type === 'password' ||
            (action.type === 'mobile' && action.mode !== 'disable') ? (
              <label>
                <span>{action.type === 'mobile' ? '移动端密码' : '新密码'}</span>
                <input
                  required
                  autoFocus
                  type="password"
                  minLength={8}
                  maxLength={128}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                  placeholder="至少 8 位，包含文字和数字"
                />
              </label>
            ) : null}
            <label>
              <span>操作原因</span>
              <textarea
                required
                autoFocus={
                  action.type === 'status' ||
                  (action.type === 'mobile' && action.mode === 'disable')
                }
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
