import { isBunCompiledRuntime } from '../../shared/daemon-binary.js';

const sourceNode = {
  versionsBun: undefined,
  importMetaUrl: 'file:///Users/dev/proj/cli.ts',
  errorStack: 'Error\n    at Object.<anonymous> (/Users/dev/proj/cli.ts:1:1)',
  execPath: '/usr/local/bin/node',
};

const sourceBun = {
  versionsBun: '1.3.14',
  importMetaUrl: 'file:///Users/dev/proj/cli.ts',
  errorStack: 'Error\n    at Object.<anonymous> (/Users/dev/proj/cli.ts:1:1)',
  execPath: '/Users/dev/.bun/bin/bun',
};

const compiledViaImportMeta = {
  versionsBun: '1.3.14',
  importMetaUrl: 'file:///$bunfs/root/pd',
  errorStack: 'Error\n    at attemptDaemonStart (/Users/builder/proj/cli/commands/daemon.ts:557:13)',
  execPath: '/opt/homebrew/Cellar/port-daddy/3.14.1/bin/pd',
};

const compiledViaStack = {
  versionsBun: '1.3.14',
  importMetaUrl: 'file:///Users/builder/proj/cli/commands/daemon.ts',
  errorStack: 'Error\n    at attemptDaemonStart (/$bunfs/root/pd:17120:23)',
  execPath: '/opt/homebrew/Cellar/port-daddy/3.14.1/bin/pd',
};

const compiledViaExecPath = {
  versionsBun: '1.3.14',
  importMetaUrl: 'file:///Users/builder/proj/cli/commands/daemon.ts',
  errorStack: 'Error\n    at attemptDaemonStart (/Users/builder/proj/cli/commands/daemon.ts:557:13)',
  execPath: '/opt/homebrew/Cellar/port-daddy/3.14.1/bin/pd',
};

describe('isBunCompiledRuntime — bun-compile bundle detection', () => {
  test('node without bun is never compiled', () => {
    expect(isBunCompiledRuntime(sourceNode)).toBe(false);
  });

  test('source-mode bun (bun run / bun test) is not compiled', () => {
    expect(isBunCompiledRuntime(sourceBun)).toBe(false);
  });

  test('detects compiled binary via /$bunfs/ in import.meta.url', () => {
    expect(isBunCompiledRuntime(compiledViaImportMeta)).toBe(true);
  });

  test('detects compiled binary via /$bunfs/ in error stack', () => {
    // This is the case where import.meta.url was inlined by the bundler.
    // Stack traces still reflect runtime paths, so we catch it.
    expect(isBunCompiledRuntime(compiledViaStack)).toBe(true);
  });

  test('detects compiled binary via execPath basename', () => {
    // Most pessimistic case: bundler inlined import.meta.url to build-machine
    // path AND something stripped the stack of bunfs frames. execPath is the
    // last-line defense — a compiled binary names itself, not `bun` or `node`.
    expect(isBunCompiledRuntime(compiledViaExecPath)).toBe(true);
  });

  test('strips .exe suffix on Windows execPath', () => {
    expect(isBunCompiledRuntime({
      versionsBun: '1.3.14',
      importMetaUrl: 'file:///C:/dev/proj/cli.ts',
      errorStack: 'Error\n    at Object.<anonymous>',
      execPath: 'C:\\Users\\dev\\.bun\\bin\\bun.exe',
    })).toBe(false);
  });

  test('windows path separator is recognized for compiled binary', () => {
    expect(isBunCompiledRuntime({
      versionsBun: '1.3.14',
      importMetaUrl: 'file:///C:/build/proj/cli.ts',
      errorStack: 'Error\n    at Object.<anonymous>',
      execPath: 'C:\\Program Files\\port-daddy\\pd.exe',
    })).toBe(true);
  });

  test('rejects empty signal bag (no bun version)', () => {
    expect(isBunCompiledRuntime({
      versionsBun: undefined,
      importMetaUrl: '',
      errorStack: '',
      execPath: '',
    })).toBe(false);
  });
});
