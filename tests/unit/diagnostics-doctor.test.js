import { describe, expect, test } from '@jest/globals';
import {
  plistTargetsLegacyDaemon,
  describeResourceDir,
} from '../../cli/commands/diagnostics.js';

describe('plistTargetsLegacyDaemon', () => {
  // Why: existing installs from the tsx-server.ts era keep a stale plist
  // pointing at the source daemon, so `brew upgrade` silently leaves the
  // user on the old launcher. Doctor must detect both shapes.

  test('matches plists invoking the tsx loader', () => {
    const plist = `<plist><dict>
      <key>ProgramArguments</key><array>
        <string>/Users/me/coding/port-daddy/node_modules/.bin/tsx</string>
        <string>/Users/me/coding/port-daddy/server.ts</string>
      </array>
    </dict></plist>`;
    expect(plistTargetsLegacyDaemon(plist)).toBe(true);
  });

  test('matches plists whose argument is a bare server.ts', () => {
    const plist = `<plist><dict>
      <key>ProgramArguments</key><array>
        <string>/usr/local/bin/node</string>
        <string>/opt/port-daddy/server.ts</string>
      </array>
    </dict></plist>`;
    expect(plistTargetsLegacyDaemon(plist)).toBe(true);
  });

  test('does not match the binary-daemon plist', () => {
    const plist = `<plist><dict>
      <key>ProgramArguments</key><array>
        <string>/usr/local/opt/port-daddy/dist/daemon/port-daddy-daemon</string>
      </array>
    </dict></plist>`;
    expect(plistTargetsLegacyDaemon(plist)).toBe(false);
  });

  test('does not match unrelated paths containing server.ts as a substring', () => {
    // `server.tsx` and `server.test.ts` must NOT trip the regex — they
    // would falsely flag a binary-daemon plist that happens to mention
    // a test path nearby.
    const plistA = `<string>/some/path/server.tsx</string>`;
    const plistB = `<string>/some/path/server.test.ts</string>`;
    expect(plistTargetsLegacyDaemon(plistA)).toBe(false);
    expect(plistTargetsLegacyDaemon(plistB)).toBe(false);
  });

  test('handles empty input', () => {
    expect(plistTargetsLegacyDaemon('')).toBe(false);
  });
});

describe('describeResourceDir', () => {
  // Why: PORT_DADDY_RESOURCE_DIR is overloaded across env override,
  // Bun virtual paths, and the install-time plist value. Doctor's job
  // is to render those four passes side-by-side so divergence is
  // visible at a glance.

  test('honors an explicit env override', () => {
    const breakdown = describeResourceDir(
      '/usr/local/opt/port-daddy/lib',
      { PORT_DADDY_RESOURCE_DIR: '/custom/prefix' },
      '/usr/local/bin/port-daddy',
    );
    expect(breakdown.envOverride).toBe('/custom/prefix');
    expect(breakdown.resolvedRoot).toBe('/custom/prefix');
    // expectedBinary should now hang off the override root
    expect(breakdown.expectedBinary).toContain('/custom/prefix');
  });

  test('treats moduleDir as the root when not a bun virtual path', () => {
    const breakdown = describeResourceDir(
      '/usr/local/opt/port-daddy',
      {},
      '/usr/local/bin/node',
    );
    expect(breakdown.envOverride).toBeNull();
    expect(breakdown.moduleDirIsBunVirtual).toBe(false);
    expect(breakdown.resolvedRoot).toBe('/usr/local/opt/port-daddy');
  });

  test('flags a bun virtual moduleDir and falls back to exec layout', () => {
    // Bun's --compile single-binary places source under /$bunfs/ —
    // we cannot use that as the resource root; resolveDistributionRoot
    // walks up from execPath when it sees the marker.
    const breakdown = describeResourceDir(
      '/$bunfs/root/cli/commands',
      {},
      '/opt/port-daddy/dist/daemon/port-daddy-daemon',
    );
    expect(breakdown.moduleDirIsBunVirtual).toBe(true);
    expect(breakdown.resolvedRoot).toBe('/opt/port-daddy');
  });

  test('binaryExists reflects whether the resolved binary is on disk', () => {
    // No env override, moduleDir set to a real but binary-free path —
    // expectedBinary will land at moduleDir/dist/daemon/* which won't
    // exist. The flag must reflect that without throwing.
    const breakdown = describeResourceDir(
      '/nonexistent/port-daddy-root',
      {},
      '/usr/local/bin/node',
    );
    expect(breakdown.binaryExists).toBe(false);
  });
});
