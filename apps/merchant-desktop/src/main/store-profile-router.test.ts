import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  activateStoreProfile,
  getActiveStoreProfile,
  loadOrCreateStoreProfileRegistry,
  profileSwitchBlockReason,
  registerCloudStoreProfile,
  resolveStoreProfileDataRoot,
  saveStoreProfileRegistry,
  updateStoreProfileIdentity
} from './store-profile-router'

describe('store profile router', () => {
  it('migrates the existing environment root into one active legacy profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'zyapp-store-profiles-'))
    const filePath = join(root, 'config', 'store-profiles.json')
    const registry = loadOrCreateStoreProfileRegistry(
      filePath,
      '2026-07-01T00:00:00.000Z'
    )

    expect(registry.profiles).toHaveLength(1)
    expect(getActiveStoreProfile(registry).storageKey).toBeNull()
    expect(resolveStoreProfileDataRoot(root, getActiveStoreProfile(registry))).toBe(root)
    expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(1)
  })

  it('creates an isolated profile root and can switch back and forth', () => {
    const root = mkdtempSync(join(tmpdir(), 'zyapp-store-profiles-'))
    const filePath = join(root, 'config', 'store-profiles.json')
    const initial = loadOrCreateStoreProfileRegistry(filePath)
    const legacyId = initial.activeProfileId
    const added = registerCloudStoreProfile(initial, {
      tenantId: 'tenant-1',
      storeId: 'store-2',
      storeName: '二店',
      deviceId: 'device-2',
      now: '2026-07-01T01:00:00.000Z'
    })

    const newRoot = resolveStoreProfileDataRoot(root, added.profile)
    expect(newRoot).not.toBe(root)
    expect(newRoot.startsWith(join(root, 'store-profiles'))).toBe(true)
    expect(getActiveStoreProfile(added.registry).storeName).toBe('二店')

    const switchedBack = activateStoreProfile(added.registry, legacyId)
    saveStoreProfileRegistry(filePath, switchedBack)
    expect(loadOrCreateStoreProfileRegistry(filePath).activeProfileId).toBe(legacyId)
  })

  it('keeps a repeated cloud device registration idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'zyapp-store-profiles-'))
    const initial = loadOrCreateStoreProfileRegistry(
      join(root, 'config', 'store-profiles.json')
    )
    const first = registerCloudStoreProfile(initial, {
      tenantId: 'tenant-1',
      storeId: 'store-1',
      storeName: '一店',
      deviceId: 'device-1'
    })
    const repeated = registerCloudStoreProfile(first.registry, {
      tenantId: 'tenant-1',
      storeId: 'store-1',
      storeName: '一店新名称',
      deviceId: 'device-1'
    })

    expect(repeated.registry.profiles).toHaveLength(2)
    expect(repeated.profile.profileId).toBe(first.profile.profileId)
    expect(repeated.profile.storageKey).toBe(first.profile.storageKey)
    expect(repeated.profile.storeName).toBe('一店新名称')
  })

  it('updates the migrated legacy profile after local bootstrap', () => {
    const root = mkdtempSync(join(tmpdir(), 'zyapp-store-profiles-'))
    const initial = loadOrCreateStoreProfileRegistry(
      join(root, 'config', 'store-profiles.json')
    )
    const updated = updateStoreProfileIdentity(initial, initial.activeProfileId, {
      tenantId: 'tenant-local',
      storeId: 'store-local',
      storeName: '本地店',
      deviceId: 'device-local'
    })

    expect(getActiveStoreProfile(updated)).toMatchObject({
      tenantId: 'tenant-local',
      storeId: 'store-local',
      storeName: '本地店',
      deviceId: 'device-local'
    })
  })

  it('blocks switching during unsafe session, sync, outcome and repair states', () => {
    const safe = {
      hasSession: false,
      databaseMaintenance: false,
      backupInProgress: false,
      cloudSyncInProgress: false,
      pendingOutcomes: 0,
      mirrorRepairRequired: false
    }
    expect(profileSwitchBlockReason(safe)).toBeNull()
    expect(profileSwitchBlockReason({ ...safe, hasSession: true })).toContain('退出')
    expect(profileSwitchBlockReason({ ...safe, cloudSyncInProgress: true })).toContain('同步')
    expect(profileSwitchBlockReason({ ...safe, pendingOutcomes: 1 })).toContain('待确认')
    expect(profileSwitchBlockReason({ ...safe, mirrorRepairRequired: true })).toContain('修复')
  })
})
