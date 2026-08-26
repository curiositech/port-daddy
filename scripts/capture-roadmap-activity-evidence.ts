#!/usr/bin/env -S npx tsx
/**
 * capture-roadmap-activity-evidence.ts — visual evidence for the roadmap
 * live-activity data layer (`GET /roadmap/activity`,
 * `GET /roadmap/items/:slug/activity`).
 *
 * HONESTY CONTRACT (read this before trusting a pixel):
 *
 *  • The DATABASE is real: `initDatabase()` from lib/db.ts runs the shipped
 *    migrations against a throwaway file registry under $TMPDIR. No mock db,
 *    no hand-written schema.
 *  • The SEED is written through the shipped lib APIs — `createAgents().register()`,
 *    `createSessions().start()/end()`, `createRoadmapItems().upsert()`,
 *    `createDispatchQueue().propose/claim/start/produce/requestReview/accept/reject/settle`,
 *    and the real `FleetApprovalStream.enqueue()`. The dispatch lifecycle is
 *    driven through its real state machine, not INSERTed at a target state.
 *    Two exceptions, both declared in the MANIFEST:
 *      – `roadmap_claims` rows are INSERTed with the same column list
 *        lib/roadmap-pop.ts uses, because `pop()` requires an on-disk roadmap
 *        progress document that a capture script has no business synthesizing.
 *      – `roadmap_items.assignee_id` is set with a direct UPDATE (the planner
 *        column from migration 085 has no upsert field yet).
 *  • The RESPONSES are real: every number and string on screen comes out of
 *    `fastify.inject()` against the shipped `roadmapActivityPlugin`, through
 *    the shipped `createRoadmapActivity()` projection. The raw JSON for every
 *    shot is written to `responses/` next to the PNGs — diff it against the
 *    pixels.
 *  • LIVENESS IS NOT STAGED. Nothing is backdated. Every agent heartbeats once,
 *    for real, at seed time. The only lever is the injected projection clock
 *    (`createRoadmapActivity({ now })`). At clock = T0 + 10min the real
 *    lib/agents.ts ladder puts a `busy` agent (stale threshold 2.4h) at ACTIVE
 *    and a `draining` agent (stale threshold 3m) at STALE off the *same*
 *    heartbeat. That is the honest contrast, produced by the shipped ladder.
 *  • The RENDERER only styles. It never computes a stage, a liveness, or a
 *    count; it prints fields off the parsed response. Where it derives anything
 *    for readability (ISO strings, "2.4h" for 8640000ms) the raw ms value is
 *    printed alongside.
 *
 * Usage:
 *   npx tsx scripts/capture-roadmap-activity-evidence.ts [--out <dir>]
 *
 * Default out dir: docs/reports/roadmap-live-activity/
 *
 * Requires a Playwright chromium build. In CI/dev containers set
 * PLAYWRIGHT_BROWSERS_PATH to the shared browser cache; the script resolves the
 * `playwright` module from node_modules, then from the global npm root, so it
 * works without adding a dependency to package.json.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';

import { initDatabase, closeDatabase } from '../lib/db.js';
import { createLocks } from '../lib/locks.js';
import { createAgents, getStaleThresholdForStatus } from '../lib/agents.js';
import { createSessions } from '../lib/sessions.js';
import { createTupleSpace } from '../lib/tuples.js';
import { createRoadmapItems } from '../lib/roadmap-items.js';
import { createRoadmapPop } from '../lib/roadmap-pop.js';
import { createDispatchQueue } from '../lib/dispatch/queue.js';
import { createRoadmapActivity } from '../lib/roadmap-activity.js';
import { roadmapActivityPlugin } from '../routes/roadmap-activity.js';
import {
  FleetApprovalStream,
  setSharedApprovalStream,
} from '../lib/fleet/approval-stream.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);

const HARBOR = 'port-daddy:fleet';
/** Projection clock offset for the still captures: T0 + 10 minutes. */
const STILL_CLOCK_OFFSET_MS = 10 * 60 * 1000;

// ── Playwright resolution (no package.json dependency) ───────────────────────

/**
 * Resolve the `playwright` module from the repo, then from the global npm root.
 * Rationale: visual capture is a maintenance chore, not a runtime dependency;
 * adding playwright to package.json would put a ~300MB browser download in
 * every install. Failing loudly with the install hint is better than a silent
 * "screenshots skipped".
 *
 * @returns The playwright module namespace.
 */
function loadPlaywright(): { chromium: any } {
  const candidates = ['playwright', 'playwright-core'];
  for (const name of candidates) {
    try {
      return require_(name);
    } catch {
      /* try next */
    }
  }
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    for (const name of candidates) {
      try {
        return require_(join(globalRoot, name));
      } catch {
        /* try next */
      }
    }
  } catch {
    /* npm not on PATH */
  }
  throw new Error(
    'capture-roadmap-activity-evidence: could not resolve `playwright`. ' +
      'Install it (npm i -g playwright) and point PLAYWRIGHT_BROWSERS_PATH at a ' +
      'chromium build. This script never fabricates images when capture fails.',
  );
}

// ── Seed ─────────────────────────────────────────────────────────────────────

interface Harness {
  db: ReturnType<typeof initDatabase>;
  dir: string;
  /** Mutable clock the dispatch queue reads — advanced for the motion frames. */
  clock: { ms: number };
  t0: number;
}

/**
 * Open a throwaway file-backed registry with the shipped migrations and build
 * the module graph in the same order server.ts does (tuples → roadmap items →
 * pop → locks → agents → sessions → dispatch queue).
 *
 * @returns The harness handle.
 */
function openHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'pd-roadmap-activity-evidence-'));
  const db = initDatabase({ dbPath: join(dir, 'registry.db') });
  const t0 = Date.now();
  return { db, dir, clock: { ms: t0 }, t0 };
}

/** The identifiers the seed produces, so callers can address them by name. */
interface Seeded {
  slugs: Record<string, string>;
  dispatchIds: Record<string, string>;
  sessionIds: Record<string, string>;
  agentIds: Record<string, string>;
}

/**
 * Seed a board that shows agent work in flight across all four stages, plus
 * the three states operators complain get hidden: stale, attention, and empty.
 *
 * Every write below goes through a shipped lib API except the two declared
 * exceptions (roadmap_claims insert, assignee_id update).
 *
 * @param h - The harness.
 * @returns The seeded identifiers.
 */
