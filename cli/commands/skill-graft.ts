/**
 * pd jury-rig — operator/agent surface for native skill discovery.
 *
 * The fleet engine uses the same library on the live spawn path when a ship
 * sets `jury_rig: true`. This CLI is intentionally thin: inspect a query,
 * warm/rescan the catalog out of band, or fetch one skill-owned reference file.
 */

import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import {
  createSkillGraftIndex,
  defaultSkillGraftRoots,
  renderSkillGraftContext,
  renderSkillSearchResults,
  type SkillGraftIndex,
} from '../../lib/skill-graft.js';
import { defaultSkillCatalogRoots } from '../../lib/skill-sync.js';
import { resolveSkillGraftRuntime } from '../../lib/skill-graft-runtime.js';
import { createTool2VecReconciler } from '../../lib/skill-graft-reconciler.js';
import {
  applyJuryRigBootstrap,
  juryRigBootstrapLayout,
  planJuryRigBootstrap,
  readJuryRigBootstrapStatus,
  redactJuryRigBootstrapPlan,
  rollbackJuryRigBootstrapReceipt,
  verifyNativeJuryRigRuntime,
} from '../../lib/jury-rig-bootstrap.js';
import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import { readCurrentContext } from '../utils/current-context.js';
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
  home?: string;
  'pd-home'?: string;
  'expected-head'?: string;
  receipt?: string;
}

const JURY_RIG_REPOSITORY = 'curiositech/port-daddy';
const JURY_RIG_REPLACEMENT_PR = 9965;

/**
 * Builds the bootstrap layout without consulting mutable global CLI state.
 * The design keeps plan, status, and tests pointed at explicit machine roots.
 *
 * @param options Parsed bootstrap path and expected-head options.
 * @param expectedHead Verified replacement head, when apply has established it.
 * @param nativeHookPath Verified installed native hook path, when available.
 * @returns Normalized inputs for the bootstrap planning library.
 */
function bootstrapLayoutOptions(options: JuryRigCliOptions, expectedHead?: string, nativeHookPath?: string) {
  return {
    home: typeof options.home === 'string' ? options.home : homedir(),
    pdHome: typeof options['pd-home'] === 'string' ? options['pd-home'] : undefined,
    nativeHookPath,
    repository: JURY_RIG_REPOSITORY,
    replacementPr: JURY_RIG_REPLACEMENT_PR,
    expectedReplacementHead: expectedHead ?? (
      typeof options['expected-head'] === 'string' ? options['expected-head'] : undefined
    ),
  };
}

/**
 * Prints machine-readable bootstrap evidence consistently. The intent is to
 * keep receipt output stable even before a richer human renderer is added.
 *
 * @param value Redacted plan, status report, or terminal receipt.
 * @param options Parsed CLI output options.
 * @returns Nothing; the value is written to standard output.
 */
function printBootstrapResult(value: unknown, options: JuryRigCliOptions): void {
  if (isJson(options)) console.log(JSON.stringify(value, null, 2));
  else console.log(JSON.stringify(value, null, 2));
}

/**
 * Routes guarded machine-bootstrap operations. Apply intentionally verifies
 * merged and installed authority before planning any write, while plan and
 * status remain safe read surfaces and rollback requires a durable receipt.
 *
 * @param args Bootstrap operation and any positional receipt path.
 * @param options Parsed CLI bootstrap and output options.
 * @returns A promise that resolves after output or a terminal receipt.
 */
