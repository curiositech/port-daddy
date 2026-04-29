import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { createActivityLog } from '../lib/activity.js';
import type { createAgents } from '../lib/agents.js';
import { loadFleetConfig, type FleetAgent as ConfiguredFleetAgent } from '../lib/fleet-engine.js';
import type { createProjects } from '../lib/projects.js';
import type { createResurrection } from '../lib/resurrection.js';
import type { createSessions } from '../lib/sessions.js';
import type { createSpawner } from '../lib/spawner.js';

type AgentsManager = ReturnType<typeof createAgents>;
type RegistryAgentEntry = ReturnType<AgentsManager['list']>['agents'][number];
type SessionsManager = ReturnType<typeof createSessions>;
interface SessionSummaryEntry {
  id: string;
  purpose: string | null;
  status: string;
  agentId: string | null;
  updatedAt: number;
  notes?: Array<{
    content: string;
    createdAt: number;
  }>;
}
type ResurrectionManager = ReturnType<typeof createResurrection>;
type SalvageAgentEntry = ReturnType<ResurrectionManager['list']>['agents'][number];
type SpawnerManager = ReturnType<typeof createSpawner>;
type SpawnedAgentEntry = ReturnType<SpawnerManager['list']>[number];
type ProjectsManager = ReturnType<typeof createProjects>;
type ProjectEntry = ReturnType<ProjectsManager['getByPath']>;
type ActivityManager = ReturnType<typeof createActivityLog>;
type ActivityEntry = ReturnType<ActivityManager['getRecent']>['entries'][number];

type OperatorActorState = 'running' | 'idle' | 'salvaged' | 'orphan_reconciled' | 'historical';
type OperatorActorKind = 'scheduled' | 'triggered' | 'watcher' | 'ad_hoc';

const KNOWN_REPO_PATH_PREFIXES = [
  'apps/',
  'bin/',
  'cli/',
  'completions/',
  'config/',
  'docs/',
  'fleet-config-ui/',
  'lib/',
  'mcp/',
  'public/',
  'routes/',
  'scripts/',
  'shared/',
  'skills/',
  'tests/',
  'website-v2/',
  '.cartographer/',
  '.claude-plugin/',
  '.portdaddy/',
  '.spark/',
  '.spider/',
];

interface OperatorRouteDeps {
  logger?: {
    info?: (meta: Record<string, unknown>, message?: string) => void;
    error?: (meta: Record<string, unknown>, message?: string) => void;
  };
  agents?: AgentsManager;
  sessions?: SessionsManager;
  resurrection?: ResurrectionManager;
  spawner?: SpawnerManager;
  projects?: ProjectsManager;
  activityLog?: ActivityManager;
}

interface OpenFileBody {
  path?: string;
  projectDir?: string;
  mode?: 'editor' | 'finder';
}

interface FilePreviewBody {
  path?: string;
  projectDir?: string;
  maxLines?: number;
}

type CoordinationGuardAction = 'status' | 'check' | 'enable' | 'install';
type CoordinationGuardMode = 'off' | 'warn' | 'enforce';

interface CoordinationGuardStatus {
  success: boolean;
  name: string;
  enabled: boolean;
  mode: CoordinationGuardMode;
  requireSession: boolean;
  requireClaims: boolean;
  configPath: string;
  projectDir: string;
}

interface CoordinationGuardCheck {
  success: boolean;
  passed: boolean;
  shouldBlock: boolean;
  mode: CoordinationGuardMode;
  enabled: boolean;
  files: string[];
  agentId?: string | null;
  sessionId?: string | null;
  violations: Array<{
    code: string;
    severity: 'warning' | 'critical';
    message: string;
    file?: string;
    owners?: Array<{
      sessionId?: string | null;
      agentId?: string | null;
      purpose?: string | null;
      phase?: string | null;
    }>;
  }>;
}

interface CoordinationGuardQuery {
  project?: string;
  projectDir?: string;
}

interface CoordinationGuardBody extends CoordinationGuardQuery {
  action?: CoordinationGuardAction;
  mode?: CoordinationGuardMode;
  staged?: boolean;
}

interface OperatorActorsQuery {
  project?: string;
  projectDir?: string;
  limit?: string;
}

type PreviewLineKind = 'meta' | 'hunk' | 'add' | 'remove' | 'context';

interface PreviewLine {
  kind: PreviewLineKind;
  text: string;
}

interface OperatorActorSignal {
  timestamp: number;
  summary: string;
  files: string[];
}

interface OperatorActorRecord {
  id: string;
  label: string;
  purpose: string | null;
  identity: string | null;
  fleetAgentName: string | null;
  inboxTarget: string;
  isConfiguredFleetAgent: boolean;
  actorKind: OperatorActorKind;
  actorState: OperatorActorState;
  actorStateReason: string;
  runtimeStatus: string | null;
  liveness: 'alive' | 'stale' | 'dead' | null;
  lastActivityAt: number | null;
  lastSummary: string | null;
  recentFiles: string[];
  registry: RegistryAgentEntry | null;
  spawned: SpawnedAgentEntry | null;
  salvage: SalvageAgentEntry | null;
  sessions: SessionSummaryEntry[];
}

