/**
 * lib/safe/posture-report.ts — A8 of ADR-0088 Phase A (`pd safe`).
 *
 * The scorer + report assembler. It takes the outputs of the read-only sensors
 * A1–A7 (secret scan filtered through the A2 baseline, the A3 crown-jewel
 * permission audit, the A4 binary-trust list / A5 ledger, the A6 egress
 * snapshot, the A7 MCP inventory) and folds them into:
 *
 *   1. a 0–100 posture score (100 = nothing deducted),
 *   2. a Safe Room state — green / amber / red,
 *   3. a blast-radius list: the concrete "what could an agent running as you
 *      read RIGHT NOW" surface, and
 *   4. a footer that echoes `HONEST_LIMITS` (lib/coast-guard.ts) VERBATIM.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  GREEN ≠ SANDBOXED  (load-bearing honesty rule — ADR-0088 § Safe Room)
 * ════════════════════════════════════════════════════════════════════════
 * `green` means "every COOPERATIVE-CASE sensor came back clear." It does NOT
 * mean the host is sandboxed, nor that a truly-malicious same-UID agent is
 * contained — that is exactly what the verbatim `HONEST_LIMITS` footer says is
 * out of scope for this layer. The report is EVIDENCE, never a containment
 * claim. `green` is the absence of a detected cooperative-case problem, full
 * stop.
 *
 * This module is a PURE function of its inputs (no I/O, no shelling, no clock)
 * so the A8 score is deterministic for a fixed fixture set — that is the jest
 * test. The CLI/MCP layer (A9/A10) runs the sensors and hands their results in.
 *
 * NO RAW SECRET crosses this boundary: a `SecretFinding` already carries only
 * path/line/ruleId/last4/entropy, and this module copies those through
 * unchanged. It never reconstructs or logs a value.
 */

import { HONEST_LIMITS } from '../coast-guard.js';
import type {
  BaselinedScanResult,
  BinaryTrust,
  EgressSnapshot,
  McpInventoryResult,
  PermsAuditResult,
  SecretFinding,
} from './types.js';

// ════════════════════════════════════════════════════════════════════════
//  Report shapes
// ════════════════════════════════════════════════════════════════════════

/** The three Safe Room lights. See the GREEN ≠ SANDBOXED header. */
export type SafeRoomState = 'green' | 'amber' | 'red';

/** A category of deduction, so the report can explain WHERE points were lost. */
export type DeductionKind =
  | 'new-plaintext-secret'
  | 'world-readable-crown-jewel'
  | 'coast-guard-off'
  | 'unsigned-running-binary'
  | 'unnotarized-running-binary'
  | 'unpinned-mcp-fetch'
  | 'flow-to-non-allowlisted-host';

/** One scored deduction with the points it cost and a human reason. */
export interface ScoreDeduction {
  kind: DeductionKind;
  /** Points subtracted from 100 (always ≥ 0). */
  points: number;
  /** How many findings of this kind drove the deduction. */
  count: number;
  /** A one-line human explanation (never contains a raw secret). */
  detail: string;
}

/**
 * One blast-radius entry: a concrete capability an agent running as the
 * operator's UID *right now* would have. This is the "so what" of the scan —
 * not a vulnerability count but a reachability statement.
 */
export interface BlastRadiusItem {
  /** A stable tag for the surface (e.g. `read-secret`, `run-untrusted-binary`). */
  surface:
    | 'read-plaintext-secret'
    | 'read-world-readable-secret'
    | 'no-egress-cap'
    | 'run-untrusted-binary'
    | 'load-poisoned-mcp'
    | 'exfiltrate-to-unknown-host';
  /** A human sentence describing what is reachable (path/host, never a value). */
  detail: string;
  /** Severity for ordering the list (high first). */
  severity: 'high' | 'medium' | 'low';
}

/** The full A8 posture report. */
export interface PostureReport {
  /** 0–100; 100 = nothing deducted. */
  score: number;
  /** The Safe Room light. green = cooperative-case sensors clear, NOT sandboxed. */
  state: SafeRoomState;
  /** Per-category deductions that produced the score. */
  deductions: ScoreDeduction[];
  /** The concrete reachable-surface list. */
  blastRadius: BlastRadiusItem[];
  /** Quick roll-up counts for the table/JSON header. */
  summary: {
    newSecrets: number;
    suppressedSecrets: number;
    worldReadableJewels: number;
    coastGuardOn: boolean;
    untrustedRunningBinaries: number;
    unpinnedMcpFetches: number;
    nonAllowlistedFlows: number;
  };
  /**
   * The honesty disclosure — `HONEST_LIMITS` copied VERBATIM. Every report
   * footer carries it; `green` without it would be a lie of omission.
   */
  honestLimits: string;
}

