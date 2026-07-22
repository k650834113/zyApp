import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import {
  createPostgresPool,
  processReceivedSyncOperations,
  type Pool
} from '@zyapp/cloud-db'
import { Worker } from 'bullmq'
import { readWorkerConfig } from './config'

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name)
  private worker: Worker | null = null
  private pool: Pool | null = null
  private syncTimer: NodeJS.Timeout | null = null
  private syncProcessing = false

  async onModuleInit(): Promise<void> {
    const config = readWorkerConfig()
    this.pool = createPostgresPool(config.databaseUrl)
    this.worker = new Worker(
      config.queueName,
      async (job) => {
        if (job.name === 'health.ping') {
          return { ok: true, processedAt: new Date().toISOString() }
        }
        this.logger.warn(`Unsupported job ignored: ${job.name}`)
        return { ignored: true }
      },
      {
        connection: {
          url: config.redisUrl,
          maxRetriesPerRequest: null,
          connectTimeout: 5_000
        },
        concurrency: 2
      }
    )
    this.worker.on('completed', (job) => {
      this.logger.log(`Completed job ${job.id ?? 'unknown'} (${job.name})`)
    })
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Failed job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'})`,
        error.stack
      )
    })
    this.syncTimer = setInterval(() => {
      void this.processSyncInbox()
    }, 1_000)
    await this.processSyncInbox()
  }

  private async processSyncInbox(): Promise<void> {
    if (!this.pool || this.syncProcessing) return
    this.syncProcessing = true
    try {
      const result = await processReceivedSyncOperations(this.pool)
      if (result.confirmed > 0 || result.conflicts > 0) {
        this.logger.log(
          `Processed sync inbox: ${result.confirmed} confirmed, ${result.conflicts} conflicts`
        )
      }
    } catch (error) {
      this.logger.error(
        'Sync inbox processing failed',
        error instanceof Error ? error.stack : String(error)
      )
    } finally {
      this.syncProcessing = false
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.syncTimer) clearInterval(this.syncTimer)
    await this.worker?.close()
    await this.pool?.end()
  }
}
