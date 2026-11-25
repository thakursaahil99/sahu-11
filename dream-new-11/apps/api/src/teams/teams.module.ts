import { Module } from '@nestjs/common';
import { SportsModule } from '../sports/sports.module';
import { FantasyConfigService } from './fantasy-config.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [SportsModule],
  controllers: [TeamsController],
  providers: [TeamsService, FantasyConfigService],
  exports: [TeamsService, FantasyConfigService],
})
export class TeamsModule {}
