/**
 * Agent Harbor C2 — the conformance probe surface behind `pd work probe`
 * (binder ch18 Work Order C2: "a conformance design for the current launch
 * surface, such as pd spawn --probe ... or the future pd work probe once the
 * single Work Intent command family lands").
 *
 * This is the first landing of the `pd work` family (ADR-0095 fork 4: legacy
 * verbs are intake metadata; the work family is the destination surface).
 * Today it probes the executable conformance fixtures per adapter kind —
 * proving the ladder, the negative probes, and the downgrade machinery end to
 * end. When real anode adapters land (C-wave follow-up), they implement the
 * same ProbeTarget seam and this surface probes live bodies unchanged.
 */

import { randomUUID } from 'node:crypto';
import type { AdapterKind, ComplianceProbeResult } from './types.js';
import { ADAPTER_KINDS } from './types.js';
import { runComplianceProbe } from './compliance-probe.js';
import { makeAdapterFixture, FIXTURE_PROFILES, type FixtureProfile } from './adapter-fixtures.js';
import { getCapabilityProfile, isKnownAdapterKind, CAPABILITY_MATRIX } from './capability-matrix.js';

export interface WorkProbeRequest {
  /** Adapter kind to probe; omit to probe every known kind. */
  adapterKind?: string;
  /** Fixture profile to exercise (default: all four). Real bodies come later. */
  profile?: string;
  agentNodeId?: string;
}

export interface WorkProbeRun {
  adapterKind: AdapterKind;
  profile: FixtureProfile;
  result: ComplianceProbeResult;
}

export interface WorkProbeReport {
  probedAt: string;
  runs: WorkProbeRun[];
  /** One-line verdicts, operator-first. */
  summary: string[];
}

export class WorkProbeUsageError extends Error {}

export async function runWorkProbe(request: WorkProbeRequest = {}): Promise<WorkProbeReport> {
  const kinds: AdapterKind[] = request.adapterKind
    ? (() => {
        if (!isKnownAdapterKind(request.adapterKind!)) {
          throw new WorkProbeUsageError(
            `unknown adapter kind "${request.adapterKind}". Known kinds: ${ADAPTER_KINDS.join(', ')}`,
          );
        }
        return [request.adapterKind as AdapterKind];
      })()
    : [...ADAPTER_KINDS];

  const profiles: FixtureProfile[] = request.profile
    ? (() => {
        if (!(FIXTURE_PROFILES as readonly string[]).includes(request.profile!)) {
          throw new WorkProbeUsageError(
            `unknown fixture profile "${request.profile}". Profiles: ${FIXTURE_PROFILES.join(', ')}`,
          );
        }
        return [request.profile as FixtureProfile];
      })()
    : [...FIXTURE_PROFILES];

  const runs: WorkProbeRun[] = [];
  for (const kind of kinds) {
    for (const profile of profiles) {
      const target = makeAdapterFixture(kind, profile);
      const result = await runComplianceProbe(target, {
        agentNodeId: request.agentNodeId ?? `anode_probe_${randomUUID()}`,
      });
      runs.push({ adapterKind: kind, profile, result });
    }
  }

  const summary = runs.map(({ adapterKind, profile, result }) => {
    const ceiling = getCapabilityProfile(adapterKind).complianceCeiling;
    const downgrade = result.downgrade
      ? ` downgraded ${result.downgrade.from}->${result.downgrade.to} (${result.downgrade.mode ?? 'level-only'})`
      : '';
    const fired = result.negativeProbes.filter((p) => p.fired).length;
    return `${adapterKind}/${profile}: witnessed ${result.witnessedLevel} of ceiling ${ceiling}, `
      + `fidelity ${result.transcriptFidelity}, ${fired}/${result.negativeProbes.length} negative probes fired${downgrade}`;
  });

  return { probedAt: new Date().toISOString(), runs, summary };
}

/** Capability matrix rows for the roster/console surfaces. */
export function capabilityMatrixRows(): Array<{
  kind: AdapterKind;
  displayName: string;
  complianceCeiling: string;
  transcriptFidelityCeiling: string;
  defaultLaunchMode: string;
  modelTiers: string;
}> {
  return Object.values(CAPABILITY_MATRIX).map((p) => ({
    kind: p.kind,
    displayName: p.displayName,
    complianceCeiling: p.complianceCeiling,
    transcriptFidelityCeiling: p.transcriptFidelityCeiling,
    defaultLaunchMode: p.defaultLaunchMode,
    modelTiers: p.modelTiers.join(','),
  }));
}
