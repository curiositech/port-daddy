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

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { resolve } from 'node:path';
import * as ui from '../utils/ui.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';
import { ownerQueryPaths, type GuardOwner } from './guard.js';
import type { CLIOptions } from '../types.js';

interface OwnersByPath {
  [path: string]: GuardOwner[];
}

interface OwnerCheckFailure {
  path: string;
  queryPath: string;
  message: string;
  status?: number;
}

interface FilterResult {
  staged: string[];
  blocked: Array<{ path: string; owners: GuardOwner[]; reason: 'claimed_by_other' | 'ownership_check_failed'; failures?: OwnerCheckFailure[] }>;
  unowned: string[];
  ownerCheckFailures: OwnerCheckFailure[];
}

function gitTextOk(args: string[], cwd: string): { ok: boolean; out: string; err: string; status: number | null } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    out: result.stdout || '',
    err: result.stderr || '',
    status: result.status,
  };
}

function gitRoot(cwd: string): string {
  const r = gitTextOk(['rev-parse', '--show-toplevel'], cwd);
  return r.ok ? r.out.trim() : cwd;
}

/**
 * Expand pathspecs into the concrete list of dirty paths git would stage.
 * We need the concrete list because directories, globs, and `-A` can touch
 * files the operator did not type directly, and
 * the daemon's who-owns is path-keyed; we cannot meaningfully "filter -A"
 * without knowing what -A would touch.
 */
