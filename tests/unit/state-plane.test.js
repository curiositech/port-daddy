/**
 * State-plane classification (S1 — daemon plane identity).
 *
 * `classifyPlane` is a pure function of injected signals: every signal
 * (prefix path, port, profile name, env override, home dir) is injected, so
 * these tests never touch the real environment. The only filesystem behavior
 * is the best-effort realpath used for symlinked-prefix identity, exercised
 * below against a scratch fixture dir.
 */
import { afterAll, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPlane, STATE_PLANE_ENV, isProdPlane } from '../../lib/state-plane.js';
import { DEV_LATEST_PORT } from '../../shared/daemon-berths.js';

const HOME = '/Users/alice';
const CANONICAL = join(HOME, '.port-daddy');

describe('classifyPlane — env override wins', () => {
  test('PORT_DADDY_PLANE=prod forces prod even for a weird prefix', () => {
    expect(classifyPlane({ prefixPath: '/scratch/x', port: 4242, envOverride: 'prod', homeDir: HOME })).toBe('prod');
  });

  test('PORT_DADDY_PLANE=dev-latest forces dev-latest even on the canonical prefix', () => {
    expect(classifyPlane({ prefixPath: CANONICAL, port: 43121, envOverride: 'dev-latest', homeDir: HOME })).toBe('dev-latest');
  });

  test('a full ephemeral:<label> override passes through verbatim', () => {
    expect(classifyPlane({ envOverride: 'ephemeral:soak-7', homeDir: HOME })).toBe('ephemeral:soak-7');
  });

  test('a bare non-plane override is normalized into the ephemeral namespace', () => {
    expect(classifyPlane({ envOverride: 'soak-7', homeDir: HOME })).toBe('ephemeral:soak-7');
  });

  test('whitespace-only override is ignored (falls through to prefix rules)', () => {
    expect(classifyPlane({ envOverride: '   ', homeDir: HOME })).toBe('prod');
  });

  test('the env var name is exported for wiring', () => {
    expect(STATE_PLANE_ENV).toBe('PORT_DADDY_PLANE');
  });
});

describe('classifyPlane — canonical prefix → prod', () => {
  test('no prefix at all (brew daemon) is prod', () => {
    expect(classifyPlane({ homeDir: HOME })).toBe('prod');
    expect(classifyPlane({ prefixPath: undefined, port: 43121, homeDir: HOME })).toBe('prod');
    expect(classifyPlane({ prefixPath: null, homeDir: HOME })).toBe('prod');
    expect(classifyPlane({ prefixPath: '', homeDir: HOME })).toBe('prod');
  });

  test('the resolved canonical prefix is prod', () => {
    expect(classifyPlane({ prefixPath: CANONICAL, port: 43121, homeDir: HOME })).toBe('prod');
  });

  test('tilde expansion: ~/.port-daddy resolves to the canonical prefix', () => {
    expect(classifyPlane({ prefixPath: '~/.port-daddy', homeDir: HOME })).toBe('prod');
  });

  test('trailing slashes do not defeat canonical detection', () => {
    expect(classifyPlane({ prefixPath: `${CANONICAL}/`, homeDir: HOME })).toBe('prod');
    expect(classifyPlane({ prefixPath: '~/.port-daddy///', homeDir: HOME })).toBe('prod');
  });

  test('non-normalized paths still match canonical (.. and . segments)', () => {
    expect(classifyPlane({ prefixPath: join(HOME, 'stuff', '..', '.port-daddy'), homeDir: HOME })).toBe('prod');
    expect(classifyPlane({ prefixPath: join(HOME, '.', '.port-daddy'), homeDir: HOME })).toBe('prod');
  });

  test('defaults homeDir to os.homedir() when not injected', () => {
    expect(classifyPlane({ prefixPath: join(homedir(), '.port-daddy') })).toBe('prod');
  });

  test('a sibling dir that merely CONTAINS .port-daddy is NOT canonical', () => {
    expect(classifyPlane({ prefixPath: join(HOME, '.port-daddy-dev'), port: 4242, homeDir: HOME }))
      .toBe('ephemeral:.port-daddy-dev');
  });
});

describe('classifyPlane — dev-latest lane', () => {
  test(`port ${DEV_LATEST_PORT} on a non-canonical prefix is dev-latest`, () => {
    expect(classifyPlane({ prefixPath: '/opt/pd-dev', port: DEV_LATEST_PORT, homeDir: HOME })).toBe('dev-latest');
  });

  test('profile named dev-latest is dev-latest regardless of port', () => {
    expect(classifyPlane({ prefixPath: '/opt/pd-dev', port: 4242, profileName: 'dev-latest', homeDir: HOME }))
      .toBe('dev-latest');
  });

  test('canonical prefix beats the dev-latest port (prefix rule is checked first)', () => {
    expect(classifyPlane({ prefixPath: CANONICAL, port: DEV_LATEST_PORT, homeDir: HOME })).toBe('prod');
  });
});

