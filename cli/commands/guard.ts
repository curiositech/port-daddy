import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ui from '../utils/ui.js';
import { pdFetch, PORT_DADDY_URL, isDaemonRunning, type PdFetchResponse } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';
import { installGitShim, uninstallGitShim, SHIM_BIN_DIR } from '../utils/git-shim.js';
import type { CLIOptions } from '../types.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import { evaluateLeaseRent } from '../../lib/coast-guard/compulsion.js';
import { gatherCommitsSinceLastNote } from '../../lib/coast-guard/compulsion-facts.js';

/**
 * Destructive git verbs intercepted by the optional `~/.port-daddy/bin/git`
 * shim. Each verb maps to "all working-tree paths" for the purpose of the
 * coordination check — we don't try to predict which paths a `reset --hard`
 * will touch, we just consult the daemon for any active claim that would
 * be steamrolled.
 */
const DESTRUCTIVE_GIT_VERBS = new Set([
  'reset-hard',
  'checkout-paths',
  'clean-force',
  'add-all',
  // v2: extended after 2026-04-28 auto-stash incident on codex/pd-tube-tutorial.
  // The shim intercepts these before the working tree is touched; the daemon
  // evaluates active claims for any session and refuses if another session
  // owns affected files in enforce mode.
  'stash-push',
  'cherry-pick',
  'rebase',
]);

export const COORDINATION_GUARD_NAME = 'Coordination Guard';
export const GUARD_CONFIG_RELATIVE_PATH = '.portdaddy/coordination-guard.json';

const HOOK_START = '# >>> Port Daddy Coordination Guard';
const HOOK_END = '# <<< Port Daddy Coordination Guard';

export type CoordinationGuardMode = 'off' | 'warn' | 'enforce';

export interface CoordinationGuardConfig {
  name: typeof COORDINATION_GUARD_NAME;
  enabled: boolean;
  mode: Exclude<CoordinationGuardMode, 'off'>;
  requireSession: boolean;
  requireClaims: boolean;
  /** The compulsion (ADR-0050): every commit must publish a coordination note.
   *  When true, a commit left un-noted blocks the next commit. Default true —
   *  coordination is the price of the sandbox. */
  requireNotePerCommit: boolean;
  /** Coordination primitives must also leave a roadmap receipt. Source of truth
   *  is roadmap_items, not docs/ROADMAP.md. Default true: serious swarm work has
   *  to be visible in the maintained roadmap, not only in a branch diff. */
  requireRoadmapForCoordinationChanges: boolean;
  updatedAt?: string;
}

export interface GuardOwner {
  sessionId?: string | null;
  agentId?: string | null;
  purpose?: string | null;
  phase?: string | null;
}

export interface GuardRoadmapReceipt {
  slug: string;
  lastTouchedAt?: number | null;
  promotedByAgentId?: string | null;
  notes?: Array<{ at?: number | null; by?: string | null; text?: string | null }>;
}

export interface GuardViolation {
  code: string;
  severity: 'warning' | 'critical';
  message: string;
  file?: string;
  owners?: GuardOwner[];
}

export interface GuardCheckResult {
  success: boolean;
  passed: boolean;
  shouldBlock: boolean;
  mode: CoordinationGuardMode;
  enabled: boolean;
  files: string[];
  agentId?: string | null;
  sessionId?: string | null;
  violations: GuardViolation[];
  /** A read-only audit of an existing commit, never a veto of that commit. */
  postCommitAudit?: {
    commit: string | null;
    status: 'passed' | 'issues' | 'unverifiable' | 'off';
    /** The unchanged pre-commit evaluator's decision on these same facts. */
    preCommitWouldBlock: boolean;
    persistence: 'not-attempted';
  };
}

export const DEFAULT_GUARD_CONFIG: CoordinationGuardConfig = {
  name: COORDINATION_GUARD_NAME,
  enabled: false,
  mode: 'warn',
  requireSession: true,
  requireClaims: true,
  requireNotePerCommit: true,
  requireRoadmapForCoordinationChanges: true,
};

const ROADMAP_RECEIPT_WINDOW_MS = 24 * 60 * 60 * 1000;

const COORDINATION_ROADMAP_PATTERNS: RegExp[] = [
  /^cli\/commands\/(?:guard|roadmap|parley|quorum|agents|spawn|dispatch|sessions|attention)\.ts$/,
  /^routes\/(?:parley|quorum|roadmap|sessions|coordination|operator)\.ts$/,
  /^lib\/(?:parley|swarm-coordination|roadmap-[^/]+|roadmap-items|coordination-[^/]+|sessions|spawner|dispatch\/.+|obligation-monitor|commitments)\.ts$/,
  /^docs\/adr\/\d+-.+\.md$/,
  /^docs\/research\/.+\.md$/,
  /^skills\/port-daddy-agent-skill\/.+/,
  /^features\.manifest\.json$/,
];

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeMode(value: unknown, fallback: Exclude<CoordinationGuardMode, 'off'>): Exclude<CoordinationGuardMode, 'off'> {
  return value === 'enforce' || value === 'warn' ? value : fallback;
}

export function normalizeGuardConfig(raw: unknown): CoordinationGuardConfig {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    name: COORDINATION_GUARD_NAME,
    enabled: boolValue(input.enabled, DEFAULT_GUARD_CONFIG.enabled),
    mode: normalizeMode(input.mode, DEFAULT_GUARD_CONFIG.mode),
    requireSession: boolValue(input.requireSession, DEFAULT_GUARD_CONFIG.requireSession),
    requireClaims: boolValue(input.requireClaims, DEFAULT_GUARD_CONFIG.requireClaims),
    requireNotePerCommit: boolValue(input.requireNotePerCommit, DEFAULT_GUARD_CONFIG.requireNotePerCommit),
    requireRoadmapForCoordinationChanges: boolValue(
      input.requireRoadmapForCoordinationChanges,
      DEFAULT_GUARD_CONFIG.requireRoadmapForCoordinationChanges,
    ),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
  };
}

