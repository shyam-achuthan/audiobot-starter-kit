import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';

/** Embeddings through the LiteLLM gateway (OpenAI-compatible /v1/embeddings). */
@Injectable()
export class EmbeddingsService {
  private readonly log = new Logger(EmbeddingsService.name);

  private headers() {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${config.litellm.apiKey}`,
    };
  }

  async embed(model: string, dimension: number, inputs: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < inputs.length; i += 32) {
      const batch = inputs.slice(i, i + 32);
      const res = await fetch(`${config.litellm.url}/v1/embeddings`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model, input: batch, dimensions: dimension }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json()) as { data?: { embedding: number[]; index: number }[]; error?: { message?: string } };
      if (!res.ok || !data.data) {
        throw new Error(`Embedding failed (${model}): ${data.error?.message ?? res.status}`.slice(0, 400));
      }
      const vectors = [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.some((v) => v.length !== dimension)) {
        throw new Error(`Model ${model} returned ${vectors[0]?.length} dimensions, expected ${dimension}`);
      }
      out.push(...vectors);
    }
    return out;
  }

  /** Every model alias configured in infra/litellm/config.yaml. Throws if LiteLLM is unreachable. */
  async allModels(): Promise<string[]> {
    const res = await fetch(`${config.litellm.url}/v1/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id);
  }

  /** Embedding aliases (names starting with "embed-"). */
  async models(): Promise<string[]> {
    try {
      return (await this.allModels()).filter((id) => id.startsWith('embed-')).sort();
    } catch (e) {
      this.log.warn(`Could not list LiteLLM models: ${(e as Error).message}`);
      return ['embed-gemini'];
    }
  }
}
