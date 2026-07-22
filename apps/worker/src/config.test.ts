import { describe, expect, it } from 'vitest'
import { readWorkerConfig } from './config'

describe('worker configuration', () => {
  it('uses a stable default queue', () => {
    expect(
      readWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local'
      })
    ).toEqual({
      nodeEnv: 'test',
      databaseUrl: 'postgres://local/database',
      redisUrl: 'redis://local',
      queueName: 'zyapp-maintenance'
    })
  })

  it('rejects missing Redis and malformed queue names', () => {
    expect(() =>
      readWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://local/database'
      })
    ).toThrow('REDIS_URL')
    expect(() =>
      readWorkerConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://local/database',
        REDIS_URL: 'redis://local',
        WORKER_QUEUE_NAME: '!'
      })
    ).toThrow('WORKER_QUEUE_NAME')
  })
})
