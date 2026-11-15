import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WORKFLOWS } from '../config';
import { AgentConfig } from '../database/models';
import { EmbeddingsService } from '../knowledge/embeddings';
import { AgentOverridesDto, OVERRIDE_KEYS, ReportDefaultsDto } from './agents.dto';

const META = '_meta'; // row holding what the agent worker reported (voices, TTS model)

export type AgentView = {
  workflow: string;
  defaults: Record<string, unknown>;
  overrides: Record<string, unknown>;
  effective: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: Date;
};

@Injectable()
export class AgentsService {
  constructor(
    @InjectModel(AgentConfig) private readonly configs: typeof AgentConfig,
    private readonly litellm: EmbeddingsService,
  ) {}

  private view(row: AgentConfig): AgentView {
    const overrides = Object.fromEntries(
      Object.entries(row.overrides ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    );
    return {
      workflow: row.workflow,
      defaults: row.defaults ?? {},
      overrides,
      effective: { ...(row.defaults ?? {}), ...overrides },
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  async list(): Promise<AgentView[]> {
    const rows = await this.configs.findAll();
    const byWf = new Map(rows.map((r) => [r.workflow, r]));
    return WORKFLOWS.filter((w) => byWf.has(w)).map((w) => this.view(byWf.get(w)!));
  }

  async get(workflow: string): Promise<AgentView> {
    if (!(WORKFLOWS as readonly string[]).includes(workflow)) throw new NotFoundException('unknown agent');
    const [row] = await this.configs.findOrCreate({ where: { workflow }, defaults: { workflow } });
    return this.view(row);
  }

  async options() {
    const meta = await this.configs.findByPk(META);
    let llmModels: string[] = [];
    try {
      llmModels = (await this.litellm.allModels()).filter((m) => m.startsWith('agent-') && !m.endsWith('-fallback')).sort();
    } catch {
      /* LiteLLM down: the UI still shows the current value */
    }
    return {
      llmModels,
      ttsModel: (meta?.defaults?.ttsModel as string | undefined) ?? null,
      ttsSpeakers: (meta?.defaults?.ttsSpeakers as { id: string; gender?: string }[] | undefined) ?? [],
      reportedAt: meta?.updatedAt ?? null,
    };
  }

  async update(workflow: string, dto: AgentOverridesDto, actor: string): Promise<AgentView> {
    const current = await this.get(workflow);
    const row = (await this.configs.findByPk(workflow))!;
    const next: Record<string, unknown> = { ...current.overrides };
    for (const key of OVERRIDE_KEYS) {
      let v = dto[key] as unknown;
      if (v === undefined) continue; // not sent (DTO class fields exist even when absent)
      if (typeof v === 'string') v = v.trim();
      if (v === null || v === '') delete next[key];
      else next[key] = v;
    }

    const eff = { ...current.defaults, ...next };
    if (typeof eff.endpointingMinDelay === 'number' && typeof eff.endpointingMaxDelay === 'number'
        && eff.endpointingMaxDelay < eff.endpointingMinDelay) {
      throw new BadRequestException('maximum end-of-turn delay must be at least the minimum');
    }
    const opts = await this.options();
    if (next.llmModel && opts.llmModels.length && !opts.llmModels.includes(next.llmModel as string)) {
      throw new BadRequestException(`unknown LLM model ${next.llmModel}; choose one of ${opts.llmModels.join(', ')}`);
    }
    if (next.ttsSpeaker && opts.ttsSpeakers.length && !opts.ttsSpeakers.some((s) => s.id === next.ttsSpeaker)) {
      throw new BadRequestException(`unknown voice ${next.ttsSpeaker}`);
    }
    await row.update({ overrides: next, updatedBy: actor });
    return this.view(row);
  }

  async reset(workflow: string, actor: string) {
    await this.get(workflow);
    const row = (await this.configs.findByPk(workflow))!;
    await row.update({ overrides: {}, updatedBy: actor });
    return this.view(row);
  }

  async reportDefaults(dto: ReportDefaultsDto) {
    for (const wf of WORKFLOWS) {
      const d = dto.agents[wf];
      if (!d) continue;
      await this.configs.upsert({ workflow: wf, defaults: d });
    }
    await this.configs.upsert({
      workflow: META,
      defaults: { ttsSpeakers: dto.ttsSpeakers ?? [], ttsModel: dto.ttsModel ?? null },
    });
    return { ok: true };
  }
}