async function handleBootstrap(args: string[], options: JuryRigCliOptions): Promise<void> {
  const operation = args[0] || 'status';
  if (operation === 'plan' || operation === 'dry-run') {
    const plan = planJuryRigBootstrap(bootstrapLayoutOptions(options));
    printBootstrapResult(redactJuryRigBootstrapPlan(plan), options);
    if (plan.verdict !== 'ready') process.exitCode = 1;
    return;
  }

  if (operation === 'apply') {
    const proof = verifyNativeJuryRigRuntime({
      repository: JURY_RIG_REPOSITORY,
      replacementPr: JURY_RIG_REPLACEMENT_PR,
    });
    const plan = planJuryRigBootstrap(bootstrapLayoutOptions(options, proof.prHead, proof.nativeHookPath));
    const context = readCurrentContext();
    if (!context?.agentId || !context.sessionId) {
      throw new Error('pd jury-rig bootstrap apply requires an active Port Daddy session for receipt attribution');
    }
    const receipt = applyJuryRigBootstrap({
      plan,
      proof,
      attribution: {
        agentId: context.agentId,
        sessionId: context.sessionId,
        remit: 'native Jury-rig machine authority cutover',
        roadmapAuthority: 'Roadmap-Item:none:infrastructure-cutover',
        sourceHead: proof.prHead,
      },
    });
    printBootstrapResult(receipt, options);
    if (receipt.status !== 'committed') process.exitCode = 1;
    return;
  }

  if (operation === 'rollback') {
    const receiptPath = (typeof options.receipt === 'string' && options.receipt) || args[1];
    if (!receiptPath) {
      throw new Error('Usage: pd jury-rig bootstrap rollback --receipt <apply-receipt.json>');
    }
    printBootstrapResult(rollbackJuryRigBootstrapReceipt(receiptPath), options);
    return;
  }

  if (operation === 'status') {
    const layout = juryRigBootstrapLayout(bootstrapLayoutOptions(options));
    const transactions = readJuryRigBootstrapStatus(layout);
    printBootstrapResult({ transactionRoot: layout.transactionRoot, transactions }, options);
    return;
  }

  throw new Error(`Unknown Jury-rig bootstrap operation: ${operation}`);
}

/**
 * Resolves an explicit catalog root relative to the caller's cwd. The purpose
 * is deterministic project-local discovery without silently changing cwd.
 *
 * @param options Parsed root or directory options.
 * @returns An absolute project root.
 */
