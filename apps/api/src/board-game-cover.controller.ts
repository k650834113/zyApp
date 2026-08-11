import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  StreamableFile
} from '@nestjs/common'
import { BoardGameCoverCacheService } from './board-game-cover-cache.service'

@Controller('public/board-game-covers')
export class BoardGameCoverController {
  constructor(
    @Inject(BoardGameCoverCacheService)
    private readonly covers: BoardGameCoverCacheService
  ) {}

  @Get(':fileName')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async read(@Param('fileName') fileName: string): Promise<StreamableFile> {
    const cover = await this.covers.read(fileName)
    return new StreamableFile(cover.buffer, {
      type: cover.contentType,
      length: cover.buffer.length
    })
  }
}
