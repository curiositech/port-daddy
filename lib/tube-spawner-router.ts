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
 *   - `timeout` is clamped; `task`/`backend` are validated; unknown fields are
 *     dropped (the spawn spec is rebuilt allow-listed, never spread from input).
 *
 * The core is transport-agnostic: it takes injected `spawn` and `send`
 * functions, so the same logic works CLI-side (scripts/tube-spawn-router.ts)
 * or, later, daemon-side, and is exhaustively unit-testable without a daemon.
 */

import type { SpawnSpec, SpawnResult } from './spawner.js';
import type { TubeMessage } from './tube.js';

/** Backends a router may launch unless the policy narrows further. */
const DEFAULT_ALLOWED_BACKENDS: ReadonlyArray<SpawnSpec['backend']> = [
  'claude-cli',
  'cli:claude-code',
  'codex',
  'cli:codex',
  'ollama',
];

const HARD_MAX_TIMEOUT_MS = 30 * 60 * 1000; // 30 min absolute ceiling
const DEFAULT_MAX_TIMEOUT_MS = 10 * 60 * 1000;

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
  timeout?: number;
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
  /** Upper bound on `timeout` (ms). Clamped to HARD_MAX_TIMEOUT_MS. */
  maxTimeoutMs?: number;
  /** Identity applied to spawns that don't specify one. */
  defaultIdentity?: string;
  /** Default backend when a command omits one. */
  defaultBackend?: SpawnSpec['backend'];
}

/** Is this sender permitted to issue commands under the policy? */
export function isSenderAllowed(sender: string | null, policy: RouterPolicy): boolean {
  if (!policy.allowedSenders || policy.allowedSenders.length === 0) return true;
  if (!sender) return false;
  return policy.allowedSenders.includes(sender);
}

/**
 * Build a validated SpawnSpec from a command under a policy. Returns a refusal
 * string instead of a spec when the policy forbids it. The spec is constructed
 * field-by-field (allow-listed) — never spread from caller input.
 */
export function buildSpawnSpec(
  cmd: TubeCommandEnvelope,
  policy: RouterPolicy,
): { spec: SpawnSpec } | { refusal: string } {
  const allowed = policy.allowedBackends ?? DEFAULT_ALLOWED_BACKENDS;
  const backend = (cmd.backend ?? policy.defaultBackend) as SpawnSpec['backend'] | undefined;
  if (!backend) {
    return { refusal: 'no backend specified and policy sets no defaultBackend' };
  }
  if (!allowed.includes(backend)) {
    return { refusal: `backend '${backend}' not in allowed set [${allowed.join(', ')}]` };
  }
  if (typeof cmd.task !== 'string' || !cmd.task.trim()) {
    return { refusal: 'task is required' };
  }
  const ceiling = Math.min(policy.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS, HARD_MAX_TIMEOUT_MS);
  const timeout =
    typeof cmd.timeout === 'number' && Number.isFinite(cmd.timeout) && cmd.timeout > 0
      ? Math.min(Math.floor(cmd.timeout), ceiling)
      : ceiling;
  const spec: SpawnSpec = {
    backend,
    task: cmd.task,
    timeout,
    ...(cmd.name ? { name: cmd.name } : {}),
    ...(cmd.model ? { model: cmd.model } : {}),
    ...(cmd.modelTier ? { modelTier: cmd.modelTier } : {}),
    ...(cmd.purpose ? { purpose: cmd.purpose } : {}),
    identity: cmd.identity ?? policy.defaultIdentity,
    trigger: 'tube',
  };
  return { spec };
}

export type RouterOutcome =
  | { action: 'ignored'; reason: string }
  | { action: 'refused'; reason: string; replyId?: number }
  | { action: 'pong'; replyId?: number }
  | { action: 'spawned'; agentId: string; status: SpawnResult['status']; replyId?: number }
  | { action: 'error'; error: string; replyId?: number };

export interface RouterDeps {
  /** Launch an agent (inject the daemon /spawn caller or spawner.spawn). */
  spawn: (spec: SpawnSpec) => Promise<SpawnResult>;
  /** Post a reply back onto the channel. Returns the new message id. */
  send: (channel: string, body: string) => Promise<{ id: number }>;
  channel: string;
  policy: RouterPolicy;
}

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

  // spawn
  const built = buildSpawnSpec(parsed.raw, policy);
  if ('refusal' in built) return refuse(built.refusal);

  try {
    const result = await spawn(built.spec);
    const { id } = await send(
      channel,
      JSON.stringify({
        kind: 'router.spawned',
        agentId: result.agentId,
        status: result.status,
        backend: result.backend,
        model: result.model,
        error: result.error,
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
