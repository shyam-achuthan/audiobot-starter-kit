import { DataTypes, QueryInterface, Sequelize } from 'sequelize';

const now = Sequelize.literal('now()');
const uuid = Sequelize.literal('gen_random_uuid()');

export async function up({ context: qi }: { context: QueryInterface }) {
  // Admin dashboard accounts (email + password, scrypt-hashed).
  await qi.createTable('admin_users', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    email: { type: DataTypes.TEXT, allowNull: false },
    name: { type: DataTypes.TEXT },
    password_hash: { type: DataTypes.TEXT, allowNull: false },
    role: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'admin' }, // owner | admin
    disabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    last_login_at: { type: DataTypes.DATE },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await qi.sequelize.query('CREATE UNIQUE INDEX admin_users_email_uq ON admin_users (lower(email))');

  // Login sessions. Only a SHA-256 of the token is stored.
  await qi.createTable('admin_sessions', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    user_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: 'admin_users', key: 'id' }, onDelete: 'CASCADE',
    },
    token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    user_agent: { type: DataTypes.TEXT },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    last_seen_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await qi.addIndex('admin_sessions', ['user_id']);

  // Per-agent settings. `defaults` is reported by the agent worker (source of truth: agent/prompts.py
  // and env); `overrides` is what admins change in the dashboard. Effective = defaults + overrides.
  await qi.createTable('agent_configs', {
    workflow: { type: DataTypes.STRING(32), primaryKey: true },
    defaults: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    overrides: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    updated_by: { type: DataTypes.TEXT },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await qi.sequelize.query(`
    INSERT INTO agent_configs (workflow) VALUES ('router'), ('lead_qualification'), ('sales'), ('support')
  `);

  // Dashboard ticket queue filter (calls/leads already have created/started indexes).
  await qi.addIndex('tickets', ['status', 'created_at']);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeIndex('tickets', ['status', 'created_at']);
  await qi.dropTable('agent_configs');
  await qi.dropTable('admin_sessions');
  await qi.dropTable('admin_users');
}
