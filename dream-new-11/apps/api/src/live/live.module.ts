import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SportsModule } from '../sports/sports.module';
import { TeamsModule } from '../teams/teams.module';
import { WalletModule } from '../wallet/wallet.module';
import { LiveQueryService } from './live-query.service';
import { LiveScoringService } from './live-scoring.service';
import { LiveController } from './live.controller';
import { LiveGateway } from './live.gateway';
import { ScoringConfigService } from './scoring-config.service';

@Module({
  imports: [JwtModule.register({}), SportsModule, TeamsModule, WalletModule],
  controllers: [LiveController],
  providers: [LiveGateway, LiveScoringService, LiveQueryService, ScoringConfigService],
  exports: [LiveScoringService, ScoringConfigService],
})
export class LiveModule {}
