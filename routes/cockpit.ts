/**
 * Cockpit Routes — App-Native Development Cockpit intake surface.
 *
 * GET  /cockpit/missions                — work queue from roadmap markdown
 * GET  /cockpit/missions/:id            — single card + live coordination cross-ref
 * POST /cockpit/missions/:id/plan       — Sortie proposal stub for the operator
 *
 * The detail and plan routes do not mutate. They synthesize a view by
 * joining the parsed mission card against active sessions, file claims,
 * salvage queue, and dogfood feedback. Sortie row creation stays explicit:
 * the operator (or a later cockpit launch slice) POSTs the returned proposal
 * to /sorties when they're ready.
 */

import { basename, join, resolve, sep } from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { readMissions, MISSION_STATUSES, type MissionCard, type MissionIntake, type MissionStatus } from '../lib/cockpit-missions.js';
import type { RoadmapItems } from '../lib/roadmap-items.js';
import { validateProjectRoot } from '../lib/utils.js';

function deriveProjectName(projectDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(`${projectDir}/package.json`, 'utf8')) as { name?: string };
    if (pkg.name && typeof pkg.name === 'string') return pkg.name.trim();
  } catch {
    // fall through to basename
  }
  return basename(projectDir);
}

interface SessionsDep {
  list(options?: {
    status?: string;
    project?: string;
    allWorktrees?: boolean;
    limit?: number;
  }): unknown;
  listAllActiveClaims(options?: {
    path?: string;
    agentId?: string;
    purpose?: string;
  }): unknown;
}

interface ResurrectionDep {
  pending(options?: { project?: string; stack?: string }): unknown;
}

interface FeedbackDep {
  list(options?: { harbor?: string; status?: string; limit?: number }): unknown;
}

interface CockpitDeps {
  repoRoot?: string;
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  sessions?: SessionsDep;
  resurrection?: ResurrectionDep;
  feedback?: FeedbackDep;
  roadmapItems?: RoadmapItems;
}

const ALLOWED_STATUSES: ReadonlySet<MissionStatus> = new Set<MissionStatus>(MISSION_STATUSES);

const ALLOWED_BACKENDS: ReadonlySet<string> = new Set([
  'codex',
  'claude',
  'claude-cli',
  'gemini',
  'aider',
  'ollama',
  'cloudflare',
  'custom',
]);

const ALLOWED_TIERS: ReadonlySet<string> = new Set(['low', 'mid', 'high']);

function parseStatusFilter(raw: unknown): MissionStatus[] | undefined {
  if (typeof raw !== 'string') return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const valid: MissionStatus[] = [];
  for (const p of parts) {
    if (ALLOWED_STATUSES.has(p as MissionStatus)) valid.push(p as MissionStatus);
  }
  return valid.length > 0 ? valid : undefined;
}

