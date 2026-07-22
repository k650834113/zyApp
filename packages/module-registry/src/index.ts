import type { ModuleManifest } from '@zyapp/contracts'

const desktopOffline = {
  desktop: true,
  offline: true,
  cloud: false,
  miniapp: false
} as const

export const FIRST_RELEASE_MODULES: ModuleManifest[] = [
  {
    id: 'identity-access',
    version: '0.1.0',
    dependencies: [],
    permissions: ['identity.employee.manage'],
    capabilities: desktopOffline
  },
  {
    id: 'member',
    version: '0.1.0',
    dependencies: ['identity-access'],
    permissions: ['member.profile.read', 'member.profile.write'],
    capabilities: desktopOffline
  },
  {
    id: 'wallet',
    version: '0.1.0',
    dependencies: ['member'],
    permissions: ['wallet.recharge.cash', 'wallet.ledger.debit', 'wallet.ledger.adjust'],
    capabilities: desktopOffline
  },
  {
    id: 'monthly-card',
    version: '0.1.0',
    dependencies: ['member'],
    permissions: ['monthly-card.manage'],
    capabilities: desktopOffline
  },
  {
    id: 'catalog',
    version: '0.1.0',
    dependencies: ['identity-access'],
    permissions: [
      'catalog.read',
      'catalog.availability.manage',
      'catalog.pricing.manage'
    ],
    capabilities: desktopOffline
  },
  {
    id: 'visit-order',
    version: '0.1.0',
    dependencies: ['member', 'wallet', 'monthly-card', 'catalog'],
    permissions: ['order.create'],
    capabilities: desktopOffline
  },
  {
    id: 'activity',
    version: '0.1.0',
    dependencies: ['wallet', 'catalog'],
    permissions: ['activity.read', 'activity.manage'],
    capabilities: {
      desktop: true,
      offline: true,
      cloud: true,
      miniapp: true
    }
  },
  {
    id: 'store-content',
    version: '0.1.0',
    dependencies: ['identity-access'],
    permissions: [
      'content.read',
      'content.manage',
      'content.board-game.operations.manage'
    ],
    capabilities: {
      desktop: true,
      offline: true,
      cloud: true,
      miniapp: true
    }
  },
  {
    id: 'store-profile',
    version: '0.1.0',
    dependencies: ['identity-access'],
    permissions: ['store.profile.manage'],
    capabilities: {
      desktop: true,
      offline: true,
      cloud: true,
      miniapp: true
    }
  },
  {
    id: 'refund',
    version: '0.1.0',
    dependencies: ['visit-order'],
    permissions: ['refund.request', 'refund.approve'],
    capabilities: desktopOffline
  },
  {
    id: 'reporting',
    version: '0.1.0',
    dependencies: ['visit-order', 'refund'],
    permissions: ['report.read', 'report.finance.export'],
    capabilities: desktopOffline
  },
  {
    id: 'backup-restore',
    version: '0.1.0',
    dependencies: ['identity-access'],
    permissions: ['system.backup.manage'],
    capabilities: desktopOffline
  },
  {
    id: 'legacy-import',
    version: '0.1.0',
    dependencies: ['member', 'wallet', 'monthly-card', 'catalog', 'backup-restore'],
    permissions: ['system.backup.manage'],
    capabilities: desktopOffline
  },
  {
    id: 'sync-foundation',
    version: '0.1.0',
    dependencies: [
      'identity-access',
      'member',
      'wallet',
      'monthly-card',
      'catalog',
      'activity',
      'store-content',
      'visit-order',
      'refund'
    ],
    permissions: ['system.cloud.manage'],
    capabilities: {
      desktop: true,
      offline: true,
      cloud: true,
      miniapp: false
    }
  }
]
