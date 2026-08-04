/**
 * MERCY v1 — the hospital-ship health system for the Port Daddy network.
 *
 * A hospital ship does three things: it takes the vitals of the fleet, it
 * writes them down, and it signals for help when something is bleeding. This
 * module is exactly that, on a Cron Trigger:
 *
 *   PROBES (every cron fire, see index.ts scheduled()):
 *     d1             — read-after-write latency against the mercy_probe row
 *     kv             — put/get echo latency against the KV namespace
 *     do_channel     — echo round-trip through a HarborChannel Durable Object
 *     queue          — FLEET_RUNS producer binding presence (Cloudflare exposes
 *                      no queue-depth API — the depth signal is HONESTLY null)
 *     fleet_executor — age of the newest fleet_runs write (event-driven, so an
 *                      old write is idle-vs-dead AMBIGUOUS — never red on age)
 *     error_rate     — share of conclusion='failure' fleet runs in 24h (which
 *                      includes legitimate BLOCK verdicts — never red alone)
 *
 *   SNAPSHOTS: every sweep inserts one mercy_health row (status per subsystem
 *   + overall verdict + remoteHarborsPossible). GET /mercy serves the newest
 *   snapshot as a public, no-secrets status page; GET /account/mercy renders
 *   the logged-in report card.
 *
 *   PAGING: a subsystem's green/yellow→red transition opens a mercy_incidents
 *   row and POSTs ONE page to MERCY_PAGE_WEBHOOK (optional secret — a
 *   PagerDuty/Grafana-OnCall/Cloudflare-Notifications bridge; see
 *   docs/mercy-oncall.md). The open-incident row IS the dedupe: while an
 *   incident stays unresolved, no second page is sent (a failed POST retries
 *   next sweep until one delivery succeeds, then paged_at pins it). When the
 *   subsystem leaves red, the incident is resolved and the next red pages anew.
 *
 * Verdict law: overall = worst subsystem. remoteHarborsPossible = "a remote
 * daemon could hold a live channel through this relay right now" = the relay is
 * executing (self-evident when probing) AND D1 is not red (handshake/session
 * writes) AND the DO channel echo is not red (SSE fan-out).
 */

import type { Env } from './types.js';
import { lastFleetRunAt } from './db.js';
import { randomHex } from './crypto.js';
import { resolveSession } from './auth-github.js';
import { HEAD, TOKENS } from './account-page.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MercyStatus = 'green' | 'yellow' | 'red';

export interface SubsystemProbe {
  name: string;
  status: MercyStatus;
  /** Probe round-trip in ms, or null where latency is not the signal. */
  latencyMs: number | null;
  /** Operator-facing explanation. Shown on /account/mercy, NOT on public /mercy. */
  detail: string;
}

export interface MercyVerdict {
  overall: MercyStatus;
  remoteHarborsPossible: boolean;
}

export interface MercySweepResult extends MercyVerdict {
  at: number;
  subsystems: SubsystemProbe[];
  incidentsOpened: number;
  incidentsResolved: number;
  pagesSent: number;
  errors: string[];
}

export interface MercyIncidentRow {
  id: string;
  subsystem: string;
  opened_at: number;
  resolved_at: number | null;
  paged_at: number | null;
  detail: string | null;
}

// ── Tuning ────────────────────────────────────────────────────────────────────

const LATENCY_GREEN_MS = 250;
const LATENCY_YELLOW_MS = 1500;
const FLEET_FRESH_SECONDS = 24 * 60 * 60;
const ERROR_RATE_WINDOW_SECONDS = 24 * 60 * 60;
const ERROR_RATE_MIN_SAMPLES = 5;
const ERROR_RATE_YELLOW = 0.5;
const SNAPSHOT_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const INCIDENT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
/** A snapshot older than this is stale — the cron itself may be the casualty. */
export const SNAPSHOT_STALE_SECONDS = 15 * 60;
const PAGE_TIMEOUT_MS = 5000;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function statusFromLatency(ms: number): MercyStatus {
  if (ms <= LATENCY_GREEN_MS) return 'green';
  if (ms <= LATENCY_YELLOW_MS) return 'yellow';
  return 'red';
}

