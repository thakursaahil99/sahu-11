import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { HistoryService } from './history.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [WalletModule],
  controllers: [UsersController],
  providers: [UsersService, HistoryService],
})
export class UsersModule {}
