import type { NestExpressApplication } from '@nestjs/platform-express';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Sequelize } from 'sequelize-typescript';
import { AppModule } from './app.module';
import { config } from './config';
import { runMigrations } from './database/migrator';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const log = new Logger('Bootstrap');

  if (config.autoMigrate) {
    const applied = await runMigrations(app.get(Sequelize));
    log.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database schema up to date');
  }

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : true,
  });
  // Real client IP (login throttling) from X-Forwarded-For set by the web app on the Docker network.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  log.log(`API listening on :${config.port}`);
}

void bootstrap();
