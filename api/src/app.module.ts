import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AdminUsersController, AuthController } from './auth/auth.controller';
import { ApiAuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { CallsController } from './calls/calls.controller';
import { CallsService } from './calls/calls.service';
import { config } from './config';
import { MODELS } from './database/models';
import { HealthController } from './health/health.controller';
import { EmbeddingsService } from './knowledge/embeddings';
import { KnowledgeController } from './knowledge/knowledge.controller';
import { KnowledgeService } from './knowledge/knowledge.service';
import { LeadsController } from './leads/leads.controller';
import { LeadsService } from './leads/leads.service';
import { LivekitController } from './livekit/livekit.controller';
import { LivekitService } from './livekit/livekit.service';
import { ProfileController } from './profile/profile.controller';
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
  controllers: [
    HealthController, LivekitController, CallsController, LeadsController, TicketsController,
    KnowledgeController, ProfileController, AuthController, AdminUsersController,
  ],
  providers: [AuthService, ApiAuthGuard, LivekitService, CallsService, LeadsService, TicketsService, KnowledgeService, EmbeddingsService],
})
export class AppModule {}
