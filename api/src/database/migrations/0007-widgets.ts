import { DataTypes, QueryInterface, Sequelize } from 'sequelize';

const now = Sequelize.literal('now()');
const uuid = Sequelize.literal('gen_random_uuid()');

export async function up({ context: qi }: { context: QueryInterface }) {
  // Website widgets: each has a public key, the sites allowed to embed it and its look.
  await qi.createTable('widgets', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    name: { type: DataTypes.TEXT, allowNull: false },
    public_key: { type: DataTypes.TEXT, allowNull: false, unique: true }, // "wk_..." (public, in the snippet)
    allowed_origins: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    workflow: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'router' },
    // Look and behaviour: { title, buttonLabel, color, position, captions }
    appearance: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    max_concurrent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
    max_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 15 },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  });
  await qi.addColumn('calls', 'widget_id', {
    type: DataTypes.UUID, references: { model: 'widgets', key: 'id' }, onDelete: 'SET NULL',
  });
  await qi.addIndex('calls', ['widget_id', 'status']);
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeIndex('calls', ['widget_id', 'status']);
  await qi.removeColumn('calls', 'widget_id');
  await qi.dropTable('widgets');
}
