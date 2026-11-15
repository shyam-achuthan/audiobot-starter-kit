function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: required('DATABASE_URL'),
  // Run pending DB migrations on startup (disable when migrating out-of-band).
  autoMigrate: (process.env.AUTO_MIGRATE ?? 'true') !== 'false',
  // Shared secret for the voice agent and server-side admin calls.
  agentApiToken: required('AGENT_API_TOKEN'),
  livekit: {
    // Server-to-server URL (inside the Docker network)
    url: required('LIVEKIT_URL'),
    // URL handed to browsers / widget
    publicUrl: required('LIVEKIT_PUBLIC_URL'),
    apiKey: required('LIVEKIT_API_KEY'),
    apiSecret: required('LIVEKIT_API_SECRET'),
  },
  litellm: {
    url: process.env.LITELLM_URL ?? 'http://litellm:4000',
    apiKey: process.env.LITELLM_API_KEY ?? '',
  },
};

export const WORKFLOWS = ['router', 'lead_qualification', 'sales', 'support'] as const;
export type Workflow = (typeof WORKFLOWS)[number];
