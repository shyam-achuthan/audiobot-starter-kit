import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { CallsController } from './calls/calls.controller';
import { CallsService } from './calls/calls.service';
import { config } from './config';
import { MODELS } from './database/models';
import { HealthController } from './health/health.controller';
import { LeadsController } from './leads/leads.controller';
import { LeadsService } from './leads/leads.service';
import { LivekitController } from './livekit/livekit.controller';
import { LivekitService } from './livekit/livekit.service';
import { TicketsController } from './tickets/tickets.controller';
import { TicketsService } from './tickets/tickets.service';

@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: 'postgres',
      uri: config.databaseUrl,
      models: MODELS,
      synchronize: false, // schema is owned by migrations (src/database/migrations)
      logging: false,
      pool: { max: 10 },
      define: { underscored: true },
    }),
    SequelizeModule.forFeature(MODELS),
  ],
  controllers: [HealthController, LivekitController, CallsController, LeadsController, TicketsController],
  providers: [LivekitService, CallsService, LeadsService, TicketsService],
})
export class AppModule {}
