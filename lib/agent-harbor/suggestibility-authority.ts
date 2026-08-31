/**
 * Agent Harbor M5 — the suggestibility honesty gate (ADR-0096 proof
 * obligation, enforced in code).
 *
 * ADR-0096, normative: "the protocol must be machine-checked
 * (proverif-tamarin-protocol-modeling) for the injection and replay
 * properties before M5 code claims C3." This module is that gate. It reads
 * the checked-in ProVerif verification results for
 * lib/agent-harbor/formal/guidance_envelope_v0.pv and refuses to rule the
 * suggestibility axis above C0 unless EVERY query in the model's
 * verification summary is proved (`is true`). "cannot be proved", `is
 * false`, a missing results file, or a missing model all fail closed with
 * the concrete reason — the code ships the channel, but the compliance
 * ladder reports C0 for suggestibility until the proof exists.
 *
 * This mirrors F0's "levels are witnessed, not claimed": a compliance level
 * whose precondition is a theorem is only as honest as the theorem's
 * machine-checked status. The attestation is reproducible evidence (model +
 * prover output, both in-tree; re-run `proverif` on the .pv to regenerate),
 * not a self-asserted boolean constant.
 *
 * Ruling inputs beyond the proof:
 *  - the daemon-witnessed C3 positive check (steer-accepted) must have passed;
 *  - the forged-guidance negative probe must be PRESENT and, if it fired,
 *    the channel is unverifiable — the axis caps at C0 regardless of
 *    anything else (a fired-but-downgraded probe is honest accounting, but
 *    the body still acted on unauthenticated authority);
 *  - the probe's witnessedLevel must reach C3 (the normative predicate,
 *    ADR-0095 §8, already folds the forfeiture rules in).
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ComplianceProbeResult } from './types.js';
import { complianceOrder } from './types.js';

/** The named proof obligation (ADR-0096 "Consequences"). */
export const GUIDANCE_PROTOCOL_MODEL = {
  adr: 'ADR-0096',
  modelPath: 'lib/agent-harbor/formal/guidance_envelope_v0.pv',
  resultsPath: 'lib/agent-harbor/formal/guidance_envelope_v0_results.txt',
  /** Q1 injection resistance, Q2 no-replay (injective), Q3 key secrecy. */
  requiredQueries: 3,
} as const;

export interface GuidanceProtocolQuery {
  query: string;
  proved: boolean;
}

export interface GuidanceProtocolAttestation {
  modelPresent: boolean;
  resultsPresent: boolean;
  queries: GuidanceProtocolQuery[];
  /** True only when >= requiredQueries queries exist and ALL are proved. */
  allProved: boolean;
  evidencePath?: string;
  /** Why the attestation fails, when it does. */
  reason?: string;
}

/**
 * Parse a ProVerif output's "Verification summary" block. Every line of the
 * form `Query <q> is true.` counts as proved; `is false` and `cannot be
 * proved` count as unproved. No summary block means no attestation.
 */
export function parseProverifSummary(output: string): GuidanceProtocolQuery[] {
  const summaryIdx = output.lastIndexOf('Verification summary:');
  if (summaryIdx === -1) return [];
  const summary = output.slice(summaryIdx);
  const queries: GuidanceProtocolQuery[] = [];
  const re = /^Query\s+(.+?)\s+(is true|is false|cannot be proved)\.?\s*$/gm;
  for (let m = re.exec(summary); m !== null; m = re.exec(summary)) {
    queries.push({ query: m[1], proved: m[2] === 'is true' });
  }
  return queries;
}

/** Candidate repo roots (mirrors schema-validate.ts candidate resolution). */
function candidateRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    process.env.PORT_DADDY_REPO_ROOT,
    join(here, '..', '..'),
    join(here, '..', '..', '..'),
    process.cwd(),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/**
 * Read the checked-in ProVerif attestation for the guidance protocol. Fails
 * closed at every branch: no model, no results, no summary, too few queries,
 * or any unproved query all yield allProved: false with the reason.
 */
