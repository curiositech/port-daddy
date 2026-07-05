/**
 * Agent Harbor C2 — compliance-gated control authorization.
 *
 * The ch18 C2 acceptance gate this module enforces: OBSERVED AGENTS CANNOT
 * RECEIVE C2+ CONTROLS. Each ControlCommand kind is a separate capability
 * promise (control-command.schema.json) gated by the compliance level the
 * daemon actually witnessed — never by a self-asserted level, and never by a
 * stale projection ("Stale projections must never authorize a command").
 *
 * Skill lenses: articles-of-agreement-auditor (every gate defines a concrete
 * denial shape — here, a schema-valid ControlCommand with status `unsupported`
 * or `failed` plus denialReason, not a silent no-op) and
 * agent-compliance-conformance (the observed-to-controlled negative probe is
 * exactly an attempt to sneak a control past this gate).
 */

import { randomUUID } from 'node:crypto';
import type {
  AdapterKind,
  AgentNodeView,
  ComplianceLevel,
  ComplianceProbeResult,
  ControlCommand,
  ControlKind,
} from './types.js';
import { complianceOrder } from './types.js';
import { getCapabilityProfile } from './capability-matrix.js';
// The normative witnessing predicate — frozen contract artifact (ADR-0095 §8).
// eslint-disable-next-line import/extensions
import { checkNodeWitnessing } from '../../schemas/agent-harbor/v0/compliance-invariants.mjs';

/**
 * Minimum witnessed compliance level per control kind, per the frozen ladder
 * (ADR-0095 fork resolution 2): C2 Governed, C3 Suggestible (accepts steer),
 * C4 Controllable (pause/interrupt/kill), C5 Cooperative (checkpoint/fork),
 * C6 Resumable (resume). `retire` is a daemon registry operation on the node
 * record itself — it needs no body cooperation, so C0 suffices.
 */
export const CONTROL_MIN_LEVEL: Record<ControlKind, ComplianceLevel> = {
  retire: 'C0',
  steer: 'C3',
  pause: 'C4',
  interrupt: 'C4',
  kill: 'C4',
  checkpoint: 'C5',
  fork: 'C5',
  resume: 'C6',
};

export interface ControlAuthorization {
  allowed: boolean;
  kind: ControlKind;
  requiredLevel: ComplianceLevel;
  /** The level the gate actually trusted (witness-backed, never self-report). */
  effectiveLevel: ComplianceLevel;
  /** Set when denied. */
  denialReason?: string;
  /** Honest status for the denial shape: unsupported (capability) vs failed (evidence). */
  denialStatus?: 'unsupported' | 'failed';
}

function isObserved(node: AgentNodeView): boolean {
  return (
    node.authority === 'observed'
    || node.officialMode === 'observed'
    || node.officialMode === 'unmanaged'
    || node.officialMode === 'run-log'
  );
}

/**
 * Compute the level this gate may trust for `node`. Fail-closed:
 * - a node claiming > C0 with no witnessing probe supplied is treated as C0
 *   (self-report is not evidence — ADR-0095 §8 node linkage);
 * - a supplied probe that fails the witnessing invariant grants nothing above C0;
 * - otherwise the trusted level is min(node claim, probe witnessedLevel).
 */
export function effectiveComplianceLevel(
  node: AgentNodeView,
  witness?: ComplianceProbeResult | null,
): ComplianceLevel {
  const claimed = node.complianceLevel;
  if (complianceOrder(claimed) <= 0) return 'C0';
  if (!witness) return 'C0';
  const { valid } = checkNodeWitnessing(node, witness);
  if (!valid) return 'C0';
  const witnessed = witness.witnessedLevel;
  return complianceOrder(claimed) <= complianceOrder(witnessed) ? claimed : witnessed;
}

/**
 * Authorize a control kind against a node. `witness` is the node's linked
 * ComplianceProbeResult fetched from daemon truth at decision time — passing a
 * cached/stale projection defeats the gate, so callers must fetch fresh.
 */
export function authorizeControl(
  node: AgentNodeView,
  kind: ControlKind,
  witness?: ComplianceProbeResult | null,
  adapterKind?: AdapterKind,
): ControlAuthorization {
  const requiredLevel = CONTROL_MIN_LEVEL[kind];
  if (!requiredLevel) {
    return {
      allowed: false, kind, requiredLevel: 'C6', effectiveLevel: 'C0',
      denialStatus: 'unsupported', denialReason: `unknown control kind "${kind}" — fail closed`,
    };
  }
  const effectiveLevel = effectiveComplianceLevel(node, witness);
  const needsGovernance = complianceOrder(requiredLevel) >= complianceOrder('C2');

  // ch18 C2 gate: observed agents cannot receive C2+ controls, regardless of
  // any level their record carries. Observation is not control.
  if (needsGovernance && isObserved(node)) {
    return {
      allowed: false, kind, requiredLevel, effectiveLevel,
      denialStatus: 'unsupported',
      denialReason: `observed agents cannot receive C2+ controls (kind "${kind}" requires ${requiredLevel}; `
        + 'binder ch18 C2 acceptance gate). Attach an official body through the Work Intent path to gain control.',
    };
  }

  // Mechanical capability of the body kind (capability matrix): unsupported is
  // an honest terminal status (control-command.schema.json), not a silent no-op.
  if (adapterKind) {
    const support = getCapabilityProfile(adapterKind).controls[kind];
    if (support === 'unsupported') {
      return {
        allowed: false, kind, requiredLevel, effectiveLevel,
        denialStatus: 'unsupported',
        denialReason: `adapter ${adapterKind} does not mechanically support "${kind}" (capability matrix)`,
      };
    }
  }

  if (complianceOrder(effectiveLevel) < complianceOrder(requiredLevel)) {
    const selfAttested = complianceOrder(node.complianceLevel) > complianceOrder(effectiveLevel);
    return {
      allowed: false, kind, requiredLevel, effectiveLevel,
      denialStatus: 'failed',
      denialReason: selfAttested
        ? `node claims ${node.complianceLevel} but only ${effectiveLevel} is daemon-witnessed — `
          + `self-report never authorizes (ADR-0095 §8); "${kind}" requires ${requiredLevel}`
        : `witnessed level ${effectiveLevel} is below the ${requiredLevel} required for "${kind}"`,
    };
  }

  return { allowed: true, kind, requiredLevel, effectiveLevel };
}

/**
 * Gate a queued ControlCommand: returns the command updated to its honest
 * status. Allowed commands stay `queued` for delivery; denied commands become
 * the concrete denial shape (`unsupported`/`failed` + denialReason).
 */
export function applyControlGate(
  command: ControlCommand,
  node: AgentNodeView,
  witness?: ComplianceProbeResult | null,
  adapterKind?: AdapterKind,
): ControlCommand {
  const auth = authorizeControl(node, command.kind, witness, adapterKind);
  if (auth.allowed) return command;
  return {
    ...command,
    status: auth.denialStatus ?? 'failed',
    denialReason: auth.denialReason ?? 'denied by compliance gate',
  };
}

/** Build a schema-valid queued ControlCommand (helper for probe fixtures + surfaces). */
export function makeControlCommand(
  agentNodeId: string,
  kind: ControlKind,
  requestedBy: string,
  extra: Partial<ControlCommand> = {},
): ControlCommand {
  return {
    schema: 'pd.agent-harbor.control-command.v0',
    commandId: `ctl_${randomUUID()}`,
    agentNodeId,
    kind,
    requestedBy,
    status: 'queued',
    idempotencyKey: `${agentNodeId}:${kind}:${randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}
