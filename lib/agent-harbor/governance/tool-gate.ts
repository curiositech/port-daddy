/**
 * Pre-tool / post-tool governance gate — binder ch18 Work Order C5.
 *
 * The first REAL runtime gate: destructive git (and filesystem/network/shell/
 * github) actions are denied at the PRE-tool point — before any side effect —
 * or held for a human gate, with a durable denial receipt, visible transcript
 * events, and a concrete safe alternative. Consumes the frozen F0 v0 contracts
 * (ADR-0095): emits TranscriptEvents (governance kinds: tool_preflight,
 * tool_denied, approval_request), honors WorkIntent.constraints.destructiveActions,
 * folds denials into the WorkReceipt trust object, and respects the
 * ControlCommand principle that stale/unwitnessed state never authorizes.
 *
 * Fail-closed posture (grafted lenses):
 * - destructive-action-policy-matrix: block-tier denial = receipt + transcript
 *   event + safe alternative; sideEffectFree is proven by fixture, not asserted.
 * - sandboxed-adversarial-test-harness: there is no threat class where
 *   fail-open is correct; missing hook or forged compliance → deny, never hold.
 * - human-gate-designer: gate BEFORE irreversible actions; the payload shows
 *   computed blast radius and always offers approve/reject/modify.
 * - fleet-event-spawn-trust: unwitnessed provenance never earns a trusted tier;
 *   the ADR-0095 §8 witnessing verdict is an input here, and "invalid" means
 *   the body's gated actions are denied outright (a forged adapter has no
 *   governed channel a human approval could be delivered through).
 * - macos-host-security + agentic-zero-trust-security: same-UID bodies are
 *   governed, NEVER contained; containment claims are hardwired honest.
 *
 * The identical invariants are frozen language-neutrally in
 * schemas/agent-harbor/v0/governance/governance-invariants.mjs; the contract
 * test cross-checks this implementation against that module.
 */

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  classifyCommand,
  type ClassificationContext,
  type ClassifiedAction,
  type ActionCategory,
  type ActionTier,
} from './policy-matrix.js';

export type GateVerdict = 'allow' | 'deny' | 'require-approval' | 'rewrite';
export type EnvelopeDecision = 'proceeded' | 'denied' | 'held' | 'rewritten';
export type GateIntegrity = 'enforced' | 'missing-hook' | 'forged-compliance' | 'post-hoc-observation';

/** What the gate knows about the body attempting the action. */
export interface GateBody {
  bodyId?: string | null;
  /** True only when the daemon-installed pre-tool hook is verified present. */
  preToolHookInstalled?: boolean;
  /** False only when the body runs under a different OS user / sandbox. */
  sameUid?: boolean;
  /** True only for daemon-managed bodies with a WorkIntent + WorkPlan chain. */
  managed?: boolean;
}

export interface GateContext extends ClassificationContext {
  agentNodeId: string;
  sessionId: string;
  toolCallId: string;
  runId?: string | null;
  body: GateBody;
  /**
   * WorkIntent.constraints.destructiveActions (F0 work-intent.schema.json):
   * 'deny' denies every gated action outright; 'human-approval' and
   * 'policy-default' follow the matrix tiers (a block tier NEVER gets more
   * permissive via constraint).
   */
  destructiveActions?: 'deny' | 'human-approval' | 'policy-default';
  /**
   * The ADR-0095 §8 witnessing verdict for this body's compliance chain,
   * computed by compliance-invariants.mjs (checkNodeWitnessing). `false`
   * means forged/self-attested compliance: fail closed. `undefined` is
   * treated as unwitnessed for gated actions (fail closed), matching the
   * "stale projections never authorize" rule.
   */
  complianceWitnessValid?: boolean;
  /** Agent-supplied justification, shown to the human gate as claim not truth. */
  agentContext?: string;
  /** Injectables for deterministic tests. */
  now?: () => Date;
  newId?: () => string;
  nextSequence?: () => number;
}

export interface ToolGateEnvelope {
  schema: 'pd.agent-harbor.tool-gate-envelope.v0';
  envelopeId: string;
  phase: 'pre-tool' | 'post-tool';
  actionName: string;
  command: string | null;
  category: ActionCategory;
  tier: ActionTier;
  verdict: GateVerdict;
  decision: EnvelopeDecision;
  reason: string | null;
  gateIntegrity: GateIntegrity;
  agentNodeId: string;
  sessionId: string;
  bodyId: string | null;
  runId: string | null;
  toolCallId: string;
  idempotencyKey: string;
  transcriptEventIds: string[];
  denialReceiptId: string | null;
  humanGateId: string | null;
  occurredAt: string;
  [extra: string]: unknown;
}

