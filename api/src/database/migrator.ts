import { Logger } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { SequelizeStorage, Umzug } from 'umzug';
import * as m0001 from './migrations/0001-init';
import * as m0002 from './migrations/0002-knowledge';
import * as m0003 from './migrations/0003-admin';
import * as m0004 from './migrations/0004-integrations';
import * as m0005 from './migrations/0005-recordings';
import * as m0006 from './migrations/0006-telephony';
import * as m0007 from './migrations/0007-widgets';

// Migrations are imported explicitly (no globbing), so they work the same
// from ts sources and compiled dist/. Append new ones in order.
const MIGRATIONS = [
  { name: '0001-init', ...m0001 },
  { name: '0002-knowledge', ...m0002 },
  { name: '0003-admin', ...m0003 },
  { name: '0004-integrations', ...m0004 },
  { name: '0005-recordings', ...m0005 },
  { name: '0006-telephony', ...m0006 },
  { name: '0007-widgets', ...m0007 },
];

export function createMigrator(sequelize: Sequelize) {
  const logger = new Logger('Migrations');
  return new Umzug({
    migrations: MIGRATIONS.map((m) => ({ name: m.name, up: m.up, down: m.down })),
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, tableName: 'schema_migrations' }),
    logger: {
      info: (msg) => logger.log(JSON.stringify(msg)),
      warn: (msg) => logger.warn(JSON.stringify(msg)),
      error: (msg) => logger.error(JSON.stringify(msg)),
      debug: () => undefined,
    },
  });
}

export async function runMigrations(sequelize: Sequelize) {
  const applied = await createMigrator(sequelize).up();
  return applied.map((m) => m.name);
}