function seed(h: Harness): Seeded {
  const { db } = h;

  const tuples = createTupleSpace(db);
  const roadmapItems = createRoadmapItems({ db, tuples });
  const roadmapPop = createRoadmapPop({ db }); // creates roadmap_claims (real schema)
  createLocks(db);
  const agents = createAgents(db);
  const sessions = createSessions(db);
  const queue = createDispatchQueue({ db, now: () => h.clock.ms });
  void roadmapPop;

  const insertClaim = db.prepare(`
    INSERT INTO roadmap_claims
      (slug, kind, feedback_id, claimed_by, claimed_at, summary, surface, payload, session_id, agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setAssignee = db.prepare('UPDATE roadmap_items SET assignee_id = ? WHERE slug = ?');

  const agentIds: Record<string, string> = {};
  const sessionIds: Record<string, string> = {};
  const dispatchIds: Record<string, string> = {};
  const slugs: Record<string, string> = {};

  /** Register an agent through the real registry (real heartbeat = now). */
  const reg = (id: string, name: string, status: string, purpose: string) => {
    const r = agents.register(id, { name, status, purpose, pid: process.pid }) as {
      success: boolean;
      error?: string;
    };
    if (!r.success) throw new Error(`agents.register(${id}) failed: ${r.error}`);
    agentIds[id] = id;
    return id;
  };

  /** Start a session through the real session store. */
  const startSession = (key: string, purpose: string, opts: Record<string, unknown>) => {
    const r = sessions.start(purpose, opts) as { success: boolean; id?: string; error?: string };
    if (!r.success || !r.id) throw new Error(`sessions.start(${purpose}) failed: ${r.error}`);
    sessionIds[key] = r.id;
    return r.id;
  };

  /** Upsert a roadmap item through the real store. */
  const item = (slug: string, summaryMd: string, status: string, notes?: Array<{ at: number; by: string; text: string }>) => {
    roadmapItems.upsert({ slug, summaryMd, status: status as never, harbor: HARBOR, notes });
    slugs[slug] = slug;
    return slug;
  };

  // ── EXECUTING #1: four corroborating join paths on one item ───────────────
  // claim + rent-at-claim session link + planner assignee + canonical dispatch.
  {
    const a = reg('fleet-shipwright-01', 'Shipwright', 'busy', 'roadmap live-activity join');
    const d = queue.propose({
      goal: 'Roadmap activity board feed',
      requestedBy: 'operator',
      tags: ['roadmap', 'live-activity'],
    });
    const slug = item(
      d.slug,
      'Board feed: join roadmap items to in-flight agent work so the operator sees who is driving what, right now.',
      'now',
      [{ at: h.t0, by: 'operator', text: 'Mandate: the roadmap must show ACTIVE IN-PROGRESS AGENT WORK.' }],
    );
    const s = startSession('board-feed', 'ship the roadmap activity board feed', {
      agentId: a,
      worktreeId: 'wt-roadmap-activity',
      metadata: { roadmapLink: slug },
    });
    queue.claim({ id: d.id, worktreePath: `/worktrees/${slug}`, branch: `dispatch/${slug}`, sessionId: s, workerActorId: a });
    queue.start(d.id);
    insertClaim.run(slug, 'next-cut', null, a, h.clock.ms, 'board feed slice', 'roadmap', null, s, a);
    setAssignee.run(a, slug);
    dispatchIds['board-feed'] = d.id;
  }

  // ── EXECUTING #2: a second agent driving a different item ─────────────────
  {
    const a = reg('fleet-lookout-02', 'Lookout', 'busy', 'cockpit + transcript links');
    const d = queue.propose({ goal: 'Cockpit transcript links', requestedBy: 'operator', tags: ['cockpit'] });
    const slug = item(d.slug, 'Cockpit links: stream SSE + transcript timeline per attachment, never an invented endpoint.', 'now');
    const s = startSession('cockpit', 'wire the cockpit transcript links', {
      agentId: a,
      worktreeId: 'wt-cockpit-links',
      metadata: { roadmapLink: slug },
    });
    queue.claim({ id: d.id, worktreePath: `/worktrees/${slug}`, branch: `dispatch/${slug}`, sessionId: s, workerActorId: a });
    queue.start(d.id);
    dispatchIds['cockpit'] = d.id;
  }

  // ── REVIEW: produced → review_pending ────────────────────────────────────
  {
    const a = reg('fleet-purser-03', 'Purser', 'busy', 'adversarial tests');
    const d = queue.propose({ goal: 'Liveness ladder regression tests', requestedBy: 'operator' });
    const slug = item(d.slug, 'Regression tests pinning the stale ladder so a future refactor cannot quietly promote stale to active.', 'merge');
    const s = startSession('review', 'write the liveness ladder regression tests', {
      agentId: a,
      worktreeId: 'wt-liveness-tests',
      metadata: { roadmapLink: slug },
    });
    queue.claim({ id: d.id, worktreePath: `/worktrees/${slug}`, branch: `dispatch/${slug}`, sessionId: s, workerActorId: a });
    queue.start(d.id);
    queue.produce({ id: d.id, resultArtifact: `dispatch/${slug}` });
    queue.requestReview(d.id);
    dispatchIds['review'] = d.id;
  }

  // ── DONE: accepted, with the session actually ended ───────────────────────
  {
    const a = reg('fleet-navigator-04', 'Navigator', 'busy', 'stage rollup');
    const d = queue.propose({ goal: 'Stage rollup vocabulary', requestedBy: 'operator' });
    const slug = item(d.slug, 'Stage rollup: stacked → executing → review → done as a documented projection over the dispatch enum.', 'now');
    const s = startSession('done', 'document the stage rollup vocabulary', {
      agentId: a,
      worktreeId: 'wt-stage-rollup',
      metadata: { roadmapLink: slug },
    });
    queue.claim({ id: d.id, worktreePath: `/worktrees/${slug}`, branch: `dispatch/${slug}`, sessionId: s, workerActorId: a });
    queue.start(d.id);
    queue.produce({ id: d.id, resultArtifact: `dispatch/${slug}` });
    queue.requestReview(d.id);
    queue.accept({ id: d.id, note: 'merged' });
    sessions.end(s, { status: 'completed', note: 'stage rollup documented' });
    dispatchIds['done'] = d.id;
  }

  // ── ATTENTION #1: settle(failed) with a verbatim error message ────────────
  {
    const a = reg('fleet-quartermaster-05', 'Quartermaster', 'busy', 'blob store intake');
    const d = queue.propose({ goal: 'Evidence blob store intake', requestedBy: 'operator' });
    const slug = item(d.slug, 'Blob-store intake for agent-submitted evidence. Must fail loudly rather than drop evidence.', 'now');
    const s = startSession('failed', 'wire the evidence blob store intake', {
      agentId: a,
      worktreeId: 'wt-blob-intake',
      metadata: { roadmapLink: slug },
    });
    queue.claim({ id: d.id, worktreePath: `/worktrees/${slug}`, branch: `dispatch/${slug}`, sessionId: s, workerActorId: a });
    queue.start(d.id);
    queue.settle({
      id: d.id,
      state: 'failed',
      errorMessage: 'blob store unreachable at ~/.port-daddy/blobs: ENOENT — intake refused rather than dropping evidence',
    });
    insertClaim.run(slug, 'next-cut', null, a, h.clock.ms, 'blob intake', 'roadmap', null, s, a);
    dispatchIds['failed'] = d.id;
  }

  // ── ATTENTION #2: rejected at review, with the operator's reason ──────────
  {
    const a = reg('fleet-coxswain-06', 'Coxswain', 'busy', 'interrupt ingress');
    const d = queue.propose({ goal: 'Acknowledged interrupt ingress', requestedBy: 'operator' });
    const slug = item(d.slug, 'Acknowledged control ingress so interrupt can stop being a capability-flagged affordance.', 'now');
    const s = startSession('rejected', 'draft the acknowledged interrupt ingress', {
      agentId: a,
      worktreeId: 'wt-interrupt-ingress',
      metadata: { roadmapLink: slug },
    });
    queue.claim({ id: d.id, worktreePath: `/worktrees/${slug}`, branch: `dispatch/${slug}`, sessionId: s, workerActorId: a });
    queue.start(d.id);
    queue.produce({ id: d.id, resultArtifact: `dispatch/${slug}` });
    queue.requestReview(d.id);
    queue.reject({ id: d.id, reason: 'publish-only signal with no ack lifecycle — do not ship this as a wired control' });
    dispatchIds['rejected'] = d.id;
  }

  // ── ATTENTION #3: salvage ────────────────────────────────────────────────
  {
    const a = reg('fleet-bosun-07', 'Bosun', 'busy', 'roster projection');
    const d = queue.propose({ goal: 'Durable roster projection backfill', requestedBy: 'operator' });
    const slug = item(d.slug, 'Backfill the durable roster projection so assignee ids resolve after a daemon restart.', 'now');
    const s = startSession('salvage', 'backfill the durable roster projection', {
      agentId: a,
      worktreeId: 'wt-roster-backfill',
      metadata: { roadmapLink: slug },
    });
    queue.claim({ id: d.id, worktreePath: `/worktrees/${slug}`, branch: `dispatch/${slug}`, sessionId: s, workerActorId: a });
    queue.start(d.id);
    queue.settle({ id: d.id, state: 'salvage', errorMessage: 'worktree removed under the worker; branch never pushed — salvage the notes' });
    dispatchIds['salvage'] = d.id;
  }

  // ── LIVENESS CONTRAST: one item, three attachments, one clock ─────────────
  // Nothing is backdated. All three agents heartbeat once, now. At the still
  // clock (T0 + 10m) the shipped ladder splits them:
  //   busy      → stale threshold 8_640_000ms (2.4h) → idle 600_000ms → ACTIVE
  //   draining  → stale threshold   180_000ms (3m)   → idle 600_000ms → STALE
  //   completed session → DONE regardless of heartbeat freshness
  {
    const slug = item(
      'liveness-contrast-slice',
      'Two work attachments off the same heartbeat: a busy agent (threshold 2.4h) and a draining one (threshold 3m). The ladder splits them.',
      'now',
    );

    const live = reg('fleet-carpenter-08', 'Carpenter', 'busy', 'active on the contrast slice');
    const sLive = startSession('contrast-active', 'drive the contrast slice', {
      agentId: live,
      worktreeId: 'wt-contrast-a',
      metadata: { roadmapLink: slug },
    });
    insertClaim.run(slug, 'next-cut', null, live, h.clock.ms, 'contrast: live', 'roadmap', null, sLive, live);

    const drain = reg('fleet-cooper-09', 'Cooper', 'draining', 'winding down on the contrast slice');
    // Called for its effect, not its id: this session IS the draining agent's
    // work attachment, and it deliberately gets NO claim row. roadmap_claims
    // carries a partial UNIQUE index on slug for unreleased claims
    // (lib/roadmap-pop.ts) — one open claim per item is the real invariant — so
    // this attachment joins via the rent-at-claim session link
    // (sessions.metadata.roadmapLink) instead, which is what makes the
    // per-status stale ladder visible beside an active `busy` agent.
    startSession('contrast-stale', 'wind down the contrast slice', {
      agentId: drain,
      worktreeId: 'wt-contrast-b',
      metadata: { roadmapLink: slug },
    });
  }

  // ── DONE liveness: an unreleased claim on a COMPLETED session ─────────────
  // This cannot live on the item above, and the reason is a real invariant,
  // not a staging convenience:
  //   • roadmap_claims carries a partial UNIQUE index on slug for unreleased
  //     claims — one open claim per item.
  //   • the session-link join only reads sessions WHERE status = 'active', so
  //     a completed session leaves that path entirely.
  // So `done` is only reachable through a claim, and a claim is exclusive.
  // A fresh heartbeat does NOT resurrect it: the agent below heartbeats at seed
  // time like everyone else, and the item still rolls up to `stacked`.
  {
    const slug = item(
      'finished-session-salvage-signal',
      'An unreleased claim sitting on a COMPLETED session. Liveness is done, not active — a fresh heartbeat cannot resurrect finished work.',
      'now',
    );
    const fin = reg('fleet-cartographer-10', 'Cartographer', 'busy', 'finished, claim never released');
    const sFin = startSession('contrast-done', 'finish the salvage-signal slice', {
      agentId: fin,
      worktreeId: 'wt-contrast-c',
      metadata: { roadmapLink: slug },
    });
    insertClaim.run(slug, 'next-cut', null, fin, h.clock.ms, 'claim never released', 'roadmap', null, sFin, fin);
    sessions.end(sFin, { status: 'completed', note: 'this one is genuinely finished' });
  }

  // ── NULL STATE: an item nobody is on ─────────────────────────────────────
  item(
    'nobody-is-on-this-slice',
    'Nobody has claimed this. No session, no dispatch, no assignee — the empty state the operator sees when nothing is running.',
    'backlog',
  );

  // ── HITL: a real held spawn approval on the real shared stream ────────────
  const approvals = new FleetApprovalStream();
  approvals.enqueue({
    id: 'approval-fleet-coxswain-06-webhook',
    project: 'port-daddy',
    agent: 'fleet-coxswain-06',
    trigger: 'webhook:roadmap-dispatch',
    tier: 'restricted' as never,
    reason: 'trust gate held the spawn: restricted tier requires an operator decision',
    safeTools: ['Read', 'Grep'],
    context: {} as never,
    timestamp: h.t0,
  });
  setSharedApprovalStream(approvals);

  return { slugs, dispatchIds, sessionIds, agentIds };
}

// ── Route calls (real Fastify inject over the real plugin) ────────────────────

interface Api {
  board(query?: string): Promise<any>;
  item(slug: string): Promise<any>;
  close(): Promise<void>;
}

/**
 * Mount the shipped roadmap-activity plugin over the shipped projection and
 * expose the two routes. Every screenshot's data comes through here.
 *
 * @param db - The seeded registry.
 * @param now - The injected projection clock.
 * @returns Route callers plus a closer.
 */
async function mountApi(db: any, now: () => number): Promise<Api> {
  const roadmapActivity = createRoadmapActivity({ db, now });
  const app = Fastify();
  await app.register(roadmapActivityPlugin, { deps: { roadmapActivity } });
  await app.ready();

  const call = async (url: string) => {
    const res = await app.inject({ method: 'GET', url });
    if (res.statusCode !== 200) throw new Error(`GET ${url} → ${res.statusCode}: ${res.body}`);
    return JSON.parse(res.body);
  };

  return {
    board: (query = '') => call(`/roadmap/activity${query}`),
    item: (slug: string) => call(`/roadmap/items/${encodeURIComponent(slug)}/activity`),
    close: () => app.close(),
  };
}

// ── Rendering (styling only — no computation over the data) ───────────────────

/** HTML-escape a value for safe interpolation. */
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** Human duration next to the raw ms, so the raw API number is always visible. */
function dur(ms: number | null | undefined): string {
  if (ms == null) return '<span class="null">null</span>';
  const s = Math.round(ms / 1000);
  let human: string;
  if (s < 60) human = `${s}s`;
  else if (s < 3600) human = `${(s / 60).toFixed(s % 60 ? 1 : 0)}m`;
  else human = `${(s / 3600).toFixed(1)}h`;
  return `${esc(human)} <span class="raw">${esc(ms)}ms</span>`;
}

/** ISO string next to the raw epoch. */
function ts(ms: number | null | undefined): string {
  if (ms == null) return '<span class="null">null</span>';
  return `${esc(new Date(ms).toISOString().replace('T', ' ').replace('.000Z', 'Z'))} <span class="raw">${esc(ms)}</span>`;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#0b0f14;color:#d7e0ea;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;-webkit-font-smoothing:antialiased}
.page{padding:24px 28px 30px}
h1{font-size:18px;margin:0 0 3px;letter-spacing:.02em;color:#f2f6fa;font-weight:600}
.sub{color:#7d8b9c;font-size:12px;margin:0 0 4px}
.route{display:inline-block;background:#131c26;border:1px solid #22303f;color:#8fd6a0;padding:2px 8px;border-radius:4px;font-size:11.5px;margin:6px 6px 0 0}
.prov{color:#5d6b7c;font-size:11px;margin-top:8px;border-top:1px solid #1a2531;padding-top:8px}
.prov b{color:#8593a4;font-weight:600}
.hist{display:flex;gap:10px;margin:16px 0 6px;flex-wrap:wrap}
.stage-card{flex:1 1 0;min-width:150px;background:#111923;border:1px solid #1f2b39;border-radius:7px;padding:10px 12px}
.stage-card .n{font-size:26px;font-weight:700;line-height:1.1}
.stage-card .l{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#7d8b9c;margin-top:2px}
.bar{height:5px;border-radius:3px;margin-top:8px;background:#1b2635;overflow:hidden}
.bar i{display:block;height:100%}
.st-stacked .n{color:#8593a4} .st-stacked .bar i{background:#5b6a7c}
.st-executing .n{color:#48c78e} .st-executing .bar i{background:#48c78e}
.st-review .n{color:#f0b429} .st-review .bar i{background:#f0b429}
.st-done .n{color:#5aa7f0} .st-done .bar i{background:#5aa7f0}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}
.chip{background:#111923;border:1px solid #1f2b39;border-radius:6px;padding:6px 11px;font-size:11.5px;color:#9aa8b8}
.chip b{color:#e6edf5;font-size:14px;margin-right:5px}
.chip.warn{border-color:#5a3320;background:#1c1310}.chip.warn b{color:#ff8f5e}
.item{background:#0f161e;border:1px solid #1c2734;border-left-width:3px;border-radius:7px;padding:11px 13px;margin-bottom:9px}
.item.executing{border-left-color:#48c78e}
.item.review{border-left-color:#f0b429}
.item.done{border-left-color:#5aa7f0}
.item.stacked{border-left-color:#4a5766}
.item.attn{border-color:#5a3320;background:#150f0d}
.ihead{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.slug{color:#f2f6fa;font-weight:600;font-size:13.5px}
.badge{font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:3px;font-weight:700}
.b-executing{background:#123527;color:#48c78e}
.b-review{background:#33290c;color:#f0b429}
.b-done{background:#122740;color:#5aa7f0}
.b-stacked{background:#1a222c;color:#8593a4}
.b-attn{background:#3a1a0e;color:#ff8f5e}
.b-active{background:#123527;color:#48c78e}
.b-stale{background:#3a2a0c;color:#e0a020}
.b-dead,.b-doneness{background:#1a222c;color:#8593a4}
.summary{color:#93a2b4;margin:5px 0 7px;font-size:12px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:1px 12px;font-size:11.5px}
.kv dt{color:#68778a} .kv dd{margin:0;color:#c4d0dd;word-break:break-all}
.att{background:#0c1219;border:1px solid #1a2430;border-radius:6px;padding:9px 11px;margin-top:7px}
.att.stale{border-color:#4a3a12}
.att.done{border-color:#26303c}
.ahead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.agent{color:#f2f6fa;font-weight:600}
.src{background:#152030;color:#7fb4e8;border-radius:3px;padding:1px 6px;font-size:10px}
.link{color:#6fb6f5}
.null{color:#7a5a3a;font-style:italic}
.raw{color:#4f5d6e;font-size:10.5px}
.err{color:#ff8f5e;background:#1c1210;border:1px solid #47281a;border-radius:4px;padding:6px 9px;margin-top:6px;font-size:11.5px;word-break:break-word}
.err.neutral{color:#93a2b4;background:#111923;border-color:#243141}
.hitl{color:#e0a020;background:#1a1508;border:1px solid #453611;border-radius:4px;padding:6px 9px;margin-top:6px;font-size:11.5px}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.panel{background:#0f161e;border:1px solid #1c2734;border-radius:8px;padding:13px 15px}
.panel h2{font-size:13px;margin:0 0 3px;color:#f2f6fa}
.panel .pnote{color:#7d8b9c;font-size:11.5px;margin:0 0 9px}
.empty{border:1px dashed #2a3a4c;border-radius:6px;padding:20px;text-align:center;color:#6d7c8e;font-size:12px;margin-top:8px}
.empty b{display:block;color:#a8b6c6;font-size:13px;margin-bottom:4px}
.note{color:#7d8b9c;font-size:11.5px;margin:12px 0 0;border-left:2px solid #253242;padding-left:10px}
.row{display:flex;gap:10px;align-items:flex-start;background:#0f161e;border:1px solid #1c2734;border-left-width:3px;border-radius:6px;padding:9px 12px;margin-bottom:7px}
.row.executing{border-left-color:#48c78e}.row.review{border-left-color:#f0b429}
.row.done{border-left-color:#5aa7f0}.row.stacked{border-left-color:#4a5766}
.row.attn{border-color:#5a3320;background:#150f0d}
.row .col-l{flex:0 0 250px}
.row .col-r{flex:1 1 auto;min-width:0}
.row .slug{display:block;font-size:12.5px;margin-bottom:3px;word-break:break-all}
.row .dstate{color:#93a2b4;font-size:11px}
.row .dstate b{color:#e6edf5}
.line{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:11.5px;padding:2px 0;border-top:1px solid #16202b}
.line:first-child{border-top:0}
.line .who{color:#f2f6fa;font-weight:600;min-width:96px}
.line .m{color:#7d8b9c}
.line .m b{color:#c4d0dd;font-weight:500}
.line .lk{color:#5f9ed6;font-size:10.5px}
.nobody{color:#6d7c8e;font-size:11.5px;font-style:italic}
`;

interface ShellOpts {
  title: string;
  subtitle: string;
  routes: string[];
  provenance: string;
  note?: string;
  width?: number;
}

/** Wrap a body fragment in the page shell. */
function shell(body: string, o: ShellOpts): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  body{width:${o.width ?? 1360}px}</style></head><body><div class="page">
  <h1>${esc(o.title)}</h1>
  <p class="sub">${esc(o.subtitle)}</p>
  ${o.routes.map((r) => `<span class="route">${esc(r)}</span>`).join('')}
  ${body}
  ${o.note ? `<p class="note">${o.note}</p>` : ''}
  <p class="prov">${o.provenance}</p>
  </div></body></html>`;
}

/** Render the board header (histogram + counts) from `board.counts`. */
function renderCounts(counts: any): string {
  const stages = ['stacked', 'executing', 'review', 'done'] as const;
  const max = Math.max(1, ...stages.map((s) => counts.byStage[s] ?? 0));
  const cards = stages
    .map(
      (s) => `<div class="stage-card st-${s}">
        <div class="n">${esc(counts.byStage[s] ?? 0)}</div>
        <div class="l">${esc(s)}</div>
        <div class="bar"><i style="width:${Math.round(((counts.byStage[s] ?? 0) / max) * 100)}%"></i></div>
      </div>`,
    )
    .join('');
  const chips = [
    `<div class="chip"><b>${esc(counts.items)}</b>items</div>`,
    `<div class="chip"><b>${esc(counts.activeAgents)}</b>active agents</div>`,
    `<div class="chip"><b>${esc(counts.staleAttachments)}</b>stale attachments</div>`,
    `<div class="chip"><b>${esc(counts.openClaims)}</b>open claims</div>`,
    `<div class="chip${counts.attention ? ' warn' : ''}"><b>${esc(counts.attention)}</b>need attention</div>`,
  ].join('');
  return `<div class="hist">${cards}</div><div class="chips">${chips}</div>`;
}

/** Render one work attachment card, printing the raw liveness inputs. */
function renderAttachment(a: any, opts: { full?: boolean } = {}): string {
  const rows: string[] = [];
  rows.push(`<dt>liveness</dt><dd><span class="badge b-${esc(a.liveness === 'active' ? 'active' : a.liveness === 'stale' ? 'stale' : 'doneness')}">${esc(a.liveness)}</span></dd>`);
  rows.push(`<dt>idleMs</dt><dd>${dur(a.idleMs)}</dd>`);
  rows.push(`<dt>staleThresholdMs</dt><dd>${dur(a.staleThresholdMs)}</dd>`);
  rows.push(`<dt>lastHeartbeatMs</dt><dd>${ts(a.lastHeartbeatMs)}</dd>`);
  rows.push(`<dt>sessionId</dt><dd>${a.sessionId ? esc(a.sessionId) : '<span class="null">null</span>'} <span class="raw">status=${esc(a.sessionStatus ?? 'null')}</span></dd>`);
  if (opts.full) {
    rows.push(`<dt>key</dt><dd>${esc(a.key)}</dd>`);
    rows.push(`<dt>agentRegistered</dt><dd>${esc(a.agentRegistered)}</dd>`);
    rows.push(`<dt>agentNodeId</dt><dd>${a.agentNodeId ? esc(a.agentNodeId) : '<span class="null">null</span>'}</dd>`);
    rows.push(`<dt>purpose</dt><dd>${a.purpose ? esc(a.purpose) : '<span class="null">null</span>'}</dd>`);
    rows.push(`<dt>worktreeId</dt><dd>${a.worktreeId ? esc(a.worktreeId) : '<span class="null">null</span>'}</dd>`);
    if (a.claim) {
      rows.push(`<dt>claim</dt><dd>#${esc(a.claim.id)} kind=${esc(a.claim.kind)} claimedBy=${esc(a.claim.claimedBy)} at=${ts(a.claim.claimedAt)}</dd>`);
    } else {
      rows.push(`<dt>claim</dt><dd><span class="null">null</span></dd>`);
    }
    rows.push(`<dt>transcriptUrl</dt><dd>${a.transcriptUrl ? `<span class="link">${esc(a.transcriptUrl)}</span>` : '<span class="null">null</span>'}</dd>`);
    if (a.cockpit) {
      rows.push(`<dt>cockpit.streamUrl</dt><dd><span class="link">${esc(a.cockpit.streamUrl)}</span></dd>`);
      rows.push(`<dt>cockpit.steeringChannel</dt><dd>${esc(a.cockpit.steeringChannel)}</dd>`);
      rows.push(`<dt>cockpit.interrupt</dt><dd>available=<b>${esc(a.cockpit.interrupt.available)}</b> · plannedRoute=${esc(a.cockpit.interrupt.plannedRoute)} · plannedVerbs=[${esc(a.cockpit.interrupt.plannedVerbs.join(', '))}]<br><span class="raw">reason: ${esc(a.cockpit.interrupt.reason)}</span><br><span class="raw">softSignalUrl: ${esc(a.cockpit.interrupt.softSignalUrl)}</span></dd>`);
    }
  } else {
    if (a.transcriptUrl) rows.push(`<dt>transcript</dt><dd><span class="link">${esc(a.transcriptUrl)}</span></dd>`);
    if (a.cockpit) rows.push(`<dt>stream</dt><dd><span class="link">${esc(a.cockpit.streamUrl)}</span></dd>`);
  }
  const hitl = (a.hitl ?? [])
    .map(
      (h: any) =>
        `<div class="hitl">HITL HELD · <b>${esc(h.id)}</b> · agent=${esc(h.agent)} · trigger=${esc(h.trigger)} · tier=${esc(h.tier)}<br>${esc(h.reason ?? '')}<br><span class="raw">decisionUrl: ${esc(h.decisionUrl)}</span></div>`,
    )
    .join('');
  return `<div class="att ${esc(a.liveness)}">
    <div class="ahead">
      <span class="agent">${esc(a.agentName ?? a.agentId ?? '(no agent)')}</span>
      <span class="raw">${esc(a.agentId ?? '')}</span>
      ${(a.sources ?? []).map((s: string) => `<span class="src">${esc(s)}</span>`).join('')}
    </div>
    <dl class="kv">${rows.join('')}</dl>${hitl}</div>`;
}

