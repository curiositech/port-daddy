import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { buildOperatorSessionDirectory } from '../../lib/operator-session-directory.js';

const roots: string[] = [];

function home(): string {
  const root = mkdtempSync(join(tmpdir(), 'pd-session-directory-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('operator session directory', () => {
  test('deduplicates seeded sessions while preserving every live berth location', async () => {
    const homeDir = home();
    writeFileSync(join(homeDir, 'port-registry.db'), 'ledger');
    const profileDir = join(homeDir, 'instances', 'feature-a');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'port-daddy.db'), 'ledger');
    writeFileSync(join(profileDir, 'daemon.pid'), String(process.pid));
    writeFileSync(join(profileDir, 'daemon.port'), '19991');
    writeFileSync(join(profileDir, 'profile.json'), JSON.stringify({
      name: 'feature-a',
      pid: process.pid,
      port: 19991,
      preferredPort: 19991,
      runtimeDir: profileDir,
      socketPath: join(profileDir, 'port-daddy.sock'),
      ipcPath: join(profileDir, 'port-daddy.ipc'),
      dbPath: join(profileDir, 'port-daddy.db'),
      startedAt: '2026-08-30T12:00:00.000Z',
      cwd: '/repo-feature',
      fleetEnabled: false,
      fleetBarEnabled: false,
    }));

    const fetchJson = jest.fn(async (url: string) => {
      if (url.endsWith('/whoami')) {
        const feature = url.includes('19991');
        return {
          pid: process.pid,
          daemon: {
            label: feature ? 'feature-a' : 'stable',
            tier: feature ? 'codebase' : 'stable',
            canonical: !feature,
            port: feature ? 19991 : 9876,
          },
        };
      }
      if (url.includes('/agent-roster')) {
        const feature = url.includes('19991');
        return { agents: [{
          id: 'actor-1',
          liveness: 'alive',
          harness: {
            id: feature ? 'claude-code' : 'codex-cli',
            family: feature ? 'claude-code' : 'codex-cli',
            label: feature ? 'Claude Code' : 'Codex CLI',
            backend: feature ? 'cli:claude' : 'cli:codex',
            model: feature ? 'provider-model-feature' : 'provider-model-stable',
            confidence: 'witnessed',
          },
        }] };
      }
      const updatedAt = url.includes('19991') ? 200 : 100;
      return { sessions: [{
        id: 'session-shared',
        purpose: 'Build the switcher',
        status: 'active',
        phase: 'in_progress',
        agentId: 'actor-1',
        identityProject: 'port-daddy',
        durable: true,
        createdAt: 10,
        updatedAt,
        fileCount: 2,
        noteCount: 1,
        metadata: { worktree: { root: '/repo', branch: 'codex/switcher' } },
        notes: [{ id: 1, content: 'scope', type: 'scope', createdAt: 20 }],
      }] };
    });

    const result = await buildOperatorSessionDirectory({
      homeDir,
      currentBerth: {
        tier: 'stable',
        label: 'stable',
        color: '#E6A23C',
        sourceDir: null,
        gitBranch: 'main',
        gitRev: 'abc',
        builtAt: null,
        port: 9876,
        canonical: true,
      },
      fetchJson,
    });

    expect(result.schema).toBe('pd.operator.session-directory.v0');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual(expect.objectContaining({
      id: 'session-shared',
      updatedAt: 100,
      primaryLocationId: 'stable',
      provider: expect.objectContaining({
        adapterFamily: 'codex-cli',
        model: 'provider-model-stable',
        confidence: 'witnessed',
      }),
      locations: expect.arrayContaining([
        expect.objectContaining({ id: 'stable', state: 'online' }),
        expect.objectContaining({ id: 'profile:feature-a', state: 'online' }),
      ]),
    }));
    expect(result.summary).toEqual(expect.objectContaining({
      sessions: 1,
      active: 1,
      onlineLocations: 2,
      unknownProviders: 0,
    }));
  });

  test('labels stopped ledgers as preserved without reading or fabricating sessions', async () => {
    const homeDir = home();
    const profileDir = join(homeDir, 'instances', 'old-proof');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, 'port-daddy.db'), 'preserved');
    writeFileSync(join(profileDir, 'profile.json'), JSON.stringify({
      name: 'old-proof',
      pid: 999_999_999,
      port: 19992,
      preferredPort: 19992,
      runtimeDir: profileDir,
      socketPath: join(profileDir, 'port-daddy.sock'),
      ipcPath: join(profileDir, 'port-daddy.ipc'),
      dbPath: join(profileDir, 'port-daddy.db'),
      startedAt: null,
      cwd: null,
      fleetEnabled: false,
      fleetBarEnabled: false,
    }));
    const fetchJson = jest.fn(async (url: string) => {
      if (url.includes('9876/sessions')) return { sessions: [] };
      if (url.includes('9876/agent-roster')) return { agents: [] };
      if (url.includes('9876/whoami')) return { daemon: { label: 'stable', tier: 'stable', canonical: true, port: 9876 } };
      throw new Error(`offline target should not be queried: ${url}`);
    });

    const result = await buildOperatorSessionDirectory({ homeDir, fetchJson });
    const offline = result.locations.find((location) => location.label === 'old-proof');
    expect(offline).toEqual(expect.objectContaining({
      state: 'offline',
      ledgerPreserved: true,
      url: 'http://127.0.0.1:19992',
    }));
    expect(result.sessions).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalledWith(expect.stringContaining('19992'), expect.any(Number));
  });
});
