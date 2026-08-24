/**
 * Spawner Module — AI Agent Launcher
 *
 * Factory function createSpawner(deps) with methods:
 * - spawn(spec): Launch an AI agent (ollama/claude/gemini/codex/aider/custom)
 * - list(): List active spawned agents
 * - kill(agentId): Stop a spawned agent
 *
 * Auto-wires Port Daddy coordination (register/session/heartbeat/done) silently.
 */

import { randomBytes } from 'node:crypto';
import { spawn as spawnChild } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CostTracker } from './cost-tracker.js';
import { getEffectiveContextWindow } from './context-window-tracker.js';
import type { Counters } from './counters.js';
import type { Bonds } from './bonds.js';
import type { Harbors } from './harbors.js';
import type { Transcripts, TranscriptOutput, TranscriptMessage } from './transcripts.js';
import type { SpawnerHarborBridge } from './agent-harbor/spawner-bridge.js';
import { parseCodexTranscript, mapCodexStreamLine, type StructuredTurn } from './spawner/codex-transcript.js';
import { parseClaudeCodeTranscript, mapClaudeCodeStreamLine, extractClaudeCodeFinal, extractClaudeCodeUsage } from './spawner/cli-claude-code-transcript.js';
import { parseGeminiTranscript } from './spawner/gemini-transcript.js';
import { parseCloudflareTranscript } from './spawner/cloudflare-transcript.js';
import { assessBackendTelemetryPolicy } from './backend-telemetry-policy.js';
import { resolveModel } from './model-registry.js';
import { getSecret } from './secret-env.js';
import { cloudflareAdapter, ollamaAdapter, geminiAdapter } from './llm-call.js';
import { openaiAdapter, DEFAULT_OPENAI_MODEL, DEFAULT_OPENAI_TIMEOUT_MS } from './spawner/backends/openai.js';
import { groqAdapter, DEFAULT_GROQ_MODEL } from './spawner/backends/groq.js';
import { lmstudioAdapter, DEFAULT_LMSTUDIO_MODEL } from './spawner/backends/lmstudio.js';
import { deepseekAdapter, DEFAULT_DEEPSEEK_MODEL } from './spawner/backends/deepseek.js';
import { xaiAdapter, DEFAULT_XAI_MODEL } from './spawner/backends/xai.js';
import { spawnViaCliTube, type CliTubeTool, type TubeClientLike } from './spawner/backends/cli-tube.js';
import { withCoastGuard } from './spawner/coast-guard-runner.js';
import type { CoastGuardReceipt } from './coast-guard.js';
import { coastGuardStatus } from './coast-guard.js';
import { priceBond, classifyScope, scopeTierWritePolicy, pricedBondLogLines } from './bond-pricing.js';
import { getDaemonTcpUrl } from '../shared/daemon-discovery.js';
import { deriveAgentDisplayName } from './agent-names.js';
import { detectForcedCliBackend, getBackendCatalogEntry, resolveEffectiveSpawnBackend } from './backend-catalog.js';
import { cliBinarySearchPath, resolveCliBinary } from './cli-bin-dirs.js';
import { resolveFleetAgentRuntime, type FleetModelTier } from './fleet-runtime.js';
import { nativeHarnessSessionIdError } from './harness-session-id.js';
import {
  sameWorkspaceIdentity,
  type WorkspaceIdentity,
} from './workspace-identity.js';

// ─── Load .env.local for spawned agents ─────────────────────────────────────
// The daemon runs via launchd which has no shell env. Spawned agents need
// API keys that live in .env.local. Load once at module init.
// Only load from trusted locations: project root and home directory.
const __spawner_dirname = dirname(fileURLToPath(import.meta.url));
const _dotenvCache: Record<string, string> = {};
function loadDotenvOnce(): Record<string, string> {
  if (Object.keys(_dotenvCache).length > 0) return _dotenvCache;
  // Only two trusted locations: project root and home directory
  const projectRoot = join(__spawner_dirname, '..');
  const operatorHome = process.env.HOME || '';
  const searchFiles = [
    join(projectRoot, '.env.local'),
    join(projectRoot, '.env'),
    ...(operatorHome
      ? [
          join(operatorHome, '.env.local'),
          join(operatorHome, '.env'),
          // Portable fallback loaded into the daemon environment by
          // secret-env.ts. Coast Guard already denies the file on disk; its
          // keys must also be inventoried here so inherited values are scrubbed
          // from every subprocess child.
          join(operatorHome, '.port-daddy-env'),
        ]
      : []),
  ];
  const currentUid = process.getuid?.();
  for (const p of searchFiles) {
    if (!existsSync(p)) continue;
    // Verify file ownership — skip files not owned by current user
    if (currentUid !== undefined) {
      try {
        const st = statSync(p);
        if (st.uid !== currentUid) {
          console.warn(`[spawner] Skipping ${p}: owned by uid ${st.uid}, expected ${currentUid}`);
          continue;
        }
      } catch {
        continue; // stat failed — skip
      }
    }
    try {
      const lines = readFileSync(p, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        _dotenvCache[key] = val;
      }
    } catch { /* ignore read errors */ }
  }
  return _dotenvCache;
}

// =============================================================================
// Types
// =============================================================================

export type BackendOverrideSource = 'none' | 'env' | 'persisted' | 'preflight';

export interface NativeResumeSpec {
  /** Stable adapter family that owns the source harness session. */
  adapterFamily: string;
  /** Harness-owned session identifier. Never a Port Daddy transcript id. */
  sessionId: string;
  /** Canonical workspace device/inode witnessed immediately before this spawn. */
  workspaceIdentity?: WorkspaceIdentity;
}

// This literal union MUST stay the same SET as lib/backend-catalog.ts's
// KNOWN_BACKEND_IDS (the runtime single source of truth every VALID_BACKENDS
// check now derives from — ADR-0057). It can't be derived from that array at
// the type level without loosening BackendCatalogEntry.id to a literal union
// (a wider refactor across cost-tracker/readiness — tracked, not done here).
// DEFAULT_MODELS below is a `Record<SpawnSpec['backend'], string>`, so TS
// itself fails the build if this union and that map's keys diverge; treat
// that compile error as the drift signal.
export interface SpawnSpec {
  backend: 'ollama' | 'lmstudio' | 'claude' | 'claude-cli' | 'gemini' | 'cloudflare' | 'codex' | 'aider' | 'custom' | 'openai' | 'groq' | 'deepseek' | 'xai' | 'cli:claude-code' | 'cli:codex' | 'cli:agy' | 'cli:gemini' | 'cli:groq' | 'cli:grok';
  name?: string;        // human-readable display name
  model?: string;
  /** Requested backend before an operator/preflight override selected the runtime backend. */
  requestedBackend?: SpawnSpec['backend'];
  /** Requested model before an operator/preflight override selected the runtime model. */
  requestedModel?: string;
  /** Where a backend override came from, when the route/preflight layer already resolved it. */
  backendOverrideSource?: BackendOverrideSource;
  modelTier?: 'low' | 'mid' | 'high';
  identity?: string;   // PD semantic identity: project:stack:context
  purpose?: string;    // human-readable task description
  task: string;        // the prompt / task
  budgetUsd?: number; // per-launch hard spend cap; enforced after exact telemetry is recorded
  bondUsd?: number;    // per-spawn bond; slashed on misbehavior, refunded on clean exit
  harborName?: string; // optional override for bond-admission harbor
  files?: string[];    // for aider backend
  workdir?: string;
  /**
   * Canonical workspace device/inode that must still own `workdir` at the
   * child-launch boundary. Continuation routes use this for sanitized
   * successors that do not carry `nativeResume` state.
   */
  workspaceIdentity?: WorkspaceIdentity;
  // Opt-in for agents that MUST run in a repo's main checkout (working-tree
  // observers like the gardener, or genuinely read-only agents). When unset,
  // the spawner refuses to launch into a main checkout — see assessSpawnIsolation.
  allowSharedCheckout?: boolean;
  // Harbor-card capability set this spawn enters with (lib/harbor-tokens.ts
  // `cap[]` grammar). Drives THREE things consistently: the scope-proportional
  // bond price (lib/bond-pricing.ts), the harbor-entry capabilities, and the
  // Coast Guard write policy (a `read`-tier card → the child is physically
  // denied writes to its workdir; lib/bond-pricing.ts `scopeTierWritePolicy`).
  // When unset, defaults to `['spawn:agent', 'backend:<backend>']` — the
  // historical spawn caps, which classify as the `full`/amplifier tier, so the
  // default spawn is unchanged (writes allowed, full-tier bond).
  capabilities?: string[];
  env?: Record<string, string>;
  /**
   * Explicit caller/operator wallclock deadline in milliseconds. Meaning
   * differs by backend class:
   * - Subprocess/CLI backends (codex, aider, custom, cli:*, claude-cli) — hard
   *   SIGTERM→SIGKILL deadline for the child process. Unset = no wall clock;
   *   the child runs until it exits on its own (see runChild).
   * - In-process API backends — abort-signal bound on the request; unset
   *   falls back to DEFAULT_BACKEND_TIMEOUT_MS (see backendAbortSignal).
   */
  timeout?: number;
  allowedTools?: string;  // for claude-cli backend: tool permission string
  maxTokens?: number;     // for claude/claude-cli backends
  // Transcript provenance (fleet ships set these so the dashboard surfaces
  // "ship X handled PR Y on trigger Z"). All optional; standard /spawn HTTP
  // callers leave them unset and get generic spawn-driven transcripts.
  ship?: string;        // logical ship name (code-reviewer, qa, ...)
  trigger?: string;     // e.g. 'pull_request:opened' or 'manual'
  prNumber?: number;
  issueNumber?: number;
  systemPrompt?: string; // additional system message stored in transcript
  // ── Coast Guard (ADR-0050) ────────────────────────────────────────────────
  // Subprocess agents run under an OS sandbox + secret broker + hard egress cap
  // BY DEFAULT. Power users can opt a single spawn out with `coastGuard:false`
  // (documented; never advertised in agent-facing errors), or tune the caps.
  coastGuard?: boolean;     // default true — set false to opt this spawn out
  maxRequests?: number;     // hard egress request cap (default DEFAULT_MAX_REQUESTS)
  maxBytes?: number | null; // optional hard egress byte cap
  /** Estimated input prompt token count — used to gate spawn if it would exceed effective context. */
  estimatedPromptTokens?: number;
  /**
   * File-edit permission mode for the `cli:claude-code` backend. Forwarded to
   * the CLI as `--permission-mode <mode>` (only when set). `acceptEdits` lets a
   * spawned agent edit files in its `workdir` non-interactively;
   * `bypassPermissions` removes all gating. Unset = current behavior (the CLI's
   * default interactive gating). Ignored by backends that don't support it.
   */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions';
  /**
   * Optional stable tube channel the cli-tube backend publishes the agent
   * exchange on, so an operator can watch the run live (`pd tube <channel>`).
   * Dispatch sets this to `dispatch:<id>` (ADR-0060) so a folded dispatch keeps
   * the live observability the legacy inline adapter provided. When unset, the
   * cli-tube backend falls back to its per-invocation `cli:<tool>:<uuid>`
   * channel — same default sortie/orchestrator spawns have always used.
   */
  tubeChannel?: string;
  /**
   * Giant Squid Harness (ADR-0091) opt-in. When true, the `claude-cli` /
   * `cli:claude-code` launch first injects the pd-hook-* tentacles into the
   * workspace's `.claude/settings.json` (via lib/squid/adapter.ts) so the
   * UserPromptSubmit / PreToolUse / PostToolUse hooks fire inside Claude Code's
   * own loop. Off by default — existing spawns are byte-for-byte unchanged. The
   * actor identity used by the lock gate comes from `spec.identity` / PD_ACTOR.
   */
  injectSquidHooks?: boolean;
  /**
   * Resume a harness-owned session instead of creating a fresh one. The
   * spawner validates this against the EFFECTIVE backend after all operator
   * overrides so a cross-family override can never receive a foreign id.
   */
  nativeResume?: NativeResumeSpec;
}

export interface SpawnResult {
  agentId: string;
  name?: string;
  backend: SpawnSpec['backend'];
  model: string;
  requestedBackend?: SpawnSpec['backend'];
  effectiveBackend?: SpawnSpec['backend'];
  requestedModel?: string;
  effectiveModel?: string;
  backendOverrideSource?: BackendOverrideSource;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'over_budget';
  output: string | null;
  error: string | null;
  telemetry: SpawnTelemetry | null;
  startedAt: number;
  completedAt: number | null;
  /** Coast Guard receipt (ADR-0050) for subprocess backends; null otherwise. */
  coastGuard?: CoastGuardReceipt | null;
  /** Harness session preserved by a validated native-resume launch. */
  harnessSessionId?: string;
}

export interface SpawnTelemetry {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  costUsd: number;
  /** 'exact' = backend-reported token counts; 'estimated' = best-guess (~chars/4). */
  rateMode: 'exact' | 'estimated';
}

