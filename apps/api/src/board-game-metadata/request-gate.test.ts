import type Redis from 'ioredis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BggRequestGate } from './request-gate'

afterEach(() => {
  vi.useRealTimers()
})

describe('BGG shared request gate', () => {
  it('caches JSON and acquires a five-second cross-instance start gate', async () => {
    const values = new Map<string, string>()
    const get = vi.fn(async (key: string) => values.get(key) ?? null)
    const set = vi.fn(async (...args: unknown[]) => {
      const [key, value] = args as [string, string]
      values.set(key, value)
      return 'OK'
    })
    const gate = new BggRequestGate({ get, set } as unknown as Redis)
    const load = vi.fn(async () => [{ externalId: '13' }])

    const first = await gate.cached('zyapp:bgg:search:key', 86_400, load)
    const second = await gate.cached('zyapp:bgg:search:key', 86_400, load)

    expect(first).toEqual(second)
    expect(load).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(
      'zyapp:bgg:request-start',
      expect.any(String),
      'PX',
      5_000,
      'NX'
    )
  })

  it('waits until the shared start gate can be acquired', async () => {
    vi.useFakeTimers()
    const set = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('OK')
    const gate = new BggRequestGate({
      get: vi.fn(async () => null),
      set
    } as unknown as Redis)

    const result = gate.cached('zyapp:bgg:details:13', 604_800, async () => 13)
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe(13)
  })

  it('does not bypass the shared gate when Redis is unavailable', async () => {
    const load = vi.fn(async () => 'must-not-run')
    const gate = new BggRequestGate({
      get: vi.fn(async () => { throw new Error('redis offline') })
    } as unknown as Redis)

    await expect(gate.cached('key', 60, load)).rejects.toThrow('redis offline')
    expect(load).not.toHaveBeenCalled()
  })

  it('rechecks the cache after waiting for the shared gate', async () => {
    const cached = JSON.stringify([{ externalId: '13' }])
    const get = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(cached)
    const gate = new BggRequestGate({
      get,
      set: vi.fn(async () => 'OK')
    } as unknown as Redis)
    const load = vi.fn(async () => [{ externalId: 'must-not-load' }])

    await expect(gate.cached('key', 60, load)).resolves.toEqual([
      { externalId: '13' }
    ])
    expect(load).not.toHaveBeenCalled()
  })
})