export interface DenialReceipt {
  schema: 'pd.agent-harbor.denial-receipt.v0';
  kind: 'denial-receipt';
  receiptId: string;
  envelopeId: string;
  actionName: string;
  command: string | null;
  category: ActionCategory;
  tier: 'block' | 'approve';
  decision: 'denied' | 'held';
  reason: string;
  safeAlternative: string | null;
  sideEffectFree: boolean;
  transcriptEventId: string;
  agentNodeId: string;
  sessionId: string;
  bodyId: string | null;
  runId: string | null;
  toolCallId: string;
  occurredAt: string;
}

export interface BlastRadius {
  computedBy: string;
  preview: string[];
  truncated: boolean;
  summary: string;
}

export interface HumanGatePayload {
  schema: 'pd.agent-harbor.human-gate-payload.v0';
  gateId: string;
  envelopeId: string;
  actionName: string;
  command: string | null;
  category: ActionCategory;
  requestedBy: string;
  context: string;
  blastRadius: BlastRadius;
  options: ['approve', 'reject', 'modify'];
  costSoFarUsd: number | null;
  agentNodeId: string;
  sessionId: string;
  toolCallId: string;
  occurredAt: string;
  expiresAt: string | null;
}

/** Minimal governance-family TranscriptEvent (F0 transcript-event.schema.json). */
export interface GovernanceTranscriptEvent {
  eventId: string;
  sessionId: string;
  agentNodeId: string;
  bodyId: string | null;
  sequence: number;
  occurredAt: string;
  schemaVersion: 1;
  kind: 'tool_preflight' | 'tool_denied' | 'approval_request';
  visibility: 'operator';
  payloadJson: Record<string, unknown>;
}

export interface GateResult {
  verdict: GateVerdict;
  envelope: ToolGateEnvelope;
  denialReceipt: DenialReceipt | null;
  humanGatePayload: HumanGatePayload | null;
  transcriptEvents: GovernanceTranscriptEvent[];
  /** Honest containment posture for the body that attempted the action. */
  containmentClaim: ContainmentClaim;
}

export interface ContainmentClaim {
  contained: false;
  sameUidBodyMarkedContained: false;
  reason: string;
}

const BLAST_PREVIEW_LIMIT = 20;

/**
 * Containment honesty (macos-host-security cardinal rule): a same-UID or
 * unmanaged body is governed by this gate — it is NEVER contained. In v0
 * every body is same-UID, so this is hardwired rather than parameterized;
 * a future isolated-body claim must come from sandboxed-adversarial-test-harness
 * evidence, not from this policy layer.
 */
export function buildContainmentClaim(body: GateBody): ContainmentClaim {
  const why = body.sameUid === false
    ? 'body reports a separate UID, but no adversarial containment harness has proven the boundary — governed, not contained (fail closed)'
    : body.managed === true
      ? 'daemon-managed same-UID body: policy gating is detection and evidence, not a wall'
      : 'unmanaged same-UID body: it can disable, unset, kill, or read around any same-UID watcher';
  return { contained: false, sameUidBodyMarkedContained: false, reason: why };
}

function isoNow(ctx: GateContext): string {
  return (ctx.now ? ctx.now() : new Date()).toISOString();
}

function makeIds(ctx: GateContext): () => string {
  return ctx.newId ?? (() => randomUUID());
}

function makeSeq(ctx: GateContext): () => number {
  if (ctx.nextSequence) return ctx.nextSequence;
  let seq = 0;
  return () => { seq += 1; return seq; };
}

/**
 * Compute blast radius from the ACTUAL target — read-only probes, never the
 * agent's self-report. Failure to compute is reported as worst case, not
 * silently empty-and-safe.
 */
export function computeBlastRadius(action: ClassifiedAction, ctx: GateContext): BlastRadius {
  try {
    if (action.category === 'git' && ctx.workspaceRoot) {
      const out = execFileSync('git', ['status', '--porcelain'], {
        cwd: ctx.workspaceRoot, encoding: 'utf8', timeout: 5000,
      });
      const lines = out.split('\n').filter((l) => l.trim().length > 0);
      return {
        computedBy: 'git status --porcelain',
        preview: lines.slice(0, BLAST_PREVIEW_LIMIT),
        truncated: lines.length > BLAST_PREVIEW_LIMIT,
        summary: `${lines.length} dirty/untracked path(s) at risk in ${ctx.workspaceRoot}`,
      };
    }
    if (action.category === 'filesystem') {
      const raw = action.matchedSegment.split(/\s+/).filter((t) => !t.startsWith('-')).slice(1).pop();
      // Relative targets are relative to the agent's jail root, never this
      // process's cwd — same base the classifier used.
      const target = raw && !isAbsolute(raw) && ctx.workspaceRoot
        ? resolve(ctx.workspaceRoot, raw)
        : raw;
      if (target && existsSync(target)) {
        const entries = readdirSync(target).slice(0, BLAST_PREVIEW_LIMIT);
        return {
          computedBy: `readdir ${target}`,
          preview: entries,
          truncated: entries.length === BLAST_PREVIEW_LIMIT,
          summary: `${entries.length}+ entr(ies) under ${target} would be affected`,
        };
      }
    }
  } catch {
    // fall through to worst-case below
  }
  return {
    computedBy: 'none — probe unavailable',
    preview: [],
    truncated: false,
    summary: 'blast radius could not be computed; treat as worst case for this category',
  };
}

