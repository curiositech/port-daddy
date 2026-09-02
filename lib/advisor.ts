/**
 * Coordination Advisor — deterministic suggestibility for agents and humans.
 *
 * This is deliberately not an LLM planner. It inspects the coordination
 * substrate Port Daddy already owns (sessions, file claims, symbols, salvage,
 * channels, tuples) and emits executable recommendations with evidence.
 */

import type Database from 'better-sqlite3';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { getWorktreeInfo } from './worktree.js';

export type AdviceSeverity = 'info' | 'warning' | 'critical';
export type AdviceCategory =
  | 'context'
  | 'claim'
  | 'lock'
  | 'symbol'
  | 'salvage'
  | 'channel'
  | 'tuple';

export interface AdvisorAction {
  label: string;
  command?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path?: string;
  body?: Record<string, unknown>;
  tool?: string;
}

export interface AdvisorEvidence {
  label: string;
  value: string | number | boolean | null;
  path?: string;
}

export interface CoordinationAdvice {
  id: string;
  category: AdviceCategory;
  severity: AdviceSeverity;
  title: string;
  why: string;
  confidence: number;
  risk: string;
  evidence: AdvisorEvidence[];
  actions: AdvisorAction[];
}

export interface AdvisorInput {
  projectRoot?: string | null;
  project?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  task?: string | null;
  files?: string[] | null;
  changedFiles?: string[] | null;
  includeChannels?: boolean;
  includeTupleHints?: boolean;
}

export interface AdvisorResult {
  success: true;
  generatedAt: number;
  summary: string;
  input: {
    projectRoot: string;
    worktreeId: string | null;
    sessionId: string | null;
    agentId: string | null;
    files: string[];
  };
  advice: CoordinationAdvice[];
}

export interface AdvisorDeps {
  resurrection?: {
    pending(options?: { project?: string; stack?: string }): unknown;
  };
  messaging?: {
    discoverChannels(options?: {
      projectDir?: string | null;
      query?: string | null;
      includeObserved?: boolean;
    }): unknown;
  };
}

interface SessionRow {
  id: string;
  purpose: string;
  status: string;
  agent_id: string | null;
  worktree_id: string | null;
  identity_project: string | null;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

interface ClaimRow extends SessionRow {
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  symbol: string | null;
  symbol_path: string | null;
  claimed_at: number;
  session_id: string;
  purpose: string;
  agent_id: string | null;
  forest_claim_id: number | null;
  forest_repo_id: string | null;
  forest_world_kind: string | null;
  forest_world_id: string | null;
}

interface ClaimScope {
  repoId: string;
  worldId: string;
  root: string;
}

interface ProjectedClaim extends ClaimRow {
  relativePath: string;
  absolutePath: string;
}

interface SymbolSummary {
  count: number;
  examples: string[];
}

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
const LOCKISH_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)bun\.lockb?$/,
  /(^|\/)migrations?\//,
  /(^|\/)schema\.(sql|ts|js)$/,
  /(^|\/)features\.manifest\.json$/,
  /(^|\/)docs\/openapi\.yaml$/,
];

function compact(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(compact).filter((value): value is string => Boolean(value)))];
}

/**
 * Resolve existing ancestors so new files still respect symlink boundaries.
 * The design deliberately returns no witness on permission or filesystem errors.
 * @param path - Absolute or relative local path to canonicalize.
 * @returns Physical path, including any not-yet-created suffix, or null.
 */