function expandStageSet(positional: string[], options: CLIOptions, cwd: string): string[] {
  const wantsAll = Boolean(options.A || options.all || positional.includes('-A') || positional.includes('--all'));
  const explicit = positional.filter((p) => p !== '-A' && p !== '--all');
  const pathspecs = explicit;

  if (!wantsAll && explicit.length === 0) {
    return [];
  }

  const args = [
    'ls-files',
    '--modified',
    '--deleted',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    ...pathspecs,
  ];
  const expanded = gitTextOk(args, cwd);
  const concrete = expanded.ok
    ? expanded.out.split('\0').map((line) => line.trim()).filter(Boolean)
    : [];

  if (concrete.length > 0 || wantsAll) {
    return Array.from(new Set(concrete));
  }

  // Preserve explicit path errors/no-ops so `pd add missing-file` behaves like
  // git after the ownership check instead of silently saying "nothing to do."
  return Array.from(new Set(explicit));
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchOwners(paths: string[], repoRoot: string): Promise<{ owners: OwnersByPath; failures: Record<string, OwnerCheckFailure[]> }> {
  const out: OwnersByPath = {};
  const failures: Record<string, OwnerCheckFailure[]> = {};
  for (const path of paths) {
    const owners: GuardOwner[] = [];
    for (const queryPath of ownerQueryPaths(path, repoRoot)) {
      try {
        const res = await pdFetch(`${PORT_DADDY_URL}/files/who-owns?path=${encodeURIComponent(queryPath)}`);
        if (!res.ok) {
          const message = await res.text().catch(() => `HTTP ${res.status}`);
          (failures[path] ||= []).push({ path, queryPath, status: res.status, message });
          continue;
        }
        const data = (await res.json()) as { owners?: GuardOwner[] };
        if (Array.isArray(data?.owners)) owners.push(...data.owners);
      } catch (error) {
        (failures[path] ||= []).push({ path, queryPath, message: failureMessage(error) });
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
  return { owners: out, failures };
}

function partition(paths: string[], owners: OwnersByPath, failures: Record<string, OwnerCheckFailure[]>, selfSessionId: string | null): FilterResult {
  const staged: string[] = [];
  const blocked: FilterResult['blocked'] = [];
  const unowned: string[] = [];
  const ownerCheckFailures: OwnerCheckFailure[] = [];
  for (const path of paths) {
    const all = owners[path] ?? [];
    const others = all.filter((o) => !!o.sessionId && o.sessionId !== selfSessionId);
    const pathFailures = failures[path] ?? [];
    if (others.length > 0) {
      blocked.push({ path, owners: others, reason: 'claimed_by_other' });
      continue;
    }
    if (pathFailures.length > 0) {
      ownerCheckFailures.push(...pathFailures);
      blocked.push({ path, owners: [], reason: 'ownership_check_failed', failures: pathFailures });
      continue;
    }
    if (all.length === 0) unowned.push(path);
    staged.push(path);
  }
  return { staged, blocked, unowned, ownerCheckFailures };
}

function describeOwners(owners: GuardOwner[]): string {
  return owners
    .map((o) => `${o.agentId ?? '?'}:${(o.sessionId ?? '?').slice(0, 12)}${o.purpose ? ` (${o.purpose})` : ''}`)
    .join('; ');
}

function printJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload, null, 2));
}

function gitAudit(result: SpawnSyncReturns<Buffer>): Record<string, unknown> {
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : undefined,
  };
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
    const payload = {
      success: true,
      passed: true,
      dryRun,
      force,
      repoRoot: root,
      cwd,
      requested: { positional, expanded: [] },
      staged: [],
      blocked: [],
      unowned: [],
      ownerCheckFailures: [],
      message: 'Nothing to stage. Pass paths or -A to stage everything.',
    };
    if (json) printJson(payload);
    else if (!quiet) ui.info(payload.message);
    return;
  }

  const context = readCurrentContext(root);
  const selfSessionId = context?.sessionId ?? null;
  const selfAgentId = context?.agentId ?? null;
  const ownerAudit = await fetchOwners(stageSet, root);
  const result = partition(stageSet, ownerAudit.owners, ownerAudit.failures, selfSessionId);

  // Force mode: stage everything, but loud about what got overridden.
  const toStage = force ? stageSet : result.staged;
  const basePayload = {
    success: true,
    passed: result.blocked.length === 0,
    dryRun,
    force,
    repoRoot: root,
    cwd,
    sessionId: selfSessionId,
    agentId: selfAgentId,
    requested: { positional, expanded: stageSet },
    staged: toStage,
    stageable: result.staged,
    skipped: force ? [] : result.blocked.map((item) => item.path),
    blocked: result.blocked,
    unowned: result.unowned,
    ownerCheckFailures: result.ownerCheckFailures,
  };

  if (result.blocked.length > 0 && !quiet && !json) {
    const verb = force ? 'overriding' : 'skipping';
    ui.warn(`Coordination filter ${verb} ${result.blocked.length} path(s):`);
    for (const item of result.blocked) {
      console.error(`  - ${item.path}`);
      if (item.reason === 'claimed_by_other') {
        console.error(`    owners: ${describeOwners(item.owners)}`);
      } else {
        console.error('    ownership check failed: Port Daddy could not prove this path is safe to stage.');
        for (const failure of item.failures ?? []) {
          console.error(`      ${failure.queryPath}: ${failure.status ? `HTTP ${failure.status} ` : ''}${failure.message}`);
        }
      }
    }
    if (force) {
      console.error('  --force overrides the filter. The pre-commit guard is still your last line of defense.');
    } else {
      console.error('  Use --force to stage anyway, or coordinate with the owner / restore Port Daddy ownership checks first.');
    }
  }

  if (toStage.length === 0) {
    if (json) printJson({ ...basePayload, git: null });
    else if (!quiet) ui.info('No paths left to stage after the coordination filter.');
    return;
  }

  if (dryRun) {
    if (json) {
      printJson({ ...basePayload, git: null });
      return;
    }
    if (!quiet) {
      console.log('Would stage:');
      for (const p of toStage) console.log(`  ${p}`);
    }
    return;
  }

  // Pass through to git add; -- terminator avoids surprises with paths
  // that look like flags.
  const args = ['add', '--', ...toStage];
  const result2 = spawnSync('git', args, { cwd: root, stdio: 'inherit' });
  if (json) printJson({ ...basePayload, success: (result2.status ?? 0) === 0, git: gitAudit(result2) });
  if ((result2.status ?? 0) !== 0) process.exit(result2.status ?? 1);

  if (!quiet && !json) {
    const ownText = force && result.blocked.length > 0 ? ' (force)' : '';
    ui.success(`Staged ${toStage.length} path(s)${ownText}`);
    if (result.blocked.length > 0) {
      const stillBlocked = force ? 0 : result.blocked.length;
      if (stillBlocked > 0) ui.info(`${stillBlocked} path(s) skipped (claimed by other sessions).`);
    }
  }
}
