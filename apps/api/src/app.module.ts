import {ActivityLotteryController} from './activity-lottery.controller'
import {ActivityLotteryService} from './activity-lottery.service'
import { MapLocationService } from './map-location.service'
import { Module } from '@nestjs/common'
import { MiniappCommunityController } from './miniapp-community.controller'
import { MiniappCommunityService } from './miniapp-community.service'
import { MiniappContentController } from './miniapp-content.controller'
import { MiniappContentService } from './miniapp-content.service'
import { CashierCommandService } from './cashier-command.service'
import { BoardGameLikeController } from './board-game-like.controller'
import { BoardGameLikeService } from './board-game-like.service'
import { EmployeeFinancialCommandService } from './employee-financial-command.service'
import { DeviceAuthGuard } from './device-auth.guard'
import { DeviceController } from './device.controller'
import { DeviceService } from './device.service'
import { DesktopMirrorController } from './desktop-mirror.controller'
import { DesktopMirrorService } from './desktop-mirror.service'
import { DesktopUpdateController } from './desktop-update.controller'
import { DesktopUpdateService } from './desktop-update.service'
import { DesktopAuthController } from './desktop-auth.controller'
import { DesktopAuthService } from './desktop-auth.service'
import { EmployeeMobileController } from './employee-mobile.controller'
import { EmployeeMobileService } from './employee-mobile.service'
import { EmployeeManagerService } from './employee-manager.service'
import { EmployeeContentService } from './employee-content.service'
import { HealthController } from './health.controller'
import { InfrastructureModule } from './infrastructure.module'
import { MemberSelfServiceController } from './member-self-service.controller'
import { MemberSelfService } from './member-self-service.service'
import { MemberAvatarController } from './member-avatar.controller'
import { MemberAvatarService } from './member-avatar.service'
import { MemberRechargeService } from './member-recharge.service'
import { MemberMonthlyCardService } from './member-monthly-card.service'
import { MiniappAuthGuard } from './miniapp-auth.guard'
import { MiniappOptionalAuthGuard } from './miniapp-optional-auth.guard'
import { MiniappController } from './miniapp.controller'
import { MiniappSessionService } from './miniapp-session.service'
import { PublicContentController } from './public-content.controller'
import { PublicContentService } from './public-content.service'
import { SyncController } from './sync.controller'
import { SyncService } from './sync.service'
import { TenantAdminController } from './tenant-admin.controller'
import { TenantAdminService } from './tenant-admin.service'
import { WechatPaymentController } from './wechat-payment.controller'
import { BoardGameMetadataController } from './board-game-metadata/board-game-metadata.controller'
import { BoardGameMetadataService } from './board-game-metadata/board-game-metadata.service'
import { BggRequestGate } from './board-game-metadata/request-gate'
import { BoardGameCoverController } from './board-game-cover.controller'
import { BoardGameCoverCacheService } from './board-game-cover-cache.service'

@Module({
  imports: [InfrastructureModule],
  controllers: [
    StaffWorkspaceController,
    ActivityLotteryController,
    MiniappCommunityController,
    MiniappContentController,
    HealthController,
    DeviceController,
    DesktopMirrorController,
    SyncController,
    PublicContentController,
    BoardGameLikeController,
    DesktopUpdateController,
    DesktopAuthController,
    MiniappController,
    MemberSelfServiceController,
    MemberAvatarController,
    WechatPaymentController,
    EmployeeMobileController,
    TenantAdminController,
    BoardGameMetadataController,
    BoardGameCoverController
  ],
  providers: [
    StaffWorkspaceService,
    MiniappNoticeService,
    ActivityLotteryService,
    MiniappCommunityService,
    MiniappContentService,
    MapLocationService,
    DeviceService,
    DesktopMirrorService,
    DeviceAuthGuard,
    SyncService,
    PublicContentService,
    BoardGameLikeService,
    DesktopUpdateService,
    DesktopAuthService,
    MiniappSessionService,
    MiniappAuthGuard,
    MiniappOptionalAuthGuard,
    MemberSelfService,
    MemberAvatarService,
    MemberRechargeService,
    MemberMonthlyCardService,
    EmployeeMobileService,
    EmployeeManagerService,
    EmployeeContentService,
    CashierCommandService,
    EmployeeFinancialCommandService,
    TenantAdminService,
    BggRequestGate,
    BoardGameMetadataService,
    BoardGameCoverCacheService
  ]
})
export class AppModule {}
import {StaffWorkspaceController} from './staff-workspace.controller'
import {StaffWorkspaceService} from './staff-workspace.service'
import {MiniappNoticeService} from './miniapp-notice.service'
