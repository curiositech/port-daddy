import { describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, utimesSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  plistTargetsLegacyDaemon,
  describeResourceDir,
  diagnoseAgentRuntimeInstall,
  readPlistAsXml,
  assessSupervisionIntegrity,
  isPidAlive,
  scanRegistryDbFiles,
  countBunCrashSignatures,
  assessCrashSignature,
  readRecentBunCrashCount,
  candidateDaemonLogPaths,
  candidateMacDiagnosticReportPaths,
  parseMacDiagnosticReport,
  readRecentMacDiagnosticCrashReports,
  assessMacDiagnosticCrashReports,
  isCanonicalRuntimeTarget,
} from '../../cli/commands/diagnostics.js';
import { resolveDistributionRoot } from '../../shared/daemon-binary.js';

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

  // BUG 3 (2026-07-14 halt-mandate): the crux of the silent-death incident.
  // `brew services`/`launchctl` claimed Running:true PID 69626 while /health
  // returned nothing and no such process existed — and this exact case used to
  // return 'ok', so `pd doctor` was ALL GREEN during a live outage. Liveness
  // (a reachable /health) DOMINATES: a supervisor's "running" claim is a claim,
  // not a fact.
  test('BUG 3: one supervisor claims running BUT /health unreachable is CRITICAL (the brew lie)', () => {
    const a = assessSupervisionIntegrity({
      supervisors: [sup({ running: true, pid: 69626 })],
      daemonReachable: false,
      platform: 'darwin',
    });
    expect(a.severity).toBe('critical');
    expect(a.detail).toMatch(/DEAD OR WEDGED|unreachable/);
  });

  test('BUG 3: one supervisor running AND /health reachable stays ok (no false alarm)', () => {
    const a = assessSupervisionIntegrity({
      supervisors: [sup({ running: true, pid: 42 })],
      daemonReachable: true,
      platform: 'darwin',
    });
    expect(a.severity).toBe('ok');
  });
});

describe('countBunCrashSignatures / assessCrashSignature', () => {
  // 2026-07-07 investigation (issue #676): the compiled daemon segfaults
  // under Bun 1.2.21 (JSC GC crash family) under production-scale load.
  // Pinning to an older port-daddy release does NOT fix it — 3.23.0 and
  // 3.24.x compile against the identical pinned Bun toolchain, and both
  // were reproduced crashing under a concurrent-connection burst. This
  // check exists so `pd doctor` surfaces the crash-loop instead of staying
  // silent while launchd respawns through it.
  const CRASH_BANNER =
    'panic(main thread): Segmentation fault at address 0x0\n' +
    'oh no: Bun has crashed. This indicates a bug in Bun, not your code.\n';

  test('countBunCrashSignatures is 0 for a clean log', () => {
    expect(countBunCrashSignatures('daemon booted\nhealth ok\n')).toBe(0);
  });

  test('countBunCrashSignatures counts one banner per crash', () => {
    expect(countBunCrashSignatures(CRASH_BANNER)).toBe(1);
    expect(countBunCrashSignatures(CRASH_BANNER + 'booted again\n' + CRASH_BANNER)).toBe(2);
  });

  test('assessCrashSignature: zero crashes is ok', () => {
    const a = assessCrashSignature({ crashCount: 0 });
    expect(a.severity).toBe('ok');
  });

  test('assessCrashSignature: one crash is a warning naming issue #676', () => {
    const a = assessCrashSignature({ crashCount: 1, logPath: '/opt/homebrew/var/log/port-daddy.log' });
    expect(a.severity).toBe('warn');
    expect(a.detail).toContain('/opt/homebrew/var/log/port-daddy.log');
    expect(a.hint).toContain('#676');
  });

  test('assessCrashSignature: multiple crashes is CRITICAL but does not overstate a possibly-historical scan', () => {
    const a = assessCrashSignature({ crashCount: 4 });
    expect(a.severity).toBe('critical');
    expect(a.detail).toContain('crashed repeatedly');
    // Honesty (3.26.2): a log-tail scan (possibly unrotated) must NOT assert present-tense
    // "the daemon is crash-looping" as fact — it points at live uptime instead.
    expect(a.detail).not.toMatch(/is crash-looping/);
    expect(a.detail).toMatch(/pd status/);
  });

  test('assessCrashSignature hint says downgrading does not fix it', () => {
    const a = assessCrashSignature({ crashCount: 2 });
    expect(a.hint).toMatch(/does NOT fix/i);
  });

  // PR #879 review (copilot-pull-request-reviewer): a log-read failure was
  // reported as severity 'ok', which lets a permissions problem mask a real
  // crash-loop underneath it. "Unknown" must never read as "healthy".
  test('assessCrashSignature: a read error is WARN, never ok', () => {
    const a = assessCrashSignature({ crashCount: 0, readError: '/opt/homebrew/var/log/port-daddy.log: EACCES' });
    expect(a.severity).toBe('warn');
    expect(a.detail).toContain('EACCES');
    expect(a.detail).not.toMatch(/no bun native-crash signatures/i);
  });

  test('assessCrashSignature: a read error wins even if crashCount is set to something nonzero', () => {
    // Defensive: readError must always be checked first regardless of what
    // crashCount the caller happened to pass alongside it.
    const a = assessCrashSignature({ crashCount: 3, readError: 'boom' });
    expect(a.severity).toBe('warn');
  });
});

