import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type StoreProfileConfig = {
  profileId: string
  storageKey: string | null
  tenantId: string | null
  storeId: string | null
  storeName: string
  deviceId: string | null
  createdAt: string
  updatedAt: string
}

export type StoreProfileRegistry = {
  version: 1
  activeProfileId: string
  profiles: StoreProfileConfig[]
}

const STORAGE_KEY_PATTERN = /^[a-zA-Z0-9_-]{8,100}$/

function validateProfile(value: unknown): StoreProfileConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('门店配置条目格式无效')
  }
  const profile = value as Partial<StoreProfileConfig>
  if (
    typeof profile.profileId !== 'string' ||
    !STORAGE_KEY_PATTERN.test(profile.profileId) ||
    (profile.storageKey !== null &&
      (typeof profile.storageKey !== 'string' ||
        !STORAGE_KEY_PATTERN.test(profile.storageKey))) ||
    (profile.tenantId !== null && typeof profile.tenantId !== 'string') ||
    (profile.storeId !== null && typeof profile.storeId !== 'string') ||
    typeof profile.storeName !== 'string' ||
    (profile.deviceId !== null && typeof profile.deviceId !== 'string') ||
    typeof profile.createdAt !== 'string' ||
    typeof profile.updatedAt !== 'string'
  ) {
    throw new Error('门店配置条目缺少必要字段')
  }
  return profile as StoreProfileConfig
}

export function loadOrCreateStoreProfileRegistry(
  filePath: string,
  now = new Date().toISOString()
): StoreProfileRegistry {
  if (!existsSync(filePath)) {
    const profileId = randomUUID()
    const registry: StoreProfileRegistry = {
      version: 1,
      activeProfileId: profileId,
      profiles: [
        {
          profileId,
          storageKey: null,
          tenantId: null,
          storeId: null,
          storeName: '当前门店',
          deviceId: null,
          createdAt: now,
          updatedAt: now
        }
      ]
    }
    saveStoreProfileRegistry(filePath, registry)
    return registry
  }

  try {
    const stored = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<StoreProfileRegistry>
    if (stored.version !== 1 || !Array.isArray(stored.profiles)) {
      throw new Error('门店配置清单版本无效')
    }
    const profiles = stored.profiles.map(validateProfile)
    if (profiles.length === 0) throw new Error('门店配置清单不能为空')
    if (new Set(profiles.map((profile) => profile.profileId)).size !== profiles.length) {
      throw new Error('门店配置编号重复')
    }
    if (
      typeof stored.activeProfileId !== 'string' ||
      !profiles.some((profile) => profile.profileId === stored.activeProfileId)
    ) {
      throw new Error('活动门店配置不存在')
    }
    return {
      version: 1,
      activeProfileId: stored.activeProfileId,
      profiles
    }
  } catch (error) {
    throw new Error(
      `无法读取门店配置清单：${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function saveStoreProfileRegistry(
  filePath: string,
  registry: StoreProfileRegistry
): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(registry), {
      encoding: 'utf8',
      mode: 0o600
    })
    renameSync(temporaryPath, filePath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function getActiveStoreProfile(
  registry: StoreProfileRegistry
): StoreProfileConfig {
  const profile = registry.profiles.find(
    (candidate) => candidate.profileId === registry.activeProfileId
  )
  if (!profile) throw new Error('活动门店配置不存在')
  return profile
}

export function resolveStoreProfileDataRoot(
  environmentDataRoot: string,
  profile: StoreProfileConfig
): string {
  if (profile.storageKey === null) return environmentDataRoot
  if (!STORAGE_KEY_PATTERN.test(profile.storageKey)) {
    throw new Error('门店配置存储编号无效')
  }
  const profilesRoot = resolve(environmentDataRoot, 'store-profiles')
  const dataRoot = resolve(profilesRoot, profile.storageKey)
  const relative = dataRoot.slice(profilesRoot.length)
  if (!relative.startsWith('\\') && !relative.startsWith('/')) {
    throw new Error('门店配置目录越界')
  }
  return dataRoot
}

export function registerCloudStoreProfile(
  registry: StoreProfileRegistry,
  input: {
    tenantId: string
    storeId: string
    storeName: string
    deviceId: string
    now?: string
  }
): { registry: StoreProfileRegistry; profile: StoreProfileConfig } {
  const now = input.now ?? new Date().toISOString()
  const existing = registry.profiles.find(
    (profile) => profile.deviceId === input.deviceId
  )
  const profile: StoreProfileConfig = existing
    ? {
        ...existing,
        tenantId: input.tenantId,
        storeId: input.storeId,
        storeName: input.storeName,
        updatedAt: now
      }
    : {
        profileId: randomUUID(),
        storageKey: randomUUID(),
        tenantId: input.tenantId,
        storeId: input.storeId,
        storeName: input.storeName,
        deviceId: input.deviceId,
        createdAt: now,
        updatedAt: now
      }
  return {
    profile,
    registry: {
      version: 1,
      activeProfileId: profile.profileId,
      profiles: existing
        ? registry.profiles.map((candidate) =>
            candidate.profileId === profile.profileId ? profile : candidate
          )
        : [...registry.profiles, profile]
    }
  }
}

export function updateStoreProfileIdentity(
  registry: StoreProfileRegistry,
  profileId: string,
  input: {
    tenantId: string
    storeId: string
    storeName: string
    deviceId: string
    now?: string
  }
): StoreProfileRegistry {
  if (!registry.profiles.some((profile) => profile.profileId === profileId)) {
    throw new Error('门店配置不存在')
  }
  const now = input.now ?? new Date().toISOString()
  const identity = {
    tenantId: input.tenantId,
    storeId: input.storeId,
    storeName: input.storeName,
    deviceId: input.deviceId
  }
  return {
    ...registry,
    profiles: registry.profiles.map((profile) =>
      profile.profileId === profileId
        ? { ...profile, ...identity, updatedAt: now }
        : profile
    )
  }
}

export function activateStoreProfile(
  registry: StoreProfileRegistry,
  profileId: string
): StoreProfileRegistry {
  if (!registry.profiles.some((profile) => profile.profileId === profileId)) {
    throw new Error('门店配置不存在')
  }
  return { ...registry, activeProfileId: profileId }
}

export function storeProfileDatabasePath(dataRoot: string): string {
  return join(dataRoot, 'data', 'zyapp.db')
}

export function profileSwitchBlockReason(input: {
  hasSession: boolean
  databaseMaintenance: boolean
  backupInProgress: boolean
  cloudSyncInProgress: boolean
  pendingOutcomes: number
  mirrorRepairRequired: boolean
}): string | null {
  if (input.hasSession) return '请先退出当前员工账号，再切换门店'
  if (input.databaseMaintenance || input.backupInProgress) {
    return '正在维护或备份数据库，请稍候'
  }
  if (input.cloudSyncInProgress) return '当前门店正在同步，请等待本轮同步完成'
  if (input.pendingOutcomes > 0) {
    return '当前门店有结果待确认的业务操作，暂不能切换'
  }
  if (input.mirrorRepairRequired) return '当前门店镜像需要修复，暂不能切换'
  return null
}
