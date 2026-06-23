/**
 * A7 mcp-inventory unit tests (jest). ADR-0088 Phase A test plan:
 *   - unpinned `npx` MCP entry flagged; pinned one NOT — STRUCTURED field
 *     inspection of the command + args ARRAY, never NLP over a description.
 *   - the same for `uvx` (==version / --from pin).
 *   - several config shapes parsed (mcpServers map, bare `.mcp.json` map).
 *   - bad JSON / missing files tolerated.
 */
import {
  npxIsUnpinned,
  uvxIsUnpinned,
  hasNpmVersionPin,
  hasUvxVersionPin,
  inspectServerCommand,
  extractServers,
  parseConfigFile,
  inventoryMcp,
  type McpInventoryDeps,
} from '../../lib/safe/mcp-inventory.js';

// ── npm version-pin detection (structured, not NLP) ──────────────────────────

describe('hasNpmVersionPin', () => {
  test('scoped + pinned → true', () => {
    expect(hasNpmVersionPin('@modelcontextprotocol/server-filesystem@1.2.3')).toBe(true);
  });
  test('scoped + unpinned → false (the leading scope @ is not a version)', () => {
    expect(hasNpmVersionPin('@modelcontextprotocol/server-filesystem')).toBe(false);
  });
  test('unscoped + concrete version / range → true', () => {
    expect(hasNpmVersionPin('some-mcp@^1')).toBe(true);
    expect(hasNpmVersionPin('some-mcp@~1.2')).toBe(true);
    expect(hasNpmVersionPin('some-mcp@1.2.3')).toBe(true);
    expect(hasNpmVersionPin('some-mcp@1.x')).toBe(true);
    expect(hasNpmVersionPin('some-mcp@>=1')).toBe(true);
    expect(hasNpmVersionPin('some-mcp@v1.2.3')).toBe(true);
  });
  test('dist-tags are NOT pins — they are moving targets (A7 typosquat vector)', () => {
    expect(hasNpmVersionPin('some-mcp@latest')).toBe(false);
    expect(hasNpmVersionPin('some-mcp@next')).toBe(false);
    expect(hasNpmVersionPin('some-mcp@canary')).toBe(false);
    expect(hasNpmVersionPin('some-mcp@beta')).toBe(false);
    expect(hasNpmVersionPin('some-mcp@*')).toBe(false);
    expect(hasNpmVersionPin('some-mcp@')).toBe(false);
  });
  test('scoped + dist-tag → false (scope @ is not a version, latest is not a pin)', () => {
    expect(hasNpmVersionPin('@scope/some-mcp@latest')).toBe(false);
    expect(hasNpmVersionPin('@scope/some-mcp@next')).toBe(false);
  });
  test('unscoped + unpinned → false', () => {
    expect(hasNpmVersionPin('some-mcp')).toBe(false);
  });
});

describe('hasUvxVersionPin', () => {
  test('== / >= pins → true; bare → false', () => {
    expect(hasUvxVersionPin('mcp-server-git==1.0.0')).toBe(true);
    expect(hasUvxVersionPin('mcp-server-git>=1')).toBe(true);
    expect(hasUvxVersionPin('mcp-server-git')).toBe(false);
  });
});

// ── npx/uvx command-array inspection ─────────────────────────────────────────

describe('npxIsUnpinned — structured args walk', () => {
  test('npx <pkg> with no version → unpinned', () => {
    expect(npxIsUnpinned(['-y', '@scope/server-fs'])).toBe(true);
  });
  test('npx -y <pkg>@version → pinned', () => {
    expect(npxIsUnpinned(['-y', '@scope/server-fs@1.2.3'])).toBe(false);
  });
  test('npx -p <pkg>@version → pinned (value-flag form)', () => {
    expect(npxIsUnpinned(['-p', 'tool@2.0.0', 'run'])).toBe(false);
  });
  test('npx <pkg>@<dist-tag> → UNPINNED (latest/next are moving targets)', () => {
    expect(npxIsUnpinned(['pkg@latest'])).toBe(true);
    expect(npxIsUnpinned(['-y', 'pkg@next'])).toBe(true);
  });
  test('npx <pkg>@<concrete version> → pinned (not flagged)', () => {
    expect(npxIsUnpinned(['pkg@1.2.3'])).toBe(false);
  });
  test('npx ./local-path → not a registry fetch → not flagged', () => {
    expect(npxIsUnpinned(['./dist/server.js'])).toBe(false);
    expect(npxIsUnpinned(['/abs/server.js'])).toBe(false);
  });
});

