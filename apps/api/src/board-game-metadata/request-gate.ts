import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import { randomUUID } from 'node:crypto'
import { REDIS_CLIENT } from '../infrastructure.module'

const START_KEY = 'zyapp:bgg:request-start'
const START_INTERVAL_MILLISECONDS = 5_000
const POLL_INTERVAL_MILLISECONDS = 100
const MAX_WAIT_MILLISECONDS = 10_000

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

@Injectable()
export class BggRequestGate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async cached<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>
  ): Promise<T> {
    const cached = await this.redis.get(key)
    if (cached !== null) return JSON.parse(cached) as T

    await this.acquireStartGate()
    const cachedAfterGate = await this.redis.get(key)
    if (cachedAfterGate !== null) return JSON.parse(cachedAfterGate) as T
    const value = await load()
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
    return value
  }

  private async acquireStartGate(): Promise<void> {
    const deadline = Date.now() + MAX_WAIT_MILLISECONDS
    while (true) {
      const acquired = await this.redis.set(
        START_KEY,
        randomUUID(),
        'PX',
        START_INTERVAL_MILLISECONDS,
        'NX'
      )
      if (acquired === 'OK') return
      if (Date.now() >= deadline) {
        throw new Error('BGG shared request gate timed out')
      }
      await wait(POLL_INTERVAL_MILLISECONDS)
    }
  }
}