interface MutableActorRecord {
  id: string;
  label: string;
  purpose: string | null;
  identity: string | null;
  fleetAgentName: string | null;
  inboxTarget: string;
  isConfiguredFleetAgent: boolean;
  actorKind: OperatorActorKind;
  runtimeStatus: string | null;
  liveness: 'alive' | 'stale' | 'dead' | null;
  lastActivityAt: number | null;
  registry: RegistryAgentEntry | null;
  spawned: SpawnedAgentEntry | null;
  salvage: SalvageAgentEntry | null;
  sessions: SessionSummaryEntry[];
  orphanedAt: number | null;
  orphanedSummary: string | null;
  recentFiles: string[];
  signals: OperatorActorSignal[];
}

const ORPHAN_RECONCILED_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve an operator-surfaced file token against the current project.
 *
 * Example:
 * - input: `('routes/operator.ts', '/Users/me/port-daddy')`
 * - output: `/Users/me/port-daddy/routes/operator.ts`
 */
function resolveRequestedPath(filePath: string, projectDir?: string): string {
  if (filePath.startsWith('/')) {
    return resolve(filePath);
  }
  return resolve(projectDir || process.cwd(), filePath);
}

/**
 * Find the Git worktree root that should contextualize previews for a file.
 *
 * Example:
 * - input: `('/Users/me/port-daddy', '/Users/me/port-daddy/routes/operator.ts')`
 * - output: `/Users/me/port-daddy`
 */
function resolveGitRoot(projectDir: string | undefined, resolvedPath: string): string | null {
  const candidates = [
    projectDir,
    dirname(resolvedPath),
    process.cwd(),
  ].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    const probe = spawnSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (probe.status === 0) {
      const root = probe.stdout.trim();
      if (root) return root;
    }
  }

  return null;
}

/**
 * Run a Git command and return stdout, collapsing failures into an empty string
 * so preview generation can gracefully fall through to the next strategy.
 *
 * Example:
 * - input: `['-C', '/repo', 'status', '--porcelain=v1', '--', 'routes/operator.ts']`
 * - output: `' M routes/operator.ts\n'`
 */
function runGit(args: string[]): string {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout : '';
}

/**
 * Clamp preview output to a small card-sized window.
 *
 * Example:
 * - input: 90 parsed diff lines, `24`
 * - output: first 24 lines plus `truncated: true`
 */
function trimPreviewLines(lines: PreviewLine[], maxLines: number): { lines: PreviewLine[]; truncated: boolean } {
  if (lines.length <= maxLines) return { lines, truncated: false };
  return {
    lines: lines.slice(0, maxLines),
    truncated: true,
  };
}

/**
 * Count visible additions and deletions in the preview payload.
 *
 * Example:
 * - input: `[add, add, remove, context]`
 * - output: `{ additions: 2, deletions: 1 }`
 */
function summarizeChanges(lines: PreviewLine[]): { additions: number; deletions: number } {
  return lines.reduce((acc, line) => {
    if (line.kind === 'add') acc.additions += 1;
    if (line.kind === 'remove') acc.deletions += 1;
    return acc;
  }, { additions: 0, deletions: 0 });
}

/**
 * Convert a unified diff into the lightweight line model consumed by FleetBar.
 *
 * Example:
 * - input: `'@@ -1,2 +1,2 @@\n-old\n+new'`
 * - output: `[{ kind: 'hunk', ... }, { kind: 'remove', ... }, { kind: 'add', ... }]`
 */
function parseUnifiedDiff(diffText: string, maxLines: number): {
  lines: PreviewLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
} {
  const lines = diffText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.startsWith('diff --git'))
    .filter((line) => !line.startsWith('index '))
    .map((line): PreviewLine => {
      if (line.startsWith('@@')) return { kind: 'hunk', text: line };
      if (line.startsWith('+++') || line.startsWith('---')) return { kind: 'meta', text: line };
      if (line.startsWith('+')) return { kind: 'add', text: line };
      if (line.startsWith('-')) return { kind: 'remove', text: line };
      return { kind: 'context', text: line };
    });

  const { lines: trimmedLines, truncated } = trimPreviewLines(lines, maxLines);
  const { additions, deletions } = summarizeChanges(trimmedLines);
  return { lines: trimmedLines, additions, deletions, truncated };
}

/**
 * Fall back to a direct file snapshot when there is no meaningful diff to show.
 *
 * Example:
 * - input: `('/repo/new-file.ts', 8, 'untracked')`
 * - output: preview lines prefixed as additions
 */
function buildSnapshotPreview(resolvedPath: string, maxLines: number, kind: 'untracked' | 'snapshot'): {
  lines: PreviewLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
} {
  const raw = readFileSync(resolvedPath, 'utf8');
  const fileLines = raw.split('\n').slice(0, maxLines).map((line): PreviewLine => ({
    kind: kind === 'untracked' ? 'add' : 'context',
    text: kind === 'untracked' ? `+${line}` : ` ${line}`,
  }));
  const truncated = raw.split('\n').length > maxLines;
  return {
    lines: fileLines,
    additions: kind === 'untracked' ? fileLines.length : 0,
    deletions: 0,
    truncated,
  };
}

/**
 * Produce the best available file preview for hover cards:
 * working tree diff, staged diff, untracked snapshot, or plain snapshot.
 *
 * Example:
 * - input: `('routes/operator.ts', '/repo/routes/operator.ts', '/repo', 24)`
 * - output: `{ source: 'working-tree', additions: 3, deletions: 1, lines: [...] }`
 */
