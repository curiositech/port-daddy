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

function gitRead(cwd: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  // A daemon's inherited Git selectors must never redirect a target lookup.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
  return new Promise((accept, reject) => {
    execFile('git', ['rev-parse', ...args], {
      cwd, env, signal, timeout: 3_000, maxBuffer: 64 * 1024, encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error) {
        // Only this exact trusted Git outcome means projectless. Corrupt Git
        // metadata, timeouts, cancellation and permission errors are refusals.
        if (!signal.aborted && 'code' in error && error.code === 128
          && stderr.trim() === 'fatal: not a git repository (or any of the parent directories): .git') {
          reject(Object.assign(new Error('Not a Git repository'), { code: 'SPAWN_NOT_GIT' }));
        } else {
          reject(new Error('Could not verify the spawn target Git identity', { cause: error }));
        }
      } else {
        accept(stdout.trim());
      }
    });
  });
}

/** Derive from an explicit physical path; undefined deliberately means no filesystem target. */
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
    root = await gitRead(directory.canonicalPath, ['--show-toplevel'], signal);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'SPAWN_NOT_GIT') {
      if (!sameWorkspaceIdentity(workdir, directory)) throw new Error('Spawn directory changed during admission');
      return { directory, worktree: null, gitRoot: null, gitDir: null, commonDir: null };
    }
    throw error;
  }
  const gitRoot = captureWorkspaceIdentity(root);
  const gitDirPath = await gitRead(directory.canonicalPath, ['--absolute-git-dir'], signal);
  const commonPath = await gitRead(directory.canonicalPath, ['--path-format=absolute', '--git-common-dir'], signal);
  const gitDir = captureWorkspaceIdentity(gitDirPath);
  const commonDir = captureWorkspaceIdentity(commonPath);
  if (!gitRoot || !gitDir || !commonDir) throw new Error('Spawn Git directories could not be physically verified');
  const fromRoot = relative(gitRoot.canonicalPath, directory.canonicalPath);
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith('../')) {
    throw new Error('Spawn directory is outside its reported Git worktree');
  }
  const head = await gitRead(directory.canonicalPath, ['--abbrev-ref', 'HEAD'], signal);
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
      branch: head === 'HEAD' ? null : head,
      isMain: gitDir.canonicalPath === commonDir.canonicalPath,
    },
  };
}

export function managedSpawnWorktreeReceipt(target: ManagedSpawnWorktree): ManagedSpawnWorktreeReceipt {
  return { cwd: target.directory?.canonicalPath ?? null, worktreeId: target.worktree?.id ?? null, root: target.worktree?.root ?? null };
}

/** Recheck both the physical target and the exact stored session, before binding. */
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
