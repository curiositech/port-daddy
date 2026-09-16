/**
 * Agent Harbor C2 — adapter capability matrix (binder ch18 Work Order C2).
 *
 * One row per body kind the fleet can attach: what launch modes its mechanics
 * allow, the highest transcript fidelity and compliance level a probe could
 * ever witness for it, which controls it can honor, and which model tiers it
 * serves. The matrix states MECHANICAL CEILINGS, not grants — an actual level
 * is only ever granted by a daemon-witnessed ComplianceProbeResult
 * (ADR-0095 §8; skills: agent-compliance-conformance). A probe can witness at
 * or below the ceiling, never above it.
 *
 * Ceiling rationale is written per row because the integration reviewer (I0)
 * must be able to challenge each claim against the binder, not against vibes.
 */

import type {
  AdapterKind,
  ComplianceLevel,
  ControlKind,
  LaunchMode,
  ModelTier,
  TranscriptFidelity,
} from './types.js';
import { ADAPTER_KINDS, CONTROL_KINDS, complianceOrder } from './types.js';

export type ControlSupport = 'supported' | 'degraded' | 'unsupported';

export interface AdapterCapabilityProfile {
  kind: AdapterKind;
  displayName: string;
  /** Launch modes this adapter's mechanics can honestly run under. */
  launchModes: LaunchMode[];
  defaultLaunchMode: LaunchMode;
  /** Highest transcript fidelity witnessable given the adapter's mechanics. */
  transcriptFidelityCeiling: TranscriptFidelity;
  /** Highest compliance level a probe could ever witness for this adapter. */
  complianceCeiling: ComplianceLevel;
  /** Model tiers this adapter can serve (agent-run.schema body.modelTier). */
  modelTiers: ModelTier[];
  /** Whether `local`/`custom` tiers require an operator-supplied model name. */
  requiresExplicitModelName: boolean;
  /** Per-control mechanical support; probes decide whether it is actually honored. */
  controls: Record<ControlKind, ControlSupport>;
  hookSupport: {
    preTool: boolean;
    postTool: boolean;
    transcriptStream: boolean;
    heartbeat: boolean;
  };
  ceilingRationale: string;
}

function controls(overrides: Partial<Record<ControlKind, ControlSupport>>): Record<ControlKind, ControlSupport> {
  const base = Object.fromEntries(CONTROL_KINDS.map((k) => [k, 'unsupported' as ControlSupport]));
  // retire is a daemon registry operation, mechanically available for every adapter.
  base.retire = 'supported';
  return { ...base, ...overrides } as Record<ControlKind, ControlSupport>;
}

