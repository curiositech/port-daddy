import { describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  plistTargetsLegacyDaemon,
  describeResourceDir,
  diagnoseAgentRuntimeInstall,
  readPlistAsXml,
  assessSupervisionIntegrity,
  resolveBosunBinary,
  scanRegistryDbFiles,
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

  // Regression coverage for the scoping fix flagged by skeptical
  // review: the prior whole-document regex would false-positive on
  // comment <string> values that merely mention "server.ts" in
  // English prose. Healthy binary-daemon plists must pass.

  test('does not false-positive on a comment mentioning server.ts', () => {
    // port-daddy install has shipped commentary like this before.
    // The check must not fail a healthy install for it.
    const plist = `<plist><dict>
      <key>ProgramArguments</key><array>
        <string>/usr/local/opt/port-daddy/dist/daemon/port-daddy-daemon</string>
      </array>
      <key>Comment</key>
      <string>Replaces the old server.ts launcher introduced in v3.x.</string>
    </dict></plist>`;
    expect(plistTargetsLegacyDaemon(plist)).toBe(false);
  });

  test('does not false-positive on "server.ts." followed by a period in prose', () => {
    // Period after server.ts in a sentence — old `(?![A-Za-z0-9])`
    // negative lookahead permitted this and would match incorrectly.
    const plist = `<plist><dict>
      <key>ProgramArguments</key><array>
        <string>/opt/port-daddy/dist/daemon/port-daddy-daemon</string>
      </array>
      <key>Note</key>
      <string>Migrated from server.ts. Do not edit by hand.</string>
    </dict></plist>`;
    expect(plistTargetsLegacyDaemon(plist)).toBe(false);
  });

  test('still catches a real legacy plist whose <string> value is /opt/.../server.ts', () => {
    const plist = `<plist><dict>
      <key>ProgramArguments</key><array>
        <string>/usr/local/bin/node</string>
        <string>/opt/port-daddy/server.ts</string>
      </array>
    </dict></plist>`;
    expect(plistTargetsLegacyDaemon(plist)).toBe(true);
  });

  test('handles <string> tags with attributes', () => {
    // Hypothetical attribute on the tag — pattern uses [^>]* to
    // tolerate this without breaking the value capture.
    const plist = `<string xml:space="preserve">/path/node_modules/.bin/tsx</string>`;
    expect(plistTargetsLegacyDaemon(plist)).toBe(true);
  });
});