export interface SpawnedAgent {
  agentId: string;
  name: string;
  backend: SpawnSpec['backend'];
  model: string;
  requestedBackend?: SpawnSpec['backend'];
  effectiveBackend?: SpawnSpec['backend'];
  requestedModel?: string;
  effectiveModel?: string;
  backendOverrideSource?: BackendOverrideSource;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'over_budget';
  identity: string | null;
  purpose: string | null;
  startedAt: number;
  completedAt: number | null;
}

export interface TelemetryBypassApproval {
  humanConfirmed: true;
  confirmedBy: string;
  reason: string;
}

// Internal tracking record
interface AgentRecord extends SpawnedAgent {
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  childProcess: ChildProcess | null;
  bondId?: number | null;
  bondUsd?: number;
  /**
   * ADR-0040 daemon-minted actor credential returned by this agent's
   * `/sugar/begin` (#8877 / ADR-0122). `/sugar/done` (both the normal
   * completion path and kill()) must present it — attributed session writes
   * are rejected 401 without a verified credential.
   */
  actorCredential?: string | null;
}

export interface ResolvedSpawnRuntime {
  requestedBackend: SpawnSpec['backend'];
  effectiveBackend: SpawnSpec['backend'];
  requestedModel: string;
  effectiveModel: string;
  backendOverrideSource: BackendOverrideSource;
}

interface SpawnerDeps {
  costTracker?: CostTracker;
  counters?: Counters;
  bonds?: Bonds;
  harbors?: Harbors;
  /** Optional transcripts module. When wired, every spawn records its full
   *  conversation (system prompt + task + assistant output + tool calls) to
   *  the fleet_transcripts table. Surface for `pd transcripts ...` + UI. */
  transcripts?: Transcripts;
  /** Optional Agent Harbor bridge (lib/agent-harbor/spawner-bridge.ts). When
   *  wired, every spawn is registered as an Agent Harbor node and its
   *  transcript is hash-chained into the event ledger, and a real (C1-only)
   *  compliance probe runs at finalize. Best-effort: absence or failure never
   *  changes spawn/kill behavior, only Agent Harbor visibility for that agent. */
  harborBridge?: SpawnerHarborBridge;
  enforceTelemetryPolicy?: boolean;
  telemetryBypassApproval?: TelemetryBypassApproval;
  /** When true (the default), a backend MUST NOT run unless its full
   *  conversation is being recorded: construction throws if no `transcripts`
   *  module is wired, and a spawn fails loudly if its transcript can't be
   *  opened or finalized. Set false ONLY in tests/evals that don't exercise
   *  recording — the live daemon always enforces. Mirrors the telemetry
   *  fail-closed posture: untracked work is not allowed to look like success. */
  enforceTranscriptPolicy?: boolean;
  runnerOverrides?: Partial<Record<SpawnSpec['backend'], (spec: SpawnSpec, model: string) => Promise<BackendRunResult>>>;
  /**
   * Optional tube client (the daemon's messaging layer). When wired, cli-tube
   * spawns that carry a `spec.tubeChannel` publish their agent exchange on that
   * channel so an operator can watch the run live (`pd tube <channel>`). This is
   * the single seam that gives a folded dispatch back the live observability the
   * legacy inline dispatch adapter provided (ADR-0060): the conductor stamps
   * `dispatch:<id>` onto the spec, and this client is what actually publishes it.
   * Absent → no publishing (the spawn still runs); same posture as before.
   */
  tubeClient?: TubeClientLike;
}

const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD_RED = '\x1b[1;31m';
const ANSI_BANNER_RED = '\x1b[1;97;41m';
const telemetryBypassWarnings = new Set<string>();

function requireTelemetryBypassApproval(approval?: TelemetryBypassApproval): asserts approval is TelemetryBypassApproval {
  const confirmedBy = approval?.confirmedBy?.trim();
  const reason = approval?.reason?.trim();
  if (approval?.humanConfirmed === true && confirmedBy && reason) {
    return;
  }

  throw new Error([
    `${ANSI_BANNER_RED} TELEMETRY BYPASS REJECTED ${ANSI_RESET}`,
    `${ANSI_BOLD_RED}HITL confirmation is required to create a spawner with enforceTelemetryPolicy:false.${ANSI_RESET}`,
    'Pass telemetryBypassApproval: { humanConfirmed: true, confirmedBy: "<human>", reason: "<why this bypass is acceptable>" }.',
  ].join('\n'));
}

function warnTelemetryBypass(approval: TelemetryBypassApproval): void {
  const confirmedBy = approval.confirmedBy.trim();
  const reason = approval.reason.trim();
  const warningKey = `${confirmedBy}:${reason}`;
  if (telemetryBypassWarnings.has(warningKey)) return;
  telemetryBypassWarnings.add(warningKey);
  console.error([
    `${ANSI_BANNER_RED} TELEMETRY BYPASS ACTIVE ${ANSI_RESET}`,
    `${ANSI_BOLD_RED}Operator launches are running with enforceTelemetryPolicy:false.${ANSI_RESET}`,
    `confirmedBy=${confirmedBy}`,
    `reason=${reason}`,
  ].join('\n'));
}

// =============================================================================
// PD coordination helpers (fire-and-forget, silent on failure)
// =============================================================================

interface PdCoordinateOptions {
  pid?: number | null;
  /** ADR-0040 actor credential to present as `x-actor-credential` (#8877). */
  credential?: string | null;
}

function normalizeCoordinationPid(pid: number | null | undefined): number | undefined {
  if (typeof pid !== 'number' || !Number.isFinite(pid)) return undefined;
  const normalized = Math.trunc(pid);
  return normalized >= 0 ? normalized : undefined;
}

function registryPidFor(record: Pick<AgentRecord, 'childProcess'>): number {
  return normalizeCoordinationPid(record.childProcess?.pid) ?? 0;
}

/**
 * Fire a coordination write at the daemon's own HTTP surface.
 *
 * Purpose: the spawner coordinates its child agents through the SAME public
 * routes external agents use (register, begin, heartbeat, done) so spawned
 * agents are first-class citizens of the coordination plane, not a side
 * channel. Failures stay silent by design — coordination must never block a
 * spawn — but the parsed response body is now RETURNED so the caller can
 * capture what `/sugar/begin` minted: the ADR-0040 actor credential that
 * every later attributed write (#8877 / ADR-0122) must present via
 * `options.credential`.
 *
 * @param path - Daemon route path (e.g. '/sugar/begin').
 * @param body - JSON body to POST.
 * @param options - Optional child pid (X-Pid) and actor credential
 *        (x-actor-credential) headers.
 * @returns The parsed JSON response body, or null on any failure.
 */