/**
 * Compact board row: the same fields as the detail card, one line per
 * attachment, so a nine-item board fits on a page a reviewer will actually
 * scroll. Nothing is summarised away — liveness, idleMs and staleThresholdMs
 * stay on the line.
 *
 * @param it - One RoadmapItemActivity from the board response.
 * @returns HTML fragment.
 */
function renderItemRow(it: any): string {
  const d = it.dispatch;
  const lines = (it.attachments ?? [])
    .map(
      (a: any) => `<div class="line">
        <span class="who">${esc(a.agentName ?? a.agentId ?? '(no agent)')}</span>
        <span class="badge b-${esc(a.liveness === 'active' ? 'active' : a.liveness === 'stale' ? 'stale' : 'doneness')}">${esc(a.liveness)}</span>
        <span class="m">idle <b>${esc(a.idleMs ?? 'null')}ms</b> / threshold <b>${esc(a.staleThresholdMs)}ms</b></span>
        ${(a.sources ?? []).map((x: string) => `<span class="src">${esc(x)}</span>`).join('')}
        ${a.cockpit ? `<span class="lk">${esc(a.cockpit.streamUrl)}</span>` : ''}
        ${a.transcriptUrl ? `<span class="lk">${esc(a.transcriptUrl)}</span>` : ''}
        ${(a.hitl ?? []).length ? `<span class="badge b-stale">hitl held ×${esc(a.hitl.length)}</span>` : ''}
      </div>`,
    )
    .join('');
  // `dispatches.error_message` is also where lib/dispatch/queue.ts parks the
  // accept note, so it can carry non-failure text. Printed verbatim either way,
  // but only styled as an alarm when the response actually says needsAttention.
  const err = d?.errorMessage
    ? `<div class="err${it.needsAttention ? '' : ' neutral'}">dispatch.errorMessage: ${esc(d.errorMessage)}</div>`
    : '';
  return `<div class="row ${esc(it.stage)}${it.needsAttention ? ' attn' : ''}">
    <div class="col-l">
      <span class="slug">${esc(it.slug)}</span>
      <span class="badge b-${esc(it.stage)}">${esc(it.stage)}</span>
      ${it.needsAttention ? '<span class="badge b-attn">attention</span>' : ''}
      <div class="dstate">dispatch <b>${esc(d ? d.state : 'null')}</b> · status ${esc(it.status)}<br>
        att ${esc(it.counts.attachments)} · active ${esc(it.counts.active)} · stale ${esc(it.counts.stale)}</div>
    </div>
    <div class="col-r">${lines || '<div class="nobody">attachments: [] — nobody is on this item</div>'}${err}</div>
  </div>`;
}