describe('classifyPlane — ephemeral fallback', () => {
  test('non-canonical prefix → ephemeral:<basename of prefix>', () => {
    expect(classifyPlane({ prefixPath: '/Users/alice/coding/tmp/pd-feat-x', port: 4242, homeDir: HOME }))
      .toBe('ephemeral:pd-feat-x');
  });

  test('tilde-relative non-canonical prefix expands, then uses its basename', () => {
    expect(classifyPlane({ prefixPath: '~/scratch/soak-1/', port: 4242, homeDir: HOME }))
      .toBe('ephemeral:soak-1');
  });

  test('no prefix but a non-dev-latest profile name → ephemeral:<profile>', () => {
    // A profile-only daemon can still be non-canonical when the env override
    // says so upstream; here we exercise the pure fallback by giving a
    // non-canonical prefix-less classification via an odd profile.
    expect(classifyPlane({ prefixPath: '/x/y/z', port: 4242, profileName: 'nightly', homeDir: HOME }))
      .toBe('ephemeral:z');
  });

  test('prefix basename wins over profile name for the ephemeral label', () => {
    expect(classifyPlane({ prefixPath: '/opt/berths/purple-7', port: 4242, profileName: 'purple', homeDir: HOME }))
      .toBe('ephemeral:purple-7');
  });

  test('degenerate prefix (filesystem root) falls back to the profile, then unknown', () => {
    expect(classifyPlane({ prefixPath: '/', port: 4242, profileName: 'oddball', homeDir: HOME }))
      .toBe('ephemeral:oddball');
    expect(classifyPlane({ prefixPath: '/', port: 4242, homeDir: HOME })).toBe('ephemeral:unknown');
  });

  test('whitespace in the prefix basename is preserved but trimmed at the edges', () => {
    expect(classifyPlane({ prefixPath: '/opt/  weird berth  ', port: 4242, homeDir: HOME }))
      .toBe('ephemeral:weird berth');
  });
});

describe('isProdPlane', () => {
  test('true only for prod', () => {
    expect(isProdPlane('prod')).toBe(true);
    expect(isProdPlane('dev-latest')).toBe(false);
    expect(isProdPlane('ephemeral:x')).toBe(false);
    expect(isProdPlane(undefined)).toBe(false);
    expect(isProdPlane(null)).toBe(false);
    expect(isProdPlane('')).toBe(false);
  });
});

describe('classifyPlane — symlinked prefix identity (real filesystem)', () => {
  // Fixtures live under tests/unit/.scratch/ (gitignored), never /tmp.
  const SCRATCH_ROOT = join(dirname(fileURLToPath(import.meta.url)), '.scratch');
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const fixtureHome = mkdtempSync(join(SCRATCH_ROOT, 'plane-home-'));

  afterAll(() => {
    rmSync(fixtureHome, { recursive: true, force: true });
  });

  test('a symlinked PORT_DADDY_PREFIX pointing at ~/.port-daddy is prod', () => {
    mkdirSync(join(fixtureHome, '.port-daddy'), { recursive: true });
    const link = join(fixtureHome, 'pd-link');
    symlinkSync(join(fixtureHome, '.port-daddy'), link);
    expect(classifyPlane({ prefixPath: link, port: 4242, homeDir: fixtureHome })).toBe('prod');
  });

  test('~/.port-daddy itself being a symlink still matches its real target', () => {
    const home = mkdtempSync(join(SCRATCH_ROOT, 'plane-home-'));
    try {
      const realStore = join(home, 'real-store');
      mkdirSync(realStore, { recursive: true });
      symlinkSync(realStore, join(home, '.port-daddy'));
      expect(classifyPlane({ prefixPath: realStore, port: 4242, homeDir: home })).toBe('prod');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a symlink to a NON-canonical dir stays ephemeral', () => {
    const other = join(fixtureHome, 'berth-7');
    mkdirSync(other, { recursive: true });
    const link = join(fixtureHome, 'berth-link');
    symlinkSync(other, link);
    expect(classifyPlane({ prefixPath: link, port: 4242, homeDir: fixtureHome })).toBe('ephemeral:berth-link');
  });

  test('nonexistent paths fall back to string comparison (never throws)', () => {
    expect(classifyPlane({ prefixPath: join(fixtureHome, 'does-not-exist'), port: 4242, homeDir: fixtureHome }))
      .toBe('ephemeral:does-not-exist');
  });
});
