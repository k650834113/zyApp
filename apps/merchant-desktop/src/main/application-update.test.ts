import { beforeEach, describe, expect, it, vi } from 'vitest'

const updater = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>()
  let checks = 0
  return {
    handlers,
    value: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: true,
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler)
      }),
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(async () => {
        handlers.get('checking-for-update')?.()
        checks += 1
        if (checks === 1) handlers.get('update-not-available')?.()
        else handlers.get('update-available')?.({ version: '0.18.2' })
      }),
      downloadUpdate: vi.fn(async () => {
        handlers.get('download-progress')?.({
          percent: 50,
          transferred: 50,
          total: 100
        })
        handlers.get('update-downloaded')?.({ version: '0.18.2' })
      }),
      quitAndInstall: vi.fn()
    },
    reset() {
      checks = 0
      handlers.clear()
      vi.clearAllMocks()
    }
  }
})

vi.mock('electron-updater', () => ({ autoUpdater: updater.value }))

import {
  checkApplicationUpdate,
  configureApplicationUpdateFeed,
  downloadApplicationUpdate,
  getApplicationUpdateStatus,
  initializeApplicationUpdater,
  installApplicationUpdate
} from './application-update'

describe('application update state machine', () => {
  beforeEach(() => updater.reset())

  it('reports no update, downloads an available update and installs on demand', async () => {
    initializeApplicationUpdater({
      isPackaged: true,
      currentVersion: '0.18.2'
    })
    configureApplicationUpdateFeed('https://cloud.example.com')

    await expect(checkApplicationUpdate()).resolves.toMatchObject({
      state: 'idle',
      availableVersion: null
    })
    await expect(checkApplicationUpdate()).resolves.toMatchObject({
      state: 'available',
      availableVersion: '0.18.2'
    })
    await expect(downloadApplicationUpdate()).resolves.toMatchObject({
      state: 'downloaded',
      downloadPercent: 100
    })
    installApplicationUpdate()
    expect(updater.value.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(getApplicationUpdateStatus().currentVersion).toBe('0.18.2')
  })
})