interface Decision {
  verdict: GateVerdict;
  decision: EnvelopeDecision;
  reason: string;
  integrity: GateIntegrity;
}

function decide(action: ClassifiedAction | null, ctx: GateContext): Decision {
  if (!action) {
    return {
      verdict: 'allow',
      decision: 'proceeded',
      reason: 'no matrix row matched — ordinary command (recorded, not governed)',
      integrity: 'enforced',
    };
  }
  // Fail-closed integrity checks come BEFORE any tier leniency.
  if (ctx.body.preToolHookInstalled !== true) {
    return {
      verdict: 'deny',
      decision: 'denied',
      reason: `pre-tool hook is not installed or not verified for body ${ctx.body.bodyId ?? '(unknown)'} — the gate cannot guarantee enforcement before side effects, so the gated action is denied (fail closed)`,
      integrity: 'missing-hook',
    };
  }
  if (ctx.complianceWitnessValid !== true) {
    return {
      verdict: 'deny',
      decision: 'denied',
      reason: ctx.complianceWitnessValid === false
        ? 'compliance chain failed the ADR-0095 §8 witnessing invariant (forged/self-attested adapter) — an unwitnessed body has no governed channel for approval, so the gated action is denied (fail closed)'
        : 'compliance witnessing verdict unavailable — stale or unwitnessed state never authorizes a gated action (fail closed)',
      integrity: 'forged-compliance',
    };
  }
  // WorkIntent constraint: 'deny' escalates every gated action to denial.
  if (ctx.destructiveActions === 'deny') {
    return {
      verdict: 'deny',
      decision: 'denied',
      reason: `WorkIntent constraints.destructiveActions is "deny" — ${action.actionName} refused: ${action.reason}`,
      integrity: 'enforced',
    };
  }
  if (action.tier === 'block') {
    return {
      verdict: 'deny',
      decision: 'denied',
      reason: `${action.actionName} is block-tier: ${action.reason}`,
      integrity: 'enforced',
    };
  }
  return {
    verdict: 'require-approval',
    decision: 'held',
    reason: `${action.actionName} is approve-tier: ${action.reason}`,
    integrity: 'enforced',
  };
}

/**
 * The pre-tool gate. Call BEFORE executing any agent-proposed command; the
 * caller must only execute the command when `verdict === 'allow'`.
 *
 * Never throws on a governed action — a denial is a result, not an exception —
 * and never executes any part of the proposed command (classification is
 * pure argv analysis; blast-radius probes are read-only).
 */
