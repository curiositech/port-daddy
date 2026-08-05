import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';

const source = readFileSync(new URL('../../install-daemon.ts', import.meta.url), 'utf8');

describe('single-supervisor daemon installer', () => {
  test('macOS delegates resurrection to Homebrew and never emits a daemon plist', () => {
    expect(source).toContain("runCommand('brew', ['services', 'start', 'port-daddy'])");
    expect(source).toContain("export const BREW_DAEMON_LABEL = 'homebrew.mxcl.port-daddy'");
    expect(source).not.toContain('function generatePlist(');
    expect(source).not.toContain('function installBosun');
    expect(source).not.toContain('generateBosunPlist');
  });

  test('retired Port Daddy jobs are migration inputs, never current emitters', async () => {
    const { RETIRED_PORT_DADDY_LABELS } = await import('../../install-daemon.js');
    expect(RETIRED_PORT_DADDY_LABELS).toEqual([
      'com.portdaddy.daemon',
      'com.portdaddy.bosun',
      'com.erichowens.port-daddy',
    ]);
    expect(RETIRED_PORT_DADDY_LABELS).not.toContain('com.bosun.daemon');
    expect(source).toContain('cleanupRetiredMacOSJobs();');
  });

  test('freshness is a separate updater-only cadence job', async () => {
    const { generateFreshnessPlist } = await import('../../install-daemon.js');
    const plist = generateFreshnessPlist('/opt/homebrew/bin/pd');
    expect(plist).toContain('<string>self-update</string>');
    expect(plist).toContain('<string>--tick</string>');
    expect(plist).not.toContain('port-daddy-daemon');
    expect(plist).not.toContain('<key>KeepAlive</key>');
    expect(source).toContain("case 'install-freshness':");
    expect(source).not.toContain("case 'install-bosun':");
  });

  test('Linux uses one restarting systemd unit with JSC safe mode', async () => {
    const { generateSystemdUnit } = await import('../../install-daemon.js');
    const unit = generateSystemdUnit({
      mode: 'binary',
      program: '/opt/port-daddy/port-daddy-daemon',
      args: [],
      env: { PORT_DADDY_RESOURCE_DIR: '/opt/port-daddy' },
      binaryPath: '/opt/port-daddy/port-daddy-daemon',
      sourceServerPath: '/src/server.ts',
      sourceTsxPath: '/src/tsx',
      pathDirs: ['/opt/port-daddy'],
      reason: 'test',
    });
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('Environment=BUN_JSC_useConcurrentGC=0');
    expect(unit).toContain('Environment=BUN_JSC_useConcurrentJIT=0');
    expect(unit).not.toContain('bosun');
  });

  test('launchd XML helper carries the same JSC process-start map', async () => {
    const { jscSafeModeEnvXml } = await import('../../install-daemon.js');
    const xml = jscSafeModeEnvXml();
    expect(xml).toContain('<key>BUN_JSC_useConcurrentGC</key>');
    expect(xml).toContain('<key>BUN_JSC_useConcurrentJIT</key>');
  });
});
