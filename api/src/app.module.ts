import { Module } from '@nestjs/common';
import { DbService } from './db/db.service';
import { HealthController } from './health/health.controller';
import { LivekitController } from './livekit/livekit.controller';
import { LivekitService } from './livekit/livekit.service';

@Module({
  controllers: [HealthController, LivekitController],
  providers: [DbService, LivekitService],
})
export class AppModule {}
