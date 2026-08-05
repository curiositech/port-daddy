/**
 * Tube → Spawner router: the missing bridge that lets an external session
 * (ChatGPT/Codex, another agent, a human) DRIVE the fleet over `pd tube`.
 *
 * Before this module, the two halves existed but were not connected:
 *   - `pd tube` (lib/tube.ts) reliably transports messages between subscribers.
 *   - `spawner.spawn()` (lib/spawner.ts) reliably launches agents.
 * Nothing turned an inbound tube message into a spawn. This does — and posts the
 * result back on the same channel so the caller gets work back, not just an ack.
 *
 * ── SECURITY (read this) ──────────────────────────────────────────────────────
 * An inbound message that triggers a spawn is remote code execution over a
 * message bus. This module is therefore FAIL-CLOSED by construction:
 *   - The router is DISABLED unless a policy explicitly enables it.
 *   - A tube `sender` is self-declared, so an allowlist is necessary but NOT
 *     sufficient — treat it as defense-in-depth, run the router only on a
 *     control channel you trust, and keep `allowedBackends` tight.
 *   - Every refusal is LOUD: it posts a structured refusal back to the channel
 *     and returns a typed outcome. Nothing is ever silently dropped.
 *   - `deadlineMs` is clamped; `task`/`backend` are validated; unknown fields are
 *     dropped (the spawn spec is rebuilt allow-listed, never spread from input).
 *
 * ── DELEGATION & LOOP DETECTION (read this too) ───────────────────────────────
 * A spawned agent can post its own `{"command":"spawn"}` on the channel. Without
 * lineage that is unbounded ping-pong: A spawns B, B spawns A', A' spawns B', …
 * Every spawn therefore carries a `delegationChain` — an append-only record of
 * who-spawned-whom along this branch. Before launching, the router refuses
 * (fail-closed, typed, loud) when:
 *   (a) DEPTH:   the chain is at/over `maxDelegationDepth` hops;
 *   (b) BUDGET:  the chain already holds `maxChainSpawns` spawns (branch fan-out);
 *   (c) PING-PONG: the *normalized structural shape* of this task already appears
 *       in the chain (a repeated task-shape on one branch is a loop — this is a
 *       structural fingerprint, NOT keyword matching, so trivial perturbations
 *       like reordering/casing/whitespace/ID-swaps do not evade it);
 *   (d) UPWARD:  the requesting agent (or this router) is trying to delegate back
 *       to an identity that is already an ANCESTOR in the chain (re-entry).
 * The chain is injected into the spawned agent's env as `PD_DELEGATION_CHAIN`
 * (JSON) so that when *that* agent drives the tube the lineage propagates and the
 * same gates apply one level deeper. The CLI runner reads it back to seed
 * inbound requests it cannot otherwise attribute.
 *
 * The core is transport-agnostic: it takes injected `spawn` and `send`
 * functions, so the same logic works CLI-side (scripts/tube-spawn-router.ts)
 * or, later, daemon-side, and is exhaustively unit-testable without a daemon.
 */

import { createHash } from 'node:crypto';
import type { SpawnSpec, SpawnResult } from './spawner.js';
import type { TubeMessage } from './tube.js';

/** Backends a router may launch unless the policy narrows further. */
const DEFAULT_ALLOWED_BACKENDS: ReadonlyArray<SpawnSpec['backend']> = [
  'claude-cli',
  'cli:claude-code',
  'codex',
  'cli:codex',
  'cli:agy',
  'ollama',
];

/**
 * Every backend the spawner knows about. The router validates a requested
 * backend against the policy's allowed set, but it ALSO refuses a backend the
 * spawner itself does not implement — defense-in-depth so a typo or a smuggled
 * value can never reach the spawner. Kept in sync with `SpawnSpec['backend']`.
 */
const KNOWN_BACKENDS: ReadonlyArray<SpawnSpec['backend']> = [
  'ollama',
  'claude',
  'claude-cli',
  'gemini',
  'cloudflare',
  'codex',
  'aider',
  'custom',
  'openai',
  'groq',
  'cli:claude-code',
  'cli:codex',
  'cli:agy',
  'cli:gemini',
  'cli:groq',
  'cli:grok',
];

