import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { captureWorkspaceIdentity, sameWorkspaceIdentity, type WorkspaceIdentity } from './workspace-identity.js';
import type { SessionWorktreeContext } from './worktree-policy.js';

/** A private admission witness, not a caller-supplied repository authority. */
export interface ManagedSpawnWorktree {
  directory: WorkspaceIdentity | null;
  worktree: SessionWorktreeContext | null;
  gitRoot: WorkspaceIdentity | null;
  gitDir: WorkspaceIdentity | null;
  commonDir: WorkspaceIdentity | null;
}

export interface ManagedSpawnWorktreeReceipt {
  cwd: string | null;
  worktreeId: string | null;
  root: string | null;
}

/**
 * Run a bounded read-only Git probe without inherited repository selectors.
 * Design: only trusted, exact non-Git/detached outcomes receive special handling;
 * malformed metadata, timeouts, and cancellation remain explicit failures.
 * @param cwd Verified physical directory from which Git must resolve context.
 * @param args Fixed read-only Git arguments supplied by this module.
 * @param signal Lifecycle cancellation bound to the current admission or launch.
 * @returns Trimmed Git output, or rejection with the original failure as cause.
 */
function gitRead(cwd: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  // A daemon's inherited Git selectors must never redirect a target lookup.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
  return new Promise((accept, reject) => {
    execFile('git', args, {
      cwd, env, signal, timeout: 3_000, maxBuffer: 64 * 1024, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error) {
        // Only this exact trusted Git outcome means projectless. Corrupt Git
        // metadata, timeouts, cancellation and permission errors are refusals.
        if (!signal.aborted && 'code' in error && error.code === 128
          && stderr.trim() === 'fatal: not a git repository (or any of the parent directories): .git') {
          reject(Object.assign(new Error('Not a Git repository'), { code: 'SPAWN_NOT_GIT' }));
        } else if (!signal.aborted && 'code' in error && error.code === 1
          && args[0] === 'symbolic-ref' && stderr.trim() === '') {
          reject(Object.assign(new Error('Detached Git HEAD'), { code: 'SPAWN_DETACHED_HEAD' }));
        } else {
          reject(new Error('Could not verify the spawn target Git identity', { cause: error }));
        }
      } else {
        accept(stdout.trim());
      }
    });
  });
}

/**
 * Derive a workspace witness from an explicit physical target.
 * Design: undefined deliberately means no filesystem target, never daemon cwd.
 * @param workdir Owned absolute directory, or undefined for API-only projectless use.
 * @param signal Cancels Git probes before any managed session can be admitted.
 * @returns Physical directory and Git-root witnesses; non-Git world remains null.
 */
export async function captureManagedSpawnWorktree(
  workdir: string | undefined,
  signal: AbortSignal,
): Promise<ManagedSpawnWorktree> {
  signal.throwIfAborted();
  if (workdir === undefined) return { directory: null, worktree: null, gitRoot: null, gitDir: null, commonDir: null };
  const directory = captureWorkspaceIdentity(workdir);
  if (!directory) throw new Error('Spawn workdir must be an existing owned absolute directory');
  let root: string;
  try {
    root = await gitRead(directory.canonicalPath, ['rev-parse', '--show-toplevel'], signal);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'SPAWN_NOT_GIT') {
      if (!sameWorkspaceIdentity(workdir, directory)) throw new Error('Spawn directory changed during admission');
      return { directory, worktree: null, gitRoot: null, gitDir: null, commonDir: null };
    }
    throw error;
  }
  const gitRoot = captureWorkspaceIdentity(root);
  const gitDirPath = await gitRead(directory.canonicalPath, ['rev-parse', '--absolute-git-dir'], signal);
  const commonPath = await gitRead(directory.canonicalPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal);
  const gitDir = captureWorkspaceIdentity(gitDirPath);
  const commonDir = captureWorkspaceIdentity(commonPath);
  if (!gitRoot || !gitDir || !commonDir) throw new Error('Spawn Git directories could not be physically verified');
  const fromRoot = relative(gitRoot.canonicalPath, directory.canonicalPath);
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('../')) {
    throw new Error('Spawn directory is outside its reported Git worktree');
  }
  let branch: string | null;
  try {
    // symbolic-ref also works before the first commit; rev-parse HEAD does not.
    branch = await gitRead(directory.canonicalPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'SPAWN_DETACHED_HEAD') branch = null;
    else throw error;
  }
  signal.throwIfAborted();
  if (!sameWorkspaceIdentity(workdir, directory) || !sameWorkspaceIdentity(root, gitRoot)
    || !sameWorkspaceIdentity(gitDirPath, gitDir) || !sameWorkspaceIdentity(commonPath, commonDir)) {
    throw new Error('Spawn physical target changed during admission');
  }
  return {
    directory, gitRoot, gitDir, commonDir,
    worktree: {
      id: createHash('sha256').update(gitRoot.canonicalPath).digest('hex').slice(0, 8),
      root: gitRoot.canonicalPath,
      name: basename(gitRoot.canonicalPath),
      branch,
      isMain: gitDir.canonicalPath === commonDir.canonicalPath,
    },
  };
}

/**
 * Project the private physical witness into a compact binding receipt.
 * Design: this receipt is evidence for the spawner, not a caller's authority.
 * @param target Verified witness held by the private lifecycle.
 * @returns Canonical cwd, Git world identifier, and Git root (or explicit nulls).
 */
export function managedSpawnWorktreeReceipt(target: ManagedSpawnWorktree): ManagedSpawnWorktreeReceipt {
  return { cwd: target.directory?.canonicalPath ?? null, worktreeId: target.worktree?.id ?? null, root: target.worktree?.root ?? null };
}

/**
 * Recheck physical target and active exact session at binding and launch.
 * Design: the session getter runs after asynchronous Git probes so a stale
 * pre-await snapshot cannot authorize execution in a changed world.
 * @param target Original admission witness, never a caller-supplied world label.
 * @param getSession Reads the exact currently stored session; null means missing.
 * @param signal Lifecycle cancellation bounded by the managed operation timeout.
 * @returns Resolves only while physical and stored witnesses still agree.
 */
export async function verifyManagedSpawnWorktree(
  target: ManagedSpawnWorktree,
  getSession: () => Record<string, unknown> | null,
  signal: AbortSignal,
): Promise<void> {
  const current = await captureManagedSpawnWorktree(target.directory?.canonicalPath, signal);
  if (!isDeepStrictEqual(current, target)) throw new Error('Spawn target changed after session admission');
  // Read after the asynchronous physical check, not from a pre-await snapshot.
  const session = getSession();
  if (!session) throw new Error('Exact managed session is missing');
  if (session.status !== 'active') throw new Error('Exact managed session is no longer active');
  const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata as Record<string, unknown> : {};
  const expected = target.worktree;
  if (session.worktreeId !== (expected?.id ?? null)
    || !isDeepStrictEqual(metadata.worktree ?? null, expected)) {
    throw new Error('Managed session does not match the verified spawn worktree');
  }
  if (!isDeepStrictEqual(metadata.spawnWorkdir ?? null, target.directory)) {
    throw new Error('Managed session does not match the verified spawn directory');
  }
}
