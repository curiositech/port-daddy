#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function requireArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
}

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [String(value)];
}

function firstText(values, fallback) {
  const list = normalizeList(values);
  return list.length > 0 ? list[0] : fallback;
}

export function buildStoryMatrix(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest must be an object');
  }

  const audiences = requireArray(manifest.audiences, 'audiences');
  const sources = requireArray(manifest.sources, 'sources');
  if (sources.length === 0) {
    throw new Error('sources must include at least one citation');
  }

  const sourceIds = new Set();
  const normalizedSources = sources.map((source, index) => {
    if (!source || typeof source !== 'object') {
      throw new Error(`sources[${index}] must be an object`);
    }
    if (!source.url) {
      throw new Error(`sources[${index}].url is required`);
    }
    const id = source.id || `source-${index + 1}`;
    if (sourceIds.has(id)) {
      throw new Error(`sources[${index}].id duplicates source id ${id}`);
    }
    sourceIds.add(id);
    return {
      id,
      title: source.title || id,
      kind: source.kind || 'unknown',
      url: source.url,
      claim: source.claim || '',
    };
  });

  const userStories = [];
  const unmetNeeds = new Map();

  for (const audience of audiences) {
    if (!audience || typeof audience !== 'object') {
      throw new Error('each audience must be an object');
    }
    const id = audience.id || audience.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!id || !audience.name) {
      throw new Error('each audience needs id or name, and name');
    }

    const jobs = normalizeList(audience.jobs);
    const pains = normalizeList(audience.pains);
    const craves = normalizeList(audience.craves);
    const evidence = normalizeList(audience.evidence);
    if (evidence.length === 0) {
      throw new Error(`audience ${id} must include at least one evidence source`);
    }
    for (const evidenceId of evidence) {
      if (!sourceIds.has(evidenceId)) {
        throw new Error(`audience ${id} references unknown source ${evidenceId}`);
      }
    }

    for (const [jobIndex, job] of jobs.entries()) {
      const desiredOutcome = firstText(craves, firstText(pains, 'make forward progress with less hidden risk'));
      const pain = firstText(pains, 'workflow friction');
      userStories.push({
        id: `${id}-${jobIndex + 1}`,
        audience: id,
        story: `As ${audience.name}, I want ${job}, so I can ${desiredOutcome}.`,
        pain,
        comebackTrigger: firstText(audience.comebackTriggers, desiredOutcome),
        trustThreshold: firstText(audience.trustThresholds, 'visible diff, rollback, and test evidence'),
        evidence,
      });
      unmetNeeds.set(pain, {
        need: pain,
        audiences: [...new Set([...(unmetNeeds.get(pain)?.audiences || []), id])],
        portDaddyImplication:
          audience.portDaddyImplication ||
          'Expose identity, state, transcript, sandbox, spend, and review proof around the agent loop.',
      });
    }
  }

  const opportunities =
    manifest.opportunities ||
    [...unmetNeeds.values()].map((need, index) => ({
      rank: index + 1,
      opportunity: need.portDaddyImplication,
      evidence: need.audiences,
      proofRequired: 'live artifact, read-back path, rollback path, and explicit operator receipt',
    }));

  return {
    summary: {
      audienceCount: audiences.length,
      sourceCount: normalizedSources.length,
      storyCount: userStories.length,
      opportunityCount: opportunities.length,
    },
    sources: normalizedSources,
    audiences: audiences.map((audience) => ({
      id: audience.id || audience.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: audience.name,
      jobs: normalizeList(audience.jobs),
      pains: normalizeList(audience.pains),
      craves: normalizeList(audience.craves),
      evidence: normalizeList(audience.evidence),
    })),
    user_stories: userStories,
    unmet_needs: [...unmetNeeds.values()],
    opportunities,
    risks: normalizeList(manifest.risks),
  };
}

function parseArgs(argv) {
  const inputIndex = argv.indexOf('--input');
  if (inputIndex === -1 || !argv[inputIndex + 1]) {
    throw new Error('usage: story_matrix.mjs --input manifest.json');
  }
  return { input: argv[inputIndex + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { input } = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(readFileSync(input, 'utf8'));
  process.stdout.write(`${JSON.stringify(buildStoryMatrix(manifest), null, 2)}\n`);
}
