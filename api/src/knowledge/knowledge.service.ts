import {
  BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { KbDocument, KnowledgeBase } from '../database/models';
import { chunkText } from './chunk';
import { EmbeddingsService } from './embeddings';
import { MAX_FILE_BYTES, assertPublicUrl, extractFile, extractUrl, isSitemap, sitemapUrls } from './extract';
import { AddFaqDto, AddUrlDto, CreateKbDto, SearchDto, UpdateKbDto } from './knowledge.dto';

export interface SearchHit {
  content: string;
  score: number;
  documentId: string;
  title: string;
  type: string;
  source: string | null;
  kbId: string;
  kbName: string;
}

const DOC_LIST_ATTRS = [
  'id', 'kbId', 'type', 'title', 'source', 'mime', 'bytes', 'question', 'answer',
  'status', 'error', 'chunkCount', 'createdAt', 'updatedAt',
];

@Injectable()
export class KnowledgeService implements OnApplicationBootstrap {
  private readonly log = new Logger(KnowledgeService.name);
  // Documents are processed one at a time to stay within provider rate limits.
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @InjectModel(KnowledgeBase) private readonly kbs: typeof KnowledgeBase,
    @InjectModel(KbDocument) private readonly docs: typeof KbDocument,
    private readonly sequelize: Sequelize,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Resume documents that were mid-processing when the API stopped. */
  async onApplicationBootstrap() {
    const stuck = await this.docs.findAll({
      where: { status: { [Op.in]: ['pending', 'processing'] } },
      attributes: ['id'],
    }).catch(() => []);
    stuck.forEach((d) => this.enqueue(d.id));
    if (stuck.length) this.log.log(`Resuming ${stuck.length} document(s)`);
  }

  // ---------------------------------------------------------------- knowledge bases
  async list() {
    const kbs = await this.kbs.findAll({ order: [['createdAt', 'ASC']] });
    const stats = await this.sequelize.query<{ kb_id: string; status: string; n: string; chunks: string }>(
      'SELECT kb_id, status, count(*) AS n, sum(chunk_count) AS chunks FROM kb_documents GROUP BY kb_id, status',
      { type: QueryTypes.SELECT },
    );
    return kbs.map((kb) => {
      const rows = stats.filter((s) => s.kb_id === kb.id);
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
      return {
        ...kb.toJSON(),
        documentCount: rows.reduce((a, r) => a + Number(r.n), 0),
        chunkCount: rows.reduce((a, r) => a + Number(r.chunks ?? 0), 0),
        byStatus,
      };
    });
  }

  async get(id: string) {
    const kb = await this.kbs.findByPk(id);
    if (!kb) throw new NotFoundException('knowledge base not found');
    const documents = await this.docs.findAll({
      where: { kbId: id },
      attributes: DOC_LIST_ATTRS,
      order: [['createdAt', 'DESC']],
    });
    return { ...kb.toJSON(), documents };
  }

  async create(dto: CreateKbDto) {
    const model = dto.embeddingModel ?? 'embed-gemini';
    await this.assertModel(model);
    return this.kbs.create({
      name: dto.name.trim(),
      description: dto.description ?? null,
      embeddingModel: model,
      dimension: dto.dimension ?? 768,
      workflows: dto.workflows ?? ['router', 'lead_qualification', 'sales', 'support'],
    });
  }

  async update(id: string, dto: UpdateKbDto) {
    const kb = await this.kbs.findByPk(id);
    if (!kb) throw new NotFoundException('knowledge base not found');
    const modelChanged = !!dto.embeddingModel && dto.embeddingModel !== kb.embeddingModel;
    if (modelChanged) await this.assertModel(dto.embeddingModel!);
    await kb.update(dto);
    if (modelChanged) await this.reindex(id); // vectors from different models aren't comparable
    return kb;
  }

  async remove(id: string) {
    const n = await this.kbs.destroy({ where: { id } });
    if (!n) throw new NotFoundException('knowledge base not found');
    return { deleted: true };
  }

  private async assertModel(model: string) {
    const models = await this.embeddings.models();
    if (!models.includes(model)) {
      throw new BadRequestException(`Unknown embedding model "${model}". Available: ${models.join(', ')}`);
    }
  }

  private async kbOrThrow(id: string) {
    const kb = await this.kbs.findByPk(id);
    if (!kb) throw new NotFoundException('knowledge base not found');
    return kb;
  }

  // ---------------------------------------------------------------- documents
  async addFiles(kbId: string, files: Express.Multer.File[]) {
    await this.kbOrThrow(kbId);
    if (!files?.length) throw new BadRequestException('Choose at least one file');
    const results: { file: string; ok: boolean; id?: string; error?: string }[] = [];
    for (const f of files) {
      // multer gives latin1-decoded names; restore UTF-8 (e.g. Hindi filenames).
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      try {
        if (f.size > MAX_FILE_BYTES) throw new BadRequestException('File is larger than 15 MB');
        const { title, text } = await extractFile(name, f.buffer);
        const doc = await this.docs.create({
          kbId, type: 'file', title, source: name, mime: f.mimetype, bytes: f.size, content: text,
        });
        this.enqueue(doc.id);
        results.push({ file: name, ok: true, id: doc.id });
      } catch (e) {
        results.push({ file: name, ok: false, error: (e as Error).message });
      }
    }
    return results;
  }

  async addFaq(kbId: string, dto: AddFaqDto) {
    await this.kbOrThrow(kbId);
    const doc = await this.docs.create({
      kbId, type: 'faq', title: dto.question.trim(), question: dto.question.trim(), answer: dto.answer.trim(),
      content: `Q: ${dto.question.trim()}\nA: ${dto.answer.trim()}`,
    });
    this.enqueue(doc.id);
    return doc;
  }

  async addUrl(kbId: string, dto: AddUrlDto) {
    await this.kbOrThrow(kbId);
    const url = await assertPublicUrl(dto.url.trim());
    let pages = [url.toString()];
    if (isSitemap(url)) {
      pages = await sitemapUrls(url, dto.maxPages ?? 50);
      if (!pages.length) throw new BadRequestException('No page URLs found in that sitemap');
    }
    const existing = new Set(
      (await this.docs.findAll({ where: { kbId, type: 'url', source: { [Op.in]: pages } }, attributes: ['source'] }))
        .map((d) => d.source),
    );
    const created = [];
    for (const page of pages.filter((p) => !existing.has(p))) {
      const doc = await this.docs.create({ kbId, type: 'url', title: page, source: page });
      this.enqueue(doc.id);
      created.push(doc);
    }
    return { added: created.length, skippedExisting: pages.length - created.length, documents: created };
  }

  async removeDocument(kbId: string, docId: string) {
    const n = await this.docs.destroy({ where: { id: docId, kbId } });
    if (!n) throw new NotFoundException('document not found');
    return { deleted: true };
  }

  async retry(kbId: string, docId: string) {
    const doc = await this.docs.findOne({ where: { id: docId, kbId } });
    if (!doc) throw new NotFoundException('document not found');
    await doc.update({ status: 'pending', error: null });
    this.enqueue(doc.id);
    return doc;
  }

  async reindex(kbId: string) {
    await this.kbOrThrow(kbId);
    const docs = await this.docs.findAll({ where: { kbId }, attributes: ['id'] });
    await this.docs.update({ status: 'pending', error: null }, { where: { kbId } });
    docs.forEach((d) => this.enqueue(d.id));
    return { queued: docs.length };
  }

  // ---------------------------------------------------------------- processing
  private enqueue(docId: string) {
    this.queue = this.queue
      .then(() => this.process(docId))
      .catch((e) => this.log.error(`document ${docId}: ${(e as Error).message}`));
  }

  private async process(docId: string) {
    const doc = await this.docs.findByPk(docId);
    if (!doc) return; // deleted while queued
    const kb = await this.kbs.findByPk(doc.kbId);
    if (!kb) return;
    await doc.update({ status: 'processing', error: null });
    try {
      if (doc.type === 'url' && !doc.content) {
        const page = await extractUrl(doc.source!);
        await doc.update({ title: page.title, content: page.text, bytes: Buffer.byteLength(page.text) });
      }
      const chunks = doc.type === 'faq' ? [doc.content!] : chunkText(doc.content ?? '', doc.title);
      if (!chunks.length) throw new Error('No text to index');
      const vectors = await this.embeddings.embed(kb.embeddingModel, kb.dimension, chunks);

      await this.sequelize.transaction(async (t) => {
        await this.sequelize.query('DELETE FROM kb_chunks WHERE document_id = :docId', {
          replacements: { docId }, transaction: t,
        });
        for (let i = 0; i < chunks.length; i++) {
          await this.sequelize.query(
            `INSERT INTO kb_chunks (kb_id, document_id, idx, content, dimension, embedding)
             VALUES (:kbId, :docId, :idx, :content, :dim, :vec::vector)`,
            {
              replacements: {
                kbId: kb.id, docId, idx: i, content: chunks[i], dim: kb.dimension,
                vec: `[${vectors[i].join(',')}]`,
              },
              transaction: t,
            },
          );
        }
      });
      await doc.update({ status: 'ready', chunkCount: chunks.length });
      this.log.log(`Indexed "${doc.title}" (${chunks.length} chunks)`);
    } catch (e) {
      await doc.update({ status: 'error', error: (e as Error).message.slice(0, 500), chunkCount: 0 });
      this.log.warn(`Failed "${doc.title}": ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- search
  async search(dto: SearchDto): Promise<{ query: string; results: SearchHit[] }> {
    const where: Record<string, unknown> = {};
    if (dto.kbIds?.length) where.id = { [Op.in]: dto.kbIds };
    let kbs = await this.kbs.findAll({ where });
    if (dto.workflow) kbs = kbs.filter((k) => k.workflows.includes(dto.workflow!));
    if (!kbs.length) return { query: dto.query, results: [] };

    const topK = dto.topK ?? 4;
    // Knowledge bases sharing a model + size are searched with one query embedding.
    const groups = new Map<string, KnowledgeBase[]>();
    for (const kb of kbs) {
      const key = `${kb.embeddingModel}|${kb.dimension}`;
      groups.set(key, [...(groups.get(key) ?? []), kb]);
    }

    const hits: SearchHit[] = [];
    for (const [, group] of groups) {
      const { embeddingModel, dimension } = group[0];
      const [vec] = await this.embeddings.embed(embeddingModel, dimension, [dto.query]);
      const dim = Number(dimension); // integer from our own DB, safe to inline (needed for the index cast)
      const rows = await this.sequelize.query<{
        content: string; score: number; document_id: string; title: string; type: string;
        source: string | null; kb_id: string;
      }>(
        `SELECT c.content, c.document_id, c.kb_id, d.title, d.type, d.source,
                1 - (c.embedding::vector(${dim}) <=> :vec::vector(${dim})) AS score
           FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
          WHERE c.kb_id IN (:kbIds) AND c.dimension = ${dim}
          ORDER BY c.embedding::vector(${dim}) <=> :vec::vector(${dim})
          LIMIT :k`,
        {
          replacements: { vec: `[${vec.join(',')}]`, kbIds: group.map((k) => k.id), k: topK },
          type: QueryTypes.SELECT,
        },
      );
      const names = new Map(group.map((k) => [k.id, k.name]));
      hits.push(...rows.map((r) => ({
        content: r.content, score: Number(Number(r.score).toFixed(4)), documentId: r.document_id,
        title: r.title, type: r.type, source: r.source, kbId: r.kb_id, kbName: names.get(r.kb_id) ?? '',
      })));
    }
    hits.sort((a, b) => b.score - a.score);
    return { query: dto.query, results: hits.slice(0, topK) };
  }

  models() {
    return this.embeddings.models();
  }
}