// ════════════════════════════════════════════════════════════════════════
//  Scoring weights (tunable, but FIXED so the score is deterministic)
// ════════════════════════════════════════════════════════════════════════

/**
 * Per-occurrence deduction weights. Chosen so that any single high-severity
 * class (a plaintext secret, an unsigned running binary, Coast Guard off) can
 * tip the score out of green on its own, and a pile-up of them reaches red.
 * Capped per-class so one noisy category cannot drive the score negative.
 */
export interface ScoringWeights {
  newPlaintextSecret: number;
  worldReadableCrownJewel: number;
  coastGuardOff: number;
  unsignedRunningBinary: number;
  unnotarizedRunningBinary: number;
  unpinnedMcpFetch: number;
  flowToNonAllowlistedHost: number;
  /** Max total points any single category may deduct. */
  perCategoryCap: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  newPlaintextSecret: 12,
  worldReadableCrownJewel: 10,
  coastGuardOff: 15,
  unsignedRunningBinary: 8,
  unnotarizedRunningBinary: 4,
  unpinnedMcpFetch: 6,
  flowToNonAllowlistedHost: 5,
  perCategoryCap: 40,
};

/** State thresholds. ≥ greenAt → green; ≥ amberAt → amber; below → red. */
export const STATE_THRESHOLDS = { greenAt: 90, amberAt: 60 } as const;

// ════════════════════════════════════════════════════════════════════════
//  Inputs
// ════════════════════════════════════════════════════════════════════════

/**
 * The aggregate of A1–A7 the scorer folds. Every field is the typed output of
 * its sensor module; the report layer is a pure reducer over them.
 */
export interface PostureInputs {
  /** A1+A2: secret scan already filtered through the baseline. */
  secrets: BaselinedScanResult;
  /** A3: crown-jewel permission audit + Coast Guard posture. */
  perms: PermsAuditResult;
  /**
   * A4/A5: the binary-trust list to score. Scope per the spec is RUNNING
   * processes (an unsigned binary at rest in ~/Downloads is not yet a live
   * blast surface — only running ones deduct).
   */
  binaries: BinaryTrust[];
  /** A6: the point-in-time egress snapshot. */
  egress: EgressSnapshot;
  /** A7: the configured-MCP-server inventory. */
  mcp: McpInventoryResult;
  /**
   * The host allowlist a flow's remoteHost is checked against. A flow whose
   * remoteHost is set and NOT on this list is a non-allowlisted-flow deduction.
   * Empty/undefined → egress flows are reported as EVIDENCE but never deducted
   * (no allowlist configured = no policy to violate; never invent one).
   */
  allowlistedHosts?: string[];
  /** Override weights (tests pin these); defaults to DEFAULT_WEIGHTS. */
  weights?: ScoringWeights;
}

// ════════════════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════════════════

/** A running binary that is unsigned (a live, untrusted execution surface). */
function isUnsignedRunning(b: BinaryTrust): boolean {
  return b.pid !== undefined && (b.trustClass === 'unsigned' || b.trustClass === 'ad-hoc');
}

/**
 * A running binary that is Developer-ID signed but NOT notarized. A weaker
 * concern than fully unsigned (it still has a publisher identity), so it
 * deducts less. `unknown` is bucketed here too — codesign could not vouch for
 * it, which we treat as a notarization gap, not a positive "unsigned" claim.
 */
function isUnnotarizedRunning(b: BinaryTrust): boolean {
  return (
    b.pid !== undefined &&
    (b.trustClass === 'dev-id-unnotarized' || b.trustClass === 'unknown')
  );
}

/** Crown-jewel findings the group/world can read (the dangerous perm leak). */
function worldReadableJewels(perms: PermsAuditResult): typeof perms.findings {
  return perms.findings.filter(
    (f) => f.exists && f.severity === 'exposed' && (f.worldReadable || f.groupReadable),
  );
}

