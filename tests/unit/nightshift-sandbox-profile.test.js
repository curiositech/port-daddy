import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  emitSandboxProfile,
  wrapWithSandbox,
  assertSafeWorktreePath,
  FORBIDDEN_EXEC_BASENAMES,
} from '../../lib/nightshift/sandbox-profile.js';

describe('assertSafeWorktreePath', () => {
  test('accepts a normal nightshift worktree path under ~/coding/tmp', () => {
    expect(() =>
      assertSafeWorktreePath(join(homedir(), 'coding', 'tmp', 'nightshift', 'abc123')),
    ).not.toThrow();
  });

  test('rejects /tmp and /private/tmp', () => {
    expect(() => assertSafeWorktreePath('/tmp/foo')).toThrow(/\/tmp/);
    expect(() => assertSafeWorktreePath('/private/tmp/foo')).toThrow(/\/tmp/);
  });

  test('rejects paths outside $HOME', () => {
    expect(() => assertSafeWorktreePath('/etc/passwd')).toThrow(/\$HOME/);
    expect(() => assertSafeWorktreePath('/var/log/system.log')).toThrow(/\$HOME/);
  });

  test('rejects $HOME itself and root', () => {
    expect(() => assertSafeWorktreePath(homedir())).toThrow();
    expect(() => assertSafeWorktreePath('/')).toThrow();
  });

  test('rejects 1-level-under-home paths (too broad)', () => {
    expect(() => assertSafeWorktreePath(join(homedir(), 'coding'))).toThrow();
  });
});

describe('emitSandboxProfile', () => {
  const wt = join(homedir(), 'coding', 'tmp', 'nightshift', 'abc123');

  test('starts with version + deny default (the order matters for sandbox-exec)', () => {
    const profile = emitSandboxProfile({ worktreePath: wt });
    const lines = profile.split('\n');
    expect(lines[0]).toBe('(version 1)');
    expect(lines[1]).toBe('(deny default)');
  });

  test('grants write only inside the worktree', () => {
    const profile = emitSandboxProfile({ worktreePath: wt });
    // Should reference the worktree as a write subpath.
    expect(profile).toContain(`(allow file-write* (subpath "${wt}"))`);
    // Should NOT grant write to $HOME or /etc.
    expect(profile).not.toContain(`(allow file-write* (subpath "${homedir()}"))`);
    expect(profile).not.toContain(`(allow file-write* (subpath "/"))`);
    expect(profile).not.toContain(`(allow file-write* (subpath "/etc"))`);
  });

  test('grants read on port-daddy repo for context', () => {
    const profile = emitSandboxProfile({ worktreePath: wt });
    expect(profile).toMatch(/file-read\*.*port-daddy/);
  });

  test('grants read on system dirs needed by modern CLIs', () => {
    const profile = emitSandboxProfile({ worktreePath: wt });
    expect(profile).toContain('/usr/bin');
    expect(profile).toContain('/opt/homebrew');
    expect(profile).toContain('/System');
  });

  test('denies every forbidden binary by regex anchored on path component', () => {
    const profile = emitSandboxProfile({ worktreePath: wt });
    for (const bin of FORBIDDEN_EXEC_BASENAMES) {
      expect(profile).toContain(`(deny process-exec* (regex #"(^|/)${bin}$"))`);
    }
  });

  test('denies sudo, launchctl, tmutil, csrutil (specific high-value tools)', () => {
    const profile = emitSandboxProfile({ worktreePath: wt });
    expect(profile).toContain('sudo');
    expect(profile).toContain('launchctl');
    expect(profile).toContain('tmutil');
    expect(profile).toContain('csrutil');
  });

  test('honors extraReadPaths', () => {
    const extra = join(homedir(), 'coding', 'some-shared-dep');
    const profile = emitSandboxProfile({ worktreePath: wt, extraReadPaths: [extra] });
    expect(profile).toContain(`(allow file-read* (subpath "${extra}"))`);
  });

  test('quotes paths safely (no shell injection through worktree path)', () => {
    // A worktree path with a quote in it would be pathological but the
    // emitter must still escape it rather than producing broken Scheme.
    const evil = join(homedir(), 'coding', 'tmp', 'has"quote');
    const profile = emitSandboxProfile({ worktreePath: evil });
    // The literal quote in the path must be backslash-escaped in the output.
    expect(profile).toContain('has\\"quote');
  });

  test('emits a stable shape (golden-ish): line count is bounded', () => {
    // We don't lock the exact bytes (Node version differences in path APIs
    // could drift) but we do lock the shape: a small, finite number of
    // lines so we notice if the emitter starts ballooning.
    const profile = emitSandboxProfile({ worktreePath: wt });
    const lines = profile.split('\n').filter(Boolean);
    // Roughly: version + deny default + ~10 allow primitives + ~20 read
    // subpaths + 1 write + ~4 dev writes + ~25 deny exec = ~60-70 lines.
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.length).toBeLessThan(100);
  });
});

describe('wrapWithSandbox', () => {
  const wt = join(homedir(), 'coding', 'tmp', 'nightshift', 'abc123');

  test('wraps the inner command as `/usr/bin/sandbox-exec -p <profile> -- <cmd> <args...>`', () => {
    const wrapped = wrapWithSandbox(wt, 'claude', ['--dangerously-skip-permissions', '-p', 'do the thing']);
    expect(wrapped.command).toBe('/usr/bin/sandbox-exec');
    expect(wrapped.args[0]).toBe('-p');
    expect(typeof wrapped.args[1]).toBe('string');
    expect(wrapped.args[2]).toBe('--');
    expect(wrapped.args[3]).toBe('claude');
    expect(wrapped.args.slice(4)).toEqual(['--dangerously-skip-permissions', '-p', 'do the thing']);
  });

  test('the profile passed in argv is identical to emitSandboxProfile output', () => {
    const wrapped = wrapWithSandbox(wt, 'codex', ['exec', 'foo']);
    const direct = emitSandboxProfile({ worktreePath: wt });
    expect(wrapped.args[1]).toBe(direct);
    expect(wrapped.profile).toBe(direct);
  });

  test('refuses to wrap when worktreePath is under /tmp', () => {
    expect(() => wrapWithSandbox('/tmp/whatever', 'claude', [])).toThrow(/\/tmp/);
  });
});