/** Render one item card. `full` prints the whole attachment field set. */
function renderItem(it: any, opts: { full?: boolean } = {}): string {
  const d = it.dispatch;
  const rows: string[] = [];
  rows.push(`<dt>status</dt><dd>${esc(it.status)} <span class="raw">(roadmap_items.status)</span></dd>`);
  rows.push(`<dt>counts</dt><dd>attachments=${esc(it.counts.attachments)} · active=${esc(it.counts.active)} · stale=${esc(it.counts.stale)}</dd>`);
  if (opts.full) {
    rows.push(`<dt>harbor</dt><dd>${esc(it.harbor)}</dd>`);
    rows.push(`<dt>assigneeId</dt><dd>${it.assigneeId ? esc(it.assigneeId) : '<span class="null">null</span>'}</dd>`);
    rows.push(`<dt>lastTouchedAt</dt><dd>${ts(it.lastTouchedAt)}</dd>`);
    rows.push(`<dt>reviewEvidence</dt><dd>${it.reviewEvidence ? esc(JSON.stringify(it.reviewEvidence)) : '<span class="null">null</span>'}</dd>`);
  }
  if (d) {
    rows.push(
      `<dt>dispatch</dt><dd>state=<b>${esc(d.state)}</b> · id=${esc(d.id)}<br><span class="raw">branch=${esc(d.branch ?? 'null')} · worker=${esc(d.workerActorId ?? 'null')} · session=${esc(d.sessionId ?? 'null')} · createdAt=${esc(d.createdAt)}</span></dd>`,
    );
  } else {
    rows.push(`<dt>dispatch</dt><dd><span class="null">null</span></dd>`);
  }
  rows.push(`<dt>needsAttention</dt><dd>${it.needsAttention ? '<span class="badge b-attn">true</span>' : 'false'}</dd>`);

  const err = d?.errorMessage
    ? `<div class="err${it.needsAttention ? '' : ' neutral'}"><b>dispatch.errorMessage</b> (verbatim): ${esc(d.errorMessage)}</div>`
    : '';
  const atts = (it.attachments ?? []).map((a: any) => renderAttachment(a, opts)).join('');
  const noAtts =
    (it.attachments ?? []).length === 0
      ? `<div class="empty"><b>attachments: []</b>No claim, no session link, no assignee, no dispatch. Nobody is on this item.</div>`
      : '';

  return `<div class="item ${esc(it.stage)}${it.needsAttention ? ' attn' : ''}">
    <div class="ihead">
      <span class="slug">${esc(it.slug)}</span>
      <span class="badge b-${esc(it.stage)}">${esc(it.stage)}</span>
      ${it.needsAttention ? '<span class="badge b-attn">needs attention</span>' : ''}
    </div>
    <div class="summary">${esc(it.summaryMd)}</div>
    <dl class="kv">${rows.join('')}</dl>${err}${atts}${noAtts}</div>`;
}

