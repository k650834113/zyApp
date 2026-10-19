import {Body,Controller,Get,Inject,Post,Query,Req,UnauthorizedException,UseGuards} from '@nestjs/common'
import {DeviceAuthGuard,type DeviceRequest} from './device-auth.guard'
import {ActivityLotteryService} from './activity-lottery.service'
function principal(r:DeviceRequest){if(!r.zyappDevice)throw new UnauthorizedException();return r.zyappDevice}
@UseGuards(DeviceAuthGuard)
@Controller('activity-lottery')
export class ActivityLotteryController{
  constructor(@Inject(ActivityLotteryService) private readonly service:ActivityLotteryService){}
  @Get() read(@Req() r:DeviceRequest,@Query('actorId') actor:string,@Query('activityId') activity:string){return this.service.read(principal(r),actor,activity)}
  @Get('member') member(@Req() r:DeviceRequest,@Query('actorId') actor:string,@Query('activityId') activity:string,@Query('phone') phone:string){return this.service.findMember(principal(r),actor,activity,phone)}
  @Post('commands') execute(@Req() r:DeviceRequest,@Query('actorId') actor:string,@Body() body:unknown){return this.service.execute(principal(r),actor,body)}
}
