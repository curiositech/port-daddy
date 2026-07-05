#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_TOP_LEVEL = [
  'productPromise',
  'users',
  'coldStart',
  'surfaces',
  'architecture',
  'buildSlices',
  'launch',
];

const COLD_START_GATES = [
  ['accountCreation', 'coldStart.accountCreation'],
  ['emptyState', 'coldStart.emptyState'],
  ['missingProviderFallback', 'coldStart.missingProviderFallback'],
  ['demoMode', 'coldStart.demoMode'],
];

const ARCHITECTURE_GATES = [
  ['dataObjects', 'architecture.dataObjects'],
  ['auth', 'architecture.auth'],
  ['permissions', 'architecture.permissions'],
  ['trustBoundaries', 'architecture.trustBoundaries'],
  ['observability', 'architecture.observability'],
];

const LAUNCH_GATES = [
  ['docs', 'launch.docs'],
  ['support', 'launch.support'],
  ['telemetry', 'launch.telemetry'],
  ['securityPrivacy', 'launch.securityPrivacy'],
  ['postLaunchReview', 'launch.postLaunchReview'],
];

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getPath(object, path) {
  return path.split('.').reduce((current, part) => (current ? current[part] : undefined), object);
}

function missingFrom(plan, pairs) {
  return pairs.filter(([, path]) => !hasValue(getPath(plan, path))).map(([, path]) => path);
}

function sliceWarnings(slices) {
  if (!Array.isArray(slices)) return ['buildSlices.type'];
  const warnings = [];
  slices.forEach((slice, index) => {
    if (!hasValue(slice.acceptanceGates)) warnings.push(`buildSlices[${index}].acceptanceGates`);
    if (!hasValue(slice.proofArtifacts)) warnings.push(`buildSlices[${index}].proofArtifacts`);
    if (!hasValue(slice.rollback)) warnings.push(`buildSlices[${index}].rollback`);
  });
  return warnings;
}

function agentWarnings(agents) {
  if (!Array.isArray(agents) || agents.length === 0) return [];
  const warnings = [];
  agents.forEach((agent, index) => {
    for (const field of ['trigger', 'input', 'permission', 'progress', 'receipt', 'rollback']) {
      if (!hasValue(agent[field])) warnings.push(`agents[${index}].${field}`);
    }
  });
  return warnings;
}

function isCriticalSliceGap(gap) {
  return gap === 'buildSlices.type' || gap.includes('proofArtifacts') || gap.includes('rollback');
}

export function scoreProjectPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('plan manifest must be an object');
  }

  const missingRequiredSections = REQUIRED_TOP_LEVEL.filter((field) => !hasValue(plan[field]));
  const coldStartGaps = missingFrom(plan, COLD_START_GATES);
  const architectureGaps = missingFrom(plan, ARCHITECTURE_GATES);
  const launchGaps = missingFrom(plan, LAUNCH_GATES);
  const sliceGaps = sliceWarnings(plan.buildSlices);
  const agentGaps = agentWarnings(plan.agents);
  const criticalGaps = [
    ...coldStartGaps,
    ...sliceGaps.filter(isCriticalSliceGap),
    ...agentGaps.filter((gap) => gap.endsWith('.permission') || gap.endsWith('.rollback')),
  ];

  const gapCount =
    missingRequiredSections.length * 3 +
    coldStartGaps.length * 3 +
    architectureGaps.length * 2 +
    launchGaps.length * 2 +
    sliceGaps.length * 2 +
    agentGaps.length;
  const score = Math.max(0, 100 - gapCount * 4);

  return {
    name: plan.name || 'unnamed-project',
    score,
    pass: score >= 85 && missingRequiredSections.length === 0 && criticalGaps.length === 0,
    missingRequiredSections,
    coldStartGaps,
    architectureGaps,
    launchGaps,
    sliceGaps,
    agentGaps,
    criticalGaps,
    recommendations: buildRecommendations({ coldStartGaps, architectureGaps, launchGaps, sliceGaps, agentGaps }),
  };
}

function buildRecommendations(groups) {
  const recommendations = [];
  if (groups.coldStartGaps.length > 0) {
    recommendations.push({ gate: 'cold-start', fix: 'Define first-run, account, empty-state, missing-provider, and demo paths before build.' });
  }
  if (groups.architectureGaps.length > 0) {
    recommendations.push({ gate: 'architecture', fix: 'Name state, auth, permissions, trust boundaries, and observability before agents edit code.' });
  }
  if (groups.sliceGaps.length > 0) {
    recommendations.push({ gate: 'build-slices', fix: 'Every slice needs acceptance gates, proof artifacts, and rollback.' });
  }
  if (groups.agentGaps.length > 0) {
    recommendations.push({ gate: 'agent-plan', fix: 'Every agent needs trigger, input, permission, progress, receipt, and rollback.' });
  }
  if (groups.launchGaps.length > 0) {
    recommendations.push({ gate: 'launch', fix: 'Add docs, support, telemetry, security/privacy, and post-launch review.' });
  }
  return recommendations;
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: plan_score.mjs --input plan.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { input } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(input, 'utf8'));
  process.stdout.write(`${JSON.stringify(scoreProjectPlan(manifest), null, 2)}\n`);
}
