import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

export const CALL_STATUSES = ['active', 'ended'] as const;
export const CALL_OUTCOMES = [
  'lead_captured', 'ticket_created', 'callback_requested', 'info_only', 'abandoned',
] as const;
export const LEAD_STATUSES = ['new', 'qualified', 'unqualified', 'callback'] as const;
export const TICKET_TYPES = ['support', 'callback'] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

@Table({ tableName: 'calls', underscored: true })
export class Call extends Model {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Column({ type: DataType.TEXT, allowNull: false, unique: true }) declare room: string;
  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'web' }) declare channel: string;
  @Column({ type: DataType.STRING(32), allowNull: false }) declare startWorkflow: string;
  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] }) declare agentPath: string[];
  @Column(DataType.STRING(8)) declare language: string | null;
  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'active' }) declare status: string;
  @Column(DataType.STRING(32)) declare outcome: string | null;
  @Column(DataType.TEXT) declare callerName: string | null;
  @Column(DataType.TEXT) declare callerPhone: string | null;
  @Column(DataType.TEXT) declare callerEmail: string | null;
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 }) declare turnCount: number;
  @Column(DataType.INTEGER) declare medianE2eMs: number | null;
  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW }) declare startedAt: Date;
  @Column(DataType.DATE) declare endedAt: Date | null;
  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} }) declare metadata: Record<string, unknown>;
  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;

  @HasMany(() => CallTurn) declare turns?: CallTurn[];
  @HasMany(() => Lead) declare leads?: Lead[];
  @HasMany(() => Ticket) declare tickets?: Ticket[];
}

@Table({ tableName: 'call_turns', underscored: true, updatedAt: false })
export class CallTurn extends Model {
  @Column({ type: DataType.BIGINT, primaryKey: true, autoIncrement: true }) declare id: number;
  @ForeignKey(() => Call) @Column({ type: DataType.UUID, allowNull: false }) declare callId: string;
  @BelongsTo(() => Call) declare call?: Call;
  @Column({ type: DataType.INTEGER, allowNull: false }) declare turnNo: number;
  @Column(DataType.STRING(32)) declare agent: string | null;
  @Column(DataType.STRING(8)) declare language: string | null;
  @Column(DataType.TEXT) declare userText: string | null;
  @Column(DataType.TEXT) declare agentText: string | null;
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false }) declare interrupted: boolean;
  @Column(DataType.INTEGER) declare eotMs: number | null;
  @Column(DataType.INTEGER) declare sttMs: number | null;
  @Column(DataType.INTEGER) declare llmTtftMs: number | null;
  @Column(DataType.INTEGER) declare ttsTtfbMs: number | null;
  @Column(DataType.INTEGER) declare e2eMs: number | null;
  @CreatedAt declare createdAt: Date;
}

@Table({ tableName: 'leads', underscored: true })
export class Lead extends Model {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 }) declare id: string;
  @ForeignKey(() => Call) @Column(DataType.UUID) declare callId: string | null;
  @BelongsTo(() => Call) declare call?: Call;
  @Column(DataType.TEXT) declare name: string | null;
  @Column(DataType.TEXT) declare phone: string | null;
  @Column(DataType.TEXT) declare email: string | null;
  @Column(DataType.TEXT) declare company: string | null;
  @Column(DataType.TEXT) declare need: string | null;
  @Column(DataType.TEXT) declare budget: string | null;
  @Column(DataType.TEXT) declare authority: string | null;
  @Column(DataType.TEXT) declare timeline: string | null;
  @Column(DataType.TEXT) declare teamSize: string | null;
  @Column(DataType.INTEGER) declare score: number | null;
  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'new' }) declare status: string;
  @Column(DataType.TEXT) declare preferredCallbackTime: string | null;
  @Column(DataType.STRING(8)) declare language: string | null;
  @Column(DataType.TEXT) declare notes: string | null;
  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}

