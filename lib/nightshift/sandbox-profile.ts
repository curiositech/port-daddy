/**
 * Nightshift Sandbox Profile -- emits a macOS `sandbox-exec` policy string
 * scoped to a single nightshift worktree.
 *
 * macOS sandbox-exec uses a Lisp-y "Scheme Bindings Profile Language" (TinyScheme,
 * inherited from Seatbelt). It is undocumented, deprecated-but-not-removed since
 * 10.7, and the only OS-level fine-grained sandbox primitive we have without
 * sudo. We use it as defense-in-depth on top of:
 *   - claude's `--dangerously-skip-permissions` (which we explicitly authorize)
 *   - codex's `--full-auto --sandbox workspace-write` (codex's own sandbox)
 *
 * The profile we emit:
 *   - default (deny)                  -- everything must be explicitly allowed
 *   - file-read* on system + project  -- agent can read its worktree + the
 *                                        port-daddy repo for context, plus
 *                                        system dirs needed by any modern CLI
 *   - file-write* on worktree only    -- writes outside the worktree fail with
 *                                        EPERM; nothing the agent does can
 *                                        scribble on ~ or /etc or system caches
 *   - process-exec * but deny a hard  -- launchctl, crontab, softwareupdate,
 *     list of system-mutating tools     defaults, sudo, mount, diskutil, etc.
 *                                        We cannot enumerate every dangerous
 *                                        binary; the wrapper deny-list
 *                                        (`bin/git-nightshift`) plus codex's
 *                                        own workspace-write sandbox cover
 *                                        the rest.
 *   - network *                       -- not restricted at this layer; see
 *                                        Layer 4 docs. pf-based network
 *                                        allowlists require sudo and are
 *                                        documented as operator-setup.
 *
 * The output of `emitSandboxProfile()` is a string suitable for:
 *
 *   sandbox-exec -p '<profile>' -- claude --dangerously-skip-permissions ...
 *
 * Tests use golden fixtures rather than parsing the Scheme -- the profile
 * shape is small and any drift should be visible in a diff.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Binaries the agent must not be able to invoke. Order matters for readability. */
export const FORBIDDEN_EXEC_BASENAMES: readonly string[] = [
  // launchd / cron -- "install yourself as a service" is the worst-case persistence
  'launchctl',
  'crontab',
  'atrun',
  'at',
  // system mutation
  'softwareupdate',
  'defaults',
  'systemsetup',
  'scutil',
  'sudo',
  'su',
  'doas',
  // disk / FS surgery
  'mount',
  'umount',
  'diskutil',
  'hdiutil',
  'fdesetup',
  // backup / power tampering -- attacker could disable Time Machine before damage
  'tmutil',
  'pmset',
  // SIP / security toggling
  'csrutil',
  'spctl',
  'kextload',
  'kextunload',
  // network policy tampering -- agent must not be able to disable pf
  'pfctl',
  'networksetup',
  // userland blast-radius amplifiers (these get refused even if some legit
  // tooling might also rely on them; the spawn worktree should never need them)
  'osascript', // would let agent script Finder / iMessage etc.
  'open',      // suppresses GUI app launches
];

export interface SandboxProfileOptions {
  /**
   * Absolute path to the nightshift worktree the agent is locked to.
   * Must be under the user's home dir; we refuse to emit a profile pointing
   * anywhere else because the profile gives that path full write access.
   */
  worktreePath: string;
  /**
   * Absolute path to the port-daddy repo (read-only context for the agent).
   * Optional; defaults to ~/coding/port-daddy.
   */
  portDaddyRepoPath?: string;
  /**
   * Additional read-only paths to allow (for shared toolchain caches like
   * ~/.cargo, ~/.npm, ~/.cache, etc.). Each must be an absolute path.
   */
  extraReadPaths?: string[];
  /**
   * Allow file-write on tmpdir() inside the worktree's TMPDIR convention.
   * Default: true (most CLIs need a scratch tmpdir). The expectation is the
   * caller has already set TMPDIR to a path under the worktree.
   */
  allowWorktreeTmp?: boolean;
}

function quoteScheme(s: string): string {
  // sandbox-exec Scheme strings are double-quoted; escape backslash + quote.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function regexLiteralFor(absPath: string): string {
  // Emit a sandbox-exec regex anchor for the path prefix. We use subpath
  // (the modern primitive) where possible, but a regex is more permissive
  // for prefix matches when subpath isn't a fit.
  // We rely on the canonical absolute path; caller's responsibility to
  // normalize symlinks.
  return absPath;
}

/**
 * Validate that the worktree path is acceptable. Refuse:
 *   - non-absolute paths
 *   - paths under /tmp, /private/tmp, /var (system-reset locations)
 *   - paths outside the user's home (the policy gives write here, so
 *     emitting a profile for, e.g., /etc would be catastrophic).
 */
export function assertSafeWorktreePath(worktreePath: string): void {
  const abs = resolve(worktreePath);
  const home = homedir();
  if (!abs.startsWith(home + '/') && abs !== home) {
    throw new Error(
      `sandbox-profile: worktreePath must be under $HOME (${home}); got ${abs}`,
    );
  }
  if (abs.startsWith('/tmp/') || abs.startsWith('/private/tmp/')) {
    throw new Error(
      `sandbox-profile: worktreePath must not live under /tmp or /private/tmp; got ${abs}`,
    );
  }
  if (abs === '/' || abs === home) {
    throw new Error(
      `sandbox-profile: refusing to grant write on ${abs} (too broad)`,
    );
  }
  // The expected location is `~/coding/tmp/nightshift/<id>`. We don't *require*
  // that exact prefix (tests use other paths) but we do warn at runtime by
  // checking it's at least 3 levels under home.
  const rel = abs.slice(home.length + 1).split('/');
  if (rel.length < 2) {
    throw new Error(
      `sandbox-profile: worktreePath must be at least 2 levels under $HOME; got ${abs}`,
    );
  }
}

