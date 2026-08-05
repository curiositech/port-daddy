/**
 * Regression: /setup/overview reported a healthy brew-supervised daemon as
 * "install unknown / binary missing" when it failed to scan Homebrew's
 * `homebrew.mxcl.port-daddy` job and hardcoded the binary candidate to
 * `<repoRoot>/dist/daemon`. That pinned the First-Run wizard open over every tab.
 * See docs/operations/daemon-and-supervision.md.
 */

import { describe, test, expect } from '@jest/globals';
import { daemonMode, resolveBinaryCandidate, DAEMON_LAUNCH_AGENT_LABELS } from '../../routes/setup.js';

describe('setup/overview daemon detection', () => {
  test('Homebrew is the only daemon supervisor label', () => {
    expect(DAEMON_LAUNCH_AGENT_LABELS).toEqual(['homebrew.mxcl.port-daddy']);
  });

  test('the brew LaunchAgent (pd start --foreground) classifies as binary, not unknown', () => {
    expect(daemonMode(['/opt/homebrew/opt/port-daddy/bin/pd', 'start', '--foreground'])).toBe('binary');
  });

  test('a tsx/source LaunchAgent still classifies as source', () => {
    expect(daemonMode(['node', '.../node_modules/.bin/tsx', 'server.ts'])).toBe('source');
  });

  test('no LaunchAgent → unknown (not a false positive)', () => {
    expect(daemonMode(null)).toBe('unknown');
    expect(daemonMode([])).toBe('unknown');
  });

  test('binary candidate is the actual launched binary when it exists', () => {
    // process.execPath is a real, absolute, existing path on every test box.
    const real = process.execPath;
    expect(resolveBinaryCandidate([real, 'start', '--foreground'], '/nonexistent/repo')).toBe(real);
  });

  test('binary candidate falls back to <repoRoot>/dist/daemon for source trees', () => {
    expect(resolveBinaryCandidate(null, '/repo')).toBe('/repo/dist/daemon');
    expect(resolveBinaryCandidate(['/does/not/exist/pd'], '/repo')).toBe('/repo/dist/daemon');
  });
});
