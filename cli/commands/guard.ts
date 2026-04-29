import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as ui from '../utils/ui.js';
import { pdFetch, PORT_DADDY_URL, type PdFetchResponse } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';
import type { CLIOptions } from '../types.js';

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
  updatedAt?: string;
}

export interface GuardOwner {
  sessionId?: string | null;
  agentId?: string | null;
  purpose?: string | null;
  phase?: string | null;
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
}

export const DEFAULT_GUARD_CONFIG: CoordinationGuardConfig = {
  name: COORDINATION_GUARD_NAME,
  enabled: false,
  mode: 'warn',
  requireSession: true,
  requireClaims: true,
};

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
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : undefined,
  };
}

function configPath(cwd = process.cwd()): string {
  return join(cwd, GUARD_CONFIG_RELATIVE_PATH);
}

function readGuardConfig(cwd = process.cwd()): CoordinationGuardConfig {
  const path = configPath(cwd);
  if (!existsSync(path)) return { ...DEFAULT_GUARD_CONFIG };
  try {
    return normalizeGuardConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { ...DEFAULT_GUARD_CONFIG };
  }
}

function writeGuardConfig(config: CoordinationGuardConfig, cwd = process.cwd()): void {
  const path = configPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2) + '\n');
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

function stagedFiles(cwd = process.cwd()): string[] {
  return gitOutput(['diff', '--cached', '--name-only', '--diff-filter=ACMRDTU'], cwd);
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
  return Array.from(new Set(files.map(file => file.trim()).filter(Boolean)));
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
  const trimmed = file.trim();
  if (!trimmed) return [];

  const root = resolve(repoRoot);
  const paths = new Set<string>([trimmed]);

  if (isAbsolute(trimmed)) {
    const rel = relativePathInside(root, trimmed);
    if (rel) paths.add(rel);
  } else {
    paths.add(resolve(root, trimmed));
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
 * The post-commit guard block. Git invokes post-commit on `commit`,
 * `cherry-pick`, `rebase`, `revert`, and `merge --no-ff` — every path
 * that creates a commit. post-commit's exit code is *informational*
 * (git ignores it), so this block:
 *   - prints loudly when a commit was made without coordination
 *   - never blocks (post-commit can't), but the violation is recorded
 *     by `pd guard check --post-commit` in the daemon log so the
 *     operator can see what slipped through pre-commit
 *
 * This is the only enforcement path for cherry-pick/rebase/revert,
 * which silently bypass pre-commit hooks in git's sequencer.
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
    return { active: false, daemonReachable: true };
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

function printCheckResult(result: GuardCheckResult, options: CLIOptions): void {
  if (options.json || options.j) {
    console.log(JSON.stringify(result, null, 2));
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

async function runCheck(positional: string[], options: CLIOptions): Promise<GuardCheckResult> {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const config = readGuardConfig(cwd);
  const mode = effectiveMode(config, options);
  const postCommit = Boolean(options['post-commit']);
  const commitRef = typeof options.commit === 'string' && options.commit.length > 0 ? options.commit : 'HEAD';
  const files = normalizeFiles(postCommit
    ? commitFiles(commitRef, cwd)
    : options.staged || options.hook
      ? stagedFiles(cwd)
      : positional.length > 0
        ? positional
        : dirtyFiles(cwd));
  const context = await loadActiveContext(cwd);
  const root = gitRoot(cwd) ?? cwd;
  const ownersByFile = mode === 'off' || files.length === 0 ? {} : await loadOwners(files, root);
  return evaluateGuardFacts({
    config,
    mode,
    files,
    active: context.active,
    daemonReachable: context.daemonReachable,
    agentId: context.agentId,
    sessionId: context.sessionId,
    ownersByFile,
  });
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
    configPath: configPath(cwd),
  };

  if (options.json || options.j) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`${COORDINATION_GUARD_NAME}: ${mode}`);
  console.log(`  config: ${data.configPath}`);
  console.log(`  requires: ${config.requireSession ? 'active session' : 'session optional'}, ${config.requireClaims ? 'file claims' : 'claims optional'}`);
  console.log('  install hook: pd guard install');
  console.log('  check now:    pd guard check --staged');
}

function enableGuard(options: CLIOptions): void {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const requested = optionMode(options);
  const mode = requested === 'warn' || requested === 'enforce' ? requested : 'enforce';
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

function disableGuard(options: CLIOptions): void {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const config = normalizeGuardConfig({ ...readGuardConfig(cwd), enabled: false });
  writeGuardConfig(config, cwd);
  ui.success(`${COORDINATION_GUARD_NAME} disabled`);
}

function installGuard(options: CLIOptions): void {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const root = gitRoot(cwd);
  if (!root) {
    ui.error('Not inside a git repository; cannot install guard hooks.');
    process.exit(1);
  }

  const requestedMode = optionMode(options);
  const mode = requestedMode === 'warn' || requestedMode === 'enforce' ? requestedMode : 'enforce';
  if (requestedMode !== 'off') {
    const config = normalizeGuardConfig({ ...readGuardConfig(cwd), enabled: true, mode });
    writeGuardConfig(config, cwd);
  }

  const hooks: Array<{ name: string; merge: (existing: string) => string }> = [
    { name: 'pre-commit', merge: mergePreCommitHook },
    // post-commit is the only enforcement path for cherry-pick / rebase /
    // revert, since git's sequencer skips pre-commit on those.
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
  console.log(`Usage: pd guard <status|check|enable|disable|install> [files...]`);
  console.log('');
  console.log('Controls:');
  console.log('  pd guard status');
  console.log('  pd guard enable --mode enforce');
  console.log('  pd guard enable --mode warn');
  console.log('  pd guard check --staged');
  console.log('  pd guard check src/file.ts');
  console.log('  pd guard install --mode enforce');
}

export async function handleGuard(positional: string[], options: CLIOptions): Promise<void> {
  const subcommand = positional[0] || 'status';
  const rest = positional.slice(1);

  switch (subcommand) {
    case 'status':
      handleStatus(options);
      return;
    case 'enable':
    case 'on':
      enableGuard(options);
      return;
    case 'disable':
    case 'off':
      disableGuard(options);
      return;
    case 'install':
      installGuard(options);
      return;
    case 'check': {
      const result = await runCheck(rest, options);
      printCheckResult(result, options);
      if (result.shouldBlock) process.exit(1);
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
      if (result.shouldBlock) process.exit(1);
    }
  }
}
