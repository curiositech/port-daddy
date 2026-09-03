import { afterEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync as realSpawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratchRoot = join(homedir(), 'coding', 'tmp');
const temporary: string[] = [];
const sourceReads: string[] = [];
let afterSourceRead: ((path: string) => void) | undefined;
const brew = jest.fn(() => ({ status: 1, stdout: '', stderr: '' }));
jest.unstable_mockModule('node:child_process', () => ({ spawnSync: brew }));
jest.unstable_mockModule('node:fs', () => ({
  ...fs,
  readFileSync: (path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    const bytes = (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args);
    if (typeof path === 'string' && /(?:AGENT\.md|agent\.config\.json)$/.test(path)) {
      sourceReads.push(path);
      afterSourceRead?.(path);
    }
    return bytes;
  },
}));
const { installPilotAgents, loadPilotSource, resolvePilotSourceDir, pilotRenderTargets } = await import('../../lib/pilot-agent-render.ts');
const { parseInstallArguments } = await import('../../scripts/install-pilot-agents.ts');
const { createPilotTargetExecutor } = await import('../../lib/pilot-agent-targets.ts');

const config = { id: 'port-daddy-pilot', name: 'Pilot fixture', description: 'Synthetic source fixture' };
const prompt = (marker: string) => `Documentation\n--- BEGIN SYSTEM PROMPT ---\n${marker}\n--- END SYSTEM PROMPT ---\n`;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function temporaryDir(): string {
  fs.mkdirSync(scratchRoot, { recursive: true });
  const path = fs.mkdtempSync(join(scratchRoot, 'pd-pilot-source-test-'));
  temporary.push(path);
  return path;
}
function source(path: string, marker = 'CURRENT_SOURCE'): string {
  fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(join(path, 'AGENT.md'), prompt(marker));
  fs.writeFileSync(join(path, 'agent.config.json'), JSON.stringify(config));
  return path;
}
function fixture() {
  const directory = temporaryDir();
  const current = source(join(directory, 'current source'));
  const prefix = join(directory, 'brew');
  source(join(prefix, 'share/port-daddy/agents/port-daddy-pilot'), 'OLD_PACKAGE_SOURCE');
  const base = join(directory, 'target');
  fs.mkdirSync(base);
  return { directory, current, prefix, base };
}
function seedRetained(base: string): string {
  const stale = join(base, '.codex/agents/port-daddy-pilot.md');
  fs.mkdirSync(dirname(stale), { recursive: true });
  fs.writeFileSync(stale, 'port-daddy-pilot retained cleanup sentinel');
  return stale;
}
function snapshot(path: string): unknown {
  if (!fs.existsSync(path)) return null;
  if (fs.statSync(path).isFile()) return fs.readFileSync(path).toString('base64');
  return Object.fromEntries(fs.readdirSync(path).sort().map(name => [name, snapshot(join(path, name))]));
}

/** Actual entrypoint with a non-forwarding pre-import boundary; no real Brew, home, network or provider. */
function cli(f: ReturnType<typeof fixture>, args: string[], control?: { probe: string; violations: string[] }) {
  const ledger = join(f.directory, 'ledger.json');
  const preload = join(f.directory, 'boundary.cjs');
  fs.writeFileSync(preload, `
const fs = require('node:fs');
const cp = require('node:child_process');
const os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');
const events = []; const violations = [];
const write = fs.writeFileSync.bind(fs);
const forbidden = kind => (...args) => { violations.push(kind); throw new Error('FORBIDDEN_' + kind); };
globalThis.fetch = forbidden('fetch');
for (const [name, keys] of [['http', ['request','get']], ['https', ['request','get']], ['net', ['connect','createConnection']], ['tls', ['connect']], ['dgram', ['createSocket']]]) {
  const mod = require('node:' + name); for (const key of keys) mod[key] = forbidden(name + '.' + key);
}
require('node:net').Socket.prototype.connect = forbidden('socket.connect');
require('node:net').Server.prototype.listen = forbidden('server.listen');
os.homedir = forbidden('homedir');
cp.spawnSync = (command, argv) => {
  if (command === 'brew' && JSON.stringify(argv) === ' ["--prefix"]'.trim()) {
    events.push('brew'); return { status: 0, stdout: ${JSON.stringify(f.prefix + '\n')}, stderr: '' };
  }
  return forbidden('child.spawnSync')();
};
for (const key of ['exec','execSync','execFile','execFileSync','spawn','fork']) cp[key] = forbidden('child.' + key);
const descriptors = new Map();
const open = fs.openSync.bind(fs);
const close = fs.closeSync.bind(fs);
const targetRoot = require('node:path').resolve(process.env.PD_PILOT_TEST_TARGET);
const inside = (path) => {
  const full = require('node:path').resolve(String(path));
  return full === targetRoot || full.startsWith(targetRoot + '/');
};
fs.openSync = (path, flags, ...rest) => {
  const writing = typeof flags === 'number' ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) : /[wa+]/.test(flags);
  if (writing && !inside(path)) return forbidden('write-outside-target')();
  const fd = open(path, flags, ...rest);
  descriptors.set(fd, path);
  return fd;
};
fs.closeSync = (fd) => { const result = close(fd); descriptors.delete(fd); return result; };
for (const key of ['writeFileSync','mkdirSync','unlinkSync','rmSync','truncateSync','chmodSync','symlinkSync']) {
  const original = fs[key].bind(fs);
  fs[key] = (path, ...rest) => {
    const actual = typeof path === 'number' ? descriptors.get(path) : path;
    if (actual === undefined || !inside(actual)) return forbidden('write-outside-target')();
    if (key === 'symlinkSync' && !inside(rest[0])) return forbidden('write-outside-target')();
    return original(path, ...rest);
  };
}
for (const key of ['renameSync','linkSync','copyFileSync']) {
  const original = fs[key].bind(fs);
  fs[key] = (from, to, ...rest) => {
    if (!inside(from) || !inside(to)) return forbidden('write-outside-target')();
    return original(from, to, ...rest);
  };
}
for (const key of ['writeSync','ftruncateSync','fchmodSync','fsyncSync']) {
  const original = fs[key].bind(fs);
  fs[key] = (fd, ...rest) => {
    if (!descriptors.has(fd) || !inside(descriptors.get(fd))) return forbidden('write-outside-target')();
    return original(fd, ...rest);
  };
}
syncBuiltinESMExports();
process.on('exit', () => write(${JSON.stringify(ledger)}, JSON.stringify({ events, violations })));
`);
  // Compile the actual source modules in-process. A runtime TS loader opens
  // its own IPC socket, which would contradict this entrypoint's zero-I/O guard.
  const ts = require('typescript');
  const compiled = join(f.directory, 'compiled');
  for (const relative of ['scripts/install-pilot-agents.ts', 'lib/pilot-agent-render.ts', 'lib/pilot-agent-targets.ts']) {
    const target = join(compiled, relative.replace(/\.ts$/, '.js'));
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, ts.transpileModule(fs.readFileSync(join(root, relative), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText);
  }
  fs.writeFileSync(join(compiled, 'package.json'), '{"type":"module"}');
  const entry = control ? ['--input-type=module', '-e', control.probe] : [join(compiled, 'scripts/install-pilot-agents.js'), ...args];
  const result = realSpawnSync(process.execPath, [
    '--require', preload, ...entry,
  ], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    env: { PATH: '/usr/bin:/bin', PD_PILOT_TEST_TARGET: f.base, TSX_DISABLE_CACHE: '1', PD_URL: 'https://forbidden.invalid', PORT_DADDY_URL: 'http://127.0.0.1:1', PORT_DADDY_DISABLE_KEYCHAIN: '1' },
  });
  expect(result.error).toBeUndefined();
  expect(fs.existsSync(ledger)).toBe(true);
  const record = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  expect(record.violations).toEqual(control?.violations ?? []);
  return { ...result, events: record.events as string[] };
}

afterEach(() => {
  afterSourceRead = undefined;
  sourceReads.length = 0;
  brew.mockReset().mockReturnValue({ status: 1, stdout: '', stderr: '' });
  for (const path of temporary.splice(0)) fs.rmSync(path, { recursive: true });
});

describe('Pilot selected source and captured provenance', () => {
  test('explicit source wins before Brew; no selection preserves package-first discovery', () => {
    const f = fixture();
    brew.mockReturnValue({ status: 0, stdout: f.prefix + '\n', stderr: '' });
    expect(resolvePilotSourceDir(f.directory, f.current)).toBe(fs.realpathSync(f.current));
    expect(brew).not.toHaveBeenCalled();
    expect(resolvePilotSourceDir(f.directory)).toBe(fs.realpathSync(join(f.prefix, 'share/port-daddy/agents/port-daddy-pilot')));
    expect(brew).toHaveBeenCalledTimes(1);
  });
  test('incomplete default package falls back to checkout; missing defaults return null', () => {
    const f = fixture();
    fs.unlinkSync(join(f.prefix, 'share/port-daddy/agents/port-daddy-pilot/agent.config.json'));
    brew.mockReturnValue({ status: 0, stdout: f.prefix, stderr: '' });
    const checkout = source(join(f.directory, 'agents/port-daddy-pilot'));
    expect(resolvePilotSourceDir(f.directory)).toBe(checkout);
    expect(resolvePilotSourceDir(join(f.directory, 'missing'))).toBeNull();
  });
  test.each(['', ' ', 'missing', 'AGENT.md', 'agent.config.json'])('invalid explicit source %s never probes Brew', entry => {
    const f = fixture();
    let selected = entry === '' || entry === ' ' ? entry : f.current;
    if (entry === 'missing') selected = join(f.directory, 'missing');
    else if (entry.includes('.')) fs.unlinkSync(join(f.current, entry));
    expect(() => resolvePilotSourceDir(f.directory, selected)).toThrow();
    expect(brew).not.toHaveBeenCalled();
  });
  test('provenance uses exact captured bytes once, not a later reread', () => {
    const f = fixture();
    const original = fs.readFileSync(join(f.current, 'AGENT.md'));
    afterSourceRead = path => { if (path.endsWith('/AGENT.md')) fs.writeFileSync(path, prompt('LATER_SOURCE')); };
    const result = installPilotAgents({ sourceDir: f.current, baseDir: f.base });
    expect(result.errors).toEqual([]);
    expect(result.provenance?.agentSha256).toBe(sha(original));
    expect(sourceReads.filter(path => path.endsWith('/AGENT.md'))).toHaveLength(1);
    expect(sourceReads.filter(path => path.endsWith('/agent.config.json'))).toHaveLength(1);
    for (const target of result.written) {
      expect(fs.readFileSync(target.path, 'utf8')).toContain('CURRENT_SOURCE');
      expect(fs.readFileSync(target.path, 'utf8')).not.toContain('LATER_SOURCE');
    }
  });
  test('physical source alias and boundary whitespace remain exact; old loader contract survives', () => {
    const f = fixture();
    const physical = source(join(f.directory, ' source '));
    const alias = join(f.directory, 'alias');
    fs.symlinkSync(physical, alias);
    const loaded = loadPilotSource(alias);
    expect(loaded.config).toEqual(config);
    expect(loaded.system).toBe('CURRENT_SOURCE');
    expect(loaded.provenance).toEqual({ sourceDir: physical, agentPath: join(physical, 'AGENT.md'), configPath: join(physical, 'agent.config.json'), agentSha256: sha(prompt('CURRENT_SOURCE')), configSha256: sha(JSON.stringify(config)) });
  });
  test('config fingerprint and renderer input are the same captured bytes', () => {
    const f = fixture();
    const original = fs.readFileSync(join(f.current, 'agent.config.json'));
    afterSourceRead = path => { if (path.endsWith('/agent.config.json')) fs.writeFileSync(path, JSON.stringify({ ...config, description: 'LATER_CONFIG' })); };
    const result = installPilotAgents({ sourceDir: f.current, baseDir: f.base });
    expect(result.errors).toEqual([]);
    expect(result.provenance?.configSha256).toBe(sha(original));
    expect(sourceReads.filter(path => path.endsWith('/agent.config.json'))).toHaveLength(1);
    for (const target of result.written) {
      expect(fs.readFileSync(target.path, 'utf8')).toContain(config.description);
      expect(fs.readFileSync(target.path, 'utf8')).not.toContain('LATER_CONFIG');
    }
  });
  test('special source files refuse without a blocking read', () => {
    const f = fixture(); const path = join(f.current, 'AGENT.md');
    fs.unlinkSync(path);
    expect(realSpawnSync('/usr/bin/mkfifo', [path], { timeout: 1000 }).status).toBe(0);
    const before = snapshot(f.base);
    const result = installPilotAgents({ sourceDir: f.current, baseDir: f.base });
    expect(result.errors[0].error).toContain('regular');
    expect(sourceReads).toEqual([]); expect(snapshot(f.base)).toEqual(before);
  });
  test.each(['null', '[]', '{}', '{', JSON.stringify({ ...config, id: '../outside' }), JSON.stringify({ ...config, description: 42 })])('bad config %s fails before writes or cleanup', content => {
    const f = fixture(); seedRetained(f.base); const before = snapshot(f.base);
    fs.writeFileSync(join(f.current, 'agent.config.json'), content);
    const result = installPilotAgents({ sourceDir: f.current, baseDir: f.base });
    expect(result.errors).toHaveLength(1); expect(result.written).toEqual([]); expect(result.cleaned).toEqual([]);
    expect(snapshot(f.base)).toEqual(before);
  });
  test.each(['AGENT.md', 'agent.config.json'])('preview hash rejects changed %s before cleanup', file => {
    const f = fixture(); seedRetained(f.base); const before = snapshot(f.base);
    const preview = installPilotAgents({ sourceDir: f.current, baseDir: f.base, dryRun: true });
    expect(snapshot(f.base)).toEqual(before);
    const { agentSha256, configSha256 } = preview.provenance!;
    fs.appendFileSync(join(f.current, file), '\n');
    const result = installPilotAgents({ sourceDir: f.current, baseDir: f.base, expectedSource: { agentSha256, configSha256 } });
    expect(result.errors[0].error).toContain('source changed'); expect(result.written).toEqual([]); expect(result.cleaned).toEqual([]);
    expect(snapshot(f.base)).toEqual(before);
  });
  test.each([null, {}, { agentSha256: 'a'.repeat(64) }, { agentSha256: 'A'.repeat(64), configSha256: 'a'.repeat(64) }])('malformed library pin %j is zero-write', expectedSource => {
    const f = fixture(); seedRetained(f.base); const before = snapshot(f.base);
    const result = installPilotAgents({ sourceDir: f.current, baseDir: f.base, expectedSource: expectedSource as never });
    expect(result.errors).toHaveLength(1); expect(sourceReads).toEqual([]); expect(snapshot(f.base)).toEqual(before);
  });
});

describe('actual standalone installer entrypoint', () => {
  test.each([
    ['fetch', "try { await fetch('https://forbidden.invalid'); } catch {}"],
    ['homedir', "import {homedir} from 'node:os'; try { homedir(); } catch {}"],
    ['child.execFileSync', "import {execFileSync} from 'node:child_process'; try { execFileSync('security', []); } catch {}"],
    ['write-outside-target', "import {writeFileSync} from 'node:fs'; try { writeFileSync('/forbidden-target', 'no'); } catch {}"],
    ['write-outside-target', "import {openSync} from 'node:fs'; try { openSync('/forbidden-target', 'w'); } catch {}"],
    ...['renameSync', 'linkSync', 'copyFileSync'].map(key => ['write-outside-target', `import * as fs from 'node:fs'; try { fs.${key}('/forbidden-source', '/forbidden-target'); } catch {}`]),
    ...['writeSync', 'ftruncateSync', 'fchmodSync', 'fsyncSync', 'writeFileSync'].map(key => ['write-outside-target', `import * as fs from 'node:fs'; const fd=fs.openSync('/dev/null', 'r'); try { fs.${key}(fd, ${key === 'writeSync' || key === 'writeFileSync' ? "'blocked'" : '0'}); } catch {} finally { fs.closeSync(fd); }`]),
  ])('independent ledger detects swallowed forbidden %s calls', (kind, probe) => {
    const f = fixture(); const before = snapshot(f.base);
    const control = cli(f, [], { probe, violations: [kind] });
    expect(control.status).toBe(0); expect(control.events).toEqual([]); expect(snapshot(f.base)).toEqual(before);
  });
  test('explicit current source renders all five formats and hashes; a second pinned apply is unchanged', () => {
    const f = fixture();
    const args = ['--source-dir', f.current, '--base-dir', f.base];
    const first = cli(f, args);
    expect(first.status).toBe(0); expect(first.events).toEqual([]);
    expect(first.stdout).toContain(sha(prompt('CURRENT_SOURCE')));
    expect(first.stdout).toContain(sha(JSON.stringify(config)));
    const targets = pilotRenderTargets(f.base, config, 'CURRENT_SOURCE');
    expect(targets).toHaveLength(5);
    for (const target of targets) expect(fs.readFileSync(target.path, 'utf8')).toBe(target.content);
    const before = snapshot(f.base);
    const second = cli(f, [...args, '--expect-agent-sha256', sha(prompt('CURRENT_SOURCE')), '--expect-config-sha256', sha(JSON.stringify(config))]);
    expect(second.status).toBe(0); expect(second.events).toEqual([]);
    expect(second.stdout.match(/\(unchanged\)/g)).toHaveLength(5);
    expect(snapshot(f.base)).toEqual(before);
  });
  test('omitted selection uses the synthetic package source, never a real Brew child', () => {
    const f = fixture(); const result = cli(f, ['--base-dir', f.base]);
    expect(result.status).toBe(0); expect(result.events).toEqual(['brew']);
    for (const target of pilotRenderTargets(f.base, config, 'OLD_PACKAGE_SOURCE')) expect(fs.readFileSync(target.path, 'utf8')).toBe(target.content);
  });
  test('dry-run and help do not mutate targets or invoke home defaults', () => {
    const f = fixture(); seedRetained(f.base); const before = snapshot(f.base);
    expect(cli(f, ['--source-dir', f.current, '--base-dir', f.base, '--dry-run']).status).toBe(0);
    const help = cli(f, ['--help']); expect(help.status).toBe(0); expect(help.events).toEqual([]);
    expect(snapshot(f.base)).toEqual(before);
  });
  test.each([
    ['--unknown'], ['unexpected'], ['--base-dir'], ['--source-dir'], ['--source-dir', '--dry-run'],
    ['--dry-run', '--dry-run'], ['--base-dir', ''], ['--source-dir', ' '], ['--base-dir=target'],
    ['--base-dir', 'target', '--base-dir', 'second'], ['--source-dir', 'source', '--source-dir', 'second'],
    ['--expect-agent-sha256', 'a'.repeat(64)], ['--expect-config-sha256', 'a'.repeat(64)],
    ['--expect-agent-sha256', 'bad', '--expect-config-sha256', 'a'.repeat(64)],
    ['--help', '--dry-run'],
    ['--uninstall'], ['--uninstall', '--uninstall'], ['--recover', '-bad'],
    ['--recover', '-'.repeat(36)], ['--recover', '11111111-1111-4111-8111-111111111111'],
    ['--expect-target-sha256', 'A'.repeat(64)], ['--expect-target-sha256', 'a'.repeat(64), '--expect-target-sha256', 'b'.repeat(64)],
  ])('bad arguments %j fail before discovery, home lookup or writes', (...args) => {
    const f = fixture(); seedRetained(f.base); const before = snapshot(f.base);
    const result = cli(f, args);
    expect(result.status).toBe(1); expect(result.events).toEqual([]); expect(snapshot(f.base)).toEqual(before);
  });
  test.each(['AGENT.md', 'agent.config.json'])('missing explicit %s does not fall back to valid package', file => {
    const f = fixture(); seedRetained(f.base); const before = snapshot(f.base);
    fs.unlinkSync(join(f.current, file));
    const result = cli(f, ['--source-dir', f.current, '--base-dir', f.base]);
    expect(result.status).toBe(1); expect(result.events).toEqual([]); expect(snapshot(f.base)).toEqual(before);
  });
  test('wrong paired pin preserves all existing targets and stale cleanup files', () => {
    const f = fixture(); seedRetained(f.base); const before = snapshot(f.base);
    const result = cli(f, ['--source-dir', f.current, '--base-dir', f.base, '--expect-agent-sha256', 'a'.repeat(64), '--expect-config-sha256', sha(JSON.stringify(config))]);
    expect(result.status).toBe(1); expect(result.events).toEqual([]); expect(snapshot(f.base)).toEqual(before);
  });
  test('parser preserves exact path spelling and requires paired pins', () => {
    expect(parseInstallArguments(['--source-dir', ' source ', '--base-dir', ' target '])).toMatchObject({ sourceDir: ' source ', baseDir: ' target ' });
    expect(() => parseInstallArguments(['--expect-agent-sha256', 'a'.repeat(64), '--expect-agent-sha256', 'b'.repeat(64)])).toThrow('Duplicate');
  });

  test('a reviewed target digest binds an apply, and drift produces a zero-write refusal', () => {
    const f = fixture();
    const args = ['--source-dir', f.current, '--base-dir', f.base];
    const preview = cli(f, [...args, '--dry-run']);
    expect(preview.status).toBe(0);
    expect(snapshot(f.base)).toEqual({});
    const digest = preview.stdout.match(/Target preview SHA-256: ([a-f0-9]{64})/)![1];
    const apply = cli(f, [...args, '--expect-target-sha256', digest]);
    expect(apply.status).toBe(0);
    expect(apply.stdout).toContain('complete;');
    const nextPreview = cli(f, [...args, '--dry-run']);
    const nextDigest = nextPreview.stdout.match(/Target preview SHA-256: ([a-f0-9]{64})/)![1];
    fs.writeFileSync(pilotRenderTargets(f.base, config, 'CURRENT_SOURCE')[0].path, 'Later user edit');
    const before = snapshot(f.base);
    const refused = cli(f, [...args, '--expect-target-sha256', nextDigest]);
    expect(refused.status).toBe(1);
    expect(snapshot(f.base)).toEqual(before);
  });

  test('actual uninstall removes only managed outputs and reports its removals', () => {
    const f = fixture();
    const args = ['--source-dir', f.current, '--base-dir', f.base];
    expect(cli(f, args).status).toBe(0);
    const targets = pilotRenderTargets(f.base, config, 'CURRENT_SOURCE');
    const removed = cli(f, [...args, '--uninstall']);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain('Removed 5 target(s)');
    expect(targets.every(t => !fs.existsSync(t.path))).toBe(true);
  });

  test('actual recovery consumes an exact recorded handle and rolls back only the interrupted outputs', () => {
    const f = fixture();
    const loaded = loadPilotSource(f.current);
    const request = { baseDir: f.base, id: config.id, source: loaded.provenance, targets: pilotRenderTargets(f.base, loaded.config, loaded.system) };
    let links = 0;
    const executor = createPilotTargetExecutor({ ...fs, linkSync: ((...args: Parameters<typeof fs.linkSync>) => {
      if (++links === 2) throw Object.assign(new Error('fixture interruption'), { code: 'EIO' });
      return fs.linkSync(...args);
    }) } as typeof fs);
    const plan = executor.preview(request);
    const interrupted = executor.apply(plan, plan.digest);
    expect(interrupted.outcome).toBe('partial');
    const recovered = cli(f, ['--source-dir', f.current, '--base-dir', f.base, '--recover', interrupted.recovery!.runId]);
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toContain('recovered;');
    expect(recovered.stdout).toContain('Removed 1 target(s)');
    expect(request.targets.every(t => !fs.existsSync(t.path))).toBe(true);
  });
});