export function readGuidanceProtocolAttestation(rootDir?: string): GuidanceProtocolAttestation {
  const roots = rootDir ? [rootDir] : candidateRoots();
  for (const root of roots) {
    const modelFile = join(root, GUIDANCE_PROTOCOL_MODEL.modelPath);
    const resultsFile = join(root, GUIDANCE_PROTOCOL_MODEL.resultsPath);
    if (!existsSync(modelFile)) continue;
    if (!existsSync(resultsFile)) {
      return {
        modelPresent: true,
        resultsPresent: false,
        queries: [],
        allProved: false,
        reason: `ProVerif model exists but no verification results at ${GUIDANCE_PROTOCOL_MODEL.resultsPath} — run proverif and check in the output (ADR-0096 proof obligation)`,
      };
    }
    const queries = parseProverifSummary(readFileSync(resultsFile, 'utf8'));
    if (queries.length < GUIDANCE_PROTOCOL_MODEL.requiredQueries) {
      return {
        modelPresent: true,
        resultsPresent: true,
        queries,
        allProved: false,
        evidencePath: resultsFile,
        reason: `verification summary has ${queries.length} queries; the protocol needs ${GUIDANCE_PROTOCOL_MODEL.requiredQueries} (injection resistance, no-replay, key secrecy)`,
      };
    }
    const unproved = queries.filter((q) => !q.proved);
    if (unproved.length > 0) {
      return {
        modelPresent: true,
        resultsPresent: true,
        queries,
        allProved: false,
        evidencePath: resultsFile,
        reason: `unproved queries: ${unproved.map((q) => q.query).join(' | ')}`,
      };
    }
    return { modelPresent: true, resultsPresent: true, queries, allProved: true, evidencePath: resultsFile };
  }
  return {
    modelPresent: false,
    resultsPresent: false,
    queries: [],
    allProved: false,
    reason: `ProVerif model not found at ${GUIDANCE_PROTOCOL_MODEL.modelPath} — the ADR-0096 proof obligation is unmet`,
  };
}

export interface SuggestibilityRuling {
  /** The honest suggestibility-axis level: C3 only with proof + witness. */
  axisLevel: 'C0' | 'C3';
  c3Eligible: boolean;
  /** Every reason the axis is gated, when it is. */
  reasons: string[];
  attestation: GuidanceProtocolAttestation;
}

/**
 * Rule the suggestibility axis for a probed body. C3-Suggestible requires,
 * conjunctively: the machine-checked protocol proof, a daemon-witnessed
 * passing steer check, a present forged-guidance probe that did NOT fire,
 * and a witnessed level reaching C3. Anything less is C0 with reasons —
 * never a silently optimistic level.
 */
export function ruleSuggestibilityAxis(
  probe: ComplianceProbeResult,
  attestation: GuidanceProtocolAttestation = readGuidanceProtocolAttestation(),
): SuggestibilityRuling {
  const reasons: string[] = [];

  if (!attestation.allProved) {
    reasons.push(
      `guidance protocol not machine-verified: ${attestation.reason ?? 'unknown'} — C3 is barred until the ProVerif model proves injection resistance and no-replay (ADR-0096)`,
    );
  }

  const steer = probe.checks.find((c) => c.name === 'steer-accepted');
  if (!steer || !steer.passed || !steer.daemonWitnessed) {
    reasons.push('no daemon-witnessed passing steer-accepted check — the positive C3 exercise is unmet');
  }

  const forgedGuidance = probe.negativeProbes.find((n) => n.kind === 'forged-guidance');
  if (!forgedGuidance || forgedGuidance.present !== true) {
    reasons.push('forged-guidance negative probe absent — an unfalsifiable suggestibility claim is a checkbox, not evidence');
  } else if (forgedGuidance.fired === true) {
    reasons.push('forged-guidance fired: the body acted on an unsigned/invalid-signature envelope — the guidance channel is unverifiable, the axis is C0/observed (ADR-0096)');
  }

  if (complianceOrder(probe.witnessedLevel) < complianceOrder('C3')) {
    reasons.push(`witnessed level ${probe.witnessedLevel} is below C3`);
  }

  const eligible = reasons.length === 0;
  return {
    axisLevel: eligible ? 'C3' : 'C0',
    c3Eligible: eligible,
    reasons,
    attestation,
  };
}