/** Flows whose remoteHost is set and not on the allowlist. */
function nonAllowlistedFlows(egress: EgressSnapshot, allow: string[]): EgressSnapshot['flows'] {
  if (allow.length === 0) return [];
  const set = new Set(allow.map((h) => h.toLowerCase()));
  return egress.flows.filter(
    (f) => f.remoteHost !== null && !set.has(f.remoteHost.toLowerCase()),
  );
}

/** Unpinned npx/uvx MCP server entries (the typosquat / tool-poisoning vector). */
function unpinnedMcp(mcp: McpInventoryResult): McpInventoryResult['servers'] {
  return mcp.servers.filter((s) => s.flags.length > 0);
}

/** Clamp a deduction by the per-category cap, then to ≥ 0. */
function cappedDeduction(perItem: number, count: number, cap: number): number {
  return Math.min(perItem * count, cap);
}

/** A concise, secret-free label for a secret finding's blast-radius line. */
function secretLabel(f: SecretFinding): string {
  return `${f.path}:${f.line} (${f.ruleId}, …${f.last4})`;
}

// ════════════════════════════════════════════════════════════════════════
//  The scorer
// ════════════════════════════════════════════════════════════════════════

/**
 * Fold A1–A7 into a deterministic posture report. Pure: the same inputs always
 * produce the same score, state, deductions, and blast radius. The footer is
 * `HONEST_LIMITS` verbatim — `assert(report.honestLimits === HONEST_LIMITS)`.
 */
export function buildPostureReport(inputs: PostureInputs): PostureReport {
  const w = inputs.weights ?? DEFAULT_WEIGHTS;
  const allow = inputs.allowlistedHosts ?? [];

  const newSecrets = inputs.secrets.newFindings;
  const jewels = worldReadableJewels(inputs.perms);
  const coastGuardOn = inputs.perms.coastGuard.onByDefault;
  const unsignedRunning = inputs.binaries.filter(isUnsignedRunning);
  const unnotarizedRunning = inputs.binaries.filter(isUnnotarizedRunning);
  const unpinned = unpinnedMcp(inputs.mcp);
  const badFlows = nonAllowlistedFlows(inputs.egress, allow);

  const deductions: ScoreDeduction[] = [];

  if (newSecrets.length > 0) {
    deductions.push({
      kind: 'new-plaintext-secret',
      points: cappedDeduction(w.newPlaintextSecret, newSecrets.length, w.perCategoryCap),
      count: newSecrets.length,
      detail: `${newSecrets.length} new plaintext secret(s) at rest (not in baseline)`,
    });
  }
  if (jewels.length > 0) {
    deductions.push({
      kind: 'world-readable-crown-jewel',
      points: cappedDeduction(w.worldReadableCrownJewel, jewels.length, w.perCategoryCap),
      count: jewels.length,
      detail: `${jewels.length} crown-jewel path(s) readable by group/other`,
    });
  }
  if (!coastGuardOn) {
    deductions.push({
      kind: 'coast-guard-off',
      points: w.coastGuardOff,
      count: 1,
      detail: 'Coast Guard egress/deny-list is OFF — no cooperative-case cap in force',
    });
  }
  if (unsignedRunning.length > 0) {
    deductions.push({
      kind: 'unsigned-running-binary',
      points: cappedDeduction(w.unsignedRunningBinary, unsignedRunning.length, w.perCategoryCap),
      count: unsignedRunning.length,
      detail: `${unsignedRunning.length} unsigned/ad-hoc binary(ies) currently running`,
    });
  }
  if (unnotarizedRunning.length > 0) {
    deductions.push({
      kind: 'unnotarized-running-binary',
      points: cappedDeduction(
        w.unnotarizedRunningBinary,
        unnotarizedRunning.length,
        w.perCategoryCap,
      ),
      count: unnotarizedRunning.length,
      detail: `${unnotarizedRunning.length} un-notarized binary(ies) currently running`,
    });
  }
  if (unpinned.length > 0) {
    deductions.push({
      kind: 'unpinned-mcp-fetch',
      points: cappedDeduction(w.unpinnedMcpFetch, unpinned.length, w.perCategoryCap),
      count: unpinned.length,
      detail: `${unpinned.length} MCP server(s) launched via unpinned npx/uvx fetch`,
    });
  }
  if (badFlows.length > 0) {
    deductions.push({
      kind: 'flow-to-non-allowlisted-host',
      points: cappedDeduction(w.flowToNonAllowlistedHost, badFlows.length, w.perCategoryCap),
      count: badFlows.length,
      detail: `${badFlows.length} live flow(s) to host(s) not on the allowlist`,
    });
  }

  const totalDeducted = deductions.reduce((sum, d) => sum + d.points, 0);
  const score = Math.max(0, Math.min(100, 100 - totalDeducted));

  const state: SafeRoomState =
    score >= STATE_THRESHOLDS.greenAt
      ? 'green'
      : score >= STATE_THRESHOLDS.amberAt
        ? 'amber'
        : 'red';

  // ── blast radius — the concrete "what's reachable right now" list ──
  const blastRadius: BlastRadiusItem[] = [];
  for (const f of newSecrets) {
    blastRadius.push({
      surface: 'read-plaintext-secret',
      detail: `Plaintext credential readable at ${secretLabel(f)}`,
      severity: 'high',
    });
  }
  for (const j of jewels) {
    blastRadius.push({
      surface: 'read-world-readable-secret',
      detail: `${j.path} (mode ${j.mode}) readable beyond the owner`,
      severity: 'high',
    });
  }
  if (!coastGuardOn) {
    blastRadius.push({
      surface: 'no-egress-cap',
      detail: 'No cooperative-case egress cap — a proxy-honoring agent is unmetered',
      severity: 'medium',
    });
  }
  for (const b of unsignedRunning) {
    blastRadius.push({
      surface: 'run-untrusted-binary',
      detail: `Running unsigned/ad-hoc binary: ${b.path}${b.pid ? ` (pid ${b.pid})` : ''}`,
      severity: 'high',
    });
  }
  for (const s of unpinned) {
    blastRadius.push({
      surface: 'load-poisoned-mcp',
      detail: `MCP server "${s.name}" fetches unpinned (${s.command} ${s.args.join(' ')})`,
      severity: 'medium',
    });
  }
  for (const fl of badFlows) {
    blastRadius.push({
      surface: 'exfiltrate-to-unknown-host',
      detail: `Live flow to ${fl.remoteHost}${fl.binary ? ` from ${fl.binary}` : ''}${
        fl.agent ? ` (agent ${fl.agent.name})` : ''
      }`,
      severity: 'medium',
    });
  }

  const severityRank = (s: BlastRadiusItem['severity']): number =>
    s === 'high' ? 3 : s === 'medium' ? 2 : 1;
  blastRadius.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  return {
    score,
    state,
    deductions,
    blastRadius,
    summary: {
      newSecrets: newSecrets.length,
      suppressedSecrets: inputs.secrets.suppressed,
      worldReadableJewels: jewels.length,
      coastGuardOn,
      untrustedRunningBinaries: unsignedRunning.length + unnotarizedRunning.length,
      unpinnedMcpFetches: unpinned.length,
      nonAllowlistedFlows: badFlows.length,
    },
    // VERBATIM — the report is honest about its own blind spots or it is not a
    // safety report. Do not paraphrase, truncate, or interpolate.
    honestLimits: HONEST_LIMITS,
  };
}

