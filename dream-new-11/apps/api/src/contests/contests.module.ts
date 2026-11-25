import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { ContestLifecycleService } from './contest-lifecycle.service';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';

@Module({
  imports: [WalletModule],
  controllers: [ContestsController],
  providers: [ContestsService, ContestLifecycleService],
  exports: [ContestsService],
})
export class ContestsModule {}
