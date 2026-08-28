/**
 * Interactive Squid context-pressure bridge.
 *
 * This module deliberately owns policy and adapter honesty, not storage: the
 * append-only ContextEnvelope / CompactionPacket machinery remains in Agent
 * Harbor, while W8/W12 remains the owner of any BufferedOutputRef storage.
 * A provider may report native usage through an adapter report; the daemon
 * always conservatively takes max(provider, daemon) in the coordinator.
 */

import type { DatabaseInstance } from '../sqlite-runtime.js';
import type { EpisodicMemory } from '../episodic-memory.js';
import type { GitleaksRunner } from '../handoff-capsule.js';
import {
  createContextContinuityCoordinator,
  ToolPairCoverageError,
  ToolPairIntegrityError,
  type ContextContinuityResult,
  type ContextPlanCheckpoint,
  type ToolPairCoverage,
} from '../agent-harbor/context-continuity.js';

export const INTERACTIVE_CONTEXT_PROVIDERS = ['claude', 'codex', 'gemini', 'agy'] as const;
export type InteractiveContextProvider = (typeof INTERACTIVE_CONTEXT_PROVIDERS)[number];

export interface InteractiveContextCapability {
  provider: InteractiveContextProvider;
  /** A registered hook is not evidence that the hook event carries usage. */
  preCompact: 'supported' | 'unsupported';
  providerNativeUsage: 'accepted-when-reported' | 'not-carried-by-precompact-event';
  /** Lifecycle support alone cannot prove a complete tool invocation/result stream. */
  toolPairCoverage: 'daemon-witness-required' | 'not-supported';
  /** A packet is withheld, never guessed, when that witness is absent. */
  packetIssuance: 'withheld-until-daemon-coverage' | 'not-supported';
  continuation: 'verified-packet-only';
  reason: string;
}

/**
 * ADR-0091's support matrix is intentionally narrow. Claude Code has the
 * verified PreCompact lifecycle event; the other installed adapters have no
 * equivalent witness in this slice and must never receive a simulated hook.
 */
export const INTERACTIVE_CONTEXT_CAPABILITIES: Record<InteractiveContextProvider, InteractiveContextCapability> = {
  claude: {
    provider: 'claude',
    preCompact: 'supported',
    providerNativeUsage: 'not-carried-by-precompact-event',
    toolPairCoverage: 'daemon-witness-required',
    packetIssuance: 'withheld-until-daemon-coverage',
    continuation: 'verified-packet-only',
    reason: 'Claude Code PreCompact is a verified lifecycle hook. Its hook payload does not itself carry token usage, so usage is accepted only from a separately witnessed adapter report.',
  },
  codex: {
    provider: 'codex',
    preCompact: 'unsupported',
    providerNativeUsage: 'not-carried-by-precompact-event',
    toolPairCoverage: 'not-supported',
    packetIssuance: 'not-supported',
    continuation: 'verified-packet-only',
    reason: 'No Codex PreCompact witness is registered by this adapter contract; packet handoff remains available only through a verified daemon continuation.',
  },
  gemini: {
    provider: 'gemini',
    preCompact: 'unsupported',
    providerNativeUsage: 'not-carried-by-precompact-event',
    toolPairCoverage: 'not-supported',
    packetIssuance: 'not-supported',
    continuation: 'verified-packet-only',
    reason: 'No Gemini PreCompact witness is registered by this adapter contract; do not synthesize one from BeforeAgent or AfterAgent.',
  },
  agy: {
    provider: 'agy',
    preCompact: 'unsupported',
    providerNativeUsage: 'not-carried-by-precompact-event',
    toolPairCoverage: 'not-supported',
    packetIssuance: 'not-supported',
    continuation: 'verified-packet-only',
    reason: 'Antigravity hook observations are not a verified PreCompact contract and remain observe-only for compaction.',
  },
};

export interface ProviderNativeUsage {
  /**
   * Native provider usage is an internal daemon-to-coordinator witness, never
   * an assertion accepted from a hook's JSON body. The tag makes accidental
   * promotion of an untrusted loopback payload fail closed.
   */
  witness: 'daemon-adapter';
  usedTokensEstimate: number;
  /** An adapter may report a more precise active window than the harness default. */
  windowTokens?: number | null;
  measuredAt?: string | null;
}

