import { Module } from '@nestjs/common';
import { Env, ENV } from '../config/config.module';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { CricketDataProvider } from './providers/cricketdata.provider';
import { MockProvider } from './providers/mock.provider';
import { SPORTS_PROVIDER } from './providers/sports-provider';
import { SportsSyncService } from './sports-sync.service';

@Module({
  controllers: [MatchesController],
  providers: [
    MatchesService,
    SportsSyncService,
    {
      provide: SPORTS_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.SPORTS_PROVIDER === 'cricketdata' ? new CricketDataProvider(env.CRICKETDATA_API_KEY!) : new MockProvider(),
    },
  ],
  exports: [MatchesService, SportsSyncService, SPORTS_PROVIDER],
})
export class SportsModule {}
