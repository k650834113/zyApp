import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common'
import type { DevicePrincipal } from '../device-auth'
import {
  DeviceAuthGuard,
  type DeviceRequest
} from '../device-auth.guard'
import { BoardGameMetadataService } from './board-game-metadata.service'

function principal(request: DeviceRequest): DevicePrincipal {
  if (!request.zyappDevice) {
    throw new UnauthorizedException('Device authentication is required')
  }
  return request.zyappDevice
}

@UseGuards(DeviceAuthGuard)
@Controller('board-game-metadata')
export class BoardGameMetadataController {
  constructor(
    @Inject(BoardGameMetadataService)
    private readonly service: BoardGameMetadataService
  ) {}

  @Get('status')
  status(
    @Req() request: DeviceRequest,
    @Query('actorId') actorId: string
  ) {
    return this.service.status(principal(request), actorId)
  }

  @Get('search')
  search(
    @Req() request: DeviceRequest,
    @Query('actorId') actorId: string,
    @Query('query') query: string
  ) {
    return this.service.search(principal(request), actorId, query)
  }

  @Get('bgg/:externalId')
  details(
    @Req() request: DeviceRequest,
    @Query('actorId') actorId: string,
    @Param('externalId') externalId: string
  ) {
    return this.service.details(principal(request), actorId, externalId)
  }

  @Post('bgg/:externalId/cache-cover')
  cacheCover(
    @Req() request: DeviceRequest,
    @Query('actorId') actorId: string,
    @Param('externalId') externalId: string
  ) {
    return this.service.cacheCover(principal(request), actorId, externalId)
  }
}
