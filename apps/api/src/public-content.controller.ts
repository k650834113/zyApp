import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards
} from '@nestjs/common'
import type {
  MiniappHomeSnapshot,
  PublicActivitySummary,
  PublicBoardGameSummary
} from '@zyapp/contracts'
import { normalizePublicBoardGameFilters } from './board-game-library'
import type { MiniappRequest } from './miniapp-auth.guard'
import { MiniappOptionalAuthGuard } from './miniapp-optional-auth.guard'
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
  @UseGuards(MiniappOptionalAuthGuard)
  games(
    @Query() query: Record<string, unknown>,
    @Req() request: MiniappRequest
  ): Promise<PublicBoardGameSummary[]> {
    return this.publicContent.listGames(
      query.storeId as string,
      normalizePublicBoardGameFilters(query),
      request.zyappMiniapp?.identityId ?? null
    )
  }
}
