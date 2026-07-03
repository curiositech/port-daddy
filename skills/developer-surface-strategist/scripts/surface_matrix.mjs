#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SURFACE_BY_ACTOR = {
  human: 'gui',
  operator: 'gui',
  developer: 'sdk',
  application: 'sdk',
  service: 'api',
  model: 'mcp',
  agent: 'mcp',
  script: 'cli',
  ci: 'cli',
};

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function chooseSurface(workflow) {
  const actor = String(workflow.actor || '').toLowerCase();
  const frequency = String(workflow.frequency || '').toLowerCase();
  if (workflow.primarySurface) return workflow.primarySurface;
  if ((actor.includes('human') || actor.includes('operator')) && (frequency.includes('routine') || workflow.setup === true)) return 'gui';
  if (actor.includes('model')) return 'mcp';
  if (actor.includes('service')) return 'api';
  if (actor.includes('script') || actor.includes('ci')) return 'cli';
  if (actor.includes('developer') || actor.includes('application') || workflow.embedded === true) return 'sdk';
  return SURFACE_BY_ACTOR[actor] || 'sdk';
}

function secondarySurface(primary) {
  return {
    gui: 'cli',
    cli: 'sdk',
    sdk: 'api',
    mcp: 'api',
    api: 'sdk',
    webhook: 'api',
  }[primary] || 'cli';
}

function rationale(primary) {
  return {
    gui: 'Routine human setup, status, review, and recovery need visible affordances.',
    cli: 'Local automation, CI, and agent shell workflows need scriptable commands and exit codes.',
    sdk: 'Application code needs typed helpers, retries, fixtures, and receipt parsing.',
    mcp: 'Model clients need schema-governed tools with permission boundaries.',
    api: 'Services need network contracts independent of a local shell.',
    webhook: 'External events need asynchronous delivery and retry semantics.',
  }[primary] || 'Surface selected from workflow actor and frequency.';
}

function workflowRequiresTube(workflow) {
  return workflow.requiresTube === true || String(workflow.transport || '').toLowerCase() === 'pd-tube';
}

function tubeGaps(tubeWorkflow, requiresTube) {
  if (!tubeWorkflow) return requiresTube ? ['tubeWorkflow'] : [];
  const required = ['channel', 'messageSchema', 'sender', 'listener', 'receipt', 'idempotency', 'auth', 'targetLanguages'];
  return required.filter((field) => !hasValue(tubeWorkflow[field])).map((field) => `tubeWorkflow.${field}`);
}

function sdkGaps(manifest) {
  const languages = normalizeList(manifest.targetLanguages).map((item) => item.toLowerCase());
  const surfaces = normalizeList(manifest.surfaces).map((item) => item.toLowerCase());
  const sdkPlan = manifest.sdkPlan || {};
  const gaps = [];
  if (languages.includes('python') && !hasValue(sdkPlan.python)) {
    gaps.push('sdkPlan.python');
  }
  if ((surfaces.includes('sdk') || languages.length > 0) && !hasValue(sdkPlan.examples)) {
    gaps.push('sdkPlan.examples');
  }
  if ((surfaces.includes('sdk') || languages.length > 0) && !hasValue(sdkPlan.tests)) {
    gaps.push('sdkPlan.tests');
  }
  return gaps;
}

export function buildSurfaceMatrix(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('surface strategy manifest must be an object');
  }
  if (!manifest.name) {
    throw new Error('manifest.name is required');
  }
  if (!Array.isArray(manifest.workflows) || manifest.workflows.length === 0) {
    throw new Error('manifest.workflows must include at least one workflow');
  }

  const workflows = manifest.workflows.map((workflow, index) => {
    if (!workflow.name) throw new Error(`workflows[${index}].name is required`);
    const primarySurface = chooseSurface(workflow);
    return {
      name: workflow.name,
      actor: workflow.actor || 'developer',
      transport: workflow.transport || null,
      requiresTube: workflowRequiresTube(workflow),
      primarySurface,
      secondarySurface: workflow.secondarySurface || secondarySurface(primarySurface),
      rationale: workflow.rationale || rationale(primarySurface),
      mustNotDo:
        workflow.mustNotDo ||
        (primarySurface === 'gui'
          ? 'Hide routine setup behind terminal-only commands.'
          : 'Become the only access path for every user and integration.'),
    };
  });

  const requiresTube = workflows.some((workflow) => workflow.requiresTube);
  const tubeContractGaps = tubeGaps(manifest.tubeWorkflow, requiresTube);
  const sdkContractGaps = sdkGaps(manifest);
  const gaps = [...tubeContractGaps, ...sdkContractGaps];
  const recommendedSurfaces = [...new Set(workflows.flatMap((workflow) => [workflow.primarySurface, workflow.secondarySurface]))];

  return {
    name: manifest.name,
    pass: gaps.length === 0,
    recommendedSurfaces,
    workflows,
    tubeWorkflow: manifest.tubeWorkflow || null,
    sdkGaps: sdkContractGaps,
    tubeGaps: tubeContractGaps,
    gaps,
  };
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: surface_matrix.mjs --input surfaces.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { input } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(input, 'utf8'));
  process.stdout.write(`${JSON.stringify(buildSurfaceMatrix(manifest), null, 2)}\n`);
}