export function preToolGate(command: string, ctx: GateContext): GateResult {
  const ids = makeIds(ctx);
  const seq = makeSeq(ctx);
  const at = isoNow(ctx);
  const action = classifyCommand(command, ctx);
  const d = decide(action, ctx);

  const envelopeId = ids();
  const bodyId = ctx.body.bodyId ?? null;
  const events: GovernanceTranscriptEvent[] = [];
  const baseEvent = {
    sessionId: ctx.sessionId,
    agentNodeId: ctx.agentNodeId,
    bodyId,
    occurredAt: at,
    schemaVersion: 1 as const,
    visibility: 'operator' as const,
  };

  const preflightEvent: GovernanceTranscriptEvent = {
    ...baseEvent,
    eventId: ids(),
    sequence: seq(),
    kind: 'tool_preflight',
    payloadJson: {
      envelopeId,
      command,
      actionName: action?.actionName ?? null,
      category: action?.category ?? null,
      tier: action?.tier ?? 'allow',
      verdict: d.verdict,
      reason: d.reason,
      gateIntegrity: d.integrity,
    },
  };
  events.push(preflightEvent);

  let denialReceipt: DenialReceipt | null = null;
  let humanGatePayload: HumanGatePayload | null = null;

  if (d.decision === 'denied' && action) {
    const deniedEvent: GovernanceTranscriptEvent = {
      ...baseEvent,
      eventId: ids(),
      sequence: seq(),
      kind: 'tool_denied',
      payloadJson: {
        envelopeId,
        command,
        actionName: action.actionName,
        category: action.category,
        tier: action.tier,
        reason: d.reason,
        safeAlternative: action.safeAlternative ?? null,
      },
    };
    events.push(deniedEvent);
    denialReceipt = {
      schema: 'pd.agent-harbor.denial-receipt.v0',
      kind: 'denial-receipt',
      receiptId: ids(),
      envelopeId,
      actionName: action.actionName,
      command,
      category: action.category,
      tier: action.tier,
      decision: 'denied',
      reason: d.reason,
      // Block tier always carries the matrix's concrete alternative; an
      // approve-tier action denied by fail-closed integrity still offers the
      // matrix alternative when one exists.
      safeAlternative: action.safeAlternative ?? (action.tier === 'approve'
        ? 'wait for a governed body (hook installed, witnessed compliance) and re-request approval'
        : null),
      // Fixture-earned, never asserted: true only when this row's negative
      // fixture proved zero side effects on deny AND the gate's enforcement
      // integrity is intact. A missing-hook / forged-compliance denial cannot
      // guarantee the body honored it, so it must not claim side-effect-freedom.
      sideEffectFree: d.integrity === 'enforced' && action.fixtureProven,
      transcriptEventId: deniedEvent.eventId,
      agentNodeId: ctx.agentNodeId,
      sessionId: ctx.sessionId,
      bodyId,
      runId: ctx.runId ?? null,
      toolCallId: ctx.toolCallId,
      occurredAt: at,
    };
  }

  if (d.decision === 'held' && action) {
    const approvalEvent: GovernanceTranscriptEvent = {
      ...baseEvent,
      eventId: ids(),
      sequence: seq(),
      kind: 'approval_request',
      payloadJson: {
        envelopeId,
        command,
        actionName: action.actionName,
        category: action.category,
        tier: action.tier,
        reason: d.reason,
      },
    };
    events.push(approvalEvent);
    humanGatePayload = {
      schema: 'pd.agent-harbor.human-gate-payload.v0',
      gateId: ids(),
      envelopeId,
      actionName: action.actionName,
      command,
      category: action.category,
      requestedBy: `${ctx.agentNodeId}/${ctx.sessionId}`,
      context: ctx.agentContext ?? '(agent supplied no justification)',
      blastRadius: computeBlastRadius(action, ctx),
      options: ['approve', 'reject', 'modify'],
      costSoFarUsd: null,
      agentNodeId: ctx.agentNodeId,
      sessionId: ctx.sessionId,
      toolCallId: ctx.toolCallId,
      occurredAt: at,
      expiresAt: null,
    };
  }

  const envelope: ToolGateEnvelope = {
    schema: 'pd.agent-harbor.tool-gate-envelope.v0',
    envelopeId,
    phase: 'pre-tool',
    actionName: action?.actionName ?? 'unmatched command',
    command,
    category: action?.category ?? 'shell',
    tier: action?.tier ?? 'allow',
    verdict: d.verdict,
    decision: d.decision,
    reason: d.reason,
    gateIntegrity: d.integrity,
    agentNodeId: ctx.agentNodeId,
    sessionId: ctx.sessionId,
    bodyId,
    runId: ctx.runId ?? null,
    toolCallId: ctx.toolCallId,
    idempotencyKey: `${ctx.sessionId}:${ctx.toolCallId}:pre-tool`,
    transcriptEventIds: events.map((e) => e.eventId),
    denialReceiptId: denialReceipt?.receiptId ?? null,
    humanGateId: humanGatePayload?.gateId ?? null,
    occurredAt: at,
  };

  return {
    verdict: d.verdict,
    envelope,
    denialReceipt,
    humanGatePayload,
    transcriptEvents: events,
    containmentClaim: buildContainmentClaim(ctx.body),
  };
}

/**
 * The post-tool envelope: tool-result persistence for actions that actually
 * ran. If a BLOCK-tier action shows up here as executed, the pre-tool hook
 * was missing or bypassed — that is recorded as a post-hoc observation with
 * its own tool_denied transcript event and a denial receipt whose
 * sideEffectFree is honestly FALSE (the side effects already happened),
 * never laundered into a clean "proceeded" or hidden in an event-less
 * envelope the silent-denial invariant would reject.
 */
