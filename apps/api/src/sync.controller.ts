import {
  Body,
  Controller,
  Get,
  Inject,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards
} from '@nestjs/common'
import type {
  SyncPullResult,
  SyncPushResult,
  SyncReceiveResult
} from '@zyapp/sync-protocol'
import { Observable } from 'rxjs'
import {
  DeviceAuthGuard,
  type DeviceRequest
} from './device-auth.guard'
import { SyncService } from './sync.service'

@UseGuards(DeviceAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly syncService: SyncService) {}

  @Get('capabilities')
  capabilities() { return { atomicFinancialCommands: 1 } }

  @Post('push')
  push(
    @Req() request: DeviceRequest,
    @Body() body: unknown
  ): Promise<SyncReceiveResult> {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return this.syncService.receive(request.zyappDevice, body)
  }

  @Post('command')
  command(
    @Req() request: DeviceRequest,
    @Body() body: unknown
  ) {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return this.syncService.command(request.zyappDevice, body)
  }

  @Get('operations/:operationId')
  operation(
    @Req() request: DeviceRequest,
    @Param('operationId') operationId: string
  ) {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return this.syncService.operation(request.zyappDevice, operationId)
  }

  @Sse('stream')
  stream(@Req() request: DeviceRequest): Observable<MessageEvent> {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    const principal = request.zyappDevice
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false
      let querying = false
      let lastSequence: string | null = null
      let lastHeartbeat = 0
      const poll = async () => {
        if (closed || querying) return
        querying = true
        try {
          const sequence = await this.syncService.latestEventSequence(principal)
          const now = Date.now()
          if (sequence !== lastSequence || now - lastHeartbeat >= 15_000) {
            subscriber.next({
              type: sequence === lastSequence ? 'heartbeat' : 'cloud-event',
              id: sequence,
              data: { cursor: sequence }
            })
            lastSequence = sequence
            lastHeartbeat = now
          }
        } catch (error) {
          subscriber.error(error)
        } finally {
          querying = false
        }
      }
      void poll()
      const timer = setInterval(() => void poll(), 1_000)
      return () => {
        closed = true
        clearInterval(timer)
      }
    })
  }

  @Get('results')
  results(
    @Req() request: DeviceRequest,
    @Query('afterDeviceSeq') afterDeviceSeq?: string,
    @Query('limit') limit?: string
  ): Promise<SyncPushResult> {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return this.syncService.results(
      request.zyappDevice,
      afterDeviceSeq,
      limit
    )
  }

  @Get('pull')
  pull(
    @Req() request: DeviceRequest,
    @Query('afterCursor') afterCursor?: string,
    @Query('limit') limit?: string
  ): Promise<SyncPullResult> {
    if (!request.zyappDevice) {
      throw new Error('Device guard did not attach a principal')
    }
    return this.syncService.pull(request.zyappDevice, afterCursor, limit)
  }
}
