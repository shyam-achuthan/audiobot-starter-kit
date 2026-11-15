import { DataTypes, QueryInterface, Sequelize } from 'sequelize';

const now = Sequelize.literal('now()');
const uuid = Sequelize.literal('gen_random_uuid()');

export async function up({ context: qi }: { context: QueryInterface }) {
  // Outbound webhook subscribers, managed by owners in the dashboard.
  await qi.createTable('webhook_endpoints', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    name: { type: DataTypes.TEXT, allowNull: false },
    url: { type: DataTypes.TEXT, allowNull: false },
    // Standard Webhooks secret: "whsec_" + base64 key.
    secret: { type: DataTypes.TEXT, allowNull: false },
    // Event types to send; empty array = all events.
    events: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_by: { type: DataTypes.TEXT },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });

  // Outbox: one row per business event, written in the same transaction as the change.
  await qi.createTable('events', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    type: { type: DataTypes.STRING(48), allowNull: false },
    // Entity the event is about, e.g. "lead:<uuid>"; used to coalesce connector syncs.
    subject: { type: DataTypes.TEXT, allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await qi.addIndex('events', ['created_at']);

  // One row per (event, target). Target is a webhook endpoint or a built-in connector.
  await qi.createTable('webhook_deliveries', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    event_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: 'events', key: 'id' }, onDelete: 'CASCADE',
    },
    endpoint_id: {
      type: DataTypes.UUID,
      references: { model: 'webhook_endpoints', key: 'id' }, onDelete: 'CASCADE',
    },
    connector: { type: DataTypes.STRING(16) }, // twenty | chatwoot (when endpoint_id is null)
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'pending' }, // pending|sending|succeeded|dead
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    next_attempt_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    locked_until: { type: DataTypes.DATE },
    last_status_code: { type: DataTypes.INTEGER },
    last_error: { type: DataTypes.TEXT },
    last_response: { type: DataTypes.TEXT },
    last_duration_ms: { type: DataTypes.INTEGER },
    delivered_at: { type: DataTypes.DATE },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await qi.addIndex('webhook_deliveries', ['status', 'next_attempt_at']);
  await qi.addIndex('webhook_deliveries', ['endpoint_id', 'created_at']);
  await qi.addIndex('webhook_deliveries', ['connector', 'created_at']);
  await qi.addIndex('webhook_deliveries', ['event_id']);

  // Ids of the records this lead/ticket created in Twenty / Chatwoot.
  await qi.addColumn('leads', 'external', { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
  await qi.addColumn('tickets', 'external', { type: DataTypes.JSONB, allowNull: false, defaultValue: {} });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn('tickets', 'external');
  await qi.removeColumn('leads', 'external');
  await qi.dropTable('webhook_deliveries');
  await qi.dropTable('events');
  await qi.dropTable('webhook_endpoints');
}
