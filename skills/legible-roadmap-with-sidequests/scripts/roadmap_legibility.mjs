#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTIVE_STATUSES = new Set(['in-progress', 'in progress', 'active', 'done', 'shipped', 'merged', 'landed']);
const PENDING_STATUSES = new Set(['todo', 'planned', 'backlog', 'parked', 'blocked']);
const DEFAULT_MAX_CADENCE_DAYS = 14;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeStatus(status) {
  return typeof status === 'string' ? status.trim().toLowerCase() : '';
}

/**
 * Audit a roadmap + recent-work snapshot for legibility: is every unit of
 * work — planned or sidequest — traceable to a real roadmap item (or an
 * explicit opt-out), is any spawned work captured back into the roadmap, is
 * reported status backed by real evidence, and is reconciliation happening
 * often enough that burst-energy work doesn't rot outside the plan.
 *
 * This mirrors the real port-daddy `roadmap-link` CI gate philosophy
 * (`lib/roadmap-link-core.ts`): link-or-opt-out, never a silent skip. It adds
 * the sidequest-specific half of that story — spawn-capture and periodic
 * reconciliation — which the PR-time gate alone cannot see.
 *
 * @param {unknown} state - parsed JSON state. Shape:
 *   {
 *     canonicalRoadmaps: number,
 *     workUnits: Array<{
 *       id: string,
 *       kind: 'planned' | 'sidequest',
 *       roadmapLink?: string | null,
 *       optOutReason?: string | null,
 *       spawnedItems?: number,
 *       spawnedItemsCaptured?: number,
 *       progressEvidence?: string[],
 *       status: string,
 *     }>,
 *     reconciliationCadenceDays?: number | null,
 *     policy?: { linkOrOptOutRequired?: boolean, maxReconciliationCadenceDays?: number },
 *   }
 * @returns {{
 *   pass: boolean,
 *   legibilityScore: number,
 *   findings: Array<{ id: string, severity: 'critical'|'high'|'medium'|'low', message: string, workUnitId?: string }>,
 *   recommendations: string[],
 * }}
 */
