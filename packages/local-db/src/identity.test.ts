import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapStore,
  configureEmployeeMobileAccess,
  createEmployee,
  findEmployeeByUsername,
  getStoreContext,
  listEmployees,
  openLocalDatabase,
  recordLoginAttempt,
  resetEmployeePassword,
  setEmployeeStatus
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-identity-'))
  temporaryDirectories.push(directory)
  const localDatabase = openLocalDatabase(join(directory, 'zyapp.db'))
  const bootstrap = bootstrapStore(localDatabase.connection, {
    storeName: 'Test Store',
    managerUsername: 'manager',
    managerPasswordHash: 'scrypt$manager',
    managerDisplayName: 'Owner',
    deviceName: 'Cashier 01'
  })
  const store = getStoreContext(localDatabase.connection)
  if (!store) {
    throw new Error('Missing test store')
  }
  return { localDatabase, bootstrap, store }
}

describe('employee identity repository', () => {
  it('finds employees by normalized username and never returns hashes in lists', () => {
    const { localDatabase } = initializedDatabase()

    expect(findEmployeeByUsername(localDatabase.connection, ' MANAGER ')?.passwordHash).toBe(
      'scrypt$manager'
    )
    expect(listEmployees(localDatabase.connection)[0]).not.toHaveProperty('passwordHash')
    localDatabase.close()
  })

  it('creates an employee with audit and outbox records', () => {
    const { localDatabase, bootstrap, store } = initializedDatabase()

    const employee = createEmployee(
      localDatabase.connection,
      { ...store, actorId: bootstrap.managerId },
      {
        username: 'Staff01',
        passwordHash: 'scrypt$staff',
        displayName: 'Staff One',
        role: 'staff'
      }
    )

    expect(employee.username).toBe('staff01')
    expect(listEmployees(localDatabase.connection)).toHaveLength(2)
    expect(
      (
        localDatabase.connection
          .prepare("SELECT COUNT(*) count FROM audit_log WHERE action = 'employee.created'")
          .get() as { count: number }
      ).count
    ).toBe(1)
    expect(
      (
        localDatabase.connection
          .prepare(
            "SELECT COUNT(*) count FROM outbox_operation WHERE operation_type = 'employee.created'"
          )
          .get() as { count: number }
      ).count
    ).toBe(1)

    expect(() =>
      createEmployee(
        localDatabase.connection,
        { ...store, actorId: bootstrap.managerId },
        {
          username: 'staff01',
          passwordHash: 'different',
          displayName: 'Duplicate',
          role: 'staff'
        }
      )
    ).toThrow('UNIQUE constraint failed')
    localDatabase.close()
  })

  it('prevents disabling the current account or the last active manager', () => {
    const { localDatabase, bootstrap, store } = initializedDatabase()

    expect(() =>
      setEmployeeStatus(
        localDatabase.connection,
        { ...store, actorId: bootstrap.managerId },
        { employeeId: bootstrap.managerId, status: 'disabled', reason: 'invalid test' }
      )
    ).toThrow('currently in use')

    const staff = createEmployee(
      localDatabase.connection,
      { ...store, actorId: bootstrap.managerId },
      {
        username: 'staff02',
        passwordHash: 'scrypt$staff',
        displayName: 'Staff Two',
        role: 'staff'
      }
    )
    expect(() =>
      setEmployeeStatus(
        localDatabase.connection,
        { ...store, actorId: staff.id },
        { employeeId: bootstrap.managerId, status: 'disabled', reason: 'invalid test' }
      )
    ).toThrow('At least one active manager')
    localDatabase.close()
  })

  it('keeps password hashes out of audit while queuing a dedicated credential operation', () => {
    const { localDatabase, bootstrap, store } = initializedDatabase()
    const newHash = 'scrypt$must-not-leak'

    resetEmployeePassword(
      localDatabase.connection,
      { ...store, actorId: bootstrap.managerId },
      {
        employeeId: bootstrap.managerId,
        passwordHash: newHash,
        reason: 'forgot password'
      }
    )

    expect(findEmployeeByUsername(localDatabase.connection, 'manager')?.passwordHash).toBe(newHash)
    const auditRows = JSON.stringify(
      localDatabase.connection.prepare(
        'SELECT before_json, after_json FROM audit_log'
      ).all()
    )
    expect(auditRows).not.toContain(newHash)
    const credential = localDatabase.connection.prepare(
      `SELECT operation_type, payload_json FROM outbox_operation
       WHERE operation_type = 'employee.pc_credential.updated'
       ORDER BY device_seq DESC LIMIT 1`
    ).get() as { operation_type: string; payload_json: string }
    expect(credential.operation_type).toBe('employee.pc_credential.updated')
    expect(credential.payload_json).toContain(newHash)
    localDatabase.close()
  })

  it('stores mobile credentials only in the credential row and outbound sync payload', () => {
    const { localDatabase, bootstrap, store } = initializedDatabase()
    const mobileHash = 'scrypt$mobile-secret'

    const enabled = configureEmployeeMobileAccess(
      localDatabase.connection,
      { ...store, actorId: bootstrap.managerId },
      {
        employeeId: bootstrap.managerId,
        enabled: true,
        passwordHash: mobileHash,
        reason: 'Enable manager mobile login'
      }
    )

    expect(enabled.mobileAccessEnabled).toBe(true)
    expect(
      localDatabase.connection
        .prepare(
          `SELECT enabled, password_hash FROM employee_mobile_credential
           WHERE employee_id = ?`
        )
        .get(bootstrap.managerId)
    ).toEqual({ enabled: 1, password_hash: mobileHash })
    const audit = localDatabase.connection
      .prepare(
        `SELECT before_json, after_json FROM audit_log
         WHERE action = 'employee.mobile_access.enabled'`
      )
      .get()
    expect(JSON.stringify(audit)).not.toContain(mobileHash)
    const outbox = localDatabase.connection
      .prepare(
        `SELECT payload_json FROM outbox_operation
         WHERE operation_type = 'employee.mobile_access.updated'
         ORDER BY device_seq DESC LIMIT 1`
      )
      .get() as { payload_json: string }
    expect(outbox.payload_json).toContain(mobileHash)

    const disabled = configureEmployeeMobileAccess(
      localDatabase.connection,
      { ...store, actorId: bootstrap.managerId },
      {
        employeeId: bootstrap.managerId,
        enabled: false,
        reason: 'Disable manager mobile login'
      }
    )
    expect(disabled.mobileAccessEnabled).toBe(false)
    expect(
      localDatabase.connection
        .prepare(
          `SELECT enabled, password_hash FROM employee_mobile_credential
           WHERE employee_id = ?`
        )
        .get(bootstrap.managerId)
    ).toEqual({ enabled: 0, password_hash: null })
    localDatabase.close()
  })

  it('records successful and failed login attempts', () => {
    const { localDatabase } = initializedDatabase()
    const manager = findEmployeeByUsername(localDatabase.connection, 'manager')

    recordLoginAttempt(localDatabase.connection, manager, 'manager', true)
    recordLoginAttempt(localDatabase.connection, manager, 'manager', false)

    const actions = localDatabase.connection
      .prepare(
        `SELECT action FROM audit_log
         WHERE action LIKE 'employee.login.%'
         ORDER BY occurred_at, rowid`
      )
      .all()
      .map((row) => (row as { action: string }).action)
    expect(actions).toEqual(['employee.login.succeeded', 'employee.login.failed'])
    localDatabase.close()
  })
})