export function localGuardConfigPath(cwd = process.cwd()): string {
  return join(cwd, GUARD_CONFIG_RELATIVE_PATH);
}

function gitCommonDir(cwd = process.cwd()): string | null {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const resolved = result.stdout.trim();
  return resolved ? resolve(cwd, resolved) : null;
}

export function sharedGuardConfigPath(cwd = process.cwd()): string | null {
  const commonDir = gitCommonDir(cwd);
  return commonDir ? join(commonDir, 'port-daddy', 'coordination-guard.json') : null;
}

function configCandidatePaths(cwd = process.cwd()): string[] {
  const paths = [sharedGuardConfigPath(cwd), localGuardConfigPath(cwd)].filter((path): path is string => Boolean(path));
  return Array.from(new Set(paths));
}

function readGuardConfigFile(path: string): CoordinationGuardConfig | null {
  if (!existsSync(path)) return null;
  try {
    return normalizeGuardConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

export function readGuardConfig(cwd = process.cwd()): CoordinationGuardConfig {
  for (const path of configCandidatePaths(cwd)) {
    const config = readGuardConfigFile(path);
    if (config) return config;
  }
  return { ...DEFAULT_GUARD_CONFIG };
}

function configPath(cwd = process.cwd()): string {
  for (const path of configCandidatePaths(cwd)) {
    if (existsSync(path)) return path;
  }
  return sharedGuardConfigPath(cwd) ?? localGuardConfigPath(cwd);
}

function writeGuardConfig(config: CoordinationGuardConfig, cwd = process.cwd()): void {
  const stamped = JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2) + '\n';
  for (const path of configCandidatePaths(cwd)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stamped);
  }
}

function optionMode(options: CLIOptions): CoordinationGuardMode | undefined {
  if (options.enforce) return 'enforce';
  if (options.warn) return 'warn';
  if (options.off) return 'off';
  const mode = typeof options.mode === 'string' ? options.mode.trim() : '';
  if (mode === 'off' || mode === 'warn' || mode === 'enforce') return mode;
  return undefined;
}

function effectiveMode(config: CoordinationGuardConfig, options: CLIOptions = {}): CoordinationGuardMode {
  const explicit = optionMode(options);
  if (explicit) return explicit;
  return config.enabled ? config.mode : 'off';
}

function gitOutput(args: string[], cwd = process.cwd()): string[] {
  return gitText(args, cwd)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function gitText(args: string[], cwd = process.cwd()): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return '';
  return result.stdout;
}