// ════════════════════════════════════════════════════════════════════════
//  Rendering
// ════════════════════════════════════════════════════════════════════════

/**
 * Render a posture report as plain text (the `pd safe scan` non-JSON output).
 * The footer is the verbatim `HONEST_LIMITS` string — every text rendering
 * MUST end with it, and the test asserts it is present unmodified.
 */
export function renderPostureReportText(report: PostureReport): string {
  const lines: string[] = [];
  const light =
    report.state === 'green' ? 'GREEN' : report.state === 'amber' ? 'AMBER' : 'RED';
  lines.push(`Safe Room: ${light}  (score ${report.score}/100)`);
  lines.push(
    'green = cooperative-case sensors clear — NOT a sandbox / not malicious-agent containment',
  );
  lines.push('');

  if (report.deductions.length === 0) {
    lines.push('No cooperative-case deductions.');
  } else {
    lines.push('Deductions:');
    for (const d of report.deductions) {
      lines.push(`  -${d.points}  ${d.detail}`);
    }
  }
  lines.push('');

  if (report.blastRadius.length > 0) {
    lines.push('Blast radius (reachable as your UID right now):');
    for (const item of report.blastRadius) {
      lines.push(`  [${item.severity}] ${item.detail}`);
    }
    lines.push('');
  }

  lines.push('Honest limits:');
  lines.push(report.honestLimits);
  return lines.join('\n');
}
