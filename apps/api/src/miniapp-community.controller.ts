import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards, BadRequestException } from '@nestjs/common'
import { MiniappAuthGuard, type MiniappRequest } from './miniapp-auth.guard'
import { MiniappCommunityService } from './miniapp-community.service'
import { API_CONFIG, REDIS_CLIENT } from './infrastructure.module'
import type { ApiConfig } from './config'
import type Redis from 'ioredis'
import { createCommunityMiniappCode } from './wechat-miniapp-provider'
function principal(r:MiniappRequest) { if (!r.zyappMiniapp) throw new Error('Missing principal');return r.zyappMiniapp }
@UseGuards(MiniappAuthGuard)
@Controller('member/community')
export class MiniappCommunityController {
  constructor(@Inject(MiniappCommunityService) private readonly service:MiniappCommunityService,
    @Inject(API_CONFIG) private readonly config:ApiConfig,@Inject(REDIS_CLIENT) private readonly redis:Redis) {}
  @Get('friends') friends(@Req() r:MiniappRequest){return this.service.friends(principal(r))}
  @Get('profile') self(@Req() r:MiniappRequest){return this.service.selfMember(principal(r))}
  @Get('members') find(@Req() r:MiniappRequest,@Query('number') number:string){return this.service.findMember(principal(r),number??'')}
  @Post('friends/:action') friend(@Req() r:MiniappRequest,@Param('action') action:string,@Body() b:unknown){return this.service.friendCommand(principal(r),action,b)}
  @Post('tables') tableCreate(@Req() r:MiniappRequest,@Body() b:unknown){return this.service.createTable(principal(r),b)}
  @Get('tables/:id') table(@Req() r:MiniappRequest,@Param('id') id:string){return this.service.table(principal(r),id)}
  @Post('tables/:id/close') close(@Req() r:MiniappRequest,@Param('id') id:string,@Body() b:unknown){return this.service.closeTable(principal(r),id,b)}
  @Post('invites') async invite(@Req() r:MiniappRequest,@Body() b:unknown){
    const value=b as {envVersion?:string}
    const version=value?.envVersion??'release'
    if(!['release','trial','develop'].includes(version))throw new BadRequestException('小程序版本无效')
    const invite=await this.service.invite(principal(r),b)
    return {...invite,imageDataUrl:await createCommunityMiniappCode(this.config,this.redis,invite.token,version as 'release'|'trial'|'develop')}
  }
  @Get('invites/:token') preview(@Req() r:MiniappRequest,@Param('token') token:string){return this.service.previewInvite(principal(r),token)}
  @Post('invites/:token/join') joinInvite(@Req() r:MiniappRequest,@Param('token') token:string,@Body() b:unknown){return this.service.joinInvite(principal(r),token,b)}
  @Get('meetups') list(@Req() r:MiniappRequest,@Query() q:Record<string,unknown>){return this.service.listMeetups(principal(r),q)}
  @Get('meetups/:id') meetup(@Req() r:MiniappRequest,@Param('id') id:string){return this.service.getMeetup(principal(r),id)}
  @Post('meetups') create(@Req() r:MiniappRequest,@Body() b:unknown){return this.service.createMeetup(principal(r),b)}
  @Post('meetups/:id/:action') act(@Req() r:MiniappRequest,@Param('id') id:string,@Param('action') a:string,@Body() b:unknown){
    if(a!=='join'&&a!=='leave'&&a!=='cancel') throw new BadRequestException('操作无效')
    return this.service.actMeetup(principal(r),id,a,b)
  }
  @Get('plays') plays(@Req() r:MiniappRequest,@Query() q:Record<string,unknown>){return this.service.listPlays(principal(r),q)}
  @Get('plays/:id') play(@Req() r:MiniappRequest,@Param('id') id:string){return this.service.getPlay(principal(r),id)}
  @Post('plays') save(@Req() r:MiniappRequest,@Body() b:unknown){return this.service.savePlay(principal(r),b)}
  @Post('plays/:id/delete') remove(@Req() r:MiniappRequest,@Param('id') id:string,@Body() b:unknown){return this.service.deletePlay(principal(r),id,b)}
  @Post('plays/:id/hide') hide(@Req() r:MiniappRequest,@Param('id') id:string,@Body() b:unknown){return this.service.deletePlay(principal(r),id,b)}
}
