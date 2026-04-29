#!/usr/bin/env node
/**
 * Emit a promotion-time release-surface review signal.
 *
 * This intentionally does not spawn agents directly. The promote script emits a
 * tuple plus a project-scoped pub/sub message; fleet policy owns whether that
 * wakes a Documentarian/Lookout body, applies cooldown/dedupe, or queues work.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DEV_DIR = resolve(SCRIPT_DIR, '..');
const DEFAULT_STABLE_DIR = resolve(process.env.HOME || '', 'port-daddy-stable');
const DEFAULT_CHANNEL = 'promotion:release-surfaces';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SENDER = 'promotion-script';
const DEFAULT_MAX_CHANGED_FILES = 200;
const GENERATED_PREFIXES = [
  'node_modules/',
  'dist/',
  'coverage/',
  'storybook-static/',
  'public/fleet-ui/',
  'website-v2/dist/',
  'website-v2/storybook-static/',
  'core/pd-barnacle/target/',
  'core/pd-bosun/target/',
  'core/harbor-card-rs/target/',
];
const REVIEW_PRIORITY_PREFIXES = [
  'README.md',
  'CHANGELOG.md',
  'features.manifest.json',
  'AGENTS.md',
  'docs/',
  'website-v2/',
  'skills/port-daddy-agent-skill/',
  'cli/',
  'bin/',
  'lib/',
  'routes/',
  'mcp/',
  'completions/',
  'pd-fleet.yml',
  'scripts/promote-stable.sh',
];

export const RELEASE_SURFACES = [
  'README.md',
  'CHANGELOG.md',
  'features.manifest.json',
  'docs/openapi.yaml',
  'docs/sdk.md',
  'website-v2',
  'website tutorials',
  'CLI help and completions',
  'SDK reference',
  'MCP tools and instructions',
  'skills/port-daddy-agent-skill',
  'AGENTS.md',
];

function parseArgs(argv) {
  const options = {
    devDir: DEFAULT_DEV_DIR,
    stableDir: DEFAULT_STABLE_DIR,
    channel: DEFAULT_CHANNEL,
    ttlMs: DEFAULT_TTL_MS,
    maxChangedFiles: DEFAULT_MAX_CHANGED_FILES,
    sender: DEFAULT_SENDER,
    dryRun: false,
    json: false,
    bestEffort: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };

    switch (arg) {
      case '--dev-dir':
        options.devDir = resolve(next());
        break;
      case '--stable-dir':
        options.stableDir = resolve(next());
        break;
      case '--source-sha':
        options.sourceSha = next();
        break;
      case '--stable-sha':
        options.stableSha = next();
        break;
      case '--channel':
        options.channel = next();
        break;
      case '--harbor':
        options.harbor = next();
        break;
      case '--ttl':
      case '--ttl-ms':
        options.ttlMs = Number.parseInt(next(), 10);
        break;
      case '--max-changed-files':
        options.maxChangedFiles = Number.parseInt(next(), 10);
        break;
      case '--sender':
      case '--as':
        options.sender = next();
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--best-effort':
        options.bestEffort = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error('--ttl-ms must be a positive integer');
  }
  if (!Number.isFinite(options.maxChangedFiles) || options.maxChangedFiles <= 0) {
    throw new Error('--max-changed-files must be a positive integer');
  }

  return options;
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function git(args, cwd, fallback = null) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return fallback;
  return result.stdout.trim();
}

export function readProjectName(devDir) {
  const rc = readJsonIfPresent(resolve(devDir, '.portdaddyrc'));
  if (typeof rc?.project === 'string' && rc.project.trim()) return rc.project.trim();

  const pkg = readJsonIfPresent(resolve(devDir, 'package.json'));
  if (typeof pkg?.name === 'string' && pkg.name.trim()) return pkg.name.trim();

  return 'port-daddy';
}

export function collectChangedFiles({ devDir, sourceSha, stableSha }) {
  if (!sourceSha || !stableSha) return [];
  const output = git(['diff', '--name-only', stableSha, sourceSha], devDir, '');
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function summarizeChangedFiles(files, maxChangedFiles = DEFAULT_MAX_CHANGED_FILES) {
  const unique = [...new Set((files || []).map((file) => String(file).trim()).filter(Boolean))].sort();
  const sourceFiles = unique
    .filter((file) => !GENERATED_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .sort((a, b) => {
      const priorityFor = (file) => {
        const index = REVIEW_PRIORITY_PREFIXES.findIndex((prefix) => file === prefix || file.startsWith(prefix));
        return index === -1 ? REVIEW_PRIORITY_PREFIXES.length : index;
      };
      const priorityDelta = priorityFor(a) - priorityFor(b);
      return priorityDelta || a.localeCompare(b);
    });
  return {
    changedFiles: sourceFiles.slice(0, maxChangedFiles),
    changedFileCount: sourceFiles.length,
    changedFilesTruncated: sourceFiles.length > maxChangedFiles,
    ignoredChangedFileCount: unique.length - sourceFiles.length,
  };
}

export function buildPromotionReviewPayload(options = {}) {
  const devDir = resolve(options.devDir || DEFAULT_DEV_DIR);
  const stableDir = resolve(options.stableDir || DEFAULT_STABLE_DIR);
  const project = options.project || readProjectName(devDir);
  const sourceSha = options.sourceSha || git(['rev-parse', '--short', 'HEAD'], devDir, 'unknown');
  const sourceFullSha = git(['rev-parse', 'HEAD'], devDir, sourceSha);
  const sourceBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], devDir, 'unknown');
  const stableSha = options.stableSha || (
    existsSync(stableDir) ? git(['rev-parse', '--short', 'HEAD'], stableDir, null) : null
  );
  const stableFullSha = stableSha && existsSync(stableDir)
    ? git(['rev-parse', 'HEAD'], stableDir, stableSha)
    : stableSha;
  const changedFileSummary = summarizeChangedFiles(
    options.changedFiles || collectChangedFiles({ devDir, sourceSha: sourceFullSha, stableSha: stableFullSha }),
    options.maxChangedFiles || DEFAULT_MAX_CHANGED_FILES,
  );

  return {
    type: 'promotion.release_surfaces.review_requested',
    project,
    sourceBranch,
    sourceSha,
    sourceFullSha,
    stableSha,
    stableFullSha,
    devDir,
    stableDir,
    channel: options.channel || DEFAULT_CHANNEL,
    emittedAt: new Date().toISOString(),
    reason: 'Promotion tests passed and stable merge is about to begin; release-facing docs and agent-facing surfaces should now be checked against code truth.',
    surfaces: RELEASE_SURFACES,
    ...changedFileSummary,
    guidance: [
      'Prefer deterministic parity checks before prose edits.',
      'Update release surfaces in the same coherent slice; do not broaden into unrelated docs cleanup.',
      'If the review needs code or docs edits, coordinate with Port Daddy claims before mutating files.',
      'Do not spawn additional agents from this review unless an operator explicitly escalates.',
    ],
  };
}

export function buildPromotionReviewTuple(payload) {
  return [
    'promotion:release-surfaces',
    payload.project,
    payload.sourceSha,
    {
      sourceBranch: payload.sourceBranch,
      stableSha: payload.stableSha,
      devDir: payload.devDir,
      stableDir: payload.stableDir,
      surfaces: payload.surfaces,
      changedFiles: payload.changedFiles,
      changedFileCount: payload.changedFileCount,
      changedFilesTruncated: payload.changedFilesTruncated,
      ignoredChangedFileCount: payload.ignoredChangedFileCount,
    },
  ];
}

export function buildEmissionPlan(options = {}) {
  const payload = buildPromotionReviewPayload(options);
  const project = payload.project;
  const harbor = options.harbor || `${project}:fleet`;
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const sender = options.sender || DEFAULT_SENDER;
  const tuple = buildPromotionReviewTuple(payload);

  return {
    payload,
    tuple,
    harbor,
    ttlMs,
    sender,
    commands: [
      {
        name: 'tuple',
        command: 'pd',
        args: ['tuple', 'out', JSON.stringify(tuple), '--harbor', harbor, '--ttl', String(ttlMs), '--as', sender],
      },
      {
        name: 'publish',
        command: 'pd',
        args: ['pub', payload.channel, JSON.stringify(payload), '--sender', sender, '--signal', 'pan-pan'],
      },
    ],
  };
}

function runCommand(command) {
  return spawnSync(command.command, command.args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function emitPromotionReview(options = {}) {
  const plan = buildEmissionPlan(options);
  const results = [];

  if (options.dryRun) {
    return { success: true, dryRun: true, ...plan, results };
  }

  for (const command of plan.commands) {
    const result = runCommand(command);
    const ok = result.status === 0;
    results.push({
      name: command.name,
      ok,
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    });

    if (!ok && !options.bestEffort) {
      const message = result.stderr.trim() || result.stdout.trim() || `${command.command} ${command.args.join(' ')} failed`;
      const error = new Error(message);
      error.plan = plan;
      error.results = results;
      throw error;
    }
  }

  return {
    success: results.every((result) => result.ok),
    dryRun: false,
    ...plan,
    results,
  };
}

function printHuman(result) {
  if (result.dryRun) {
    console.log(`Promotion release-surface review dry run for ${result.payload.project}@${result.payload.sourceSha}`);
    return;
  }

  if (result.success) {
    console.log(`Promotion release-surface review emitted on ${result.payload.channel} for ${result.payload.project}@${result.payload.sourceSha}`);
    return;
  }

  console.warn(`WARNING: promotion release-surface review was only partially emitted for ${result.payload.project}@${result.payload.sourceSha}`);
  for (const entry of result.results.filter((item) => !item.ok)) {
    console.warn(`  ${entry.name}: ${entry.stderr || entry.stdout || `exit ${entry.status}`}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = emitPromotionReview(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHuman(result);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
