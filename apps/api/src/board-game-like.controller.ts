import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common'
import type {
  BoardGameLikeResult,
  PublicBoardGameSummary
} from '@zyapp/contracts'
import { BoardGameLikeService } from './board-game-like.service'
import type { MiniappPrincipal } from './miniapp-auth'
import {
  MiniappAuthGuard,
  type MiniappRequest
} from './miniapp-auth.guard'
import { PublicContentService } from './public-content.service'
import { normalizePublicBoardGameFilters } from './board-game-library'

function principal(request: MiniappRequest): MiniappPrincipal {
  if (!request.zyappMiniapp) {
    throw new Error('Miniapp guard did not attach a principal')
  }
  return request.zyappMiniapp
}

@Controller('miniapp')
@UseGuards(MiniappAuthGuard)
export class BoardGameLikeController {
  constructor(
    @Inject(BoardGameLikeService)
    private readonly likes: BoardGameLikeService,
    @Inject(PublicContentService)
    private readonly publicContent: PublicContentService
  ) {}

  @Get('favorite-games')
  favoriteGames(
    @Req() request: MiniappRequest,
    @Query() query:Record<string,unknown>
  ): Promise<PublicBoardGameSummary[]> {
    return this.publicContent.listFavoriteGames(principal(request),normalizePublicBoardGameFilters(query))
  }

  @Put('board-games/:gameId/like')
  setLiked(
    @Req() request: MiniappRequest,
    @Param('gameId') gameId: string,
    @Body() body: unknown
  ): Promise<BoardGameLikeResult> {
    return this.likes.setLiked(principal(request), gameId, body)
  }
}
