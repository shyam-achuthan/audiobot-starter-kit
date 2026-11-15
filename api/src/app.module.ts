import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AgentsController } from './agents/agents.controller';
import { AgentsService } from './agents/agents.service';
import { StatsController } from './stats/stats.controller';
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
import { ConnectorRegistry } from './integrations/connector-registry';
import { ChatwootConnector } from './integrations/connectors/chatwoot';
import { TwentyConnector } from './integrations/connectors/twenty';
import { DeliveryWorker } from './integrations/delivery.worker';
import { EventsService } from './integrations/events.service';
import { ChatwootInboundController, IntegrationsController } from './integrations/integrations.controller';
import { IntegrationsService } from './integrations/integrations.service';
import { RecordingsController, RetentionController } from './recordings/recordings.controller';
import { RecordingsService } from './recordings/recordings.service';
import { OutboundController, PhoneController } from './telephony/telephony.controller';
import { TelephonyService } from './telephony/telephony.service';

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
    AgentsController, StatsController, IntegrationsController, ChatwootInboundController,
    RecordingsController, RetentionController, PhoneController, OutboundController,
  ],
  providers: [AuthService, ApiAuthGuard, AgentsService, LivekitService, CallsService, LeadsService, TicketsService, KnowledgeService, EmbeddingsService,
    EventsService, DeliveryWorker, ConnectorRegistry, TwentyConnector, ChatwootConnector, IntegrationsService,
    RecordingsService, TelephonyService],
})
export class AppModule {}