// ── Verdict aggregation (pure — unit-tested directly) ─────────────────────────

const RANK: Record<MercyStatus, number> = { green: 0, yellow: 1, red: 2 };

export function aggregateVerdict(subsystems: SubsystemProbe[]): MercyVerdict {
  let overall: MercyStatus = 'green';
  for (const s of subsystems) {
    if (RANK[s.status] > RANK[overall]) overall = s.status;
  }
  const statusOf = (name: string): MercyStatus =>
    subsystems.find((s) => s.name === name)?.status ?? 'red';
  // Remote harbors need: relay executing (it is — it produced this snapshot),
  // D1 for handshake/session/chain writes, and the DO channel path for fan-out.
  const remoteHarborsPossible = statusOf('d1') !== 'red' && statusOf('do_channel') !== 'red';
  return { overall, remoteHarborsPossible };
}

// ── Probes ────────────────────────────────────────────────────────────────────

async function probeD1(env: Env, now: number): Promise<SubsystemProbe> {
  const name = 'd1';
  try {
    const t0 = Date.now();
    await env.DB.prepare('INSERT OR REPLACE INTO mercy_probe (k, v, at) VALUES (?, ?, ?)')
      .bind('d1-probe', String(now), now)
      .run();
    const writeMs = Date.now() - t0;
    const t1 = Date.now();
    const row = await env.DB.prepare('SELECT v FROM mercy_probe WHERE k = ?')
      .bind('d1-probe')
      .first<{ v: string }>();
    const readMs = Date.now() - t1;
    if (row?.v !== String(now)) {
      return { name, status: 'red', latencyMs: writeMs + readMs, detail: 'read-after-write returned a missing or stale row' };
    }
    const worst = Math.max(writeMs, readMs);
    return { name, status: statusFromLatency(worst), latencyMs: worst, detail: `write ${writeMs}ms / read ${readMs}ms` };
  } catch (e) {
    return { name, status: 'red', latencyMs: null, detail: `probe failed: ${msg(e)}` };
  }
}

async function probeKv(env: Env, now: number): Promise<SubsystemProbe> {
  const name = 'kv';
  try {
    const t0 = Date.now();
    await env.KV.put('mercy:probe', String(now));
    const echoed = await env.KV.get('mercy:probe');
    const ms = Date.now() - t0;
    // KV is eventually consistent across POPs but read-your-write within one —
    // a same-isolate echo miss means the namespace itself is unhealthy.
    if (echoed !== String(now)) {
      return { name, status: 'red', latencyMs: ms, detail: 'put/get echo returned a missing or stale value' };
    }
    return { name, status: statusFromLatency(ms), latencyMs: ms, detail: `put+get round-trip ${ms}ms` };
  } catch (e) {
    return { name, status: 'red', latencyMs: null, detail: `probe failed: ${msg(e)}` };
  }
}

async function probeDoChannel(env: Env): Promise<SubsystemProbe> {
  const name = 'do_channel';
  try {
    const t0 = Date.now();
    // Echo through a dedicated probe DO instance using the side-effect-free
    // rate-check action (huge limit ⇒ always allowed) — a full round trip
    // through the same Durable Object class that fans out SSE channels.
    const stub = env.HARBOR_CHANNEL.get(env.HARBOR_CHANNEL.idFromName('mercy:echo'));
    const res = await stub.fetch('https://harbor-channel/?action=rate-check&sender=mercy-probe&limit=1000000');
    const ms = Date.now() - t0;
    if (!res.ok) {
      return { name, status: 'red', latencyMs: ms, detail: `channel echo returned HTTP ${res.status}` };
    }
    const body = (await res.json()) as { allowed?: boolean };
    if (body.allowed !== true) {
      return { name, status: 'red', latencyMs: ms, detail: 'channel echo returned an unexpected body' };
    }
    return { name, status: statusFromLatency(ms), latencyMs: ms, detail: `channel echo round-trip ${ms}ms` };
  } catch (e) {
    return { name, status: 'red', latencyMs: null, detail: `probe failed: ${msg(e)}` };
  }
}

