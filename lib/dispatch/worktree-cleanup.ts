import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, basename, resolve, isAbsolute } from 'node:path';
import { DISPATCH_WORKTREE_ROOT } from './runner.js';

const execFileAsync = promisify(execFile);

/**
 * Remove a completed dispatch's clean worktree through Git only.
 * Design: this utility has no launch/publication authority and never deletes
 * dirty work or falls back to raw recursive removal.
 * @param worktreePath Exact dispatch-owned worktree path recorded by the runner.
 * @param repoWorkdir Durable source project, never the daemon working directory.
 * @param options Testable local Git and existence boundaries.
 * @returns Completion; unsafe paths and dirty worktrees remain preserved.
 */
export async function reapWorktree(worktreePath: string, repoWorkdir?: string | null,
  options: { expectedBranch?: string | null; existsFn?: (path: string) => boolean; execFileFn?: typeof execFileAsync } = {}): Promise<void> {
  if (!repoWorkdir || !isAbsolute(repoWorkdir)) throw new Error('Dispatch cleanup requires an absolute source project binding');
  if (!options.expectedBranch) throw new Error('Dispatch cleanup requires the exact expected branch');
  const target = resolve(worktreePath);
  if (dirname(target) !== resolve(DISPATCH_WORKTREE_ROOT) || !basename(target).startsWith('port-daddy-dispatch-')) {
    throw new Error('Refusing cleanup outside an exact dispatch worktree');
  }
  if (!(options.existsFn ?? existsSync)(target)) return;
  const run = options.execFileFn ?? execFileAsync;
  const value = async (cwd: string, args: string[]): Promise<string> => {
    const result = await run('git', args, { cwd, timeout: 30_000 });
    const text = String(result.stdout ?? '').trim();
    if (!text) throw new Error('Dispatch cleanup identity proof missing');
    return text;
  };
  const common = await value(resolve(repoWorkdir), ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const targetCommon = await value(target, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const root = await value(target, ['rev-parse', '--show-toplevel']);
  const gitDir = await value(target, ['rev-parse', '--absolute-git-dir']);
  const branch = await value(target, ['symbolic-ref', '--short', 'HEAD']);
  if (resolve(common) !== resolve(targetCommon) || resolve(root) !== target
      || resolve(gitDir) === resolve(targetCommon) || branch !== options.expectedBranch) {
    throw new Error('Dispatch cleanup identity mismatch; worktree preserved');
  }
  await run('git', ['worktree', 'remove', target], { cwd: resolve(repoWorkdir), timeout: 30_000 });
}
