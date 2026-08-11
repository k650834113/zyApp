import { StreamableFile } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { BoardGameCoverCacheService } from './board-game-cover-cache.service'
import { BoardGameCoverController } from './board-game-cover.controller'

describe('BoardGameCoverController', () => {
  it('serves a cached cover with its detected media type', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    const covers = {
      read: vi.fn().mockResolvedValue({
        buffer: jpeg,
        contentType: 'image/jpeg'
      })
    }
    const controller = new BoardGameCoverController(
      covers as unknown as BoardGameCoverCacheService
    )
    const fileName = `${'a'.repeat(64)}.jpg`

    const result = await controller.read(fileName)

    expect(result).toBeInstanceOf(StreamableFile)
    expect(covers.read).toHaveBeenCalledWith(fileName)
    expect(result.getHeaders()).toMatchObject({
      type: 'image/jpeg',
      length: jpeg.length
    })
  })
})