function previewForPath(
  requestedPath: string,
  resolvedPath: string,
  projectDir?: string,
  maxLines = 24,
): {
  requestedPath: string;
  resolvedPath: string;
  displayPath: string;
  source: 'working-tree' | 'staged' | 'untracked' | 'snapshot';
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: PreviewLine[];
} {
  const clampedMaxLines = Math.max(6, Math.min(60, maxLines));
  const repoRoot = resolveGitRoot(projectDir, resolvedPath);
  const displayPath = repoRoot
    ? relative(repoRoot, resolvedPath).split('\\').join('/')
    : requestedPath;

  if (!repoRoot) {
    const snapshot = buildSnapshotPreview(resolvedPath, clampedMaxLines, 'snapshot');
    return {
      requestedPath,
      resolvedPath,
      displayPath,
      source: 'snapshot',
      ...snapshot,
    };
  }

  const relativePath = relative(repoRoot, resolvedPath).split('\\').join('/');
  const workingTreeDiff = runGit(['-C', repoRoot, 'diff', '--no-ext-diff', '--no-color', '--unified=3', '--', relativePath]).trim();
  if (workingTreeDiff) {
    return {
      requestedPath,
      resolvedPath,
      displayPath,
      source: 'working-tree',
      ...parseUnifiedDiff(workingTreeDiff, clampedMaxLines),
    };
  }

  const stagedDiff = runGit(['-C', repoRoot, 'diff', '--cached', '--no-ext-diff', '--no-color', '--unified=3', '--', relativePath]).trim();
  if (stagedDiff) {
    return {
      requestedPath,
      resolvedPath,
      displayPath,
      source: 'staged',
      ...parseUnifiedDiff(stagedDiff, clampedMaxLines),
    };
  }

  const status = runGit(['-C', repoRoot, 'status', '--porcelain=v1', '--', relativePath]).trim();
  if (status.startsWith('??')) {
    return {
      requestedPath,
      resolvedPath,
      displayPath,
      source: 'untracked',
      ...buildSnapshotPreview(resolvedPath, clampedMaxLines, 'untracked'),
    };
  }

  return {
    requestedPath,
    resolvedPath,
    displayPath,
    source: 'snapshot',
    ...buildSnapshotPreview(resolvedPath, clampedMaxLines, 'snapshot'),
  };
}

/**
 * Translate a resolved path into the platform-native open/reveal command.
 *
 * Example:
 * - input: `('/repo/routes/operator.ts', 'finder', false)`
 * - output on macOS: `{ command: 'open', args: ['-R', '/repo/routes/operator.ts'] }`
 */
function buildOpenCommand(
  targetPath: string,
  mode: 'editor' | 'finder',
  isDirectory: boolean,
): { command: string; args: string[] } {
  if (process.platform === 'darwin') {
    return mode === 'finder'
      ? { command: 'open', args: isDirectory ? [targetPath] : ['-R', targetPath] }
      : { command: 'open', args: [targetPath] };
  }

  if (process.platform === 'win32') {
    return mode === 'finder'
      ? { command: 'explorer', args: isDirectory ? [targetPath] : ['/select,', targetPath] }
      : { command: 'cmd', args: ['/c', 'start', '', targetPath] };
  }

  if (mode === 'finder') {
    return { command: 'xdg-open', args: [isDirectory ? targetPath : dirname(targetPath)] };
  }
  return { command: 'xdg-open', args: [targetPath] };
}

/**
 * Resolve the operator project context from explicit query params and the
 * durable project registry when a projectDir is available.
 *
 * Example:
 * - input: `{ projectDir: '/repo/port-daddy' }`
 * - output: `{ projectDir: '/repo/port-daddy', projectName: 'port-daddy' }`
 */
function resolveProjectContext(query: OperatorActorsQuery, projects?: ProjectsManager): {
  projectDir: string | null;
  projectName: string | null;
  projectRecord: ProjectEntry;
} {
  const requestedProjectDir = typeof query.projectDir === 'string' && query.projectDir.trim()
    ? resolve(query.projectDir.trim())
    : null;
  const requestedProject = typeof query.project === 'string' && query.project.trim()
    ? query.project.trim()
    : null;

  const projectRecord = requestedProjectDir && projects?.getByPath
    ? projects.getByPath(requestedProjectDir)
    : requestedProject && projects?.get
      ? projects.get(requestedProject)
      : null;

  return {
    projectDir: requestedProjectDir ?? projectRecord?.root ?? null,
    projectName: projectRecord?.id ?? (requestedProjectDir ? basename(requestedProjectDir) : requestedProject),
    projectRecord,
  };
}

function resolveGuardProject(input: CoordinationGuardQuery, projects?: ProjectsManager): {
  projectDir: string;
  projectName: string | null;
} {
  const context = resolveProjectContext(input, projects);
  const projectDir = resolve(context.projectDir ?? process.cwd());
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    throw new Error(`Project directory not found: ${projectDir}`);
  }
  return {
    projectDir,
    projectName: context.projectName ?? basename(projectDir),
  };
}

function normalizeGuardAction(value: unknown): CoordinationGuardAction {
  if (value === 'check' || value === 'enable' || value === 'install' || value === 'status') return value;
  return 'status';
}

function normalizeGuardMode(value: unknown, fallback: Exclude<CoordinationGuardMode, 'off'> = 'enforce'): Exclude<CoordinationGuardMode, 'off'> {
  return value === 'warn' || value === 'enforce' ? value : fallback;
}

function spawnText(value: string | Buffer | null | undefined): string {
  if (typeof value === 'string') return value;
  return value ? value.toString('utf8') : '';
}

function isMissingCommand(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}

