/**
 * pd add — claim-aware git add wrapper.
 *
 * Wraps `git add` so the safe path is also the lazy path. Before staging,
 * each path is checked against `/files/who-owns` and any path claimed by
 * another active Port Daddy session is filtered out and reported.
 *
 *   pd add -A              # stage everything except files held by others
 *   pd add src/foo.ts      # stage one file unless someone else owns it
 *   pd add --dry-run -A    # show what would and would not be staged
 *   pd add --force -A      # bypass the filter (and print a warning)
 *
 * Closes the most common steamroll path: an agent runs `git add -A` and
 * captures another session's mid-flight edits. With `pd add -A`, the
 * captured set is automatically scoped to "things we are allowed to stage."
 *
 * The filter is *advisory*: an explicit `--force` overrides it, but the
 * override is logged so the operator can see what was overridden. The
 * coordination guard (pre-commit) is still the last line of defense.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import * as ui from '../utils/ui.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';
import { ownerQueryPaths, type GuardOwner } from './guard.js';
import type { CLIOptions } from '../types.js';

interface OwnersByPath {
  [path: string]: GuardOwner[];
}

interface FilterResult {
  staged: string[];
  blocked: Array<{ path: string; owners: GuardOwner[] }>;
  unowned: string[];
}

function gitTextOk(args: string[], cwd: string): { ok: boolean; out: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, out: result.stdout || '' };
}

function gitRoot(cwd: string): string {
  const r = gitTextOk(['rev-parse', '--show-toplevel'], cwd);
  return r.ok ? r.out.trim() : cwd;
}

/**
 * Expand `-A` / `--all` (or no positional arguments after a flag) into the
 * concrete list of paths git would stage. We need the concrete list because
 * the daemon's who-owns is path-keyed; we cannot meaningfully "filter -A"
 * without knowing what -A would touch.
 */
function expandStageSet(positional: string[], options: CLIOptions, cwd: string): string[] {
  const wantsAll = Boolean(options.A || options.all || positional.includes('-A') || positional.includes('--all'));
  const explicit = positional.filter((p) => p !== '-A' && p !== '--all');

  if (wantsAll) {
    // Keep tracked-state queries separate from --exclude-standard, which only
    // applies to untracked discovery on some Git versions.
    const modified = gitTextOk(['ls-files', '--modified'], cwd);
    const deleted = gitTextOk(['ls-files', '--deleted'], cwd);
    const untracked = gitTextOk(['ls-files', '--others', '--exclude-standard'], cwd);
    const lines = `${modified.out}\n${deleted.out}\n${untracked.out}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return Array.from(new Set([...explicit, ...lines]));
  }

  return explicit;
}

async function fetchOwners(paths: string[], repoRoot: string): Promise<OwnersByPath> {
  const out: OwnersByPath = {};
  for (const path of paths) {
    const owners: GuardOwner[] = [];
    for (const queryPath of ownerQueryPaths(path, repoRoot)) {
      try {
        const res = await pdFetch(`${PORT_DADDY_URL}/files/who-owns?path=${encodeURIComponent(queryPath)}`);
        const data = (await res.json()) as { owners?: GuardOwner[] };
        if (Array.isArray(data?.owners)) owners.push(...data.owners);
      } catch {
        // Daemon unreachable for this path — fall back to permissive (don't
        // pretend we know it's clean, but don't pretend it's claimed either).
      }
    }
    // Dedupe by sessionId+agentId.
    const seen = new Set<string>();
    out[path] = owners.filter((o) => {
      const key = `${o.sessionId ?? ''}\0${o.agentId ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return out;
}

function partition(paths: string[], owners: OwnersByPath, selfSessionId: string | null): FilterResult {
  const staged: string[] = [];
  const blocked: Array<{ path: string; owners: GuardOwner[] }> = [];
  const unowned: string[] = [];
  for (const path of paths) {
    const all = owners[path] ?? [];
    const selfOwns = selfSessionId ? all.some((o) => o.sessionId === selfSessionId) : false;
    const others = all.filter((o) => !!o.sessionId && o.sessionId !== selfSessionId);
    if (others.length > 0 && !selfOwns) {
      blocked.push({ path, owners: others });
      continue;
    }
    if (all.length === 0) unowned.push(path);
    staged.push(path);
  }
  return { staged, blocked, unowned };
}

function describeOwners(owners: GuardOwner[]): string {
  return owners
    .map((o) => `${o.agentId ?? '?'}:${(o.sessionId ?? '?').slice(0, 12)}${o.purpose ? ` (${o.purpose})` : ''}`)
    .join('; ');
}

export async function handleAdd(positional: string[], options: CLIOptions): Promise<void> {
  const cwd = resolve(typeof options.dir === 'string' ? options.dir : process.cwd());
  const root = gitRoot(cwd);
  const dryRun = Boolean(options['dry-run'] || options.n);
  const force = Boolean(options.force);
  const json = Boolean(options.json || options.j);
  const quiet = Boolean(options.quiet || options.q);

  const stageSet = expandStageSet(positional, options, root);
  if (stageSet.length === 0) {
    if (!quiet) ui.info('Nothing to stage. Pass paths or -A to stage everything.');
    return;
  }

  const context = readCurrentContext(root);
  const selfSessionId = context?.sessionId ?? null;
  const owners = await fetchOwners(stageSet, root);
  const result = partition(stageSet, owners, selfSessionId);

  if (json) {
    console.log(JSON.stringify({ success: true, dryRun, force, ...result }, null, 2));
  }

  // Force mode: stage everything, but loud about what got overridden.
  const toStage = force ? stageSet : result.staged;

  if (result.blocked.length > 0 && !quiet && !json) {
    const verb = force ? 'overriding' : 'skipping';
    ui.warn(`Coordination filter ${verb} ${result.blocked.length} path(s) claimed by other sessions:`);
    for (const item of result.blocked) {
      console.error(`  - ${item.path}`);
      console.error(`    owners: ${describeOwners(item.owners)}`);
    }
    if (force) {
      console.error('  --force overrides the filter. The pre-commit guard is still your last line of defense.');
    } else {
      console.error('  Use --force to stage anyway, or coordinate with the owner before staging.');
    }
  }

  if (toStage.length === 0) {
    if (!quiet && !json) ui.info('No paths left to stage after the coordination filter.');
    return;
  }

  if (dryRun) {
    if (!quiet && !json) {
      console.log('Would stage:');
      for (const p of toStage) console.log(`  ${p}`);
    }
    return;
  }

  // Pass through to git add; -- terminator avoids surprises with paths
  // that look like flags.
  const args = ['add', '--', ...toStage];
  const result2 = spawnSync('git', args, { cwd: root, stdio: 'inherit' });
  if ((result2.status ?? 0) !== 0) process.exit(result2.status ?? 1);

  if (!quiet && !json) {
    const ownText = result.staged.length === toStage.length ? '' : ' (force)';
    ui.success(`Staged ${toStage.length} path(s)${ownText}`);
    if (result.blocked.length > 0) {
      const stillBlocked = force ? 0 : result.blocked.length;
      if (stillBlocked > 0) ui.info(`${stillBlocked} path(s) skipped (claimed by other sessions).`);
    }
  }
}