async function pdCoordinate(path: string, body: Record<string, unknown>, options: PdCoordinateOptions = {}): Promise<Record<string, unknown> | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const pid = normalizeCoordinationPid(options.pid);
    if (pid !== undefined) headers['X-Pid'] = String(pid);
    if (options.credential) headers['x-actor-credential'] = options.credential;

    const res = await fetch(`${getDaemonTcpUrl(process.env.PORT_DADDY_URL)}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    try {
      return await res.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  } catch {
    // Silent — coordination failures never block spawning
    return null;
  }
}

// =============================================================================
// Shared child-process runner (eliminates 3x copy-paste)
// =============================================================================

interface ChildRunOpts {
  cmd: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  stdio?: ('ignore' | 'pipe')[];
  onChild?: (child: ChildProcess) => void;
}

function runChild(opts: ChildRunOpts): Promise<{ output: string; error: string | null; child: ChildProcess }> {
  return new Promise((resolve) => {
    const timeoutMs = typeof opts.timeout === 'number' && opts.timeout > 0 ? opts.timeout : null;
    const child = spawnChild(opts.cmd, opts.args, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env as NodeJS.ProcessEnv,
      ...(timeoutMs === null ? {} : { timeout: timeoutMs }),
      detached: true,
      shell: false,
      ...(opts.stdio ? { stdio: opts.stdio as any } : {}),
    });
    opts.onChild?.(child);

    const stdout: string[] = [];
    const stderr: string[] = [];
    let timedOut = false;
    let settled = false;
    let hardStopTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTimer = timeoutMs === null ? null : setTimeout(() => {
      timedOut = true;
      signalChildProcess(child, 'SIGTERM');
      hardStopTimer = setTimeout(() => {
        signalChildProcess(child, 'SIGKILL');
      }, 5000);
      hardStopTimer.unref?.();
    }, Math.max(1, timeoutMs - 25));
    timeoutTimer?.unref?.();

    child.stdout?.on('data', (data: Buffer) => stdout.push(data.toString()));
    child.stderr?.on('data', (data: Buffer) => stderr.push(data.toString()));

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (hardStopTimer) clearTimeout(hardStopTimer);
      const out = stdout.join('');
      const errText = stderr.join('');
      if (timedOut) {
        resolve({ output: out, error: `${opts.cmd} timed out after ${timeoutMs as number}ms${errText ? `: ${errText}` : ''}`, child });
      } else if (code !== 0) {
        resolve({ output: out, error: errText || `${opts.cmd} exited with code ${code}`, child });
      } else {
        resolve({ output: out + (errText ? `\nstderr: ${errText}` : ''), error: null, child });
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (hardStopTimer) clearTimeout(hardStopTimer);
      resolve({ output: '', error: `Failed to start ${opts.cmd}: ${err.message}`, child });
    });
  });
}

function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, signal);
    } catch {
      // Fall back below for non-detached/mocked processes.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Best-effort termination; the close/error handlers own final state.
  }
}

function terminateChildProcess(child: ChildProcess): void {
  signalChildProcess(child, 'SIGTERM');
  const forceKillTimer = setTimeout(() => {
    signalChildProcess(child, 'SIGKILL');
  }, 5000);
  forceKillTimer.unref?.();
}

// =============================================================================
// Coast Guard runner (ADR-0050) — confine every SUBPROCESS backend by default
// =============================================================================
//
// Subprocess backends (codex, claude-cli, aider, custom) get a real shell on
// the operator's box. We wrap each one in the OS sandbox + secret broker +
// hard egress cap BEFORE handing it to runChild. The in-process API backends
// (claude SDK, gemini, cloudflare, openai, groq, ollama) never spawn a shell
// and already source keys via getSecret(), so they don't route through here.

interface ConfinedChildOpts {
  spec: SpawnSpec;
  cmd: string;
  args: string[];
  env: Record<string, string | undefined>;
  /** Working dir for both the child and the sandbox binding (defaults to spec.workdir). */
  cwd?: string;
  timeout?: number;
  stdio?: ('ignore' | 'pipe')[];
  context?: BackendRunContext;
}

/**
 * Apply the Coast Guard, run the child, attach the receipt, then dispose. The
 * returned `runChild` result is augmented with `coastGuardReceipt` so the spawn
 * loop can persist it. Confinement is ON unless the spec/operator opts out.
 */
async function runConfinedChild(
  opts: ConfinedChildOpts,
): Promise<{ output: string; error: string | null; child: ChildProcess; coastGuardReceipt: CoastGuardReceipt }> {
  const cwd = opts.cwd ?? opts.spec.workdir;
  // Scope-tier write confinement (ADR-VI containment): derive the same priced
  // tier from the spawn's capabilities that the bond was priced on, so a
  // read-tier agent is physically denied writes to its workdir. Default caps
  // (`spawn:agent` + `backend:<id>`) → `full` tier → 'unrestricted' (no-op for
  // ordinary spawns); only an explicit read-tier `capabilities` engages it.
  const confineCaps =
    opts.spec.capabilities && opts.spec.capabilities.length > 0
      ? opts.spec.capabilities
      : ['spawn:agent', `backend:${opts.spec.backend}`];
  const writePolicy = scopeTierWritePolicy(classifyScope(confineCaps));
  const cg = await withCoastGuard({
    agentId: opts.spec.identity || opts.spec.name || 'spawned',
    backend: opts.spec.backend,
    cmd: opts.cmd,
    args: opts.args,
    env: opts.env,
    workdir: cwd,
    writePolicy,
    spec: { coastGuard: opts.spec.coastGuard, maxRequests: opts.spec.maxRequests, maxBytes: opts.spec.maxBytes },
    // The broker scrubs EVERY key loaded from the operator's dotenv files, not
    // just the managed allow-list — those files ARE the operator's secret store.
    dotenvKeys: Object.keys(loadDotenvOnce()),
  });
  try {
    const nativeWorkspaceError = validateNativeResumeWorkspace(opts.spec);
    if (nativeWorkspaceError) throw new Error(nativeWorkspaceError);
    const res = await runChild({
      cmd: cg.cmd,
      args: cg.args,
      env: cg.env,
      cwd,
      timeout: opts.timeout,
      stdio: opts.stdio,
      onChild: opts.context?.onChildProcess,
    });
    return { ...res, coastGuardReceipt: cg.receipt() };
  } finally {
    cg.dispose();
  }
}

// =============================================================================
// Backend implementations
// =============================================================================

interface BackendRunResult {
  output: string;
  error: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  /** True when token counts are a best-guess estimate, not backend-reported. */
  estimatedTelemetry?: boolean;
  childProcess?: ChildProcess | null;
  /** Coast Guard receipt for subprocess backends (sandbox + broker + cap). */
  coastGuardReceipt?: CoastGuardReceipt | null;
  /** Ordered, role-tagged turns the backend extracted from its own event
   *  stream (codex `--json` reasoning / command / message items). When
   *  present, the spawner records these as the full conversation instead of a
   *  single final-output blob, so thinking + tool calls land in the transcript.
   *  Backends that only yield a final answer (simple API calls) leave it unset. */
  transcript?: StructuredTurn[];
}

interface BackendRunContext {
  /** Durable outer spawn identity threaded into subprocess receipts. */
  agentId?: string;
  onChildProcess?: (child: ChildProcess) => void;
  /**
   * Live transcript-delta sink. A backend that streams events (the cli-tube
   * backends parse claude-code `stream-json` / codex `--json` per line) calls
   * this ONCE per event AS IT ARRIVES, so each thinking / tool_use / tool_result
   * / assistant turn lands in fleet_transcripts mid-run and the cockpit SSE
   * (`agent.transcript` `update`) renders it live instead of all-at-once at the
   * end. When a backend streams deltas, the spawn loop records THESE and skips
   * the batched final re-append (avoiding duplicates). Backends that only yield
   * a final answer leave it unwired.
   */
  onTranscriptDelta?: (msg: TranscriptMessage) => void;
  /**
   * Tube client + stable channel for live observability. Threaded from
   * `SpawnerDeps.tubeClient` + `spec.tubeChannel` into the cli-tube backend so a
   * folded dispatch keeps `pd tube dispatch:<id>` working (ADR-0060). Both must
   * be present for publishing to occur; otherwise the cli-tube backend uses its
   * default per-invocation channel and (without a client) publishes nothing.
   */
  tubeClient?: TubeClientLike;
  tubeChannel?: string;
}

const DEFAULT_BACKEND_TIMEOUT_MS = 5 * 60 * 1000;

function backendAbortSignal(spec: SpawnSpec): AbortSignal {
  const timeoutMs = spec.timeout && spec.timeout > 0 ? spec.timeout : DEFAULT_BACKEND_TIMEOUT_MS;
  return AbortSignal.timeout(timeoutMs);
}

interface CodexUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

const CODEX_DAEMON_CONTEXT_ENV_KEYS = [
  'CODEX_THREAD_ID',
] as const;

async function runOllama(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const result = await ollamaAdapter({
    prompt: spec.task,
    model,
    signal: backendAbortSignal(spec),
  });
  return adaptLLMResult(result);
}

async function runClaude(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  // Dynamic import with graceful fallback — use Function to avoid static analysis
  // of the module specifier (so tsc doesn't error on a missing optional dep)
  let Anthropic: unknown = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const m = await (new Function('s', 'return import(s)'))('@anthropic-ai/sdk') as { default: unknown };
    Anthropic = m.default;
  } catch {
    return { output: '', error: '@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk' };
  }

  try {
    const client = new (Anthropic as new (opts?: { apiKey?: string }) => {
      messages: {
        create(opts: Record<string, unknown>): Promise<{
          content: Array<{ text: string }>;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
          };
        }>;
      };
    })({
      apiKey: getSecret('ANTHROPIC_API_KEY'),
    });

    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: spec.task }],
    });

    const text = response.content.map((c) => c.text).join('');
    return {
      output: text,
      error: null,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  } catch (err) {
    return { output: '', error: (err as Error).message };
  }
}

async function runGemini(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  // REST-based: no SDK dep, and (critically) extracts exact usage tokens
  // (promptTokenCount + candidatesTokenCount + thoughtsTokenCount) so the
  // fail-closed telemetry policy can record an exact nonzero cost. The
  // legacy @google/generative-ai SDK path returned no usage and is deprecated.
  const result = await geminiAdapter({
    prompt: spec.task,
    model,
    maxTokens: spec.maxTokens,
    signal: backendAbortSignal(spec),
  });
  const adapted = adaptLLMResult(result);
  // Full-depth capture: reconstruct thinking / functionCall / text turns from
  // the raw Gemini response so the transcript shows HOW it answered.
  if (result.ok && result.raw !== undefined) {
    const turns = parseGeminiTranscript(result.raw);
    if (turns.length > 0) adapted.transcript = turns;
  }
  return adapted;
}

async function runGroq(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const result = await groqAdapter({
    prompt: spec.task,
    model,
    maxTokens: spec.maxTokens,
    signal: backendAbortSignal(spec),
  });
  return adaptLLMResult(result);
}

async function runLmStudio(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const result = await lmstudioAdapter({
    prompt: spec.task,
    model,
    maxTokens: spec.maxTokens,
    signal: backendAbortSignal(spec),
  });
  return adaptLLMResult(result);
}

async function runDeepseek(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const result = await deepseekAdapter({
    prompt: spec.task,
    model,
    maxTokens: spec.maxTokens,
    signal: backendAbortSignal(spec),
  });
  return adaptLLMResult(result);
}

async function runXai(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const result = await xaiAdapter({
    prompt: spec.task,
    model,
    maxTokens: spec.maxTokens,
    signal: backendAbortSignal(spec),
  });
  return adaptLLMResult(result);
}

async function runCloudflare(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const result = await cloudflareAdapter({
    prompt: spec.task,
    model,
    maxTokens: spec.maxTokens,
    signal: backendAbortSignal(spec),
  });
  const adapted = adaptLLMResult(result);
  // Full-depth capture: reconstruct reasoning / tool_calls / message turns
  // from the raw Workers AI result.
  if (result.ok && result.raw !== undefined) {
    const turns = parseCloudflareTranscript(result.raw);
    if (turns.length > 0) adapted.transcript = turns;
  }
  return adapted;
}

async function runOpenAI(spec: SpawnSpec, model: string): Promise<BackendRunResult> {
  const result = await openaiAdapter({
    prompt: spec.task,
    model,
    maxTokens: spec.maxTokens,
    signal: backendAbortSignal(spec),
  });
  return adaptLLMResult(result);
}

/**
 * Drive a local CLI tool (`claude` for claude-code, `codex` for codex)
 * through the cli-tube wrapper. Output and exit metadata flow back as a
 * normal BackendRunResult so the spawner's cost tracker, bond, and
 * coordination paths apply unchanged.
 *
 * Token counts are not available from the wrapped CLIs (they own their
 * own auth + billing), so this backend returns no telemetry fields and
 * relies on the operator's flat-rate subscription (Claude Max / ChatGPT
 * Pro) for cost accounting at the wallet layer.
 */
/** Map one backend StructuredTurn to a transcript message (live deltas + batch
 *  recording share this so a streamed turn and its end-of-run twin are identical). */
function turnToMessage(turn: StructuredTurn, ts: number): TranscriptMessage {
  const message: TranscriptMessage = {
    role: turn.role,
    content: turn.content,
    timestamp: ts,
  };
  if (turn.toolCalls && turn.toolCalls.length > 0) {
    message.tool_calls = turn.toolCalls;
  }
  return message;
}

async function runCliTube(
  spec: SpawnSpec,
  cli: CliTubeTool,
  context?: BackendRunContext,
): Promise<BackendRunResult> {
  // Live per-line streaming: map each JSONL event the child emits to a
  // transcript delta AS IT ARRIVES, so the cockpit sees thinking / tool calls /
  // assistant text mid-run. Only wired when the spawn loop provided a delta
  // sink (it does whenever a transcript row is open).
  const onTranscriptDelta = context?.onTranscriptDelta;
  const mapLine =
    cli === 'codex' ? mapCodexStreamLine
    : cli === 'claude-code' ? mapClaudeCodeStreamLine
    : null;
  const onStreamLine = onTranscriptDelta && mapLine
    ? (line: string) => {
        for (const turn of mapLine(line)) {
          onTranscriptDelta(turnToMessage(turn, Date.now()));
        }
      }
    : undefined;

  const result = await spawnViaCliTube({
    cli,
    prompt: spec.task,
    timeoutMs: spec.timeout,
    cwd: spec.workdir,
    env: { ...spec.env },
    model: spec.model,
    onChild: context?.onChildProcess,
    onStreamLine,
    permissionMode: spec.permissionMode,
    resumeSessionId: spec.nativeResume?.sessionId,
    workspaceIdentity: spec.nativeResume?.workspaceIdentity,
    // Live observability (ADR-0060): publish the exchange on the operator-
    // discoverable channel (dispatch:<id>) when both a channel and a tube client
    // are present. When `tubeChannel` is undefined, spawnViaCliTube falls back to
    // its own `cli:<tool>:<uuid>` default — unchanged for sortie/orchestrator
    // spawns. The publish is best-effort inside spawnViaCliTube and never blocks.
    tube: context?.tubeChannel,
    tubeClient: context?.tubeClient,
    // ADR-0050 Coast Guard: cli-tube children are subprocesses with a real
    // shell, so they carry the SAME confinement posture as the other
    // subprocess backends (see runConfinedChild). The wrap itself happens
    // inside spawnViaCliTube and is default-on; this block only threads the
    // receipt identity, per-spec cap overrides, the dotenv scrub inventory,
    // and the priced scope-tier write policy.
    coastGuard: {
      agentId: context?.agentId || spec.identity || spec.name || 'spawned',
      backend: spec.backend,
      spec: {
        coastGuard: spec.coastGuard,
        maxRequests: spec.maxRequests,
        maxBytes: spec.maxBytes,
      },
      dotenvKeys: Object.keys(loadDotenvOnce()),
      writePolicy: scopeTierWritePolicy(classifyScope(
        spec.capabilities && spec.capabilities.length > 0
          ? spec.capabilities
          : ['spawn:agent', `backend:${spec.backend}`],
      )),
    },
  });

  if (cli === 'codex') {
    // Codex `--json` gives us full-depth capture from the raw event stream:
    // reasoning/command/message items plus a terminal usage event.
    // Codex `--json` emits a terminal `turn.completed` carrying exact usage.
    // The tube path previously dropped it (only the legacy runCodexCli parsed
    // it), so every `cli:codex` spawn returned no tokens and fail-closed the
    // exact-telemetry gate. Recover it here; estimate only when truly absent.
    const cu = parseCodexUsage(result.rawStdout || result.output || '');
    const codexExact = typeof cu.inputTokens === 'number' && cu.inputTokens > 0
      && typeof cu.outputTokens === 'number' && cu.outputTokens > 0;
    return {
      output: result.output,                          // final message (from --output-last-message)
      error: result.error,
      transcript: parseCodexTranscript(result.rawStdout || ''),
      ...(codexExact
        ? {
            inputTokens: cu.inputTokens,
            outputTokens: cu.outputTokens,
            ...(typeof cu.cachedInputTokens === 'number' ? { cachedInputTokens: cu.cachedInputTokens } : {}),
          }
        : {
            inputTokens: estimateTokensFromText(spec.task),
            outputTokens: estimateTokensFromText(result.output || ''),
            estimatedTelemetry: true,
          }),
      coastGuardReceipt: result.coastGuardReceipt,
    };
  }
  if (cli === 'claude-code') {
    // claude-code: raw stdout is the stream-json; recover the final answer from
    // the terminal `result` line (falling back to raw if absent), parse the
    // stream into thinking / tool / assistant turns, and recover the exact token
    // usage the CLI reported on that same `result` line (previously dropped →
    // fail-closed).
    const finalAnswer = extractClaudeCodeFinal(result.rawStdout || '');
    const ccu = extractClaudeCodeUsage(result.rawStdout || '');
    const ccExact = typeof ccu.inputTokens === 'number' && ccu.inputTokens > 0
      && typeof ccu.outputTokens === 'number' && ccu.outputTokens > 0;
    return {
      output: finalAnswer ?? result.output,
      error: result.error,
      transcript: parseClaudeCodeTranscript(result.rawStdout || ''),
      ...(ccExact
        ? {
            inputTokens: ccu.inputTokens,
            outputTokens: ccu.outputTokens,
            ...(typeof ccu.cachedInputTokens === 'number' ? { cachedInputTokens: ccu.cachedInputTokens } : {}),
          }
        : {
            inputTokens: estimateTokensFromText(spec.task),
            outputTokens: estimateTokensFromText(finalAnswer ?? result.output ?? ''),
            estimatedTelemetry: true,
          }),
      coastGuardReceipt: result.coastGuardReceipt,
    };
  }

  // agy/gemini/groq/grok currently provide a final stdout/stderr answer through
  // cli-tube, not a documented JSONL stream. Keep the transcript honest: the
  // outer spawner has already recorded the user prompt and will append one final
  // assistant/output turn from `output`.
  return {
    output: result.output,
    error: result.error,
    inputTokens: estimateTokensFromText(spec.task),
    outputTokens: estimateTokensFromText(result.output || ''),
    estimatedTelemetry: true,
    coastGuardReceipt: result.coastGuardReceipt,
  };
}

/**
 * Convert the unified `LLMCompletionResult` shape (used by lib/llm-call.ts)
 * into the spawner's legacy `BackendRunResult` shape. The spawner's outer
 * wrapper expects `{output, error}` plus optional token counts; the
 * adapter returns `{ok, text, error}`.
 */
function adaptLLMResult(result: { ok: boolean; text?: string; error?: string; inputTokens?: number; outputTokens?: number }): BackendRunResult {
  if (!result.ok) {
    return { output: '', error: result.error || 'unknown error' };
  }
  return {
    output: result.text || '',
    error: null,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

function sanitizeCodexOutput(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed === 'codex') return false;
      if (/^OpenAI Codex\b/i.test(trimmed)) return false;
      if (/^(model|provider|approval|sandbox|reasoning effort|session id|workdir):/i.test(trimmed)) return false;
      if (/^\d[\d,]*\s+total tokens used$/i.test(trimmed)) return false;
      if (/^tokens used$/i.test(trimmed)) return false;
      if (/^-{4,}$/.test(trimmed)) return false;
      return true;
    });

  return lines.join('\n').trim();
}

function parseCodexUsage(raw: string): CodexUsage {
  let usage: CodexUsage = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    try {
      const event = JSON.parse(trimmed) as {
        type?: unknown;
        usage?: {
          input_tokens?: unknown;
          cached_input_tokens?: unknown;
          output_tokens?: unknown;
        };
      };
      if (event.type !== 'turn.completed' || !event.usage) continue;

      usage = {
        inputTokens: typeof event.usage.input_tokens === 'number' ? event.usage.input_tokens : undefined,
        cachedInputTokens: typeof event.usage.cached_input_tokens === 'number' ? event.usage.cached_input_tokens : undefined,
        outputTokens: typeof event.usage.output_tokens === 'number' ? event.usage.output_tokens : undefined,
      };
    } catch {
      // runChild may append stderr to stdout; non-JSON lines are not usage.
    }
  }

  return usage;
}

function parseCodexError(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    try {
      const event = JSON.parse(trimmed) as {
        type?: unknown;
        message?: unknown;
        error?: { message?: unknown };
      };
      if (event.type === 'error' && typeof event.message === 'string') {
        return event.message;
      }
      if (event.type === 'turn.failed' && typeof event.error?.message === 'string') {
        return event.error.message;
      }
    } catch {
      // Non-JSON stdout lines are not Codex structured errors.
    }
  }
  return null;
}

/**
 * Scratch root for codex's `--output-last-message` file. NOT the OS temp dir:
 * macOS purges `$TMPDIR`/`/tmp` on a timer and reboot, which can yank the file
 * out from under an in-flight run. We root it under the durable `~/.port-daddy`
 * tree (created on demand) and rmSync the per-run subdir in a finally block.
 */
function codexScratchRoot(): string {
  const root = join(homedir(), '.port-daddy', 'codex-scratch');
  mkdirSync(root, { recursive: true });
  return root;
}

function runCodexCli(spec: SpawnSpec, model: string, context?: BackendRunContext): Promise<BackendRunResult> {
  const workspace = spec.workdir || process.cwd();
  const tempDir = mkdtempSync(join(codexScratchRoot(), 'run-'));
  const outputPath = join(tempDir, 'last-message.txt');
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...loadDotenvOnce(),
    ...(spec.env || {}),
    OTEL_SDK_DISABLED: 'true',
  };
  for (const key of CODEX_DAEMON_CONTEXT_ENV_KEYS) {
    delete env[key];
  }
  // Current Codex defines --approve-for-me as automatic review *using* the
  // workspace-write sandbox. Passing --sandbox beside it is a hard CLI error,
  // so keep this one policy flag as the single source of truth.
  const args = spec.nativeResume
    ? [
        'exec',
        '--approve-for-me',
        'resume',
        '--skip-git-repo-check',
        '--output-last-message', outputPath,
        '--model', model,
        '--json',
        spec.nativeResume.sessionId,
        spec.task,
      ]
    : [
        'exec',
        '--skip-git-repo-check',
        '--approve-for-me',
        '-C', workspace,
        '--output-last-message', outputPath,
        '--model', model,
        '--json',
        spec.task,
      ];

  return runConfinedChild({
    spec,
    cmd: 'codex',
    args,
    env,
    cwd: workspace,
    timeout: spec.timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    context,
  }).then((result) => {
    try {
      const usage = parseCodexUsage(result.output || '');
      const structuredError = parseCodexError(result.output || '');
      const error = structuredError ? `Codex CLI failed: ${structuredError}` : result.error;
      // Full-depth capture: turn the `--json` event stream into ordered
      // reasoning / command / message turns. This is the whole reason codex
      // runs with `--json` — previously the stream was parsed only for tokens.
      const transcript = parseCodexTranscript(result.output || '');
      const fileOutput = existsSync(outputPath) ? readFileSync(outputPath, 'utf-8').trim() : '';
      if (fileOutput) {
        return { output: fileOutput, error, ...usage, transcript, coastGuardReceipt: result.coastGuardReceipt };
      }
      const sanitized = sanitizeCodexOutput(result.output || '');
      return { output: sanitized, error, ...usage, transcript, coastGuardReceipt: result.coastGuardReceipt };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

function runAider(spec: SpawnSpec, model: string, context?: BackendRunContext): Promise<BackendRunResult> {
  const files = spec.files || [];
  return runConfinedChild({
    spec,
    cmd: 'aider',
    args: ['--yes', '--no-stream', '--model', model, '--message', spec.task, ...files],
    env: { ...process.env, ...loadDotenvOnce(), ...(spec.env || {}) },
    timeout: spec.timeout,
    context,
  }).then((result) => ({
    output: result.output,
    error: result.error,
    coastGuardReceipt: result.coastGuardReceipt,
  }));
}

function runCustom(spec: SpawnSpec, context?: BackendRunContext): Promise<BackendRunResult> {
  // Reject shell injection: metacharacters, newlines, control chars
  const DANGEROUS_PATTERNS = /[;&|`$(){}!<>\n\r\t\x00-\x1f\x7f]/;
  if (DANGEROUS_PATTERNS.test(spec.task)) {
    return Promise.resolve({
      output: '',
      error: 'Command contains shell metacharacters or control characters. Use explicit arguments instead of shell syntax.',
      childProcess: null,
    });
  }

  return runConfinedChild({
    spec,
    cmd: '/bin/sh',
    args: ['-c', spec.task],
    env: {
      ...process.env,
      ...loadDotenvOnce(),
      ...(spec.env || {}),
      PD_BACKEND: spec.backend,
      PORT_DADDY_BACKEND: spec.backend,
      PD_MODEL: spec.model,
      PORT_DADDY_MODEL: spec.model,
      PD_MODEL_TIER: spec.modelTier,
      PORT_DADDY_MODEL_TIER: spec.modelTier,
    },
    timeout: spec.timeout,
    context,
  }).then((result) => ({
    ...result,
    childProcess: result.child,
    coastGuardReceipt: result.coastGuardReceipt,
  }));
}