export function auditRoadmapLegibility(state) {
  if (!isPlainObject(state)) {
    throw new Error('state must be a JSON object');
  }
  if (typeof state.canonicalRoadmaps !== 'number' || !Number.isInteger(state.canonicalRoadmaps) || state.canonicalRoadmaps < 0) {
    throw new Error('state.canonicalRoadmaps must be a non-negative integer');
  }
  if (!Array.isArray(state.workUnits)) {
    throw new Error('state.workUnits must be an array');
  }
  state.workUnits.forEach((unit, i) => {
    if (!isPlainObject(unit) || !isNonEmptyString(unit.id) || !isNonEmptyString(unit.status)) {
      throw new Error(`state.workUnits[${i}] must be an object with a non-empty id and status`);
    }
    if (unit.kind !== 'planned' && unit.kind !== 'sidequest') {
      throw new Error(`state.workUnits[${i}].kind must be "planned" or "sidequest"`);
    }
  });

  const policy = isPlainObject(state.policy) ? state.policy : {};
  const linkOrOptOutRequired = policy.linkOrOptOutRequired !== false; // default true
  const maxCadenceDays = typeof policy.maxReconciliationCadenceDays === 'number'
    ? policy.maxReconciliationCadenceDays
    : DEFAULT_MAX_CADENCE_DAYS;

  const findings = [];
  const recommendations = [];

  function flag(id, severity, message, workUnitId, recommendation) {
    const entry = { id, severity, message };
    if (workUnitId) entry.workUnitId = workUnitId;
    findings.push(entry);
    if (recommendation) recommendations.push(recommendation);
  }

  // --- 1. One canonical roadmap, not a scattered wishlist ---
  if (state.canonicalRoadmaps === 0) {
    flag(
      'no-canonical-roadmap',
      'critical',
      'canonicalRoadmaps is 0 — there is nothing for any work unit to link against.',
      undefined,
      'Stand up one canonical roadmap document/table before auditing legibility further.'
    );
  } else if (state.canonicalRoadmaps > 1) {
    flag(
      'roadmap-fragmentation',
      'critical',
      `canonicalRoadmaps is ${state.canonicalRoadmaps} — multiple competing roadmaps fragment the through-line and make "linked" ambiguous.`,
      undefined,
      'Consolidate into exactly one canonical roadmap; demote or archive the rest to history/ADRs.'
    );
  }

  // --- per-work-unit checks ---
  let traceableAndEvidenced = 0;
  for (const unit of state.workUnits) {
    const hasLink = isNonEmptyString(unit.roadmapLink);
    const hasOptOut = isNonEmptyString(unit.optOutReason);
    const traceable = hasLink || hasOptOut;
    const status = normalizeStatus(unit.status);
    const evidence = Array.isArray(unit.progressEvidence) ? unit.progressEvidence.filter(isNonEmptyString) : [];
    const spawnedItems = typeof unit.spawnedItems === 'number' ? unit.spawnedItems : 0;
    const spawnedCaptured = typeof unit.spawnedItemsCaptured === 'number' ? unit.spawnedItemsCaptured : 0;

    // 2. Link-or-opt-out — every unit, planned or sidequest, must be traceable.
    if (linkOrOptOutRequired && !traceable) {
      flag(
        'untracked-work',
        'critical',
        `Work unit "${unit.id}" (${unit.kind}) has neither roadmapLink nor optOutReason — it runs untracked.`,
        unit.id,
        `Add a Roadmap-Item link for "${unit.id}", or an explicit opt-out reason if it genuinely doesn't advance the roadmap.`
      );
    }
    if (hasLink && hasOptOut) {
      flag(
        'link-and-opt-out-conflict',
        'medium',
        `Work unit "${unit.id}" carries both a roadmapLink and an optOutReason — these are mutually exclusive.`,
        unit.id,
        `Pick one: either "${unit.id}" links to a roadmap item, or it explicitly opts out. Not both.`
      );
    }

    // 3. Spawn-capture — sidequests that generated durable work must fold it back in.
    if (spawnedItems > 0 && spawnedCaptured === 0) {
      flag(
        'spawn-not-captured',
        'high',
        `Work unit "${unit.id}" spawned ${spawnedItems} new item(s) but captured 0 back into the roadmap — spawned work is being lost.`,
        unit.id,
        `Create roadmap items (or explicit opt-outs) for the ${spawnedItems} thing(s) "${unit.id}" spawned, same as a Roadmap-Spawns trailer would require for a planning doc.`
      );
    } else if (spawnedItems > 0 && spawnedCaptured < spawnedItems) {
      flag(
        'spawn-partially-captured',
        'medium',
        `Work unit "${unit.id}" spawned ${spawnedItems} item(s) but only ${spawnedCaptured} were captured — ${spawnedItems - spawnedCaptured} still untracked.`,
        unit.id,
        `Capture the remaining ${spawnedItems - spawnedCaptured} spawned item(s) from "${unit.id}" before they're forgotten.`
      );
    }

    // 4. Status without evidence — no status theater.
    if (ACTIVE_STATUSES.has(status) && evidence.length === 0) {
      flag(
        'status-without-evidence',
        'critical',
        `Work unit "${unit.id}" reports status "${unit.status}" with zero progressEvidence entries — this is a claim, not a fact.`,
        unit.id,
        `Attach at least one commit/PR/receipt reference to "${unit.id}" before trusting its "${unit.status}" status.`
      );
    } else if (!ACTIVE_STATUSES.has(status) && !PENDING_STATUSES.has(status) && evidence.length === 0) {
      // Unrecognized status word — still nudge, but softer than a flat-out theater flag.
      flag(
        'status-unrecognized-no-evidence',
        'low',
        `Work unit "${unit.id}" has an unrecognized status "${unit.status}" and no progressEvidence.`,
        unit.id,
        `Use a known status (todo/planned/in-progress/done/...) or attach evidence to "${unit.id}".`
      );
    }

    if (traceable && (evidence.length > 0 || PENDING_STATUSES.has(status) || status === '')) {
      traceableAndEvidenced += 1;
    }
  }

  // --- 5. Reconciliation cadence — burst work must periodically fold back in ---
  const cadence = state.reconciliationCadenceDays;
  if (cadence === undefined || cadence === null) {
    flag(
      'reconciliation-cadence-missing',
      'high',
      'No reconciliationCadenceDays set — nothing forces sidequest/burst work to periodically fold back into the roadmap.',
      undefined,
      `Set a reconciliation cadence of ${maxCadenceDays} days or less and actually run it.`
    );
  } else if (typeof cadence !== 'number' || cadence <= 0) {
    flag(
      'reconciliation-cadence-invalid',
      'medium',
      `reconciliationCadenceDays is "${cadence}", which is not a usable positive number.`,
      undefined,
      'Set reconciliationCadenceDays to a positive number of days.'
    );
  } else if (cadence > maxCadenceDays) {
    flag(
      'reconciliation-cadence-too-long',
      'medium',
      `reconciliationCadenceDays is ${cadence}, exceeding the policy max of ${maxCadenceDays} — sidequest sprawl can drift a long time before anyone reconciles it.`,
      undefined,
      `Shorten the reconciliation cadence to ${maxCadenceDays} days or less, or raise policy.maxReconciliationCadenceDays deliberately.`
    );
  }

  const legibilityScore = state.workUnits.length === 0
    ? 1
    : Math.round((traceableAndEvidenced / state.workUnits.length) * 1000) / 1000;

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const pass = criticalCount === 0;

  if (findings.length === 0) {
    recommendations.push('Roadmap is legible: one canonical source, every work unit traceable, spawns captured, status evidenced, reconciliation cadenced. Keep it that way — re-run this audit at every reconciliation.');
  }

  return {
    pass,
    legibilityScore,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: roadmap_legibility.mjs --input <state>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditRoadmapLegibility(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`roadmap_legibility: ${error.message}\n`);
    process.exit(1);
  }
}
