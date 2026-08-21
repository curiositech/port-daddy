/**
 * Sanitized, opt-in observability for interactive Giant Squid hook invocations.
 *
 * The generated shell gate writes a compact tab-separated event stream. It is
 * intentionally unable to retain hook stdin, argv, stdout, stderr, prompts, or
 * tool payloads. This reader validates every field before exposing a timeline
 * to the CLI or FleetBar.
 */

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { PD_HOME } from '../../shared/paths.js';
import { SQUID_HOOK_DEADLINE_MS } from './hook-shape.js';

export const SQUID_HOOK_DEBUG_SCHEMA_VERSION = 1;
export { SQUID_HOOK_DEADLINE_MS };
export const SQUID_HOOK_DEBUG_MAX_BYTES = 2 * 1024 * 1024;
export const SQUID_HOOK_DEBUG_TRIM_BYTES = Math.floor(SQUID_HOOK_DEBUG_MAX_BYTES * 0.75);
const SQUID_HOOK_DEBUG_MAX_READ_BYTES = SQUID_HOOK_DEBUG_MAX_BYTES * 2;
const SQUID_HOOK_DEBUG_MAX_STEPS = 2_000;

export type SquidHookProvider = 'claude' | 'codex' | 'gemini' | 'agy' | 'unknown';
export type SquidHookPhase = 'turn' | 'edit' | 'trace';
export type SquidHookStepState = 'running' | 'overdue' | 'completed' | 'skipped' | 'blocked' | 'failed';

export interface SquidHookDebugPaths {
  enabled: string;
  events: string;
}

export interface SquidHookDebugStep {
  id: string;
  phase: SquidHookPhase;
  label: 'PD TURN' | 'PD EDIT' | 'PD TRACE';
  hook: string;
  state: SquidHookStepState;
  startedAt: string;
  expectedBy: string;
  finishedAt: string | null;
  durationMs: number | null;
  deadlineMs: number;
  outcome: string | null;
  exitCode: number | null;
  description: string;
}

export interface SquidHookDebugSession {
  id: string;
  runtimeSessionId: string;
  provider: SquidHookProvider;
  providerLabel: string;
  workspace: string;
  workspaceLabel: string;
  state: SquidHookStepState;
  startedAt: string;
  lastActivityAt: string;
  steps: SquidHookDebugStep[];
}

export interface SquidHookDebugSnapshot {
  schemaVersion: number;
  enabled: boolean;
  enabledAt: string | null;
  capturedAt: string;
  workspace: string | null;
  privacy: string;
  retention: { maxBytes: number; eventPath: string };
  sessions: SquidHookDebugSession[];
}

interface RawEvent {
  kind: 'start' | 'finish';
  runId: string;
  runtimeSessionId: string;
  provider: SquidHookProvider;
  phase: SquidHookPhase;
  hook: string;
  atMs: number;
  deadlineMs: number;
  outcome: string | null;
  exitCode: number | null;
  workspace: string;
}

export function squidHookDebugPaths(pdHome = PD_HOME): SquidHookDebugPaths {
  const dir = join(pdHome, 'squid');
  return {
    enabled: join(dir, 'debug.enabled'),
    events: join(dir, 'hook-events.log'),
  };
}

export function isSquidHookDebugEnabled(pdHome = PD_HOME): boolean {
  return existsSync(squidHookDebugPaths(pdHome).enabled);
}

export function enableSquidHookDebug(pdHome = PD_HOME): SquidHookDebugSnapshot {
  const paths = squidHookDebugPaths(pdHome);
  mkdirSync(dirname(paths.enabled), { recursive: true, mode: 0o700 });
  const enabledAt = new Date().toISOString();
  writeFileSync(paths.enabled, `${enabledAt}\n`, { mode: 0o600 });
  chmodSync(paths.enabled, 0o600);
  // A fresh capture is easier to reason about than a timeline containing stale
  // invocations from an earlier debugging session.
  writeFileSync(paths.events, '', { mode: 0o600 });
  chmodSync(paths.events, 0o600);
  return readSquidHookDebugSnapshot({ pdHome });
}

export function disableSquidHookDebug(pdHome = PD_HOME): SquidHookDebugSnapshot {
  rmSync(squidHookDebugPaths(pdHome).enabled, { force: true });
  return readSquidHookDebugSnapshot({ pdHome });
}

export function clearSquidHookDebugEvents(pdHome = PD_HOME): SquidHookDebugSnapshot {
  const paths = squidHookDebugPaths(pdHome);
  mkdirSync(dirname(paths.events), { recursive: true, mode: 0o700 });
  writeFileSync(paths.events, '', { mode: 0o600 });
  chmodSync(paths.events, 0o600);
  return readSquidHookDebugSnapshot({ pdHome });
}

