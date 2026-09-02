import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface SkillSyncGitPolicy {
  preserved: Map<string, string>;
  errors: Map<string, string>;
  gitManaged: boolean;
  checkParents(target: string): string | null;
}

function runGit(root: string, args: string[], input?: string) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', LC_ALL: 'C' });
  return spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
    env, encoding: 'utf8', input, timeout: 5_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function verifiedGitRoot(base: string): string | undefined {
  // A command failure cannot turn a Git worktree into a non-Git fallback.
  let candidate = base;
  while (true) {
    try {
      const marker = lstatSync(join(candidate, '.git'));
      if (marker.isSymbolicLink() || (!marker.isDirectory() && !marker.isFile())) throw Error('invalid Git worktree marker');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('unable to inspect Git worktree marker');
    }
    const next = dirname(candidate);
    if (next === candidate) return undefined;
    candidate = next;
  }
  const rootRead = runGit(candidate, ['rev-parse', '--show-toplevel']);
  try {
    if (rootRead.error || rootRead.status !== 0 || realpathSync(rootRead.stdout.trim()) !== realpathSync(candidate)) throw Error();
  } catch { throw Error('unable to verify the selected Git worktree'); }
  return candidate;
}

/** Shared entrypoint anchoring: only a proved non-Git cwd may stay projectless. */
export function skillSyncRepositoryRoot(cwd: string): string {
  const base = resolve(cwd);
  return verifiedGitRoot(base) ?? base;
}

/**
 * Inspect Git's index and its own sparse matcher before projecting runtime links.
 * This is read-only policy, not a checkout repair or a filesystem sandbox.
 * Unknown Git state never licenses a filesystem write.
 */
export function skillSyncGitPolicy(baseDir: string, targets: string[]): SkillSyncGitPolicy {
  const base = resolve(baseDir);
  const policy: SkillSyncGitPolicy = {
    preserved: new Map(), errors: new Map(), gitManaged: false,
    checkParents(target) {
      const rel = relative(base, resolve(target));
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return 'target is outside the selected skill-sync base';
      let parent = dirname(resolve(target));
      while (true) {
        try {
          const stat = lstatSync(parent);
          if (stat.isSymbolicLink()) return 'symlink ancestor is not a writable skill-sync boundary';
          if (!stat.isDirectory()) return 'non-directory ancestor is not a writable skill-sync boundary';
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'unable to inspect skill-sync ancestor';
        }
        if (parent === base) break;
        const next = dirname(parent);
        if (next === parent) return 'target ancestor escaped the selected skill-sync base';
        parent = next;
      }
      return null;
    },
  };
  if (targets.length === 0) return policy;
  const fail = (message: string) => { for (const target of targets) policy.errors.set(target, message); return policy; };
  for (const target of targets) {
    const reason = policy.checkParents(target);
    if (reason) policy.errors.set(target, reason);
  }

  let gitRoot: string | undefined;
  try { gitRoot = verifiedGitRoot(base); }
  catch { return fail('unable to verify the selected Git worktree; no links written'); }
  if (!gitRoot) return policy;
  policy.gitManaged = true;
  const run = (args: string[], input?: string) => runGit(gitRoot!, args, input);
  const index = run(['ls-files', '--cached', '-z']);
  if (index.error || index.status !== 0 || (index.stdout && !index.stdout.endsWith('\0'))) {
    return fail('unable to read bounded Git tracked paths; no links written');
  }
  const tracked = new Set(index.stdout.split('\0').filter(Boolean));
  const containingTracked = new Set(tracked);
  for (const path of tracked) {
    let parent = path;
    while (parent.includes('/')) { parent = parent.slice(0, parent.lastIndexOf('/')); containingTracked.add(parent); }
  }
  const relativeTargets = new Map(targets.map((target) => [target, relative(gitRoot!, resolve(target)).split(sep).join('/')]));
  for (const [target, path] of relativeTargets) {
    let ancestor = path;
    let protectedPath = containingTracked.has(path);
    while (!protectedPath && ancestor.includes('/')) {
      ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'));
      protectedPath = tracked.has(ancestor);
    }
    if (protectedPath) policy.preserved.set(target, 'Git-tracked path or directory preserved, including absent sparse mirrors');
  }
  const sparse = run(['config', '--bool', '--get', 'core.sparseCheckout']);
  if (sparse.error || ![0, 1].includes(sparse.status ?? -1)
    || (sparse.status === 0 && !['true', 'false'].includes(sparse.stdout.trim()))) {
    return fail('unable to verify sparse-checkout configuration; no links written');
  }
  if (sparse.status === 0 && sparse.stdout.trim() === 'true') {
    const cone = run(['config', '--bool', '--get', 'core.sparseCheckoutCone']);
    if (cone.error || ![0, 1].includes(cone.status ?? -1)
      || (cone.status === 0 && !['true', 'false'].includes(cone.stdout.trim()))) {
      return fail('unable to verify sparse-checkout mode; no links written');
    }
    if (cone.status === 1 || cone.stdout.trim() !== 'true') {
      // A directory link exposes every source descendant. Non-cone patterns can
      // include SKILL.md but exclude references below it, so a file probe cannot
      // attest the whole directory. Preserve these targets instead of inventing
      // a second Git pattern matcher or modifying the operator's sparse rules.
      for (const target of targets) if (!policy.preserved.has(target)) {
        policy.preserved.set(target, 'non-cone sparse directory projection is not proven; preserved');
      }
      return policy;
    }
    const probes = new Set([...relativeTargets.values()].map((path) => `${path}/SKILL.md`));
    const matched = run(['sparse-checkout', 'check-rules', '-z'], [...probes].join('\0') + '\0');
    if (matched.error || matched.status !== 0 || (matched.stdout && !matched.stdout.endsWith('\0'))) {
      return fail('unable to verify native sparse rules; no links written (Git check-rules required)');
    }
    const included = new Set(matched.stdout.split('\0').filter(Boolean));
    if ([...included].some((path) => !probes.has(path))) return fail('invalid native sparse-rule response; no links written');
    for (const [target, path] of relativeTargets) {
      if (!included.has(`${path}/SKILL.md`) && !policy.preserved.has(target)) {
        policy.preserved.set(target, 'outside the selected Git sparse-checkout rules; preserved');
      }
    }
  }
  return policy;
}
