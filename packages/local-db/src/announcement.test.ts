import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashPassword } from '@zyapp/auth'
import { createAnnouncement, listAnnouncements, setAnnouncementStatus } from './announcement'
import { bootstrapStore } from './bootstrap'
import { findEmployeeRecordById, getStoreContext } from './identity'
import { openLocalDatabase } from './index'

describe('announcement repository', () => {
  it('publishes pinned announcements on their configured schedule', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zyapp-announcement-'))
    const local = openLocalDatabase(join(directory, 'test.db'))
    try {
      const bootstrap = bootstrapStore(local.connection, {
        storeName: 'Content store',
        deviceName: 'Cashier',
        managerUsername: 'manager',
        managerPasswordHash: await hashPassword('Password123!'),
        managerDisplayName: 'Manager'
      })
      const store = getStoreContext(local.connection)
      if (!store) throw new Error('Store missing')
      const manager = findEmployeeRecordById(
        local.connection,
        store.tenantId,
        bootstrap.managerId
      )
      if (!manager) throw new Error('Manager missing')
      const context = { ...store, actor: manager }
      const created = createAnnouncement(local.connection, context, {
        title: 'Holiday hours',
        content: 'The store will open at 13:00 during the holiday.',
        pinned: true,
        visibleFrom: '2026-10-01T00:00:00.000Z',
        visibleUntil: '2026-10-08T00:00:00.000Z'
      })
      setAnnouncementStatus(
        local.connection,
        context,
        created.id,
        'published',
        'Schedule holiday notice'
      )
      expect(
        listAnnouncements(
          local.connection,
          store,
          new Date('2026-09-30T00:00:00.000Z')
        )[0]?.visibility
      ).toBe('scheduled')
      expect(
        listAnnouncements(
          local.connection,
          store,
          new Date('2026-10-02T00:00:00.000Z')
        )[0]?.visibility
      ).toBe('active')
      expect(
        listAnnouncements(
          local.connection,
          store,
          new Date('2026-10-09T00:00:00.000Z')
        )[0]?.visibility
      ).toBe('ended')
    } finally {
      local.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
