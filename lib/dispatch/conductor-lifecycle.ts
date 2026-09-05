import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Create a project-bound linked worktree without disabling Coordination Guard.
 * Design: all Git calls use explicit source provenance; no provider runs here.
 * @param worktreePath Bound dispatch destination.
 * @param branch Exact work branch.
 * @param baseRef Source ref to refresh before creation.
 * @param options Explicit source repository and injectable local Git operations.
 * @returns Completion of the local worktree operation.
 */
export async function gitWorktreeAdd(
  worktreePath: string,
  branch: string,
  baseRef: string,
  options: {
    repoWorkdir: string;
    execFileFn?: (
      file: string,
      args: string[],
      options?: { cwd: string },
    ) => Promise<unknown>;
    existsFn?: (path: string) => boolean;
    sleepFn?: (delayMs: number) => Promise<void>;
    randomFn?: () => number;
    maxAttempts?: number;
  },
): Promise<void> {
  const run = options.execFileFn
    ?? ((file: string, args: string[], execOptions?: { cwd: string }) => execFileAsync(file, args, execOptions));
  const pathExists = options.existsFn ?? existsSync;
  const sleep = options.sleepFn ?? ((delayMs: number) => new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, delayMs);
  }));
  const random = options.randomFn ?? Math.random;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const rawRepoWorkdir = options.repoWorkdir?.trim();
  if (!rawRepoWorkdir || !isAbsolute(rawRepoWorkdir)) {
    throw new Error('gitWorktreeAdd requires an absolute source project binding');
  }
  const repoWorkdir = resolve(rawRepoWorkdir);

  // Fail closed before creating anything: the daemon may be running from an
  // app bundle or unrelated checkout, so its cwd is never source authority.
  await run('git', ['rev-parse', '--show-toplevel'], { cwd: repoWorkdir });
  const gitValue = async (cwd: string, args: string[]): Promise<string> => {
    const result = await run('git', args, { cwd }) as { stdout?: unknown };
    const value = String(result?.stdout ?? '').trim();
    if (!value) throw new Error('Worktree identity proof missing: Git returned no identity');
    return value;
  };
  const sourceCommonDir = await gitValue(repoWorkdir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const verifyTarget = async (): Promise<void> => {
    const root = await gitValue(worktreePath, ['rev-parse', '--show-toplevel']);
    const commonDir = await gitValue(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const gitDir = await gitValue(worktreePath, ['rev-parse', '--absolute-git-dir']);
    const actualBranch = await gitValue(worktreePath, ['symbolic-ref', '--short', 'HEAD']);
    if (resolve(root) !== resolve(worktreePath) || resolve(gitDir) === resolve(commonDir)
        || resolve(commonDir) !== resolve(sourceCommonDir) || actualBranch !== branch) {
      throw new Error('Worktree identity mismatch: requires exact linked worktree, source repository, and branch');
    }
  };

  if (pathExists(worktreePath)) {
    // An interrupted run is reusable only with exact project/branch proof.
    await verifyTarget();
    return;
  }
  // Freshness: a dispatch (especially the overnight `run --next` cron) must
  // branch from the CURRENT tip of the base ref, not whatever the local
  // remote-tracking ref happened to be at last fetch. `baseRef` is
  // `<remote>/<branch>` (e.g. origin/main); fetch that branch before carving
  // the worktree so the dispatched agent starts from up-to-date code. A fetch
  // failure (offline) is non-fatal — fall back to the local tracking ref.
  const slash = baseRef.indexOf('/');
  if (slash > 0) {
    const remote = baseRef.slice(0, slash);
    const branchName = baseRef.slice(slash + 1);
    try {
      await run('git', ['fetch', remote, branchName], { cwd: repoWorkdir });
    } catch {
      /* offline or no remote — branch from the local tracking ref */
    }
  }
  // git worktree add <path> -b <branch> <baseRef>. Every Git operation is
  // anchored to the dispatch's durable source-project binding; daemon cwd is
  // intentionally irrelevant because packaged apps launch from elsewhere.
  let reuseCreatedBranch = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await run('git', reuseCreatedBranch
        ? ['worktree', 'add', worktreePath, branch]
        : [
            'worktree', 'add',
            '--no-track',
            worktreePath,
            '-b', branch,
            baseRef,
          ], { cwd: repoWorkdir });
      await verifyTarget();
      return;
    } catch (error) {
      // Concurrent worktree creation briefly contends on the repository-wide
      // .git/config.lock while Git writes branch tracking metadata. The
      // checkout may already be complete even when that metadata write loses
      // the race. A path alone is never proof of the intended Git world.
      if (pathExists(worktreePath)) {
        await verifyTarget();
        return;
      }

      const details = error instanceof Error
        ? `${error.message}\n${String((error as Error & { stdout?: unknown }).stdout ?? '')}\n${String((error as Error & { stderr?: unknown }).stderr ?? '')}`
        : String(error);
      const transientConfigLock = /could not lock config file[\s\S]*\.git\/config[\s\S]*File exists|unable to write upstream branch configuration|\.git\/config\.lock/i.test(details);
      if (!transientConfigLock || attempt === maxAttempts) throw error;

      // Git creates the local branch before attempting to persist upstream
      // metadata. If that config write loses a race, retry by attaching the
      // worktree to the branch that now exists instead of asking `-b` to create
      // the same branch again.
      reuseCreatedBranch = true;
      const ceilingMs = Math.min(800, 100 * (2 ** (attempt - 1)));
      const delayMs = Math.max(25, Math.round(random() * ceilingMs));
      await sleep(delayMs);
    }
  }
}


/** Typed human-attention boundary; no ambient GitHub account is ever consulted. */
export class GitHubAppPublisherRequiredError extends Error {
  readonly code = 'GITHUB_APP_PUBLISHER_REQUIRED';
  readonly needsAttention = true;
  constructor() {
    super('GITHUB_APP_PUBLISHER_REQUIRED: needs attention. No authorized GitHub App publisher is wired; configure the publisher and its scoped credential. Completed local work and its worktree are preserved; no push or PR was attempted.');
    this.name = 'GitHubAppPublisherRequiredError';
  }
}

/**
 * Refuse publication until the scoped App publisher is actually implemented.
 * Design: a credential-mint helper alone is not a publication implementation.
 * @returns A typed rejection recorded by Conductor without losing produced work.
 */
export async function requireGitHubAppPublisher(): Promise<never> {
  throw new GitHubAppPublisherRequiredError();
}
