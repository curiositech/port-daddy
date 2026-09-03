import { afterAll, describe, expect, test } from '@jest/globals';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const scratch = path.join(os.homedir(), 'coding', 'tmp');
fs.mkdirSync(scratch, { recursive: true });
const fixture = fs.mkdtempSync(path.join(scratch, 'note-storage-fixture-'));
const canonicalHome = path.join(fixture, 'fake-home');
const canonicalRoot = path.join(canonicalHome, '.port-daddy');
const sources = new Map([
  ['note', fs.readFileSync(new URL('../../lib/note-encryption.ts', import.meta.url), 'utf8')],
  ['paths', fs.readFileSync(new URL('../../shared/paths.ts', import.meta.url), 'utf8')],
]);
const compiled = new Map([...sources].map(([key, source]) => [key, ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText]));
let sequence = 0;
afterAll(() => fs.rmSync(fixture, { recursive: true, force: true }));

/** Execute the real source and shared path resolver with only OS/Keychain adapters. */
function harness(options = {}) {
  const root = options.root ?? path.join(fixture, `scope-${++sequence}`);
  const fakeHome = options.canonicalHome ?? canonicalHome;
  const env = {
    ...(options.defaultRoot ? {} : { PD_HOME: root }),
    PORT_DADDY_DISABLE_KEYCHAIN: options.keychainEnabled ? '0' : '1',
  };
  const calls = [];
  const keychainCalls = [];
  const fsAdapter = new Proxy(fs, {
    get(target, name) {
      if (name in (options.fsOverrides ?? {})) return options.fsOverrides[name];
      const value = target[name];
      if (typeof value !== 'function') return value;
      return (...args) => { calls.push({ name, path: args[0] }); return value(...args); };
    },
  });
  const keychain = {
    available: () => { keychainCalls.push('available'); return !!options.keychainEnabled; },
    loadSecret: () => { keychainCalls.push('load'); return options.keychainSecret ?? null; },
    saveSecret: () => { keychainCalls.push('save'); return !!options.keychainEnabled; },
  };
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const module = { exports: {} };
    const sandbox = {
      module, exports: module.exports, Buffer,
      process: { env, platform: process.platform, getuid: () => options.uid ?? process.getuid?.() },
      console: { error() {}, log() {}, warn() {} },
      require(id) {
        if (id === 'node:fs' || id === 'fs') return fsAdapter;
        if (id === 'node:os' || id === 'os') return { ...os, homedir: () => fakeHome };
        if (id === './keychain.js') return { keychain, KEYCHAIN_SERVICE: 'fixture-only' };
        if (id === '../shared/paths.js') return load('paths');
        if (['node:crypto', 'node:path', 'path'].includes(id)) return require(id);
        throw new Error(`Unexpected import: ${id}`);
      },
    };
    vm.runInNewContext(compiled.get(name), sandbox, { filename: `${name}.cjs` });
    cache.set(name, module.exports);
    return module.exports;
  }
  const api = load('note');
  return { root, env, calls, keychainCalls, create: (opts = { requireMasterKey: true }) => api.createNoteEncryption(opts) };
}

function writeKey(root, contents = crypto.randomBytes(32), mode = 0o600) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(root, 'master.key'), contents, { mode });
  return contents;
}