function gitRoot(cwd = process.cwd()): string | null {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

function gitPath(path: string, cwd = process.cwd()): string | null {
  const result = spawnSync('git', ['rev-parse', '--git-path', path], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const resolved = result.stdout.trim();
  return resolved ? resolve(cwd, resolved) : null;
}

/**
 * Read Git evidence without converting failed discovery into an empty claim set.
 * The design keeps diagnostics fixed: arbitrary Git stderr is not authority.
 * @param args Read-only Git arguments, never shell-interpolated paths.
 * @param cwd The selected checkout, including a linked worktree.
 * @returns Complete stdout, preserving NUL-delimited native filenames.
 */
function stagedGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Guard cannot determine staged files: Git evidence is unavailable.');
  return result.stdout;
}

/**
 * Resolve every incoming parent from this worktree's merge metadata. The purpose
 * is to distinguish an absent merge from corrupt or unreadable merge evidence;
 * a failed ref lookup must never silently select ordinary-commit semantics.
 * @param cwd The selected checkout.
 * @returns Verified immutable commit IDs, or no parents when not merging.
 */
function mergeHeadShas(cwd: string): string[] {
  const path = stagedGit(['rev-parse', '--git-path', 'MERGE_HEAD'], cwd).trim();
  if (!path) throw new Error('Guard cannot determine staged files: merge location is unavailable.');
  let content: string;
  try {
    content = readFileSync(resolve(cwd, path), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('Guard cannot determine staged files: merge metadata is unreadable.');
  }
  const parents = content.trim().split(/\r?\n/);
  if (parents.some(parent => !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(parent))) {
    throw new Error('Guard cannot determine staged files: merge metadata is invalid.');
  }
  return [...new Set(parents)].map(parent =>
    stagedGit(['rev-parse', '--verify', '--end-of-options', `${parent}^{commit}`], cwd).trim());
}

/**
 * Discover paths authored by the pending commit, not either parent's unchanged
 * pass-through. A merge path is included only when its staged entry differs from
 * HEAD and every incoming parent, matching Git's combined-diff path semantics.
 * Compare exact paths without rename heuristics during merges: a real rename
 * resolution must retain its added destination and any newly deleted source.
 * Normal commits retain their ordinary cached-diff behavior, including unborn
 * branches. Unresolved indexes and unavailable evidence stop discovery.
 * @param cwd The checkout whose index will be committed.
 * @returns Exact repository-relative paths; no trimming or quote decoding.
 */
export function stagedFiles(cwd = process.cwd()): string[] {
  if (stagedGit(['ls-files', '--unmerged', '-z'], cwd)) {
    throw new Error('Guard cannot determine staged files: the index contains unresolved merges.');
  }
  const incoming = mergeHeadShas(cwd);
  const diffArgs = ['diff', '--cached', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--diff-filter=ACMRDTU'];
  if (incoming.length === 0) return stagedGit([...diffArgs, '--'], cwd).split('\0').filter(Boolean);

  const head = stagedGit(['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], cwd).trim();
  const changes = [head, ...incoming].map(parent =>
    new Set(stagedGit([...diffArgs, '--no-renames', parent, '--'], cwd).split('\0').filter(Boolean)));
  return [...changes[0]].filter(path => changes.every(paths => paths.has(path)));
}

/**
 * Files modified in a commit. Used by the post-commit hook so that
 * commits made via `git cherry-pick`, `git rebase`, `git revert`, or
 * `git merge` (none of which fire pre-commit) still get audited.
 */
function commitFiles(ref: string, cwd = process.cwd()): string[] {
  return gitOutput(
    ['show', '--name-only', '--no-renames', '--diff-filter=ACMRDTU', '--pretty=format:', ref],
    cwd,
  );
}

function normalizeFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter(file => file.length > 0)));
}

export function fileNeedsRoadmapReceipt(file: string): boolean {
  const normalized = posixPath(file).replace(/^\.\//, '');
  return COORDINATION_ROADMAP_PATTERNS.some((pattern) => pattern.test(normalized));
}

function noteMatchesAgent(
  note: { at?: number | null; by?: string | null },
  agentId: string | null | undefined,
  since: number,
): boolean {
  if (!agentId) return false;
  return note.by === agentId && typeof note.at === 'number' && note.at >= since;
}

function receiptMatchesAgent(
  receipt: GuardRoadmapReceipt,
  agentId: string | null | undefined,
  since: number,
): boolean {
  const touchedRecently = typeof receipt.lastTouchedAt === 'number' && receipt.lastTouchedAt >= since;
  if (touchedRecently && agentId && receipt.promotedByAgentId === agentId) return true;
  return Array.isArray(receipt.notes) && receipt.notes.some((note) => noteMatchesAgent(note, agentId, since));
}

function posixPath(path: string): string {
  return path.split('\\').join('/');
}

function relativePathInside(root: string, path: string): string | null {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return posixPath(rel);
}

export function ownerQueryPaths(file: string, repoRoot = process.cwd()): string[] {
  if (!file) return [];

  const root = resolve(repoRoot);
  const paths = new Set<string>([file]);

  if (isAbsolute(file)) {
    const rel = relativePathInside(root, file);
    if (rel) paths.add(rel);
  } else {
    paths.add(resolve(root, file));
  }

  return Array.from(paths);
}

function mergeOwners(owners: GuardOwner[]): GuardOwner[] {
  const seen = new Set<string>();
  const merged: GuardOwner[] = [];
  for (const owner of owners) {
    const key = `${owner.sessionId ?? ''}\0${owner.agentId ?? ''}\0${owner.purpose ?? ''}\0${owner.phase ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(owner);
  }
  return merged;
}

function dirtyFiles(cwd = process.cwd()): string[] {
  const files: string[] = [];
  for (const line of gitText(['status', '--porcelain=v1'], cwd).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;
    if (rawPath.includes(' -> ')) {
      const [from, to] = rawPath.split(' -> ');
      files.push(from, to);
    } else {
      files.push(rawPath);
    }
  }
  return normalizeFiles(files);
}

function guardHookBlock(): string {
  return [
    HOOK_START,
    'if command -v pd >/dev/null 2>&1; then',
    '  pd guard check --staged --hook || exit $?',
    'elif command -v port-daddy >/dev/null 2>&1; then',
    '  port-daddy guard check --staged --hook || exit $?',
    'else',
    '  echo "Coordination Guard: pd command not found." >&2',
    '  exit 1',
    'fi',
    HOOK_END,
  ].join('\n');
}

/**
 * The post-commit block is a read-only audit after Git has created a commit.
 * Its purpose is to report outstanding coordination requirements without
 * pretending it can undo the successful Git operation. It neither publishes
 * a coordination note nor proves that another publisher persisted a receipt.
 * The pre-commit path still enforces all outstanding rent on the next commit.
 */
function guardPostCommitBlock(): string {
  return [
    HOOK_START,
    'if command -v pd >/dev/null 2>&1; then',
    '  pd guard check --post-commit --hook || true',
    'elif command -v port-daddy >/dev/null 2>&1; then',
    '  port-daddy guard check --post-commit --hook || true',
    'fi',
    HOOK_END,
  ].join('\n');
}

function mergeHookBlock(existing: string, block: string, defaultShebang = '#!/usr/bin/env sh'): string {
  const markerPattern = new RegExp(`${HOOK_START}[\\s\\S]*?${HOOK_END}`, 'm');
  if (markerPattern.test(existing)) {
    return existing.replace(markerPattern, block);
  }

  const normalized = existing.trimEnd();
  if (!normalized) return `${defaultShebang}\n\n${block}\n`;

  const exitMatch = normalized.match(/\nexit 0\s*$/);
  if (exitMatch?.index != null) {
    return `${normalized.slice(0, exitMatch.index)}\n\n${block}${normalized.slice(exitMatch.index)}\n`;
  }

  return `${normalized}\n\n${block}\n`;
}

export function mergePreCommitHook(existing: string): string {
  return mergeHookBlock(existing, guardHookBlock());
}

export function mergePostCommitHook(existing: string): string {
  return mergeHookBlock(existing, guardPostCommitBlock());
}

export function evaluateGuardFacts(input: {
  config: CoordinationGuardConfig;
  mode?: CoordinationGuardMode;
  files?: string[];
  active?: boolean;
  daemonReachable?: boolean;
  agentId?: string | null;
  sessionId?: string | null;
  ownersByFile?: Record<string, GuardOwner[]>;
  /** Commits on this lease that have no coordination note published after them.
   *  Supplied only at commit-time (staged/hook/post-commit). Drives the
   *  compulsion: no note, no commit (ADR-0050). */
  commitsSinceLastNote?: number;
  /** Set at commit-time when the daemon's coordination truth could NOT be read
   *  (daemon down / erroring). The note-per-commit invariant cannot be verified,
   *  so in enforce mode this fails CLOSED with a critical `rent-unverifiable`
   *  violation instead of silently allowing an un-noted commit. */
  rentUnverifiable?: boolean;
  /** True for staged/hook/post-commit checks. Roadmap compulsion is a commit
   *  invariant; dirty-tree advisory checks should not demand a roadmap receipt. */
  atCommitTime?: boolean;
  roadmapReceipts?: GuardRoadmapReceipt[];
  nowMs?: number;
}): GuardCheckResult {
  const mode = input.mode ?? (input.config.enabled ? input.config.mode : 'off');
  const files = normalizeFiles(input.files ?? []);
  const violations: GuardViolation[] = [];

  if (mode === 'off') {
    return {
      success: true,
      passed: true,
      shouldBlock: false,
      mode,
      enabled: false,
      files,
      agentId: input.agentId,
      sessionId: input.sessionId,
      violations,
    };
  }

  if (input.daemonReachable === false) {
    violations.push({
      code: 'daemon-unreachable',
      severity: 'critical',
      message: 'Port Daddy daemon is unreachable; live session and claim truth cannot be verified.',
    });
  }

  if (input.config.requireSession && !input.active) {
    violations.push({
      code: 'no-active-session',
      severity: 'critical',
      message: 'No active Port Daddy session is attached to this shell. Run pd begin before editing or committing.',
    });
  }

  if (input.config.requireClaims && input.active && files.length > 0) {
    for (const file of files) {
      const owners = input.ownersByFile?.[file] ?? [];
      const selfOwnsFile = owners.some(owner => owner.sessionId === input.sessionId);
      const otherOwners = owners.filter(owner => owner.sessionId && owner.sessionId !== input.sessionId);

      if (otherOwners.length > 0 && !selfOwnsFile) {
        violations.push({
          code: 'claimed-by-other-session',
          severity: 'critical',
          file,
          owners: otherOwners,
          message: `${file} is claimed by another active Port Daddy session.`,
        });
        continue;
      }

      if (!selfOwnsFile) {
        violations.push({
          code: 'unclaimed-file',
          severity: 'critical',
          file,
          owners,
          message: `${file} is not claimed by the active Port Daddy session.`,
        });
      }
    }
  }

  // The compulsion — coordination is the price of the sandbox (ADR-0050).
  // Every commit must publish a note; a commit left un-noted blocks the next
  // commit. Delegates to the single rent authority so the message and policy
  // live in one place; we feed it neutral values for the drift/idle facts so
  // ONLY the note-per-commit rule can fire here.
  if (
    input.config.requireNotePerCommit &&
    input.active &&
    typeof input.commitsSinceLastNote === 'number' &&
    input.commitsSinceLastNote > 0
  ) {
    const rent = evaluateLeaseRent({
      commitsSinceLastNote: input.commitsSinceLastNote,
      commitsTotal: input.commitsSinceLastNote,
      notesTotal: 1,
      claimsTotal: 1,
      commitsBehindBase: 0,
      ageMs: 0,
      lastSignalAgeMs: 0,
    });
    if (rent.action === 'block-commit') {
      violations.push({ code: 'rent-due', severity: 'critical', message: rent.reason });
    }
  }

  // Fail CLOSED when the note-per-commit invariant could not even be checked
  // because the daemon's coordination truth was unreadable at commit time. This
  // is the partial-failure hole the old fail-open rent gatherer left: a daemon
  // that is up-but-erroring (or down on the no-session path) must not wave an
  // un-noted commit through just because the count came back empty.
  if (input.config.requireNotePerCommit && input.active && input.rentUnverifiable) {
    violations.push({
      code: 'rent-unverifiable',
      severity: 'critical',
      message:
        'Coordination truth could not be read from the Port Daddy daemon at commit time; ' +
        'the note-per-commit invariant cannot be verified. Repair the daemon (pd doctor) and retry.',
    });
  }

  if (
    input.config.requireRoadmapForCoordinationChanges &&
    input.atCommitTime &&
    input.active
  ) {
    const roadmapFiles = files.filter(fileNeedsRoadmapReceipt);
    if (roadmapFiles.length > 0) {
      const since = (input.nowMs ?? Date.now()) - ROADMAP_RECEIPT_WINDOW_MS;
      const hasReceipt = (input.roadmapReceipts ?? []).some((receipt) =>
        receiptMatchesAgent(receipt, input.agentId, since),
      );
      if (!hasReceipt) {
        violations.push({
          code: 'roadmap-receipt-missing',
          severity: 'critical',
          file: roadmapFiles[0],
          message:
            `Coordination architecture changed (${roadmapFiles.slice(0, 3).join(', ')}${roadmapFiles.length > 3 ? ', …' : ''}) ` +
            'without a recent roadmap_items receipt from this agent. Run `pd roadmap upsert <slug> --summary <md>` or `pd roadmap touch <slug> --note <why>`.',
        });
      }
    }
  }

  const shouldBlock = mode === 'enforce' && violations.length > 0;
  return {
    success: !shouldBlock,
    passed: violations.length === 0,
    shouldBlock,
    mode,
    enabled: true,
    files,
    agentId: input.agentId,
    sessionId: input.sessionId,
    violations,
  };
}

async function fetchJson(path: string): Promise<Record<string, unknown>> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}${path}`);
  return await res.json();
}

async function loadActiveContext(cwd = process.cwd()): Promise<{
  active: boolean;
  daemonReachable: boolean;
  agentId?: string | null;
  sessionId?: string | null;
}> {
  const context = readCurrentContext(cwd);
  if (!context?.agentId && !context?.sessionId) {
    // No attached session — but OBSERVE daemon liveness rather than asserting it.
    // Previously this returned daemonReachable:true unconditionally, so a dead
    // daemon on the no-session path could never raise `daemon-unreachable`; the
    // door was invisible. Probe /health so enforce-mode fails closed on a down
    // daemon regardless of whether a session happens to be attached.
    const daemonReachable = await isDaemonRunning();
    return { active: false, daemonReachable };
  }

  const params = new URLSearchParams();
  if (context.agentId) params.set('agentId', context.agentId);
  if (context.sessionId) params.set('sessionId', context.sessionId);

  try {
    const data = await fetchJson(`/sugar/whoami?${params.toString()}`);
    return {
      active: data.active === true,
      daemonReachable: true,
      agentId: typeof data.agentId === 'string' ? data.agentId : context.agentId,
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : context.sessionId,
    };
  } catch {
    return {
      active: false,
      daemonReachable: false,
      agentId: context.agentId,
      sessionId: context.sessionId,
    };
  }
}

async function loadOwners(files: string[], repoRoot = process.cwd()): Promise<Record<string, GuardOwner[]>> {
  const ownersByFile: Record<string, GuardOwner[]> = {};
  for (const file of files) {
    const owners: GuardOwner[] = [];
    for (const queryPath of ownerQueryPaths(file, repoRoot)) {
      try {
        const data = await fetchJson(`/files/who-owns?path=${encodeURIComponent(queryPath)}`);
        if (Array.isArray(data.owners)) owners.push(...data.owners as GuardOwner[]);
      } catch {
        // Keep checking the alternate spelling. A daemon/API mismatch should not
        // erase owners found through the other canonical form.
      }
    }
    ownersByFile[file] = mergeOwners(owners);
  }
  return ownersByFile;
}

/**
 * Classify a BLOCKING guard result for operator escalation.
 *
 *   - 'structural' : the coordination layer itself could not be verified
 *     (daemon unreachable / no active session). This is the dangerous case —
 *     it is NOT a normal "you forgot to claim" block; an unattended agent that
 *     bypasses the hook here loses all coordination. Always escalated, loudly.
 *   - 'conflict'   : a file is claimed by ANOTHER active session — a real
 *     collision; the human should arbitrate.
 *   - 'requirement': a satisfiable coordination requirement (unclaimed file,
 *     note-per-commit rent, roadmap receipt). The agent can self-resolve.
 *
 * Pure + exported so the escalation policy is unit-tested without spawning
 * osascript. Returns null when the result is not a block.
 */
export type GuardBlockSeverity = 'structural' | 'conflict' | 'requirement';
export interface GuardBlockNotice {
  severity: GuardBlockSeverity;
  title: string;
  body: string;
  /** Whether to fire the operator (macOS) notification for this block. */
  notifyOperator: boolean;
}

export function describeGuardBlock(
  result: Pick<GuardCheckResult, 'shouldBlock' | 'violations' | 'postCommitAudit'>,
  context: { hook?: boolean; postCommit?: boolean } = {},
): GuardBlockNotice | null {
  // Audit findings cannot become a notification that the completed commit
  // failed, even if a caller passes the underlying pre-commit evaluation.
  if (context.postCommit || result.postCommitAudit) return null;
  if (!result.shouldBlock) return null;
  const codes = new Set(result.violations.map((v) => v.code));
  const structural =
    codes.has('daemon-unreachable') ||
    codes.has('no-active-session') ||
    codes.has('rent-unverifiable');
  const conflict = codes.has('claimed-by-other-session');
  const severity: GuardBlockSeverity = structural ? 'structural' : conflict ? 'conflict' : 'requirement';
  const first = result.violations[0]?.message ?? 'coordination requirement unmet';

  const title = structural
    ? 'Port Daddy: COORDINATION LAYER DOWN — commit blocked'
    : conflict
      ? 'Port Daddy: commit blocked — file owned by another agent'
      : 'Port Daddy: commit blocked by Coordination Guard';
  const body = structural
    ? `Coordination could not be verified (${first}). A human should repair the daemon/session — don't let this be worked around.`
    : first;

  // HITL escalation policy: ALWAYS notify on a structural failure (the daemon /
  // session is broken — the operator must know, especially for autonomous
  // agents). For ordinary conflicts/requirements only notify at real commit
  // time (the git hook), not on every manual `pd guard check` an agent runs
  // while iterating — that would be noise.
  const notifyOperator = severity === 'structural' || context.hook === true;
  return { severity, title, body, notifyOperator };
}

/**
 * HITL escalation for a blocked commit: a loud stderr banner plus a macOS
 * notification (with sound) so a HUMAN is alerted even when an autonomous
 * agent hit the wall — instead of the block being silently worked around.
 * Best-effort: never throws, never blocks the commit path; no-ops off macOS
 * (Linux/Windows operators rely on the stderr banner). `spawnSync` so the
 * banner fires before the caller's process.exit.
 */
function notifyOperatorOfGuardBlock(result: GuardCheckResult, options: CLIOptions): void {
  const notice = describeGuardBlock(result, {
    hook: Boolean(options.hook), postCommit: Boolean(options['post-commit']),
  });
  if (!notice || !notice.notifyOperator) return;

  // Loud stderr banner — points only to the corrective action, never names a
  // hook override (a refusal must not advertise its own bypass).
  ui.error(notice.title);
  if (notice.severity === 'structural') {
    console.error('  This is NOT a routine block — the coordination layer could not be verified.');
    console.error('  Repair it (restart/repair the daemon, re-run `pd begin`) and retry the commit.');
    console.error('  Escalating to the operator.');
  }

  if (process.platform === 'darwin') {
    try {
      const script = `display notification "${osaEscape(notice.body)}" with title "${osaEscape(notice.title)}" sound name "Basso"`;
      spawnSync('osascript', ['-e', script], { timeout: 5000 });
    } catch {
      // Notifier is best-effort; a failed banner must never break the commit path.
    }
  }
}

/** Escape a string for an AppleScript double-quoted literal (notifications are plain text). */
function osaEscape(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .slice(0, 240);
}

function printCheckResult(result: GuardCheckResult, options: CLIOptions): void {
  if (options.json || options.j) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.postCommitAudit) {
    const audit = result.postCommitAudit;
    if (!audit.commit) {
      ui.warn(`${COORDINATION_GUARD_NAME}: post-commit audit could not resolve the requested commit.`);
    } else {
      console.log(`Commit ${audit.commit} exists; this audit does not change the Git outcome.`);
      const status = audit.status === 'issues' ? 'needs attention' : audit.status;
      console.log(`${COORDINATION_GUARD_NAME}: post-commit audit ${status}`);
    }
    for (const violation of result.violations) {
      console.error(`  - ${violation.message}`);
      if (violation.owners?.length) {
        console.error(`    owners: ${violation.owners.map(owner => `${owner.agentId ?? 'unknown'}:${owner.sessionId ?? 'unknown'}`).join(', ')}`);
      }
    }
    if (audit.preCommitWouldBlock) {
      console.error('  Repair these findings before the next commit; pre-commit enforcement is unchanged.');
    }
    console.log('  Persistence: not attempted. This read-only audit does not publish a coordination note or receipt.');
    return;
  }

  const label = result.mode === 'enforce' ? 'ENFORCE' : result.mode === 'warn' ? 'WARN' : 'OFF';
  if (result.mode === 'off') {
    console.log(`${COORDINATION_GUARD_NAME}: off`);
    return;
  }

  if (result.passed) {
    console.log(`${COORDINATION_GUARD_NAME}: ${label} passed`);
    if (result.files.length > 0) console.log(`  checked: ${result.files.join(', ')}`);
    return;
  }

  const heading = `${COORDINATION_GUARD_NAME}: ${label} found ${result.violations.length} issue(s)`;
  if (result.shouldBlock) {
    ui.error(heading);
  } else {
    ui.warn(heading);
  }

  for (const violation of result.violations) {
    console.error(`  - ${violation.message}`);
    if (violation.owners && violation.owners.length > 0) {
      const owners = violation.owners
        .map(owner => `${owner.agentId ?? 'unknown'}:${owner.sessionId ?? 'unknown'}`)
        .join(', ');
      console.error(`    owners: ${owners}`);
    }
  }

  if (result.mode === 'warn') {
    console.error('  mode=warn: not blocking. Use pd guard enable --mode enforce to block.');
  }
}

/**
 * Preserve the evaluator's findings while separating an audit from a veto.
 * The design keeps all rent debt intact: the next pre-commit check evaluates
 * those facts normally. A missing commit is an audit-input failure, never proof
 * that an earlier Git operation failed. No persistence is performed here.
 * @param result The unchanged pre-commit policy evaluation.
 * @param commit A verified commit object id, or null when resolution failed.
 * @returns A post-commit report with explicit audit and persistence status.
 */
export function asPostCommitAudit(result: GuardCheckResult, commit: string | null): GuardCheckResult {
  const violations = commit ? result.violations : [...result.violations, {
    code: 'commit-unresolved',
    severity: 'critical' as const,
    message: 'The requested commit could not be verified; no Git outcome is asserted.',
  }];
  const unverifiable = violations.some(({ code }) =>
    ['commit-unresolved', 'daemon-unreachable', 'no-active-session', 'rent-unverifiable'].includes(code));
  return {
    ...result,
    success: commit !== null,
    passed: commit !== null && result.passed,
    shouldBlock: false,
    violations,
    postCommitAudit: {
      commit,
      status: unverifiable ? 'unverifiable' : result.mode === 'off' ? 'off' : result.passed ? 'passed' : 'issues',
      preCommitWouldBlock: result.shouldBlock,
      persistence: 'not-attempted',
    },
  };
}

export function extractClaimPaths(data: Record<string, unknown>): string[] {
  const files = Array.isArray(data.claims)
    ? data.claims
    : Array.isArray(data.files)
      ? data.files
      : [];
  const paths = new Set<string>();
  for (const entry of files) {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const path = record.filePath ?? record.file_path ?? record.path;
      if (typeof path === 'string' && path.trim()) paths.add(path.trim());
    }
  }
  return Array.from(paths);
}

async function loadAllActiveClaims(): Promise<string[]> {
  // Pulls every file currently claimed by an active session. Used by the
  // git-shim path: a destructive verb implicates the whole working tree,
  // so the universe of "things at risk" is the union of active claims.
  //
  // The Port Daddy daemon's claim DB is host-global — sessions across every
  // project share one namespace. Callers MUST filter this list with
  // `filterClaimsToRepo()` before treating the paths as "files about to be
  // touched," otherwise a claim on `apps/marketing/page.tsx` in some
  // unrelated repo blocks an unrelated rebase here. The long-term fix is
  // a `repo_root` column on `session_files` (denormalize from the parent
  // session's worktree) so the daemon can filter server-side; see
  // ADR follow-up after this hotfix.
  try {
    const data = await fetchJson('/files');
    return extractClaimPaths(data);
  } catch {
    return [];
  }
}

async function loadRoadmapReceipts(): Promise<GuardRoadmapReceipt[]> {
  try {
    const data = await fetchJson('/roadmap/items?status=all&limit=200');
    if (!Array.isArray(data.items)) return [];
    return data.items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        slug: typeof item.slug === 'string' ? item.slug : '',
        lastTouchedAt: typeof item.lastTouchedAt === 'number' ? item.lastTouchedAt : null,
        promotedByAgentId: typeof item.promotedByAgentId === 'string' ? item.promotedByAgentId : null,
        notes: Array.isArray(item.notes) ? item.notes as GuardRoadmapReceipt['notes'] : [],
      }))
      .filter((item) => item.slug);
  } catch {
    return [];
  }
}