const HARD_MAX_DEADLINE_MS = 30 * 60 * 1000; // 30 min absolute ceiling
const DEFAULT_MAX_DEADLINE_MS = 10 * 60 * 1000;

/** Absolute ceilings. A policy may tighten these but NEVER loosen past them. */
const HARD_MAX_DELEGATION_DEPTH = 8;
const DEFAULT_MAX_DELEGATION_DEPTH = 4;
const HARD_MAX_CHAIN_SPAWNS = 16;
const DEFAULT_MAX_CHAIN_SPAWNS = 8;
/** Process-global fan-out backstop (independent of any single branch). */
const HARD_MAX_TOTAL_SPAWNS = 256;
const DEFAULT_MAX_TOTAL_SPAWNS = 64;

/** Env var the spawned agent receives so it propagates lineage downstream. */
export const DELEGATION_CHAIN_ENV = 'PD_DELEGATION_CHAIN';

/**
 * One hop of delegation lineage. `taskShape` is the normalized structural
 * fingerprint of the task (see `normalizeTaskShape`), used for ping-pong
 * detection without matching on keywords. `agentId` is the spawned agent's id
 * for that hop (or the requesting agent for the synthetic root).
 */
export interface DelegationHop {
  /** Spawned agent id at this hop, or the requesting identity for the root. */
  agentId: string;
  /** Normalized structural fingerprint of the task that produced this hop. */
  taskShape: string;
  /** 0-based depth of this hop within the branch. */
  depth: number;
  /** Backend used at this hop (informational; aids audit). */
  backend?: string;
}

/** What a caller may put on the wire. `command` is the discriminator. */
export interface TubeCommandEnvelope {
  command: string;
  backend?: string;
  task?: string;
  name?: string;
  model?: string;
  modelTier?: 'low' | 'mid' | 'high';
  identity?: string;
  purpose?: string;
  /** Optional caller-owned deadline in milliseconds. */
  deadlineMs?: number;
  /**
   * Lineage carried by a spawned agent that is itself driving the tube. The
   * router VALIDATES this — it is not trusted blindly — but a chain that arrives
   * already at/over a cap is refused exactly like one the router would have
   * computed itself, so a child cannot reset its own lineage to escape limits.
   */
  delegationChain?: unknown;
}

export type ParsedCommand =
  | { kind: 'none' } // not a command — ordinary chat; ignore
  | { kind: 'ping' }
  | { kind: 'spawn'; raw: TubeCommandEnvelope }
  | { kind: 'invalid'; error: string };

/**
 * Parse a tube message body. Non-JSON, or JSON without a `command` field, is
 * ordinary chat → `{ kind: 'none' }` (the router leaves it alone). A recognized
 * command with bad shape → `{ kind: 'invalid' }` (the router refuses loudly).
 */
