/**
 * pd jury-rig — operator/agent surface for native skill discovery.
 *
 * The fleet engine uses the same library on the live spawn path when a ship
 * sets `jury_rig: true`. This CLI is intentionally thin: inspect a query,
 * warm/rescan the catalog out of band, or fetch one skill-owned reference file.
 */

import { isAbsolute, resolve } from 'node:path';
import {
  createSkillGraftIndex,
  defaultSkillGraftRoots,
  renderSkillGraftContext,
  type SkillGraftIndex,
} from '../../lib/skill-graft.js';
import { defaultSkillCatalogRoots } from '../../lib/skill-sync.js';
import { resolveSkillGraftRuntime } from '../../lib/skill-graft-runtime.js';
import { createTool2VecReconciler } from '../../lib/skill-graft-reconciler.js';
import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';

interface JuryRigCliOptions extends CLIOptions {
  root?: string;
  'top-limit'?: string | number;
  'shortlist-limit'?: string | number;
  'body-chars'?: string | number;
  'max-skills'?: string | number;
  all?: boolean;
  'local-only'?: boolean;
  'db-dir'?: string;
}

function rootFromOptions(options: JuryRigCliOptions): string {
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

/**
 * Selects the full user catalog by default while preserving explicit-root
 * compatibility. The purpose is to warm what users can actually graft without
 * surprising callers that intentionally scoped a project-local test catalog.
 *
 * @param options Parsed CLI root and directory options.
 * @param projectRoot Resolved project root used by explicit scans.
 * @returns Labeled catalog roots for query, reference, or reconciliation.
 */
function catalogRoots(options: JuryRigCliOptions, projectRoot: string) {
  const explicit = (typeof options.root === 'string' && options.root)
    || (typeof options.dir === 'string' && options.dir);
  return explicit
    ? defaultSkillGraftRoots(projectRoot)
    : defaultSkillCatalogRoots(projectRoot).map((root) => ({ label: root.label, path: root.path }));
}

function createIndex(options: JuryRigCliOptions): SkillGraftIndex {
  const projectRoot = rootFromOptions(options);
  const runtime = resolveSkillGraftRuntime();
  return createSkillGraftIndex({
    projectRoot,
    roots: catalogRoots(options, projectRoot),
    llmClient: runtime?.client,
    llmModel: runtime?.model,
    maxBodyChars: optionalPositiveInt(options['body-chars']),
    onWarning: (message) => {
      if (!isJson(options) && !isQuiet(options)) ui.warn(message);
    },
  });
}

function queryFromArgs(args: string[]): string {
  const text = args.join(' ').trim();
  if (!text) {
    console.error('Usage: pd jury-rig query "<task>" [--root <path>] [--json]');
    process.exitCode = 1;
  }
  return text;
}

async function handleQuery(args: string[], options: JuryRigCliOptions): Promise<void> {
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
    ui.info('Semantic Tool2Vec tier is cold or unconfigured; run `pd jury-rig warm` after setting PD_SKILL_GRAFT_BACKEND, or `pd doctor` to repair the shared embedder cache.');
  }
}

async function handleWarm(options: JuryRigCliOptions): Promise<void> {
  const projectRoot = rootFromOptions(options);
  const reconciler = createTool2VecReconciler({
    projectRoot,
    roots: catalogRoots(options, projectRoot),
    dbDir: typeof options['db-dir'] === 'string' ? options['db-dir'] : undefined,
    runtime: resolveSkillGraftRuntime(process.env, { allowRemote: !options['local-only'] }),
    onWarning: (message) => {
      if (!isJson(options) && !isQuiet(options)) ui.warn(message);
    },
  });
  const stats = await reconciler.reconcile({
    trigger: 'cli-warm',
    maxSkills: options.all ? Number.POSITIVE_INFINITY : optionalPositiveInt(options['max-skills']) ?? 32,
  });

  if (isJson(options)) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  ui.success(`Skill graft catalog scanned: ${stats.total} skill(s)`);
  if (!stats.configured) {
    ui.info('Tool2Vec generator is not configured. Set PD_SKILL_GRAFT_BACKEND=cloudflare or ollama; Doctor will continue to report the cache as cold.');
  } else if (!stats.acquired) {
    ui.info('Another setup, daemon, or CLI process already owns the Tool2Vec reconcile lease; this caller left it alone.');
  } else if (stats.embedded || stats.reused || stats.removed) {
    console.log(`  Tool2Vec centroids: embedded ${stats.embedded}, reused ${stats.reused}, removed ${stats.removed}`);
  }
  console.log(`  Coverage: ${stats.current}/${stats.total} current (${stats.coveragePct}%) · state ${stats.state}`);
  if (stats.stoppedEarly && stats.state === 'cold') {
    ui.info('Warm-up checkpointed this batch; daemon ticks or another `pd jury-rig warm` resume at the next missing skill.');
  }
  if (stats.state === 'embedder-down' || stats.state === 'generator-down') process.exitCode = 1;
}

async function handleReference(args: string[], options: JuryRigCliOptions): Promise<void> {
  const [skillId, filePath] = args;
  if (!skillId || !filePath) {
    console.error('Usage: pd jury-rig reference <skill-id> <path-within-skill> [--root <path>] [--json]');
    process.exitCode = 1;
    return;
  }

  const index = createIndex(options);
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
  console.log(`Jury-rig — discover and safely load native skill guidance

Usage:
  pd jury-rig query "<task>" [--root <path>] [--shortlist-limit <n>] [--top-limit <n>] [--body-chars <n>] [--json]
  pd jury-rig warm [--root <path>] [--max-skills <n> | --all] [--local-only] [--json]
  pd jury-rig reference <skill-id> <path-within-skill> [--root <path>] [--json]

The same lib/skill-graft.ts index is used by lib/fleet-engine.ts when a
pd-fleet.yml ship opts into jury_rig: true. query is safe on a cold cache:
it scans the full user skill catalog and ranks via BM25 until Tool2Vec
centroids are warmed. Warm-up is content-hash checkpointed and safe to resume.`);
}

export async function handleJuryRig(positional: string[], options: JuryRigCliOptions): Promise<void> {
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