/**
 * Drops claim paths that can't possibly belong to `repoRoot`.
 *
 * A claim path passes when both:
 *   (a) its absolute form resolves inside `repoRoot` (via the existing
 *       `relativePathInside` semantics — no escaping `..`), AND
 *   (b) the file exists on disk.
 *
 * This prevents cross-project claim leak: a session that claimed
 * `apps/marketing/page.tsx` in some other repo no longer pollutes the
 * destructive-verb check here. Conservative tradeoff: a claim on a file
 * that hasn't been created yet in this repo will be filtered out. For
 * destructive verbs that's acceptable — nobody has live edits on a
 * file that doesn't exist yet — and the alternative (keeping ghosts)
 * is the bug we're fixing.
 *
 * Both `repoRoot` and each candidate path are canonicalized via
 * `realpathSync` before the containment check. Without this, a symlink
 * pointing outside the repo would pass `resolve()`'s `..`-collapsing
 * check unchallenged and re-introduce the very leak this fixes. On
 * macOS, `/var` → `/private/var` makes this matter even for plain
 * paths under `os.tmpdir()`.
 */
export function filterClaimsToRepo(paths: string[], repoRoot: string): string[] {
  let root: string;
  try {
    root = realpathSync(resolve(repoRoot));
  } catch {
    // Repo root doesn't exist or isn't resolvable — no claims belong here.
    return [];
  }
  return paths.filter(path => {
    const trimmed = path.trim();
    if (!trimmed) return false;
    const abs = isAbsolute(trimmed) ? trimmed : resolve(root, trimmed);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      // Doesn't exist or unresolvable. `existsSync` was the prior bar,
      // and `realpathSync` throwing covers the same case plus broken
      // symlinks. Drop it.
      return false;
    }
    return relativePathInside(root, real) !== null;
  });
}

