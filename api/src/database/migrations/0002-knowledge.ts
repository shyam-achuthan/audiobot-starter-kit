import { DataTypes, QueryInterface, Sequelize } from 'sequelize';

const now = Sequelize.literal('now()');
const uuid = Sequelize.literal('gen_random_uuid()');
const timestamps = () => ({
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
});

export async function up({ context: qi }: { context: QueryInterface }) {
  // Single-row business profile, edited on the admin Setup page and read by agents.
  await qi.createTable('business_profiles', {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    company_name: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'AudioBots Demo' },
    description: { type: DataTypes.TEXT },
    industry: { type: DataTypes.TEXT },
    website: { type: DataTypes.TEXT },
    support_hours: { type: DataTypes.TEXT },
    callback_hours: { type: DataTypes.TEXT },
    extra_instructions: { type: DataTypes.TEXT },
    setup_completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ...timestamps(),
  });
  await qi.sequelize.query('ALTER TABLE business_profiles ADD CONSTRAINT business_profiles_single_row CHECK (id = 1)');
  await qi.sequelize.query('INSERT INTO business_profiles (id) VALUES (1)');

  await qi.createTable('knowledge_bases', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    name: { type: DataTypes.TEXT, allowNull: false },
    description: { type: DataTypes.TEXT },
    embedding_model: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'embed-gemini' },
    dimension: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 768 },
    // Which agents may search this knowledge base.
    workflows: {
      type: DataTypes.JSONB, allowNull: false,
      defaultValue: ['router', 'lead_qualification', 'sales', 'support'],
    },
    ...timestamps(),
  });

  await qi.createTable('kb_documents', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: uuid },
    kb_id: {
      type: DataTypes.UUID, allowNull: false,
      references: { model: 'knowledge_bases', key: 'id' }, onDelete: 'CASCADE',
    },
    type: { type: DataTypes.STRING(8), allowNull: false }, // file | faq | url
    title: { type: DataTypes.TEXT, allowNull: false },
    source: { type: DataTypes.TEXT }, // filename or URL
    mime: { type: DataTypes.TEXT },
    bytes: { type: DataTypes.INTEGER },
    question: { type: DataTypes.TEXT },
    answer: { type: DataTypes.TEXT },
    content: { type: DataTypes.TEXT }, // extracted plain text (kept for re-indexing)
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    error: { type: DataTypes.TEXT },
    chunk_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    ...timestamps(),
  });
  await qi.addIndex('kb_documents', ['kb_id', 'created_at']);

  // Embeddings live in an unconstrained `vector` column with a `dimension` tag, so
  // knowledge bases can use different models. Partial HNSW indexes cover common sizes.
  await qi.sequelize.query(`
    CREATE TABLE kb_chunks (
      id          BIGSERIAL PRIMARY KEY,
      kb_id       UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
      idx         INTEGER NOT NULL,
      content     TEXT NOT NULL,
      dimension   INTEGER NOT NULL,
      embedding   vector NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await qi.sequelize.query('CREATE INDEX kb_chunks_kb_id ON kb_chunks (kb_id)');
  await qi.sequelize.query('CREATE INDEX kb_chunks_document_id ON kb_chunks (document_id)');
  for (const d of [768, 1024, 1536]) {
    await qi.sequelize.query(
      `CREATE INDEX kb_chunks_hnsw_${d} ON kb_chunks USING hnsw ((embedding::vector(${d})) vector_cosine_ops) WHERE dimension = ${d}`,
    );
  }
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.sequelize.query('DROP TABLE IF EXISTS kb_chunks');
  await qi.dropTable('kb_documents');
  await qi.dropTable('knowledge_bases');
  await qi.dropTable('business_profiles');
}