export function postToolGate(
  command: string,
  outcome: { executed: boolean; exitCode: number | null },
  ctx: GateContext,
): {
  envelope: ToolGateEnvelope;
  violation: string | null;
  denialReceipt: DenialReceipt | null;
  transcriptEvents: GovernanceTranscriptEvent[];
} {
  const ids = makeIds(ctx);
  const seq = makeSeq(ctx);
  const at = isoNow(ctx);
  const action = classifyCommand(command, ctx);
  const blockObservedRan = action?.tier === 'block' && outcome.executed;
  const envelopeId = ids();
  const bodyId = ctx.body.bodyId ?? null;

  const events: GovernanceTranscriptEvent[] = [];
  let denialReceipt: DenialReceipt | null = null;
  if (blockObservedRan && action) {
    const reason = `${action.actionName} is block-tier but was observed post-tool with side effects — pre-tool hook missing or bypassed`;
    const deniedEvent: GovernanceTranscriptEvent = {
      sessionId: ctx.sessionId,
      agentNodeId: ctx.agentNodeId,
      bodyId,
      occurredAt: at,
      schemaVersion: 1,
      visibility: 'operator',
      eventId: ids(),
      sequence: seq(),
      kind: 'tool_denied',
      payloadJson: {
        envelopeId,
        command,
        actionName: action.actionName,
        category: action.category,
        tier: action.tier,
        reason,
        gateIntegrity: 'post-hoc-observation',
        exitCode: outcome.exitCode,
      },
    };
    events.push(deniedEvent);
    denialReceipt = {
      schema: 'pd.agent-harbor.denial-receipt.v0',
      kind: 'denial-receipt',
      receiptId: ids(),
      envelopeId,
      actionName: action.actionName,
      command,
      category: action.category,
      tier: action.tier,
      decision: 'denied',
      reason,
      safeAlternative: action.safeAlternative ?? null,
      sideEffectFree: false, // the action RAN — never claim otherwise
      transcriptEventId: deniedEvent.eventId,
      agentNodeId: ctx.agentNodeId,
      sessionId: ctx.sessionId,
      bodyId,
      runId: ctx.runId ?? null,
      toolCallId: ctx.toolCallId,
      occurredAt: at,
    };
  }

  const envelope: ToolGateEnvelope = {
    schema: 'pd.agent-harbor.tool-gate-envelope.v0',
    envelopeId,
    phase: 'post-tool',
    actionName: action?.actionName ?? 'unmatched command',
    command,
    category: action?.category ?? 'shell',
    tier: action?.tier ?? 'allow',
    verdict: blockObservedRan ? 'deny' : 'allow',
    decision: blockObservedRan ? 'denied' : 'proceeded',
    reason: blockObservedRan
      ? `${action?.actionName} is block-tier but was observed post-tool with side effects — pre-tool hook missing or bypassed`
      : null,
    gateIntegrity: blockObservedRan ? 'post-hoc-observation' : 'enforced',
    agentNodeId: ctx.agentNodeId,
    sessionId: ctx.sessionId,
    bodyId,
    runId: ctx.runId ?? null,
    toolCallId: ctx.toolCallId,
    idempotencyKey: `${ctx.sessionId}:${ctx.toolCallId}:post-tool`,
    transcriptEventIds: events.map((e) => e.eventId),
    denialReceiptId: denialReceipt?.receiptId ?? null,
    humanGateId: null,
    occurredAt: at,
    exitCode: outcome.exitCode,
  };
  return {
    envelope,
    violation: blockObservedRan
      ? `block-tier action "${action?.actionName}" executed without a pre-tool gate — governance integrity violation (missing hook)`
      : null,
    denialReceipt,
    transcriptEvents: events,
  };
}

/**
 * Fold gate denials into a WorkReceipt (F0 work-receipt.schema.json) so the
 * denial is visible in the trust object, not only in the transcript:
 * each denial becomes a high-severity risk plus a governance section entry.
 * Pure: returns a new receipt object; never mutates the input.
 */
export function foldDenialsIntoReceipt<T extends {
  risks: Array<{ severity: string; summary: string; checkFirst?: boolean }>;
}>(receipt: T, denials: DenialReceipt[]): T & {
  governance: { denials: DenialReceipt[]; containment: ContainmentClaim };
} {
  const risks = [
    ...receipt.risks,
    ...denials.map((d) => ({
      severity: 'high',
      summary: `Gate denial: ${d.actionName} (${d.category}/${d.tier}) — ${d.reason}${d.safeAlternative ? ` Safe alternative: ${d.safeAlternative}` : ''}`,
    })),
  ];
  return {
    ...receipt,
    risks,
    governance: {
      denials: denials.map((d) => ({ ...d })),
      containment: buildContainmentClaim({}),
    },
  };
}