/** Rough token estimate (~4 chars/token) — the labelled best-guess fallback. */
function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

/**
 * Parse `claude -p --output-format json` output. The CLI emits one JSON object
 * carrying its OWN usage: `{ result, usage:{input_tokens,output_tokens,
 * cache_read_input_tokens}, total_cost_usd }`. When that usage is present the
 * telemetry is EXACT (the CLI counted it). When it's missing or the payload
 * isn't JSON (older CLI), we fall back to a clearly-labelled estimate
 * (`estimatedTelemetry: true`) rather than returning no counts — which is what
 * previously fail-closed the launch.
 */
export function parseClaudeCliResult(raw: string, task: string): BackendRunResult {
  try {
    const obj = JSON.parse((raw || '').trim()) as {
      result?: unknown; text?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown };
    };
    const output = typeof obj.result === 'string' ? obj.result
      : typeof obj.text === 'string' ? obj.text : raw;
    const inTok = obj.usage?.input_tokens;
    const outTok = obj.usage?.output_tokens;
    const cacheTok = obj.usage?.cache_read_input_tokens;
    if (typeof inTok === 'number' && inTok > 0 && typeof outTok === 'number' && outTok > 0) {
      return {
        output, error: null,
        inputTokens: inTok,
        ...(typeof cacheTok === 'number' && cacheTok >= 0 ? { cachedInputTokens: cacheTok } : {}),
        outputTokens: outTok,
      };
    }
    return { output, error: null, inputTokens: estimateTokensFromText(task), outputTokens: estimateTokensFromText(output), estimatedTelemetry: true };
  } catch {
    return { output: raw, error: null, inputTokens: estimateTokensFromText(task), outputTokens: estimateTokensFromText(raw), estimatedTelemetry: true };
  }
}

async function runClaudeCli(spec: SpawnSpec, context?: BackendRunContext): Promise<BackendRunResult> {
  // Giant Squid Harness (ADR-0091): optionally sink the pd-hook-* tentacles into
  // this workspace's .claude/settings.json BEFORE the CLI boots, so the
  // UserPromptSubmit / PreToolUse / PostToolUse hooks fire inside Claude Code's
  // own loop. Single, opt-in, fail-open call site — never blocks the launch.
  if (spec.injectSquidHooks) {
    try {
      const { ClaudeCliSquidAdapter } = await import('./squid/adapter.js');
      await new ClaudeCliSquidAdapter().injectHooks(spec.workdir || process.cwd());
    } catch (err) {
      console.warn(`[spawner] squid hook injection skipped: ${(err as Error).message}`);
    }
  }
  // `--output-format json` makes the CLI report its own exact usage, which we
  // parse below. Without it the CLI prints plain prose and we get no token
  // counts — the gap that previously fail-closed every claude-cli launch.
  const args = spec.nativeResume
    ? ['--resume', spec.nativeResume.sessionId, '-p', '--output-format', 'json', spec.task]
    : ['-p', '--output-format', 'json', spec.task];
  // `claude-cli` is the DEFAULT_MODELS sentinel for "the CLI manages its own
  // default model"; it is runtime provenance, not a concrete Claude model id.
  if (spec.model && spec.model !== 'claude-cli') {
    args.push('--model', spec.model);
  }
  if (spec.allowedTools) {
    args.push('--allowedTools', spec.allowedTools);
  }

  // Strip ANTHROPIC_API_KEY from BOTH dotenv AND process.env before passing to
  // the claude subprocess. The claude CLI manages its own authentication (OAuth).
  // Any ANTHROPIC_API_KEY in the environment overrides OAuth and causes
  // "Invalid API key" when the key is wrong, stale, or for a different account.
  // Explicit user-provided keys via spec.env are still respected (spread last).
  const { ANTHROPIC_API_KEY: _dropped, ...dotenvSafe } = loadDotenvOnce();
  const { ANTHROPIC_API_KEY: _droppedEnv, ...processEnvSafe } = process.env;

  // Resolve through the same operator-scoped path logic as readiness and
  // cli:claude-code. A stale PD_CLI_CLAUDE_CODE_BIN must not strand the
  // launchd daemon when a standard user-install `claude` is discoverable.
  const resolution = resolveCliBinary('claude', { envOverride: 'PD_CLI_CLAUDE_CODE_BIN' });
  const currentPath = process.env.PATH || '';
  const augmentedPath = cliBinarySearchPath(currentPath);

  const res = await runConfinedChild({
    spec,
    cmd: resolution.command,
    args,
    env: { ...processEnvSafe, ...dotenvSafe, ...(spec.env || {}), PATH: augmentedPath },
    timeout: spec.timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
    context,
  });
  if (res.error) return { output: res.output, error: res.error, coastGuardReceipt: res.coastGuardReceipt };
  return { ...parseClaudeCliResult(res.output, spec.task), coastGuardReceipt: res.coastGuardReceipt };
}

// =============================================================================
// Default models per backend
// =============================================================================

const DEFAULT_MODELS: Record<SpawnSpec['backend'], string> = {
  // Local ollama tag, not an API id — but still ONE canonical default (was
  // 'llama3.1:8b' here vs a different literal in llm-backend-resolver.ts and
  // a third in fleet-runtime.ts before ADR-0057 model-abstraction unification).
  ollama: resolveModel({ backend: 'ollama', capability: 'balanced' }),
  // LM Studio serves whatever model is loaded in the app; 'local-model' is the
  // conventional placeholder. DEFAULT_LMSTUDIO_MODEL (lib/spawner/backends/
  // lmstudio.ts) IS the registry value — kept as the named export because
  // that adapter module also needs it directly for its own default wiring.
  lmstudio: DEFAULT_LMSTUDIO_MODEL,
  claude: resolveModel({ backend: 'claude', capability: 'cheap' }),
  'claude-cli': 'claude-cli',  // claude CLI manages its own model
  gemini: resolveModel({ backend: 'gemini', capability: 'cheap' }),
  cloudflare: resolveModel({ backend: 'cloudflare', capability: 'cheap' }),
  openai: DEFAULT_OPENAI_MODEL,
  groq: DEFAULT_GROQ_MODEL,
  deepseek: DEFAULT_DEEPSEEK_MODEL,
  xai: DEFAULT_XAI_MODEL,
  codex: resolveModel({ backend: 'codex', capability: 'cheap' }),
  'cli:claude-code': 'claude-cli',  // local claude CLI manages its own model
  'cli:codex': 'codex-cli',          // local codex CLI manages its own model
  'cli:agy': 'agy-cli',              // local agy CLI manages its own model
  'cli:gemini': 'gemini-cli',        // local gemini CLI manages its own model
  'cli:groq': 'groq-cli',            // local groq CLI manages its own model
  'cli:grok': 'grok-cli',            // local grok CLI manages its own model
  aider: 'aider',   // aider manages its own model selection
  custom: 'custom',
};
// Mark default-timeout knobs referenced elsewhere
void DEFAULT_OPENAI_TIMEOUT_MS;