describe('readPlistAsXml', () => {
  // macOS launchd accepts both XML and binary plists. A naive
  // `readFileSync(path, 'utf8')` on a binary plist produces garbage
  // that silently false-negatives plistTargetsLegacyDaemon. The
  // normalization step shells out to `plutil -convert xml1` first.

  test('returns XML contents unchanged when input is already XML', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-plist-xml-'));
    try {
      const path = join(dir, 'sample.plist');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<plist><dict><key>K</key><string>v</string></dict></plist>\n`;
      writeFileSync(path, xml);
      expect(readPlistAsXml(path)).toBe(xml);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Binary plist conversion requires `plutil`, which only ships on
  // macOS. Skip on other platforms rather than skip the whole file
  // — the XML path above is still meaningful coverage everywhere.
  const isDarwin = platform() === 'darwin';
  const darwinOnly = isDarwin ? test : test.skip;

  darwinOnly('normalizes a binary plist to XML via plutil', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-plist-binary-'));
    try {
      const xmlPath = join(dir, 'src.plist');
      const binPath = join(dir, 'bin.plist');
      writeFileSync(xmlPath, `<?xml version="1.0" encoding="UTF-8"?>
<plist><dict>
  <key>ProgramArguments</key>
  <array><string>/opt/port-daddy/server.ts</string></array>
</dict></plist>`);
      // Round-trip XML → binary via plutil.
      const convert = spawnSync('plutil', ['-convert', 'binary1', '-o', binPath, xmlPath]);
      expect(convert.status).toBe(0);
      const out = readPlistAsXml(binPath);
      expect(out).toContain('<?xml');
      expect(out).toContain('/opt/port-daddy/server.ts');
      // And the legacy detector should now fire correctly:
      expect(plistTargetsLegacyDaemon(out)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe('diagnoseAgentRuntimeInstall', () => {
  test('reports missing MCP and skill wiring with setup remediation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-agent-runtime-missing-'));
    try {
      const diagnosis = diagnoseAgentRuntimeInstall(dir);
      expect(diagnosis.mcpConfigured).toBe(false);
      expect(diagnosis.mcpHint).toContain('pd mcp install');
      expect(diagnosis.skillInstalled).toBe(false);
      expect(diagnosis.skillHint).toContain('pd setup');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports MCP and skill wiring when a local agent runtime is configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-agent-runtime-ready-'));
    try {
      const claudeDir = join(dir, '.claude');
      mkdirSync(join(claudeDir, 'skills', 'port-daddy-agent-skill'), { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        mcpServers: {
          'port-daddy': { command: 'pd', args: ['mcp'] },
        },
      }));
      writeFileSync(join(claudeDir, 'skills', 'port-daddy-agent-skill', 'SKILL.md'), '---\nname: port-daddy-agent-skill\n---\n');

      const diagnosis = diagnoseAgentRuntimeInstall(dir);
      expect(diagnosis.mcpConfigured).toBe(true);
      expect(diagnosis.mcpDetail).toContain('Claude Code');
      expect(diagnosis.skillInstalled).toBe(true);
      expect(diagnosis.skillDetail).toContain('Port Daddy skill present');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('assessSupervisionIntegrity', () => {
  // The crux: exactly ONE launchd job supervises the daemon and it is running.
  // The previous doctor looked only for the removed `com.portdaddy.daemon`
  // label and so was blind to every brew-supervised install.
  const sup = (over = {}) => ({ label: 'homebrew.mxcl.port-daddy', loaded: true, running: true, pid: 42, ...over });

  test('non-darwin platforms are skipped as ok', () => {
    const a = assessSupervisionIntegrity({ supervisors: [], daemonReachable: false, platform: 'linux' });
    expect(a.severity).toBe('ok');
  });

  test('exactly one supervisor, loaded and running, is ok', () => {
    const a = assessSupervisionIntegrity({ supervisors: [sup()], daemonReachable: true, platform: 'darwin' });
    expect(a.severity).toBe('ok');
    expect(a.detail).toContain('PID 42');
  });

  test('zero supervisors + daemon down is CRITICAL', () => {
    const a = assessSupervisionIntegrity({
      supervisors: [sup({ loaded: false, running: false, pid: null })],
      daemonReachable: false,
      platform: 'darwin',
    });
    expect(a.severity).toBe('critical');
  });

  test('zero supervisors but daemon reachable is a warning (unsupervised, works now)', () => {
    const a = assessSupervisionIntegrity({
      supervisors: [sup({ loaded: false, running: false, pid: null })],
      daemonReachable: true,
      platform: 'darwin',
    });
    expect(a.severity).toBe('warn');
  });

  test('supervisor loaded but not running, daemon reachable, is a warning (the silent-death precursor)', () => {
    const a = assessSupervisionIntegrity({
      supervisors: [sup({ running: false, pid: null })],
      daemonReachable: true,
      platform: 'darwin',
    });
    expect(a.severity).toBe('warn');
    expect(a.detail).toContain('UNSUPERVISED');
  });

  test('supervisor loaded but not running AND daemon unreachable is CRITICAL', () => {
    const a = assessSupervisionIntegrity({
      supervisors: [sup({ running: false, pid: null })],
      daemonReachable: false,
      platform: 'darwin',
    });
    expect(a.severity).toBe('critical');
  });

  test('two supervisors loaded is a warning (duplicate KeepAlive race)', () => {
    const a = assessSupervisionIntegrity({
      supervisors: [
        sup(),
        sup({ label: 'com.portdaddy.daemon', pid: 99 }),
      ],
      daemonReachable: true,
      platform: 'darwin',
    });
    expect(a.severity).toBe('warn');
    expect(a.detail).toContain('2 supervisors');
  });
});

describe('resolveBosunBinary', () => {
  test('reports non-existence without throwing for a binary-free root', () => {
    const r = resolveBosunBinary('/nonexistent/port-daddy-root');
    expect(r.exists).toBe(false);
    expect(r.binaryPath).toContain('pd-bosun');
  });
});

describe('scanRegistryDbFiles', () => {
  test('finds only port-registry*.db and ignores WAL/SHM sidecars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-dbscan-'));
    try {
      writeFileSync(join(dir, 'port-registry.db'), 'x');
      writeFileSync(join(dir, 'port-registry.db-wal'), 'x');
      writeFileSync(join(dir, 'port-registry.db-shm'), 'x');
      writeFileSync(join(dir, 'port-registry.backup.db'), 'x');
      writeFileSync(join(dir, 'usage.db'), 'x'); // unrelated DB — must be ignored
      const found = scanRegistryDbFiles(dir);
      expect(found.length).toBe(2);
      expect(found.some((f) => f.endsWith('port-registry.db'))).toBe(true);
      expect(found.some((f) => f.endsWith('port-registry.backup.db'))).toBe(true);
      expect(found.some((f) => f.includes('usage.db'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns empty for a missing directory', () => {
    expect(scanRegistryDbFiles('/nonexistent/dir/xyz')).toEqual([]);
  });
});
