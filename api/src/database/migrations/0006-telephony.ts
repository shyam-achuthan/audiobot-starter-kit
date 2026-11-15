import { DataTypes, QueryInterface, Sequelize } from 'sequelize';

const now = Sequelize.literal('now()');
const uuid = Sequelize.literal('gen_random_uuid()');

export async function up({ context: qi }: { context: QueryInterface }) {
  // Phone numbers (DIDs) that ring into AudioBots, and which agent answers each.
  await qi.createTable('phone_numbers', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    number: { type: DataTypes.TEXT, allowNull: false, unique: true }, // E.164
    label: { type: DataTypes.TEXT },
    workflow: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'router' },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });

  // Numbers that must never be called (own do-not-call list; NCPR scrubbing is done by the trunk provider).
  await qi.createTable('dnd_numbers', {
    number: { type: DataTypes.TEXT, primaryKey: true }, // E.164
    note: { type: DataTypes.TEXT },
    added_by: { type: DataTypes.TEXT },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });

  // Calls: direction and phone details.
  await qi.addColumn('calls', 'direction', { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'inbound' });
  await qi.addColumn('calls', 'remote_number', { type: DataTypes.TEXT }); // caller (inbound) or callee (outbound)
  await qi.addColumn('calls', 'local_number', { type: DataTypes.TEXT }); // our number
  // Outbound: dialing | answered | no_answer | busy | failed | blocked
  await qi.addColumn('calls', 'dial_status', { type: DataTypes.STRING(12) });
  await qi.addColumn('calls', 'dial_error', { type: DataTypes.TEXT });
  await qi.addColumn('calls', 'ticket_id', {
    type: DataTypes.UUID, references: { model: 'tickets', key: 'id' }, onDelete: 'SET NULL',
  });
  await qi.addIndex('calls', ['ticket_id']);

  // Callback tickets: when to call, and how often we tried.
  await qi.addColumn('tickets', 'callback_at', { type: DataTypes.DATE });
  await qi.addColumn('tickets', 'callback_attempts', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await qi.addColumn('tickets', 'last_callback_at', { type: DataTypes.DATE });
  await qi.addIndex('tickets', ['type', 'status', 'callback_at']);

  // Outbound calling rules (Admin -> Phone).
  await qi.addColumn('business_profiles', 'outbound_hours_start', { type: DataTypes.STRING(5), allowNull: false, defaultValue: '09:00' });
  await qi.addColumn('business_profiles', 'outbound_hours_end', { type: DataTypes.STRING(5), allowNull: false, defaultValue: '21:00' });
  await qi.addColumn('business_profiles', 'auto_callbacks', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  for (const c of ['auto_callbacks', 'outbound_hours_end', 'outbound_hours_start']) await qi.removeColumn('business_profiles', c);
  await qi.removeIndex('tickets', ['type', 'status', 'callback_at']);
  for (const c of ['last_callback_at', 'callback_attempts', 'callback_at']) await qi.removeColumn('tickets', c);
  await qi.removeIndex('calls', ['ticket_id']);
  for (const c of ['ticket_id', 'dial_error', 'dial_status', 'local_number', 'remote_number', 'direction']) await qi.removeColumn('calls', c);
  await qi.dropTable('dnd_numbers');
  await qi.dropTable('phone_numbers');
}
