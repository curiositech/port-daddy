/**
 * pd skill-graft — operator/agent surface for the native skill-graft index.
 *
 * The fleet engine uses the same library on the live spawn path when a ship
 * sets `skill_graft: true`. This CLI is intentionally thin: inspect a query,
 * warm/rescan the catalog out of band, or fetch one skill-owned reference file.
 */

import { isAbsolute, resolve } from 'node:path';
import {
  createSkillGraftIndex,
  defaultSkillGraftRoots,
  renderSkillGraftContext,
  type SkillGraftIndex,
} from '../../lib/skill-graft.js';
import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';

interface SkillGraftCliOptions extends CLIOptions {
  root?: string;
  'top-limit'?: string | number;
  'shortlist-limit'?: string | number;
  'body-chars'?: string | number;
}

function rootFromOptions(options: SkillGraftCliOptions): string {
  const raw = (typeof options.root === 'string' && options.root)
    || (typeof options.dir === 'string' && options.dir)
    || process.cwd();
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function createIndex(options: SkillGraftCliOptions): SkillGraftIndex {
  const projectRoot = rootFromOptions(options);
  return createSkillGraftIndex({
    projectRoot,
    roots: defaultSkillGraftRoots(projectRoot),
    maxBodyChars: optionalPositiveInt(options['body-chars']),
    onWarning: (message) => {
      if (!isJson(options) && !isQuiet(options)) ui.warn(message);
    },
  });
}

function queryFromArgs(args: string[]): string {
  const text = args.join(' ').trim();
  if (!text) {
    console.error('Usage: pd skill-graft query "<task>" [--root <path>] [--json]');
    process.exitCode = 1;
  }
  return text;
}

async function handleQuery(args: string[], options: SkillGraftCliOptions): Promise<void> {
  const query = queryFromArgs(args);
  if (!query) return;

  const index = createIndex(options);
  const result = await index.craft(query, {
    shortlistLimit: optionalPositiveInt(options['shortlist-limit'] ?? options.limit),
    topLimit: optionalPositiveInt(options['top-limit']),
  });

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const rendered = renderSkillGraftContext(result);
  if (!rendered) {
    ui.info(`No skill grafts matched ${JSON.stringify(query)} (${result.scannedCount} scanned).`);
    return;
  }
  console.log(rendered);
  if (result.semanticTier === 'lexical-only') {
    ui.info('Semantic Tool2Vec tier is cold or unconfigured; run `pd skill-graft warm` after setting PD_SKILL_GRAFT_BACKEND, or `pd doctor` to repair the shared embedder cache.');
  }
}

async function handleWarm(options: SkillGraftCliOptions): Promise<void> {
  const index = createIndex(options);
  const stats = await index.refresh();

  if (isJson(options)) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  ui.success(`Skill graft catalog scanned: ${stats.scannedCount} skill(s)`);
  if (stats.embedded || stats.reused || stats.removed) {
    console.log(`  Tool2Vec centroids: embedded ${stats.embedded}, reused ${stats.reused}, removed ${stats.removed}`);
  } else {
    ui.info('No Tool2Vec generator configured; query ranking will use BM25 lexical matching until PD_SKILL_GRAFT_BACKEND is explicitly configured and warmed.');
  }
}

async function handleReference(args: string[], options: SkillGraftCliOptions): Promise<void> {
  const [skillId, filePath] = args;
  if (!skillId || !filePath) {
    console.error('Usage: pd skill-graft reference <skill-id> <path-within-skill> [--root <path>] [--json]');
    process.exitCode = 1;
    return;
  }

  const index = createIndex(options);
  await index.refresh();
  const result = index.getReference(skillId, filePath);

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.found ? 0 : 1;
    return;
  }

  if (!result.found || result.content === null) {
    ui.error(result.error || `No reference found for ${skillId}:${filePath}`);
    process.exitCode = 1;
    return;
  }
  console.log(result.content);
}

function printHelp(): void {
  console.log(`Skill Graft — inspect and warm native skill guidance for fleet ships

Usage:
  pd skill-graft query "<task>" [--root <path>] [--shortlist-limit <n>] [--top-limit <n>] [--body-chars <n>] [--json]
  pd skill-graft warm [--root <path>] [--json]
  pd skill-graft reference <skill-id> <path-within-skill> [--root <path>] [--json]

The same lib/skill-graft.ts index is used by lib/fleet-engine.ts when a
pd-fleet.yml ship opts into skill_graft: true. query is safe on a cold cache:
it scans local skills and ranks via BM25 until Tool2Vec centroids are warmed.`);
}

export async function handleSkillGraft(positional: string[], options: SkillGraftCliOptions): Promise<void> {
  const subcommand = positional[0] || 'help';
  const args = positional.slice(1);

  switch (subcommand) {
    case 'query':
      await handleQuery(args, options);
      return;
    case 'warm':
    case 'refresh':
      await handleWarm(options);
      return;
    case 'reference':
    case 'ref':
      await handleReference(args, options);
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      await handleQuery(positional, options);
  }
}