describe('readRecentBunCrashCount', () => {
  test('returns zero + null logPath when no candidate log exists', () => {
    const r = readRecentBunCrashCount(['/nonexistent/path/one.log', '/nonexistent/path/two.log']);
    expect(r.count).toBe(0);
    expect(r.logPath).toBeNull();
    expect(r.readError).toBeUndefined();
  });

  test('reads the first existing candidate and counts its crash banners', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-crashlog-'));
    try {
      const logPath = join(dir, 'port-daddy.log');
      writeFileSync(
        logPath,
        'boot ok\n' +
          'panic(main thread): Segmentation fault at address 0x0\n' +
          'oh no: Bun has crashed. This indicates a bug in Bun, not your code.\n',
      );
      const r = readRecentBunCrashCount(['/nonexistent/first.log', logPath]);
      expect(r.count).toBe(1);
      expect(r.logPath).toBe(logPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // PR #879 review: the original implementation did a full readFileSync then
  // sliced the tail in memory — expensive and memory-spiky against a large,
  // never-rotated log. Verify the bounded seek+read actually only sees the
  // TAIL of a file bigger than maxBytes (a crash banner near the head must
  // NOT be counted once it has scrolled out of the retained window).
  test('is bounded to the tail of a large log via seek, not a full read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-crashlog-bounded-'));
    try {
      const logPath = join(dir, 'port-daddy.log');
      const headBanner =
        'panic(main thread): Segmentation fault at address 0x0\n' +
        'oh no: Bun has crashed. This indicates a bug in Bun, not your code.\n';
      const padding = 'x'.repeat(1024).repeat(200); // ~200KB of filler
      const tailBanner =
        'panic(main thread): Segmentation fault at address 0x1\n' +
        'oh no: Bun has crashed. This indicates a bug in Bun, not your code.\n';
      writeFileSync(logPath, headBanner + padding + tailBanner);

      // maxBytes smaller than the head banner + padding — the head banner
      // must have scrolled out of the retained tail window.
      const r = readRecentBunCrashCount([logPath], 1024);
      expect(r.count).toBe(1);
      expect(r.logPath).toBe(logPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports readError (not a silent skip) when a candidate exists but cannot be read', () => {
    // Skip entirely when running as root (or a sandboxed CI uid-0 runner) —
    // chmod 0o000 does not block root's own reads, so the precondition this
    // test relies on would not hold.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const dir = mkdtempSync(join(tmpdir(), 'pd-crashlog-unreadable-'));
    const logPath = join(dir, 'port-daddy.log');
    try {
      writeFileSync(logPath, 'boot ok\n');
      chmodSync(logPath, 0o000);
      const r = readRecentBunCrashCount([logPath]);
      expect(r.logPath).toBeNull();
      expect(r.readError).toBeTruthy();
      expect(r.readError).toContain(logPath);
    } finally {
      chmodSync(logPath, 0o644);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('candidateDaemonLogPaths', () => {
  test('honors PORT_DADDY_DAEMON_LOG_PATHS for hermetic doctor gates', () => {
    const previous = process.env.PORT_DADDY_DAEMON_LOG_PATHS;
    try {
      process.env.PORT_DADDY_DAEMON_LOG_PATHS = '/tmp/a.log:/tmp/b.log';
      expect(candidateDaemonLogPaths('/Users/someone')).toEqual(['/tmp/a.log', '/tmp/b.log']);
    } finally {
      if (previous === undefined) delete process.env.PORT_DADDY_DAEMON_LOG_PATHS;
      else process.env.PORT_DADDY_DAEMON_LOG_PATHS = previous;
    }
  });

  test('includes the brew keg-relative log path the operator actually hits', () => {
    const paths = candidateDaemonLogPaths('/Users/someone');
    expect(paths).toContain('/opt/homebrew/var/log/port-daddy.log');
  });

  // PR #879 review (copilot-pull-request-reviewer): the JSDoc claimed this
  // covered the `port-daddy install` LaunchAgent's log location, but the
  // implementation never actually included it — a non-Homebrew install could
  // crash-loop and pd doctor would never see the banner.
  test('includes the distribution-root log path install-daemon.ts actually writes to', () => {
    const paths = candidateDaemonLogPaths('/Users/someone', '/opt/homebrew/opt/port-daddy/libexec');
    expect(paths).toContain('/opt/homebrew/opt/port-daddy/libexec/port-daddy.log');
  });

  test('omits the distribution-root path when none is supplied', () => {
    const paths = candidateDaemonLogPaths('/Users/someone');
    expect(paths.some((p) => p.endsWith('libexec/port-daddy.log'))).toBe(false);
  });
});

describe('macOS DiagnosticReports crash detection', () => {
  function makeHomeWithReports() {
    const home = mkdtempSync(join(tmpdir(), 'pd-diag-home-'));
    const reportDir = join(home, 'Library', 'Logs', 'DiagnosticReports');
    mkdirSync(reportDir, { recursive: true });
    return { home, reportDir };
  }

  function daemonCrashReport(overrides = {}) {
    return JSON.stringify({
      procName: 'port-daddy',
      procPath: '/opt/homebrew/Cellar/port-daddy/3.24.1/bin/port-daddy',
      coalitionName: 'homebrew.mxcl.port-daddy',
      exception: { type: 'EXC_BREAKPOINT', signal: 'SIGTRAP' },
      termination: { indicator: 'Trace/BPT trap: 5' },
      threads: [
        { name: 'JavaScriptCore libpas scavenger' },
        { name: 'Bun Pool' },
      ],
      ...overrides,
    });
  }

  test('candidateMacDiagnosticReportPaths finds recent port-daddy .ips reports and sorts newest first', () => {
    const { home, reportDir } = makeHomeWithReports();
    try {
      const old = join(reportDir, 'port-daddy-2026-07-01-010101.ips');
      const newer = join(reportDir, 'port-daddy-daemon-2026-07-08-020202.ips');
      writeFileSync(old, daemonCrashReport());
      writeFileSync(newer, daemonCrashReport({ procName: 'port-daddy-daemon' }));
      writeFileSync(join(reportDir, 'unrelated-2026-07-08.ips'), daemonCrashReport());

      const oldTime = new Date('2026-07-01T01:01:01Z');
      const newerTime = new Date('2026-07-08T02:02:02Z');
      utimesSync(old, oldTime, oldTime);
      utimesSync(newer, newerTime, newerTime);

      const paths = candidateMacDiagnosticReportPaths(home, Date.parse('2026-07-08T03:00:00Z'), 10 * 24 * 60 * 60 * 1000);
      expect(paths).toEqual([newer, old]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('candidateMacDiagnosticReportPaths honors PORT_DADDY_DIAGNOSTIC_REPORT_DIR', () => {
    const { home, reportDir } = makeHomeWithReports();
    const previous = process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR;
    try {
      const report = join(reportDir, 'port-daddy-2026-07-08-010101.ips');
      writeFileSync(report, daemonCrashReport());
      const reportTime = new Date('2026-07-08T01:01:01Z');
      utimesSync(report, reportTime, reportTime);
      process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR = reportDir;
      const paths = candidateMacDiagnosticReportPaths('/Users/not-this-home', Date.parse('2026-07-08T03:00:00Z'));
      expect(paths).toEqual([report]);
    } finally {
      if (previous === undefined) delete process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR;
      else process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('candidateMacDiagnosticReportPaths filters reports outside the age window', () => {
    const { home, reportDir } = makeHomeWithReports();
    try {
      const stale = join(reportDir, 'port-daddy-2026-06-01-010101.ips');
      writeFileSync(stale, daemonCrashReport());
      const staleTime = new Date('2026-06-01T01:01:01Z');
      utimesSync(stale, staleTime, staleTime);

      const paths = candidateMacDiagnosticReportPaths(home, Date.parse('2026-07-08T03:00:00Z'), 24 * 60 * 60 * 1000);
      expect(paths).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('readRecentMacDiagnosticCrashReports reports DiagnosticReports scan errors', () => {
    const home = mkdtempSync(join(tmpdir(), 'pd-doctor-home-'));
    const notADirectory = join(home, 'DiagnosticReports');
    const previous = process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR;
    try {
      writeFileSync(notADirectory, 'this is a file, not a directory');
      process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR = notADirectory;

      const result = readRecentMacDiagnosticCrashReports();

      expect(result.count).toBe(0);
      expect(result.readError).toContain('DiagnosticReports');
    } finally {
      if (previous === undefined) delete process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR;
      else process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('parseMacDiagnosticReport marks launchd-owned port-daddy reports as daemon-like Bun/JSC crashes', () => {
    const report = parseMacDiagnosticReport('/tmp/port-daddy.ips', daemonCrashReport());
    expect(report.daemonLike).toBe(true);
    expect(report.suspectedBunJsc).toBe(true);
    expect(report.exceptionType).toBe('EXC_BREAKPOINT');
    expect(report.exceptionSignal).toBe('SIGTRAP');
    expect(report.threadNames).toContain('JavaScriptCore libpas scavenger');
  });

  test('readRecentMacDiagnosticCrashReports ignores non-daemon process reports', () => {
    const { home, reportDir } = makeHomeWithReports();
    try {
      const daemonReport = join(reportDir, 'port-daddy-2026-07-08-010101.ips');
      const cliReport = join(reportDir, 'port-daddy-2026-07-08-020202.ips');
      writeFileSync(daemonReport, daemonCrashReport());
      writeFileSync(cliReport, daemonCrashReport({
        procName: 'port-daddy',
        procPath: '/Users/me/bin/port-daddy',
        coalitionName: 'com.apple.Terminal',
        threads: [{ name: 'main thread' }],
      }));

      const result = readRecentMacDiagnosticCrashReports([cliReport, daemonReport]);
      expect(result.count).toBe(1);
      expect(result.reports[0].path).toBe(daemonReport);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('assessMacDiagnosticCrashReports escalates repeated daemon crash reports to critical', () => {
    const report = parseMacDiagnosticReport('/tmp/port-daddy.ips', daemonCrashReport());
    const a = assessMacDiagnosticCrashReports({ count: 2, reports: [report, report] });
    expect(a.severity).toBe('critical');
    expect(a.detail).toContain('2 recent macOS daemon crash reports');
    expect(a.detail).toContain('Bun/JSC');
  });

  test('assessMacDiagnosticCrashReports treats DiagnosticReports read errors as warn, not ok', () => {
    const a = assessMacDiagnosticCrashReports({ count: 0, reports: [], readError: '/path/report.ips: EACCES' });
    expect(a.severity).toBe('warn');
    expect(a.detail).toContain('EACCES');
  });

  test('assessMacDiagnosticCrashReports reports no recent crashes as ok', () => {
    const a = assessMacDiagnosticCrashReports({ count: 0, reports: [] });
    expect(a.severity).toBe('ok');
  });
});

describe('compiled distribution root', () => {
  // Regression (3.26.2): a compiled `pd` whose `__dirname` collapses to `/` (so
  // `join(__dirname,'..','..')` is `/`) must NOT resolve the distribution root to `/`. That
  // made doctor print `resolvedRoot=/`, `expectedBinary=/dist/daemon/... (MISSING)` yet report
  // a GREEN "Resource directory" check, AND broke `pd setup` (it looked for `/node_modules/.bin/tsx`).
  // `/` now routes through execPath-based resolution like a bun-virtual path.
  test('resolveDistributionRoot("/") does not return "/" — routes through execPath', () => {
    const root = resolveDistributionRoot('/', {}, '/opt/homebrew/Cellar/port-daddy/3.26.2/bin/pd');
    expect(root).not.toBe('/');
    expect(root).toBe('/opt/homebrew/Cellar/port-daddy/3.26.2/bin');
  });

});

// BUG 3 (2026-07-14 halt-mandate): a launchd-claimed PID must be re-verified —
// `brew services` reported Running:true PID 69626 while no such process existed.
describe('isPidAlive', () => {
  test('the current process is alive', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test('a definitely-dead / invalid PID reads as dead', () => {
    // PID 0 and negatives are not real processes to us; a huge PID is vanishingly
    // unlikely to exist — both the exact failure the doctor must now catch.
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(2 ** 30)).toBe(false);
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

/**
 * `pd status` turns the control-plane verdict into its EXIT CODE, and that
 * verdict is built from the CANONICAL ~/.port-daddy files plus the canonical
 * launchd job. So the moment any env var redirects the CLI at a different
 * daemon, comparing that daemon's /health against canonical files produces a
 * false "control plane diverged" — a hard failure against a healthy daemon.
 *
 * These cases pin every redirect var INDEPENDENTLY, because the bug this
 * guards against was exactly one missing entry in the list: PORT_DADDY_PORT is
 * resolution step 1 in shared/daemon-discovery.ts (ahead of the daemon.port
 * file), so omitting it reintroduced the failure through the most common
 * redirect of all.
 */
describe('isCanonicalRuntimeTarget', () => {
  const REDIRECTS = [
    'PORT_DADDY_URL',
    'PORT_DADDY_SOCK',
    'PORT_DADDY_PORT',
    'PORT_DADDY_TCP_HOST',
    'PORT_DADDY_PREFIX',
    'PORT_DADDY_PID_FILE',
    'PORT_DADDY_PORT_FILE',
    'PD_HOME',
  ];

  function withEnv(overrides, fn) {
    const saved = {};
    for (const key of REDIRECTS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
      return fn();
    } finally {
      for (const key of REDIRECTS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  }

  test('a clean environment IS the canonical target', () => {
    expect(withEnv({}, isCanonicalRuntimeTarget)).toBe(true);
  });

  test.each(REDIRECTS)('%s alone makes the target non-canonical', (key) => {
    const value = key === 'PORT_DADDY_PORT' ? '9999' : '/tmp/pd-redirected';
    expect(withEnv({ [key]: value }, isCanonicalRuntimeTarget)).toBe(false);
  });

  test('an empty or whitespace-only override does not count as a redirect', () => {
    // Callers routinely export these as '' to mean "unset"; treating that as a
    // redirect would silently disable the verdict for canonical daemons.
    expect(withEnv({ PORT_DADDY_PORT: '' }, isCanonicalRuntimeTarget)).toBe(true);
    expect(withEnv({ PORT_DADDY_PID_FILE: '   ' }, isCanonicalRuntimeTarget)).toBe(true);
  });
});