export function readSquidHookDebugSnapshot(options: {
  pdHome?: string;
  cwd?: string;
  nowMs?: number;
} = {}): SquidHookDebugSnapshot {
  const pdHome = options.pdHome ?? PD_HOME;
  const paths = squidHookDebugPaths(pdHome);
  const nowMs = options.nowMs ?? Date.now();
  const workspace = options.cwd ? resolve(options.cwd) : null;
  const events = readEventTail(paths.events)
    .map(parseRawEvent)
    .filter((event): event is RawEvent => event !== null)
    .filter((event) => !workspace || isWithinWorkspace(event.workspace, workspace));

  const starts = new Map<string, RawEvent>();
  const finishes = new Map<string, RawEvent>();
  for (const event of events) {
    if (event.kind === 'start') starts.set(event.runId, event);
    else finishes.set(event.runId, event);
  }

  const paired = [...starts.values()]
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, SQUID_HOOK_DEBUG_MAX_STEPS)
    .map((start) => ({ start, finish: finishes.get(start.runId) ?? null }));
  const sessionsByKey = new Map<string, SquidHookDebugSession>();

  for (const { start, finish } of paired) {
    const step = buildStep(start, finish, nowMs);
    const key = `${start.provider}\u0000${start.runtimeSessionId}\u0000${start.workspace}`;
    const lastActivityMs = finish?.atMs ?? start.atMs;
    const existing = sessionsByKey.get(key);
    if (!existing) {
      sessionsByKey.set(key, {
        id: `${start.provider}-${start.runtimeSessionId}-${basename(start.workspace) || 'workspace'}`,
        runtimeSessionId: start.runtimeSessionId,
        provider: start.provider,
        providerLabel: providerLabel(start.provider),
        workspace: start.workspace,
        workspaceLabel: basename(start.workspace) || start.workspace,
        state: step.state,
        startedAt: iso(start.atMs),
        lastActivityAt: iso(lastActivityMs),
        steps: [step],
      });
      continue;
    }
    existing.steps.push(step);
    existing.state = dominantState(existing.steps.map((candidate) => candidate.state));
    const firstMs = Math.min(Date.parse(existing.startedAt), start.atMs);
    const latestMs = Math.max(Date.parse(existing.lastActivityAt), lastActivityMs);
    existing.startedAt = iso(firstMs);
    existing.lastActivityAt = iso(latestMs);
  }

  const enabled = existsSync(paths.enabled);
  const enabledAt = readEnabledAt(paths.enabled);
  return {
    schemaVersion: SQUID_HOOK_DEBUG_SCHEMA_VERSION,
    enabled,
    enabledAt,
    capturedAt: iso(nowMs),
    workspace,
    privacy: 'Sanitized timing only: no argv, environment snapshot, prompts, tool inputs, tool results, stdout, or stderr are captured.',
    retention: { maxBytes: SQUID_HOOK_DEBUG_MAX_BYTES, eventPath: paths.events },
    sessions: [...sessionsByKey.values()].sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)),
  };
}

function readEnabledAt(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, 'utf8').trim();
    return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  } catch {
    return null;
  }
}

function readEventTail(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - SQUID_HOOK_DEBUG_MAX_READ_BYTES);
    const length = size - start;
    if (length <= 0) return [];
    const fd = openSync(path, 'r');
    const buffer = Buffer.alloc(length);
    try {
      readSync(fd, buffer, 0, length, start);
    } finally {
      closeSync(fd);
    }
    let text = buffer.toString('utf8');
    if (start > 0) text = text.slice(Math.max(0, text.indexOf('\n') + 1));
    return text.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function parseRawEvent(line: string): RawEvent | null {
  const fields = line.split('\t');
  if (fields.length !== 12 || fields[0] !== 'v1') return null;
  const [, kindRaw, runId, runtimeSessionId, providerRaw, phaseRaw, hook, atRaw, deadlineRaw, outcomeRaw, exitRaw, workspaceB64] = fields;
  if (kindRaw !== 'start' && kindRaw !== 'finish') return null;
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(runId) || !/^[A-Za-z0-9._:-]{1,96}$/.test(runtimeSessionId)) return null;
  const provider = parseProvider(providerRaw);
  const phase = parsePhase(phaseRaw);
  if (!provider || !phase || !/^pd-hook-(prompt|pre-tool|post-tool)$/.test(hook)) return null;
  const atMs = Number(atRaw);
  const deadlineMs = Number(deadlineRaw);
  if (!Number.isSafeInteger(atMs) || atMs < 0 || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60_000) return null;
  const workspace = decodeWorkspace(workspaceB64);
  if (!workspace) return null;
  const outcome = outcomeRaw === '-' ? null : /^[a-z_]{1,48}$/.test(outcomeRaw) ? outcomeRaw : null;
  const exitCode = exitRaw === '-' ? null : Number(exitRaw);
  if (exitCode !== null && (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255)) return null;
  if (kindRaw === 'start' && (outcome !== null || exitCode !== null)) return null;
  if (kindRaw === 'finish' && (outcome === null || exitCode === null)) return null;
  return { kind: kindRaw, runId, runtimeSessionId, provider, phase, hook, atMs, deadlineMs, outcome, exitCode, workspace };
}

