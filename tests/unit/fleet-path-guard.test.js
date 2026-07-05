// tests/unit/fleet-path-guard.test.js
//
// Path-containment guard (lib/fleet/path-guard.ts) for file sinks/triggers
// (ADR-0093). Regression tests for the merged file.ts path-traversal CRITICAL.

import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const guard = await import('../../lib/fleet/path-guard.js');
const { containPath, isContained, expandTokens, PathEscapeError } = guard;

describe('isContained — segment-safe prefix check', () => {
  test('child inside root', () => {
    expect(isContained('/home/usr', '/home/usr/notes/a.md')).toBe(true);
    expect(isContained('/home/usr', '/home/usr')).toBe(true);
  });
  test('sibling with shared prefix is NOT contained', () => {
    // the classic "/home/usr2 startsWith /home/usr" bug
    expect(isContained('/home/usr', '/home/usr2/secrets')).toBe(false);
  });
});

describe('expandTokens — deterministic with injected clock', () => {
  test('substitutes {date}/{time}/{iso}', () => {
    const now = new Date('2026-06-27T17:38:16.500Z');
    expect(expandTokens('~/notes/morning-{date}.md', now)).toBe('~/notes/morning-2026-06-27.md');
    expect(expandTokens('log-{time}.txt', now)).toBe('log-17-38-16.txt');
  });
});

describe('containPath — defeats path traversal', () => {
  const root = mkdtempSync(join(tmpdir(), 'pd-pathguard-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test('permits a normal path under the root', () => {
    const p = containPath('sub/dir/out.md', { roots: [root] });
    expect(isContained(root, p)).toBe(true);
  });

  // ATTACK: "path traversal in file output"
  test('defeats dotdot-traversal: ~/notes/../../../etc/passwd → throws', () => {
    expect(() => containPath('notes/../../../../../../etc/passwd', { roots: [root] })).toThrow(PathEscapeError);
  });

  test('defeats absolute-path-escape: /etc/shadow → throws', () => {
    expect(() => containPath('/etc/shadow', { roots: [root] })).toThrow(PathEscapeError);
  });

  test('defeats token-then-traversal: /{date}/../../etc → throws', () => {
    expect(() => containPath('{date}/../../../../etc/cron.d/evil', { roots: [root] })).toThrow(PathEscapeError);
  });

  // ATTACK: "symlink escape" — a pre-planted symlink in the prefix.
  test('defeats symlink-escape: symlinked dir pointing outside root → throws', () => {
    const escapeTarget = mkdtempSync(join(tmpdir(), 'pd-escape-'));
    const linkDir = join(root, 'link');
    symlinkSync(escapeTarget, linkDir);
    try {
      expect(() => containPath('link/out.md', { roots: [root] })).toThrow(PathEscapeError);
    } finally {
      rmSync(escapeTarget, { recursive: true, force: true });
    }
  });

  test('default roots are home/tmp/cwd; escapes to system dirs rejected', () => {
    // A bare absolute path outside home/tmp/cwd is rejected.
    expect(() => containPath('/etc/passwd')).toThrow(PathEscapeError);
    expect(() => containPath('/usr/local/bin/evil')).toThrow(PathEscapeError);
    // A path under home is accepted.
    const underHome = containPath('~/.port-daddy-test-xyz/out.md');
    expect(isContained(homedir(), underHome)).toBe(true);
    // tmpdir (CI fallback for the io-wiring test) is an allowed root.
    const underTmp = containPath(join(tmpdir(), 'pd-x', 'out.md'));
    expect(isContained(tmpdir(), underTmp)).toBe(true);
  });

  // ATTACK: persistence/credential write inside home (~/.ssh, LaunchAgents).
  test('defeats sensitive-subpath-write: ~/.ssh and LaunchAgents refused even inside home', () => {
    expect(() => containPath('~/.ssh/authorized_keys')).toThrow(PathEscapeError);
    expect(() => containPath('~/Library/LaunchAgents/eviltask.plist')).toThrow(PathEscapeError);
    expect(() => containPath('~/.aws/credentials')).toThrow(PathEscapeError);
  });
});
