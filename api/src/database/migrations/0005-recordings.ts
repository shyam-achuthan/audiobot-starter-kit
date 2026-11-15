import { DataTypes, QueryInterface } from 'sequelize';

export async function up({ context: qi }: { context: QueryInterface }) {
  // Call recording (LiveKit Egress -> RustFS). recording_status:
  //   none | recording | processing | ready | declined | failed | unavailable | deleted | expired
  await qi.addColumn('calls', 'recording_status', { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'none' });
  // Consent mode the answering agent used: off | notice | ask.
  await qi.addColumn('calls', 'recording_consent', { type: DataTypes.STRING(8) });
  await qi.addColumn('calls', 'egress_id', { type: DataTypes.TEXT });
  await qi.addColumn('calls', 'recording_key', { type: DataTypes.TEXT });
  await qi.addColumn('calls', 'recording_started_at', { type: DataTypes.DATE });
  await qi.addColumn('calls', 'recording_duration_ms', { type: DataTypes.INTEGER });
  await qi.addColumn('calls', 'recording_bytes', { type: DataTypes.BIGINT });
  await qi.addColumn('calls', 'recording_error', { type: DataTypes.TEXT });
  // Set when the retention job removes the transcript text.
  await qi.addColumn('calls', 'transcript_purged_at', { type: DataTypes.DATE });
  await qi.addIndex('calls', ['recording_status']);

  // Org-wide retention (null = keep forever).
  await qi.addColumn('business_profiles', 'recording_retention_days', { type: DataTypes.INTEGER });
  await qi.addColumn('business_profiles', 'transcript_retention_days', { type: DataTypes.INTEGER });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.removeColumn('business_profiles', 'transcript_retention_days');
  await qi.removeColumn('business_profiles', 'recording_retention_days');
  await qi.removeIndex('calls', ['recording_status']);
  for (const c of [
    'transcript_purged_at', 'recording_error', 'recording_bytes', 'recording_duration_ms',
    'recording_started_at', 'recording_key', 'egress_id', 'recording_consent', 'recording_status',
  ]) {
    await qi.removeColumn('calls', c);
  }
}