const FLAT_RATE_CLI_TUBE_BACKENDS = new Set<SpawnSpec['backend']>([
  'cli:claude-code',
  'cli:codex',
  'cli:agy',
  'cli:gemini',
  'cli:groq',
  'cli:grok',
]);

function allowsFlatRateEstimatedTelemetry(backend: SpawnSpec['backend']): boolean {
  return FLAT_RATE_CLI_TUBE_BACKENDS.has(backend);
}

function backendOverrideSource(
  requestedBackend: SpawnSpec['backend'],
  effectiveBackend: SpawnSpec['backend'],
): BackendOverrideSource {
  if (requestedBackend === effectiveBackend) return 'none';
  const forcedFromEnv = detectForcedCliBackend(process.env, { persistedPath: null });
  return forcedFromEnv === effectiveBackend ? 'env' : 'persisted';
}

function isFleetModelTier(value: unknown): value is FleetModelTier {
  return value === 'low' || value === 'mid' || value === 'high';
}

function resolveRequestedRuntimeModel(
  requestedBackend: SpawnSpec['backend'],
  explicitModel?: string,
  modelTier?: SpawnSpec['modelTier'],
): string {
  const model = explicitModel?.trim();
  if (model) return model;
  if (isFleetModelTier(modelTier)) {
    return resolveFleetAgentRuntime({ backend: requestedBackend, modelTier }).model
      ?? DEFAULT_MODELS[requestedBackend];
  }
  return DEFAULT_MODELS[requestedBackend];
}

export function resolveSpawnRuntime(spec: SpawnSpec): ResolvedSpawnRuntime {
  const requestedBackend = spec.requestedBackend ?? spec.backend;

  // /spawn preflight may already have resolved the runnable backend/model. In
  // that case `spec.backend` is the effective runtime and the requested fields
  // preserve provenance from the original request.
  if (spec.requestedBackend && spec.requestedBackend !== spec.backend) {
    const requestedModel = resolveRequestedRuntimeModel(
      requestedBackend,
      spec.requestedModel,
      spec.modelTier,
    );
    return {
      requestedBackend,
      effectiveBackend: spec.backend,
      requestedModel,
      effectiveModel: spec.model ?? DEFAULT_MODELS[spec.backend],
      backendOverrideSource: spec.backendOverrideSource ?? 'preflight',
    };
  }

  const requestedModel = resolveRequestedRuntimeModel(
    requestedBackend,
    spec.requestedModel ?? spec.model,
    spec.modelTier,
  );
  const resolved = resolveEffectiveSpawnBackend(spec.backend);
  const effectiveBackend = (resolved.backend ?? spec.backend) as SpawnSpec['backend'];
  return {
    requestedBackend,
    effectiveBackend,
    requestedModel,
    effectiveModel: effectiveBackend === requestedBackend
      ? requestedModel
      : DEFAULT_MODELS[effectiveBackend],
    backendOverrideSource: spec.backendOverrideSource
      ?? backendOverrideSource(requestedBackend, effectiveBackend),
  };
}

export function validateNativeResumeAdapter(
  spec: SpawnSpec,
  runtime: ResolvedSpawnRuntime = resolveSpawnRuntime(spec),
): string | null {
  if (!spec.nativeResume) return null;

  const adapterFamily = String(spec.nativeResume.adapterFamily ?? '').trim();
  const sessionId = String(spec.nativeResume.sessionId ?? '');
  if (!adapterFamily || Buffer.byteLength(adapterFamily, 'utf8') > 256 || /[\0\r\n]/.test(adapterFamily)) {
    return 'Native resume blocked: adapterFamily must be a safe non-empty identifier.';
  }
  if (!sessionId.trim() || Buffer.byteLength(sessionId, 'utf8') > 1_024 || /[\0\r\n]/.test(sessionId)) {
    return 'Native resume blocked: sessionId must be a safe non-empty harness identifier.';
  }

  const target = getBackendCatalogEntry(runtime.effectiveBackend);
  if (!target) {
    return `Native resume blocked: effective backend ${runtime.effectiveBackend} has no harness adapter contract.`;
  }
  if (target.adapter.family !== adapterFamily) {
    return `Native resume blocked: source adapter ${adapterFamily} cannot resume through effective adapter ${target.adapter.family}.`;
  }
  if (!target.adapter.resume.native || target.adapter.resume.scope !== 'session') {
    return `Native resume blocked: effective backend ${runtime.effectiveBackend} does not preserve native session identity.`;
  }
  const sessionIdError = nativeHarnessSessionIdError(adapterFamily, sessionId);
  if (sessionIdError) {
    return `Native resume blocked: ${sessionIdError}.`;
  }
  return null;
}

export function validateNativeResumeWorkspace(spec: SpawnSpec): string | null {
  if (!spec.nativeResume) return null;
  if (!spec.nativeResume.workspaceIdentity) {
    return 'Native resume blocked: daemon-witnessed workspace identity is required.';
  }
  if (!spec.workdir || !sameWorkspaceIdentity(spec.workdir, spec.nativeResume.workspaceIdentity)) {
    return 'Native resume blocked: canonical workspace identity changed before child launch.';
  }
  return null;
}

export function validateNativeResume(
  spec: SpawnSpec,
  runtime: ResolvedSpawnRuntime = resolveSpawnRuntime(spec),
): string | null {
  return validateNativeResumeAdapter(spec, runtime) ?? validateNativeResumeWorkspace(spec);
}

export function validateSpawnWorkspace(spec: SpawnSpec): string | null {
  if (!spec.workspaceIdentity) return null;
  if (!spec.workdir || !sameWorkspaceIdentity(spec.workdir, spec.workspaceIdentity)) {
    return 'Spawn blocked: canonical workspace identity changed before child launch.';
  }
  return null;
}

// =============================================================================
// Worktree isolation guard (layer 2)
// =============================================================================
//
// Parallel agents launched into the SAME repository main checkout overwrite
// each other's files. On 2026-06-03 this deleted 403 files in the port-daddy
// working tree. A git WORKTREE has `.git` as a FILE (a gitdir pointer); a main
// checkout has `.git` as a DIRECTORY. That is the deterministic signal — we
// never shell out to git. The harness PreToolUse hook is the layer-1 twin.

const SPAWN_ISOLATION_BYPASS_ENV = 'PD_SPAWN_ISOLATION_OFF';

/**
 * Walk up from `startDir` to classify the nearest git checkout:
 *  - 'main'     : `.git` is a directory  (a primary checkout — collision risk)
 *  - 'worktree' : `.git` is a file        (a `git worktree add` checkout — safe)
 *  - 'none'     : no `.git` ancestor      (not a repo — nothing to steamroll)
 */
