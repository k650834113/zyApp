import { describe, expect, it } from 'vitest'
import { PERMISSIONS, roleHasPermission } from './index'

describe('role permissions', () => {
  it('allows staff to operate cashier workflows', () => {
    expect(roleHasPermission('staff', PERMISSIONS.orderCreate)).toBe(true)
    expect(roleHasPermission('staff', PERMISSIONS.walletDebit)).toBe(true)
  })

  it('blocks staff from manager-only workflows', () => {
    expect(roleHasPermission('staff', PERMISSIONS.refundApprove)).toBe(false)
    expect(roleHasPermission('staff', PERMISSIONS.reportRead)).toBe(false)
    expect(roleHasPermission('staff', PERMISSIONS.pricingManage)).toBe(false)
    expect(roleHasPermission('staff', PERMISSIONS.cloudManage)).toBe(false)
  })
})
