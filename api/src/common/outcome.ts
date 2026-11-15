// Call outcomes in increasing order of significance. A later event only
// upgrades the outcome (a callback request beats a ticket, which beats a lead).
const RANK: Record<string, number> = {
  abandoned: 0,
  info_only: 1,
  lead_captured: 2,
  ticket_created: 3,
  callback_requested: 4,
  transferred: 5,
};

export function strongerOutcome(current: string | null | undefined, next: string): string {
  return (RANK[next] ?? 0) > (RANK[current ?? ''] ?? -1) ? next : (current as string);
}