@Table({ tableName: 'tickets', underscored: true })
export class Ticket extends Model {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 }) declare id: string;
  // Assigned by the DB sequence (starts at 1001); never set from code.
  @Column({ type: DataType.INTEGER, autoIncrement: true, unique: true }) declare number: number;
  @ForeignKey(() => Call) @Column(DataType.UUID) declare callId: string | null;
  @BelongsTo(() => Call) declare call?: Call;
  @ForeignKey(() => Lead) @Column(DataType.UUID) declare leadId: string | null;
  @BelongsTo(() => Lead) declare lead?: Lead;
  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'support' }) declare type: string;
  @Column({ type: DataType.TEXT, allowNull: false }) declare subject: string;
  @Column(DataType.TEXT) declare description: string | null;
  @Column({ type: DataType.STRING(8), allowNull: false, defaultValue: 'normal' }) declare priority: string;
  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'open' }) declare status: string;
  @Column(DataType.TEXT) declare contactName: string | null;
  @Column(DataType.TEXT) declare contactPhone: string | null;
  @Column(DataType.TEXT) declare contactEmail: string | null;
  @Column(DataType.TEXT) declare preferredCallbackTime: string | null;
  @Column(DataType.STRING(8)) declare language: string | null;
  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;

  /** Human-friendly reference ("TKT-1004"); virtual, so it's included in nested JSON too. */
  @Column({
    type: DataType.VIRTUAL,
    get(this: Ticket) {
      const n = this.getDataValue('number');
      return n == null ? null : `TKT-${n}`;
    },
  })
  declare ref: string;
}

export const KB_DOC_TYPES = ['file', 'faq', 'url'] as const;
export const KB_DOC_STATUSES = ['pending', 'processing', 'ready', 'error'] as const;

@Table({ tableName: 'business_profiles', underscored: true })
export class BusinessProfile extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, defaultValue: 1 }) declare id: number;
  @Column({ type: DataType.TEXT, allowNull: false }) declare companyName: string;
  @Column(DataType.TEXT) declare description: string | null;
  @Column(DataType.TEXT) declare industry: string | null;
  @Column(DataType.TEXT) declare website: string | null;
  @Column(DataType.TEXT) declare supportHours: string | null;
  @Column(DataType.TEXT) declare callbackHours: string | null;
  @Column(DataType.TEXT) declare extraInstructions: string | null;
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false }) declare setupCompleted: boolean;
  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}

@Table({ tableName: 'knowledge_bases', underscored: true })
export class KnowledgeBase extends Model {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 }) declare id: string;
  @Column({ type: DataType.TEXT, allowNull: false }) declare name: string;
  @Column(DataType.TEXT) declare description: string | null;
  @Column({ type: DataType.STRING(64), allowNull: false, defaultValue: 'embed-gemini' }) declare embeddingModel: string;
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 768 }) declare dimension: number;
  @Column({ type: DataType.JSONB, allowNull: false }) declare workflows: string[];
  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
  @HasMany(() => KbDocument) declare documents?: KbDocument[];
}

@Table({ tableName: 'kb_documents', underscored: true })
export class KbDocument extends Model {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 }) declare id: string;
  @ForeignKey(() => KnowledgeBase) @Column({ type: DataType.UUID, allowNull: false }) declare kbId: string;
  @BelongsTo(() => KnowledgeBase) declare kb?: KnowledgeBase;
  @Column({ type: DataType.STRING(8), allowNull: false }) declare type: string;
  @Column({ type: DataType.TEXT, allowNull: false }) declare title: string;
  @Column(DataType.TEXT) declare source: string | null;
  @Column(DataType.TEXT) declare mime: string | null;
  @Column(DataType.INTEGER) declare bytes: number | null;
  @Column(DataType.TEXT) declare question: string | null;
  @Column(DataType.TEXT) declare answer: string | null;
  @Column(DataType.TEXT) declare content: string | null;
  @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'pending' }) declare status: string;
  @Column(DataType.TEXT) declare error: string | null;
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 }) declare chunkCount: number;
  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}

// kb_chunks (with the pgvector column) is accessed with raw SQL in KnowledgeService.

export const MODELS = [Call, CallTurn, Lead, Ticket, BusinessProfile, KnowledgeBase, KbDocument];
