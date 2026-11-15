export type AgentFields = {
  role: string;
  greeting: string;
  llmModel: string;
  ttsSpeaker: string;
  ttsPace: number;
  endpointingMinDelay: number;
  endpointingMaxDelay: number;
  allowInterruptions: boolean;
  interruptionMinDuration: number;
};

export type AgentView = {
  workflow: string;
  defaults: Partial<AgentFields>;
  overrides: Partial<AgentFields>;
  effective: Partial<AgentFields>;
  updatedBy: string | null;
  updatedAt: string;
};

export type AgentOptions = {
  llmModels: string[];
  ttsModel: string | null;
  ttsSpeakers: { id: string; gender?: string }[];
  reportedAt: string | null;
};

export const AGENT_BLURBS: Record<string, string> = {
  router: 'Answers general calls and transfers to the right agent.',
  lead_qualification: 'Qualifies new business leads and books a specialist callback.',
  sales: 'Answers product and pricing questions and arranges callbacks.',
  support: 'Troubleshoots from the knowledge base and raises tickets.',
};