function canonicalPath(path: string): string | null {
  const suffix: string[] = [];
  let ancestor = resolve(path);
  for (;;) {
    try {
      return resolve(realpathSync(ancestor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      const parent = dirname(ancestor);
      if (parent === ancestor) return null;
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

/**
 * Build one root-relative address without basename or suffix matching. Rejecting
 * traversal before normalization prevents it from masquerading as a safe claim.
 * @param root - Canonical worktree root, not a repository display name.
 * @param file - Stored or requested path, relative to that root when not absolute.
 * @returns Separate claim and symbol-index addresses, or null outside the root.
 */
function projectFile(root: string, file: string): { relativePath: string; absolutePath: string } | null {
  if (file.includes('\0') || file.split(/[\\/]/).includes('..')) return null;
  const absolutePath = canonicalPath(isAbsolute(file) ? file : resolve(root, file));
  if (!absolutePath) return null;
  const relativePath = relative(root, absolutePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return null;
  return { relativePath, absolutePath };
}

/**
 * Decode only the recorded anchor; this read never repairs historical metadata.
 * @param session - Durable session row whose root/id must agree with the request.
 * @returns Canonical recorded anchor or null when it cannot be established.
 */
function sessionAnchor(session: SessionRow): { root: string; id: string } | null {
  try {
    const anchor = JSON.parse(session.metadata ?? 'null')?.worktree;
    const id = compact(anchor?.id);
    const root = compact(anchor?.root);
    const canonicalRoot = root && isAbsolute(root) ? canonicalPath(root) : null;
    return id && canonicalRoot ? { id, root: canonicalRoot } : null;
  } catch {
    return null;
  }
}

/**
 * Require the repository partition, exact world, and physical root together.
 * Root equality prevents even a colliding short world id from crossing repos.
 * @param session - Candidate recorded session.
 * @param scope - Caller scope derived from current Git evidence.
 * @returns Whether all recorded context witnesses agree.
 */
function sessionMatchesScope(session: SessionRow, scope: ClaimScope): boolean {
  const anchor = sessionAnchor(session);
  return (compact(session.identity_project) ?? 'local') === scope.repoId
    && session.worktree_id === scope.worldId
    && anchor?.id === scope.worldId
    && anchor.root === scope.root;
}

/**
 * Keep the forest's stored world authoritative when a projection row exists.
 * Legacy rows without a forest record remain readable under verified session scope.
 * @param claim - Read-only joined legacy/forest claim.
 * @param scope - Exact repository and worktree being evaluated.
 * @returns Whether the stored forest address agrees, without relabeling it.
 */
function forestMatchesScope(claim: ClaimRow, scope: ClaimScope): boolean {
  return claim.forest_claim_id === null || (
    claim.forest_repo_id === scope.repoId
    && claim.forest_world_kind === 'worktree'
    && claim.forest_world_id === scope.worldId
  );
}

function isCodeFile(filePath: string): boolean {
  return CODE_EXTENSIONS.has(extname(filePath));
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table) as { name: string } | undefined;
  return Boolean(row);
}

function normalizePending(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const candidate = raw as { agents?: unknown[]; pending?: unknown[] };
  if (Array.isArray(candidate.agents)) return candidate.agents;
  if (Array.isArray(candidate.pending)) return candidate.pending;
  return [];
}

function normalizeChannels(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return [];
  const candidate = raw as { channels?: Array<Record<string, unknown>> };
  return Array.isArray(candidate.channels) ? candidate.channels : [];
}

function taskSuggestsChannels(task: string | null, includeChannels?: boolean): boolean {
  if (includeChannels) return true;
  if (!task) return false;
  return /\b(pub|sub|publish|subscribe|broadcast|watch|channel|signal|handoff|fleet|agent|inbox|notify)\b/i.test(task);
}

function taskSuggestsTuple(task: string | null, includeTupleHints?: boolean): boolean {
  if (includeTupleHints) return true;
  if (!task) return false;
  return /\b(decision|finding|handoff|blocker|roadmap|task|todo|claim|coordination|memory|context)\b/i.test(task);
}

function projectFromInput(input: AdvisorInput, session?: SessionRow | null): string | null {
  return compact(input.project) ?? compact(session?.identity_project);
}

function summarizeAdvice(advice: CoordinationAdvice[]): string {
  if (advice.length === 0) return 'No coordination hazards found.';
  const critical = advice.filter(item => item.severity === 'critical').length;
  const warnings = advice.filter(item => item.severity === 'warning').length;
  const infos = advice.filter(item => item.severity === 'info').length;
  return `${critical} critical, ${warnings} warning, ${infos} info recommendation${advice.length === 1 ? '' : 's'}.`;
}

function advice(
  fields: Omit<CoordinationAdvice, 'confidence'> & { confidence?: number }
): CoordinationAdvice {
  return {
    ...fields,
    confidence: clampConfidence(fields.confidence ?? 0.8),
  };
}

export function createAdvisor(db: Database.Database, deps: AdvisorDeps = {}) {
  const tables = {
    sessions: hasTable(db, 'sessions'),
    sessionFiles: hasTable(db, 'session_files'),
    symbols: hasTable(db, 'symbols'),
    parsedFiles: hasTable(db, 'parsed_files'),
    claimForest: hasTable(db, 'claim_forest_claims') && hasTable(db, 'claim_forest_nodes'),
  };

  function getSession(sessionId: string | null): SessionRow | null {
    if (!sessionId || !tables.sessions) return null;
    const row = db.prepare(
      `SELECT id, purpose, status, agent_id, worktree_id, identity_project, created_at, updated_at, metadata
       FROM sessions WHERE id = ?`
    ).get(sessionId) as SessionRow | undefined;
    return row ?? null;
  }

  /**
   * Purpose: never substitute globally active sessions when local scope is absent.
   * @param scope - Current verified worktree and repository partition.
   * @returns At most twenty exact-root sessions in recency order.
   */
  function activeSessions(scope: ClaimScope | null): SessionRow[] {
    if (!tables.sessions || !scope) return [];
    const rows = db.prepare(
      `SELECT id, purpose, status, agent_id, worktree_id, identity_project, created_at, updated_at, metadata
       FROM sessions
       WHERE status = 'active' AND worktree_id = ?
         AND COALESCE(NULLIF(TRIM(identity_project), ''), 'local') = ?
       ORDER BY updated_at DESC`
    ).all(scope.worldId, scope.repoId) as SessionRow[];
    return rows.filter(row => sessionMatchesScope(row, scope)).slice(0, 20);
  }

  /**
   * Read claims only by an exact session or repository/world tuple. Path
   * projection happens after this boundary, never over a global filename scan.
   * @param scope - Current repository/world, required for peer queries.
   * @param sessionId - Exact recorded session for diagnostic-only inspection.
   * @returns Original claim and context witnesses, preserving every selector.
   */
  function recordedClaims(scope: ClaimScope | null, sessionId?: string | null): ClaimRow[] {
    if (!tables.sessionFiles || !tables.sessions || (!scope && !sessionId)) return [];
    const clauses = ['sf.released_at IS NULL'];
    const args: string[] = [];
    if (sessionId) {
      clauses.push('s.id = ?');
      args.push(sessionId);
    } else if (scope) {
      clauses.push("s.status = 'active'", 's.worktree_id = ?', "COALESCE(NULLIF(TRIM(s.identity_project), ''), 'local') = ?");
      args.push(scope.worldId, scope.repoId);
    }
    const forestFields = tables.claimForest
      ? 'fc.id AS forest_claim_id, fn.repo_id AS forest_repo_id, fn.world_kind AS forest_world_kind, fn.world_id AS forest_world_id'
      : 'NULL AS forest_claim_id, NULL AS forest_repo_id, NULL AS forest_world_kind, NULL AS forest_world_id';
    const forestJoin = tables.claimForest
      ? `LEFT JOIN claim_forest_claims fc ON fc.legacy_session_file_id = sf.id
         LEFT JOIN claim_forest_nodes fn ON fn.id = fc.node_id`
      : '';
    return db.prepare(
      `SELECT sf.file_path, sf.start_line, sf.end_line, sf.symbol, sf.symbol_path, sf.claimed_at,
              s.id AS session_id, s.id, s.purpose, s.status, s.agent_id, s.worktree_id,
              s.identity_project, s.created_at, s.updated_at, s.metadata, ${forestFields}
       FROM session_files sf
       JOIN sessions s ON s.id = sf.session_id
       ${forestJoin}
       WHERE ${clauses.join(' AND ')}
       ORDER BY sf.claimed_at DESC`
    ).all(...args) as ClaimRow[];
  }

  function symbolSummary(filePath: string): SymbolSummary {
    if (!tables.symbols) return { count: 0, examples: [] };
    const rows = db.prepare(
      `SELECT symbol_path FROM symbols WHERE file_path = ? ORDER BY start_line LIMIT 5`
    ).all(filePath) as Array<{ symbol_path: string }>;
    return {
      count: rows.length === 5
        ? ((db.prepare('SELECT COUNT(*) AS count FROM symbols WHERE file_path = ?').get(filePath) as { count: number }).count)
        : rows.length,
      examples: rows.map(row => row.symbol_path),
    };
  }

  function symbolFreshness(filePath: string): 'missing' | 'stale' | 'fresh' | 'unknown' {
    if (!tables.parsedFiles || !isCodeFile(filePath)) return 'unknown';
    const row = db.prepare(
      'SELECT parsed_at FROM parsed_files WHERE file_path = ?'
    ).get(filePath) as { parsed_at: number } | undefined;
    if (!row) return 'missing';
    if (!existsSync(filePath)) return 'unknown';
    try {
      const modifiedAt = statSync(filePath).mtimeMs;
      return modifiedAt > row.parsed_at + 1000 ? 'stale' : 'fresh';
    } catch {
      return 'unknown';
    }
  }

  function evaluate(input: AdvisorInput = {}): AdvisorResult {
    const requestedRoot = resolve(compact(input.projectRoot) ?? process.cwd());
    const worktree = getWorktreeInfo(requestedRoot);
    const projectRoot = canonicalPath(worktree?.root ?? requestedRoot) ?? requestedRoot;
    const worktreeId = worktree?.id ?? null;
    const sessionId = compact(input.sessionId);
    const agentId = compact(input.agentId);
    const task = compact(input.task);
    const selectedSession = getSession(sessionId);
    const project = projectFromInput(input, selectedSession);
    const scope: ClaimScope | null = worktreeId ? { repoId: project ?? 'local', worldId: worktreeId, root: projectRoot } : null;
    const requestedFiles = uniqueStrings([...(input.files ?? []), ...(input.changedFiles ?? [])]);
    const projectedFiles = requestedFiles.map(file => ({ file, projected: projectFile(projectRoot, file) }));
    const files = [...new Set(projectedFiles.flatMap(item => item.projected ? [item.projected.absolutePath] : []))];
    const rejectedFiles = projectedFiles.filter(item => !item.projected).map(item => item.file);
    const active = activeSessions(scope);
    const ownRecordedClaims = selectedSession ? recordedClaims(null, selectedSession.id) : [];
    const scopedCandidates = scope ? recordedClaims(scope).filter(row => sessionMatchesScope(row, scope)) : [];
    const inconsistentClaims = scope ? scopedCandidates.filter(claim => !forestMatchesScope(claim, scope)) : [];
    const contextInconsistent = Boolean(selectedSession && scope && !sessionMatchesScope(selectedSession, scope))
      || inconsistentClaims.length > 0;
    const canProjectClaims = Boolean(scope) && !contextInconsistent
      && (!sessionId || Boolean(selectedSession && selectedSession.status === 'active'))
      && !(selectedSession && agentId && selectedSession.agent_id !== agentId);
    const output: CoordinationAdvice[] = [];

    if (!scope || contextInconsistent) {
      const anchor = selectedSession ? sessionAnchor(selectedSession) : null;
      const diagnosticClaims = contextInconsistent && inconsistentClaims.length > 0 ? inconsistentClaims : ownRecordedClaims;
      output.push(advice({
        id: contextInconsistent ? 'context.claim-scope-inconsistent' : 'context.claim-scope-unavailable',
        category: 'context',
        severity: 'critical',
        title: contextInconsistent ? 'Recorded claim scope disagrees with current context' : 'Current repository/worktree scope is not verified',
        why: 'Claim projection requires the current Git root, session root, repository partition, and stored worktree/forest world to agree. Recorded claims are preserved, not relabeled or reported as unclaimed.',
        risk: 'Treating inconsistent context as readiness could hide ownership or borrow claims from another repository or worktree.',
        confidence: 1,
        evidence: [
          { label: 'projectRoot', value: projectRoot, path: projectRoot },
          { label: 'worktreeId', value: worktreeId },
          { label: 'repositoryId', value: scope?.repoId ?? project },
          { label: 'sessionId', value: sessionId },
          { label: 'recordedWorktreeId', value: selectedSession?.worktree_id ?? null },
          { label: 'recordedRoot', value: anchor?.root ?? null },
          { label: 'recordedAnchorId', value: anchor?.id ?? null },
          { label: 'recordedClaimCount', value: ownRecordedClaims.length },
          { label: 'inconsistentForestClaimCount', value: inconsistentClaims.length },
          ...diagnosticClaims.slice(0, 8).flatMap(claim => [
            { label: 'recordedClaim', value: claim.file_path, path: claim.file_path },
            { label: 'recordedSelector', value: claim.symbol_path ?? claim.symbol ?? (claim.start_line !== null || claim.end_line !== null ? `${claim.start_line ?? ''}:${claim.end_line ?? ''}` : 'file') },
            { label: 'recordedWorld', value: claim.forest_world_id ?? claim.worktree_id },
          ]),
        ],
        actions: [
          { label: 'Inspect exact session and recorded claims', method: 'GET', path: sessionId ? `/sessions/${encodeURIComponent(sessionId)}` : '/sessions' },
          { label: 'Inspect current context without changing it', command: 'pd whoami --json' },
        ],
      }));
    }

    if (rejectedFiles.length > 0) {
      output.push(advice({
        id: 'context.files-outside-root', category: 'context', severity: 'critical',
        title: 'Requested paths cannot be projected inside this worktree',
        why: 'Outside-root paths, traversal, symlink escapes, and unresolved filesystem boundaries are not local claim addresses.',
        risk: 'A normalized basename or suffix could falsely borrow another repository\'s claim.',
        confidence: 1,
        evidence: rejectedFiles.slice(0, 8).map(file => ({ label: 'rejectedFile', value: file })),
        actions: [{ label: 'Inspect current context', command: 'pd whoami --json' }],
      }));
    }

    if (sessionId && !selectedSession) {
      output.push(advice({
        id: 'context.session-missing',
        category: 'context',
        severity: 'critical',
        title: 'Current session ID is not in daemon state',
        why: 'The caller supplied a session ID that the daemon cannot find. Notes, file claims, and done operations may fail or attach to the wrong context.',
        risk: 'Agents may believe they are coordinated while their writes are unaffiliated or rejected.',
        confidence: 0.98,
        evidence: [
          { label: 'sessionId', value: sessionId },
          { label: 'worktreeId', value: worktreeId },
        ],
        actions: [
          { label: 'Inspect live sessions', command: 'pd sessions --all --json' },
          { label: 'Start a fresh session if this one is stale', command: task ? `pd begin ${JSON.stringify(task)}` : 'pd begin "describe the work"' },
        ],
      }));
    }

    if (selectedSession && selectedSession.status !== 'active') {
      output.push(advice({
        id: 'context.session-inactive',
        category: 'context',
        severity: 'warning',
        title: 'Current session is not active',
        why: 'The supplied session exists, but it is no longer active. New claims or notes should not silently reuse it.',
        risk: 'Work may be recorded against a closed session, hiding current ownership.',
        evidence: [
          { label: 'sessionId', value: selectedSession.id },
          { label: 'status', value: selectedSession.status },
        ],
        actions: [
          { label: 'Start a new session', command: task ? `pd begin ${JSON.stringify(task)}` : 'pd begin "describe the work"' },
        ],
      }));
    }

    if (selectedSession && agentId && selectedSession.agent_id && selectedSession.agent_id !== agentId) {
      output.push(advice({
        id: 'context.agent-mismatch',
        category: 'context',
        severity: 'critical',
        title: 'Agent/session ownership mismatch',
        why: 'The caller agent ID does not match the agent recorded on the session.',
        risk: 'Done, notes, claims, and Arbiter checks can reject or misattribute the work.',
        confidence: 0.95,
        evidence: [
          { label: 'callerAgentId', value: agentId },
          { label: 'sessionAgentId', value: selectedSession.agent_id },
          { label: 'sessionId', value: selectedSession.id },
        ],
        actions: [
          { label: 'Confirm current context', command: 'pd whoami' },
          { label: 'List active sessions', command: 'pd sessions --status active --json' },
        ],
      }));
    }

    if (!sessionId && active.length > 0) {
      output.push(advice({
        id: 'context.no-current-session',
        category: 'context',
        severity: 'warning',
        title: 'Active sessions exist, but no current session was supplied',
        why: 'Port Daddy has active work in this worktree, but the caller did not provide an active session anchor.',
        risk: 'The next note or claim may fail, drift to another slot, or create duplicate sessions.',
        evidence: [
          { label: 'activeSessions', value: active.length },
          { label: 'newestSession', value: active[0]?.id ?? null },
          { label: 'newestPurpose', value: active[0]?.purpose ?? null },
        ],
        actions: [
          { label: 'Inspect current context', command: 'pd whoami' },
          { label: 'Choose a live session explicitly', command: 'pd sessions --status active --json' },
        ],
      }));
    }

    if (deps.resurrection) {
      try {
        const pending = normalizePending(deps.resurrection.pending(project ? { project } : undefined));
        if (pending.length > 0) {
          output.push(advice({
            id: 'salvage.pending',
            category: 'salvage',
            severity: pending.length > 5 ? 'warning' : 'info',
            title: 'Salvage queue has recoverable work',
            why: 'Dead or abandoned agents have recorded state that may overlap the new task.',
            risk: 'Starting fresh without salvage can duplicate work or lose useful crash residue.',
            evidence: [
              { label: 'pendingAgents', value: pending.length },
              { label: 'project', value: project },
            ],
            actions: [
              { label: 'Review salvage queue', command: project ? `pd salvage --project ${project}` : 'pd salvage' },
            ],
          }));
        }
      } catch {
        // Advisor should not fail because one substrate is unavailable.
      }
    }

    const requestedPaths = new Set(files.map(file => relative(projectRoot, file)));
    const projectedClaims: ProjectedClaim[] = canProjectClaims
      ? scopedCandidates.flatMap(claim => {
        const projected = projectFile(projectRoot, claim.file_path);
        return projected ? [{ ...claim, ...projected }] : [];
      }) : [];
    const activeClaims = projectedClaims.filter(claim => requestedPaths.has(claim.relativePath));
    const conflicts = activeClaims.filter(claim => !sessionId || claim.session_id !== sessionId);
    if (conflicts.length > 0) {
      output.push(advice({
        id: 'claims.conflicting-active-claims',
        category: 'claim',
        severity: 'warning',
        title: 'Requested files are already claimed',
        why: 'File claims are advisory, but overlapping claims should be inspected before editing.',
        risk: 'Concurrent edits can produce avoidable git conflicts or stale coordination decisions.',
        confidence: 0.9,
        evidence: conflicts.slice(0, 8).flatMap(claim => [
          {
            label: claim.symbol_path || claim.symbol ? 'claimedSymbol' : 'claimedFile',
            value: claim.symbol_path ?? claim.symbol ?? claim.absolutePath,
            path: claim.absolutePath,
          },
          { label: 'claimSessionId', value: claim.session_id },
          ...(claim.start_line !== null || claim.end_line !== null ? [
            { label: 'startLine', value: claim.start_line, path: claim.absolutePath },
            { label: 'endLine', value: claim.end_line, path: claim.absolutePath },
          ] : []),
        ]),
        actions: [
          { label: 'Inspect file ownership', command: files.length === 1 ? `pd who-owns ${files[0]}` : 'pd files' },
          { label: 'Prefer a symbol/region claim if overlap is narrow', command: 'pd session files add <file> --symbol-path <symbol>' },
        ],
      }));
    }

    if (canProjectClaims && sessionId && files.length > 0) {
      const sessionClaimedFiles = new Set(
        activeClaims
          .filter(claim => claim.session_id === sessionId)
          .map(claim => claim.absolutePath)
      );
      const unclaimed = files.filter(file => !sessionClaimedFiles.has(file));
      if (unclaimed.length > 0) {
        const first = unclaimed[0];
        const symbols = symbolSummary(first);
        const claimCommand = symbols.examples.length > 0
          ? `pd session files add ${first} --symbol-path ${symbols.examples[0]}`
          : `pd session files add ${first}`;
        output.push(advice({
          id: 'claims.unclaimed-requested-files',
          category: 'claim',
          severity: 'info',
          title: 'Requested files are not claimed by this session',
          why: 'The session is active, but at least one requested file is not attached to it yet.',
          risk: 'Other agents cannot see your intended edit scope.',
          evidence: unclaimed.slice(0, 8).map(file => ({ label: 'unclaimedFile', value: file, path: file })),
          actions: [
            { label: 'Claim the narrowest known scope', command: claimCommand },
          ],
        }));
      }
    }

    const wholeFile = projectedClaims.filter(claim => sessionId && claim.session_id === sessionId
      && claim.start_line === null && claim.end_line === null && claim.symbol_path === null && claim.symbol === null
      && (requestedFiles.length === 0 || requestedPaths.has(claim.relativePath)));
    const refinable = wholeFile
      .map(claim => ({ claim, symbols: symbolSummary(claim.absolutePath) }))
      .filter(item => item.symbols.count > 0);
    if (refinable.length > 0) {
      const item = refinable[0];
      output.push(advice({
        id: 'claims.refine-whole-file',
        category: 'claim',
        severity: 'info',
        title: 'Whole-file claims can probably be refined',
        why: 'The AST symbol index knows symbols in a file currently claimed as a whole file.',
        risk: 'Whole-file claims overstate contention and make unrelated agents back off unnecessarily.',
        evidence: [
          { label: 'file', value: item.claim.absolutePath, path: item.claim.absolutePath },
          { label: 'knownSymbols', value: item.symbols.count },
          { label: 'exampleSymbol', value: item.symbols.examples[0] ?? null },
        ],
        actions: [
          {
            label: 'Claim a symbol instead of the whole file',
            command: `pd session files add ${item.claim.absolutePath} --symbol-path ${item.symbols.examples[0]}`,
          },
        ],
      }));
    }

    const staleSymbols = files
      .filter(isCodeFile)
      .map(file => ({ file, freshness: symbolFreshness(file) }))
      .filter(item => item.freshness === 'missing' || item.freshness === 'stale');
    if (staleSymbols.length > 0) {
      const first = staleSymbols[0];
      output.push(advice({
        id: 'symbols.refresh-needed',
        category: 'symbol',
        severity: 'warning',
        title: 'Symbol index is missing or stale for requested code',
        why: 'Symbol/region claims and conflict prediction depend on current tree-sitter data.',
        risk: 'Agents may widen to whole-file claims or miss function-level contention.',
        confidence: 0.85,
        evidence: staleSymbols.slice(0, 8).map(item => ({
          label: item.freshness === 'missing' ? 'missingSymbolIndex' : 'staleSymbolIndex',
          value: item.file,
          path: item.file,
        })),
        actions: [
          {
            label: 'Refresh the first stale file',
            method: 'POST',
            path: '/symbols/parse',
            body: { files: [first.file] },
            command: `curl -X POST /symbols/parse -d '{"files":["${first.file}"]}'`,
          },
        ],
      }));
    }

    const lockCandidates = files.filter(file => LOCKISH_PATTERNS.some(pattern => pattern.test(file)));
    if (lockCandidates.length > 0) {
      const target = lockCandidates[0];
      output.push(advice({
        id: 'locks.non-mergeable-resource',
        category: 'lock',
        severity: 'warning',
        title: 'Use a lock for non-mergeable shared resources',
        why: 'This file type is commonly global, generated, schema-like, or otherwise expensive to merge by hand.',
        risk: 'Advisory file claims may not be enough for generated artifacts, manifests, migrations, or lockfiles.',
        evidence: lockCandidates.slice(0, 6).map(file => ({ label: 'lockCandidate', value: file, path: file })),
        actions: [
          { label: 'Acquire an exclusive resource lock', command: `pd lock ${target}` },
        ],
      }));
    }

    if (taskSuggestsChannels(task, input.includeChannels)) {
      const discovered = deps.messaging
        ? normalizeChannels(deps.messaging.discoverChannels({ projectDir: projectRoot, includeObserved: false }))
        : [];
      if (discovered.length === 0) {
        output.push(advice({
          id: 'channels.none-declared',
          category: 'channel',
          severity: 'info',
          title: 'Declare a project-scoped channel before pub/sub coordination',
          why: 'The task appears to involve signaling, but no declared channel was found for this worktree.',
          risk: 'Agents may publish on naked channels that leak across projects or worktrees.',
          evidence: [
            { label: 'projectRoot', value: projectRoot, path: projectRoot },
          ],
          actions: [
            { label: 'Declare a branch-scoped coordination channel', command: 'pd channels ensure swarm:general --scope branch --aliases general:swarm' },
          ],
        }));
      } else {
        const channel = discovered[0];
        output.push(advice({
          id: 'channels.use-declared-channel',
          category: 'channel',
          severity: 'info',
          title: 'Use declared channel names for pub/sub coordination',
          why: 'This worktree already has declared channel metadata; prefer logical names and let Port Daddy resolve the physical scoped channel.',
          risk: 'Raw physical channels are harder to read and easier to mis-scope.',
          evidence: discovered.slice(0, 5).map(entry => ({
            label: 'declaredChannel',
            value: String(entry.logicalName ?? entry.physicalName ?? 'unknown'),
          })),
          actions: [
            { label: 'Publish on the first declared logical channel', command: `pd pub ${String(channel.logicalName ?? channel.physicalName)} "message"` },
            { label: 'Inspect channels', command: 'pd channels discover' },
          ],
        }));
      }
    }

    if (taskSuggestsTuple(task, input.includeTupleHints)) {
      output.push(advice({
        id: 'tuples.record-durable-fact',
        category: 'tuple',
        severity: 'info',
        title: 'Record durable coordination facts as tuples',
        why: 'The task language suggests decisions, blockers, handoffs, or roadmap state that should be queryable by agents instead of buried in prose.',
        risk: 'Important context can become invisible to fleet actors and recovery tooling.',
        evidence: [
          { label: 'task', value: task },
        ],
        actions: [
          { label: 'Write a coordination tuple', command: 'pd tuple out fleet \'["finding","short summary","path-or-scope"]\'' },
          { label: 'Use say for note + tuple fanout', command: task ? `pd say ${JSON.stringify(task)} --pin` : 'pd say "short finding" --pin' },
        ],
      }));
    }

    return {
      success: true,
      generatedAt: Date.now(),
      summary: summarizeAdvice(output),
      input: {
        projectRoot,
        worktreeId,
        sessionId,
        agentId,
        files,
      },
      advice: output,
    };
  }

  return { evaluate };
}