async function runCheck(positional: string[], options: CLIOptions): Promise<GuardCheckResult> {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const config = readGuardConfig(cwd);
  const mode = effectiveMode(config, options);
  const postCommit = Boolean(options['post-commit']);
  const gitVerb = typeof options['git-verb'] === 'string' ? String(options['git-verb']).trim() : '';
  const commitRef = typeof options.commit === 'string' && options.commit.length > 0 ? options.commit : 'HEAD';
  const root = gitRoot(cwd) ?? cwd;
  // Pin the object before reading its paths so a moving HEAD cannot relabel
  // evidence. --end-of-options prevents a ref from becoming a Git flag.
  const auditedCommit = postCommit
    ? gitText(['rev-parse', '--verify', '--end-of-options', `${commitRef}^{commit}`], cwd).trim() || null
    : null;
  if (postCommit && !auditedCommit) {
    return asPostCommitAudit({
      success: false, passed: false, shouldBlock: false,
      mode, enabled: mode !== 'off', files: [], violations: [],
    }, null);
  }
  const files = normalizeFiles(
    gitVerb && DESTRUCTIVE_GIT_VERBS.has(gitVerb)
      // For destructive verbs the universe of risk is "any claim that
      // exists right now AND belongs to this repo." We pull every active
      // claim from the daemon and then filter to ones that resolve inside
      // `root`. Without the filter, claims from sessions operating in
      // unrelated repos (PD's claim DB is host-global) produce false-
      // positive refusals on rebases here.
      ? filterClaimsToRepo(await loadAllActiveClaims(), root)
      : postCommit
        ? commitFiles(auditedCommit ?? commitRef, cwd)
        : options.staged || options.hook
          ? stagedFiles(cwd)
          : positional.length > 0
            ? positional
            : dirtyFiles(cwd),
  );
  const context = await loadActiveContext(cwd);
  const ownersByFile = mode === 'off' || files.length === 0 ? {} : await loadOwners(files, root);

  // Rent is only assessed at commit-time (staged / hook / post-commit), never on
  // a plain dirty-tree advisory check — you owe a note for a *commit*, not for
  // unsaved edits. Compute it only when the guard is live and a session is
  // attached. An unreadable probe remains a critical finding; post-commit only
  // changes how the result is reported, never the rent calculation.
  const atCommitTime = Boolean(options.staged || options.hook || postCommit);
  let commitsSinceLastNote: number | undefined;
  let rentUnverifiable = false;
  if (
    mode !== 'off' && atCommitTime && config.requireNotePerCommit && context.active && context.sessionId
  ) {
    const probe = await gatherCommitsSinceLastNote(context.sessionId, root);
    if (probe.ok) {
      commitsSinceLastNote = probe.commitsSinceLastNote;
    } else {
      // Daemon coordination truth unreadable during a commit → fail CLOSED.
      rentUnverifiable = true;
    }
  }
  const roadmapReceipts =
    mode !== 'off' &&
    atCommitTime &&
    config.requireRoadmapForCoordinationChanges &&
    context.active &&
    files.some(fileNeedsRoadmapReceipt)
      ? await loadRoadmapReceipts()
      : undefined;

  const result = evaluateGuardFacts({
    config,
    mode,
    files,
    active: context.active,
    daemonReachable: context.daemonReachable,
    agentId: context.agentId,
    sessionId: context.sessionId,
    ownersByFile,
    commitsSinceLastNote,
    rentUnverifiable,
    atCommitTime,
    roadmapReceipts,
  });
  return postCommit ? asPostCommitAudit(result, auditedCommit) : result;
}

