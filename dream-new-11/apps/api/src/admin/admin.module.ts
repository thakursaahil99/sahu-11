import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { LiveModule } from '../live/live.module';
import { SportsModule } from '../sports/sports.module';
import { SupportModule } from '../support/support.module';
import { TeamsModule } from '../teams/teams.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminAuthController, AdminAuthService } from './admin-auth';
import { AdminConfigController, AdminContestsController, AdminMatchesController, AdminPlayersController } from './admin-content';
import { AdminKycController, AdminTransactionsController, AdminWithdrawalsController } from './admin-finance';
import { AdminAnnouncementsController, AdminAuditController, AdminRiskController, AdminTicketsController, RiskService } from './admin-ops';
import { AdminDashboardController, AdminUsersController } from './admin-users';
import { AdminGuard } from './admin.guard';

/** Admin panel API (/admin/*). Every controller is behind AdminGuard (scope, role, 2FA, permission, step-up). */
@Module({
  imports: [JwtModule.register({}), AuthModule, WalletModule, LiveModule, SportsModule, TeamsModule, SupportModule],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminUsersController,
    AdminTransactionsController,
    AdminWithdrawalsController,
    AdminKycController,
    AdminMatchesController,
    AdminPlayersController,
    AdminConfigController,
    AdminContestsController,
    AdminTicketsController,
    AdminRiskController,
    AdminAnnouncementsController,
    AdminAuditController,
  ],
  providers: [AdminGuard, AdminAuthService, RiskService],
})
export class AdminModule {}