export const CAPABILITY_MATRIX: Record<AdapterKind, AdapterCapabilityProfile> = {
  'claude-code': {
    kind: 'claude-code',
    displayName: 'Claude Code',
    launchModes: ['hooked', 'native', 'observed'],
    defaultLaunchMode: 'hooked',
    transcriptFidelityCeiling: 'T5',
    complianceCeiling: 'C6',
    modelTiers: ['fast', 'mid', 'strong'],
    requiresExplicitModelName: false,
    controls: controls({
      pause: 'supported', interrupt: 'supported', steer: 'supported',
      checkpoint: 'supported', resume: 'supported', fork: 'supported', kill: 'supported',
    }),
    hookSupport: { preTool: true, postTool: true, transcriptStream: true, heartbeat: true },
    ceilingRationale:
      'Pre/post-tool hooks + JSONL session transcripts give a verifiable T4/T5 stream; '
      + 'session resume supports successor runs, so C6 Resumable is mechanically witnessable (binder ch03/ch07 milestone 2).',
  },
  'codex-cli': {
    kind: 'codex-cli',
    displayName: 'Codex CLI',
    launchModes: ['native', 'proxy', 'observed'],
    defaultLaunchMode: 'native',
    transcriptFidelityCeiling: 'T4',
    complianceCeiling: 'C4',
    modelTiers: ['fast', 'mid', 'strong'],
    requiresExplicitModelName: false,
    controls: controls({
      interrupt: 'supported', kill: 'supported', steer: 'degraded', pause: 'degraded',
    }),
    hookSupport: { preTool: false, postTool: false, transcriptStream: true, heartbeat: true },
    ceilingRationale:
      'Run-log + tool events are verifiable (T4 with daemon-side hashing) but no PD pre-tool hook exists, '
      + 'so governance rides an MCP gateway proxy; process signals give C4 Controllable. '
      + 'No native checkpoint/successor path, so C5+ is not mechanically witnessable yet.',
  },
  cloudflare: {
    kind: 'cloudflare',
    displayName: 'Cloudflare (cloud fleet)',
    launchModes: ['native', 'observed'],
    defaultLaunchMode: 'native',
    transcriptFidelityCeiling: 'T4',
    complianceCeiling: 'C4',
    modelTiers: ['fast', 'mid', 'strong'],
    requiresExplicitModelName: false,
    controls: controls({
      interrupt: 'supported', kill: 'supported', steer: 'degraded',
    }),
    hookSupport: { preTool: false, postTool: false, transcriptStream: true, heartbeat: true },
    ceilingRationale:
      'Remote telemetry relayed through the hash-chained pd-relay stream is daemon-verifiable (T4) — required, '
      + 'since official C1 needs T4 (ADR-0095 fork 2). Binder ch07 milestone 2.5 requires production workers to be '
      + 'interruptible, budgeted, and retirable from pd-console — C4. Checkpoint/resume of a remote worker is target-only.',
  },
  ollama: {
    kind: 'ollama',
    displayName: 'Ollama (local model server)',
    launchModes: ['proxy', 'observed'],
    defaultLaunchMode: 'proxy',
    transcriptFidelityCeiling: 'T4',
    complianceCeiling: 'C2',
    modelTiers: ['local'],
    requiresExplicitModelName: true,
    controls: controls({ kill: 'supported' }),
    hookSupport: { preTool: false, postTool: false, transcriptStream: false, heartbeat: false },
    ceilingRationale:
      'A raw model server has no agent runtime. When proxied, the PD proxy IS the transcript source, so the stream '
      + 'is daemon-hashed and verifiable (T4 — required for official C1 per ADR-0095 fork 2), and governance is '
      + 'witnessable because every tool call must route through the proxy gateway (C2 Governed). No steer/pause '
      + 'channel exists inside a completion server, so C3+ is not mechanically witnessable. Without the proxy it is observed, C0.',
  },
  lmstudio: {
    kind: 'lmstudio',
    displayName: 'LM Studio (local model server)',
    launchModes: ['proxy', 'observed'],
    defaultLaunchMode: 'proxy',
    transcriptFidelityCeiling: 'T4',
    complianceCeiling: 'C2',
    modelTiers: ['local'],
    requiresExplicitModelName: true,
    controls: controls({ kill: 'supported' }),
    hookSupport: { preTool: false, postTool: false, transcriptStream: false, heartbeat: false },
    ceilingRationale:
      'Same mechanics as Ollama: raw completion server; the PD proxy is the daemon-hashed transcript source (T4), '
      + 'gateway governance ceiling C2.',
  },
  'custom-stdio': {
    kind: 'custom-stdio',
    displayName: 'Custom stdio agent',
    launchModes: ['native', 'hooked', 'proxy', 'observed', 'unmanaged'],
    defaultLaunchMode: 'native',
    transcriptFidelityCeiling: 'T5',
    complianceCeiling: 'C6',
    modelTiers: ['fast', 'mid', 'strong', 'local', 'custom'],
    requiresExplicitModelName: true,
    controls: controls({
      pause: 'supported', interrupt: 'supported', steer: 'supported',
      checkpoint: 'supported', resume: 'supported', fork: 'supported', kill: 'supported',
    }),
    hookSupport: { preTool: true, postTool: true, transcriptStream: true, heartbeat: true },
    ceilingRationale:
      'A local child process that fully implements the agent contract (ch03) can be witnessed to C6 — '
      + 'the ceiling is the contract itself. Every level must still be earned per probe; nothing is granted by kind.',
  },
  'custom-http': {
    kind: 'custom-http',
    displayName: 'Custom HTTP agent',
    launchModes: ['native', 'proxy', 'observed', 'unmanaged'],
    defaultLaunchMode: 'native',
    transcriptFidelityCeiling: 'T4',
    complianceCeiling: 'C5',
    modelTiers: ['fast', 'mid', 'strong', 'local', 'custom'],
    requiresExplicitModelName: true,
    controls: controls({
      pause: 'degraded', interrupt: 'supported', steer: 'supported',
      checkpoint: 'degraded', fork: 'degraded', kill: 'supported',
    }),
    hookSupport: { preTool: false, postTool: false, transcriptStream: true, heartbeat: true },
    ceilingRationale:
      'A remote HTTP agent can stream verified transcripts (T4) and cooperate (C5), but resumable C6 requires a '
      + 'checkpoint the daemon can restore into a successor body — not witnessable over a plain HTTP seam yet. '
      + 'Heartbeats are forgeable without the nonce challenge, which the forged-heartbeat probe exercises.',
  },
  'spawner-child': {
    kind: 'spawner-child',
    displayName: 'Fleet-spawned CLI child process',
    launchModes: ['native'],
    defaultLaunchMode: 'native',
    transcriptFidelityCeiling: 'T4',
    complianceCeiling: 'C1',
    modelTiers: ['fast', 'mid', 'strong', 'local', 'custom'],
    requiresExplicitModelName: false,
    controls: controls({
      // Mechanically real: the spawner holds the pid and can signal it
      // directly. Mechanical support is NOT a compliance grant — the C1
      // ceiling below is what actually blocks kill/pause/etc through the
      // gate until this adapter kind earns C2+ for real (see rationale).
      kill: 'supported',
    }),
    hookSupport: { preTool: false, postTool: false, transcriptStream: true, heartbeat: false },
    ceilingRationale:
      'lib/spawner.ts launches raw claude-code/codex/gemini CLI child processes directly — their tool calls run '
      + 'against native tool access, not routed through the Agent Harbor gateway, so C2 Governed is honestly '
      + 'unwitnessable today (routeToolThroughGateway must report false). The ceiling is C1 Transcripted because '
      + 'lib/transcripts.ts already gives every spawned agent a real, ordered message log that the Agent Harbor '
      + 'event ledger can hash-chain (lib/agent-harbor/spawner-bridge.ts) — that part is genuinely earned, not '
      + 'assumed. Raising this ceiling requires actually building gateway-routing for spawner-launched tool '
      + 'calls, not just relaxing this number.',
  },
};

export function getCapabilityProfile(kind: AdapterKind): AdapterCapabilityProfile {
  const profile = CAPABILITY_MATRIX[kind];
  if (!profile) throw new Error(`unknown adapter kind: ${kind}`);
  return profile;
}

export function isKnownAdapterKind(kind: string): kind is AdapterKind {
  return (ADAPTER_KINDS as readonly string[]).includes(kind);
}

/** Clamp a witnessed level to the adapter's mechanical ceiling. */
export function clampToCeiling(kind: AdapterKind, level: ComplianceLevel): ComplianceLevel {
  const ceiling = getCapabilityProfile(kind).complianceCeiling;
  return complianceOrder(level) > complianceOrder(ceiling) ? ceiling : level;
}
