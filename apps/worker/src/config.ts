export type WorkerConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  databaseUrl: string
  redisUrl: string
  queueName: string
}

export function readWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env
): WorkerConfig {
  const nodeEnv = environment.NODE_ENV ?? 'development'
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV must be development, test, or production')
  }
  if (!environment.REDIS_URL?.trim()) {
    throw new Error('REDIS_URL is required')
  }
  if (!environment.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required')
  }
  const queueName = environment.WORKER_QUEUE_NAME?.trim() || 'zyapp-maintenance'
  if (!/^[a-z0-9_-]{3,80}$/i.test(queueName)) {
    throw new Error('WORKER_QUEUE_NAME has an invalid format')
  }
  return {
    nodeEnv,
    databaseUrl: environment.DATABASE_URL.trim(),
    redisUrl: environment.REDIS_URL.trim(),
    queueName
  }
}
