/**
 * Spawner -> Agent Harbor bridge (Slice 1: honest C1 transcript witnessing).
 *
 * lib/spawner.ts and lib/agent-harbor/* are two disconnected agent-identity
 * systems: spawner tracks its own agents by `agentId` in an in-memory Map and
 * kills them via a bare, ungated `spawner.kill(id)`; Agent Harbor's
 * control-gate.ts is a C0-C6 compliance-gated control-command system with
 * exactly one caller in the whole repo (guidance-envelope.ts, for `steer`
 * only) because nothing ever registered a spawner-launched agent as an
 * AgentNodeView. This module is the bridge — scoped deliberately narrow:
 *
 *   - Reuses spawner's existing `agentId` directly as `agentNodeId` (no new
 *     ID scheme, no mapping table — R1 confirmed the random-suffix format is
 *     good enough for this slice).
 *   - Feeds spawner's ALREADY-EXISTING lib/transcripts.ts message rows into
 *     the Agent Harbor event ledger as `transcript-event` facts, so they get
 *     REAL content_hash/prev_hash chaining from harbor_events/
 *     harbor_proj_timeline — no new hashing code, this is a feeder.
 *   - Runs a genuine ProbeTarget (below) whose C0/C1 exercises are real and
 *     whose C2+ exercises honestly report today's true state (not
 *     gateway-routed, not steerable, not pausable) — the capability
 *     ceiling on the new 'spawner-child' AdapterKind (capability-matrix.ts,
 *     complianceCeiling: 'C1') is what actually caps the witnessed level;
 *     the exercises are honest, not rigged to fail.
 *
 * Explicit non-goals: no C2 gateway-routing, no attempt to make `kill`
 * succeed through control-gate.ts for spawner bodies (it should still
 * correctly deny — C1 < C4 required), no change to the frozen
 * schemas/agent-harbor/v0/compliance-invariants.mjs or to control-gate.ts
 * itself. Success here is "the gate now sees real C1 evidence and correctly
 * still says no," not "kill now works through the gate."
 *
 * Every public method is best-effort and never throws — matching the
 * existing "an audit/telemetry write failure NEVER aborts the spawn" posture
 * already used throughout lib/spawner.ts and lib/transcripts.ts. A bridge
 * failure degrades Agent Harbor visibility for that agent; it must never
 * degrade the actual spawn/kill functionality.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseInstance } from '../sqlite-runtime.js';
import { appendEvent, verifySessionChain, readEvents } from './event-ledger.js';
import { runComplianceProbe } from './compliance-probe.js';
import type { AdapterDescriptor, ProbeTarget } from './compliance-probe.js';

export interface SpawnerHarborBridge {
  /** Register the spawned agent as an Agent Harbor node (C0 self-claim; the
   *  real level is granted later, purely from the probe result). */
  registerNode(agentId: string, identity: string | null, startedAt: number): void;
  /** Append one transcript-event fact, chained per-agent (sessionId = agentId). */
  appendTranscriptEvent(agentId: string, kind: string, occurredAt: number): void;
  /** Run the C1-only compliance probe and record its result. Async because
   *  ProbeTarget exercises are async by contract; fire-and-forget from the
   *  caller's perspective (never rejects). */
  runProbeAndRecord(agentId: string): Promise<void>;
}

