import {Body,Controller,Get,Inject,Param,Post,Query,Req,UseGuards} from '@nestjs/common'
import type {NoticeScene} from '@zyapp/contracts'
import {MiniappAuthGuard,type MiniappRequest} from './miniapp-auth.guard'
import {StaffWorkspaceService} from './staff-workspace.service'
import {MiniappNoticeService} from './miniapp-notice.service'
function principal(r:MiniappRequest){if(!r.zyappMiniapp)throw new Error('Missing authenticated principal');return r.zyappMiniapp}
@UseGuards(MiniappAuthGuard)
@Controller('workspace')
export class StaffWorkspaceController{
  constructor(@Inject(StaffWorkspaceService) private readonly staff:StaffWorkspaceService,@Inject(MiniappNoticeService) private readonly notices:MiniappNoticeService){}
  @Get('activities') activities(@Req() r:MiniappRequest){return this.staff.activities(principal(r))}
  @Get('batches') batches(@Req() r:MiniappRequest,@Query('activityId') id:string){return this.staff.batches(principal(r),id)}
  @Get('batches/:id/code') code(@Req() r:MiniappRequest,@Param('id') id:string){return this.staff.batchCode(principal(r),id)}
  @Post('batches') create(@Req() r:MiniappRequest,@Body() body:Parameters<StaffWorkspaceService['createBatch']>[1]){return this.staff.createBatch(principal(r),body)}
  @Post('batches/:id/revoke') revoke(@Req() r:MiniappRequest,@Param('id') id:string){return this.staff.revoke(principal(r),id)}
  @Post('batches/:id/cancel') cancel(@Req() r:MiniappRequest,@Param('id') id:string,@Body() body:{entryId:string;reason:string}){return this.staff.cancel(principal(r),id,body?.entryId,body?.reason)}
  @Get('transactions') transactions(@Req() r:MiniappRequest,@Query('fromDate') fromDate?:string,@Query('toDate') toDate?:string,@Query('kind') kind?:string,@Query('query') query?:string,@Query('offset') offset?:string){return this.staff.transactions(principal(r),{fromDate,toDate,kind,query,offset:offset===undefined?0:Number(offset)})}
  @Post('admissions/:scene') admission(@Req() r:MiniappRequest,@Param('scene') scene:string){return this.staff.admission(principal(r),scene)}
  @Post('admissions/:scene/confirm') confirm(@Req() r:MiniappRequest,@Param('scene') scene:string){return this.staff.admission(principal(r),scene,true)}
  @Get('lotteries/:id') result(@Req() r:MiniappRequest,@Param('id') id:string){return this.staff.result(principal(r),id)}
  @Get('notice-scenes') scenes(@Req() r:MiniappRequest){return this.notices.scenes(principal(r))}
  @Post('notice-scenes') save(@Req() r:MiniappRequest,@Body() body:NoticeScene){return this.notices.save(principal(r),body)}
  @Post('subscriptions') prepare(@Req() r:MiniappRequest,@Body() body:{scene:string;businessId?:string}){return this.notices.prepare(principal(r),body?.scene,body?.businessId)}
  @Post('subscriptions/:id') receipt(@Req() r:MiniappRequest,@Param('id') id:string,@Body() body:{result:string}){return this.notices.receipt(principal(r),id,body?.result)}
  @Get('notices') list(@Req() r:MiniappRequest,@Query('offset') offset?:string){return this.notices.list(principal(r),offset===undefined?0:Number(offset))}
  @Post('notices/:id/read') read(@Req() r:MiniappRequest,@Param('id') id:string){return this.notices.read(principal(r),id)}
}
