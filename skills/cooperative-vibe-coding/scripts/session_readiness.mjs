#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_MODES = ['sync', 'async', 'hybrid'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Audit a cooperative-coding session plan against this skill's Quality Gates
 * and known failure modes (Merge Conflict Hell, Spectator Sport Pairing,
 * Context Fragmentation, and mode-mismatched-to-team-shape).
 *
 * @param {unknown} plan - parsed JSON session plan, see schemas/session-plan.schema.json.
 * @returns {{pass: boolean, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditCoopSession(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }

  const {
    teamSize,
    timezoneOverlapHours,
    mode,
    voiceChannelTested,
    workScopeSentence,
    fileOwnershipMapped,
    syncCadenceMinutes,
    agentBoundariesSet,
    conflictResolutionOwner,
    commitCadenceMinutes,
    integrationTestedBeforeHandoff,
  } = plan;

  const findings = [];
  const recommendations = [];

  function flag(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
  }

  // --- basic field sanity ---
  const teamSizeValid = isFiniteNumber(teamSize) && teamSize > 0;
  if (!teamSizeValid) {
    flag('missing-team-size', 'high', 'teamSize is missing or not a positive number.', 'Record teamSize as a positive integer so mode-fit checks can run.');
  }
  const overlapValid = isFiniteNumber(timezoneOverlapHours) && timezoneOverlapHours >= 0;
  if (!overlapValid) {
    flag('missing-timezone-overlap', 'high', 'timezoneOverlapHours is missing or invalid.', 'Record the actual overlap window in hours across all participants.');
  }
  const modeValid = VALID_MODES.includes(mode);
  if (!modeValid) {
    flag('invalid-mode', 'critical', `mode must be one of ${VALID_MODES.join(', ')}; got ${JSON.stringify(mode)}.`, 'Set mode to "sync", "async", or "hybrid".');
  }

  // --- pre-session Quality Gate: voice channel established and tested ---
  if (modeValid && mode !== 'async' && voiceChannelTested !== true) {
    flag('voice-channel-untested', 'medium', 'voiceChannelTested is not true for a sync/hybrid session.', 'Test the voice channel before the session starts (Quality Gate: "Voice channel established and tested").');
  }

  // --- Context Fragmentation failure mode ---
  if (!isNonEmptyString(workScopeSentence)) {
    flag('context-fragmentation-no-scope', 'high', 'No 1-sentence work scope recorded — precursor to the "Context Fragmentation" failure mode.', 'State the scope in one sentence: "We are implementing X feature with Y constraints." (Quality Gate: "Work scope defined in 1 sentence").');
  }
  const hasSyncPoints = isFiniteNumber(syncCadenceMinutes) && syncCadenceMinutes > 0;
  if (modeValid && mode !== 'async' && !hasSyncPoints) {
    flag('context-fragmentation-no-sync-points', 'high', 'No sync cadence defined for a sync/hybrid session — "Context Fragmentation": no shared mental-model checkpoints.', 'Set syncCadenceMinutes (25-30 for real-time, or a daily cadence for async handoffs).');
  }

  // --- Merge Conflict Hell failure mode ---
  if (fileOwnershipMapped !== true) {
    flag('merge-conflict-hell-no-ownership', 'critical', 'fileOwnershipMapped is not true — "Merge Conflict Hell": no file-level coordination in place.', 'Map file/directory ownership per person or agent before starting (Quality Gate: "File ownership mapped").');
  }
  if (hasSyncPoints && syncCadenceMinutes > 45) {
    flag('merge-conflict-hell-cadence-too-slow', 'high', `syncCadenceMinutes is ${syncCadenceMinutes}, past the 45-minute "Merge Conflict Hell" threshold.`, 'Reduce sync cadence to 25-30 minutes.');
  }

  // --- Spectator Sport Pairing failure mode ---
  if (agentBoundariesSet !== true) {
    flag('spectator-sport-pairing', 'high', 'agentBoundariesSet is not true — "Spectator Sport Pairing": no agent boundaries or reviewer defined.', 'Define which agent works where and who reviews its output before the session starts (Quality Gate: "AI agent boundaries set").');
  }

  // --- conflict resolution ownership ---
  if (!isNonEmptyString(conflictResolutionOwner)) {
    flag('no-conflict-resolution-owner', 'medium', 'conflictResolutionOwner is not set — no one is designated to break technical ties.', 'Name who owns tie-breaking decisions (Quality Gate: "Conflict resolution protocol ready").');
  }

  // --- in-session commit cadence ---
  const commitCadenceValid = isFiniteNumber(commitCadenceMinutes) && commitCadenceMinutes > 0;
  if (!commitCadenceValid) {
    flag('missing-commit-cadence', 'medium', 'commitCadenceMinutes is missing or invalid.', 'Set a commit cadence (Quality Gate: "Changes committed every 30min max").');
  } else if (commitCadenceMinutes > 30) {
    flag('commit-cadence-too-slow', 'medium', `commitCadenceMinutes is ${commitCadenceMinutes}, past the 30-minute quality gate.`, 'Commit at least every 30 minutes so work never exists only in memory or unsaved files.');
  }

  // --- handoff integration testing ---
  if (modeValid && mode !== 'sync' && integrationTestedBeforeHandoff !== true) {
    flag('untested-handoff', 'high', 'integrationTestedBeforeHandoff is not true for an async/hybrid session.', 'Verify the code builds/runs before handing off (Quality Gate: "Integration tested before handoff").');
  }

  // --- mode mismatched to team size + overlap ---
  if (teamSizeValid && teamSize > 5 && modeValid && mode !== 'async') {
    flag('mode-mismatch-team-too-large', 'critical', `teamSize is ${teamSize} (>5) but mode is "${mode}"; teams over 5 should always be async with clear ownership boundaries.`, 'Switch mode to "async" with explicit ownership boundaries for teams larger than 5.');
  }
  if (overlapValid && timezoneOverlapHours < 4 && modeValid && mode !== 'async') {
    flag('mode-mismatch-low-overlap', 'critical', `timezoneOverlapHours is ${timezoneOverlapHours} (<4) but mode is "${mode}"; under 4 hours of overlap should be async (PR-based with detailed commit messages).`, 'Switch mode to "async" when timezone overlap is under 4 hours.');
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasHigh = findings.some((f) => f.severity === 'high');
  const pass = !hasCritical && !hasHigh;

  if (findings.length === 0) {
    recommendations.push('Session plan clears all quality gates and known failure-mode checks. Still run a live 5-minute goal-alignment check before starting.');
  }

  return { pass, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: session_readiness.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditCoopSession(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`session_readiness: ${error.message}\n`);
    process.exit(1);
  }
}
