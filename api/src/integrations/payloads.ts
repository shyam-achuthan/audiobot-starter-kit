import { config } from '../config';
import { Call, CallTurn, Lead, Ticket } from '../database/models';

/** Event payloads: plain snapshots plus a dashboard link. Internal sync ids (`external`) are left out. */

export function leadData(lead: Lead) {
  const { external: _x, ...rest } = lead.get({ plain: true }) as Record<string, unknown>;
  return { ...rest, dashboardUrl: `${config.publicWebUrl}/admin/leads/${lead.id}` };
}

export function ticketData(ticket: Ticket) {
  const { external: _x, ...rest } = ticket.toJSON() as Record<string, unknown>;
  return { ...rest, dashboardUrl: `${config.publicWebUrl}/admin/tickets/${ticket.ref}` };
}

export function callData(call: Call, turns?: CallTurn[]) {
  const plain = call.get({ plain: true }) as Record<string, unknown>;
  delete plain.turns; delete plain.leads; delete plain.tickets;
  const data: Record<string, unknown> = { ...plain, dashboardUrl: `${config.publicWebUrl}/admin/calls/${call.id}` };
  if (turns) {
    data.durationSec = call.endedAt ? Math.round((+call.endedAt - +call.startedAt) / 1000) : null;
    data.transcript = turns.flatMap((t) => [
      ...(t.userText ? [{ role: 'caller', text: t.userText, language: t.language }] : []),
      ...(t.agentText ? [{ role: 'agent', agent: t.agent, text: t.agentText }] : []),
    ]);
  }
  return data;
}
