/**
 * Unit tests for lib/github-repo-registry.ts — the repo→projectDir map that
 * gives the inbound GitHub webhook route per-project routing.
 */

import { describe, expect, test } from '@jest/globals';
import {
  normalizeRepoFullName,
  buildRepoRegistry,
  createRepoRegistry,
} from '../../lib/github-repo-registry.ts';
import { getProjectScope } from '../../lib/fleet-channels.ts';

describe('normalizeRepoFullName', () => {
  test('passes through a plain owner/name (lowercased)', () => {
    expect(normalizeRepoFullName('Curiositech/Port-Daddy')).toBe('curiositech/port-daddy');
  });

  test('strips an https GitHub URL', () => {
    expect(normalizeRepoFullName('https://github.com/curiositech/port-daddy')).toBe('curiositech/port-daddy');
    expect(normalizeRepoFullName('https://github.com/curiositech/port-daddy.git')).toBe('curiositech/port-daddy');
  });

  test('strips an SSH git remote', () => {
    expect(normalizeRepoFullName('git@github.com:curiositech/port-daddy.git')).toBe('curiositech/port-daddy');
  });

  test('strips ssh:// form', () => {
    expect(normalizeRepoFullName('ssh://git@github.com/curiositech/port-daddy.git')).toBe('curiositech/port-daddy');
  });

  test('rejects garbage', () => {
    expect(normalizeRepoFullName('')).toBeNull();
    expect(normalizeRepoFullName('nope')).toBeNull();
    expect(normalizeRepoFullName(undefined)).toBeNull();
  });
});

/** Build readers backed by in-memory fixtures (no fs, no git, no daemon). */
function fixtureReaders(byDir) {
  return {
    findFleetConfigPath: (dir) => (byDir[dir]?.fleetYaml != null ? `${dir}/pd-fleet.yml` : null),
    readFile: (path) => {
      const dir = path.replace(/\/pd-fleet\.yml$/, '');
      return byDir[dir]?.fleetYaml ?? null;
    },
    readGitOrigin: (dir) => byDir[dir]?.origin ?? null,
  };
}

describe('buildRepoRegistry', () => {
  test('maps a declared repo (github.repo) to its project, scoped', () => {
    const dir = '/p/port-daddy';
    const readers = fixtureReaders({
      [dir]: { fleetYaml: 'github:\n  repo: curiositech/port-daddy\nfleet:\n  agents: {}\n' },
    });
    const { map, conflicts } = buildRepoRegistry([dir], readers);
    const entry = map.get('curiositech/port-daddy');
    expect(entry).toBeDefined();
    expect(entry.projectDir).toBe(dir);
    expect(entry.source).toBe('declared');
    expect(entry.scope).toBe(getProjectScope(dir));
    expect(conflicts).toHaveLength(0);
  });

  test('supports nested fleet.github.repos (list)', () => {
    const dir = '/p/multi';
    const readers = fixtureReaders({
      [dir]: { fleetYaml: 'fleet:\n  github:\n    repos: [curiositech/a, curiositech/b]\n  agents: {}\n' },
    });
    const { map } = buildRepoRegistry([dir], readers);
    expect(map.get('curiositech/a').projectDir).toBe(dir);
    expect(map.get('curiositech/b').projectDir).toBe(dir);
  });

  test('infers from git origin when no declaration', () => {
    const dir = '/p/inferred';
    const readers = fixtureReaders({
      [dir]: { fleetYaml: 'fleet:\n  agents: {}\n', origin: 'git@github.com:curiositech/example-service.git' },
    });
    const { map } = buildRepoRegistry([dir], readers);
    const entry = map.get('curiositech/example-service');
    expect(entry).toBeDefined();
    expect(entry.source).toBe('inferred');
  });

  test('declared beats inferred for the same repo across projects', () => {
    const declaredDir = '/p/declared';
    const inferredDir = '/p/inferred';
    const readers = fixtureReaders({
      [inferredDir]: { fleetYaml: 'fleet:\n  agents: {}\n', origin: 'https://github.com/curiositech/x' },
      [declaredDir]: { fleetYaml: 'github:\n  repo: curiositech/x\n' },
    });
    // inferred dir scanned first, but declared must win.
    const { map } = buildRepoRegistry([inferredDir, declaredDir], readers);
    expect(map.get('curiositech/x').projectDir).toBe(declaredDir);
    expect(map.get('curiositech/x').source).toBe('declared');
  });

  test('records a conflict when two projects declare the same repo', () => {
    const a = '/p/a';
    const b = '/p/b';
    const readers = fixtureReaders({
      [a]: { fleetYaml: 'github:\n  repo: curiositech/dup\n' },
      [b]: { fleetYaml: 'github:\n  repo: curiositech/dup\n' },
    });
    const { map, conflicts } = buildRepoRegistry([a, b], readers);
    expect(map.get('curiositech/dup').projectDir).toBe(a); // first wins
    expect(conflicts).toEqual([{ repo: 'curiositech/dup', kept: a, dropped: b }]);
  });

  test('skips malformed YAML without throwing', () => {
    const dir = '/p/bad';
    const readers = fixtureReaders({ [dir]: { fleetYaml: ': : not yaml : :\n\t- broken' } });
    expect(() => buildRepoRegistry([dir], readers)).not.toThrow();
  });
});

