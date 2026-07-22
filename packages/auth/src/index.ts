export * from './password'

export const PERMISSIONS = {
  employeeManage: 'identity.employee.manage',
  memberRead: 'member.profile.read',
  memberWrite: 'member.profile.write',
  walletRechargeCash: 'wallet.recharge.cash',
  walletDebit: 'wallet.ledger.debit',
  walletAdjust: 'wallet.ledger.adjust',
  monthlyCardManage: 'monthly-card.manage',
  orderCreate: 'order.create',
  refundRequest: 'refund.request',
  refundApprove: 'refund.approve',
  catalogRead: 'catalog.read',
  catalogAvailabilityManage: 'catalog.availability.manage',
  pricingManage: 'catalog.pricing.manage',
  activityRead: 'activity.read',
  activityManage: 'activity.manage',
  contentRead: 'content.read',
  contentManage: 'content.manage',
  boardGameOperationsManage: 'content.board-game.operations.manage',
  reportRead: 'report.read',
  financeExport: 'report.finance.export',
  backupManage: 'system.backup.manage',
  cloudManage: 'system.cloud.manage',
  storeProfileManage: 'store.profile.manage'
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]
export type EmployeeRole = 'manager' | 'staff'

const staffPermissions: Permission[] = [
  PERMISSIONS.memberRead,
  PERMISSIONS.memberWrite,
  PERMISSIONS.walletRechargeCash,
  PERMISSIONS.walletDebit,
  PERMISSIONS.monthlyCardManage,
  PERMISSIONS.orderCreate,
  PERMISSIONS.refundRequest,
  PERMISSIONS.catalogRead,
  PERMISSIONS.catalogAvailabilityManage,
  PERMISSIONS.activityRead,
  PERMISSIONS.contentRead,
  PERMISSIONS.boardGameOperationsManage
]

export const DEFAULT_ROLE_PERMISSIONS: Record<EmployeeRole, Permission[]> = {
  staff: staffPermissions,
  manager: Object.values(PERMISSIONS)
}

export function roleHasPermission(role: EmployeeRole, permission: Permission): boolean {
  return DEFAULT_ROLE_PERMISSIONS[role].includes(permission)
}
