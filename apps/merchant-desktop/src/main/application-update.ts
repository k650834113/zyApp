import { autoUpdater } from 'electron-updater'
import type { ApplicationUpdateStatus } from '@zyapp/contracts'
import { desktopUpdateFeedUrl } from './update-feed'

type UpdateLogger = (
  level: 'info' | 'error',
  event: string,
  details?: Record<string, unknown>
) => void

let initialized = false
let packaged = false
let logger: UpdateLogger | null = null
let status: ApplicationUpdateStatus = {
  state: 'disabled',
  currentVersion: '0.0.0',
  availableVersion: null,
  feedUrl: null,
  downloadPercent: null,
  transferredBytes: null,
  totalBytes: null,
  lastCheckedAt: null,
  lastError: null
}

function setStatus(
  update: Partial<ApplicationUpdateStatus>
): ApplicationUpdateStatus {
  status = { ...status, ...update }
  return status
}

function errorMessage(error: Error): string {
  return error.message.replace(/\s+/g, ' ').trim()
}

export function initializeApplicationUpdater(input: {
  isPackaged: boolean
  currentVersion: string
  log?: UpdateLogger
}): void {
  packaged = input.isPackaged
  logger = input.log ?? null
  setStatus({
    state: 'disabled',
    currentVersion: input.currentVersion
  })
  if (initialized) return
  initialized = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.on('checking-for-update', () => {
    setStatus({
      state: 'checking',
      lastCheckedAt: new Date().toISOString(),
      lastError: null
    })
  })
  autoUpdater.on('update-available', (info) => {
    setStatus({
      state: 'available',
      availableVersion: info.version,
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      lastError: null
    })
    logger?.('info', 'application_update_available', {
      version: info.version
    })
  })
  autoUpdater.on('update-not-available', () => {
    setStatus({
      state: 'idle',
      availableVersion: null,
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      lastError: null
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      state: 'downloading',
      downloadPercent: Math.max(0, Math.min(100, progress.percent)),
      transferredBytes: progress.transferred,
      totalBytes: progress.total,
      lastError: null
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({
      state: 'downloaded',
      availableVersion: info.version,
      downloadPercent: 100,
      lastError: null
    })
    logger?.('info', 'application_update_downloaded', {
      version: info.version
    })
  })
  autoUpdater.on('error', (error) => {
    const message = errorMessage(error)
    setStatus({ state: 'error', lastError: message })
    logger?.('error', 'application_update_failed', { message })
  })
}

export function configureApplicationUpdateFeed(
  cloudBaseUrl: string | null
): ApplicationUpdateStatus {
  if (!packaged || !cloudBaseUrl) {
    return setStatus({
      state: 'disabled',
      feedUrl: null,
      availableVersion: null,
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      lastError: null
    })
  }
  const feedUrl = desktopUpdateFeedUrl(cloudBaseUrl)
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: feedUrl,
    channel: 'latest'
  })
  return setStatus({
    state: 'idle',
    feedUrl,
    availableVersion: null,
    downloadPercent: null,
    transferredBytes: null,
    totalBytes: null,
    lastError: null
  })
}

export function getApplicationUpdateStatus(): ApplicationUpdateStatus {
  return { ...status }
}

export async function checkApplicationUpdate(): Promise<ApplicationUpdateStatus> {
  if (status.state === 'disabled' || !status.feedUrl) {
    throw new Error('请先连接云端；开发模式不执行在线更新')
  }
  if (status.state === 'downloading') {
    throw new Error('更新正在下载')
  }
  await autoUpdater.checkForUpdates()
  return getApplicationUpdateStatus()
}

export async function downloadApplicationUpdate(): Promise<ApplicationUpdateStatus> {
  if (status.state !== 'available') {
    throw new Error('当前没有可下载的新版本')
  }
  await autoUpdater.downloadUpdate()
  return getApplicationUpdateStatus()
}

export function installApplicationUpdate(): void {
  if (status.state !== 'downloaded') {
    throw new Error('更新尚未下载完成')
  }
  autoUpdater.quitAndInstall(false, true)
}