describe('createRepoRegistry', () => {
  test('resolves and caches, invalidate forces rebuild', () => {
    let dirs = ['/p/one'];
    let buildCount = 0;
    const readers = {
      findFleetConfigPath: (dir) => {
        return `${dir}/pd-fleet.yml`;
      },
      readFile: (path) => {
        buildCount++;
        const dir = path.replace(/\/pd-fleet\.yml$/, '');
        if (dir === '/p/one') return 'github:\n  repo: curiositech/one\n';
        if (dir === '/p/two') return 'github:\n  repo: curiositech/two\n';
        return null;
      },
      readGitOrigin: () => null,
    };
    let clock = 1000;
    const reg = createRepoRegistry({
      getProjectDirs: () => dirs,
      readers,
      ttlMs: 5000,
      now: () => clock,
    });

    expect(reg.resolve('curiositech/one').projectDir).toBe('/p/one');
    const after = buildCount;
    // Second resolve within TTL must not rebuild.
    reg.resolve('curiositech/one');
    expect(buildCount).toBe(after);

    // Add a project; before invalidate it is invisible (cache hot).
    dirs = ['/p/one', '/p/two'];
    expect(reg.resolve('curiositech/two')).toBeNull();

    reg.invalidate();
    expect(reg.resolve('curiositech/two').projectDir).toBe('/p/two');
  });

  test('rebuilds after TTL expiry', () => {
    let dirs = ['/p/one'];
    const readers = {
      findFleetConfigPath: (dir) => `${dir}/pd-fleet.yml`,
      readFile: (path) => {
        const dir = path.replace(/\/pd-fleet\.yml$/, '');
        if (dir === '/p/one') return 'github:\n  repo: curiositech/one\n';
        if (dir === '/p/two') return 'github:\n  repo: curiositech/two\n';
        return null;
      },
      readGitOrigin: () => null,
    };
    let clock = 0;
    const reg = createRepoRegistry({ getProjectDirs: () => dirs, readers, ttlMs: 100, now: () => clock });
    expect(reg.resolve('curiositech/one')).not.toBeNull();
    dirs = ['/p/one', '/p/two'];
    clock = 50; // within TTL
    expect(reg.resolve('curiositech/two')).toBeNull();
    clock = 200; // past TTL
    expect(reg.resolve('curiositech/two')).not.toBeNull();
  });

  test('resolves URL/SSH forms via normalization', () => {
    const reg = createRepoRegistry({
      getProjectDirs: () => ['/p/one'],
      readers: {
        findFleetConfigPath: (dir) => `${dir}/pd-fleet.yml`,
        readFile: () => 'github:\n  repo: curiositech/one\n',
        readGitOrigin: () => null,
      },
    });
    expect(reg.resolve('https://github.com/Curiositech/One.git').projectDir).toBe('/p/one');
  });
});
