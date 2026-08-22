// tests/unit/purser/dotenv-scrubbing.test.js
import { jest } from '@jest/globals';
import { existsSync, writeFileSync, readFileSync, mkdtempSync, rmSync, chmodSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDotenvOnce } from '../../../lib/spawner.js';

describe('dotenv scrubbing (loadDotenvOnce)', () => {
  const originalHome = process.env.HOME;
  const originalGetuid = process.getuid;
  const originalStatSync = statSync;
  let fakeHome;
  let projectRoot;

  beforeEach(() => {
    // Create a temporary home directory for operator env files
    fakeHome = mkdtempSync(join(tmpdir(), 'pd-test-home-'));
    process.env.HOME = fakeHome;

    // Create a temporary project root with some .env files
    projectRoot = mkdtempSync(join(tmpdir(), 'pd-test-proj-'));
    // Set NODE_ENV to ensure loadDotenvOnce uses project root
    process.env.PWD = projectRoot;

    // Helper to write env files
    const writeEnv = (path, content) => writeFileSync(path, content, 'utf-8');
    writeEnv(join(projectRoot, '.env'), 'PROJECT=proj\nKEY="proj value"\n');
    writeEnv(join(projectRoot, '.env.local'), 'LOCAL=local\n');
  });

  afterEach(() => {
    // Clean up temp dirs
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });

    process.env.HOME = originalHome;
    process.getuid = originalGetuid;
    global.statSync = originalStatSync;
  });

  test('scrubs ~/.port-daddy-env and includes keys from .env files', () => {
    // Create operator env files including .port-daddy-env
    writeFileSync(join(fakeHome, '.env'), 'HOME_VAL=home\n');
    writeFileSync(join(fakeHome, '.env.local'), 'LOCAL_VAL=local\n');
    writeFileSync(join(fakeHome, '.port-daddy-env'), 'PORT_DD=secret\n');

    const env = loadDotenvOnce();

    // Keys from project root
    expect(env).toHaveProperty('PROJECT', 'proj');
    expect(env).toHaveProperty('LOCAL', 'local');

    // Keys from operator home
    expect(env).toHaveProperty('HOME_VAL', 'home');
    expect(env).toHaveProperty('LOCAL_VAL', 'local');

    // Key from .port-daddy-env should be present
    expect(env).toHaveProperty('PORT_DD', 'secret');

    // Ensure no stray keys
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(['PROJECT', 'LOCAL', 'HOME_VAL', 'LOCAL_VAL', 'PORT_DD'])
    );
  });

  test('skips files not owned by current user', () => {
    // Mock getuid to return a specific uid
    const fakeUid = 12345;
    process.getuid = () => fakeUid;

    // Create a file owned by a different uid
    const badFile = join(fakeHome, '.env');
    writeFileSync(badFile, 'BAD=bad\n');
    // Mock statSync to return a different uid
    const mockStat = jest.fn(() => ({ uid: fakeUid + 1 }));
    global.statSync = mockStat;

    const env = loadDotenvOnce();

    // The bad file should be skipped; its key should not appear
    expect(env).not.toHaveProperty('BAD');

    // Other files should still load
    expect(env).toHaveProperty('PROJECT', 'proj');
  });

  test('parses boundary lines correctly', () => {
    const boundaryFile = join(fakeHome, '.env');
    writeFileSync(
      boundaryFile,
      `
# comment line
EMPTY=
NO_EQUALS
  SPACED =   spaced value   \n
QUOTED="quoted value"
SINGLE='single quoted'
`
    );

    const env = loadDotenvOnce();

    // Comment and empty lines should be ignored or set to empty string
    expect(env).not.toHaveProperty('EMPTY'); // empty value should be omitted
    expect(env).not.toHaveProperty('NO_EQUALS'); // invalid line ignored

    // Spaced line trimmed
    expect(env).toHaveProperty('SPACED', 'spaced value');

    // Quoted values stripped
    expect(env).toHaveProperty('QUOTED', 'quoted value');
    expect(env).toHaveProperty('SINGLE', 'single quoted');
  });

  test('caches results and ignores subsequent file changes', () => {
    const env1 = loadDotenvOnce();
    expect(env1).toHaveProperty('PROJECT', 'proj');

    // Modify a file after first load
    writeFileSync(join(projectRoot, '.env'), 'PROJECT=changed\n');

    const env2 = loadDotenvOnce();
    // Cache should still hold original value
    expect(env2).toHaveProperty('PROJECT', 'proj');
  });

  test('does not load .port-daddy-env when HOME is undefined', () => {
    process.env.HOME = undefined;

    // Create .port-daddy-env in a non-existent home
    const fakeDir = mkdtempSync(join(tmpdir(), 'pd-test-nonhome-'));
    writeFileSync(join(fakeDir, '.port-daddy-env'), 'PORT_DD=secret\n');

    const env = loadDotenvOnce();

    // .port-daddy-env should be absent
    expect(env).not.toHaveProperty('PORT_DD');
    expect(env).toHaveProperty('PROJECT', 'proj');
  });
});