async function handleInstallShim(options: CLIOptions): Promise<void> {
  const ok = await requireConfirmation({
    summary: 'Guard install-shim will write ~/.port-daddy/bin/git that intercepts destructive git verbs (reset --hard, clean -f, stash push, cherry-pick, rebase). It alters how git behaves system-wide for your shell.',
    args: options as Record<string, unknown>,
  });
  if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

  const result = installGitShim();
  if (options.json || options.j) {
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
    return;
  }
  if (result.alreadyInstalled) {
    ui.info(`git shim already installed at ${result.path}`);
  } else {
    ui.success(`git shim installed at ${result.path}`);
  }
  ui.info(result.pathHint);
  ui.info('If a refusal is wrong, repair the active session, claims, or notes; otherwise escalate through the operator surface.');
}

async function handleUninstallShim(options: CLIOptions): Promise<void> {
  const ok = await requireConfirmation({
    summary: 'Guard uninstall-shim will remove ~/.port-daddy/bin/git. Destructive git verbs will no longer be intercepted; coordination relies on git hooks alone.',
    args: options as Record<string, unknown>,
  });
  if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

  const result = uninstallGitShim();
  if (options.json || options.j) {
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
    return;
  }
  if (result.removed) {
    ui.success(`git shim removed from ${result.path}`);
  } else {
    ui.info(`No git shim at ${result.path}`);
  }
  ui.info(`(directory ${SHIM_BIN_DIR} preserved)`);
}

