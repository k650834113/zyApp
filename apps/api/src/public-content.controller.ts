import { Controller, Get, Inject, Query } from '@nestjs/common'
import type {
  MiniappHomeSnapshot,
  PublicActivitySummary,
  PublicBoardGameSummary
} from '@zyapp/contracts'
import { PublicContentService } from './public-content.service'

@Controller('public')
export class PublicContentController {
  constructor(
    @Inject(PublicContentService)
    private readonly publicContent: PublicContentService
  ) {}

  @Get('home')
  home(@Query('storeId') storeId: string): Promise<MiniappHomeSnapshot> {
    return this.publicContent.getHome(storeId)
  }

  @Get('activities')
  activities(
    @Query('storeId') storeId: string
  ): Promise<PublicActivitySummary[]> {
    return this.publicContent.listActivities(storeId)
  }

  @Get('games')
  games(
    @Query('storeId') storeId: string,
    @Query('query') query?: string
  ): Promise<PublicBoardGameSummary[]> {
    return this.publicContent.listGames(storeId, query)
  }
}