export interface InteractiveContextPressureInput {
  provider: InteractiveContextProvider;
  /**
   * `turn` is a Claude-only UserPromptSubmit refresh. It is the context-
   * admitting producer for the .60/.75/.85/.92 ladder; PreCompact remains a
   * truthful compaction checkpoint, not the only time pressure is observed.
   */
  hookTrigger: 'manual' | 'auto' | 'turn';
  /** Retry-stable vendor delivery identity; never derive it from raw transcript. */
  observationId: string;
  agentNodeId: string;
  sessionId: string;
  runId?: string | null;
  transcriptId: string;
  model: string;
  windowTokens?: number | null;
  daemonUsedTokensEstimate?: number | null;
  providerNativeUsage?: ProviderNativeUsage | null;
  planCheckpoint?: {
    sessionId?: string | null;
    content?: string | null;
    capturedAt?: string | null;
  } | null;
  project?: string | null;
  projectDir?: string | null;
  workdir?: string | null;
  worktreeId?: string | null;
  branch?: string | null;
  measuredAt?: string;
  /** Daemon-owned adapter coverage; never accepted from hook JSON. */
  toolPairCoverage?: ToolPairCoverage | null;
  /** Keep lifecycle hook work bounded; resume/takeover verifies later. */
  deferHandoffProjection?: boolean;
}

