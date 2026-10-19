import { expect, it, vi } from 'vitest'
import type { ApplicationUpdateStatus } from '@zyapp/contracts'
import { checkStartupUpdate } from './startup-update'

it('checks without a session and remembers suppression only for that feed and version', async () => {
  const status = { state: 'available', availableVersion: '2', feedUrl: 'production' } as ApplicationUpdateStatus
  const ignored: string[] = []
  const deps = { check: vi.fn(async () => status), ignored: () => ignored,
    ignore: (key: string) => { ignored.push(key) }, ask: vi.fn(async () => 'ignore' as const),
    download: vi.fn(), install: vi.fn() }
  await checkStartupUpdate(deps)
  await checkStartupUpdate(deps)
  expect(deps.check).toHaveBeenCalledTimes(2)
  expect(deps.ask).toHaveBeenCalledTimes(1)
  status.availableVersion = '3'
  await checkStartupUpdate(deps)
  expect(deps.ask).toHaveBeenCalledTimes(2)
  expect(deps.download).not.toHaveBeenCalled()
})

it('installs only after the user chooses update and download completes', async () => {
  const install = vi.fn()
  await checkStartupUpdate({ check: async () => ({ state: 'available', availableVersion: '2' } as ApplicationUpdateStatus),
    ignored: () => [], ignore: vi.fn(), ask: async () => 'update',
    download: async () => ({ state: 'downloaded' } as ApplicationUpdateStatus), install })
  expect(install).toHaveBeenCalledOnce()
})