function runGuardCli(projectDir: string, args: string[]) {
  for (const command of ['pd', 'port-daddy']) {
    const result = spawnSync(command, ['guard', ...args, '--dir', projectDir], {
      cwd: projectDir,
      encoding: 'utf8',
      env: process.env,
    });
    if (!isMissingCommand(result.error)) return { command, result };
  }
  const result = spawnSync('pd', ['guard', ...args, '--dir', projectDir], {
    cwd: projectDir,
    encoding: 'utf8',
    env: process.env,
  });
  return { command: 'pd', result };
}

function parseGuardJson<T>(stdout: string, commandLabel: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error(`${commandLabel} returned no JSON output.`);
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    throw new Error(`${commandLabel} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function guardFailureMessage(commandLabel: string, result: ReturnType<typeof spawnSync>): string {
  const stderr = spawnText(result.stderr).trim();
  const stdout = spawnText(result.stdout).trim();
  const error = result.error instanceof Error ? result.error.message : '';
  return [stderr, stdout, error, `${commandLabel} failed`].find(Boolean) ?? `${commandLabel} failed`;
}

function readCoordinationGuardStatus(projectDir: string): CoordinationGuardStatus {
  const { command, result } = runGuardCli(projectDir, ['status', '--json']);
  const commandLabel = `${command} guard status`;
  if (result.status !== 0) {
    throw new Error(guardFailureMessage(commandLabel, result));
  }
  const status = parseGuardJson<Omit<CoordinationGuardStatus, 'projectDir'>>(spawnText(result.stdout), commandLabel);
  return { ...status, projectDir };
}

/**
 * Recover the fleet agent name from semantic identity fields or the
 * conventional "Fleet agent: <name>" purpose string.
 *
 * Example:
 * - input: `{ identity: 'port-daddy:fleet:spark' }`
 * - output: `'spark'`
 */
function extractFleetAgentName(input: {
  identity?: string | null;
  identityStack?: string | null;
  identityContext?: string | null;
  purpose?: string | null;
}): string | null {
  if (input.identityStack === 'fleet' && input.identityContext) {
    return input.identityContext;
  }

  const identity = input.identity?.trim();
  if (identity) {
    const segments = identity.split(':').filter(Boolean);
    const fleetIndex = segments.indexOf('fleet');
    if (fleetIndex >= 0 && segments[fleetIndex + 1]) {
      return segments[fleetIndex + 1];
    }
  }

  const purpose = input.purpose?.trim();
  if (!purpose) return null;
  const match = purpose.match(/^Fleet agent:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * Rebuild a salvage entry's semantic identity string for actor grouping.
 *
 * Example:
 * - input: `{ identityProject: 'port-daddy', identityStack: 'fleet', identityContext: 'spark' }`
 * - output: `'port-daddy:fleet:spark'`
 */
function identityFromSalvage(agent: SalvageAgentEntry): string | null {
  return [
    agent.identityProject,
    agent.identityStack,
    agent.identityContext,
  ].filter((part): part is string => !!part && part.trim().length > 0).join(':') || null;
}

/**
 * Match a registry row to a logical project when the daemon has not yet
 * upgraded every surface to projectDir-native identity keys.
 *
 * Example:
 * - input: `(registryAgent, 'port-daddy')`
 * - output: `true`
 */
function matchesProjectRegistry(agent: RegistryAgentEntry, projectName: string | null): boolean {
  if (!projectName) return true;
  const needle = projectName.toLowerCase();
  const identity = agent.identity?.toLowerCase() ?? '';
  const purpose = agent.purpose?.toLowerCase() ?? '';
  return agent.identityProject === projectName
    || identity === needle
    || identity.startsWith(`${needle}:`)
    || purpose.includes(needle);
}

/**
 * Match a spawned run to a logical project using the same transitional
 * heuristics as the control plane today.
 *
 * Example:
 * - input: `(spawnedRun, 'port-daddy')`
 * - output: `true`
 */
function matchesProjectSpawn(agent: SpawnedAgentEntry, projectName: string | null): boolean {
  if (!projectName) return true;
  const needle = projectName.toLowerCase();
  const identity = agent.identity?.toLowerCase() ?? '';
  const purpose = agent.purpose?.toLowerCase() ?? '';
  return identity === needle
    || identity.startsWith(`${needle}:`)
    || purpose.includes(needle);
}

/**
 * Extract file-looking tokens from a note, activity summary, or spawned output.
 *
 * Example:
 * - input: `'Touched routes/operator.ts and apps/FleetBar/FleetStore.swift'`
 * - output: `['routes/operator.ts', 'apps/FleetBar/FleetStore.swift']`
 */
function extractMentionedPaths(text: string | null | undefined, limit = 6): string[] {
  if (!text) return [];
  const pattern = /(?:\.{1,2}\/|\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9_-]+)?/g;
  const matches = text.match(pattern) ?? [];
  return [...new Set(matches.filter(looksLikeRepoPath))].slice(0, limit);
}

/**
 * Keep actor summaries from resurrecting prose slash-phrases as file chips.
 *
 * Example:
 * - input: `'FleetBar/control-plane'`
 * - output: `false`
 */
function looksLikeRepoPath(candidate: string): boolean {
  if (!candidate || !candidate.includes('/')) return false;
  if (candidate.includes('://')) return false;

  const normalized = candidate
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .replace(/^\.\.\//, '');
  if (!normalized) return false;
  if (KNOWN_REPO_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return false;
  return (parts[parts.length - 1] ?? '').includes('.');
}

/**
 * Clamp long text to a one-card summary without throwing away the beginning.
 *
 * Example:
 * - input: `'A very long summary...'`, `120`
 * - output: `'A very long summary…'`
 */
function truncateText(text: string | null | undefined, maxLength = 220): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Classify a configured fleet agent into a UI-facing actor kind.
 *
 * Example:
 * - input: `{ schedule: 'every-5-minutes' }`
 * - output: `'scheduled'`
 */
function classifyConfiguredActor(agent: ConfiguredFleetAgent): OperatorActorKind {
  if (agent.schedule) return 'scheduled';
  if ((agent.triggers && agent.triggers.length > 0) || agent.triggerTuple) return 'triggered';
  return 'triggered';
}

/**
 * Merge a file list into a stable, de-duplicated actor-level recent-files set.
 *
 * Example:
 * - input: `['a.ts'], ['a.ts', 'b.ts']`
 * - output: `['a.ts', 'b.ts']`
 */
function mergeRecentFiles(current: string[], next: string[]): string[] {
  return [...new Set([...current, ...next].filter((value) => value.trim().length > 0))].slice(0, 6);
}

/**
 * Derive a single actor-state label from the combined registry/session/salvage
 * evidence that Port Daddy has for a given logical actor.
 *
 * Example:
 * - input: `{ registry: active, salvage: null, orphanedAt: null }`
 * - output: `{ actorState: 'running', actorStateReason: 'Live body is registered.' }`
 */
function deriveActorState(entry: MutableActorRecord): { actorState: OperatorActorState; actorStateReason: string } {
  const hasActiveSession = entry.sessions.some((session) => session.status === 'active');
  const spawnedStatus = entry.spawned?.status ?? null;
  const hasLiveBody = Boolean(
    entry.registry?.isActive
      || entry.registry?.healthAssessment?.liveness === 'alive'
      || spawnedStatus === 'running',
  );
  if (hasLiveBody) {
    return { actorState: 'running', actorStateReason: 'Live body is registered or spawned.' };
  }

  if (entry.salvage) {
    return { actorState: 'salvaged', actorStateReason: 'Actor is queued or marked for salvage/resurrection.' };
  }

  if (hasActiveSession) {
    return { actorState: 'orphan_reconciled', actorStateReason: 'Active session exists without a live body and needs reconciliation.' };
  }

  if (entry.orphanedAt && (Date.now() - entry.orphanedAt) <= ORPHAN_RECONCILED_WINDOW_MS) {
    return { actorState: 'orphan_reconciled', actorStateReason: 'Recent orphaned session was reconciled after body loss.' };
  }

  if (entry.sessions.length > 0 || entry.spawned || entry.signals.length > 0) {
    return { actorState: 'historical', actorStateReason: 'No current body, but recent work history exists.' };
  }

  return { actorState: 'idle', actorStateReason: 'Known actor with no current body and no recent salvage pressure.' };
}

const OPERATOR_ACTOR_STATE_ORDER: Record<OperatorActorState, number> = {
  running: 0,
  salvaged: 1,
  orphan_reconciled: 2,
  idle: 3,
  historical: 4,
};

/**
 * Keep configured fleet actors visible before noisy ad hoc history so Inbox
 * targets like `spark` and `spider` cannot be sliced out by old sessions.
 *
 * Example:
 * - input: `historical agent-123` and `idle spark`
 * - output: `spark` sorts first
 */
function compareOperatorActors(left: OperatorActorRecord, right: OperatorActorRecord): number {
  if (left.isConfiguredFleetAgent !== right.isConfiguredFleetAgent) {
    return left.isConfiguredFleetAgent ? -1 : 1;
  }

  const stateDiff = OPERATOR_ACTOR_STATE_ORDER[left.actorState] - OPERATOR_ACTOR_STATE_ORDER[right.actorState];
  if (stateDiff !== 0) return stateDiff;

  const activityDiff = (right.lastActivityAt ?? 0) - (left.lastActivityAt ?? 0);
  if (activityDiff !== 0) return activityDiff;

  return left.label.localeCompare(right.label);
}

/**
 * Build the operator-facing actor lens for one project. This is the shared
 * truth both FleetBar and the control plane should render.
 *
 * Example:
 * - input: `{ projectDir: '/repo/port-daddy', projectName: 'port-daddy' }`
 * - output: `[{ id: 'spark', actorState: 'running', ... }]`
 */
function buildOperatorActors(
  deps: OperatorRouteDeps,
  query: OperatorActorsQuery,
): {
  actors: OperatorActorRecord[];
  projectDir: string | null;
  projectName: string | null;
  summary: Record<OperatorActorState, number>;
} {
  const { projectDir, projectName } = resolveProjectContext(query, deps.projects);
  const configured = projectDir ? loadFleetConfig(projectDir) : null;
  const configuredFleetAgents = new Set(configured?.agents.map((agent) => agent.name) ?? []);
  const limit = Math.min(Math.max(parseInt(query.limit ?? '80', 10) || 80, 1), 200);

  const registryAgents = deps.agents?.list({ activeOnly: false }).agents.filter((agent) => matchesProjectRegistry(agent, projectName)) ?? [];
  const salvageAgents = deps.resurrection?.list({ project: projectName ?? undefined, limit }).agents ?? [];
  const spawnedAgents = deps.spawner?.list().filter((agent) => matchesProjectSpawn(agent, projectName)) ?? [];
  const sessions = deps.sessions?.list({
    project: projectName ?? undefined,
    includeNotes: true,
    allWorktrees: true,
    limit,
  }) as { sessions: SessionSummaryEntry[] } | undefined;
  const sessionEntries = sessions?.sessions ?? [];
  const activityEntries = deps.activityLog?.getRecent({ type: 'session.end', limit: limit * 2 }).entries ?? [];
  const activeClaims = deps.sessions?.listAllActiveClaims?.().claims ?? [];

  const claimFilesByAgent = new Map<string, string[]>();
  for (const claim of activeClaims) {
    if (!claim.agentId) continue;
    claimFilesByAgent.set(claim.agentId, mergeRecentFiles(claimFilesByAgent.get(claim.agentId) ?? [], [claim.filePath]));
  }

  const actors = new Map<string, MutableActorRecord>();

  /**
   * Create or update one mutable actor bucket while preserving the newest
   * activity timestamp and the strongest source objects.
   */
  const upsert = (key: string, patch: Partial<MutableActorRecord>, timestamp: number, signal?: OperatorActorSignal) => {
    const existing = actors.get(key);
    const next: MutableActorRecord = {
      id: patch.id ?? existing?.id ?? key,
      label: patch.label ?? existing?.label ?? key,
      purpose: patch.purpose ?? existing?.purpose ?? null,
      identity: patch.identity ?? existing?.identity ?? null,
      fleetAgentName: patch.fleetAgentName ?? existing?.fleetAgentName ?? null,
      inboxTarget: patch.inboxTarget ?? existing?.inboxTarget ?? key,
      isConfiguredFleetAgent: patch.isConfiguredFleetAgent ?? existing?.isConfiguredFleetAgent ?? false,
      actorKind: patch.actorKind ?? existing?.actorKind ?? 'ad_hoc',
      runtimeStatus: patch.runtimeStatus ?? existing?.runtimeStatus ?? null,
      liveness: patch.liveness ?? existing?.liveness ?? null,
      lastActivityAt: Math.max(timestamp, patch.lastActivityAt ?? 0, existing?.lastActivityAt ?? 0) || null,
      registry: patch.registry ?? existing?.registry ?? null,
      spawned: patch.spawned ?? existing?.spawned ?? null,
      salvage: patch.salvage ?? existing?.salvage ?? null,
      sessions: patch.sessions ?? existing?.sessions ?? [],
      orphanedAt: patch.orphanedAt ?? existing?.orphanedAt ?? null,
      orphanedSummary: patch.orphanedSummary ?? existing?.orphanedSummary ?? null,
      recentFiles: mergeRecentFiles(existing?.recentFiles ?? [], patch.recentFiles ?? []),
      signals: [...(existing?.signals ?? []), ...(signal ? [signal] : [])],
    };
    actors.set(key, next);
  };

  for (const configuredAgent of configured?.agents ?? []) {
    upsert(configuredAgent.name, {
      id: configuredAgent.name,
      label: configuredAgent.name,
      fleetAgentName: configuredAgent.name,
      inboxTarget: configuredAgent.name,
      isConfiguredFleetAgent: true,
      actorKind: classifyConfiguredActor(configuredAgent),
    }, 0);
  }

  for (const agent of registryAgents) {
    const fleetAgentName = extractFleetAgentName(agent);
    const key = fleetAgentName ?? agent.id;
    const files = claimFilesByAgent.get(agent.id) ?? [];
    upsert(key, {
      id: fleetAgentName ?? agent.id,
      label: agent.name || fleetAgentName || agent.id,
      purpose: agent.purpose ?? null,
      identity: agent.identity ?? null,
      fleetAgentName,
      inboxTarget: fleetAgentName ?? agent.id,
      isConfiguredFleetAgent: fleetAgentName ? configuredFleetAgents.has(fleetAgentName) : false,
      actorKind: fleetAgentName ? 'triggered' : 'ad_hoc',
      runtimeStatus: agent.status ?? null,
      liveness: agent.healthAssessment?.liveness ?? null,
      registry: agent,
      recentFiles: files,
    }, agent.lastHeartbeat, agent.progress
      ? { timestamp: agent.lastHeartbeat, summary: agent.progress, files }
      : undefined);
  }

  for (const agent of spawnedAgents) {
    const fleetAgentName = extractFleetAgentName({
      identity: agent.identity ?? null,
      purpose: agent.purpose ?? null,
    });
    const key = fleetAgentName ?? agent.agentId;
    const summary = truncateText(agent.status);
    const files = mergeRecentFiles(claimFilesByAgent.get(agent.agentId) ?? [], extractMentionedPaths(summary));
    upsert(key, {
      id: fleetAgentName ?? agent.agentId,
      label: fleetAgentName || agent.agentId,
      purpose: agent.purpose ?? null,
      identity: agent.identity ?? null,
      fleetAgentName,
      inboxTarget: fleetAgentName ?? agent.agentId,
      isConfiguredFleetAgent: fleetAgentName ? configuredFleetAgents.has(fleetAgentName) : false,
      actorKind: fleetAgentName ? 'triggered' : 'ad_hoc',
      runtimeStatus: agent.status,
      spawned: agent,
      recentFiles: files,
    }, agent.completedAt ?? agent.startedAt, summary
      ? { timestamp: agent.completedAt ?? agent.startedAt, summary, files }
      : undefined);
  }

  for (const agent of salvageAgents) {
    const identity = identityFromSalvage(agent);
    const fleetAgentName = extractFleetAgentName({
      identity,
      identityStack: agent.identityStack,
      identityContext: agent.identityContext,
      purpose: agent.purpose,
    });
    const key = fleetAgentName ?? agent.id;
    upsert(key, {
      id: fleetAgentName ?? agent.id,
      label: agent.name || fleetAgentName || agent.id,
      purpose: agent.purpose ?? null,
      identity,
      fleetAgentName,
      inboxTarget: fleetAgentName ?? agent.id,
      isConfiguredFleetAgent: fleetAgentName ? configuredFleetAgents.has(fleetAgentName) : false,
      actorKind: fleetAgentName ? 'triggered' : 'ad_hoc',
      runtimeStatus: agent.status,
      salvage: agent,
    }, agent.staleSince);
  }

  for (const session of sessionEntries) {
    const fleetAgentName = extractFleetAgentName({
      purpose: session.purpose,
    });
    const key = fleetAgentName ?? session.agentId ?? session.id;
    const files = session.agentId ? (claimFilesByAgent.get(session.agentId) ?? []) : [];
    const latestNote = [...(session.notes ?? [])]
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    const noteSummary = truncateText(latestNote?.content ?? null);
    const noteFiles = mergeRecentFiles(files, extractMentionedPaths(noteSummary));
    const existing = actors.get(key);
    const nextSessions = [...(existing?.sessions ?? []), session]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 8);
    upsert(key, {
      id: fleetAgentName ?? session.agentId ?? session.id,
      label: fleetAgentName ?? session.agentId ?? existing?.label ?? session.id,
      purpose: session.purpose ?? existing?.purpose ?? null,
      fleetAgentName,
      inboxTarget: fleetAgentName ?? session.agentId ?? session.id,
      isConfiguredFleetAgent: fleetAgentName ? configuredFleetAgents.has(fleetAgentName) : existing?.isConfiguredFleetAgent ?? false,
      actorKind: fleetAgentName ? (existing?.actorKind ?? 'triggered') : existing?.actorKind ?? 'ad_hoc',
      sessions: nextSessions,
      recentFiles: noteFiles,
    }, session.updatedAt, noteSummary
      ? { timestamp: latestNote?.createdAt ?? session.updatedAt, summary: noteSummary, files: noteFiles }
      : undefined);
  }

  for (const entry of activityEntries) {
    const metadata = entry.metadata ?? {};
    const identityProject = typeof metadata.identityProject === 'string' ? metadata.identityProject : null;
    const orphaned = metadata.orphaned === true;
    if (!orphaned) continue;
    if (projectName && identityProject && identityProject !== projectName) continue;
    const orphanedAgentId = typeof metadata.orphanedAgentId === 'string' ? metadata.orphanedAgentId : null;
    const key = orphanedAgentId ?? entry.agentId ?? entry.targetId ?? `orphan:${entry.id}`;
    const summary = truncateText(entry.details || 'Orphaned session reconciled.');
    const files = extractMentionedPaths(summary);
    upsert(key, {
      id: orphanedAgentId ?? entry.agentId ?? entry.targetId ?? key,
      label: orphanedAgentId ?? entry.agentId ?? key,
      inboxTarget: orphanedAgentId ?? entry.agentId ?? key,
      orphanedAt: entry.timestamp,
      orphanedSummary: summary,
      recentFiles: files,
    }, entry.timestamp, summary
      ? { timestamp: entry.timestamp, summary, files }
      : undefined);
  }

  const finalized = [...actors.values()]
    .map((entry): OperatorActorRecord => {
      entry.signals.sort((left, right) => right.timestamp - left.timestamp);
      const state = deriveActorState(entry);
      return {
        id: entry.id,
        label: entry.label,
        purpose: entry.purpose,
        identity: entry.identity,
        fleetAgentName: entry.fleetAgentName,
        inboxTarget: entry.inboxTarget,
        isConfiguredFleetAgent: entry.isConfiguredFleetAgent,
        actorKind: entry.actorKind,
        actorState: state.actorState,
        actorStateReason: state.actorStateReason,
        runtimeStatus: entry.runtimeStatus,
        liveness: entry.liveness,
        lastActivityAt: entry.lastActivityAt,
        lastSummary: entry.signals[0]?.summary ?? entry.orphanedSummary ?? null,
        recentFiles: mergeRecentFiles(entry.recentFiles, entry.signals.flatMap((signal) => signal.files)).slice(0, 4),
        registry: entry.registry,
        spawned: entry.spawned,
        salvage: entry.salvage,
        sessions: entry.sessions,
      };
    })
    .sort(compareOperatorActors)
    .slice(0, limit);

  const summary = finalized.reduce<Record<OperatorActorState, number>>((counts, actor) => {
    counts[actor.actorState] += 1;
    return counts;
  }, {
    running: 0,
    idle: 0,
    salvaged: 0,
    orphan_reconciled: 0,
    historical: 0,
  });

  return { actors: finalized, projectDir, projectName, summary };
}

export const operatorPlugin: FastifyPluginAsync<{ deps: OperatorRouteDeps }> = async (fastify, opts) => {
  const logger = opts.deps.logger;

  fastify.get('/operator/coordination-guard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = (request.query || {}) as CoordinationGuardQuery;
      const { projectDir, projectName } = resolveGuardProject(query, opts.deps.projects);
      const status = readCoordinationGuardStatus(projectDir);
      return {
        success: true,
        project: projectName,
        projectDir,
        status,
      };
    } catch (error) {
      logger?.error?.({
        err: error,
        query: request.query as Record<string, unknown>,
      }, 'operator_coordination_guard_status_failed');
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read Coordination Guard status.',
      };
    }
  });

  fastify.post('/operator/coordination-guard', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as CoordinationGuardBody;
    const action = normalizeGuardAction(body.action);
    const mode = normalizeGuardMode(body.mode);

    try {
      const { projectDir, projectName } = resolveGuardProject(body, opts.deps.projects);

      if (action === 'status') {
        const status = readCoordinationGuardStatus(projectDir);
        return { success: true, action, project: projectName, projectDir, status };
      }

      if (action === 'check') {
        const args = ['check', body.staged === false ? '' : '--staged', '--mode', mode, '--json'].filter(Boolean);
        const { command, result } = runGuardCli(projectDir, args);
        const commandLabel = `${command} guard check`;
        const check = parseGuardJson<CoordinationGuardCheck>(spawnText(result.stdout), commandLabel);
        if (result.status !== 0 && !check.shouldBlock) {
          throw new Error(guardFailureMessage(commandLabel, result));
        }
        const status = readCoordinationGuardStatus(projectDir);
        return { success: true, action, project: projectName, projectDir, status, check };
      }

      const args = action === 'install'
        ? ['install', '--mode', mode]
        : ['enable', '--mode', mode];
      const { command, result } = runGuardCli(projectDir, args);
      const commandLabel = `${command} guard ${action}`;
      if (result.status !== 0) {
        throw new Error(guardFailureMessage(commandLabel, result));
      }
      const status = readCoordinationGuardStatus(projectDir);
      const message = spawnText(result.stdout).trim() || `${commandLabel} completed`;
      logger?.info?.({
        action,
        mode,
        projectDir,
        project: projectName,
      }, 'operator_coordination_guard_action');
      return { success: true, action, project: projectName, projectDir, status, message };
    } catch (error) {
      logger?.error?.({
        err: error,
        body,
      }, 'operator_coordination_guard_action_failed');
      reply.code(500);
      return {
        success: false,
        action,
        error: error instanceof Error ? error.message : 'Coordination Guard action failed.',
      };
    }
  });

  fastify.get('/operator/actors', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = (request.query || {}) as OperatorActorsQuery;
      const result = buildOperatorActors(opts.deps, query);
      return {
        success: true,
        projectDir: result.projectDir,
        project: result.projectName,
        actors: result.actors,
        summary: result.summary,
        count: result.actors.length,
      };
    } catch (error) {
      logger?.error?.({
        err: error,
        query: request.query as Record<string, unknown>,
      }, 'operator_actor_lens_failed');
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to build operator actor lens.',
      };
    }
  });

  fastify.post('/operator/open-file', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as OpenFileBody;
    const requestedPath = typeof body.path === 'string' ? body.path.trim() : '';
    const projectDir = typeof body.projectDir === 'string' ? body.projectDir.trim() : '';
    const mode = body.mode === 'finder' ? 'finder' : body.mode === 'editor' ? 'editor' : null;

    if (!requestedPath) {
      reply.code(400);
      return { success: false, error: 'A file path is required.' };
    }
    if (!mode) {
      reply.code(400);
      return { success: false, error: 'Mode must be either "editor" or "finder".' };
    }

    const resolvedPath = resolveRequestedPath(requestedPath, projectDir || undefined);
    if (!existsSync(resolvedPath)) {
      reply.code(404);
      return { success: false, error: `File not found: ${requestedPath}` };
    }

    const stats = statSync(resolvedPath);
    const { command, args } = buildOpenCommand(resolvedPath, mode, stats.isDirectory());

    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      logger?.info?.({
        mode,
        requestedPath,
        resolvedPath,
        projectDir: projectDir || null,
      }, 'operator_open_file');
      return { success: true, mode, path: resolvedPath };
    } catch (error) {
      logger?.error?.({
        err: error,
        mode,
        requestedPath,
        resolvedPath,
      }, 'operator_open_file_failed');
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open file.',
      };
    }
  });

  fastify.post('/operator/file-preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as FilePreviewBody;
    const requestedPath = typeof body.path === 'string' ? body.path.trim() : '';
    const projectDir = typeof body.projectDir === 'string' ? body.projectDir.trim() : '';
    const maxLines = typeof body.maxLines === 'number' ? body.maxLines : 24;

    if (!requestedPath) {
      reply.code(400);
      return { success: false, error: 'A file path is required.' };
    }

    const resolvedPath = resolveRequestedPath(requestedPath, projectDir || undefined);
    if (!existsSync(resolvedPath)) {
      reply.code(404);
      return { success: false, error: `File not found: ${requestedPath}` };
    }

    try {
      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        return {
          success: true,
          preview: {
            requestedPath,
            resolvedPath,
            displayPath: requestedPath,
            source: 'snapshot',
            additions: 0,
            deletions: 0,
            truncated: false,
            lines: [
              { kind: 'meta', text: 'Directory preview unavailable.' },
              { kind: 'context', text: 'Use Finder or your editor to inspect this folder.' },
            ],
          },
        };
      }

      const preview = previewForPath(requestedPath, resolvedPath, projectDir || undefined, maxLines);
      logger?.info?.({
        requestedPath,
        resolvedPath,
        source: preview.source,
        additions: preview.additions,
        deletions: preview.deletions,
        projectDir: projectDir || null,
      }, 'operator_file_preview');
      return { success: true, preview };
    } catch (error) {
      logger?.error?.({
        err: error,
        requestedPath,
        resolvedPath,
        projectDir: projectDir || null,
      }, 'operator_file_preview_failed');
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load file preview.',
      };
    }
  });
};