/** Dependencies kept at the packet projection boundary, not in hook storage. */
export interface InteractiveContextPressureDeps {
  episodicMemory?: Pick<EpisodicMemory, 'remember'>;
  gitleaksRunner?: GitleaksRunner;
  logger?: {
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface InteractivePreCompactDirective {
  decision: 'allow' | 'block';
  plan: 'not-required' | 'prepare' | 'checkpoint-required' | 'checkpointed';
  riskyWork: 'allowed' | 'restricted';
  /** `packet-withheld` is deliberately not actionable continuation authority. */
  continuation: 'normal' | 'packet-ready' | 'packet-withheld' | 'governed-successor';
  reason: string | null;
}

export type InteractiveContextPressureResult =
  | {
      status: 'unsupported';
      capability: InteractiveContextCapability;
      directive: InteractivePreCompactDirective;
      continuity: null;
      error: null;
    }
  | {
      status: 'measurement-unavailable';
      capability: InteractiveContextCapability;
      directive: InteractivePreCompactDirective;
      continuity: null;
      error: null;
    }
  | {
      status: 'recorded';
      capability: InteractiveContextCapability;
      directive: InteractivePreCompactDirective;
      continuity: ContextContinuityResult;
      error: null;
    }
  | {
      status: 'rejected';
      capability: InteractiveContextCapability;
      directive: InteractivePreCompactDirective;
      continuity: null;
      error: {
        code: 'TOOL_PAIR_COVERAGE_UNAVAILABLE' | 'TOOL_PAIR_INTEGRITY' | 'COMPACTION_VALIDATION';
        message: string;
      };
    };

function finitePositive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function unmeasuredDirective(capability: InteractiveContextCapability): InteractivePreCompactDirective {
  return {
    decision: 'allow',
    plan: 'not-required',
    riskyWork: 'allowed',
    continuation: 'normal',
    reason: capability.preCompact === 'supported'
      ? 'Context measurement or a retry-stable observation id is unavailable: the hook must not invent provider token usage or a delivery receipt.'
      : capability.reason,
  };
}

function directiveFor(
  result: ContextContinuityResult,
  trigger: InteractiveContextPressureInput['hookTrigger'],
): InteractivePreCompactDirective {
  const { assessment, governance } = result;
  const plan = governance.planCheckpointPresent
    ? 'checkpointed'
    : assessment.action === 'none'
      ? 'not-required'
      : assessment.action === 'prepare_compaction'
        ? 'prepare'
        : 'checkpoint-required';
  const riskyWork = governance.riskyWorkRestricted ? 'restricted' : 'allowed';
  // A pressure band may require compaction without having enough authority to
  // mint the packet (for example, there is no current durable plan). Do not
  // label that state `packet-ready`: the only safe instruction is to repair
  // the missing evidence and retain the live session.
  const packetWithheld = assessment.compactionNeeded && result.packet === null;
  const continuation = packetWithheld
    ? 'packet-withheld'
    : assessment.successorRequired
      ? 'governed-successor'
      : assessment.compactionNeeded
        ? 'packet-ready'
        : 'normal';

  // Claude's own documentation warns that blocking an automatic compaction at
  // a context-limit recovery can surface the underlying failure. We therefore
  // block a *manual* compaction only when a required pd-plan checkpoint is
  // absent; automatic compaction is allowed but remains visibly restricted.
  const blockForPlan = trigger === 'manual'
    && assessment.compactionNeeded
    && !governance.planCheckpointPresent;
  return {
    decision: blockForPlan ? 'block' : 'allow',
    plan,
    riskyWork,
    continuation,
    reason: blockForPlan || (assessment.compactionNeeded && !governance.planCheckpointPresent)
      ? 'Checkpoint the current plan with `pd plan` before compacting. Port Daddy will resume from that plan plus the cited packet, never a transcript dump.'
      : governance.riskyWorkRestricted
        ? 'Context pressure is high: do not begin broad or risky work. Preserve the plan checkpoint and cited packet first.'
        : assessment.action === 'build_compaction_packet'
          ? 'Context pressure has reached the cited-packet threshold. Keep the current `pd plan` checkpoint and continue only from the verified packet boundary.'
        : assessment.action === 'prepare_compaction'
          ? 'Prepare and checkpoint `pd plan`; pressure has crossed the compaction preparation threshold.'
          : null,
  };
}

/**
 * Records a verified interactive observation. This is the only place an
 * interactive adapter enters ContextEnvelope / CompactionPacket machinery;
 * it does not create a second transcript or blob store.
 */
export function recordInteractiveContextPressure(
  db: DatabaseInstance,
  input: InteractiveContextPressureInput,
  deps: InteractiveContextPressureDeps = {},
): InteractiveContextPressureResult {
  const capability = INTERACTIVE_CONTEXT_CAPABILITIES[input.provider];
  if (capability.preCompact !== 'supported') {
    return { status: 'unsupported', capability, directive: unmeasuredDirective(capability), continuity: null, error: null };
  }

  // This public TypeScript seam is used by daemon-resident adapter witnesses.
  // A loopback HTTP caller cannot turn an arbitrary number into an exact
  // provider report merely by naming the field.
  const native = input.providerNativeUsage?.witness === 'daemon-adapter'
    ? input.providerNativeUsage
    : null;
  const windowTokens = finitePositive(native?.windowTokens) ?? finitePositive(input.windowTokens);
  const daemonEstimate = finiteNonNegative(input.daemonUsedTokensEstimate);
  const adapterEstimate = finiteNonNegative(native?.usedTokensEstimate);
  if (windowTokens === null || (daemonEstimate === null && adapterEstimate === null)) {
    return { status: 'measurement-unavailable', capability, directive: unmeasuredDirective(capability), continuity: null, error: null };
  }

  try {
    const continuity = createContextContinuityCoordinator(db, deps).record({
      agentNodeId: input.agentNodeId,
      sessionId: input.sessionId,
      runId: input.runId ?? input.transcriptId,
      transcriptId: input.transcriptId,
      sourceAdapter: `interactive:${input.provider}`,
      model: input.model,
      windowTokens,
      daemonUsedTokensEstimate: daemonEstimate ?? 0,
      adapterUsedTokensEstimate: adapterEstimate ?? 0,
      estimateMode: native ? 'exact' : 'estimated',
      project: input.project ?? null,
      projectDir: input.projectDir ?? input.workdir ?? null,
      workdir: input.workdir ?? null,
      worktreeId: input.worktreeId ?? null,
      branch: input.branch ?? null,
      measuredAt: input.measuredAt ?? native?.measuredAt ?? undefined,
      observationId: input.observationId,
      planCheckpoint: input.planCheckpoint ?? null,
      requireCompleteToolPairs: true,
      toolPairCoverage: input.toolPairCoverage ?? null,
      deferHandoffProjection: input.deferHandoffProjection === true,
    });
    return { status: 'recorded', capability, directive: directiveFor(continuity, input.hookTrigger), continuity, error: null };
  } catch (error) {
    if (error instanceof ToolPairCoverageError) {
      return {
        status: 'rejected',
        capability,
        directive: {
          decision: input.hookTrigger === 'manual' ? 'block' : 'allow',
          plan: 'checkpoint-required',
          riskyWork: 'restricted',
          continuation: 'packet-withheld',
          reason: 'Compaction packet withheld until a daemon-owned tool-pair coverage witness proves no invocation/result can be split.',
        },
        continuity: null,
        error: { code: 'TOOL_PAIR_COVERAGE_UNAVAILABLE', message: error.message },
      };
    }
    if (error instanceof ToolPairIntegrityError) {
      return {
        status: 'rejected',
        capability,
        directive: {
          decision: input.hookTrigger === 'manual' ? 'block' : 'allow',
          plan: 'checkpoint-required',
          riskyWork: 'restricted',
          continuation: 'packet-withheld',
          reason: 'Compaction packet withheld because a tool invocation/result pair is incomplete or malformed.',
        },
        continuity: null,
        error: { code: 'TOOL_PAIR_INTEGRITY', message: error.message },
      };
    }
    return {
      status: 'rejected',
      capability,
      directive: {
        decision: input.hookTrigger === 'manual' ? 'block' : 'allow',
        plan: 'checkpoint-required',
        riskyWork: 'restricted',
        continuation: 'packet-withheld',
        reason: 'Compaction packet validation failed; retain the live session and repair the cited evidence before continuing.',
      },
      continuity: null,
      error: {
        code: 'COMPACTION_VALIDATION',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** Exported for route fixtures without exposing a storage implementation. */
export type { ContextPlanCheckpoint };
