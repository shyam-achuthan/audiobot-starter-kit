import { DataTypes, QueryInterface, Sequelize } from 'sequelize';

const now = Sequelize.literal('now()');
const uuid = Sequelize.literal('gen_random_uuid()');

function timestamps() {
  return {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  };
}

export async function up({ context: qi }: { context: QueryInterface }) {
  await qi.createTable('calls', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    room: { type: DataTypes.TEXT, allowNull: false, unique: true },
    channel: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'web' },
    start_workflow: { type: DataTypes.STRING(32), allowNull: false },
    agent_path: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    language: { type: DataTypes.STRING(8) },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' },
    outcome: { type: DataTypes.STRING(32) },
    caller_name: { type: DataTypes.TEXT },
    caller_phone: { type: DataTypes.TEXT },
    caller_email: { type: DataTypes.TEXT },
    turn_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    median_e2e_ms: { type: DataTypes.INTEGER },
    started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    ended_at: { type: DataTypes.DATE },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ...timestamps(),
  });
  await qi.addIndex('calls', ['started_at']);

  await qi.createTable('call_turns', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    call_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: 'calls', key: 'id' }, onDelete: 'CASCADE',
    },
    turn_no: { type: DataTypes.INTEGER, allowNull: false },
    agent: { type: DataTypes.STRING(32) },
    language: { type: DataTypes.STRING(8) },
    user_text: { type: DataTypes.TEXT },
    agent_text: { type: DataTypes.TEXT },
    interrupted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    eot_ms: { type: DataTypes.INTEGER },
    stt_ms: { type: DataTypes.INTEGER },
    llm_ttft_ms: { type: DataTypes.INTEGER },
    tts_ttfb_ms: { type: DataTypes.INTEGER },
    e2e_ms: { type: DataTypes.INTEGER },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await qi.addIndex('call_turns', ['call_id', 'turn_no'], { unique: true });

  await qi.createTable('leads', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    call_id: {
      type: DataTypes.UUID, references: { model: 'calls', key: 'id' }, onDelete: 'SET NULL',
    },
    name: { type: DataTypes.TEXT },
    phone: { type: DataTypes.TEXT },
    email: { type: DataTypes.TEXT },
    company: { type: DataTypes.TEXT },
    need: { type: DataTypes.TEXT },
    budget: { type: DataTypes.TEXT },
    authority: { type: DataTypes.TEXT },
    timeline: { type: DataTypes.TEXT },
    team_size: { type: DataTypes.TEXT },
    score: { type: DataTypes.INTEGER },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'new' },
    preferred_callback_time: { type: DataTypes.TEXT },
    language: { type: DataTypes.STRING(8) },
    notes: { type: DataTypes.TEXT },
    ...timestamps(),
  });
  await qi.addIndex('leads', ['phone']);
  await qi.addIndex('leads', ['created_at']);

  await qi.createTable('tickets', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    number: { type: DataTypes.INTEGER, allowNull: false, autoIncrement: true, unique: true },
    call_id: {
      type: DataTypes.UUID, references: { model: 'calls', key: 'id' }, onDelete: 'SET NULL',
    },
    lead_id: {
      type: DataTypes.UUID, references: { model: 'leads', key: 'id' }, onDelete: 'SET NULL',
    },
    type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'support' },
    subject: { type: DataTypes.TEXT, allowNull: false },
    description: { type: DataTypes.TEXT },
    priority: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'normal' },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'open' },
    contact_name: { type: DataTypes.TEXT },
    contact_phone: { type: DataTypes.TEXT },
    contact_email: { type: DataTypes.TEXT },
    preferred_callback_time: { type: DataTypes.TEXT },
    language: { type: DataTypes.STRING(8) },
    ...timestamps(),
  });
  // Human-friendly ticket numbers: TKT-1001, TKT-1002, …
  await qi.sequelize.query('ALTER SEQUENCE tickets_number_seq RESTART WITH 1001');
  await qi.addIndex('tickets', ['contact_phone']);
  await qi.addIndex('tickets', ['created_at']);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.dropTable('tickets');
  await qi.dropTable('leads');
  await qi.dropTable('call_turns');
  await qi.dropTable('calls');
}