function probeQueue(env: Env): SubsystemProbe {
  const name = 'queue';
  if (!env.FLEET_RUNS) {
    return {
      name,
      status: 'yellow',
      latencyMs: null,
      detail: 'FLEET_RUNS producer binding absent — GitHub deliveries cannot be enqueued',
    };
  }
  // HONEST: Cloudflare Queues exposes no depth API from a Worker, so there is
  // no depth signal to measure — binding presence is the whole probe.
  return {
    name,
    status: 'green',
    latencyMs: null,
    detail: 'producer binding present; Cloudflare exposes no queue-depth API, so depth is unmeasured',
  };
}

async function probeFleetExecutor(env: Env, now: number): Promise<SubsystemProbe> {
  const name = 'fleet_executor';
  try {
    const lastAt = await lastFleetRunAt(env.DB);
    if (lastAt === null) {
      return {
        name,
        status: 'yellow',
        latencyMs: null,
        detail: 'no fleet_runs rows — executor liveness unproven (never ran, or all runs pruned)',
      };
    }
    const ageSec = Math.max(0, now - lastAt);
    if (ageSec <= FLEET_FRESH_SECONDS) {
      return { name, status: 'green', latencyMs: null, detail: `last fleet_runs write ${ageSec}s ago` };
    }
    // The fleet is event-driven (GitHub webhooks) — an old write is idle-vs-dead
    // ambiguous, so age alone is never red.
    return {
      name,
      status: 'yellow',
      latencyMs: null,
      detail: `last fleet_runs write ${Math.floor(ageSec / 3600)}h ago — event-driven, so age alone cannot distinguish idle from dead`,
    };
  } catch (e) {
    return { name, status: 'red', latencyMs: null, detail: `probe failed: ${msg(e)}` };
  }
}

