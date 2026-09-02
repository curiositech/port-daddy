#!/usr/bin/env -S npx tsx
/**
 * sync-skills.ts — Fan Port Daddy's skill catalog out to every agent runtime's
 * skill directory (.claude/skills, .codex/skills, .agy/skills, .gemini, .cursor,
 * .agents, …) as symlinks.
 *
 * This is the commit-time entry point. The heavy lifting lives in
 * lib/skill-sync.ts (union resolution, collision priority, symlink auditing);
 * this wrapper only parses flags and prints a summary so it can be called from a
 * git hook, `npm run skills:sync`, or by hand.
 *
 * Scope:
 *   --scope project  (default) writes into the REPO's own dotfile dirs so the
 *                    checkout has a consistent local skill view. baseDir = repo root.
 *   --scope user     writes into $HOME dotfile dirs (mirrors `pd setup`).
 *
 * Flags:
 *   --base <dir>     Override the base directory the runtime dirs hang off of.
 *   --check          Status only; exit non-zero if any runtime link is missing
 *                    or stale (CI / pre-commit drift detection). Implies no writes.
 *   --dry-run        Show what would change without writing links.
 *   --quiet          Only print on changes or drift (good for hooks).
 *   --json           Emit the raw SyncAgentSkillsResult as JSON.
 *
 * Sources are auto-discovered by defaultSkillCatalogRoots(): explicit
 * PORT_DADDY_SKILL_SOURCE_ROOTS entries, the repo's first-party skills/ and Claude
 * mirror, and the user's declared Claude/AGENTS libraries. External catalogs are
 * inputs only when explicitly configured; discovery never installs their runtime.
 */
import { resolve } from 'node:path';
import { skillSyncRepositoryRoot } from '../lib/skill-sync-git.js';
import {
  formatSkillSyncSummary,
  syncAgentSkills,
  type SkillSyncScope,
} from '../lib/skill-sync.js';

interface Cli {
  scope: SkillSyncScope;
  base: string;
  check: boolean;
  dryRun: boolean;
  quiet: boolean;
  json: boolean;
}

/**
 * Design: anchor projection paths to Git truth while retaining a safe cwd fallback.
 * @returns Resolved repository root or current directory.
 */
function repoRoot(): string {
  try {
    return skillSyncRepositoryRoot(process.cwd());
  } catch {
    process.stderr.write('sync-skills: unable to verify the selected project root; no links written\n');
    process.exit(1);
  }
}

/**
 * Design: keep the synchronization wrapper deterministic and reject unknown mutation flags.
 * @param argv Command-line arguments after the executable and script name.
 * @returns Validated synchronization options.
 */
function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    scope: 'project',
    base: '',
    check: false,
    dryRun: false,
    quiet: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--scope':
        cli.scope = (argv[++i] as SkillSyncScope) ?? 'project';
        break;
      case '--base':
        cli.base = argv[++i] ?? '';
        break;
      case '--check':
      case '--status':
        cli.check = true;
        break;
      case '--dry-run':
        cli.dryRun = true;
        break;
      case '--quiet':
        cli.quiet = true;
        break;
      case '--json':
        cli.json = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        process.stderr.write(`sync-skills: unknown flag '${arg}'\n`);
        process.exit(2);
    }
  }

  if (cli.scope !== 'project' && cli.scope !== 'user') {
    process.stderr.write(`sync-skills: --scope must be 'project' or 'user'\n`);
    process.exit(2);
  }
  return cli;
}

/** Design: document the complete bounded projection surface from the executable itself. */
function printHelp(): void {
  process.stdout.write(
    [
      'sync-skills — fan the skill catalog out to every agent runtime',
      '',
      'Usage: tsx scripts/sync-skills.ts [--scope project|user] [--base <dir>]',
      '                                  [--check] [--dry-run] [--quiet] [--json]',
      '',
      'Default: --scope project, base = repo root.',
    ].join('\n') + '\n',
  );
}

/** Design: compose parsing, catalog synchronization, evidence output, and drift exit status. */
function main(): void {
  const cli = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const base = cli.base
    ? resolve(cli.base)
    : cli.scope === 'user'
      ? process.env.HOME || root
      : root;

  const result = syncAgentSkills({
    baseDir: base,
    projectRoot: root,
    scope: cli.scope,
    dryRun: cli.dryRun,
    statusOnly: cli.check,
  });

  if (cli.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const changed =
      result.created > 0 ||
      result.replaced > 0 ||
      result.errors.length > 0 ||
      result.audit.missingLinks > 0 ||
      result.audit.staleSymlinks > 0;
    if (!cli.quiet || changed) {
      for (const line of formatSkillSyncSummary(result)) {
        process.stdout.write(line + '\n');
      }
    }
  }

  // In --check mode, drift is a non-zero exit so CI / hooks can gate on it.
  if (cli.check) {
    const drift = result.audit.missingLinks + result.audit.staleSymlinks;
    if (drift > 0) {
      process.stderr.write(
        `sync-skills: ${drift} runtime skill link(s) out of date. Run: npm run skills:sync\n`,
      );
      process.exit(1);
    }
  }

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

main();