describe('scoped note master-key storage', () => {
  test('uses real shared PD_HOME and never reads the canonical key for a private scope', () => {
    const h = harness();
    expect(h.create().isEnabled()).toBe(true);
    expect(fs.readFileSync(path.join(h.root, 'master.key'))).toHaveLength(32);
    expect(h.calls.filter(c => typeof c.path === 'string' && c.path.startsWith(canonicalRoot))).toEqual([]);
    expect(h.keychainCalls).toEqual([]);
    expect(fs.statSync(h.root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(h.root, 'master.key')).mode & 0o777).toBe(0o600);
  });

  test('fresh module restart reuses the same fixture key and decrypts old wraps', () => {
    const first = harness();
    const a = first.create();
    const sessionKey = a.generateSessionKey();
    const wrapped = a.wrapSessionKey(sessionKey, 'fixture:repo');
    const before = fs.readFileSync(path.join(first.root, 'master.key'));
    const b = harness({ root: first.root }).create();
    expect(b.unwrapSessionKey(wrapped, 'fixture:repo')).toEqual(sessionKey);
    expect(fs.readFileSync(path.join(first.root, 'master.key'))).toEqual(before);
  });

  test('another explicit root cannot unwrap the first root session key', () => {
    const a = harness().create();
    const wrapped = a.wrapSessionKey(a.generateSessionKey());
    expect(() => harness().create().unwrapSessionKey(wrapped)).toThrow(/master key mismatch/i);
  });

  test('custom root with Keychain enabled refuses before master-key or Keychain access', () => {
    const h = harness({ keychainEnabled: true, keychainSecret: 'ab'.repeat(32) });
    expect(() => h.create()).toThrow(/PORT_DADDY_DISABLE_KEYCHAIN|scoped.*keychain/i);
    expect(h.keychainCalls).toEqual([]);
    expect(h.calls.filter(c => typeof c.path === 'string' && c.path.endsWith('master.key'))).toEqual([]);
  });

  test('an explicitly canonical root retains the ordinary Keychain path', () => {
    const h = harness({ root: canonicalRoot, keychainEnabled: true, keychainSecret: 'ab'.repeat(32) });
    expect(h.create().isEnabled()).toBe(true);
    expect(h.keychainCalls).toContain('load');
  });

  test('unset PD_HOME retains canonical Keychain behavior using a fake adapter', () => {
    const h = harness({ defaultRoot: true, keychainEnabled: true, keychainSecret: 'cd'.repeat(32) });
    expect(h.create().isEnabled()).toBe(true);
    expect(h.keychainCalls).toContain('load');
  });

  test.each(['', 'ab', 'not-hex', 'ab'.repeat(31), 'ab'.repeat(33)])('invalid existing Keychain value is not replaced (%p)', (keychainSecret) => {
    const h = harness({ defaultRoot: true, keychainEnabled: true, keychainSecret });
    expect(() => h.create()).toThrow(/invalid.*keychain.*key/i);
    expect(h.keychainCalls).toEqual(['load']);
  });

  test('invalid existing canonical file key is not regenerated', () => {
    const home = path.join(fixture, `canonical-malformed-${++sequence}`);
    const root = path.join(home, '.port-daddy');
    const before = writeKey(root, Buffer.from('malformed fixture'));
    const h = harness({ defaultRoot: true, canonicalHome: home });
    expect(() => h.create()).toThrow(/invalid.*length/i);
    expect(fs.readFileSync(path.join(root, 'master.key'))).toEqual(before);
  });

  test('real child-process restart reloads the scoped file key without HOME overrides', () => {
    const root = path.join(fixture, `subprocess-${++sequence}`);
    fs.mkdirSync(root, { mode: 0o700 });
    const entry = new URL('../../lib/note-encryption.ts', import.meta.url).pathname;
    const typescriptPath = require.resolve('typescript');
    const script = `
      const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
      const ts = require(${JSON.stringify(typescriptPath)});
      const cache = new Map();
      function load(file) {
        if (cache.has(file)) return cache.get(file);
        const module = {exports:{}};
        const code = ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
        vm.runInNewContext(code, {module,exports:module.exports,Buffer,process,console,
          require(id) {return id.startsWith('.') ? load(path.resolve(path.dirname(file),id.replace(/\\.js$/,'.ts'))) : require(id);}
        }, {filename:file});
        cache.set(file,module.exports); return module.exports;
      }
      const enc = load(${JSON.stringify(entry)}).createNoteEncryption({requireMasterKey:true});
      const prior = process.argv[1];
      const key = Buffer.alloc(32,0xa5);
      if (prior) {
        if (!enc.unwrapSessionKey(prior,'fixture:subprocess').equals(key)) throw new Error('Fixture wrap mismatch');
        process.stdout.write(JSON.stringify({reloaded:true}));
      } else process.stdout.write(JSON.stringify({wrapped:enc.wrapSessionKey(key,'fixture:subprocess')}));
    `;
    const childEnv = { PD_HOME: root, PORT_DADDY_DISABLE_KEYCHAIN: '1' };
    if (process.env.HOME !== undefined) childEnv.HOME = process.env.HOME;
    const run = (prior) => spawnSync(process.execPath, ['-e', script, ...(prior ? [prior] : [])], {
      cwd: root, env: childEnv, encoding: 'utf8', timeout: 10000,
    });
    const first = run();
    expect({ code: first.status, error: first.error?.code, stderr: first.stderr }).toEqual({code:0,error:undefined,stderr:''});
    const before = fs.readFileSync(path.join(root, 'master.key'));
    const second = run(JSON.parse(first.stdout).wrapped);
    expect({ code: second.status, error: second.error?.code, stderr: second.stderr }).toEqual({code:0,error:undefined,stderr:''});
    expect(JSON.parse(second.stdout)).toEqual({ reloaded: true });
    expect(fs.readFileSync(path.join(root, 'master.key'))).toEqual(before);
  });

  test.each([0, 1, 31, 33, 64])('rejects an existing %i-byte scoped key without changing it', (length) => {
    const root = path.join(fixture, `malformed-${++sequence}`);
    const before = writeKey(root, Buffer.alloc(length, 0xab));
    const h = harness({ root });
    expect(() => h.create()).toThrow(/length|invalid|32/i);
    expect(fs.readFileSync(path.join(root, 'master.key'))).toEqual(before);
    expect(h.keychainCalls).toEqual([]);
  });

  test('refuses a symbolic-link key without modifying its target', () => {
    const root = path.join(fixture, `link-key-${++sequence}`);
    fs.mkdirSync(root, { mode: 0o700 });
    const target = path.join(fixture, `target-${sequence}`);
    const before = crypto.randomBytes(32);
    fs.writeFileSync(target, before, { mode: 0o600 });
    fs.symlinkSync(target, path.join(root, 'master.key'));
    expect(() => harness({ root }).create()).toThrow(/symbolic|symlink|regular/i);
    expect(fs.readFileSync(target)).toEqual(before);
  });

  test('refuses a symbolic-link key directory', () => {
    const actual = path.join(fixture, `real-dir-${++sequence}`);
    writeKey(actual);
    const root = path.join(fixture, `link-dir-${sequence}`);
    fs.symlinkSync(actual, root);
    expect(() => harness({ root }).create()).toThrow(/symbolic|symlink|real directory/i);
  });

  test('refuses a key directory reached through a symbolic-link ancestor', () => {
    const parent = path.join(fixture, `real-parent-${++sequence}`);
    fs.mkdirSync(parent);
    const link = path.join(fixture, `link-parent-${sequence}`);
    fs.symlinkSync(parent, link);
    expect(() => harness({ root: path.join(link, 'private') }).create()).toThrow(/symbolic|symlink|real directory/i);
  });

  test('refuses permissive scoped directory mode without chmod mutation', () => {
    const root = path.join(fixture, `dir-mode-${++sequence}`);
    writeKey(root);
    fs.chmodSync(root, 0o755);
    expect(() => harness({ root }).create()).toThrow(/0700|700|permissions/i);
    expect(fs.statSync(root).mode & 0o777).toBe(0o755);
  });

  test('refuses permissive scoped key mode without chmod mutation', () => {
    const root = path.join(fixture, `key-mode-${++sequence}`);
    const before = writeKey(root);
    fs.chmodSync(path.join(root, 'master.key'), 0o644);
    expect(() => harness({ root }).create()).toThrow(/0600|600|permissions/i);
    expect(fs.readFileSync(path.join(root, 'master.key'))).toEqual(before);
    expect(fs.statSync(path.join(root, 'master.key')).mode & 0o777).toBe(0o644);
  });

  test('refuses foreign-owned scoped storage using a fake uid, without changing ownership', () => {
    const root = path.join(fixture, `owner-${++sequence}`);
    writeKey(root);
    const uid = fs.statSync(root).uid;
    expect(() => harness({ root, uid: uid + 1 }).create()).toThrow(/owner|ownership/i);
    expect(fs.statSync(root).uid).toBe(uid);
  });

  test('refuses a hard-linked key without changing either link', () => {
    const root = path.join(fixture, `hardlink-${++sequence}`);
    const before = writeKey(root);
    fs.linkSync(path.join(root, 'master.key'), path.join(fixture, `other-link-${sequence}`));
    expect(() => harness({ root }).create()).toThrow(/link|regular/i);
    expect(fs.readFileSync(path.join(root, 'master.key'))).toEqual(before);
  });

  test('missing key creation is exclusive and cannot overwrite a concurrent creator', () => {
    const root = path.join(fixture, `creation-race-${++sequence}`);
    const winner = crypto.randomBytes(32);
    const h = harness({ root, fsOverrides: {
      openSync(file, flags, mode) {
        if (file === path.join(root, 'master.key') && ((typeof flags === 'number' && (flags & fs.constants.O_CREAT)) || flags === 'wx')) {
          fs.writeFileSync(file, winner, { flag: 'wx', mode: 0o600 });
        }
        return fs.openSync(file, flags, mode);
      },
      writeFileSync(file, data, options) {
        if (file === path.join(root, 'master.key')) fs.writeFileSync(file, winner, { flag: 'wx', mode: 0o600 });
        return fs.writeFileSync(file, data, options);
      },
    } });
    expect(() => h.create()).toThrow(/exist|race|initialization failed/i);
    expect(fs.readFileSync(path.join(root, 'master.key'))).toEqual(winner);
  });

  test('mandatory storage failure throws instead of returning plaintext mode', () => {
    const root = path.join(fixture, `not-directory-${++sequence}`);
    fs.writeFileSync(root, 'not a directory');
    expect(() => harness({ root }).create()).toThrow(/mandatory|directory|initialization/i);
  });

  test('rejects oversized keys before reading any key bytes', () => {
    const root = path.join(fixture, `oversized-${++sequence}`);
    writeKey(root, Buffer.alloc(1024 * 1024, 0xab));
    let reads = 0;
    const h = harness({ root, fsOverrides: { readSync() { reads++; throw new Error('Must not read oversized key'); } } });
    expect(() => h.create()).toThrow(/length/i);
    expect(reads).toBe(0);
    expect(fs.statSync(path.join(root, 'master.key')).size).toBe(1024 * 1024);
  });

  test.each(['truncate', 'grow'])('detects key %s during bounded read', (operation) => {
    const root = path.join(fixture, `read-race-${++sequence}`);
    writeKey(root);
    let reads = 0;
    const h = harness({ root, fsOverrides: {
      readSync(...args) {
        if (++reads === 1) {
          if (operation === 'truncate') fs.truncateSync(path.join(root, 'master.key'), 16);
          else fs.appendFileSync(path.join(root, 'master.key'), Buffer.from([0xab]));
        }
        expect(args[3]).toBeLessThanOrEqual(32);
        return fs.readSync(...args);
      },
    } });
    expect(() => h.create()).toThrow(/length|changed/i);
  });

  test('FIFO replacement is opened nonblocking and rejected as nonregular', () => {
    const root = path.join(fixture, `fifo-race-${++sequence}`);
    writeKey(root);
    let observed = false;
    const h = harness({ root, fsOverrides: {
      openSync(file, flags, mode) {
        if (file === path.join(root, 'master.key')) {
          // Refuse before a blocking syscall if this regression ever returns.
          expect(flags & fs.constants.O_NONBLOCK).not.toBe(0);
          fs.unlinkSync(file);
          const made = spawnSync('mkfifo', [file], { encoding: 'utf8' });
          expect(made.status).toBe(0);
          observed = true;
        }
        return fs.openSync(file, flags, mode);
      },
    } });
    expect(() => h.create()).toThrow(/regular file|identity changed/i);
    expect(observed).toBe(true);
    expect(fs.lstatSync(path.join(root, 'master.key')).isFIFO()).toBe(true);
  });

  test('pathname replacement after open is rejected and neither key is overwritten', () => {
    const root = path.join(fixture, `path-race-${++sequence}`);
    const original = writeKey(root);
    const replacement = crypto.randomBytes(32);
    const h = harness({ root, fsOverrides: {
      openSync(file, flags, mode) {
        const fd = fs.openSync(file, flags, mode);
        if (file === path.join(root, 'master.key')) {
          fs.renameSync(file, `${file}.preserved`);
          fs.writeFileSync(file, replacement, { flag: 'wx', mode: 0o600 });
        }
        return fd;
      },
    } });
    expect(() => h.create()).toThrow(/pathname|identity changed/i);
    expect(fs.readFileSync(path.join(root, 'master.key.preserved'))).toEqual(original);
    expect(fs.readFileSync(path.join(root, 'master.key'))).toEqual(replacement);
  });

  test('hard-link creation during read is rejected before returning an encryption instance', () => {
    const root = path.join(fixture, `late-link-${++sequence}`);
    const original = writeKey(root);
    let linked = false;
    const h = harness({ root, fsOverrides: {
      readSync(...args) {
        if (!linked) { fs.linkSync(path.join(root, 'master.key'), path.join(root, 'alias.key')); linked = true; }
        return fs.readSync(...args);
      },
    } });
    expect(() => h.create()).toThrow(/identity changed/i);
    expect(fs.readFileSync(path.join(root, 'master.key'))).toEqual(original);
  });

  test('directory replacement during read is rejected with both trees retained', () => {
    const root = path.join(fixture, `directory-race-${++sequence}`);
    const original = writeKey(root);
    let swapped = false;
    const h = harness({ root, fsOverrides: {
      readSync(...args) {
        if (!swapped) {
          fs.renameSync(root, `${root}.preserved`);
          writeKey(root);
          swapped = true;
        }
        return fs.readSync(...args);
      },
    } });
    expect(() => h.create()).toThrow(/directory identity changed/i);
    expect(fs.readFileSync(path.join(`${root}.preserved`, 'master.key'))).toEqual(original);
  });

  test('foreign-owned opened key is refused even when directory ownership matches', () => {
    const root = path.join(fixture, `file-owner-${++sequence}`);
    writeKey(root);
    const h = harness({ root, fsOverrides: {
      fstatSync(fd) {
        const value = fs.fstatSync(fd);
        return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { uid: value.uid + 1 });
      },
    } });
    expect(() => h.create()).toThrow(/file ownership/i);
  });
});