function handleStatus(options: CLIOptions): void {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const config = readGuardConfig(cwd);
  const mode = config.enabled ? config.mode : 'off';
  const data = {
    success: true,
    name: COORDINATION_GUARD_NAME,
    enabled: config.enabled,
    mode,
    requireSession: config.requireSession,
    requireClaims: config.requireClaims,
    requireRoadmapForCoordinationChanges: config.requireRoadmapForCoordinationChanges,
    configPath: configPath(cwd),
  };

  if (options.json || options.j) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`${COORDINATION_GUARD_NAME}: ${mode}`);
  console.log(`  config: ${data.configPath}`);
  console.log(
    `  requires: ${config.requireSession ? 'active session' : 'session optional'}, ` +
    `${config.requireClaims ? 'file claims' : 'claims optional'}` +
    `${config.requireNotePerCommit ? ', a note per commit' : ''}` +
    `${config.requireRoadmapForCoordinationChanges ? ', roadmap receipts for coordination changes' : ''}`,
  );
  console.log('  install hook: pd guard install');
  console.log('  check now:    pd guard check --staged');
}

async function enableGuard(options: CLIOptions): Promise<void> {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const requested = optionMode(options);
  const mode = requested === 'warn' || requested === 'enforce' ? requested : 'enforce';

  const ok = await requireConfirmation({
    summary: `Guard enable will set ${COORDINATION_GUARD_NAME} to ${mode} mode for this worktree. Other agents committing in this repo will be gated by the same policy.`,
    args: options as Record<string, unknown>,
  });
  if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

  const config = normalizeGuardConfig({
    ...readGuardConfig(cwd),
    enabled: true,
    mode,
    requireSession: options['no-session'] ? false : true,
    requireClaims: options['no-claims'] ? false : true,
  });
  writeGuardConfig(config, cwd);
  ui.success(`${COORDINATION_GUARD_NAME} enabled in ${mode} mode`);
}