function parseLimit(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function pathContainsAny(haystack: string, needles: ReadonlyArray<string>): boolean {
  if (!haystack || needles.length === 0) return false;
  for (const n of needles) {
    if (n && haystack.includes(n)) return true;
  }
  return false;
}

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const key of ['claims', 'sessions', 'agents', 'entries', 'items']) {
      const v = (raw as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

// The mtime-keyed cache that lived here before Slice C cached the
// markdown-parser output. roadmap_items.list() is a cheap tuple-fold
// already, so a parallel cockpit-side cache would just be stale layer
// duplication. If profiling shows list() hot, add caching inside
// lib/roadmap-items.ts where it can invalidate on tuple writes for free.

function findMissionById(
  deps: CockpitDeps,
  projectDir: string,
  id: string,
): MissionCard | null {
  if (!deps.roadmapItems) return null;
  const intake = readMissions({ projectDir, roadmapItems: deps.roadmapItems });
  return intake.missions.find((m) => m.id === id) ?? null;
}

function buildLiveContext(deps: CockpitDeps, mission: MissionCard, projectDir: string) {
  const files = mission.files;
  const sessionList = deps.sessions
    ? asArray(deps.sessions.list({ status: 'active', allWorktrees: true, limit: 200 }))
    : [];
  const matchedSessions = sessionList.filter((row) => {
    const r = row as Record<string, unknown>;
    const purpose = String(r.purpose ?? '');
    const project = String(r.project ?? r.project_dir ?? '');
    return (
      (purpose && (pathContainsAny(purpose, files) || purpose.toLowerCase().includes(mission.id))) ||
      (project && project.includes(projectDir))
    );
  });

  const claimList = deps.sessions
    ? asArray(deps.sessions.listAllActiveClaims())
    : [];
  const matchedClaims = claimList.filter((row) => {
    const r = row as Record<string, unknown>;
    const filePath = String(r.filePath ?? r.file_path ?? '');
    return filePath && pathContainsAny(filePath, files);
  });

  const salvageList = deps.resurrection
    ? asArray(deps.resurrection.pending({ project: deriveProjectName(projectDir) }))
    : [];
  const matchedSalvage = salvageList.filter((row) => {
    const r = row as Record<string, unknown>;
    const purpose = String(r.purpose ?? r.identity_purpose ?? '');
    const noteSummary = String(r.note ?? r.last_note ?? r.summary ?? '');
    const blob = `${purpose}\n${noteSummary}`;
    return pathContainsAny(blob, files) || (mission.id && blob.toLowerCase().includes(mission.id));
  });

  const projectName = deriveProjectName(projectDir);
  const dogfoodList = deps.feedback
    ? asArray(deps.feedback.list({ harbor: `${projectName}:fleet`, status: 'open', limit: 50 }))
    : [];
  const matchedDogfood = dogfoodList.filter((row) => {
    const r = row as Record<string, unknown>;
    const slug = String(r.slug ?? '');
    const summary = String(r.summary ?? '');
    return (
      (slug && (slug === mission.id || mission.id.includes(slug) || slug.includes(mission.id))) ||
      pathContainsAny(`${slug}\n${summary}`, files)
    );
  });

  return {
    sessions: matchedSessions,
    claims: matchedClaims,
    salvage: matchedSalvage,
    dogfood: matchedDogfood,
  };
}

interface PlanProposal {
  missionId: string;
  projectDir: string;
  harbor: string;
  goal: string;
  expectedOutput: string;
  context: string;
  backend: string;
  modelTier: 'low' | 'mid' | 'high';
  budgetUsd: number;
  files: string[];
  source: string;
  sourceAnchor: string;
  evidence: string[];
}

interface PlanOverrides {
  goal?: string;
  expectedOutput?: string;
  backend?: string;
  modelTier?: 'low' | 'mid' | 'high';
  budgetUsd?: number;
}

function buildProposal(
  mission: MissionCard,
  projectDir: string,
  overrides: PlanOverrides,
): PlanProposal {
  const goal = overrides.goal?.trim()
    ? overrides.goal.trim()
    : mission.summary
      ? `${mission.title}\n\n${mission.summary}`
      : mission.title;

  const evidenceText = mission.evidence.length > 0
    ? mission.evidence.map((e) => `- ${e}`).join('\n')
    : 'No structured evidence parsed from the source heading.';

  const expectedOutput = overrides.expectedOutput?.trim()
    ? overrides.expectedOutput.trim()
    : `Concrete diff against ${mission.files.length > 0 ? mission.files.join(', ') : 'the relevant files'} ` +
      `that resolves the mission and is committed via Coordination Guard.`;

  const backend = overrides.backend ?? 'codex';
  const modelTier = overrides.modelTier ?? 'mid';
  const budgetUsd = typeof overrides.budgetUsd === 'number' ? overrides.budgetUsd : 1.0;

  return {
    missionId: mission.id,
    projectDir,
    harbor: 'cockpit',
    goal,
    expectedOutput,
    context:
      `Mission "${mission.title}" sourced from ${mission.source}${mission.sourceAnchor}.\n` +
      `Status: ${mission.status}.\n\nEvidence:\n${evidenceText}`,
    backend,
    modelTier,
    budgetUsd,
    files: mission.files,
    source: mission.source,
    sourceAnchor: mission.sourceAnchor,
    evidence: mission.evidence,
  };
}

function validateOverrides(body: unknown): { overrides: PlanOverrides } | { error: string } {
  if (body == null) return { overrides: {} };
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  const overrides: PlanOverrides = {};

  if (b.goal !== undefined) {
    if (typeof b.goal !== 'string') return { error: 'goal must be a string' };
    overrides.goal = b.goal;
  }
  if (b.expectedOutput !== undefined) {
    if (typeof b.expectedOutput !== 'string') return { error: 'expectedOutput must be a string' };
    overrides.expectedOutput = b.expectedOutput;
  }
  if (b.backend !== undefined) {
    if (typeof b.backend !== 'string' || !ALLOWED_BACKENDS.has(b.backend)) {
      return { error: `backend must be one of ${[...ALLOWED_BACKENDS].join(', ')}` };
    }
    overrides.backend = b.backend;
  }
  if (b.modelTier !== undefined) {
    if (typeof b.modelTier !== 'string' || !ALLOWED_TIERS.has(b.modelTier)) {
      return { error: 'modelTier must be one of low, mid, high' };
    }
    overrides.modelTier = b.modelTier as 'low' | 'mid' | 'high';
  }
  if (b.budgetUsd !== undefined) {
    if (typeof b.budgetUsd !== 'number' || !Number.isFinite(b.budgetUsd) || b.budgetUsd <= 0) {
      return { error: 'budgetUsd must be a positive number' };
    }
    overrides.budgetUsd = b.budgetUsd;
  }
  return { overrides };
}

function resolveProjectDir(q: Record<string, unknown>, fallback?: string): string | null {
  const raw = typeof q.projectDir === 'string' && q.projectDir.trim() ? q.projectDir : fallback;
  return raw ?? null;
}

export const cockpitPlugin: FastifyPluginAsync<{ deps: CockpitDeps }> = async (fastify, opts) => {
  const deps = opts.deps;
  const { repoRoot, metrics, logger } = deps;

  fastify.get('/cockpit/missions', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    const projectDir = resolveProjectDir(q, repoRoot);
    if (!projectDir) {
      reply.code(400);
      return { success: false, error: 'projectDir required (no daemon repoRoot configured)' };
    }

    const validation = validateProjectRoot(projectDir);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    const status = parseStatusFilter(q.status);
    const limit = parseLimit(q.limit);

    if (!deps.roadmapItems) {
      reply.code(503);
      return { success: false, error: 'roadmap_items module not wired into daemon deps' };
    }

    try {
      const intake = readMissions({
        projectDir,
        roadmapItems: deps.roadmapItems,
        status,
        limit,
      });
      return { success: true, intake, count: intake.missions.length };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_missions_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/cockpit/missions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, unknown>;
    const id = typeof params.id === 'string' ? params.id : '';
    if (!id) {
      reply.code(400);
      return { success: false, error: 'mission id required' };
    }

    const q = (request.query as Record<string, unknown>) ?? {};
    const projectDir = resolveProjectDir(q, repoRoot);
    if (!projectDir) {
      reply.code(400);
      return { success: false, error: 'projectDir required (no daemon repoRoot configured)' };
    }
    const validation = validateProjectRoot(projectDir);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    try {
      const mission = findMissionById(deps, projectDir, id);
      if (!mission) {
        reply.code(404);
        return { success: false, error: `mission '${id}' not found` };
      }
      const live = buildLiveContext(deps, mission, projectDir);
      return { success: true, mission, live };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_mission_detail_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // -----------------------------------------------------------------------
  // Triage endpoints — surface gardener triage runs to the cockpit page.
  //
  // Data plane is file-backed for v1 to avoid a schema change while the
  // 3.16 daemon-cleanup agent is in flight:
  //   - Runs live in docs/recovery/<date>-gardener-triage/
  //   - Decisions append to ~/.port-daddy/cockpit-triage-decisions.jsonl
  //
  // Promotion to a worktree_triage SQLite table is tracked separately
  // (memory: triage-taxonomy-in-pd-db, gated on pd backup PR #157).
  // -----------------------------------------------------------------------
  const DECISIONS_DIR = join(homedir(), '.port-daddy');
  const DECISIONS_FILE = join(DECISIONS_DIR, 'cockpit-triage-decisions.jsonl');

  function listTriageRuns(projectDir: string): Array<{ id: string; date: string; itemCount?: number; hitlCount?: number; counts?: Record<string, number> }> {
    const root = join(projectDir, 'docs', 'recovery');
    if (!existsSync(root)) return [];
    const runs: Array<{ id: string; date: string; itemCount?: number; hitlCount?: number; counts?: Record<string, number> }> = [];
    for (const name of readdirSync(root)) {
      if (!name.endsWith('-gardener-triage')) continue;
      const runPath = join(root, name);
      let stat;
      try { stat = statSync(runPath); } catch { continue; }
      if (!stat.isDirectory()) continue;
      const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(name);
      const date = dateMatch ? dateMatch[1] : '';
      // Try to read summary from raw/classified.json
      let itemCount: number | undefined;
      let hitlCount: number | undefined;
      let counts: Record<string, number> | undefined;
      try {
        const classifiedPath = join(runPath, 'raw', 'classified.json');
        if (existsSync(classifiedPath)) {
          const data = JSON.parse(readFileSync(classifiedPath, 'utf8')) as { total?: number; hitl_count?: number; counts?: Record<string, number> };
          itemCount = data.total;
          hitlCount = data.hitl_count;
          counts = data.counts;
        }
      } catch { /* skip metadata */ }
      // Do NOT include the absolute filesystem path in the client-facing payload
      runs.push({ id: name, date, itemCount, hitlCount, counts });
    }
    runs.sort((a, b) => b.id.localeCompare(a.id)); // newest first
    return runs;
  }

  function readTriageRun(projectDir: string, runId: string): { items: unknown[]; counts: Record<string, number>; total: number; hitl_count: number } | null {
    // Allowlist: alphanumeric + `-` + `_`. Explicitly NO `.` (so `..` cannot slip in)
    // and reject any `..` regardless. Containment is anchored to a HARDCODED root
    // (docs/recovery/), never to a path that incorporates the untrusted runId.
    if (!/^[a-zA-Z0-9\-_]+$/.test(runId) || runId.includes('..')) return null;
    const trustedRoot = resolve(join(projectDir, 'docs', 'recovery'));
    const classifiedPath = resolve(join(trustedRoot, runId, 'raw', 'classified.json'));
    if (!classifiedPath.startsWith(trustedRoot + sep)) return null;
    if (!existsSync(classifiedPath)) return null;
    try {
      return JSON.parse(readFileSync(classifiedPath, 'utf8')) as { items: unknown[]; counts: Record<string, number>; total: number; hitl_count: number };
    } catch { return null; }
  }

  function readTriageDiff(projectDir: string, runId: string, safeName: string): string | null {
    if (!/^[a-zA-Z0-9\-_]+$/.test(runId) || runId.includes('..')) return null;
    // safeName may contain dots (e.g. "release--v3.15.0") and parens (e.g. "(HEAD_detached_at_d5ca884c)").
    // Path containment is enforced by the resolve+startsWith check below, so
    // we only need to reject path separators and `..` segments.
    if (/[/\\]/.test(safeName) || safeName.includes('..')) return null;
    const trustedRoot = resolve(join(projectDir, 'docs', 'recovery'));
    const diffPath = resolve(join(trustedRoot, runId, 'diffs', safeName + '.diff'));
    if (!diffPath.startsWith(trustedRoot + sep)) return null;
    if (!existsSync(diffPath)) return null;
    try { return readFileSync(diffPath, 'utf8'); } catch { return null; }
  }

  function readDecisions(): Array<Record<string, unknown>> {
    if (!existsSync(DECISIONS_FILE)) return [];
    let raw: string;
    try { raw = readFileSync(DECISIONS_FILE, 'utf8'); } catch { return []; }
    // Parse line-by-line so a single malformed or truncated line doesn't wipe
    // the entire history; skip bad lines and continue.
    const results: Array<Record<string, unknown>> = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { results.push(JSON.parse(line) as Record<string, unknown>); }
      catch { /* skip malformed line */ }
    }
    return results;
  }

  function appendDecision(entry: Record<string, unknown>) {
    if (!existsSync(DECISIONS_DIR)) {
      try { mkdirSync(DECISIONS_DIR, { recursive: true }); } catch { /* ignore */ }
    }
    const line = JSON.stringify({ ...entry, ts: Date.now() }) + '\n';
    appendFileSync(DECISIONS_FILE, line);
  }

  fastify.get('/cockpit/triage/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    const projectDir = resolveProjectDir(q, repoRoot);
    if (!projectDir) { reply.code(400); return { success: false, error: 'projectDir required' }; }
    const v = validateProjectRoot(projectDir);
    if (!v.ok) { reply.code(400); return { success: false, error: v.error }; }
    try {
      return { success: true, runs: listTriageRuns(projectDir) };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_triage_runs_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/cockpit/triage/items', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    const projectDir = resolveProjectDir(q, repoRoot);
    if (!projectDir) { reply.code(400); return { success: false, error: 'projectDir required' }; }
    const v = validateProjectRoot(projectDir);
    if (!v.ok) { reply.code(400); return { success: false, error: v.error }; }
    const runId = typeof q.run === 'string' && q.run.trim() ? q.run : null;
    if (!runId) {
      const runs = listTriageRuns(projectDir);
      if (runs.length === 0) { reply.code(404); return { success: false, error: 'no triage runs found in docs/recovery/' }; }
      const data = readTriageRun(projectDir, runs[0].id);
      if (!data) { reply.code(500); return { success: false, error: 'failed to read latest run' }; }
      return { success: true, runId: runs[0].id, ...data };
    }
    const data = readTriageRun(projectDir, runId);
    if (!data) { reply.code(404); return { success: false, error: `triage run '${runId}' not found` }; }
    return { success: true, runId, ...data };
  });

  fastify.get<{ Params: { runId: string; safeName: string } }>(
    '/cockpit/triage/diff/:runId/:safeName',
    async (request, reply) => {
      const q = (request.query as Record<string, unknown>) ?? {};
      const projectDir = resolveProjectDir(q, repoRoot);
      if (!projectDir) { reply.code(400); return { success: false, error: 'projectDir required' }; }
      const v = validateProjectRoot(projectDir);
      if (!v.ok) { reply.code(400); return { success: false, error: v.error }; }
      const { runId, safeName } = request.params;
      const content = readTriageDiff(projectDir, runId, safeName);
      if (content == null) { reply.code(404); return { success: false, error: 'diff not found' }; }
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      return content;
    }
  );

  fastify.get('/cockpit/triage/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query as Record<string, unknown>) ?? {};
    const runId = typeof q.run === 'string' ? q.run : undefined;
    const all = readDecisions();
    const filtered = runId ? all.filter(d => d.runId === runId) : all;
    // Return latest decision per (runId, itemId).
    // Guard both fields: entries with non-string runId or itemId are skipped
    // so a malformed line can't produce an `undefined::undefined` key that
    // would shadow valid entries.
    const latest = new Map<string, Record<string, unknown>>();
    for (const d of filtered) {
      if (typeof d.runId !== 'string' || typeof d.itemId !== 'string') continue;
      const key = `${d.runId}::${d.itemId}`;
      latest.set(key, d);
    }
    return { success: true, decisions: Array.from(latest.values()) };
  });

  fastify.post('/cockpit/triage/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') { reply.code(400); return { success: false, error: 'body must be a JSON object' }; }
    const runId = typeof body.runId === 'string' ? body.runId : '';
    const itemId = typeof body.itemId === 'string' ? body.itemId : '';
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (!runId || !itemId || !decision) { reply.code(400); return { success: false, error: 'runId, itemId, decision required' }; }
    if (!['approved', 'rejected', 'modify', 'skip'].includes(decision)) {
      reply.code(400); return { success: false, error: 'decision must be approved | rejected | modify | skip' };
    }
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (decision === 'modify' && !reason) { reply.code(400); return { success: false, error: 'modify requires a reason' }; }
    const entry = {
      runId,
      itemId,
      decision,
      reason,
      cluster: typeof body.cluster === 'string' ? body.cluster : '',
      branch: typeof body.branch === 'string' ? body.branch : '',
      risk: typeof body.risk === 'string' ? body.risk : '',
      author: typeof body.author === 'string' ? body.author : 'operator',
    };
    try {
      appendDecision(entry);
      return { success: true, entry };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_triage_decision_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'failed to persist decision' };
    }
  });

  fastify.post('/cockpit/missions/:id/plan', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, unknown>;
    const id = typeof params.id === 'string' ? params.id : '';
    if (!id) {
      reply.code(400);
      return { success: false, error: 'mission id required' };
    }

    const q = (request.query as Record<string, unknown>) ?? {};
    const projectDir = resolveProjectDir(q, repoRoot);
    if (!projectDir) {
      reply.code(400);
      return { success: false, error: 'projectDir required (no daemon repoRoot configured)' };
    }
    const validation = validateProjectRoot(projectDir);
    if (!validation.ok) {
      reply.code(400);
      return { success: false, error: validation.error };
    }

    const overridesResult = validateOverrides(request.body);
    if ('error' in overridesResult) {
      reply.code(400);
      return { success: false, error: overridesResult.error };
    }

    try {
      const mission = findMissionById(deps, projectDir, id);
      if (!mission) {
        reply.code(404);
        return { success: false, error: `mission '${id}' not found` };
      }
      const proposal = buildProposal(mission, projectDir, overridesResult.overrides);
      return { success: true, proposal };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_mission_plan_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
