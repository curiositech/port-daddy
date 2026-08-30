import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const archive = Buffer.from('signed FleetBar archive fixture');
const digest = createHash('sha256').update(archive).digest('hex');
const archiveName = 'PortDaddy-FleetBar-macOS-arm64.zip';
const installRoot = '/Users/test/Applications/Port Daddy';
const appPath = `${installRoot}/FleetBar.app`;
const staging = `${installRoot}/.fleetbar-update-fixed`;
const candidate = `${staging}/expanded/FleetBar.app`;

const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockMkdtempSync = jest.fn(() => staging);
const mockReadFileSync = jest.fn();
const mockRenameSync = jest.fn();
const mockRmSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockChmodSync = jest.fn();
const mockSpawnSync = jest.fn();

jest.unstable_mockModule('node:fs', () => ({
  chmodSync: mockChmodSync,
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  mkdtempSync: mockMkdtempSync,
  readFileSync: mockReadFileSync,
  renameSync: mockRenameSync,
  rmSync: mockRmSync,
  writeFileSync: mockWriteFileSync,
}));
jest.unstable_mockModule('node:os', () => ({ homedir: () => '/Users/test' }));
jest.unstable_mockModule('node:child_process', () => ({ spawnSync: mockSpawnSync }));

const originalFetch = globalThis.fetch;
const originalPlatform = process.platform;
const originalGetuid = process.getuid;

Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
Object.defineProperty(process, 'getuid', { configurable: true, value: () => 501 });

const { installFleetBarRelease } = await import('../../lib/fleetbar-release-installer.js');

function commandResult(stdout = '') {
  return { status: 0, stdout, stderr: '', error: undefined };
}

function successfulCommand(executable, args) {
  if (executable === '/usr/bin/plutil') {
    return commandResult(args[1] === 'CFBundleIdentifier' ? 'ai.portdaddy.FleetBar\n' : '3.30.5\n');
  }
  if (executable === '/usr/bin/codesign' && args[0] === '-dv') {
    return commandResult('Identifier=ai.portdaddy.FleetBar\nTeamIdentifier=P5H9P59X2M\n');
  }
  if (executable === '/usr/bin/codesign' && args[0] === '-dr') {
    return commandResult(
      'identifier "ai.portdaddy.FleetBar" and certificate leaf[subject.OU] = P5H9P59X2M and '
      + 'certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13]',
    );
  }
  return commandResult();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExistsSync.mockImplementation((path) => (
    path === appPath
    || path === `${candidate}/Contents/MacOS/FleetBar`
    || String(path).startsWith(`${appPath}.backup-`)
  ));
  mockSpawnSync.mockImplementation(successfulCommand);
  globalThis.fetch = jest.fn(async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from(String(url).endsWith('.sha256')
      ? `${digest}  ${archiveName}\n`
      : archive),
  }));
});

describe('FleetBar release install orchestration', () => {
  test('verifies, swaps, and relaunches the exact release with bounded I/O', async () => {
    const result = await installFleetBarRelease('3.30.5');

    expect(result).toMatchObject({ version: '3.30.5', appPath });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    for (const [, options] of globalThis.fetch.mock.calls) {
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(mockRenameSync).toHaveBeenCalledWith(appPath, expect.stringContaining('FleetBar.app.backup-3.30.5-'));
    expect(mockRenameSync).toHaveBeenCalledWith(candidate, appPath);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      '/bin/launchctl',
      ['bootout', 'gui/501', '/Users/test/Library/LaunchAgents/com.portdaddy.fleetbar.plist'],
      expect.objectContaining({ timeout: 60_000, killSignal: 'SIGKILL' }),
    );
    expect(mockSpawnSync).toHaveBeenCalledWith(
      '/bin/launchctl',
      ['kickstart', '-k', 'gui/501/com.portdaddy.fleetbar'],
      expect.objectContaining({ timeout: 60_000, killSignal: 'SIGKILL' }),
    );
    expect(mockRmSync).toHaveBeenLastCalledWith(staging, { recursive: true, force: true });
  });

  test('stops a partially launched replacement and restores the backup', async () => {
    mockSpawnSync.mockImplementation((executable, args) => {
      if (executable === '/bin/launchctl' && args[0] === 'kickstart') {
        return { status: 1, stdout: '', stderr: 'kickstart rejected', error: undefined };
      }
      return successfulCommand(executable, args);
    });

    await expect(installFleetBarRelease('3.30.5')).rejects.toThrow(/launchctl failed.*kickstart rejected/);

    const bootouts = mockSpawnSync.mock.calls.filter(([executable, args]) => (
      executable === '/bin/launchctl' && args[0] === 'bootout'
    ));
    expect(bootouts).toHaveLength(2);
    expect(mockRmSync).toHaveBeenCalledWith(appPath, { recursive: true, force: true });
    expect(mockRenameSync).toHaveBeenCalledWith(expect.stringContaining('FleetBar.app.backup-3.30.5-'), appPath);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      '/bin/launchctl',
      ['bootstrap', 'gui/501', '/Users/test/Library/LaunchAgents/com.portdaddy.fleetbar.plist'],
      expect.objectContaining({ timeout: 60_000 }),
    );
    expect(mockRmSync).toHaveBeenLastCalledWith(staging, { recursive: true, force: true });
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  Object.defineProperty(process, 'getuid', { configurable: true, value: originalGetuid });
});
