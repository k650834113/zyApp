import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  adjustMemberTier,
  bootstrapStore,
  cashRecharge,
  correctMemberBirthday,
  createEmployee,
  createMember,
  disableMember,
  findEmployeeRecordById,
  getStoreContext,
  listCashierMembers,
  openLocalDatabase,
  searchMembers
} from './index'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { force: true, recursive: true })
  })
})

function initializedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'zyapp-member-'))
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
  const manager = findEmployeeRecordById(
    localDatabase.connection,
    store.tenantId,
    bootstrap.managerId
  )
  if (!manager) {
    throw new Error('Missing test manager')
  }
  return { localDatabase, store, manager }
}

describe('member repository', () => {
  it('creates an ordinary member and searches by phone, number or nickname', () => {
    const { localDatabase, store, manager } = initializedDatabase()
    const member = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138000',
        nickname: '小周',
        confirmedAtLeast14: true,
        note: '喜欢策略游戏'
      }
    )

    expect(member.tier).toBe('ordinary')
    expect(member.note).toBe('喜欢策略游戏')
    expect(searchMembers(localDatabase.connection, store.tenantId, '1380013', 20)).toEqual([
      member
    ])
    expect(searchMembers(localDatabase.connection, store.tenantId, member.memberNumber, 20)).toEqual([
      member
    ])
    expect(searchMembers(localDatabase.connection, store.tenantId, '小周', 20)).toEqual([member])
    expect(
      (
        localDatabase.connection
          .prepare("SELECT COUNT(*) count FROM audit_log WHERE action = 'member.created'")
          .get() as { count: number }
      ).count
    ).toBe(1)
    expect(
      (
        localDatabase.connection
          .prepare(
            "SELECT COUNT(*) count FROM outbox_operation WHERE operation_type = 'member.created'"
          )
          .get() as { count: number }
      ).count
    ).toBe(1)

    expect(() =>
      createMember(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          phone: '13800138000',
          nickname: '重复会员',
          confirmedAtLeast14: true
        }
      )
    ).toThrow('Member phone already exists')
    localDatabase.close()
  })

  it('rejects registration when age confirmation is false', () => {
    const { localDatabase, store, manager } = initializedDatabase()
    expect(() =>
      createMember(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          phone: '13800138001',
          nickname: '未成年',
          confirmedAtLeast14: false
        }
      )
    ).toThrow('under 14')
    localDatabase.close()
  })

  it('stores an optional birthday during desktop member creation', () => {
    const { localDatabase, store, manager } = initializedDatabase()
    const member = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138010',
        nickname: 'Birthday Member',
        confirmedAtLeast14: true,
        birthdayMonth: 2,
        birthdayDay: 29
      }
    )

    expect(member).toMatchObject({
      birthdayMonth: 2,
      birthdayDay: 29,
      birthdaySource: 'customer'
    })
    expect(() =>
      createMember(
        localDatabase.connection,
        { ...store, actor: manager },
        {
          phone: '13800138013',
          nickname: 'Invalid Birthday',
          confirmedAtLeast14: true,
          birthdayMonth: 4,
          birthdayDay: 31
        }
      )
    ).toThrow('invalid')
    localDatabase.close()
  })

  it('lists all active cashier members with recently active members first', () => {
    const { localDatabase, store, manager } = initializedDatabase()
    const activeMember = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138011',
        nickname: '近期活跃',
        confirmedAtLeast14: true
      }
    )
    const newMember = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138012',
        nickname: '尚未消费',
        confirmedAtLeast14: true
      }
    )
    cashRecharge(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        requestId: randomUUID(),
        memberId: activeMember.id,
        principalFen: 10_000,
        reason: '现金充值'
      }
    )

    const members = listCashierMembers(localDatabase.connection, store.tenantId)
    expect(members.map((member) => member.id)).toEqual([activeMember.id, newMember.id])
    expect(members[0]?.lastActiveAt).not.toBeNull()
    expect(members[1]?.lastActiveAt).toBeNull()
    localDatabase.close()
  })

  it('lets managers disable members and hides them from cashier lists', () => {
    const { localDatabase, store, manager } = initializedDatabase()
    const staff = createEmployee(
      localDatabase.connection,
      { ...store, actorId: manager.id },
      {
        username: 'staff02',
        passwordHash: 'scrypt$staff',
        displayName: 'Staff',
        role: 'staff'
      }
    )
    const member = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138014',
        nickname: '注销测试',
        confirmedAtLeast14: true
      }
    )

    expect(() =>
      disableMember(
        localDatabase.connection,
        { ...store, actor: staff },
        { memberId: member.id, reason: '无权限注销' }
      )
    ).toThrow('Only managers')

    const disabled = disableMember(
      localDatabase.connection,
      { ...store, actor: manager },
      { memberId: member.id, reason: '测试清理会员资料' }
    )
    expect(disabled.status).toBe('disabled')
    expect(searchMembers(localDatabase.connection, store.tenantId, member.phone, 20)[0]?.status)
      .toBe('disabled')
    expect(listCashierMembers(localDatabase.connection, store.tenantId)).toEqual([])
    expect(
      (
        localDatabase.connection
          .prepare("SELECT COUNT(*) count FROM audit_log WHERE action = 'member.disabled'")
          .get() as { count: number }
      ).count
    ).toBe(1)
    expect(
      (
        localDatabase.connection
          .prepare(
            "SELECT COUNT(*) count FROM outbox_operation WHERE operation_type = 'member.disabled'"
          )
          .get() as { count: number }
      ).count
    ).toBe(1)
    localDatabase.close()
  })

  it('reactivates a disabled member with the same phone and resets profile fields', () => {
    const { localDatabase, store, manager } = initializedDatabase()
    const member = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138015',
        nickname: '旧昵称',
        confirmedAtLeast14: true,
        birthdayMonth: 1,
        birthdayDay: 2,
        note: '旧备注'
      }
    )
    adjustMemberTier(
      localDatabase.connection,
      { ...store, actor: manager },
      { memberId: member.id, tier: 'advanced', reason: '测试高级' }
    )
    disableMember(
      localDatabase.connection,
      { ...store, actor: manager },
      { memberId: member.id, reason: '重新登记测试' }
    )

    const restored = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: member.phone,
        nickname: '新昵称',
        confirmedAtLeast14: true,
        birthdayMonth: 3,
        birthdayDay: 4,
        note: '新备注'
      }
    )

    expect(restored).toMatchObject({
      id: member.id,
      phone: member.phone,
      nickname: '新昵称',
      tier: 'ordinary',
      status: 'active',
      birthdayMonth: 3,
      birthdayDay: 4,
      birthdaySource: 'customer',
      note: '新备注'
    })
    expect(
      (
        localDatabase.connection
          .prepare("SELECT COUNT(*) count FROM outbox_operation WHERE operation_type = 'member.enabled'")
          .get() as { count: number }
      ).count
    ).toBe(1)
    localDatabase.close()
  })

  it('adjusts tiers with auditable independent grants', () => {
    const { localDatabase, store, manager } = initializedDatabase()
    const member = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138002',
        nickname: '等级测试',
        confirmedAtLeast14: true
      }
    )

    const advanced = adjustMemberTier(
      localDatabase.connection,
      { ...store, actor: manager },
      { memberId: member.id, tier: 'advanced', reason: '开业活动' }
    )
    expect(advanced.tier).toBe('advanced')

    localDatabase.connection
      .prepare(
        `INSERT INTO membership_grant
         (id, tenant_id, store_id, member_id, source_type, source_id, granted_tier,
          reason, granted_at)
         VALUES (?, ?, ?, ?, 'recharge', ?, 'advanced', '充值达到门槛', ?)`
      )
      .run(
        randomUUID(),
        store.tenantId,
        store.storeId,
        member.id,
        randomUUID(),
        new Date().toISOString()
      )

    const manualGrant = localDatabase.connection
      .prepare(
        `SELECT id FROM membership_grant
         WHERE member_id = ? AND source_type = 'manual'`
      )
      .get(member.id) as { id: string }
    localDatabase.connection
      .prepare(
        `UPDATE membership_grant
         SET revoked_at = ?, revoke_reason = 'manual source ended'
         WHERE id = ?`
      )
      .run(new Date().toISOString(), manualGrant.id)

    expect(searchMembers(localDatabase.connection, store.tenantId, member.phone, 20)[0]?.tier).toBe(
      'advanced'
    )

    const ordinary = adjustMemberTier(
      localDatabase.connection,
      { ...store, actor: manager },
      { memberId: member.id, tier: 'ordinary', reason: '店长明确降级' }
    )
    expect(ordinary.tier).toBe('ordinary')
    localDatabase.close()
  })

  it('allows only managers to correct birthdays and accepts February 29', () => {
    const { localDatabase, store, manager } = initializedDatabase()
    const staff = createEmployee(
      localDatabase.connection,
      { ...store, actorId: manager.id },
      {
        username: 'staff01',
        passwordHash: 'scrypt$staff',
        displayName: 'Staff',
        role: 'staff'
      }
    )
    const member = createMember(
      localDatabase.connection,
      { ...store, actor: manager },
      {
        phone: '13800138003',
        nickname: '生日测试',
        confirmedAtLeast14: true
      }
    )

    expect(() =>
      correctMemberBirthday(
        localDatabase.connection,
        { ...store, actor: staff },
        { memberId: member.id, month: 2, day: 29, reason: '顾客提供证明' }
      )
    ).toThrow('Only managers')
    expect(() =>
      correctMemberBirthday(
        localDatabase.connection,
        { ...store, actor: manager },
        { memberId: member.id, month: 4, day: 31, reason: '无效日期' }
      )
    ).toThrow('invalid')

    const corrected = correctMemberBirthday(
      localDatabase.connection,
      { ...store, actor: manager },
      { memberId: member.id, month: 2, day: 29, reason: '顾客提供证明' }
    )
    expect(corrected).toMatchObject({
      birthdayMonth: 2,
      birthdayDay: 29,
      birthdaySource: 'manager_correction'
    })
    localDatabase.close()
  })
})