async function disableGuard(options: CLIOptions): Promise<void> {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());

  const ok = await requireConfirmation({
    summary: `Guard disable will turn off ${COORDINATION_GUARD_NAME} enforcement in this worktree. Commits will no longer be gated by session/claim discipline.`,
    args: options as Record<string, unknown>,
  });
  if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

  const config = normalizeGuardConfig({ ...readGuardConfig(cwd), enabled: false });
  writeGuardConfig(config, cwd);
  ui.success(`${COORDINATION_GUARD_NAME} disabled`);
}

async function installGuard(options: CLIOptions): Promise<void> {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const root = gitRoot(cwd);
  if (!root) {
    ui.error('Not inside a git repository; cannot install guard hooks.');
    process.exit(1);
  }

  const requestedMode = optionMode(options);
  const mode = requestedMode === 'warn' || requestedMode === 'enforce' ? requestedMode : 'enforce';

  const ok = await requireConfirmation({
    summary: `Guard install will write pre-commit and post-commit hooks into ${root}/.git/hooks. Any existing hooks will be merged. Mode: ${requestedMode === 'off' ? 'off (hooks-only)' : mode}.`,
    args: options as Record<string, unknown>,
  });
  if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

  if (requestedMode !== 'off') {
    const config = normalizeGuardConfig({ ...readGuardConfig(cwd), enabled: true, mode });
    writeGuardConfig(config, cwd);
  }

  const hooks: Array<{ name: string; merge: (existing: string) => string }> = [
    { name: 'pre-commit', merge: mergePreCommitHook },
    // Read-only audit; it cannot veto commits already created by Git.
    { name: 'post-commit', merge: mergePostCommitHook },
  ];

  for (const hook of hooks) {
    const hookPath = gitPath(`hooks/${hook.name}`, cwd);
    if (!hookPath) {
      ui.error(`Could not resolve git ${hook.name} hook path.`);
      process.exit(1);
    }
    const existing = existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '';
    mkdirSync(dirname(hookPath), { recursive: true });
    writeFileSync(hookPath, hook.merge(existing));
    chmodSync(hookPath, 0o755);
    ui.success(`${COORDINATION_GUARD_NAME} installed in ${hookPath}`);
  }

  if (requestedMode === 'off') ui.warn('Guard hooks are installed but local config is disabled.');
}

function printUsage(): void {
  console.log(`Usage: pd guard <status|check|enable|disable|install|install-shim> [files...]`);
  console.log('');
  console.log('Controls:');
  console.log('  pd guard status');
  console.log('  pd guard enable --mode enforce');
  console.log('  pd guard enable --mode warn');
  console.log('  pd guard check --staged');
  console.log('  pd guard check src/file.ts');
  console.log('  pd guard check --git-verb reset-hard      # consult before destructive verbs');
  console.log('  # also: checkout-paths, clean-force, add-all, stash-push, cherry-pick, rebase');
  console.log('  pd guard install --mode enforce           # pre-commit + post-commit hooks');
  console.log('  pd guard install-shim                     # ~/.port-daddy/bin/git wrapper');
  console.log('  pd guard uninstall-shim');
}

export async function handleGuard(positional: string[], options: CLIOptions): Promise<void> {
  const subcommand = positional[0] || 'status';
  const rest = positional.slice(1);
  if (options['post-commit'] && (subcommand !== 'check' || options.staged || options['git-verb'] || rest.length > 0)) {
    ui.error('Post-commit audit requires guard check and cannot be combined with staged, destructive-verb, or file checks.');
    process.exit(1);
  }

  switch (subcommand) {
    case 'status':
      handleStatus(options);
      return;
    case 'enable':
    case 'on':
      await enableGuard(options);
      return;
    case 'disable':
    case 'off':
      await disableGuard(options);
      return;
    case 'install':
      await installGuard(options);
      return;
    case 'install-shim':
    case 'shim-install':
      await handleInstallShim(options);
      return;
    case 'uninstall-shim':
    case 'shim-uninstall':
      await handleUninstallShim(options);
      return;
    case 'check': {
      const result = await runCheck(rest, options);
      printCheckResult(result, options);
      if (result.shouldBlock) {
        notifyOperatorOfGuardBlock(result, options);
        process.exit(1);
      }
      if (result.postCommitAudit && !result.success) process.exit(1);
      return;
    }
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;
    default: {
      const result = await runCheck(positional, options);
      printCheckResult(result, options);
      if (result.shouldBlock) {
        notifyOperatorOfGuardBlock(result, options);
        process.exit(1);
      }
      if (result.postCommitAudit && !result.success) process.exit(1);
    }
  }
}