async function probeErrorRate(env: Env, now: number): Promise<SubsystemProbe> {
  const name = 'error_rate';
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) AS failures
       FROM fleet_runs WHERE created_at >= ?`,
    )
      .bind(now - ERROR_RATE_WINDOW_SECONDS)
      .first<{ total: number; failures: number | null }>();
    const total = row?.total ?? 0;
    const failures = row?.failures ?? 0;
    if (total === 0) {
      return { name, status: 'green', latencyMs: null, detail: 'no fleet runs in the last 24h to sample' };
    }
    const rate = failures / total;
    const pct = Math.round(rate * 100);
    // HONEST: conclusion='failure' includes legitimate BLOCK verdicts (a ship
    // correctly failing a bad PR), so this can never be red on its own.
    if (total >= ERROR_RATE_MIN_SAMPLES && rate >= ERROR_RATE_YELLOW) {
      return {
        name,
        status: 'yellow',
        latencyMs: null,
        detail: `${failures}/${total} runs (${pct}%) concluded failure in 24h — includes legitimate BLOCK verdicts, inspect transcripts`,
      };
    }
    return { name, status: 'green', latencyMs: null, detail: `${failures}/${total} runs (${pct}%) concluded failure in 24h` };
  } catch (e) {
    return { name, status: 'red', latencyMs: null, detail: `probe failed: ${msg(e)}` };
  }
}

// ── Paging (red transition → one POST per unresolved incident) ────────────────

async function postPage(
  env: Env,
  page: { incidentId: string; subsystem: string; detail: string; at: number; overall: MercyStatus },
): Promise<boolean> {
  const url = env.MERCY_PAGE_WEBHOOK;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'port-daddy-relay/mercy',
        severity: 'red',
        incident_id: page.incidentId,
        subsystem: page.subsystem,
        detail: page.detail,
        overall: page.overall,
        at: page.at,
      }),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface IncidentCounters {
  opened: number;
  resolved: number;
  pages: number;
}

/**
 * Reconcile one subsystem against its (at most one, enforced by the partial
 * unique index) open incident row:
 *   red + no open row   → open incident (the INSERT's changes=1 is the race
 *                         winner) and page once.
 *   red + open, unpaged → retry the page (a failed webhook POST from an earlier
 *                         sweep) — paged_at is only set on a DELIVERED page, so
 *                         "never page twice" means "never DELIVER twice".
 *   red + open, paged   → do nothing (the dedupe).
 *   not red + open      → resolve the incident.
 */
async function reconcileIncident(
  env: Env,
  s: SubsystemProbe,
  overall: MercyStatus,
  now: number,
  counters: IncidentCounters,
  errors: string[],
): Promise<void> {
  try {
    const open = await env.DB.prepare(
      'SELECT id, paged_at FROM mercy_incidents WHERE subsystem = ? AND resolved_at IS NULL',
    )
      .bind(s.name)
      .first<{ id: string; paged_at: number | null }>();

    if (s.status === 'red') {
      let incidentId = open?.id ?? null;
      let shouldPage = false;
      if (!open) {
        incidentId = `mi_${randomHex(8)}`;
        const res = await env.DB.prepare(
          'INSERT OR IGNORE INTO mercy_incidents (id, subsystem, opened_at, detail) VALUES (?, ?, ?, ?)',
        )
          .bind(incidentId, s.name, now, s.detail)
          .run();
        // changes=0 ⇒ a concurrent sweep won the partial-unique-index race and
        // owns the paging duty; we stand down.
        if ((res.meta?.changes ?? 0) > 0) {
          counters.opened++;
          shouldPage = true;
        }
      } else if (open.paged_at === null) {
        shouldPage = true;
      }
      if (shouldPage && incidentId) {
        const delivered = await postPage(env, {
          incidentId,
          subsystem: s.name,
          detail: s.detail,
          at: now,
          overall,
        });
        if (delivered) {
          counters.pages++;
          await env.DB.prepare('UPDATE mercy_incidents SET paged_at = ? WHERE id = ?')
            .bind(now, incidentId)
            .run();
        }
      }
    } else if (open) {
      await env.DB.prepare('UPDATE mercy_incidents SET resolved_at = ? WHERE id = ?')
        .bind(now, open.id)
        .run();
      counters.resolved++;
    }
  } catch (e) {
    errors.push(`incident(${s.name}): ${msg(e)}`);
  }
}

// ── The sweep (cron entry point) ──────────────────────────────────────────────

/**
 * Run one MERCY sweep at injected `now` (unix seconds — never the system clock,
 * for testability; probe latencies still use Date.now() deltas). Never throws:
 * every step is best-effort and failures land in `errors`.
 */
export async function runMercySweep(env: Env, now: number): Promise<MercySweepResult> {
  const errors: string[] = [];
  const subsystems: SubsystemProbe[] = [
    await probeD1(env, now),
    await probeKv(env, now),
    await probeDoChannel(env),
    probeQueue(env),
    await probeFleetExecutor(env, now),
    await probeErrorRate(env, now),
  ];
  const verdict = aggregateVerdict(subsystems);

  // Snapshot — the status page reads only these rows, never live probes.
  try {
    await env.DB.prepare(
      'INSERT INTO mercy_health (at, overall, remote_harbors_possible, subsystems_json) VALUES (?, ?, ?, ?)',
    )
      .bind(now, verdict.overall, verdict.remoteHarborsPossible ? 1 : 0, JSON.stringify(subsystems))
      .run();
  } catch (e) {
    errors.push(`snapshot: ${msg(e)}`);
  }

  // Incidents + paging.
  const counters: IncidentCounters = { opened: 0, resolved: 0, pages: 0 };
  for (const s of subsystems) {
    await reconcileIncident(env, s, verdict.overall, now, counters, errors);
  }

  // Bounded growth: prune old snapshots + long-resolved incidents (best-effort).
  try {
    await env.DB.prepare('DELETE FROM mercy_health WHERE at < ?')
      .bind(now - SNAPSHOT_RETENTION_SECONDS)
      .run();
    await env.DB.prepare('DELETE FROM mercy_incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?')
      .bind(now - INCIDENT_RETENTION_SECONDS)
      .run();
  } catch (e) {
    errors.push(`prune: ${msg(e)}`);
  }

  return {
    at: now,
    overall: verdict.overall,
    remoteHarborsPossible: verdict.remoteHarborsPossible,
    subsystems,
    incidentsOpened: counters.opened,
    incidentsResolved: counters.resolved,
    pagesSent: counters.pages,
    errors,
  };
}

// ── Snapshot reads ────────────────────────────────────────────────────────────

interface SnapshotRow {
  at: number;
  overall: string;
  remote_harbors_possible: number;
  subsystems_json: string;
}

async function latestSnapshot(db: D1Database): Promise<SnapshotRow | null> {
  const row = await db
    .prepare(
      'SELECT at, overall, remote_harbors_possible, subsystems_json FROM mercy_health ORDER BY at DESC, id DESC LIMIT 1',
    )
    .first<SnapshotRow>();
  return row ?? null;
}

/** Parse + validate the stored subsystems JSON; drop anything malformed. */
function parseSubsystems(json: string): SubsystemProbe[] {
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: SubsystemProbe[] = [];
    for (const x of arr) {
      if (
        typeof x === 'object' && x !== null &&
        typeof (x as SubsystemProbe).name === 'string' &&
        ['green', 'yellow', 'red'].includes((x as SubsystemProbe).status)
      ) {
        const p = x as SubsystemProbe;
        out.push({
          name: p.name,
          status: p.status,
          latencyMs: typeof p.latencyMs === 'number' ? p.latencyMs : null,
          detail: typeof p.detail === 'string' ? p.detail : '',
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ── GET /mercy — public, unauthenticated, NO SECRETS ─────────────────────────

const STATUS_HEADERS = {
  'Cache-Control': 'public, max-age=30',
  'X-Content-Type-Options': 'nosniff',
};

/**
 * Public status page JSON. Serves the newest STORED snapshot (never live
 * probes — cheap and un-DoS-able) and strips the operator-facing `detail`
 * strings: name, status and latency only. No tokens, no URLs, no internals.
 */
export async function handleMercyStatus(env: Env): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  let row: SnapshotRow | null = null;
  try {
    row = await latestSnapshot(env.DB);
  } catch {
    // Health store unreadable — report honestly as unknown, not a raw 500.
    row = null;
  }
  // X2 mercy hook: the registered remote-harbor count rides the public status
  // page. This is the one live read here — a single COUNT(*) against a small
  // table, bounded by the 30s public cache above; fail-safe null. (The plan's
  // full per-harbor `remote_harbors` verdict is deferred to X2 v2.)
  let harborCount: number | null = null;
  try {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM harbors').first<{ n: number }>();
    harborCount = typeof c?.n === 'number' ? c.n : null;
  } catch {
    harborCount = null;
  }
  // X4 mercy hook (v1 slice): the open-parley count rides alongside — same
  // bounded single COUNT(*), fail-safe null. (The plan's summons-ack SLO and
  // parley-fatigue metric are deferred with the mediator's real body.)
  let openParleys: number | null = null;
  try {
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM parleys WHERE state = 'open'").first<{ n: number }>();
    openParleys = typeof c?.n === 'number' ? c.n : null;
  } catch {
    openParleys = null;
  }
  if (!row) {
    return Response.json(
      {
        code: 'OK',
        error: null,
        service: 'port-daddy-relay',
        version: env.RELAY_VERSION,
        overall: 'unknown',
        remoteHarborsPossible: null,
        snapshotAt: null,
        snapshotAgeSec: null,
        stale: true,
        subsystems: [],
        harbors: { count: harborCount },
        parleys: { open: openParleys },
        note: 'no health snapshot available — the MERCY cron has not completed a sweep (or its table is unreadable)',
      },
      { headers: STATUS_HEADERS },
    );
  }
  const ageSec = Math.max(0, now - row.at);
  return Response.json(
    {
      code: 'OK',
      error: null,
      service: 'port-daddy-relay',
      version: env.RELAY_VERSION,
      overall: row.overall,
      remoteHarborsPossible: row.remote_harbors_possible === 1,
      snapshotAt: row.at,
      snapshotAgeSec: ageSec,
      stale: ageSec > SNAPSHOT_STALE_SECONDS,
      subsystems: parseSubsystems(row.subsystems_json).map((s) => ({
        name: s.name,
        status: s.status,
        latencyMs: s.latencyMs,
      })),
      harbors: { count: harborCount },
      parleys: { open: openParleys },
    },
    { headers: STATUS_HEADERS },
  );
}

// ── GET /account/mercy — logged-in HTML report card ──────────────────────────

/** Minimal HTML-escape for interpolated data (XSS guard). */
function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlPage(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data:; " +
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const MERCY_CSS = `
${TOKENS}
.page{max-width:1080px;margin:0 auto;padding:0 40px 80px}
.site-header{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px 0;background:var(--surface-base);border-bottom:2px solid var(--border-strong)}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.page-head{padding-top:32px}
.page-head h1{font-size:clamp(30px,3.4vw,42px);font-weight:700;line-height:1.05;letter-spacing:-.03em}
.page-head .caption{margin-top:10px;max-width:60ch}
.verdict{margin-top:26px;border:2px solid var(--border-strong);display:grid;grid-template-columns:1fr 1fr}
.verdict>div{padding:18px 22px}
.verdict>div+div{border-left:2px solid var(--border-strong)}
.verdict .v-label{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted);margin-bottom:6px}
.verdict .v-value{font-family:"IBM Plex Mono",monospace;font-size:22px;font-weight:700}
.st{font-family:"IBM Plex Mono",monospace;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.st-green{color:var(--health)}.st-yellow{color:var(--amber)}.st-red{color:var(--error)}.st-unknown{color:var(--text-muted)}
section.sect{padding-top:44px;position:relative}
.sect h2{font-size:24px;font-weight:700;margin-bottom:14px}
.sect .eyebrow{display:block;margin-bottom:6px}
table{width:100%;border-collapse:collapse;border:2px solid var(--border-strong);font-size:14.5px}
th{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-muted);text-align:left;padding:10px 14px;border-bottom:2px solid var(--border-strong)}
td{padding:11px 14px;border-bottom:1px solid var(--hair);vertical-align:top}
tr:last-child td{border-bottom:none}
td.mono,th.num{font-variant-numeric:tabular-nums}
.tbl-wrap{overflow-x:auto}
.empty{border:1px dashed var(--hair-strong);background:transparent;padding:22px 24px}
.empty .e-title{font-weight:700;font-size:16px}
.empty p{font-size:14.5px;color:var(--text-secondary);line-height:1.6;margin-top:6px;max-width:64ch}
.stale{margin-top:14px;background:var(--surface-card);border:1px solid var(--amber);padding:14px 18px;font-size:14.5px;box-shadow:inset 3px 0 0 var(--amber)}
.backlink{display:inline-block;margin-top:26px;font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;padding:10px 18px;border:2px solid var(--border-strong);color:var(--text-primary);text-decoration:none}
.backlink:hover{background:var(--border-strong);color:var(--surface-base)}
@media (max-width:720px){.page{padding:0 20px 64px}.verdict{grid-template-columns:1fr}.verdict>div+div{border-left:none;border-top:2px solid var(--border-strong)}}
`;

function statusCell(status: string): string {
  const cls = ['green', 'yellow', 'red'].includes(status) ? status : 'unknown';
  return `<span class="st st-${cls}">${esc(status)}</span>`;
}

function fmtTs(ts: number | null): string {
  if (ts === null) return '—';
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

/** Render the report card. Exported for direct render tests. */
export function renderMercyPage(
  snapshot: SnapshotRow | null,
  incidents: MercyIncidentRow[],
  now: number,
): string {
  const subs = snapshot ? parseSubsystems(snapshot.subsystems_json) : [];
  const overall = snapshot?.overall ?? 'unknown';
  const remote = snapshot ? snapshot.remote_harbors_possible === 1 : null;
  const ageSec = snapshot ? Math.max(0, now - snapshot.at) : null;
  const stale = ageSec === null || ageSec > SNAPSHOT_STALE_SECONDS;

  const subsRows = subs
    .map(
      (s) => `<tr>
  <td class="mono">${esc(s.name)}</td>
  <td>${statusCell(s.status)}</td>
  <td class="mono">${s.latencyMs === null ? '—' : `${s.latencyMs}ms`}</td>
  <td>${esc(s.detail)}</td>