function parseProvider(value: string): SquidHookProvider | null {
  return ['claude', 'codex', 'gemini', 'agy', 'unknown'].includes(value) ? value as SquidHookProvider : null;
}

function parsePhase(value: string): SquidHookPhase | null {
  return ['turn', 'edit', 'trace'].includes(value) ? value as SquidHookPhase : null;
}

function decodeWorkspace(value: string): string | null {
  if (!/^[A-Za-z0-9+/=]{1,8192}$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (!decoded.startsWith('/') || decoded.length > 4096 || /[\u0000\r\n\t]/.test(decoded)) return null;
    return resolve(decoded);
  } catch {
    return null;
  }
}

function isWithinWorkspace(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

function buildStep(start: RawEvent, finish: RawEvent | null, nowMs: number): SquidHookDebugStep {
  const expectedByMs = start.atMs + start.deadlineMs;
  const state = stepState(start, finish, nowMs);
  const finishedAt = finish ? iso(finish.atMs) : null;
  return {
    id: start.runId,
    phase: start.phase,
    label: phaseLabel(start.phase),
    hook: start.hook,
    state,
    startedAt: iso(start.atMs),
    expectedBy: iso(expectedByMs),
    finishedAt,
    durationMs: finish ? Math.max(0, finish.atMs - start.atMs) : null,
    deadlineMs: start.deadlineMs,
    outcome: finish?.outcome ?? null,
    exitCode: finish?.exitCode ?? null,
    description: describeStep(start.phase, state, finish?.outcome ?? null, finish?.exitCode ?? null),
  };
}

function stepState(start: RawEvent, finish: RawEvent | null, nowMs: number): SquidHookStepState {
  if (!finish) return nowMs > start.atMs + start.deadlineMs ? 'overdue' : 'running';
  if (finish.outcome !== 'executed') return 'skipped';
  if (finish.exitCode === 0) return 'completed';
  if (finish.exitCode === 2) return 'blocked';
  return 'failed';
}

function describeStep(phase: SquidHookPhase, state: SquidHookStepState, outcome: string | null, exitCode: number | null): string {
  const first = phase === 'turn'
    ? 'PD TURN is gathering fresh coordination context before the agent begins this turn.'
    : phase === 'edit'
      ? 'PD EDIT is checking project ownership and destructive-command safety before mutation.'
      : 'PD TRACE is recording a compact coordination outcome after the tool without retaining its payload.';
  const second = state === 'running'
    ? 'It is still inside its configured deadline.'
    : state === 'overdue'
      ? 'No completion arrived by the deadline, so the hook is stalled or the host terminated it.'
      : state === 'completed'
        ? 'The hook completed normally.'
        : state === 'blocked'
          ? 'The hook deliberately blocked the operation because its safety check failed.'
          : state === 'failed'
            ? `The hook failed with exit status ${exitCode ?? 'unknown'}; the host should surface the actionable error.`
            : `The gate skipped the hook (${outcomeLabel(outcome)}) and allowed the tool to proceed.`;
  return `${first} ${second}`;
}

function outcomeLabel(outcome: string | null): string {
  switch (outcome) {
    case 'heartbeat_missing': return 'Port Daddy daemon heartbeat missing';
    case 'heartbeat_unreadable': return 'daemon heartbeat unreadable';
    case 'daemon_stale': return 'daemon heartbeat stale';
    case 'no_project': return 'not inside a Port Daddy project';
    case 'project_unreadable': return 'project root could not be resolved';
    case 'registry_missing': return 'Squid project registry missing';
    case 'project_disarmed': return 'this project is not armed';
    default: return outcome ?? 'inactive gate';
  }
}

function phaseLabel(phase: SquidHookPhase): SquidHookDebugStep['label'] {
  return phase === 'turn' ? 'PD TURN' : phase === 'edit' ? 'PD EDIT' : 'PD TRACE';
}

function providerLabel(provider: SquidHookProvider): string {
  switch (provider) {
    case 'claude': return 'Claude Code';
    case 'codex': return 'Codex';
    case 'gemini': return 'Gemini CLI';
    case 'agy': return 'Antigravity';
    default: return 'Unknown host';
  }
}

function dominantState(states: SquidHookStepState[]): SquidHookStepState {
  const priority: SquidHookStepState[] = ['overdue', 'running', 'failed', 'blocked', 'completed', 'skipped'];
  return priority.find((candidate) => states.includes(candidate)) ?? 'skipped';
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
