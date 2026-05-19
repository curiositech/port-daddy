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

import { basename } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { readMissions, type MissionCard, type MissionIntake, type MissionStatus } from '../lib/cockpit-missions.js';
import type { CockpitMissionStateModule, MissionState } from '../lib/cockpit-mission-state.js';
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
  cockpitMissionState?: CockpitMissionStateModule;
}

export interface MissionWithState extends MissionCard {
  state: MissionState | null;
}

function attachState(
  missions: MissionCard[],
  projectDir: string,
  module?: CockpitMissionStateModule,
): MissionWithState[] {
  if (!module) return missions.map((m) => ({ ...m, state: null }));
  const stateMap = module.listForProject(projectDir);
  return missions.map((m) => ({ ...m, state: stateMap.get(m.id) ?? null }));
}

const ALLOWED_STATUSES: ReadonlySet<MissionStatus> = new Set<MissionStatus>([
  'closed',
  'blocked',
  'drifting',
  'stalled',
  'mostly-resolved',
  'mostly-committed',
  'uncommitted',
  'in-flight',
  'unknown',
]);

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

// Per-process memo for readMissions, keyed on projectDir and invalidated
// when any of the three default source files' mtime/size changes. The
// detail/plan routes can be polled aggressively; without a cache, every
// request re-parsed all three roadmap markdown files synchronously. Cost
// of the cache is one statSync per source per request.
const DEFAULT_SOURCE_PATHS: ReadonlyArray<string> = [
  'docs/recovery/CURRENT-WORK.md',
  'docs/recovery/UNIFIED-ROADMAP.md',
  '.cartographer/status.md',
];

interface MissionCacheEntry {
  fingerprint: string;
  intake: MissionIntake;
}

const missionCache = new Map<string, MissionCacheEntry>();

function sourceFingerprint(projectDir: string): string {
  const parts: string[] = [];
  for (const rel of DEFAULT_SOURCE_PATHS) {
    try {
      const s = statSync(`${projectDir}/${rel}`);
      parts.push(`${rel}:${s.mtimeMs}:${s.size}`);
    } catch {
      parts.push(`${rel}:missing`);
    }
  }
  return parts.join('|');
}

function readMissionsCached(projectDir: string): MissionIntake {
  const fingerprint = sourceFingerprint(projectDir);
  const hit = missionCache.get(projectDir);
  if (hit && hit.fingerprint === fingerprint) return hit.intake;
  const intake = readMissions({ projectDir });
  missionCache.set(projectDir, { fingerprint, intake });
  return intake;
}

function findMissionById(projectDir: string, id: string): MissionCard | null {
  const intake = readMissionsCached(projectDir);
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

    try {
      const intake = readMissions({ projectDir, status, limit });
      const missions = attachState(intake.missions, projectDir, deps.cockpitMissionState);
      return {
        success: true,
        intake: { ...intake, missions },
        count: missions.length,
      };
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
      const mission = findMissionById(projectDir, id);
      if (!mission) {
        reply.code(404);
        return { success: false, error: `mission '${id}' not found` };
      }
      const state = deps.cockpitMissionState?.get(projectDir, mission.id) ?? null;
      const missionWithState: MissionWithState = { ...mission, state };
      const live = buildLiveContext(deps, mission, projectDir);
      return { success: true, mission: missionWithState, live };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_mission_detail_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
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
      const mission = findMissionById(projectDir, id);
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

  function requireStateModule(reply: FastifyReply): CockpitMissionStateModule | null {
    if (!deps.cockpitMissionState) {
      reply.code(503);
      reply.send({ success: false, error: 'cockpit mission state module not wired' });
      return null;
    }
    return deps.cockpitMissionState;
  }

  function resolveMutationContext(
    request: FastifyRequest,
    reply: FastifyReply,
  ): { projectDir: string; id: string } | null {
    const params = request.params as Record<string, unknown>;
    const id = typeof params.id === 'string' ? params.id : '';
    if (!id) {
      reply.code(400);
      reply.send({ success: false, error: 'mission id required' });
      return null;
    }
    const q = (request.query as Record<string, unknown>) ?? {};
    const projectDir = resolveProjectDir(q, repoRoot);
    if (!projectDir) {
      reply.code(400);
      reply.send({ success: false, error: 'projectDir required (no daemon repoRoot configured)' });
      return null;
    }
    const validation = validateProjectRoot(projectDir);
    if (!validation.ok) {
      reply.code(400);
      reply.send({ success: false, error: validation.error });
      return null;
    }
    return { projectDir, id };
  }

  function readNotes(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const notes = (body as Record<string, unknown>).notes;
    if (typeof notes === 'string' && notes.trim().length > 0) return notes.trim().slice(0, 2000);
    return null;
  }

  function readUntil(body: unknown): number | { error: string } {
    if (!body || typeof body !== 'object') {
      return { error: 'body required with `until` (epoch ms or ISO 8601 string)' };
    }
    const raw = (body as Record<string, unknown>).until;
    const now = Date.now();
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > now) return Math.floor(raw);
    if (typeof raw === 'string' && raw.trim()) {
      const n = Date.parse(raw);
      if (Number.isFinite(n) && n > now) return n;
      const asNumber = Number(raw);
      if (Number.isFinite(asNumber) && asNumber > now) return Math.floor(asNumber);
    }
    return { error: '`until` must be a future epoch-ms number or ISO 8601 timestamp' };
  }

  fastify.post('/cockpit/missions/:id/dismiss', async (request: FastifyRequest, reply: FastifyReply) => {
    const state = requireStateModule(reply);
    if (!state) return reply;
    const ctx = resolveMutationContext(request, reply);
    if (!ctx) return reply;
    try {
      const next = state.dismiss(ctx.projectDir, ctx.id, readNotes(request.body));
      return { success: true, state: next };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_mission_dismiss_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.post('/cockpit/missions/:id/snooze', async (request: FastifyRequest, reply: FastifyReply) => {
    const state = requireStateModule(reply);
    if (!state) return reply;
    const ctx = resolveMutationContext(request, reply);
    if (!ctx) return reply;
    const until = readUntil(request.body);
    if (typeof until !== 'number') {
      reply.code(400);
      return { success: false, error: until.error };
    }
    try {
      const next = state.snooze(ctx.projectDir, ctx.id, until, readNotes(request.body));
      return { success: true, state: next };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_mission_snooze_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.delete('/cockpit/missions/:id/state', async (request: FastifyRequest, reply: FastifyReply) => {
    const stateModule = requireStateModule(reply);
    if (!stateModule) return reply;
    const ctx = resolveMutationContext(request, reply);
    if (!ctx) return reply;
    const q = (request.query as Record<string, unknown>) ?? {};
    const rawField = typeof q.field === 'string' ? q.field : 'all';
    if (!['dismissed', 'snoozed', 'plannedSortie', 'all'].includes(rawField)) {
      reply.code(400);
      return {
        success: false,
        error: '`field` must be one of: dismissed, snoozed, plannedSortie, all',
      };
    }
    try {
      const next = stateModule.clear(
        ctx.projectDir,
        ctx.id,
        rawField as 'dismissed' | 'snoozed' | 'plannedSortie' | 'all',
      );
      return { success: true, state: next };
    } catch (error) {
      metrics.errors++;
      logger.error('cockpit_mission_clear_state_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
