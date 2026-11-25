import { Global, Module } from '@nestjs/common';
import { Env, ENV } from '../config/config.module';
import { NotificationEvents } from './notification-events';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { createPushProvider, PUSH_PROVIDER } from './push.provider';

/** Global so wallet, contests and live scoring can notify without import cycles. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEvents, { provide: PUSH_PROVIDER, inject: [ENV], useFactory: (env: Env) => createPushProvider(env) }],
  exports: [NotificationsService, NotificationEvents],
})
export class NotificationsModule {}
