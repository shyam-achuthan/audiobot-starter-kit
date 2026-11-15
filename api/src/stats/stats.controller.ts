import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ApiAuthGuard } from '../auth/auth.guard';
import { config } from '../config';

type Row = Record<string, string | number | null>;

const num = (v: unknown) => (v == null ? null : Math.round(Number(v)));

/** Dashboard overview: volumes, outcomes and latency percentiles over the last N days. */
@Controller('v1/stats')
@UseGuards(ApiAuthGuard)
export class StatsController {
  constructor(@InjectConnection() private readonly db: Sequelize) {}

  private q(sql: string, replacements: Record<string, unknown>) {
    return this.db.query<Row>(sql, { replacements, type: QueryTypes.SELECT });
  }

  @Get()
  async overview(@Query('days', new DefaultValuePipe(14), ParseIntPipe) daysRaw: number) {
    const days = Math.min(Math.max(daysRaw, 1), 90);
    const tz = config.dashboardTimezone;
    // Window starts at local midnight (days - 1) days ago, so "today" is always a full bucket.
    const r = { days, tz };
    const since = `(date_trunc('day', now() AT TIME ZONE :tz) - make_interval(days => :days - 1)) AT TIME ZONE :tz`;

    const [totals] = await this.q(`
      SELECT
        (SELECT count(*) FROM calls WHERE started_at >= ${since}) AS calls,
        (SELECT count(*) FROM calls WHERE status = 'active') AS active_calls,
        (SELECT avg(extract(epoch FROM ended_at - started_at)) FROM calls
           WHERE started_at >= ${since} AND ended_at IS NOT NULL) AS avg_duration_s,
        (SELECT count(*) FROM leads WHERE created_at >= ${since}) AS leads,
        (SELECT count(*) FROM leads WHERE created_at >= ${since} AND score >= 70) AS hot_leads,
        (SELECT count(*) FROM tickets WHERE created_at >= ${since}) AS tickets,
        (SELECT count(*) FROM tickets WHERE status IN ('open', 'in_progress')) AS open_tickets,
        (SELECT count(*) FROM tickets WHERE type = 'callback' AND status IN ('open', 'in_progress')) AS pending_callbacks
    `, r);

    const [latency] = await this.q(`
      SELECT
        count(*) AS turns,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY e2e_ms) AS e2e_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY e2e_ms) AS e2e_p95,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY eot_ms) AS eot_p50,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY stt_ms) AS stt_p50,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY llm_ttft_ms) AS llm_p50,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY tts_ttfb_ms) AS tts_p50
      FROM call_turns WHERE created_at >= ${since}
    `, r);

    const daily = await this.q(`
      WITH d AS (
        SELECT generate_series(
          date_trunc('day', now() AT TIME ZONE :tz) - make_interval(days => :days - 1),
          date_trunc('day', now() AT TIME ZONE :tz), interval '1 day')::date AS day
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM calls c WHERE (c.started_at AT TIME ZONE :tz)::date = d.day) AS calls,
        (SELECT count(*) FROM leads l WHERE (l.created_at AT TIME ZONE :tz)::date = d.day) AS leads,
        (SELECT count(*) FROM tickets t WHERE (t.created_at AT TIME ZONE :tz)::date = d.day) AS tickets,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY e2e_ms) FROM call_turns ct
           WHERE (ct.created_at AT TIME ZONE :tz)::date = d.day) AS e2e_p50,
        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY e2e_ms) FROM call_turns ct
           WHERE (ct.created_at AT TIME ZONE :tz)::date = d.day) AS e2e_p95
      FROM d ORDER BY d.day
    `, r);

    const outcomes = await this.q(`
      SELECT coalesce(outcome, CASE WHEN status = 'active' THEN 'in_progress' ELSE 'unknown' END) AS key, count(*) AS n
      FROM calls WHERE started_at >= ${since} GROUP BY 1 ORDER BY 2 DESC
    `, r);
    const workflows = await this.q(`
      SELECT start_workflow AS key, count(*) AS n FROM calls WHERE started_at >= ${since} GROUP BY 1 ORDER BY 2 DESC
    `, r);
    const languages = await this.q(`
      SELECT coalesce(language, 'unknown') AS key, count(*) AS n FROM calls WHERE started_at >= ${since} GROUP BY 1 ORDER BY 2 DESC
    `, r);

    const counts = (rows: Row[]) => rows.map((x) => ({ key: String(x.key), count: Number(x.n) }));
    return {
      days,
      timezone: tz,
      totals: {
        calls: Number(totals.calls),
        activeCalls: Number(totals.active_calls),
        avgDurationS: num(totals.avg_duration_s),
        leads: Number(totals.leads),
        hotLeads: Number(totals.hot_leads),
        tickets: Number(totals.tickets),
        openTickets: Number(totals.open_tickets),
        pendingCallbacks: Number(totals.pending_callbacks),
      },
      latency: {
        turns: Number(latency.turns),
        e2eP50: num(latency.e2e_p50),
        e2eP95: num(latency.e2e_p95),
        stages: { endOfTurn: num(latency.eot_p50), stt: num(latency.stt_p50), llm: num(latency.llm_p50), tts: num(latency.tts_p50) },
      },
      daily: daily.map((d) => ({
        day: String(d.day), calls: Number(d.calls), leads: Number(d.leads), tickets: Number(d.tickets),
        e2eP50: num(d.e2e_p50), e2eP95: num(d.e2e_p95),
      })),
      outcomes: counts(outcomes),
      workflows: counts(workflows),
      languages: counts(languages),
    };
  }
}
