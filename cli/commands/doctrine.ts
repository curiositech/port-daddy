/**
 * `pd doctrine` — agent-facing access to the empirically earned doctrine loop.
 *
 * FleetBar owns the normal operator review experience. This CLI is deliberately
 * provenance-first for agents, automation, and recovery: every mutation takes
 * a complete JSON evidence envelope, and decision-time retrieval creates a
 * receipt before the agent reports follow/adapt/reject and later outcome.
 */

import { readFileSync } from 'node:fs';
import { pdFetch } from '../utils/fetch.js';
import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';

const SUBCOMMANDS = new Set([
  'status', 'candidates', 'show', 'orders', 'application', 'outcome',
  'record-episode', 'propose', 'preregister', 'run', 'admit', 'contest',
  'help', '--help', '-h',
]);

function inputJson(options: CLIOptions): Record<string, unknown> {
  const supplied = options.input;
  if (typeof supplied !== 'string' || !supplied.trim()) {
    throw new Error('this command requires --input <json> or --input @path/to/evidence.json');
  }
  const raw = supplied.startsWith('@')
    ? readFileSync(supplied.slice(1), 'utf8')
    : supplied;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--input must be valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--input must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function option(options: CLIOptions, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = options[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function bodyWithOptions(options: CLIOptions, names: Array<[string, string[]]>): Record<string, unknown> {
  const body = inputJson(options);
  for (const [field, aliases] of names) {
    const value = option(options, ...aliases);
    if (value !== undefined) body[field] = value;
  }
  return body;
}

function usage(): void {
  console.log(`Usage:
  pd doctrine status
  pd doctrine candidates [--status candidate|provisional|established|contested] [--dir <project>] [--decision-class <class>]
  pd doctrine show <doctrine-id>
  pd doctrine orders --input @decision.json
  pd doctrine application <retrieval-id> --input @application.json
  pd doctrine outcome <application-id> --input @outcome.json

Evidence capture and laboratory commands (all append only):
  pd doctrine record-episode --input @episode.json
  pd doctrine propose --input @candidate.json
  pd doctrine preregister --input @experiment.json
  pd doctrine run <experiment-id> --input @treatment-run.json
  pd doctrine admit <candidate-id> --input @admission.json
  pd doctrine contest <doctrine-id> --input @contradiction.json

Every input includes projectDir, actorId, and citations. orders is advisory
only and writes a retrieval receipt; application records follow/adapt/reject;
outcome links later verified evidence. Admission refuses unmatched factual
replays, including prompt-only counterfactuals.

Common flags: -j, --json; -q, --quiet; --input <json | @file>
`);
}

async function request(method: string, path: string, body?: Record<string, unknown>): Promise<any> {
  const response = await pdFetch(path, body === undefined ? { method } : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const detail = typeof payload.error === 'string' ? payload.error : undefined;
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return payload;
}

function print(data: any, options: CLIOptions, summary: string, details: string[] = []): void {
  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (isQuiet(options)) {
    console.log(summary);
    return;
  }
  ui.success(summary);
  for (const detail of details) console.log(`  ${detail}`);
}

export async function handleDoctrine(args: string[], options: CLIOptions): Promise<void> {
  const subcommand = args[0] || 'status';
  if (!SUBCOMMANDS.has(subcommand)) {
    ui.error(`Unknown doctrine subcommand: ${subcommand}`);
    usage();
    process.exit(1);
  }
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    usage();
    return;
  }

  try {
    if (subcommand === 'status') {
      const data = await request('GET', '/doctrine/status');
      print(data, options, `Doctrine: ${data.counts?.provisional ?? 0} provisional, ${data.counts?.contested ?? 0} contested`, [
        'advisory only; canonical source: Agent Harbor doctrine-evidence',
        `episodes: ${data.counts?.episodes ?? 0}; candidates: ${data.counts?.candidates ?? 0}`,
      ]);
      return;
    }

    if (subcommand === 'candidates') {
      const params = new URLSearchParams();
      const status = option(options, 'status');
      const projectDir = option(options, 'dir', 'project-dir', 'projectDir');
      const decisionClass = option(options, 'decision-class', 'decisionClass');
      if (status) params.set('status', status);
      if (projectDir) params.set('projectDir', projectDir);
      if (decisionClass) params.set('decisionClass', decisionClass);
      const data = await request('GET', `/doctrine/candidates${params.size ? `?${params}` : ''}`);
      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      if (isQuiet(options)) {
        console.log(String(data.count ?? 0));
        return;
      }
      if (!data.candidates?.length) {
        ui.info('No doctrine candidates matched.');
        return;
      }
      ui.success(`${data.count} doctrine candidate(s)`);
      for (const candidate of data.candidates) {
        console.log(`  ${candidate.status.padEnd(11)} ${candidate.doctrineId ?? candidate.id}`);
        console.log(`    ${candidate.title}`);
      }
      return;
    }

    if (subcommand === 'show') {
      const doctrineId = args[1];
      if (!doctrineId) throw new Error('Usage: pd doctrine show <doctrine-id>');
      const data = await request('GET', `/doctrine/${encodeURIComponent(doctrineId)}`);
      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      if (isQuiet(options)) {
        console.log(data.doctrine?.status ?? 'unknown');
        return;
      }
      const doctrine = data.doctrine;
      ui.success(`${doctrine.title} (${doctrine.status}, advisory)`);
      console.log(`  when: ${doctrine.when}`);
      console.log(`  prefer: ${doctrine.prefer}`);
      console.log(`  over: ${doctrine.over}`);
      console.log(`  because: ${doctrine.because}`);
      console.log(`  evidence: episode=${data.episode?.id ?? 'missing'} experiment=${data.experiment?.id ?? 'missing'} retrievals=${data.retrievals?.length ?? 0} outcomes=${data.outcomes?.length ?? 0}`);
      return;
    }

    if (subcommand === 'orders') {
      const data = await request('POST', '/doctrine/orders', bodyWithOptions(options, [
        ['decisionId', ['decision-id', 'decisionId']],
        ['decisionClass', ['decision-class', 'decisionClass']],
      ]));
      print(data, options, `Advisory receipt ${data.receipt?.id ?? 'created'}: ${data.doctrines?.length ?? 0} doctrine(s)`, [
        'record follow, adapt, or reject before closing this decision',
      ]);
      return;
    }

    const commandMap: Record<string, { path: (id?: string) => string; summary: (data: any) => string }> = {
      'record-episode': { path: () => '/doctrine/episodes', summary: (data) => `Episode ${data.episode?.episodeId ?? 'recorded'}` },
      propose: { path: () => '/doctrine/candidates', summary: (data) => `Candidate ${data.candidate?.candidateId ?? 'recorded'}` },
      preregister: { path: () => '/doctrine/experiments', summary: (data) => `Experiment ${data.experiment?.experimentId ?? 'preregistered'}` },
      run: { path: (id) => `/doctrine/experiments/${encodeURIComponent(id!)}/runs`, summary: (data) => `Treatment run ${data.treatmentRun?.treatmentRunId ?? 'recorded'}` },
      admit: { path: (id) => `/doctrine/candidates/${encodeURIComponent(id!)}/admit`, summary: (data) => `Doctrine ${data.doctrine?.doctrineId ?? 'admitted'} (advisory)` },
      application: { path: (id) => `/doctrine/retrievals/${encodeURIComponent(id!)}/application`, summary: (data) => `Application ${data.application?.applicationId ?? 'recorded'}` },
      outcome: { path: (id) => `/doctrine/applications/${encodeURIComponent(id!)}/outcome`, summary: (data) => `Outcome ${data.outcome?.outcomeId ?? 'recorded'}` },
      contest: { path: (id) => `/doctrine/${encodeURIComponent(id!)}/contest`, summary: () => 'Doctrine contested; prior evidence remains intact' },
    };
    const mapped = commandMap[subcommand];
    if (!mapped) throw new Error(`Unsupported doctrine subcommand: ${subcommand}`);
    const idRequired = ['run', 'admit', 'application', 'outcome', 'contest'].includes(subcommand);
    const entityId = args[1];
    if (idRequired && !entityId) throw new Error(`pd doctrine ${subcommand} requires an id argument`);
    const data = await request('POST', mapped.path(entityId), inputJson(options));
    print(data, options, mapped.summary(data));
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
  }
}
