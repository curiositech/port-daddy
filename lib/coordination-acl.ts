/**
 * lib/coordination-acl.ts — Namespace ACL for the adversarial fleet pair.
 *
 * Perimeter layer. Crypto layer in `coordination-crypto.ts` is the real
 * defense; this is the cheap fast-fail before we spend cycles on AEAD.
 *
 * Rules:
 *  1. A persona belongs to exactly one fleet (project membership).
 *  2. `secops:lead` is the only persona allowed in BOTH project memberships,
 *     and only when its current operation is one of the three gate
 *     operations (A: round-open broadcast, B: seal+rewrap, C: publish).
 *  3. Cross-namespace reads are refused. Cross-namespace writes are refused.
 *  4. Refusals are LOGGED to `coordination:audit` as integrity events;
 *     repeated violations from the same persona slash its bond.
 *
 * The ACL does not encrypt. It refuses traffic whose envelope wouldn't
 * decrypt anyway (saving the AEAD round-trip), and it stops plaintext
 * writes from sneaking in.
 */

import { daemonAcceptsEnvelopeFor, type EnvelopePayload, type FleetId } from './coordination-crypto.js';

export type GateOp = 'A_open' | 'B_seal' | 'C_publish';

export interface AclRequest {
  persona: string;            // e.g., "redteam:crypto", "secops:lead"
  op: 'read' | 'write';
  project: 'redteam-review' | 'whitehat-defense' | 'coordination:audit';
  envelope?: EnvelopePayload; // present for writes
  gateOp?: GateOp;            // ONLY meaningful for secops:lead
}

export interface AclDecision {
  allow: boolean;
  reason: string;
  /** When false, the daemon should ALSO emit an integrity event. */
  logViolation: boolean;
}

const RED_PREFIX = 'redteam:';
const DEF_PREFIX = 'defense:';
const LEAD = 'secops:lead';

function fleetForProject(project: AclRequest['project']): FleetId | null {
  if (project === 'redteam-review') return 'redteam-review';
  if (project === 'whitehat-defense') return 'whitehat-defense';
  return null;
}

function personaIsRed(p: string): boolean { return p.startsWith(RED_PREFIX); }
function personaIsDef(p: string): boolean { return p.startsWith(DEF_PREFIX); }
function personaIsLead(p: string): boolean { return p === LEAD; }

export function check(req: AclRequest): AclDecision {
  // Audit chain: append-only signed events, anyone can read, only
  // sec-eng-lead can write.
  if (req.project === 'coordination:audit') {
    if (req.op === 'read') return { allow: true, reason: 'audit:public-read', logViolation: false };
    if (req.op === 'write' && personaIsLead(req.persona)) {
      return { allow: true, reason: 'audit:lead-write', logViolation: false };
    }
    return { allow: false, reason: 'audit:non-lead-write-refused', logViolation: true };
  }

  const fleet = fleetForProject(req.project);
  if (!fleet) return { allow: false, reason: 'unknown-project', logViolation: true };

  // Lead is permitted across-fleet ONLY at gate operations.
  if (personaIsLead(req.persona)) {
    if (!req.gateOp) {
      return {
        allow: false,
        reason: 'lead-cross-fleet-without-gate-op',
        logViolation: true,
      };
    }
    // Even the lead cannot write into a fleet's plaintext stream — only
    // re-encrypted envelopes via Gate B / Gate C.
    if (req.op === 'write' && !req.envelope) {
      return { allow: false, reason: 'lead-write-without-envelope', logViolation: true };
    }
    if (req.op === 'write' && req.envelope && !daemonAcceptsEnvelopeFor(req.envelope, req.project)) {
      return { allow: false, reason: 'lead-envelope-mismatch', logViolation: true };
    }
    return { allow: true, reason: `lead-${req.gateOp}`, logViolation: false };
  }

  // Persona must match the project's fleet.
  if (fleet === 'redteam-review' && !personaIsRed(req.persona)) {
    return { allow: false, reason: 'red-project-non-red-persona', logViolation: true };
  }
  if (fleet === 'whitehat-defense' && !personaIsDef(req.persona)) {
    return { allow: false, reason: 'def-project-non-def-persona', logViolation: true };
  }

  // Reads inside the persona's own fleet: allowed.
  if (req.op === 'read') return { allow: true, reason: 'in-fleet-read', logViolation: false };

  // Writes must carry a daemon-acceptable envelope (forces encryption).
  if (!req.envelope) {
    return { allow: false, reason: 'plaintext-write-refused', logViolation: true };
  }
  if (!daemonAcceptsEnvelopeFor(req.envelope, req.project)) {
    return { allow: false, reason: 'malformed-envelope', logViolation: true };
  }
  return { allow: true, reason: 'in-fleet-write', logViolation: false };
}