function rootFromOptions(options: JuryRigCliOptions): string {
  const raw = (typeof options.root === 'string' && options.root)
    || (typeof options.dir === 'string' && options.dir)
    || process.cwd();
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/**
 * Parses optional positive limits while treating absent or invalid values as
 * unspecified; this design leaves defaults with the owning library.
 *
 * @param value Raw CLI option value.
 * @returns A positive integer, or undefined when no valid limit was supplied.
 */
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

/**
 * Creates the shared native hybrid index for CLI operations. The intent is for
 * query and guarded reference reads to use the same roots and runtime policy.
 *
 * @param options Parsed catalog, ranking, and output options.
 * @returns A configured skill graft index.
 */
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

/**
 * Joins a free-form task query and reports missing input as CLI usage. The
 * design gives direct and default query forms one normalization contract.
 *
 * @param args Positional words forming the task query.
 * @returns The normalized query, or an empty string after recording failure.
 */
function queryFromArgs(args: string[], operation: 'search' | 'graft'): string {
  const text = args.join(' ').trim();
  if (!text) {
    console.error(`Usage: pd jury-rig ${operation} "<task>" [--root <path>] [--json]`);
    process.exitCode = 1;
  }
  return text;
}

/**
 * Executes native hybrid skill discovery and renders either JSON or bounded
 * guidance. The design warns honestly when semantic centroids are unavailable.
 *
 * @param args Positional words forming the task query.
 * @param options Parsed ranking, catalog, and output options.
 * @returns A promise resolving after discovery output is emitted.
 */
async function handleGraft(args: string[], options: JuryRigCliOptions): Promise<void> {
  const query = queryFromArgs(args, 'graft');
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

/** Rank skill metadata without injecting any SKILL.md body into output. */
async function handleSearch(args: string[], options: JuryRigCliOptions): Promise<void> {
  const query = queryFromArgs(args, 'search');
  if (!query) return;

  const index = createIndex(options);
  const result = await index.search(query, {
    shortlistLimit: optionalPositiveInt(options['shortlist-limit'] ?? options.limit),
  });

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const rendered = renderSkillSearchResults(result);
  if (!rendered) {
    ui.info(`No skills matched ${JSON.stringify(query)} (${result.scannedCount} scanned).`);
    return;
  }
  console.log(rendered);
  ui.info('Metadata only; no SKILL.md body was loaded. Use `pd jury-rig graft "<task>"` only when full guidance is needed.');
  if (result.semanticTier === 'lexical-only') {
    ui.info('Semantic Tool2Vec tier is cold or unconfigured; run `pd jury-rig warm` after setting PD_SKILL_GRAFT_BACKEND, or `pd doctor` to repair the shared embedder cache.');
  }
}

/**
 * Reconciles Tool2Vec centroids outside the Fleet hot path. The purpose is a
 * resumable, lease-protected warm operation with explicit local-only control.
 *
 * @param options Parsed catalog, backend, batch, and output options.
 * @returns A promise resolving after reconciliation statistics are emitted.
 */
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

/**
 * Reads one skill-owned reference through the index's path guard. The intent
 * is to expose supporting text without granting execution authority to skills.
 *
 * @param args Skill id followed by a path inside that skill.
 * @param options Parsed catalog and output options.
 * @returns A promise resolving after content or a guarded failure is emitted.
 */
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

/**
 * Prints the complete native Jury-rig command contract. The design keeps
 * discovery, warming, guarded reads, and bootstrap lifecycle visibly aligned.
 *
 * @returns Nothing; help is written to standard output.
 */
function printHelp(): void {
  console.log(`Jury-rig — discover and safely load native skill guidance

Usage:
  pd jury-rig search "<task>" [--root <path>] [--shortlist-limit <n>] [--json]
  pd jury-rig graft "<task>" [--root <path>] [--shortlist-limit <n>] [--top-limit <n>] [--body-chars <n>] [--json]
  pd jury-rig warm [--root <path>] [--max-skills <n> | --all] [--local-only] [--json]
  pd jury-rig reference <skill-id> <path-within-skill> [--root <path>] [--json]
  pd jury-rig bootstrap plan [--expected-head <sha>] [--json]
  pd jury-rig bootstrap status [--json]
  pd jury-rig bootstrap apply [--json]
  pd jury-rig bootstrap rollback --receipt <apply-receipt.json> [--json]

The same lib/skill-graft.ts index is used by lib/fleet-engine.ts when a
pd-fleet.yml ship opts into jury_rig: true. search is metadata-only and is
the default shorthand. graft is the explicit bounded SKILL.md body load.
Both rank via BM25 until Tool2Vec centroids are warmed. Warm-up is
content-hash checkpointed and safe to resume.`);
}

/**
 * Dispatches the public Jury-rig CLI. The design preserves task text as the
 * default query form while reserving explicit lifecycle subcommands.
 *
 * @param positional Parsed subcommand and positional arguments.
 * @param options Parsed Jury-rig CLI options.
 * @returns A promise resolving when the selected operation completes.
 */
export async function handleJuryRig(positional: string[], options: JuryRigCliOptions): Promise<void> {
  const subcommand = positional[0] || 'help';
  const args = positional.slice(1);

  switch (subcommand) {
    case 'search':
      await handleSearch(args, options);
      return;
    case 'graft':
      await handleGraft(args, options);
      return;
    case 'query':
      throw new Error('Unknown Jury-rig operation "query". Use `pd jury-rig search` for metadata or `pd jury-rig graft` for full guidance.');
    case 'warm':
    case 'refresh':
      await handleWarm(options);
      return;
    case 'reference':
    case 'ref':
      await handleReference(args, options);
      return;
    case 'bootstrap':
      await handleBootstrap(args, options);
      return;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      await handleSearch(positional, options);
  }
}