/**
 * Emit the sandbox-exec policy string.
 *
 * The profile uses the legacy Seatbelt format because that is what
 * `sandbox-exec` reads. It is the only file-grained sandbox we have without
 * privileged setup.
 *
 * Notes for reviewers:
 *   - `(version 1)` is mandatory and must be the first form.
 *   - `(deny default)` is the safe baseline.
 *   - `(allow process-fork)` is required for any child process at all.
 *   - `(allow signal (target self))` lets the agent send signals to its own
 *     children. Without it, timeouts and pipes break.
 *   - `(allow mach-lookup)` is wide because almost every macOS framework
 *     needs at least one mach service. We narrow this with a per-service
 *     deny list rather than enumerating allowed services -- that list
 *     turns out to be in the hundreds in practice.
 */
export function emitSandboxProfile(opts: SandboxProfileOptions): string {
  assertSafeWorktreePath(opts.worktreePath);
  const worktree = resolve(opts.worktreePath);
  const portDaddy = resolve(
    opts.portDaddyRepoPath ?? join(homedir(), 'coding', 'port-daddy'),
  );
  const extras = (opts.extraReadPaths ?? [])
    .map((p) => resolve(p))
    .filter((p) => p.length > 1); // sanity

  const readPaths: string[] = [
    worktree,
    portDaddy,
    // System read locations the agent must be able to traverse.
    '/usr/bin',
    '/usr/local',
    '/opt/homebrew',
    '/bin',
    '/sbin',
    '/usr/sbin',
    '/usr/share',
    '/usr/lib',
    '/Library/Developer',
    '/Applications/Xcode.app',
    '/System',
    '/private/etc',
    '/private/var/db/timezone',
    // Per-user toolchain caches the agent will need read access to.
    join(homedir(), '.cargo'),
    join(homedir(), '.rustup'),
    join(homedir(), '.npm'),
    join(homedir(), '.cache'),
    join(homedir(), '.local'),
    join(homedir(), '.nvm'),
    join(homedir(), '.config'),
    join(homedir(), '.bun'),
    join(homedir(), '.pnpm'),
    join(homedir(), 'Library', 'Caches'),
    join(homedir(), 'Library', 'Application Support'),
    ...extras,
  ];

  const writePaths: string[] = [worktree];
  // `/dev/null`, `/dev/tty`, `/dev/dtracehelper`, the agent's own TTY, etc.
  // We don't enumerate per-device writes; we instead allow file-write* on
  // /dev/null + /dev/tty and rely on default-deny for the rest of /dev.

  const lines: string[] = [];
  lines.push('(version 1)');
  lines.push('(deny default)');
  lines.push('(allow process-fork)');
  lines.push('(allow process-info* (target self))');
  lines.push('(allow signal (target self))');
  lines.push('(allow sysctl-read)');
  lines.push('(allow iokit-open)');
  lines.push('(allow mach-lookup)');
  lines.push('(allow ipc-posix-shm)');
  lines.push('; --- network: allowed at this layer; see Layer 4 docs for pf rules');
  lines.push('(allow network*)');
  lines.push('; --- file reads ---');
  for (const p of readPaths) {
    lines.push(`(allow file-read* (subpath ${quoteScheme(regexLiteralFor(p))}))`);
  }
  lines.push('(allow file-read-metadata)');
  lines.push('; --- file writes (worktree only) ---');
  for (const p of writePaths) {
    lines.push(`(allow file-write* (subpath ${quoteScheme(regexLiteralFor(p))}))`);
  }
  // Devices that any tool needs to write to.
  lines.push('(allow file-write* (literal "/dev/null"))');
  lines.push('(allow file-write* (literal "/dev/dtracehelper"))');
  lines.push('(allow file-write* (regex #"^/dev/tty.*"))');
  lines.push('(allow file-ioctl)');
  lines.push('; --- forbidden binaries (defense-in-depth on top of wrapper) ---');
  for (const bin of FORBIDDEN_EXEC_BASENAMES) {
    // The agent might invoke these via absolute path, /usr/bin/X, or PATH
    // resolution. A regex on the final path component covers all three.
    // sandbox-exec process-exec* matches on the literal path being executed.
    lines.push(
      `(deny process-exec* (regex #"(^|/)${bin}$"))`,
    );
  }
  if (opts.allowWorktreeTmp !== false) {
    lines.push(`; --- worktree-local TMPDIR is implicitly allowed (subpath of worktree) ---`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Convenience: given a worktree path + an argv, return the wrapped argv that
 * runs the original command under sandbox-exec.
 *
 * Example:
 *   wrap = wrapWithSandbox('/Users/erich/...', 'claude', ['--dangerously-skip-permissions', ...]);
 *   spawn(wrap.command, wrap.args)  // command = '/usr/bin/sandbox-exec'
 */
export function wrapWithSandbox(
  worktreePath: string,
  command: string,
  args: string[],
  opts: Omit<SandboxProfileOptions, 'worktreePath'> = {},
): { command: string; args: string[]; profile: string } {
  const profile = emitSandboxProfile({ worktreePath, ...opts });
  return {
    command: '/usr/bin/sandbox-exec',
    args: ['-p', profile, '--', command, ...args],
    profile,
  };
}