describe('uvxIsUnpinned', () => {
  test('uvx <pkg> bare → unpinned; uvx <pkg>==v → pinned', () => {
    expect(uvxIsUnpinned(['mcp-server-git'])).toBe(true);
    expect(uvxIsUnpinned(['mcp-server-git==1.0.0'])).toBe(false);
  });
  test('uvx --from <pkg==v> tool → pinned via --from', () => {
    expect(uvxIsUnpinned(['--from', 'mcp-server-git==1.0.0', 'mcp-server-git'])).toBe(false);
  });
  test('uvx --from <pkg> tool → unpinned via --from', () => {
    expect(uvxIsUnpinned(['--from', 'mcp-server-git', 'mcp-server-git'])).toBe(true);
  });
});

describe('inspectServerCommand', () => {
  test('npx launcher (as a path) + unpinned pkg → unpinned-npx flag', () => {
    expect(inspectServerCommand('/usr/local/bin/npx', ['-y', 'evil-mcp'])).toEqual(['unpinned-npx']);
  });
  test('pinned npx → no flags', () => {
    expect(inspectServerCommand('npx', ['-y', 'good-mcp@1.0.0'])).toEqual([]);
  });
  test('a plain node command → no npx/uvx flag (not a registry fetch)', () => {
    expect(inspectServerCommand('node', ['./server.js'])).toEqual([]);
  });
  test('uvx unpinned → unpinned-uvx', () => {
    expect(inspectServerCommand('uvx', ['mcp-server-git'])).toEqual(['unpinned-uvx']);
  });
});

// ── config extraction across shapes ──────────────────────────────────────────

describe('extractServers — config shapes', () => {
  test('top-level mcpServers map', () => {
    const s = extractServers({ mcpServers: { fs: { command: 'npx', args: [] } } });
    expect(Object.keys(s)).toEqual(['fs']);
  });
  test('bare .mcp.json whose root IS the server map', () => {
    const s = extractServers({ git: { command: 'uvx', args: ['mcp-server-git'] } });
    expect(Object.keys(s)).toEqual(['git']);
  });
  test('unexpected shape → empty map (defensive)', () => {
    expect(extractServers(42)).toEqual({});
    expect(extractServers(null)).toEqual({});
    expect(extractServers({ unrelated: 'config' })).toEqual({});
  });
});

describe('parseConfigFile', () => {
  test('flags an unpinned npx server, not a pinned one', () => {
    const json = JSON.stringify({
      mcpServers: {
        risky: { command: 'npx', args: ['-y', 'typosquat-mcp'] },
        safe: { command: 'npx', args: ['-y', 'good-mcp@1.4.2'] },
        local: { command: 'node', args: ['./server.js'] },
      },
    });
    const entries = parseConfigFile('/x/.mcp.json', 'project-mcp-json', json);
    const risky = entries.find((e) => e.name === 'risky');
    const safe = entries.find((e) => e.name === 'safe');
    const local = entries.find((e) => e.name === 'local');
    expect(risky?.flags).toEqual(['unpinned-npx']);
    expect(safe?.flags).toEqual([]);
    expect(local?.flags).toEqual([]);
  });
  test('bad JSON → no entries, no throw', () => {
    expect(parseConfigFile('/x/.mcp.json', 'project-mcp-json', '{ not json')).toEqual([]);
  });
});

// ── full inventory with injected fs ──────────────────────────────────────────

describe('inventoryMcp — injected fs', () => {
  const HOME = '/home/test';
  test('scans every existing config and aggregates flagged servers', () => {
    const files: Record<string, string> = {
      [`${HOME}/.mcp.json`]: JSON.stringify({
        mcpServers: { a: { command: 'npx', args: ['-y', 'unpinned-a'] } },
      }),
      [`${HOME}/.cursor/mcp.json`]: JSON.stringify({
        mcpServers: { b: { command: 'npx', args: ['-y', 'pinned-b@1.0.0'] } },
      }),
    };
    const deps: McpInventoryDeps = {
      home: HOME,
      exists: (p) => p in files,
      readFile: (p) => files[p] ?? null,
    };
    const result = inventoryMcp(deps);
    expect(result.configsScanned).toEqual(
      expect.arrayContaining([`${HOME}/.mcp.json`, `${HOME}/.cursor/mcp.json`]),
    );
    const a = result.servers.find((s) => s.name === 'a');
    const b = result.servers.find((s) => s.name === 'b');
    expect(a?.flags).toEqual(['unpinned-npx']);
    expect(a?.source).toBe('project-mcp-json');
    expect(b?.flags).toEqual([]);
    expect(b?.source).toBe('cursor-mcp-json');
  });

  test('no configs present → empty inventory, no throw', () => {
    const result = inventoryMcp({ home: HOME, exists: () => false, readFile: () => null });
    expect(result.servers).toEqual([]);
    expect(result.configsScanned).toEqual([]);
  });
});