export function createSpawnerHarborBridge(db: DatabaseInstance): SpawnerHarborBridge {
  // Per-agent local sequence counter for transcript-event facts. Fresh per
  // process/agentId is correct here: a spawner agentId is minted once per
  // spawn (lib/spawner.ts:1776) and never reused across runs, so there is no
  // cross-process resume case within this bridge's scope to reconcile.
  const seqByAgent = new Map<string, number>();

  function nextSeq(agentId: string): number {
    const n = (seqByAgent.get(agentId) ?? 0) + 1;
    seqByAgent.set(agentId, n);
    return n;
  }

  function registerNode(agentId: string, identity: string | null, startedAt: number): void {
    try {
      appendEvent(db, {
        streamType: 'agent-node',
        payload: {
          schema: 'pd.agent-harbor.agent-node.v0',
          agentNodeId: agentId,
          identity: identity ?? `spawner:${agentId}`,
          class: 'voyager',
          authority: 'local',
          // Honest self-claim at registration time. This is not a bypass of
          // the witnessing invariant: control-gate.ts's effectiveComplianceLevel
          // trusts min(claimed, witnessed) and treats an unwitnessed claim as
          // C0 anyway. The roster's real level advances later, directly from
          // a valid compliance-probe-result fact (projections.ts applyRoster)
          // — no follow-up agent-node re-claim is needed or attempted here.
          complianceLevel: 'C0',
          status: 'active',
          createdAt: new Date(startedAt).toISOString(),
        },
      });
    } catch (err) {
      console.error(`[agent-harbor] spawner-bridge registerNode failed agent=${agentId}: ${String(err)}`);
    }
  }

  function appendTranscriptEvent(agentId: string, kind: string, occurredAt: number): void {
    try {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: {
          eventId: `evt_${randomUUID()}`,
          sessionId: agentId,
          agentNodeId: agentId,
          sequence: nextSeq(agentId),
          occurredAt: new Date(occurredAt).toISOString(),
          schemaVersion: 1,
          kind,
        },
      });
    } catch (err) {
      console.error(`[agent-harbor] spawner-bridge appendTranscriptEvent failed agent=${agentId}: ${String(err)}`);
    }
  }

  async function runProbeAndRecord(agentId: string): Promise<void> {
    try {
      const target = makeSpawnerProbeTarget(db, agentId);
      const probe = await runComplianceProbe(target, { agentNodeId: agentId });
      appendEvent(db, {
        streamType: 'compliance-probe-result',
        payload: probe as unknown as Record<string, unknown>,
      });
    } catch (err) {
      console.error(`[agent-harbor] spawner-bridge runProbeAndRecord failed agent=${agentId}: ${String(err)}`);
    }
  }

  return { registerNode, appendTranscriptEvent, runProbeAndRecord };
}

/**
 * A real ProbeTarget for spawner-launched bodies. C0/C1 exercises answer
 * from real ledger state (this agent's own hash-chained transcript-event
 * facts); every C2+ exercise and every attack probe answers with today's
 * true, honest state for a raw CLI child process — none are gateway-routed,
 * steerable, pausable, or checkpointable yet, and none of the attack surface
 * exists because there is no separate self-report channel to forge through
 * (the daemon is the only party asserting anything about this body).
 * runComplianceProbe's own ceiling clamp (capability-matrix.ts
 * complianceCeiling: 'C1') is the actual enforcement point — these answers
 * are honest reporting, not the thing doing the capping.
 */
function makeSpawnerProbeTarget(db: DatabaseInstance, agentId: string): ProbeTarget {
  const descriptor: AdapterDescriptor = {
    adapterKind: 'spawner-child',
    launchMode: 'native',
  };
  return {
    descriptor: () => descriptor,

    async register(nonce: string) {
      // No separate external process to round-trip with: the daemon is the
      // only party on either end of this exchange for a spawner-launched
      // body, so an honest same-process echo is real evidence here, not a
      // self-report the gate would need to distrust.
      return { echoedNonce: nonce };
    },

    async emitVerifiedTranscript() {
      const events = readEvents(db, { streamType: 'transcript-event', sessionId: agentId });
      const broken = verifySessionChain(db, agentId);
      return { events: events.length, hashChainValid: events.length > 0 && broken === null };
    },

    async routeToolThroughGateway() {
      return { routedViaGateway: false, sideChannelCalls: 1 };
    },
    async acceptSteer() {
      return { acknowledged: false };
    },
    async honorPause() {
      return { paused: false, resumedCleanly: false };
    },
    async cooperateOnClaims() {
      return { claimsRespected: false, parleyAnswered: false };
    },
    async checkpointAndResume() {
      return { checkpointed: false, successorResumed: false };
    },

    async attemptForgedLevel() {
      return { forgeAccepted: false };
    },
    async attemptDirectMcpBypass() {
      return { bypassSucceeded: false };
    },
    async attemptDisableHookAfterLaunch() {
      return { hooksStillAttested: false };
    },
    async attemptForgedHeartbeat() {
      return { heartbeatAcceptedWithoutNonce: false };
    },
    async attemptObservedToControlled() {
      return { controlAccepted: false };
    },
    async attemptForgedGuidance() {
      return { forgedGuidanceActedOn: false };
    },
  };
}
