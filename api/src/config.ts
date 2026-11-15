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
  // Day boundaries for dashboard charts.
  dashboardTimezone: process.env.DASHBOARD_TIMEZONE ?? 'Asia/Kolkata',
  admin: {
    // Optional: creates the first owner account on startup when no accounts exist yet.
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    sessionHours: Number(process.env.ADMIN_SESSION_HOURS ?? 168),
  },
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  twenty: {
    url: (process.env.TWENTY_URL ?? 'http://twenty-server:3000').replace(/\/$/, ''),
    publicUrl: (process.env.TWENTY_PUBLIC_URL ?? 'http://localhost:3020').replace(/\/$/, ''),
    apiKey: process.env.TWENTY_API_KEY ?? '',
  },
  chatwoot: {
    url: (process.env.CHATWOOT_URL ?? 'http://chatwoot-web:3000').replace(/\/$/, ''),
    publicUrl: (process.env.CHATWOOT_PUBLIC_URL ?? 'http://localhost:3030').replace(/\/$/, ''),
    apiToken: process.env.CHATWOOT_API_TOKEN ?? '',
    accountId: process.env.CHATWOOT_ACCOUNT_ID ?? '',
    inboxId: process.env.CHATWOOT_INBOX_ID ?? '',
    webhookToken: process.env.CHATWOOT_WEBHOOK_TOKEN ?? '',
  },
  litellm: {
    url: process.env.LITELLM_URL ?? 'http://litellm:4000',
    apiKey: process.env.LITELLM_API_KEY ?? '',
  },
  // Call recordings (Phase 6): LiveKit Egress uploads to this bucket; the API streams them back.
  recordings: {
    // RECORDING=false turns recording off everywhere, whatever the agents' consent setting.
    enabled: (process.env.RECORDING ?? 'true') !== 'false',
    s3Endpoint: process.env.S3_ENDPOINT ?? 'http://rustfs:9000',
    bucket: process.env.S3_BUCKET_RECORDINGS ?? 'recordings',
    accessKey: process.env.S3_ACCESS_KEY ?? '',
    secretKey: process.env.S3_SECRET_KEY ?? '',
  },
  // Phone calls (Phase 7) through the LiveKit SIP bridge (sip profile).
  sip: {
    // Health endpoint of the SIP bridge; used to show whether phone calls can work right now.
    healthUrl: process.env.SIP_HEALTH_URL ?? 'http://sip:8080',
    // Address trunks and softphones send calls to (shown on Admin -> Phone).
    publicHost: process.env.SIP_PUBLIC_HOST ?? '',
    // Inbound: who may send calls in. With a username/password set, the trunk provider must
    // authenticate; otherwise calls are accepted from these networks (CIDRs).
    inboundUsername: process.env.SIP_INBOUND_USERNAME ?? '',
    inboundPassword: process.env.SIP_INBOUND_PASSWORD ?? '',
    inboundAllowed: (process.env.SIP_INBOUND_ALLOWED ?? '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16')
      .split(',').map((x) => x.trim()).filter(Boolean),
    // Outbound trunk (your SIP provider). Empty address = outbound calling off.
    outboundAddress: process.env.SIP_OUTBOUND_ADDRESS ?? '',
    outboundNumber: process.env.SIP_OUTBOUND_NUMBER ?? '', // caller ID, E.164
    outboundUsername: process.env.SIP_OUTBOUND_USERNAME ?? '',
    outboundPassword: process.env.SIP_OUTBOUND_PASSWORD ?? '',
    outboundTransport: (process.env.SIP_OUTBOUND_TRANSPORT ?? 'udp').toLowerCase(),
    maxCallbackAttempts: Number(process.env.CALLBACK_MAX_ATTEMPTS ?? 3),
    callbackRetryMinutes: Number(process.env.CALLBACK_RETRY_MINUTES ?? 30),
  },
  // Langfuse (Phase 6): only used to build "open trace" links on the call page.
  langfuse: {
    publicUrl: (process.env.LANGFUSE_PUBLIC_URL ?? '').replace(/\/$/, ''),
    projectId: process.env.LANGFUSE_PROJECT_ID ?? 'audiobots-calls',
  },
};

export const WORKFLOWS = ['router', 'lead_qualification', 'sales', 'support'] as const;
export type Workflow = (typeof WORKFLOWS)[number];