</tr>`,
    )
    .join('\n');

  const incidentRows = incidents
    .map(
      (i) => `<tr>
  <td class="mono">${esc(i.subsystem)}</td>
  <td class="mono">${fmtTs(i.opened_at)}</td>
  <td>${i.resolved_at === null ? '<span class="st st-red">OPEN</span>' : `<span class="st st-green">resolved</span> <span class="mono">${fmtTs(i.resolved_at)}</span>`}</td>
  <td class="mono">${i.paged_at === null ? 'not paged' : `paged ${fmtTs(i.paged_at)}`}</td>
  <td>${esc(i.detail)}</td>
</tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — MERCY report card</title>${HEAD}<style>${MERCY_CSS}</style></head><body>
<div class="page">
  <header class="site-header">
    <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
    <span class="eyebrow">MERCY / hospital ship</span>
  </header>
  <div class="page-head">
    <span class="eyebrow">portdaddy.dev · account · mercy</span>
    <h1 style="margin-top:8px">MERCY <span class="rec">report card</span></h1>
    <p class="caption">The hospital ship takes the network's vitals every few minutes and writes them down. This page is the chart at the foot of the bed — stored snapshots only, never a live probe on page load.</p>
  </div>

  <div class="verdict">
    <div>
      <span class="v-label">Overall</span>
      <span class="v-value">${statusCell(overall)}</span>
    </div>
    <div>
      <span class="v-label">Remote harbors possible</span>
      <span class="v-value">${
        remote === null
          ? '<span class="st st-unknown">unknown</span>'
          : remote
            ? '<span class="st st-green">YES</span>'
            : '<span class="st st-red">NO</span>'
      }</span>
    </div>
  </div>
  ${
    stale
      ? `<div class="stale"><strong>Stale snapshot.</strong> ${
          snapshot
            ? `Newest sweep is ${Math.floor((ageSec ?? 0) / 60)} minutes old (cadence is 5 minutes) — the cron itself may be down.`
            : 'No sweep has ever completed — the MERCY cron has not run or its table is missing.'
        }</div>`
      : ''
  }

  <section class="sect" aria-labelledby="subs-h">
    <span class="eyebrow">Vitals · as of ${esc(fmtTs(snapshot?.at ?? null))}</span>
    <h2 id="subs-h">Subsystems</h2>
    ${
      subs.length
        ? `<div class="tbl-wrap"><table>
<thead><tr><th>Subsystem</th><th>Status</th><th>Latency</th><th>Detail</th></tr></thead>
<tbody>
${subsRows}
</tbody></table></div>`
        : `<div class="empty"><div class="e-title">No vitals recorded yet.</div><p>The MERCY cron writes one snapshot per sweep into <span class="mono">mercy_health</span>. Once the first sweep lands, each subsystem's status, latency and detail appear here.</p></div>`
    }
  </section>

  <section class="sect" aria-labelledby="inc-h">
    <span class="eyebrow">Sick bay</span>
    <h2 id="inc-h">Last incidents</h2>
    ${
      incidents.length
        ? `<div class="tbl-wrap"><table>
<thead><tr><th>Subsystem</th><th>Opened</th><th>State</th><th>Paging</th><th>Detail</th></tr></thead>
<tbody>
${incidentRows}
</tbody></table></div>`
        : `<div class="empty"><div class="e-title">No incidents on record.</div><p>An incident opens on a subsystem's first red sweep and pages the on-call webhook exactly once; it resolves on the first non-red sweep after. None have occurred.</p></div>`
    }
  </section>

  <a class="backlink" href="/account">&larr; Back to account</a>
</div>
</body></html>`;
}

/** GET /account/mercy — session-gated; redirects to /login when signed out. */
export async function handleMercyPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  let snapshot: SnapshotRow | null = null;
  let incidents: MercyIncidentRow[] = [];
  try {
    snapshot = await latestSnapshot(env.DB);
  } catch {
    snapshot = null;
  }
  try {
    const r = await env.DB.prepare(
      'SELECT id, subsystem, opened_at, resolved_at, paged_at, detail FROM mercy_incidents ORDER BY opened_at DESC LIMIT 20',
    ).all<MercyIncidentRow>();
    incidents = r.results ?? [];
  } catch {
    incidents = [];
  }
  return htmlPage(renderMercyPage(snapshot, incidents, Math.floor(Date.now() / 1000)));
}
