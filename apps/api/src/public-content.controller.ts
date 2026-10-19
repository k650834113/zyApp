import {
  Controller,
  Get,
  Inject,
  Query,
  Param,
  Req,
  UseGuards
} from '@nestjs/common'
import type {
  MiniappHomeSnapshot,
  PublicActivitySummary,
  PublicBoardGameFilterOptions,
  PublicBoardGameSummary
} from '@zyapp/contracts'
import { normalizePublicBoardGameFilters } from './board-game-library'
import type { MiniappRequest } from './miniapp-auth.guard'
import { MiniappOptionalAuthGuard } from './miniapp-optional-auth.guard'
import { MiniappCommunityService } from './miniapp-community.service'
import { PublicContentService } from './public-content.service'
import { MemberMonthlyCardService } from './member-monthly-card.service'
import { normalizeBoardGameId } from './board-game-library'
import type { PublicPricing } from '@zyapp/contracts'

@Controller('public')
export class PublicContentController {
  constructor(
    @Inject(PublicContentService)
    private readonly publicContent: PublicContentService,
    @Inject(MemberMonthlyCardService) private readonly monthlyCards:MemberMonthlyCardService,
    @Inject(MiniappCommunityService) private readonly community:MiniappCommunityService
  ) {}
  @Get('meetups/:id')
  @UseGuards(MiniappOptionalAuthGuard)
  meetup(@Query('storeId') storeId:string,@Param('id') id:string,@Req() r:MiniappRequest){
    const p=r.zyappMiniapp
    return this.community.publicMeetup(storeId,id,p?.storeId===storeId&&p.memberStatus==='active'?p.memberId??'':'')
  }
  @Get('pricing')
  async pricing(@Query('storeId') storeId:string):Promise<PublicPricing> {
    normalizeBoardGameId(storeId)
    const [rows,monthlyCard]=await Promise.all([this.publicContent.getPricingRows(storeId),this.monthlyCards.getPublicPlan(storeId)])
    return {rows,monthlyCard}
  }

  @Get('home')
  home(@Query('storeId') storeId: string): Promise<MiniappHomeSnapshot> {
    return this.publicContent.getHome(storeId)
  }

  @Get('activities')
  async activities(
    @Query('storeId') storeId: string
  ): Promise<PublicActivitySummary[]> {
    const [items,content]=await Promise.all([this.publicContent.listActivities(storeId),this.publicContent.getPublishedContent(storeId)])
    return this.publicContent.decorateActivities(items,content)
  }

  @Get('games')
  @UseGuards(MiniappOptionalAuthGuard)
  games(
    @Query() query: Record<string, unknown>,
    @Req() request: MiniappRequest
  ): Promise<PublicBoardGameSummary[]> {
    const filters = normalizePublicBoardGameFilters(query)
    return this.publicContent.listGames(
      query.storeId as string,
      filters,
      request.zyappMiniapp?.identityId ?? null,
      { baseGamesOnly: filters.baseGameId === undefined }
    )
  }

  @Get('game-filter-options')
  gameFilterOptions(
    @Query('storeId') storeId: string
  ): Promise<PublicBoardGameFilterOptions> {
    return this.publicContent.getGameFilterOptions(storeId)
  }

  @Get('games/:id')
  @UseGuards(MiniappOptionalAuthGuard)
  game(@Query('storeId') storeId: string, @Param('id') id: string, @Req() request: MiniappRequest): Promise<PublicBoardGameSummary> {
    return this.publicContent.getGame(storeId, id, request.zyappMiniapp?.identityId ?? null)
  }
}