export function detectGitCheckout(startDir: string): 'main' | 'worktree' | 'none' {
  let dir = resolve(startDir);
  for (;;) {
    const gitPath = join(dir, '.git');
    if (existsSync(gitPath)) {
      try {
        return statSync(gitPath).isDirectory() ? 'main' : 'worktree';
      } catch {
        return 'none';
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return 'none';
    dir = parent;
  }
}

/**
 * Decide whether a spawn must be refused for lack of worktree isolation.
 * Pure and deterministic so it is fully unit-testable.
 *
 * Allowed without isolation: an explicit `allowSharedCheckout` opt-in (for
 * working-tree observers like the gardener) or the operator escape hatch
 * `PD_SPAWN_ISOLATION_OFF=1`. The escape hatch is intentionally NOT named in
 * the reason string — a refusal must point only to the correct action
 * (isolate in a worktree), never advertise its own bypass.
 */
export function assessSpawnIsolation(
  spec: { workdir?: string; allowSharedCheckout?: boolean },
  env: Record<string, string | undefined> = process.env,
): { blocked: boolean; reason: string | null } {
  if (spec.allowSharedCheckout === true) return { blocked: false, reason: null };
  if (env[SPAWN_ISOLATION_BYPASS_ENV] === '1') return { blocked: false, reason: null };

  const workdir = spec.workdir ? resolve(spec.workdir) : process.cwd();
  if (detectGitCheckout(workdir) !== 'main') return { blocked: false, reason: null };

  return {
    blocked: true,
    reason:
      `Spawn blocked: workdir is a repository main checkout (${workdir}). ` +
      `Parallel agents sharing one checkout overwrite each other's files — this ` +
      `deleted 403 files on 2026-06-03. Run this agent in a dedicated git worktree ` +
      `and point workdir at it: git worktree add ~/coding/tmp/<name> -b <branch>.`,
  };
}

function normalizeHardBudgetUsd(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeTelemetryCostUsd(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function hardBudgetCapError(spec: SpawnSpec, telemetry: SpawnTelemetry | null): string | null {
  const budgetUsd = normalizeHardBudgetUsd(spec.budgetUsd);
  if (budgetUsd == null || !telemetry) return null;
  const costUsd = normalizeTelemetryCostUsd(telemetry.costUsd);
  if (costUsd == null || costUsd <= budgetUsd) return null;
  return `exceeded hard budget cap: telemetry cost ${formatUsd(costUsd)} > budget ${formatUsd(budgetUsd)}`;
}

// =============================================================================
// Module factory
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function createSpawner(deps: SpawnerDeps = {}) {
  // In-memory registry of active spawned agents
  const agents = new Map<string, AgentRecord>();
  const {
    costTracker,
    counters,
    bonds,
    harbors,
    transcripts,
    harborBridge,
    enforceTelemetryPolicy = true,
    enforceTranscriptPolicy = true,
    telemetryBypassApproval,
    runnerOverrides = {},
    tubeClient,
  } = deps;

  // ── Transcript helpers ──────────────────────────────────────────────────
  // Fail-loud under enforcement (the daemon's posture): if recording throws,
  // log a red banner and rethrow so the spawn is marked failed — untracked
  // work must NOT look like success. When enforceTranscriptPolicy is false
  // (tests/evals), failures are swallowed so the spawn path still exercises.

  function recordOrThrow(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      // Coerce safely: a thrown non-Error (possible in JS) has no `.message`,
      // which would render "undefined" in the banner.
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `transcript recording failed (${label}): ${detail}`;
      if (enforceTranscriptPolicy) {
        console.error(
          `${ANSI_BANNER_RED} TRANSCRIPT RECORDING FAILED ${ANSI_RESET}\n` +
          `${ANSI_BOLD_RED}${msg}${ANSI_RESET}`,
        );
        throw new Error(msg);
      }
      // best-effort mode: swallow
    }
  }

  // ── Agent Harbor bridge (best-effort; see lib/agent-harbor/spawner-bridge.ts) ──
  // Maps a transcript id back to the bounded run facts the terminal context
  // envelope needs. Content is deliberately absent: the bridge re-reads the
  // already-redacted fleet_transcript_messages rows instead of copying raw
  // prompts from SpawnSpec.
  const transcriptHarborRuns = new Map<string, {
    agentId: string;
    sourceAdapter: string;
    model: string;
    project: string | null;
    workdir: string | null;
    estimatedPromptTokens: number | null;
  }>();

  /** Open the transcript row and record the opening system/user turns.
   *  Returns the id, or null only when recording is disabled (no module +
   *  not enforced). Throws under enforcement if the recorder is broken. */
  function txStart(spec: SpawnSpec, runtime: ResolvedSpawnRuntime, agentId: string, startedAt: number): string | null {
    if (!transcripts) return null;
    let id: string | null = null;
    recordOrThrow('start', () => {
      const ship = spec.ship || `spawn:${runtime.effectiveBackend}`;
      const trigger = spec.trigger || 'manual';
      const projectName = getProjectName(spec.identity);
      id = transcripts.start({
        ship,
        spawned_agent_id: agentId,
        trigger,
        backend: runtime.effectiveBackend,
        model: runtime.effectiveModel,
        requested_backend: runtime.requestedBackend,
        effective_backend: runtime.effectiveBackend,
        requested_model: runtime.requestedModel,
        effective_model: runtime.effectiveModel,
        backend_override_source: runtime.backendOverrideSource,
        started_at: startedAt,
        pr_number: spec.prNumber ?? null,
        issue_number: spec.issueNumber ?? null,
        project: projectName ?? null,
        identity: spec.identity ?? null,
      });
      // Always record the initial prompt(s) as system + user messages.
      if (spec.systemPrompt) {
        transcripts.appendMessage(id, {
          role: 'system',
          content: spec.systemPrompt,
          timestamp: startedAt,
        });
      }
      transcripts.appendMessage(id, {
        role: 'user',
        content: spec.task,
        timestamp: startedAt,
      });
    });
    if (id && harborBridge) {
      transcriptHarborRuns.set(id, {
        agentId,
        sourceAdapter: runtime.effectiveBackend,
        model: runtime.effectiveModel,
        project: getProjectName(spec.identity) ?? null,
        workdir: spec.workdir ?? null,
        estimatedPromptTokens: typeof spec.estimatedPromptTokens === 'number'
          ? spec.estimatedPromptTokens
          : null,
      });
      harborBridge.registerNode(agentId, spec.identity ?? null, startedAt);
      harborBridge.appendTranscriptEvent(agentId, 'session_started', startedAt, {
        transcriptId: id,
        sourceAdapter: runtime.effectiveBackend,
        model: runtime.effectiveModel,
      });
      harborBridge.syncTranscript(agentId, id);
    }
    return id;
  }

  function txAssistant(transcriptId: string | null, content: string, ts: number): void {
    if (!transcripts || !transcriptId) return;
    recordOrThrow('assistant', () => {
      transcripts.appendMessage(transcriptId, {
        role: 'assistant',
        content,
        timestamp: ts,
      });
    });
    const run = transcriptHarborRuns.get(transcriptId);
    if (run && harborBridge) harborBridge.syncTranscript(run.agentId, transcriptId);
  }

  /** Record the backend's full structured conversation (reasoning / tool
   *  calls / messages) in order. This is the depth the operator asked for:
   *  thinking turns, command executions with their output, and each assistant
   *  message — not a single final blob. */
  function txMessages(transcriptId: string | null, turns: StructuredTurn[], ts: number): void {
    if (!transcripts || !transcriptId) return;
    recordOrThrow('messages', () => {
      for (const turn of turns) {
        transcripts.appendMessage(transcriptId, turnToMessage(turn, ts));
      }
    });
    const run = transcriptHarborRuns.get(transcriptId);
    if (run && harborBridge) harborBridge.syncTranscript(run.agentId, transcriptId);
  }

  /** Append ONE live transcript delta mid-run (the cli-tube `onTranscriptDelta`
   *  path). Mirrors txMessages' enforcement, but per-message: a live delta that
   *  can't be recorded under enforcement is loud, just like the batch path.
   *  Best-effort mode swallows internally. */
  function txDelta(transcriptId: string | null, message: TranscriptMessage): void {
    if (!transcripts || !transcriptId) return;
    recordOrThrow('delta', () => {
      transcripts.appendMessage(transcriptId, message);
    });
    const run = transcriptHarborRuns.get(transcriptId);
    if (run && harborBridge) harborBridge.syncTranscript(run.agentId, transcriptId);
  }

  function txOutput(transcriptId: string | null, output: TranscriptOutput): void {
    if (!transcripts || !transcriptId) return;
    recordOrThrow('output', () => {
      transcripts.appendOutput(transcriptId, output);
    });
  }

  function txFinalize(
    transcriptId: string | null,
    status: 'completed' | 'failed' | 'killed' | 'over_budget',
    endedAt: number,
    telemetry: SpawnTelemetry | null,
    error: string | null,
  ): void {
    if (!transcripts || !transcriptId) return;
    recordOrThrow('finalize', () => {
      transcripts.finalize(transcriptId, {
        status,
        ended_at: endedAt,
        cost_usd: telemetry?.costUsd ?? null,
        tokens_in: telemetry?.inputTokens ?? null,
        tokens_out: telemetry?.outputTokens ?? null,
        error,
      });
    });
    const run = transcriptHarborRuns.get(transcriptId);
    if (run && harborBridge) {
      harborBridge.syncTranscript(run.agentId, transcriptId);
      harborBridge.appendTranscriptEvent(run.agentId, 'session_end', endedAt, {
        transcriptId,
        status,
        telemetryMode: telemetry?.rateMode ?? 'estimated',
      });
      const adapterUsedTokens = telemetry
        ? telemetry.inputTokens + telemetry.outputTokens
        : null;
      harborBridge.recordContext({
        agentNodeId: run.agentId,
        sessionId: run.agentId,
        runId: transcriptId,
        transcriptId,
        sourceAdapter: run.sourceAdapter,
        model: run.model,
        windowTokens: getEffectiveContextWindow(run.model),
        daemonUsedTokensEstimate: (run.estimatedPromptTokens ?? telemetry?.inputTokens ?? 0)
          + (telemetry?.outputTokens ?? 0),
        adapterUsedTokensEstimate: adapterUsedTokens,
        estimateMode: telemetry?.rateMode ?? 'estimated',
        project: run.project,
        projectDir: run.workdir,
        workdir: run.workdir,
        measuredAt: new Date(endedAt).toISOString(),
      });
      // Fire-and-forget: runProbeAndRecord never rejects (it catches
      // internally), but guard here too so a future change to that contract
      // can never surface as an unhandled rejection out of a synchronous
      // finalize call.
      void harborBridge.runProbeAndRecord(run.agentId).catch(() => {});
      transcriptHarborRuns.delete(transcriptId);
    }
  }

  // Default bond per spawn when caller doesn't specify one. Tunable via
  // SpawnSpec.bondUsd; a misbehaving agent slashes this, a clean exit refunds.
  // Small enough to not block normal fleet operation, large enough to matter.
  const DEFAULT_BOND_USD = 0.01;

  if (!enforceTelemetryPolicy) {
    requireTelemetryBypassApproval(telemetryBypassApproval);
    warnTelemetryBypass(telemetryBypassApproval);
  }

  // Fail-closed transcript policy: a backend must not run unless its full
  // conversation is recorded. Refuse to build a recording-blind spawner in the
  // enforced (production) configuration. This is the construction-time twin of
  // the per-spawn guard below — a misconfigured daemon fails LOUD at boot
  // rather than silently running agents whose work vanishes.
  if (enforceTranscriptPolicy && !transcripts) {
    throw new Error([
      `${ANSI_BANNER_RED} TRANSCRIPT RECORDING REQUIRED ${ANSI_RESET}`,
      `${ANSI_BOLD_RED}A spawner was constructed with no transcripts module, but transcript recording is mandatory.${ANSI_RESET}`,
      'Every backend run must record its full conversation (user/assistant/tool/thinking) to fleet_transcripts.',
      'Wire deps.transcripts = createTranscripts(db). (Tests/evals that do not exercise recording may pass enforceTranscriptPolicy:false.)',
    ].join('\n'));
  }

  /** Hard ceiling on concurrent running agents. Prevents fork bombs.
   *  Fleet YAML limits are per-project; this is the global safety net.
   *  Set high enough for normal fleet operation (8 agents + manual spawns)
   *  but low enough to prevent a runaway trigger from eating all PIDs. */
  const MAX_CONCURRENT_RUNNING = 20;

  const MAX_AGENT_RECORDS = 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  /**
   * Remove completed/failed/killed agents older than 1 hour,
   * and enforce a hard cap of MAX_AGENT_RECORDS entries.
   */
  function cleanupStaleAgents(): void {
    const cutoff = Date.now() - ONE_HOUR;
    for (const [id, record] of agents) {
      if (record.completedAt && record.completedAt < cutoff) {
        agents.delete(id);
      }
    }

    // Hard cap — evict oldest completed entries first
    if (agents.size > MAX_AGENT_RECORDS) {
      const completed = [...agents.entries()]
        .filter(([, r]) => r.completedAt)
        .sort((a, b) => (a[1].completedAt || 0) - (b[1].completedAt || 0));
      for (const [id] of completed.slice(0, agents.size - MAX_AGENT_RECORDS)) {
        agents.delete(id);
      }
    }
  }

  function getProjectName(identity?: string): string | undefined {
    if (!identity) return undefined;
    const [projectName] = identity.split(':');
    return projectName || undefined;
  }

  function metricDims(backend: SpawnSpec['backend'], model: string, identity?: string | null): Record<string, string> {
    const dims: Record<string, string> = {
      backend,
      model,
    };
    const projectName = getProjectName(identity ?? undefined);
    if (projectName) dims.project = projectName;
    return dims;
  }

  /**
   * Spawn an AI agent with the given spec.
   * Automatically wires PD session + heartbeat + done.
   */
  async function spawn(spec: SpawnSpec): Promise<SpawnResult> {
    cleanupStaleAgents();

    // Hard global limit — never exceed MAX_CONCURRENT_RUNNING processes
    const running = [...agents.values()].filter(a => a.status === 'running').length;
    const runtime = resolveSpawnRuntime(spec);
    const model = runtime.effectiveModel;
    const dims = metricDims(runtime.effectiveBackend, runtime.effectiveModel, spec.identity);
    const blockedResult = (error: string): SpawnResult => ({
      agentId: 'blocked',
      backend: runtime.effectiveBackend,
      model: runtime.effectiveModel,
      requestedBackend: runtime.requestedBackend,
      effectiveBackend: runtime.effectiveBackend,
      requestedModel: runtime.requestedModel,
      effectiveModel: runtime.effectiveModel,
      backendOverrideSource: runtime.backendOverrideSource,
      status: 'failed',
      output: null,
      error,
      telemetry: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
    });
    const continuationWorkspaceError = validateNativeResume(spec, runtime) ?? validateSpawnWorkspace(spec);
    if (continuationWorkspaceError) {
      counters?.bump('spawn.blocked', dims);
      return blockedResult(continuationWorkspaceError);
    }
    if (running >= MAX_CONCURRENT_RUNNING) {
      counters?.bump('spawn.blocked', dims);
      return blockedResult(`Spawn blocked: ${running} agents already running (limit: ${MAX_CONCURRENT_RUNNING}). Wait for one to finish.`);
    }

    // Worktree isolation (layer 2): never launch a file-writing agent into a
    // repository main checkout — parallel agents there steamroll each other.
    const isolation = assessSpawnIsolation(spec);
    if (isolation.blocked) {
      counters?.bump('spawn.blocked', dims);
      return blockedResult(isolation.reason as string);
    }

    // Effective-context gate: refuse if the estimated prompt tokens would consume
    // ≥ 90% of the model's effective context window (60% of advertised).
    // This prevents launching agents that are already context-starved on arrival.
    if (spec.estimatedPromptTokens && model) {
      const effectiveMax = getEffectiveContextWindow(model);
      const promptPct = spec.estimatedPromptTokens / effectiveMax;
      if (promptPct >= 0.9) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult(
          `Spawn blocked: contextWindowInsufficientForTask — estimated prompt (${spec.estimatedPromptTokens} tokens) ` +
          `would consume ${Math.round(promptPct * 100)}% of ${model}'s effective context (${effectiveMax} tokens). ` +
          `Use a model with a larger context window or reduce the prompt size.`,
        );
      }
    }

    if (!enforceTelemetryPolicy) {
      counters?.bump('spawn.telemetry_bypass', dims);
    }

    if (enforceTelemetryPolicy) {
      if (!costTracker) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult('Spawn blocked: cost tracker unavailable under fail-closed telemetry policy.');
      }

      const telemetryPolicy = assessBackendTelemetryPolicy(runtime.effectiveBackend, runtime.effectiveModel);
      if (!telemetryPolicy.launchAllowed) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult(`Spawn blocked: ${telemetryPolicy.summary}`);
      }
    }

    const agentId = `spawned-${randomBytes(6).toString('hex')}`;
    const startedAt = Date.now();
    const projectName = getProjectName(spec.identity);
    const defaultHarborName = projectName ? `${projectName}:fleet` : undefined;
    const harborName = spec.harborName || defaultHarborName;

    // The capability set this spawn carries — the ONE source for the bond price,
    // the harbor-entry caps, and the Coast Guard write policy, so all three
    // agree on scope (no under-declaring one while acting on another). Defaults
    // to the historical spawn caps (`spawn:agent` + `backend:<id>` → `full`
    // tier), so an unset `capabilities` leaves the default spawn unchanged.
    const effectiveCaps =
      spec.capabilities && spec.capabilities.length > 0
        ? spec.capabilities
        : ['spawn:agent', `backend:${runtime.effectiveBackend}`];
    // NOTE: the priced scope tier → OS write policy mapping
    // (scopeTierWritePolicy) is applied per-backend-exec in runConfinedChild,
    // which derives the SAME tier from these caps. Keeping the derivation there
    // co-locates it with the Coast Guard call and avoids passing extra state.
    const displayName = deriveAgentDisplayName({
      name: spec.name,
      purpose: spec.purpose,
      identity: spec.identity,
      backend: runtime.effectiveBackend,
      fallback: agentId,
    });
    counters?.bump('spawn.started', dims);

    // Block until the project has a daily budget set. Without a budget,
    // the kill-switch has no number to enforce against — a spawn here
    // could burn unbounded cost. Refuse and point the operator at the fix.
    // No-wallet projects get a null budget on first escrow; we block both.
    if (bonds && projectName) {
      const budget = bonds.getBudget(projectName);
      if (budget == null) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult(
          `Spawn blocked: project '${projectName}' has no daily budget set. ` +
          `Run: pd wallet budget ${projectName} --usd-per-day <N>`,
        );
      }
    }

    // Escrow bond BEFORE any spawn work. If the wallet is insufficient OR
    // bonds aren't wired, we refuse here rather than run an unbonded agent —
    // the Ostrom "rule-monitoring" invariant: every running agent has a bond.
    //
    // BOND PRICING (ADR-VI / agent-transactions-whitepaper §6.5). A
    // caller-supplied `spec.bondUsd` ALWAYS wins (back-compat — the Fixed
    // Bonds path is preserved). When it is omitted, we compute a
    // scope-proportional bond with the closed-form floor
    // π = c·(1 + α·s)·(1 − ρ) instead of a flat constant:
    //   • c (base)   — DEFAULT_BOND_USD, the historical per-spawn cleanup unit,
    //                  so quoted bonds stay on the same dollar scale as before.
    //   • s (scope)  — `effectiveCaps`, the capability set the spawn enters its
    //                  harbor with (default `spawn:agent` + `backend:<id>`). A
    //                  spawn cap is an amplifier (it can create children), so the
    //                  default classifies as the `full` tier — correct: the bond
    //                  must cover the blast radius of the child it launches. A
    //                  caller that requests a read-tier `capabilities` is priced
    //                  AND confined to that tier (same set drives both).
    //   • duration   — the spawn timeout (longer access ⇒ more time to drift).
    //   • ρ          — par for now (1.0×): no reputation/quality-eval ledger
    //                  exists yet (Proposed). When it lands, pass a `reputation`
    //                  hook keyed on the PRINCIPAL / Anchor identity (NOT the
    //                  re-rollable agent id — the Sybil defense, ADR-0014/0022).
    let bondUsd: number;
    if (spec.bondUsd !== undefined) {
      // Caller-supplied Fixed Bond (back-compat) — the pricer is bypassed; no
      // breakdown to log. Record the override so an operator reading the log can
      // see WHY a spawn's bond did not follow the scope-proportional curve.
      bondUsd = spec.bondUsd;
      console.log(
        `[spawner] bond: caller-supplied fixed bond $${bondUsd.toFixed(4)} ` +
          `(scope-proportional pricer bypassed) — agent=${agentId} backend=${runtime.effectiveBackend}`,
      );
    } else {
      const priced = priceBond({
        baseUsd: DEFAULT_BOND_USD,
        capabilities: effectiveCaps,
        ttlMs: spec.timeout ?? 300_000,
        // The Coast Guard posture on THIS machine, so the pricer can flag when the
        // priced tier exceeds what the runtime structurally contains
        // (breakdown.uncontainedScope → the WARN below). ADVISORY: this changes NO
        // bondUsd / floor / ceiling — it only lights the containment-gap flag.
        // Absent it, the flag would stay dark in the live spawn path. coastGuardStatus
        // is a filesystem-probe-only read (no subprocess), cheap per spawn.
        coastGuardReport: coastGuardStatus(),
        // principal/reputation intentionally omitted → par; wire the Anchor-keyed
        // reputation hook here once the reputation ledger ships.
      });
      bondUsd = priced.bondUsd;
      // Operator visibility: one INFO line with the chosen tier + every multiplier
      // + the final escrowed amount (the spawn path is not hot enough to be noise),
      // plus INFO `notices` for an EXPECTED posture (the priced tier outrunning a
      // present-but-modest enforced tier — the documented pricing-ahead-of-
      // containment gap the default `full`-tier spawn trips on ~100% of spawns
      // under an armed guard), and a LOUD `warnings` only for an ACTIONABLE
      // anomaly: `belowFloor` (a ceiling clamp dropped the bond below its
      // deterrence floor) or an uncontained scope with NO OS sandbox at all
      // (`enforcedScopeTier === null` → the spawn is truly unconfined). An
      // always-on uncontained WARN under an armed guard would be alarm fatigue, so
      // that benign steady-state case is INFO. Formatting + level-routing live in
      // the pure pricer helper so they stay unit-tested; we just route info +
      // notices → log, warnings → warn.
      const lines = pricedBondLogLines(priced.breakdown, {
        bondUsd,
        agentId,
        backend: runtime.effectiveBackend,
      });
      console.log(lines.info);
      for (const n of lines.notices) console.log(n);
      for (const w of lines.warnings) console.warn(w);
    }
    let bondId: number | null = null;
    let enteredHarborName: string | null = null;
    if (harbors && projectName && bondUsd > 0) {
      if (!harborName) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult('Spawn blocked: harbor admission requires a project harbor name.');
      }

      const existingHarbor = harbors.get(harborName);
      if (!existingHarbor) {
        const created = harbors.create(harborName, {
          scope: projectName,
          capabilities: ['spawn:agent'],
          channels: ['agents', 'spawn'],
          agentPatterns: [`${projectName}:*`],
          metadata: { owner: 'spawner', purpose: 'spawn bond admission' },
        });
        if (!created.success) {
          counters?.bump('spawn.blocked', dims);
          return blockedResult(`Spawn blocked: could not create harbor '${harborName}' (${created.error || 'unknown error'}).`);
        }
      }

      const entered = await harbors.enter(harborName, agentId, {
        identity: spec.identity,
        capabilities: effectiveCaps,
      });
      if (!entered.success) {
        counters?.bump('spawn.blocked', dims);
        return blockedResult(`Spawn blocked: could not enter harbor '${harborName}' (${entered.error || 'unknown error'}).`);
      }
      enteredHarborName = harborName;

      // ── P4 envelope enforcement (ADR-0047) ────────────────────────────────
      // If the harbor has opted into a capability envelope, the spawn's backend
      // must be admitted by it. No envelope set → no enforcement (the open
      // default is preserved; enforcement is opt-in per call site). Fail-closed:
      // a set-but-restrictive envelope blocks the spawn BEFORE the bond is
      // escrowed and names the boundary it tripped (surfaced to the operator,
      // #190). The boundary name is the only thing the deny message reveals —
      // never an override (guardrails-never-advertise-bypass).
      const harborEnvelope =
        typeof harbors.getEnvelope === 'function' ? harbors.getEnvelope(harborName) : null;
      if (harborEnvelope && typeof harbors.assertWithinEnvelope === 'function') {
        const verdict = harbors.assertWithinEnvelope(harborName, agentId, {
          kind: 'backend',
          name: runtime.effectiveBackend,
        });
        if (!verdict.allowed) {
          counters?.bump('spawn.blocked', dims);
          try { harbors.leaveAll(agentId); } catch {}
          enteredHarborName = null;
          return blockedResult(`Spawn blocked by harbor envelope [${verdict.boundary}]: ${verdict.reason}`);
        }
        // Propagate the envelope to the child as a one-way parent→child config
        // channel (env var). The agent reads PD_HARBOR_ENVELOPE to self-limit to
        // the same boundary the daemon enforces, so it never has to guess scope.
        spec.env = {
          ...(spec.env || {}),
          PD_HARBOR_NAME: harborName,
          PD_HARBOR_ENVELOPE: JSON.stringify(harborEnvelope),
        };
      }
    }

    if (bonds && projectName && bondUsd > 0) {
      try {
        const receipt = bonds.escrow({
          project: projectName,
          agentId,
          archetype: runtime.effectiveBackend,
          bondUsd,
          harborName: enteredHarborName ?? harborName,
        });
        if (!receipt || !receipt.ok) {
          counters?.bump('spawn.blocked', dims);
          if (enteredHarborName && harbors) {
            try { harbors.leaveAll(agentId); } catch {}
            enteredHarborName = null;
          }
          return blockedResult(
            `Spawn blocked: could not escrow $${bondUsd.toFixed(4)} bond for project '${projectName}' (${receipt?.reason || 'unknown'})`,
          );
        }
        bondId = receipt.id ?? null;
      } catch (err) {
        counters?.bump('spawn.blocked', dims);
        if (enteredHarborName && harbors) {
          try { harbors.leaveAll(agentId); } catch {}
          enteredHarborName = null;
        }
        return blockedResult(`Spawn blocked: bond escrow threw — ${(err as Error).message}`);
      }
    }

    // Register agent record (running)
    const record: AgentRecord = {
      agentId,
      name: displayName,
      backend: runtime.effectiveBackend,
      model: runtime.effectiveModel,
      requestedBackend: runtime.requestedBackend,
      effectiveBackend: runtime.effectiveBackend,
      requestedModel: runtime.requestedModel,
      effectiveModel: runtime.effectiveModel,
      backendOverrideSource: runtime.backendOverrideSource,
      status: 'running',
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
      startedAt,
      completedAt: null,
      heartbeatInterval: null,
      childProcess: null,
      bondId,
      bondUsd,
    };
    agents.set(agentId, record);

    // Open a transcript row immediately so the live-tail surface (UI/SSE)
    // sees the run before its (potentially long) LLM call returns. Recording
    // is a PRECONDITION of running the backend: if the row can't be opened
    // under enforcement, we capture the failure and refuse to run (below)
    // rather than executing an agent whose work would go unrecorded.
    let transcriptId: string | null = null;
    let transcriptStartError: string | null = null;
    try {
      transcriptId = txStart(spec, runtime, agentId, startedAt);
    } catch (err) {
      transcriptStartError = (err as Error).message;
    }

    // Transition bond: escrowed → running. The markRunning call is what
    // cost-tracker's budget-guard hook looks at — bond must be 'running'
    // before any charge can slash it.
    if (bonds && bondId) {
      try { bonds.markRunning(bondId); } catch {}
    }

    // PD coordination: register agent
    const coordinationMetadata = {
      spawn: true,
      requiresEscrow: true,
      projectName: projectName ?? null,
      bondId,
      bondUsd,
    };

    const initialRegistryPid = registryPidFor(record);
    await pdCoordinate('/agents', {
      id: agentId,
      name: displayName,
      type: 'spawned',
      pid: initialRegistryPid,
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
      metadata: coordinationMetadata,
    }, { pid: initialRegistryPid });

    // PD coordination: start session. Begin is the ADR-0040 mint door: an
    // uncredentialed begin mints this agent's soul and returns its credential
    // ONCE — capture it, because `/sugar/done` (and every other attributed
    // write) rejects without it (#8877 / ADR-0122).
    const beginResponse = await pdCoordinate('/sugar/begin', {
      agentId,
      name: displayName,
      type: 'spawned',
      pid: initialRegistryPid,
      identity: spec.identity || null,
      purpose: spec.purpose || spec.task.slice(0, 80),
      lifecycle: 'ephemeral',
      metadata: coordinationMetadata,
    }, { pid: initialRegistryPid });
    record.actorCredential = typeof beginResponse?.credential === 'string'
      ? beginResponse.credential
      : null;

    // Start heartbeat interval
    record.heartbeatInterval = setInterval(async () => {
      const pid = registryPidFor(record);
      await pdCoordinate(`/agents/${agentId}/heartbeat`, {
        pid,
        status: 'busy',
        progress: `Running ${runtime.effectiveBackend} via Port Daddy spawner`,
      }, { pid });
    }, 30000);
    record.heartbeatInterval.unref?.();

    let output: string | null = null;
    let error: string | null = null;
    let telemetry: SpawnTelemetry | null = null;
    let coastGuardReceipt: CoastGuardReceipt | null = null;
    let structuredTurns: StructuredTurn[] | null = null;
    let budgetOverrunError: string | null = null;
    // Set by the backend's live onTranscriptDelta sink (cli-tube streaming).
    // When true, the conversation is ALREADY persisted turn-by-turn, so the
    // end-of-run path skips the batched re-append to avoid duplicating it.
    let streamedLiveDeltas = false;

    try {
      // Recording is a precondition: if the transcript row could not be opened
      // under enforcement, refuse to run the backend. An unrecorded agent run
      // is exactly what this policy forbids — fail loud instead.
      if (transcriptStartError) {
        throw new Error(
          `Spawn refused: ${transcriptStartError}. A backend must not run unless its conversation is recorded.`,
        );
      }
      const executionSpec: SpawnSpec = {
        ...spec,
        backend: runtime.effectiveBackend,
        model: runtime.effectiveModel,
      };
      const finalContinuationWorkspaceError = validateNativeResume(executionSpec, runtime)
        ?? validateSpawnWorkspace(executionSpec);
      if (finalContinuationWorkspaceError) throw new Error(finalContinuationWorkspaceError);
      const override = runnerOverrides[runtime.effectiveBackend];
      let result: BackendRunResult;

      if (override) {
        result = await override(executionSpec, runtime.effectiveModel);
      } else {
        const childContext: BackendRunContext = {
          agentId,
          onChildProcess: (child) => {
            if (record.status === 'running') {
              record.childProcess = child;
              const pid = registryPidFor(record);
              void pdCoordinate(`/agents/${agentId}/heartbeat`, {
                pid,
                status: 'busy',
                progress: `Running ${runtime.effectiveBackend} child process`,
              }, { pid });
            }
          },
          // Live transcript streaming: each event a streaming backend parses is
          // appended to the open transcript AS IT ARRIVES, so the cockpit SSE
          // (`agent.transcript` `update`) renders thinking / tool calls / text
          // mid-run. Only meaningful when a row is open (transcriptId set).
          onTranscriptDelta: transcriptId
            ? (msg) => {
                streamedLiveDeltas = true;
                txDelta(transcriptId, msg);
              }
            : undefined,
          // Live observability seam (ADR-0060): when the daemon wired a tube
          // client and this spawn carries a stable channel (dispatch:<id>), the
          // cli-tube backend publishes the exchange there for `pd tube`.
          tubeClient,
          tubeChannel: spec.tubeChannel,
        };
        switch (runtime.effectiveBackend) {
          case 'ollama':    result = await runOllama(executionSpec, runtime.effectiveModel); break;
          case 'lmstudio':  result = await runLmStudio(executionSpec, runtime.effectiveModel); break;
          case 'claude':    result = await runClaude(executionSpec, runtime.effectiveModel); break;
          case 'gemini':    result = await runGemini(executionSpec, runtime.effectiveModel); break;
          case 'cloudflare': result = await runCloudflare(executionSpec, runtime.effectiveModel); break;
          case 'openai':    result = await runOpenAI(executionSpec, runtime.effectiveModel); break;
          case 'groq':      result = await runGroq(executionSpec, runtime.effectiveModel); break;
          case 'deepseek':  result = await runDeepseek(executionSpec, runtime.effectiveModel); break;
          case 'xai':       result = await runXai(executionSpec, runtime.effectiveModel); break;
          case 'codex':     result = await runCodexCli(executionSpec, runtime.effectiveModel, childContext); break;
          case 'claude-cli': result = await runClaudeCli(executionSpec, childContext); break;
          case 'cli:claude-code': result = await runCliTube(executionSpec, 'claude-code', childContext); break;
          case 'cli:codex':       result = await runCliTube(executionSpec, 'codex', childContext); break;
          case 'cli:agy':         result = await runCliTube(executionSpec, 'agy', childContext); break;
          case 'cli:gemini':      result = await runCliTube(executionSpec, 'gemini', childContext); break;
          case 'cli:groq':        result = await runCliTube(executionSpec, 'groq', childContext); break;
          case 'cli:grok':        result = await runCliTube(executionSpec, 'grok', childContext); break;
          case 'aider':     result = await runAider(executionSpec, runtime.effectiveModel, childContext); break;
          case 'custom':    result = await runCustom(executionSpec, childContext); break;
          default:
            result = { output: '', error: `Unknown backend: ${String(runtime.effectiveBackend)}` };
        }
      }

      if (result.childProcess) {
        record.childProcess = result.childProcess;
      }

      coastGuardReceipt = result.coastGuardReceipt ?? null;
      output = result.output || null;
      error = result.error;
      structuredTurns = result.transcript && result.transcript.length > 0 ? result.transcript : null;

      if (!error && enforceTelemetryPolicy) {
        const inputTokens = result.inputTokens;
        const cachedInputTokens = result.cachedInputTokens;
        const outputTokens = result.outputTokens;

        if (inputTokens === undefined || outputTokens === undefined) {
          error = `Exact telemetry required, but ${runtime.effectiveBackend} did not return token counts.`;
          output = null;
        } else if (!costTracker) {
          error = 'Exact telemetry required, but cost tracker is unavailable.';
          output = null;
        } else {
          const computed = cachedInputTokens === undefined
            ? costTracker.computeCost(runtime.effectiveBackend, runtime.effectiveModel, inputTokens, outputTokens)
            : costTracker.computeCost(runtime.effectiveBackend, runtime.effectiveModel, inputTokens, outputTokens, cachedInputTokens);
          const allowFlatRateEstimate = allowsFlatRateEstimatedTelemetry(runtime.effectiveBackend);
          if (computed.isEstimate && !allowFlatRateEstimate) {
            error = `Exact telemetry required, but ${runtime.effectiveBackend} cost calculation fell back to an estimate.`;
            output = null;
          } else if (computed.costUsd <= 0) {
            error = `Exact telemetry required, but ${runtime.effectiveBackend} produced a non-positive cost.`;
            output = null;
          } else {
            const recorded = costTracker.record({
              backend: runtime.effectiveBackend,
              model: runtime.effectiveModel,
              projectName,
              projectDir: spec.workdir ? resolve(spec.workdir) : undefined,
              identity: spec.identity,
              spawnId: agentId,
              inputTokens,
              ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
              outputTokens,
            });

            const recordedCostUsd = normalizeTelemetryCostUsd(recorded?.costUsd);
            if (!recorded || (recorded.isEstimate && !allowFlatRateEstimate) || recordedCostUsd == null || recordedCostUsd <= 0) {
              error = `Exact telemetry required, but ${runtime.effectiveBackend} telemetry could not be persisted as an exact nonzero cost record.`;
              output = null;
            } else {
              telemetry = {
                inputTokens,
                ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
                outputTokens,
                costUsd: recordedCostUsd,
                // Honest label: 'estimated' when token counts were a best-guess
                // (backend didn't report usage), 'exact' when it did. The cost
                // RATE is exact either way (gated above), so spend is priced at
                // the real rate against guessed tokens — never silently 'exact'.
                rateMode: result.estimatedTelemetry ? 'estimated' : 'exact',
              };
              budgetOverrunError = hardBudgetCapError(spec, telemetry);
              if (budgetOverrunError) {
                error = budgetOverrunError;
              }
            }
          }
        }
      }
    } catch (err) {
      error = (err as Error).message;
    }

    // Common cleanup — runs for success, failure, and asynchronous kill.
    const wasKilled = record.status === 'killed';
    if (wasKilled) {
      error = 'Killed by spawner';
      output = null;
    }
    const completedAt = record.completedAt ?? Date.now();
    let status: SpawnResult['status'] = wasKilled ? 'killed' : budgetOverrunError ? 'over_budget' : error ? 'failed' : 'completed';

    record.status = status;
    record.completedAt = completedAt;
    record.childProcess = null;

    if (record.heartbeatInterval) {
      clearInterval(record.heartbeatInterval);
      record.heartbeatInterval = null;
    }
    if (enteredHarborName && harbors) {
      try { harbors.leaveAll(agentId); } catch {}
      enteredHarborName = null;
    }

    if (!wasKilled) {
      const doneNote = error ? `Failed: ${error.slice(0, 200)}` : `Completed: ${(output || '').slice(0, 200)}`;
      // Spawner-managed agents bypass the pd-done origin-push rule: they
      // are ephemeral workflow agents whose lifetime is tied to a
      // subprocess, not a feature branch. The override marker makes the
      // bypass auditable in session notes.
      await pdCoordinate('/sugar/done', {
        agentId,
        note: doneNote,
        skipOriginCheck: true,
        skipOriginCheckReason: 'spawner-managed agent — lifecycle is subprocess, not feature branch',
      }, { credential: record.actorCredential });
    }

    // Record the conversation + finalize transcript. Order matters: we append
    // the turns BEFORE finalize so the 'end' SSE event carries the full
    // conversation. Under enforcement a recording failure here is loud: it
    // flips the spawn to 'failed' (untracked work must not look successful).
    try {
      if (streamedLiveDeltas) {
        // Live path (cli-tube streaming): every thinking / tool / assistant turn
        // was already appended mid-run via onTranscriptDelta, so re-appending
        // `structuredTurns` or `output` here would duplicate the whole
        // conversation. Record nothing extra — the error turn below still fires.
      } else if (structuredTurns && !wasKilled) {
        // Full-depth path (codex / non-streamed): reasoning + tool calls + each
        // message turn. The final agent_message is already the last structured
        // turn, so we do NOT also append `output` — that would duplicate it.
        txMessages(transcriptId, structuredTurns, completedAt);
      } else if (output && !wasKilled) {
        // Final-answer-only backends (API calls): one assistant turn.
        txAssistant(transcriptId, output, completedAt);
      }
      if (error && !wasKilled) {
        // Record the error itself as a final turn so operators see why the run
        // failed without having to cross-reference status.
        txAssistant(transcriptId, `[error] ${error}`, completedAt);
      }
      // Outputs: minimal default — the spawner emits a 'message' output
      // summarizing the result. Fleet ships can later call
      // transcripts.appendOutput() directly to add pr-comment / draft-pr /
      // commit artifacts.
      if (!wasKilled && transcriptId) {
        const turnCount = structuredTurns?.length ?? 0;
        const summary = error
          ? `failed: ${error.slice(0, 160)}`
          : turnCount > 0
            ? `${runtime.effectiveBackend}: ${turnCount} turns, ${(output || '').length} chars`
            : `${runtime.effectiveBackend} returned ${(output || '').length} chars`;
        txOutput(transcriptId, {
          type: error ? 'noop' : 'message',
          summary,
        });
      }
    } catch (recordingErr) {
      // recordOrThrow already logged a red banner. Surface the failure on the
      // SpawnResult so the caller sees that recording — not the agent — broke.
      if (!error) {
        error = recordingErr instanceof Error ? recordingErr.message : String(recordingErr);
        status = 'failed';
        record.status = 'failed';
      }
    }
    // Finalize. Under enforcement a finalize failure must NOT let the spawn
    // report success — flip the result to failed and surface the error, then
    // make a best-effort attempt to stamp the row 'failed' so it isn't stranded
    // in 'running'. (In best-effort mode txFinalize swallows internally, so
    // this catch never fires and behavior is unchanged.)
    try {
      txFinalize(transcriptId, status, completedAt, telemetry, error);
    } catch (finalizeErr) {
      if (!error) error = finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr);
      status = 'failed';
      record.status = 'failed';
      try { txFinalize(transcriptId, 'failed', completedAt, telemetry, error); } catch { /* row may be unreachable; the SpawnResult already reports failed */ }
    }

    // Resolve bond. Clean exit → full refund; error → slash full bond with reason.
    // Why slash on any error: an error means the spawn didn't do its job; the
    // commons pool absorbs the cost so the operator doesn't eat it silently.
    if (bonds && bondId) {
      try {
        if (wasKilled) {
          // kill() already resolves the bond as an operator intervention.
        } else if (error) {
          bonds.slash(bondId, bondUsd, `spawn-failed: ${error.slice(0, 120)}`);
        } else {
          bonds.refund(bondId);
        }
      } catch {
        // bond resolution failures are logged but never fail the spawn path
      }
    }

    if (!wasKilled) {
      counters?.bump(error ? 'spawn.failed' : 'spawn.completed', dims);
    }
    if (!error) {
      counters?.bump('spawn.duration_ms', dims, Math.max(1, completedAt - startedAt));
    }
    if (!enforceTelemetryPolicy) {
      costTracker?.record({
        backend: runtime.effectiveBackend,
        model: runtime.effectiveModel,
        projectName,
        projectDir: spec.workdir ? resolve(spec.workdir) : undefined,
        identity: spec.identity,
        spawnId: agentId,
      });
    }

    return {
      agentId,
      name: displayName,
      backend: runtime.effectiveBackend,
      model: runtime.effectiveModel,
      requestedBackend: runtime.requestedBackend,
      effectiveBackend: runtime.effectiveBackend,
      requestedModel: runtime.requestedModel,
      effectiveModel: runtime.effectiveModel,
      backendOverrideSource: runtime.backendOverrideSource,
      status,
      output,
      error,
      telemetry,
      startedAt,
      completedAt,
      coastGuard: coastGuardReceipt,
      ...(spec.nativeResume ? { harnessSessionId: spec.nativeResume.sessionId } : {}),
    };
  }

  /**
   * List all active (and recently completed) spawned agents.
   */
  function list(): SpawnedAgent[] {
    cleanupStaleAgents();
    return Array.from(agents.values()).map((r) => ({
      agentId: r.agentId,
      name: r.name,
      backend: r.backend,
      model: r.model,
      requestedBackend: r.requestedBackend,
      effectiveBackend: r.effectiveBackend,
      requestedModel: r.requestedModel,
      effectiveModel: r.effectiveModel,
      backendOverrideSource: r.backendOverrideSource,
      status: r.status,
      identity: r.identity,
      purpose: r.purpose,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    }));
  }

  /**
   * Stop a running spawned agent.
   */
  function kill(agentId: string): void {
    const record = agents.get(agentId);
    if (!record) return;

    // Clean up heartbeat
    if (record.heartbeatInterval) {
      clearInterval(record.heartbeatInterval);
      record.heartbeatInterval = null;
    }
    try {
      harbors?.leaveAll(agentId);
    } catch {}

    // Kill child process if present
    if (record.childProcess) {
      terminateChildProcess(record.childProcess);
      record.childProcess = null;
    }

    record.status = 'killed';
    record.completedAt = Date.now();
    counters?.bump('spawn.killed', metricDims(record.backend, record.model, record.identity));

    // Kill is an intervention, not a clean exit — slash the bond so the
    // commons pool captures the cost of the decision. Panic path calls
    // bonds.refund separately (operator action, not misbehavior) BEFORE
    // invoking kill, so by the time we get here the bond is either already
    // resolved (no-op) or this is a real kill-for-cause.
    if (bonds && record.bondId) {
      try {
        bonds.slash(record.bondId, record.bondUsd || 0, 'killed-by-spawner');
      } catch {}
    }

    // PD coordination: done (fire-and-forget)
    pdCoordinate('/sugar/done', {
      agentId,
      note: 'Killed by spawner',
      status: 'abandoned',
      skipOriginCheck: true,
      skipOriginCheckReason: 'spawner-managed agent killed by operator',
    }, { credential: record.actorCredential }).catch(() => {});

    // Finalize any open transcript for this agent. We don't keep the
    // transcriptId on the AgentRecord (to avoid a circular type dep on the
    // public SpawnedAgent shape), so kill() finalizes by spawned_agent_id.
    if (transcripts) {
      try {
        const open = transcripts.listTranscripts({ agentId, status: 'running', limit: 1 });
        for (const tx of open) {
          transcripts.finalize(tx.id, {
            status: 'killed',
            ended_at: Date.now(),
            error: 'Killed by spawner',
          });
        }
      } catch { /* swallow */ }
    }
  }

  return { spawn, list, kill };
}

export type Spawner = ReturnType<typeof createSpawner>;