export function parseTubeCommand(body: string): ParsedCommand {
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    return { kind: 'none' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { kind: 'none' };
  const env = obj as Record<string, unknown>;
  if (typeof env.command !== 'string') return { kind: 'none' };
  const command = env.command.trim().toLowerCase();
  if (command === 'ping') return { kind: 'ping' };
  if (command === 'spawn') {
    if (typeof env.task !== 'string' || !env.task.trim()) {
      return { kind: 'invalid', error: 'spawn: `task` (non-empty string) is required' };
    }
    if (env.backend !== undefined && typeof env.backend !== 'string') {
      return { kind: 'invalid', error: 'spawn: `backend` must be a string' };
    }
    return { kind: 'spawn', raw: env as unknown as TubeCommandEnvelope };
  }
  return { kind: 'invalid', error: `unknown command: ${command}` };
}

export interface RouterPolicy {
  /** Master switch. Fail-closed: the router does nothing unless this is true. */
  enabled: boolean;
  /** If set, only commands from these senders are acted on. */
  allowedSenders?: string[];
  /** Backends the router may launch. Defaults to a safe subset. */
  allowedBackends?: ReadonlyArray<SpawnSpec['backend']>;
  /** Upper bound on `deadlineMs` (ms). */
  maxDeadlineMs?: number;
  /** Identity applied to spawns that don't specify one. */
  defaultIdentity?: string;
  /** Default backend when a command omits one. */
  defaultBackend?: SpawnSpec['backend'];
  /** Max delegation hops along one branch. Clamped to HARD_MAX_DELEGATION_DEPTH. */
  maxDelegationDepth?: number;
  /** Max total spawns along one branch. Clamped to HARD_MAX_CHAIN_SPAWNS. */
  maxChainSpawns?: number;
  /**
   * Allow a child to delegate back UP to an ancestor identity. Default false —
   * upward delegation is a classic loop and is blocked unless explicitly opened.
   */
  allowUpwardDelegation?: boolean;
  /**
   * Process-global ceiling on the TOTAL number of spawns this router will ever
   * launch (across all branches/messages). Per-branch loop guards bound a single
   * delegation chain, but an authorized (or spoofed-authorized) sender can still
   * FAN OUT with many independent depth-0 requests. This is the absolute backstop
   * against budget exhaustion. Clamped to HARD_MAX_TOTAL_SPAWNS. Default applies.
   */
  maxTotalSpawns?: number;
}

/** Is this sender permitted to issue commands under the policy? */
export function isSenderAllowed(sender: string | null, policy: RouterPolicy): boolean {
  if (!policy.allowedSenders || policy.allowedSenders.length === 0) return true;
  if (!sender) return false;
  return policy.allowedSenders.includes(sender);
}

/**
 * Normalize a task string to a STRUCTURAL fingerprint for loop detection.
 *
 * This is deliberately NOT keyword matching. The goal is: two requests that are
 * "the same task wearing different clothes" collapse to the same fingerprint, so
 * an attacker cannot evade ping-pong detection by reordering words, changing
 * case, adding whitespace/punctuation, or swapping embedded ids/numbers.
 *
 * Steps: lowercase → strip URLs → replace digit/hex/uuid runs with a placeholder
 * → drop punctuation → tokenize on whitespace → dedupe + sort tokens → hash.
 * Order-independence is intentional: "build the api then test it" and "test it
 * then build the api" are the same shape for loop purposes.
 */
export function normalizeTaskShape(task: string): string {
  const lowered = String(task).toLowerCase();
  const noUrls = lowered.replace(/https?:\/\/\S+/g, ' ');
  // Collapse anything that looks like an id/number/uuid/hex into nothing so
  // swapping "pr 262" → "pr 999" or a fresh uuid does not change the shape.
  const noIds = noUrls
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/g, ' ') // uuid
    .replace(/\b[0-9a-f]{7,}\b/g, ' ') // long hex (sha-ish)
    .replace(/\b\d+\b/g, ' '); // bare numbers
  const tokens = noIds
    .replace(/[^a-z\s]+/g, ' ') // drop remaining punctuation/symbols
    .split(/\s+/)
    .filter(Boolean);
  const uniqueSorted = Array.from(new Set(tokens)).sort();
  const canonical = uniqueSorted.join(' ');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** Coerce arbitrary inbound JSON into a validated DelegationHop[] (or []). */
export function parseDelegationChain(raw: unknown): DelegationHop[] {
  if (!Array.isArray(raw)) return [];
  const out: DelegationHop[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const h = item as Record<string, unknown>;
    if (typeof h.agentId !== 'string' || typeof h.taskShape !== 'string') continue;
    const depth =
      typeof h.depth === 'number' && Number.isFinite(h.depth) ? Math.floor(h.depth) : out.length;
    out.push({
      agentId: h.agentId,
      taskShape: h.taskShape,
      depth,
      ...(typeof h.backend === 'string' ? { backend: h.backend } : {}),
    });
  }
  return out;
}

/** Serialize a chain for the spawned agent's env. */
export function serializeDelegationChain(chain: DelegationHop[]): string {
  return JSON.stringify(chain);
}

/** Read the inbound chain a parent injected into THIS process's env (CLI side). */
export function inboundChainFromEnv(env: NodeJS.ProcessEnv = process.env): DelegationHop[] {
  const raw = env[DELEGATION_CHAIN_ENV];
  if (!raw) return [];
  try {
    return parseDelegationChain(JSON.parse(raw));
  } catch {
    return [];
  }
}

export interface LoopDecision {
  /** The validated, inbound chain (already-existing lineage for this branch). */
  inbound: DelegationHop[];
  /** The structural fingerprint of the requested task. */
  taskShape: string;
}

/**
 * Decide whether a requested spawn would create or continue a delegation loop.
 * Returns a refusal string when it would, or the validated context to proceed.
 * Pure — no I/O — so it is exhaustively testable.
 */
export function assessDelegation(
  cmd: TubeCommandEnvelope,
  sender: string | null,
  policy: RouterPolicy,
): { ok: LoopDecision } | { refusal: string } {
  const maxDepth = Math.min(
    policy.maxDelegationDepth ?? DEFAULT_MAX_DELEGATION_DEPTH,
    HARD_MAX_DELEGATION_DEPTH,
  );
  const maxSpawns = Math.min(
    policy.maxChainSpawns ?? DEFAULT_MAX_CHAIN_SPAWNS,
    HARD_MAX_CHAIN_SPAWNS,
  );
  const inbound = parseDelegationChain(cmd.delegationChain);
  const taskShape = normalizeTaskShape(String(cmd.task ?? ''));

  // (a) DEPTH — the next hop would be at index == inbound.length.
  if (inbound.length >= maxDepth) {
    return {
      refusal:
        `delegation depth ${inbound.length} reached cap ${maxDepth}; refusing to spawn deeper ` +
        `(loop guard). Chain: ${inbound.map((h) => h.agentId).join(' -> ') || '(root)'}`,
    };
  }

  // (b) BUDGET — total spawns along this branch.
  if (inbound.length >= maxSpawns) {
    return {
      refusal: `delegation branch already used ${inbound.length} spawn(s); cap is ${maxSpawns} (loop guard)`,
    };
  }

  // (c) PING-PONG — the same structural task-shape already appears on this branch.
  if (inbound.some((h) => h.taskShape === taskShape)) {
    return {
      refusal:
        `ping-pong detected: task shape ${taskShape} already appears in this delegation chain ` +
        `(structural match — perturbing the wording does not change the shape)`,
    };
  }

  // (d) UPWARD — refuse delegating back to an ancestor identity (re-entry).
  if (!policy.allowUpwardDelegation && sender) {
    if (inbound.some((h) => h.agentId === sender)) {
      return {
        refusal:
          `upward delegation blocked: '${sender}' is already an ancestor in this chain ` +
          `(re-entry). Set allowUpwardDelegation to override (not recommended)`,
      };
    }
  }

  return { ok: { inbound, taskShape } };
}

/**
 * Build a validated SpawnSpec from a command under a policy. Returns a refusal
 * string instead of a spec when the policy forbids it. The spec is constructed
 * field-by-field (allow-listed) — never spread from caller input.
 *
 * `loop` carries the validated inbound chain + this task's shape so the spawned
 * agent's env can be seeded with the EXTENDED chain (lineage propagation). When
 * omitted (legacy callers / unit tests) the chain is recomputed from the cmd.
 */
export function buildSpawnSpec(
  cmd: TubeCommandEnvelope,
  policy: RouterPolicy,
  loop?: LoopDecision,
): { spec: SpawnSpec; childChain: DelegationHop[] } | { refusal: string } {
  const allowed = policy.allowedBackends ?? DEFAULT_ALLOWED_BACKENDS;
  const backend = (cmd.backend ?? policy.defaultBackend) as SpawnSpec['backend'] | undefined;
  if (!backend) {
    return { refusal: 'no backend specified and policy sets no defaultBackend' };
  }
  // Defense-in-depth: must be a backend the SPAWNER implements, regardless of
  // what the policy allows. A smuggled/typo value never reaches the spawner.
  if (!KNOWN_BACKENDS.includes(backend)) {
    return { refusal: `backend '${backend}' is not a known spawner backend` };
  }
  if (!allowed.includes(backend)) {
    return { refusal: `backend '${backend}' not in allowed set [${allowed.join(', ')}]` };
  }
  if (typeof cmd.task !== 'string' || !cmd.task.trim()) {
    return { refusal: 'task is required' };
  }
  const ceiling = Math.min(policy.maxDeadlineMs ?? DEFAULT_MAX_DEADLINE_MS, HARD_MAX_DEADLINE_MS);
  const requestedDeadlineMs =
    typeof cmd.deadlineMs === 'number' && Number.isFinite(cmd.deadlineMs) && cmd.deadlineMs > 0
      ? cmd.deadlineMs
      : undefined;
  const deadlineMs = requestedDeadlineMs === undefined
    ? undefined
    : Math.min(Math.floor(requestedDeadlineMs), ceiling);

  const inbound = loop?.inbound ?? parseDelegationChain(cmd.delegationChain);
  const taskShape = loop?.taskShape ?? normalizeTaskShape(cmd.task);
  // The child's chain = inbound + this hop. The spawned agent's id is not known
  // until after spawn, so the env carries the chain with a placeholder id that
  // the caller rewrites once it has the real agentId.
  const childChain: DelegationHop[] = [
    ...inbound,
    { agentId: '(pending)', taskShape, depth: inbound.length, backend },
  ];

  const spec: SpawnSpec = {
    backend,
    task: cmd.task,
    ...(cmd.name ? { name: cmd.name } : {}),
    ...(cmd.model ? { model: cmd.model } : {}),
    ...(cmd.modelTier ? { modelTier: cmd.modelTier } : {}),
    ...(cmd.purpose ? { purpose: cmd.purpose } : {}),
    identity: cmd.identity ?? policy.defaultIdentity,
    trigger: 'tube',
    ...(deadlineMs === undefined ? {} : { deadlineMs }),
  };
  return { spec, childChain };
}

export type RouterOutcome =
  | { action: 'ignored'; reason: string }
  | { action: 'refused'; reason: string; replyId?: number }
  | { action: 'pong'; replyId?: number }
  | { action: 'spawned'; agentId: string; status: SpawnResult['status']; replyId?: number }
  | { action: 'error'; error: string; replyId?: number };

/**
 * Mutable per-process accounting the router threads across messages. Inject a
 * single shared instance from a long-running runner so the global fan-out cap is
 * enforced across ALL inbound messages, not reset per call. Optional: when
 * omitted the router uses an internal default (still enforced per process).
 */
export interface RouterState {
  /** Count of spawns COMMITTED so far this process (attempted launches). */
  totalSpawns: number;
}

export interface RouterDeps {
  /** Launch an agent (inject the daemon /spawn caller or spawner.spawn). */
  spawn: (spec: SpawnSpec) => Promise<SpawnResult>;
  /** Post a reply back onto the channel. Returns the new message id. */
  send: (channel: string, body: string) => Promise<{ id: number }>;
  channel: string;
  policy: RouterPolicy;
  /** Shared fan-out accounting. Inject one instance from the runner. */
  state?: RouterState;
}

/** Make a fresh shared state object for a runner to thread across messages. */
export function createRouterState(): RouterState {
  return { totalSpawns: 0 };
}

/**
 * Fallback process-global state used when a caller does not inject one. Even a
 * caller that forgets to thread `state` still gets a per-process fan-out cap —
 * fail-closed by default rather than unbounded.
 */
const DEFAULT_PROCESS_STATE: RouterState = { totalSpawns: 0 };

/**
 * Route a single inbound tube message. Pure-ish orchestration over injected
 * spawn/send. Always returns a typed outcome; loud refusals are also posted
 * back to the channel so the caller sees them.
 */
export async function routeInboundTubeMessage(
  msg: TubeMessage,
  deps: RouterDeps,
): Promise<RouterOutcome> {
  const { policy, channel, send, spawn } = deps;
  const state = deps.state ?? DEFAULT_PROCESS_STATE;

  const refuse = async (reason: string): Promise<RouterOutcome> => {
    const { id } = await send(channel, JSON.stringify({ kind: 'router.refused', reason }));
    return { action: 'refused', reason, replyId: id };
  };

  if (!policy.enabled) return { action: 'ignored', reason: 'router disabled' };

  const parsed = parseTubeCommand(msg.body);
  if (parsed.kind === 'none') return { action: 'ignored', reason: 'not a command' };

  // Authorization gate applies to every real command.
  if (!isSenderAllowed(msg.sender, policy)) {
    return refuse(`sender '${msg.sender ?? '(none)'}' is not authorized`);
  }

  if (parsed.kind === 'invalid') return refuse(parsed.error);

  if (parsed.kind === 'ping') {
    const { id } = await send(channel, JSON.stringify({ kind: 'router.pong', at: msg.createdAt }));
    return { action: 'pong', replyId: id };
  }

  // spawn — loop/lineage gate BEFORE any backend validation or launch.
  const loop = assessDelegation(parsed.raw, msg.sender, policy);
  if ('refusal' in loop) return refuse(loop.refusal);

  const built = buildSpawnSpec(parsed.raw, policy, loop.ok);
  if ('refusal' in built) return refuse(built.refusal);

  // Process-global fan-out backstop: bound TOTAL spawns regardless of branch.
  // This is the defense against an authorized (or spoofed) sender exhausting
  // budget with many independent depth-0 requests that each pass the per-branch
  // loop guards. Checked AFTER all validation so the refusal is specific.
  const totalCap = Math.min(policy.maxTotalSpawns ?? DEFAULT_MAX_TOTAL_SPAWNS, HARD_MAX_TOTAL_SPAWNS);
  if (state.totalSpawns >= totalCap) {
    return refuse(
      `process spawn budget exhausted: ${state.totalSpawns}/${totalCap} spawns committed ` +
        `(global fan-out backstop). Restart the router or raise --max-total-spawns within the hard cap.`,
    );
  }
  // Commit the budget NOW (before launch) so a burst of concurrent inbound
  // messages cannot all pass the check before any increments — attempted
  // launches count, which is the correct semantics for resource protection.
  state.totalSpawns += 1;

  // Inject the extended lineage into the spawned agent's env so that when IT
  // drives the tube, depth/budget/ping-pong/upward gates apply one level deeper.
  // The agent's real id is unknown pre-spawn, so we seed with the chain as-is
  // (placeholder id); the value is still depth/shape-accurate, which is what the
  // loop guards key on.
  const specWithLineage: SpawnSpec = {
    ...built.spec,
    env: {
      ...(built.spec.env || {}),
      [DELEGATION_CHAIN_ENV]: serializeDelegationChain(built.childChain),
    },
  };

  try {
    const result = await spawn(specWithLineage);
    // Rewrite the pending hop with the real agent id for the result echo so
    // callers can see the lineage that was applied.
    const appliedChain = built.childChain.map((h, i) =>
      i === built.childChain.length - 1 ? { ...h, agentId: result.agentId } : h,
    );
    const { id } = await send(
      channel,
      JSON.stringify({
        kind: 'router.spawned',
        agentId: result.agentId,
        status: result.status,
        backend: result.backend,
        model: result.model,
        error: result.error,
        delegationChain: appliedChain,
        delegationDepth: appliedChain.length,
        output: typeof result.output === 'string' ? result.output.slice(0, 4000) : null,
      }),
    );
    return { action: 'spawned', agentId: result.agentId, status: result.status, replyId: id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const { id } = await send(channel, JSON.stringify({ kind: 'router.error', error }));
    return { action: 'error', error, replyId: id };
  }
}
