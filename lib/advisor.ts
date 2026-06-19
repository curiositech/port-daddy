/**
 * Coordination Advisor — deterministic suggestibility for agents and humans.
 *
 * This is deliberately not an LLM planner. It inspects the coordination
 * substrate Port Daddy already owns (sessions, file claims, symbols, salvage,
 * channels, tuples) and emits executable recommendations with evidence.
 */

import type Database from 'better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
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
}

interface ClaimRow {
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  symbol: string | null;
  symbol_path: string | null;
  claimed_at: number;
  session_id: string;
  purpose: string;
  agent_id: string | null;
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

function normalizeFiles(projectRoot: string, input: AdvisorInput): string[] {
  const raw = [...(input.files ?? []), ...(input.changedFiles ?? [])];
  return uniqueStrings(raw).map(file => isAbsolute(file) ? resolve(file) : resolve(projectRoot, file));
}

function isCodeFile(filePath: string): boolean {
  return CODE_EXTENSIONS.has(extname(filePath));
}

function placeholders(length: number): string {
  return Array.from({ length }, () => '?').join(', ');
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
  return compact(input.project) ?? session?.identity_project ?? null;
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
  };

  function getSession(sessionId: string | null): SessionRow | null {
    if (!sessionId || !tables.sessions) return null;
    const row = db.prepare(
      `SELECT id, purpose, status, agent_id, worktree_id, identity_project, created_at, updated_at
       FROM sessions WHERE id = ?`
    ).get(sessionId) as SessionRow | undefined;
    return row ?? null;
  }

  function activeSessions(worktreeId: string | null): SessionRow[] {
    if (!tables.sessions) return [];
    if (worktreeId) {
      return db.prepare(
        `SELECT id, purpose, status, agent_id, worktree_id, identity_project, created_at, updated_at
         FROM sessions
         WHERE status = 'active' AND worktree_id = ?
         ORDER BY updated_at DESC
         LIMIT 20`
      ).all(worktreeId) as SessionRow[];
    }
    return db.prepare(
      `SELECT id, purpose, status, agent_id, worktree_id, identity_project, created_at, updated_at
       FROM sessions
       WHERE status = 'active'
       ORDER BY updated_at DESC
       LIMIT 20`
    ).all() as SessionRow[];
  }

  function claimsForFiles(files: string[]): ClaimRow[] {
    if (!tables.sessionFiles || files.length === 0) return [];
    return db.prepare(
      `SELECT sf.file_path, sf.start_line, sf.end_line, sf.symbol, sf.symbol_path, sf.claimed_at,
              s.id AS session_id, s.purpose, s.agent_id
       FROM session_files sf
       JOIN sessions s ON s.id = sf.session_id
       WHERE sf.released_at IS NULL
         AND s.status = 'active'
         AND sf.file_path IN (${placeholders(files.length)})
       ORDER BY sf.claimed_at DESC`
    ).all(...files) as ClaimRow[];
  }

  function wholeFileClaims(sessionId: string | null, files: string[]): ClaimRow[] {
    if (!tables.sessionFiles) return [];
    const clauses = [
      "sf.released_at IS NULL",
      "s.status = 'active'",
      "sf.start_line IS NULL",
      "sf.end_line IS NULL",
      "sf.symbol_path IS NULL",
    ];
    const args: unknown[] = [];
    if (sessionId) {
      clauses.push('s.id = ?');
      args.push(sessionId);
    }
    if (files.length > 0) {
      clauses.push(`sf.file_path IN (${placeholders(files.length)})`);
      args.push(...files);
    }
    return db.prepare(
      `SELECT sf.file_path, sf.start_line, sf.end_line, sf.symbol, sf.symbol_path, sf.claimed_at,
              s.id AS session_id, s.purpose, s.agent_id
       FROM session_files sf
       JOIN sessions s ON s.id = sf.session_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY sf.claimed_at DESC
       LIMIT 20`
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
    const projectRoot = resolve(compact(input.projectRoot) ?? process.cwd());
    const worktree = getWorktreeInfo(projectRoot);
    const worktreeId = worktree?.id ?? null;
    const sessionId = compact(input.sessionId);
    const agentId = compact(input.agentId);
    const task = compact(input.task);
    const files = normalizeFiles(projectRoot, input);
    const selectedSession = getSession(sessionId);
    const active = activeSessions(worktreeId);
    const output: CoordinationAdvice[] = [];

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

    const project = projectFromInput(input, selectedSession);
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

    const activeClaims = claimsForFiles(files);
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
        evidence: conflicts.slice(0, 8).map(claim => ({
          label: claim.symbol_path ? 'claimedSymbol' : 'claimedFile',
          value: claim.symbol_path ?? claim.file_path,
          path: claim.file_path,
        })),
        actions: [
          { label: 'Inspect file ownership', command: files.length === 1 ? `pd who-owns ${files[0]}` : 'pd files' },
          { label: 'Prefer a symbol/region claim if overlap is narrow', command: 'pd session files add <file> --symbol-path <symbol>' },
        ],
      }));
    }

    if (sessionId && files.length > 0) {
      const sessionClaimedFiles = new Set(
        activeClaims
          .filter(claim => claim.session_id === sessionId)
          .map(claim => claim.file_path)
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

    const wholeFile = wholeFileClaims(sessionId, files);
    const refinable = wholeFile
      .map(claim => ({ claim, symbols: symbolSummary(claim.file_path) }))
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
          { label: 'file', value: item.claim.file_path, path: item.claim.file_path },
          { label: 'knownSymbols', value: item.symbols.count },
          { label: 'exampleSymbol', value: item.symbols.examples[0] ?? null },
        ],
        actions: [
          {
            label: 'Claim a symbol instead of the whole file',
            command: `pd session files add ${item.claim.file_path} --symbol-path ${item.symbols.examples[0]}`,
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