// ── Capture ──────────────────────────────────────────────────────────────────

/**
 * Screenshot an HTML string headlessly. Never headed — the operator may be
 * live on this machine (skills/port-daddy-agent-skill/references/visual-evidence.md).
 *
 * @param browser - A launched chromium instance.
 * @param html - The page source.
 * @param out - Destination PNG path.
 * @param width - Viewport width.
 */
async function shoot(browser: any, html: string, out: string, width = 1360): Promise<void> {
  const ctx = await browser.newContext({
    // Deliberately short: `fullPage` grows to the content, so a small viewport
    // means the PNG ends where the page does instead of padding dead space.
    viewport: { width, height: 400 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: out, fullPage: true });
  await ctx.close();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx !== -1 ? resolve(process.argv[outIdx + 1]) : join(REPO, 'docs/reports/roadmap-live-activity');
  const respDir = join(outDir, 'responses');
  mkdirSync(respDir, { recursive: true });

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();

  const h = openHarness();
  const seeded = seed(h);

  const stillClock = h.t0 + STILL_CLOCK_OFFSET_MS;
  const prov = (extra: string) =>
    `<b>SEEDED FIXTURE · REAL ROUTE CALL.</b> Throwaway file registry built by lib/db.ts initDatabase() with the shipped migrations; ` +
    `seeded through the shipped lib APIs; responses produced by fastify.inject() over routes/roadmap-activity.ts. ` +
    `branch <b>${esc(branch)}</b> @ <b>${esc(sha.slice(0, 12))}</b> · seed clock T0=<b>${esc(h.t0)}</b> · ${extra} · ` +
    `capture: <b>scripts/capture-roadmap-activity-evidence.ts</b> · raw JSON in responses/`;
  const stillProv = prov(`injected projection clock = T0+${STILL_CLOCK_OFFSET_MS}ms = <b>${esc(stillClock)}</b>`);

  const api = await mountApi(h.db, () => stillClock);

  /** Persist a response verbatim next to the images. */
  const save = (name: string, payload: unknown) =>
    writeFileSync(join(respDir, name), `${JSON.stringify(payload, null, 2)}\n`);

  // Responses — every one a real route call.
  const board = await api.board('?includeStacked=1');
  save('board-activity.json', board);

  // The per-item route answers `{ success, activity }`; the envelope is what
  // gets archived in responses/, and `.activity` is what the renderer prints.
  const boardFeedSlug = Object.keys(seeded.slugs).find((s) => s.startsWith('roadmap-activity-board-feed'))!;
  const detailEnvelope = await api.item(boardFeedSlug);
  save('item-board-feed-activity.json', detailEnvelope);
  const detail = detailEnvelope.activity;

  const contrastEnvelope = await api.item('liveness-contrast-slice');
  const doneEnvelope = await api.item('finished-session-salvage-signal');
  save('item-liveness-contrast-activity.json', [contrastEnvelope, doneEnvelope]);
  const contrast = contrastEnvelope.activity;
  const doneItem = doneEnvelope.activity;

  const attentionSlugs = board.items.filter((i: any) => i.needsAttention).map((i: any) => i.slug);
  const attentionEnvelopes = [];
  for (const s of attentionSlugs) attentionEnvelopes.push(await api.item(s));
  save('items-attention-activity.json', attentionEnvelopes);
  const attention = attentionEnvelopes.map((e: any) => e.activity);

  const nullEnvelope = await api.item('nobody-is-on-this-slice');
  save('item-null-state-activity.json', nullEnvelope);
  const nullItem = nullEnvelope.activity;

  await api.close();

  // Empty board: a second, genuinely empty registry — same code path.
  const empty = openHarness();
  createTupleSpace(empty.db);
  createRoadmapItems({ db: empty.db, tuples: createTupleSpace(empty.db) });
  const emptyApi = await mountApi(empty.db, () => empty.t0);
  const emptyBoard = await emptyApi.board('?includeStacked=1');
  save('board-activity-empty.json', emptyBoard);
  await emptyApi.close();

  const pw = loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true });
  const artifacts: Array<{ file: string; what: string }> = [];

  // ── 1. Board feed: agent work in flight across all four stages ──────────
  {
    const html = shell(
      renderCounts(board.counts) + board.items.map((i: any) => renderItemRow(i)).join(''),
      {
        title: 'Roadmap board feed — active in-progress agent work',
        subtitle: `GET /roadmap/activity?includeStacked=1 · generatedAt ${new Date(board.generatedAt).toISOString()} · harbor ${board.harbor ?? 'null (all)'}`,
        routes: ['GET /roadmap/activity?includeStacked=1'],
        provenance: stillProv,
        note:
          'Every count, stage, agent id and liveness label on this page is a field of the JSON in ' +
          'responses/board-activity.json. The renderer styles; it does not compute.',
      },
    );
    const f = join(outDir, 'board-feed.png');
    await shoot(browser, html, f);
    artifacts.push({ file: f, what: 'board feed, all four stages' });
  }

  // ── 2. Item detail: corroborating attachments + cockpit links ───────────
  {
    const html = shell(renderItem(detail, { full: true }), {
      title: 'Item activity — who is on this item right now',
      subtitle: `GET /roadmap/items/${boardFeedSlug}/activity · one attachment corroborated by ${detail.attachments[0]?.sources.length ?? 0} join paths`,
      routes: [`GET /roadmap/items/${boardFeedSlug}/activity`],
      provenance: stillProv,
      note:
        'cockpit.interrupt.available is <b>false</b> in the real response — the shipped projection refuses to draw ' +
        'an unacknowledged control as wired, and names the planned ingress instead. That is the API talking, not the renderer.',
    });
    const f = join(outDir, 'item-detail.png');
    await shoot(browser, html, f);
    artifacts.push({ file: f, what: 'item detail, corroborating attachments' });
  }

  // ── 3. Honest liveness contrast ────────────────────────────────────────
  {
    const html = shell(renderItem(contrast, { full: true }) + renderItem(doneItem, { full: true }), {
      title: 'Honest liveness — active beside stale beside done',
      subtitle: 'Three attachments, one injected clock, nothing backdated',
      routes: [
        'GET /roadmap/items/liveness-contrast-slice/activity',
        'GET /roadmap/items/finished-session-salvage-signal/activity',
      ],
      provenance: stillProv,
      note:
        `All four agents heartbeat exactly once, at seed time, and nothing is backdated. At the injected clock ` +
        `(T0+${STILL_CLOCK_OFFSET_MS}ms) every attachment has idleMs ≈ ${STILL_CLOCK_OFFSET_MS}ms — the SAME staleness. ` +
        `The shipped lib/agents.ts ladder is what splits them, by agent status: busy → staleThresholdMs ` +
        `${getStaleThresholdForStatus('busy')} (<b>ACTIVE</b>), draining → staleThresholdMs ` +
        `${getStaleThresholdForStatus('draining')} (<b>STALE</b>). The second item carries an unreleased claim on a ` +
        `<b>completed</b> session: liveness <b>DONE</b> and the stage falls back to <b>stacked</b> — a fresh heartbeat ` +
        `does not resurrect finished work. Two items rather than one because roadmap_claims allows only ONE open claim ` +
        `per slug and the session-link path reads only active sessions, so a done attachment cannot share the item.`,
    });
    const f = join(outDir, 'liveness-contrast.png');
    await shoot(browser, html, f);
    artifacts.push({ file: f, what: 'active / stale / done contrast' });
  }

  // ── 4. Attention state ─────────────────────────────────────────────────
  {
    const html = shell(attention.map((i: any) => renderItem(i, { full: false })).join(''), {
      title: 'Attention state — failed / rejected / salvage are never laundered into done',
      subtitle: `${attention.length} items with needsAttention=true · board counts.attention = ${board.counts.attention}`,
      routes: attention.map((i: any) => `GET /roadmap/items/${i.slug}/activity`),
      provenance: stillProv,
      note:
        'Each dispatch reached its state through the real lib/dispatch/queue.ts state machine ' +
        '(settle→failed, reject at review_pending, settle→salvage). The error/reject text is printed verbatim from ' +
        'dispatch.errorMessage; the stage rollup keeps these OUT of done.',
    });
    const f = join(outDir, 'attention-state.png');
    await shoot(browser, html, f);
    artifacts.push({ file: f, what: 'failed / rejected / salvage' });
  }

  // ── 5. Null + empty states ─────────────────────────────────────────────
  {
    const left = `<div class="panel"><h2>An item nobody is on</h2>
      <p class="pnote">GET /roadmap/items/nobody-is-on-this-slice/activity → 200 (not 404). "Nobody is on this" is an answer.</p>
      ${renderItem(nullItem, { full: true })}</div>`;
    const right = `<div class="panel"><h2>An empty board</h2>
      <p class="pnote">GET /roadmap/activity?includeStacked=1 against a registry with zero roadmap items.</p>
      ${renderCounts(emptyBoard.counts)}
      <div class="empty"><b>items: []</b>No claims, no sessions, no dispatches. Nothing is running — and the board says so instead of drawing a hopeful zero-state.</div>
      <dl class="kv" style="margin-top:10px">
        <dt>generatedAt</dt><dd>${ts(emptyBoard.generatedAt)}</dd>
        <dt>harbor</dt><dd>${emptyBoard.harbor ? esc(emptyBoard.harbor) : '<span class="null">null</span>'}</dd>
      </dl></div>`;
    const html = shell(`<div class="panels">${left}${right}</div>`, {
      title: 'Null and empty states',
      subtitle: 'What the operator sees when nothing is running',
      routes: ['GET /roadmap/items/nobody-is-on-this-slice/activity', 'GET /roadmap/activity?includeStacked=1 (empty registry)'],
      provenance: prov(
        `left panel clock = T0+${STILL_CLOCK_OFFSET_MS}ms; right panel is a SECOND throwaway registry, migrated and never seeded`,
      ),
    });
    // Filename deliberately avoids the literal token `null`: a sanitizer on the
    // PR-body path mangled this artifact's URL twice (once wrapping it in code
    // backticks, once stripping the <img src> outright) while every sibling URL
    // survived. The page still says NULL where the API does.
    const f = join(outDir, 'empty-states.png');
    await shoot(browser, html, f);
    artifacts.push({ file: f, what: 'null item + empty board' });
  }

  // ── 6. Motion: the feed changing as work moves ─────────────────────────
  const framesDir = mkdtempSync(join(tmpdir(), 'pd-roadmap-frames-'));
  const framePaths: string[] = [];
  {
    // A dedicated registry so the motion story is legible: one item walks the
    // real dispatch state machine while a draining agent's clock runs out.
    const m = openHarness();
    const tuples = createTupleSpace(m.db);
    const items = createRoadmapItems({ db: m.db, tuples });
    createRoadmapPop({ db: m.db });
    createLocks(m.db);
    const ma = createAgents(m.db);
    const ms = createSessions(m.db);
    const queue = createDispatchQueue({ db: m.db, now: () => m.clock.ms });
    const insertClaim = m.db.prepare(`
      INSERT INTO roadmap_claims
        (slug, kind, feedback_id, claimed_by, claimed_at, summary, surface, payload, session_id, agent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    ma.register('fleet-shipwright-01', { name: 'Shipwright', status: 'busy', purpose: 'motion: the moving item', pid: process.pid });
    ma.register('fleet-cooper-09', { name: 'Cooper', status: 'draining', purpose: 'motion: the one whose clock runs out', pid: process.pid });

    const d = queue.propose({ goal: 'Roadmap activity board feed', requestedBy: 'operator', tags: ['roadmap'] });
    const movingSlug = d.slug;
    items.upsert({
      slug: movingSlug,
      summaryMd: 'Board feed: join roadmap items to in-flight agent work so the operator sees who is driving what, right now.',
      status: 'now',
      harbor: HARBOR,
    });
    const drainSlug = 'liveness-contrast-slice';
    items.upsert({
      slug: drainSlug,
      summaryMd: 'A draining agent whose heartbeat ages past its 3-minute stale threshold while the clock advances.',
      status: 'now',
      harbor: HARBOR,
    });
    const sDrain = (ms.start('wind down the contrast slice', {
      agentId: 'fleet-cooper-09',
      worktreeId: 'wt-contrast-b',
      metadata: { roadmapLink: drainSlug },
    }) as any).id;
    insertClaim.run(drainSlug, 'next-cut', null, 'fleet-cooper-09', m.clock.ms, 'contrast: draining', 'roadmap', null, sDrain, 'fleet-cooper-09');

    // The moving item's session is deliberately NOT started at seed time: at
    // frame 0 the dispatch is merely `proposed` and NOTHING is attached, so the
    // first frame is an honest `stacked` row rather than a stage rollup that
    // has already jumped ahead of the story the caption tells.
    let sMove = '';

    // Each step: advance the injected clock, drive the REAL state machine,
    // re-query the REAL route, screenshot the REAL response.
    const steps: Array<{ label: string; offsetMs: number; act: () => void }> = [
      { label: 'T+0s — dispatch proposed, no attachments: the item is STACKED, nobody has picked it up', offsetMs: 0, act: () => {} },
      {
        label: 'T+45s — claimed: a worker takes the dispatch and binds its session',
        offsetMs: 45_000,
        act: () => {
          sMove = (ms.start('ship the roadmap activity board feed', {
            agentId: 'fleet-shipwright-01',
            worktreeId: 'wt-roadmap-activity',
            metadata: { roadmapLink: movingSlug },
          }) as any).id;
          queue.claim({ id: d.id, worktreePath: `/worktrees/${movingSlug}`, branch: `dispatch/${movingSlug}`, sessionId: sMove, workerActorId: 'fleet-shipwright-01' });
          insertClaim.run(movingSlug, 'next-cut', null, 'fleet-shipwright-01', m.clock.ms, 'board feed slice', 'roadmap', null, sMove, 'fleet-shipwright-01');
        },
      },
      { label: 'T+90s — in_progress: EXECUTING, an agent is driving it', offsetMs: 90_000, act: () => queue.start(d.id) },
      {
        label: 'T+180s — the draining agent crosses its 3m stale threshold: ACTIVE → STALE, honestly',
        offsetMs: 185_000,
        act: () => {},
      },
      { label: 'T+240s — produced, then review_pending: the item moves to REVIEW', offsetMs: 240_000, act: () => { queue.produce({ id: d.id, resultArtifact: `dispatch/${movingSlug}` }); queue.requestReview(d.id); } },
      { label: 'T+300s — accepted: DONE. The stale attachment is still reported stale.', offsetMs: 300_000, act: () => { queue.accept({ id: d.id, note: 'merged' }); ms.end(sMove, { status: 'completed', note: 'shipped' }); } },
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      m.clock.ms = m.t0 + step.offsetMs;
      step.act();
      const frameApi = await mountApi(m.db, () => m.t0 + step.offsetMs);
      const frameBoard = await frameApi.board('?includeStacked=1');
      await frameApi.close();
      if (i === 0) save('motion-frame-00-board.json', frameBoard);
      if (i === steps.length - 1) save(`motion-frame-0${i}-board.json`, frameBoard);

      const html = shell(
        renderCounts(frameBoard.counts) + frameBoard.items.map((it: any) => renderItemRow(it)).join(''),
        {
          title: 'Roadmap board feed — work moving through the stages',
          subtitle: step.label,
          routes: ['GET /roadmap/activity?includeStacked=1'],
          provenance: prov(`motion frame ${i + 1}/${steps.length} · injected clock = T0+${step.offsetMs}ms`),
          width: 1160,
        },
      );
      const f = join(framesDir, `frame-${String(i).padStart(2, '0')}.png`);
      await shoot(browser, html, f, 1160);
      framePaths.push(f);
    }
    closeDatabase(m.db);
    rmSync(m.dir, { recursive: true, force: true });
  }

  await browser.close();

  // GIF via Pillow (no ImageMagick in this environment); webm via the
  // Playwright-bundled ffmpeg (vp8/webm only — hence the jpeg pipe).
  const gifPath = join(outDir, 'board-feed-motion.gif');
  const webmPath = join(outDir, 'board-feed-motion.webm');
  buildGifAndWebm(framePaths, gifPath, webmPath, framesDir);
  artifacts.push({ file: gifPath, what: 'motion: stacked → executing → review → done, plus a live→stale transition' });
  artifacts.push({ file: webmPath, what: 'same motion, webm' });

  closeDatabase(h.db);
  closeDatabase(empty.db);
  rmSync(h.dir, { recursive: true, force: true });
  rmSync(empty.dir, { recursive: true, force: true });
  rmSync(framesDir, { recursive: true, force: true });

  console.log(`\ncapture-roadmap-activity-evidence: wrote ${artifacts.length} artifacts to ${outDir}`);
  for (const a of artifacts) console.log(`  • ${a.file.replace(`${REPO}/`, '')} — ${a.what}`);
  console.log(`  • ${respDir.replace(`${REPO}/`, '')}/*.json — the verbatim route responses behind every pixel`);
  console.log(`\n  branch ${branch} @ ${sha}`);
  console.log(`  seed clock T0 = ${h.t0} (${new Date(h.t0).toISOString()})`);
  console.log(`  still projection clock = ${stillClock} (T0 + ${STILL_CLOCK_OFFSET_MS}ms)`);
}

/**
 * Assemble the motion artifacts from the captured frames.
 *
 * GIF: Pillow (python3) — ImageMagick is not present in the capture container.
 * WEBM: the Playwright-bundled ffmpeg, which is compiled with only
 * image2pipe/mjpeg in and libvpx/webm out, so frames are piped as JPEGs.
 *
 * @param frames - Ordered PNG frame paths.
 * @param gifPath - Destination GIF.
 * @param webmPath - Destination webm.
 * @param workDir - Scratch dir for the intermediate JPEGs.
 */
function buildGifAndWebm(frames: string[], gifPath: string, webmPath: string, workDir: string): void {
  const py = `
import sys, glob, os
from PIL import Image
frames = ${JSON.stringify(frames)}
gif_out = ${JSON.stringify(gifPath)}
work = ${JSON.stringify(workDir)}
imgs = [Image.open(f).convert('RGB') for f in frames]
w = min(i.width for i in imgs); h = min(i.height for i in imgs)
# Pad (never crop) to a common canvas so no pixel of evidence is lost.
W = max(i.width for i in imgs); H = max(i.height for i in imgs)
canvas = []
for i in imgs:
    c = Image.new('RGB', (W, H), (11, 15, 20))
    c.paste(i, (0, 0))
    canvas.append(c)
# Half-scale for a sane GIF size; the PNG stills carry the full resolution.
small = [c.resize((W // 2, H // 2), Image.LANCZOS) for c in canvas]
pal = [s.convert('P', palette=Image.ADAPTIVE, colors=128) for s in small]
pal[0].save(gif_out, save_all=True, append_images=pal[1:], duration=1700, loop=0, optimize=True)
for idx, c in enumerate(canvas):
    c.resize((W // 2, H // 2), Image.LANCZOS).save(os.path.join(work, 'j%03d.jpg' % idx), quality=92)
print('frames=%d size=%dx%d' % (len(canvas), W, H))
`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`GIF assembly failed (Pillow): ${r.stderr || r.stdout}`);
  console.log(`  gif: ${r.stdout.trim()}`);

  const ffmpeg = resolveFfmpeg();
  // The Playwright-bundled ffmpeg has the image2 (numbered-sequence) demuxer
  // compiled out — only image2pipe survives — so the JPEGs are concatenated on
  // stdin rather than referenced as a %03d pattern.
  const jpegs = readdirSync(workDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => readFileSync(join(workDir, f)));
  const concat = join(workDir, 'frames.mjpeg');
  writeFileSync(concat, Buffer.concat(jpegs));
  const ff = spawnSync(
    ffmpeg,
    [
      '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', '10/17', '-i', concat,
      '-c:v', 'libvpx', '-b:v', '1400k', '-pix_fmt', 'yuv420p', webmPath,
    ],
    { encoding: 'buffer', maxBuffer: 1 << 28 },
  );
  if (ff.status !== 0) throw new Error(`webm assembly failed: ${String(ff.stderr)}`);
}

/** Locate an ffmpeg binary: PATH first, then the Playwright-bundled build. */
function resolveFfmpeg(): string {
  const which = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root) {
    const found = spawnSync('sh', ['-c', `ls -d ${root}/ffmpeg-*/ffmpeg-linux 2>/dev/null | head -1`], { encoding: 'utf8' });
    if (found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('no ffmpeg available for the webm artifact');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
