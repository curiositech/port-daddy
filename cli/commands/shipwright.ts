/**
 * CLI Shipwright Commands
 *
 * pd shipwright survey               — Survey the current project, write to .portdaddy/shipwright/survey.json
 * pd shipwright survey --json        — Print survey JSON to stdout (no disk write)
 * pd shipwright survey --root <p>    — Override project root (defaults to cwd)
 * pd shipwright survey --llm         — Ask the daemon to add LLM intent/purpose
 * pd shipwright survey --model <id>  — Override the model used when --llm is set
 *
 * The CLI hits the daemon's `POST /shipwright/survey` route. Survey work
 * runs daemon-side so the LLM rate-limit / budget kill chain applies.
 * Subcommands `propose` and `apply` ship in PR3 commit 3.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface SurveyResponse {
  success: boolean;
  survey?: Record<string, unknown>;
  degraded?: boolean;
  reason?: string;
  error?: string;
}

export async function handleShipwright(subcommand: string | undefined, options: CLIOptions): Promise<void> {
  if (!subcommand || subcommand === 'help') {
    printHelp();
    return;
  }

  switch (subcommand) {
    case 'survey':
      await handleSurvey(options);
      return;
    case 'propose':
    case 'apply':
      ui.info(`pd shipwright ${subcommand} ships in PR3 commit 3 — survey is the entry point for now.`);
      process.exit(0);
      return;
    default:
      ui.error(`Unknown shipwright subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

async function handleSurvey(options: CLIOptions): Promise<void> {
  const rawRoot = (options.root as string) || (options.dir as string) || process.cwd();
  const root = isAbsolute(rawRoot) ? rawRoot : resolve(process.cwd(), rawRoot);

  const body: Record<string, unknown> = { root };
  if (options.llm) body.withLlm = true;
  if (options.model) body.model = options.model;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/shipwright/survey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data: SurveyResponse;
  try {
    data = (await res.json()) as unknown as SurveyResponse;
  } catch {
    ui.error('Daemon returned a non-JSON response — is `pd start` running?');
    process.exit(1);
  }

  if (!res.ok || !data.success || !data.survey) {
    ui.error(data.error || 'Survey failed');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data.survey, null, 2));
    return;
  }

  // Default: write to .portdaddy/shipwright/survey.json under the surveyed root.
  const outPath = join(root, '.portdaddy', 'shipwright', 'survey.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(data.survey, null, 2));

  if (isQuiet(options)) {
    console.log(outPath);
    return;
  }

  printSurveySummary(data.survey, outPath, data.degraded === true, data.reason);
}

function printSurveySummary(
  survey: Record<string, unknown>,
  outPath: string,
  degraded: boolean,
  reason: string | undefined,
): void {
  const classification = (survey.classification ?? {}) as Record<string, unknown>;
  const status = (survey.status ?? {}) as Record<string, unknown>;
  const project = String(survey.project ?? 'unknown');
  const kind = String(classification.kind ?? 'unknown');
  const activity = String(status.activity ?? 'unknown');
  const conf = Number(survey.confidence ?? 0);
  const intent = String(survey.intent ?? '');
  const purpose = String(survey.purpose ?? '');

  ui.success(`Survey written: ${outPath}`);
  console.log('');
  console.log(`  ${project} — ${kind} · activity ${activity} · confidence ${conf.toFixed(2)}`);
  if (intent) console.log(`  intent : ${intent}`);
  if (purpose) console.log(`  purpose: ${purpose}`);

  const risks = (survey.risks ?? []) as string[];
  if (risks.length) {
    console.log('');
    console.log('  Risks:');
    for (const r of risks) console.log(`    - ${r}`);
  }
  const opportunities = (survey.opportunities ?? []) as string[];
  if (opportunities.length) {
    console.log('');
    console.log('  Opportunities:');
    for (const o of opportunities) console.log(`    - ${o}`);
  }
  console.log('');

  if (degraded) {
    ui.info(`LLM augmentation skipped${reason ? `: ${reason}` : ''} — re-run with --llm once a backend is wired.`);
  }
}

function printHelp(): void {
  console.log(`Shipwright — survey, propose, apply

Usage:
  pd shipwright survey [--root <path>] [--llm] [--model <id>] [--json] [--quiet]
  pd shipwright propose                    (PR3 commit 3)
  pd shipwright apply                      (PR3 commit 3)

Survey writes a structured ProjectSurvey to .portdaddy/shipwright/survey.json
in the surveyed root. Use --json to stream the same JSON to stdout instead.`);
}
