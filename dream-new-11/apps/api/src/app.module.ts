import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { DownloadController } from './download.controller';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.service';
import { SportsModule } from './sports/sports.module';
import { TeamsModule } from './teams/teams.module';
import { ContestsModule } from './contests/contests.module';
import { LiveModule } from './live/live.module';
import { WalletModule } from './wallet/wallet.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ResponsiblePlayModule } from './responsible-play/responsible-play.module';
import { SupportModule } from './support/support.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    // Global default: 120 requests/minute per IP. Auth routes override with stricter limits.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    NotificationsModule,
    ResponsiblePlayModule,
    AuthModule,
    UsersModule,
    SportsModule,
    TeamsModule,
    ContestsModule,
    LiveModule,
    WalletModule,
    SupportModule,
    AdminModule,
  ],
  controllers: [AppController, DownloadController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
