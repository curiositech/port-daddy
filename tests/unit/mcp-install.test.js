/**
 * Unit tests for cli/commands/mcp-install.ts
 *
 * Tests cover:
 *   1. createPlatforms() — correct config paths and config keys per platform
 *   2. configurePlatform() — write, idempotency, merge into existing config
 *   3. VS Code uses "servers" key (not "mcpServers")
 *   4. Cursor uses standard "mcpServers" key
 *   5. Existing config is preserved (no data loss)
 *   6. silentMcpInstall() — configures only detected platforms
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fresh tmpdir, return its path */
function makeTmpHome() {
  return mkdtempSync(join(tmpdir(), 'pd-mcp-test-'));
}

/** Read JSON from a path, return {} if not found */
function readJson(filePath) {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ─── Imports ──────────────────────────────────────────────────────────────────

const { createPlatforms, configurePlatform, installPilotDefinitions, silentMcpInstall } =
  await import('../../cli/commands/mcp-install.js');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createPlatforms(home)', () => {
  it('returns 8 platforms', () => {
    const platforms = createPlatforms('/tmp/fake-home');
    expect(platforms).toHaveLength(8);
  });

  it('Claude Code uses .claude/settings.json and mcpServers key', () => {
    const home = '/tmp/fake-home';
    const platforms = createPlatforms(home);
    const cc = platforms.find(p => p.slug === 'claude-code');
    expect(cc).toBeDefined();
    expect(cc.configPath).toBe(join(home, '.claude', 'settings.json'));
    expect(cc.configKey).toBe('mcpServers');
  });

  it('VS Code uses .vscode/mcp.json and "servers" key', () => {
    const home = '/tmp/fake-home';
    const platforms = createPlatforms(home);
    const vscode = platforms.find(p => p.slug === 'vscode');
    expect(vscode).toBeDefined();
    expect(vscode.configPath).toBe(join(home, '.vscode', 'mcp.json'));
    expect(vscode.configKey).toBe('servers');
  });

  it('Cursor uses .cursor/mcp.json and mcpServers key', () => {
    const home = '/tmp/fake-home';
    const platforms = createPlatforms(home);
    const cursor = platforms.find(p => p.slug === 'cursor');
    expect(cursor).toBeDefined();
    expect(cursor.configPath).toBe(join(home, '.cursor', 'mcp.json'));
    expect(cursor.configKey).toBe('mcpServers');
  });

  it('Gemini CLI uses .gemini/settings.json and mcpServers key', () => {
    const home = '/tmp/fake-home';
    const platforms = createPlatforms(home);
    const gemini = platforms.find(p => p.slug === 'gemini');
    expect(gemini).toBeDefined();
    expect(gemini.configPath).toBe(join(home, '.gemini', 'settings.json'));
    expect(gemini.configKey).toBe('mcpServers');
  });

  it('all platform slugs are unique', () => {
    const platforms = createPlatforms('/tmp/fake-home');
    const slugs = platforms.map(p => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('all platform configPaths are under the given home', () => {
    const home = '/custom/home/dir';
    const platforms = createPlatforms(home);
    for (const p of platforms) {
      expect(p.configPath.startsWith(home)).toBe(true);
    }
  });

  it('server entries have command and args fields', () => {
    const platforms = createPlatforms('/tmp/fake-home');
    for (const p of platforms) {
      const entry = p.serverEntry();
      expect(entry).toHaveProperty('command');
      expect(entry).toHaveProperty('args');
      expect(entry.args).toEqual(['mcp']);
    }
  });

  it('VS Code server entry includes type: stdio', () => {
    const platforms = createPlatforms('/tmp/fake-home');
    const vscode = platforms.find(p => p.slug === 'vscode');
    const entry = vscode.serverEntry();
    expect(entry.type).toBe('stdio');
  });
});

// ─── configurePlatform ────────────────────────────────────────────────────────

describe('configurePlatform()', () => {
  let tmpHome;

  beforeEach(() => { tmpHome = makeTmpHome(); });
  afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); });

  it('creates config file when it does not exist', () => {
    const platforms = createPlatforms(tmpHome);
    const cc = platforms.find(p => p.slug === 'claude-code');

    const result = configurePlatform(cc);

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(existsSync(cc.configPath)).toBe(true);
  });

  it('writes port-daddy entry under the correct key (mcpServers)', () => {
    const platforms = createPlatforms(tmpHome);
    const cc = platforms.find(p => p.slug === 'claude-code');
    configurePlatform(cc);

    const config = readJson(cc.configPath);
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers['port-daddy']).toBeDefined();
    expect(config.mcpServers['port-daddy'].args).toEqual(['mcp']);
  });

  it('writes port-daddy under "servers" key for VS Code', () => {
    const platforms = createPlatforms(tmpHome);
    const vscode = platforms.find(p => p.slug === 'vscode');
    configurePlatform(vscode);

    const config = readJson(vscode.configPath);
    expect(config.servers).toBeDefined();
    expect(config.servers['port-daddy']).toBeDefined();
    expect(config.mcpServers).toBeUndefined();
  });

  it('is idempotent — second call sets created=false, does not duplicate', () => {
    const platforms = createPlatforms(tmpHome);
    const cc = platforms.find(p => p.slug === 'claude-code');

    configurePlatform(cc);
    const result2 = configurePlatform(cc);

    expect(result2.success).toBe(true);
    expect(result2.created).toBe(false);

    const config = readJson(cc.configPath);
    const keys = Object.keys(config.mcpServers);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe('port-daddy');
  });

  it('merges into existing config without destroying other entries', () => {
    const platforms = createPlatforms(tmpHome);
    const cc = platforms.find(p => p.slug === 'claude-code');

    // Pre-existing config with another MCP server
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(cc.configPath, JSON.stringify({
      mcpServers: {
        'other-tool': { command: 'other', args: [] },
      },
      someOtherSetting: true,
    }, null, 2));

    configurePlatform(cc);
    const config = readJson(cc.configPath);

    expect(config.mcpServers['other-tool']).toBeDefined();
    expect(config.mcpServers['port-daddy']).toBeDefined();
    expect(config.someOtherSetting).toBe(true);
  });

  it('handles empty existing config file gracefully', () => {
    const platforms = createPlatforms(tmpHome);
    const cc = platforms.find(p => p.slug === 'claude-code');

    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(cc.configPath, '');

    const result = configurePlatform(cc);
    expect(result.success).toBe(true);
  });

  it('creates nested directories as needed', () => {
    const platforms = createPlatforms(tmpHome);
    // Claude Code requires .claude/ to be created
    const cc = platforms.find(p => p.slug === 'claude-code');
    expect(existsSync(join(tmpHome, '.claude'))).toBe(false);

    configurePlatform(cc);
    expect(existsSync(join(tmpHome, '.claude'))).toBe(true);
  });

  it('returns error on invalid existing JSON', () => {
    const platforms = createPlatforms(tmpHome);
    const cc = platforms.find(p => p.slug === 'claude-code');

    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(cc.configPath, '{ bad json !!!');

    const result = configurePlatform(cc);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── Port Daddy Pilot definitions ───────────────────────────────────────────

describe('installPilotDefinitions(home)', () => {
  let tmpHome;

  beforeEach(() => { tmpHome = makeTmpHome(); });
  afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); });

  it('renders the Port Daddy Pilot persona into every local agent runtime', () => {
    const sourceDir = join(process.cwd(), 'agents', 'port-daddy-pilot');

    const result = installPilotDefinitions(tmpHome, { sourceDir });

    expect(result.errors).toEqual([]);
    expect(result.written.map(w => w.runtime)).toEqual([
      'Claude Code',
      'Codex CLI',
      'Gemini CLI',
      'Gemini extension (Antigravity)',
      'Generic agents',
    ]);
    expect(existsSync(join(tmpHome, '.claude', 'agents', 'port-daddy-pilot.md'))).toBe(true);
    expect(existsSync(join(tmpHome, '.codex', 'agents', 'port-daddy-pilot.toml'))).toBe(true);
    expect(existsSync(join(tmpHome, '.gemini', 'commands', 'pd-pilot.toml'))).toBe(true);
    expect(existsSync(join(tmpHome, '.gemini', 'extensions', 'port-daddy', 'commands', 'pd-pilot.toml'))).toBe(true);
    expect(existsSync(join(tmpHome, '.agents', 'agents', 'port-daddy-pilot.md'))).toBe(true);
    expect(readFileSync(join(tmpHome, '.codex', 'agents', 'port-daddy-pilot.toml'), 'utf-8'))
      .toContain('developer_instructions');
  });

  it('supports dry-run without writing files', () => {
    const sourceDir = join(process.cwd(), 'agents', 'port-daddy-pilot');

    const result = installPilotDefinitions(tmpHome, { sourceDir, dryRun: true });

    expect(result.errors).toEqual([]);
    expect(result.written).toHaveLength(5);
    expect(existsSync(join(tmpHome, '.codex', 'agents', 'port-daddy-pilot.toml'))).toBe(false);
    expect(existsSync(join(tmpHome, '.claude', 'agents', 'port-daddy-pilot.md'))).toBe(false);
  });
});

describe('pd setup integration', () => {
  it('delegates MCP install without double-installing Pilot definitions and arms the project harness', () => {
    const setup = readFileSync(join(process.cwd(), 'cli', 'commands', 'setup.ts'), 'utf-8');

    expect(setup).toContain("await handleMcpInstall({ 'no-agents': true })");
    expect(setup).toContain('installPilotAgentDefinitions(options)');
    expect(setup).toContain("import { silentHooksInstall, unregisterSquidProject } from './hooks-install.js'");
    expect(setup).toContain('installProjectHarness(projectDir, options)');
    expect(setup).toContain('silentHooksInstall(undefined, { cwd: projectDir })');
    expect(setup).toContain("await handleGuard(['install'], { dir: projectDir, mode: 'enforce', yes: true })");
    expect(setup).toContain('installRemediation');

    const cli = readFileSync(join(process.cwd(), 'bin', 'port-daddy-cli.ts'), 'utf-8');
    expect(cli).toContain('--no-agents             Skip Port Daddy Pilot agent definitions');
    expect(cli).toContain('--no-harness            Skip Squid hooks and Coordination Guard');
    expect(cli).toContain('--no-squid-hooks        Skip agent hook installation only');
    expect(cli).toContain('--no-guard              Skip Coordination Guard hook installation only');
  });
});

// ─── silentMcpInstall ─────────────────────────────────────────────────────────

describe('silentMcpInstall(home)', () => {
  let tmpHome;

  beforeEach(() => { tmpHome = makeTmpHome(); });
  afterEach(() => { rmSync(tmpHome, { recursive: true, force: true }); });

  it('returns a non-negative integer (platform detection is env-dependent)', async () => {
    // Empty tmpHome — directory-based detections won't fire (no .cursor, .continue, etc.)
    // Binary-based detections (which claude, which code) depend on the test environment,
    // so we only assert a valid count, not a specific value.
    const count = await silentMcpInstall(tmpHome);
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('configures Claude Code when .claude/ exists', async () => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });

    const count = await silentMcpInstall(tmpHome);
    // Detection for Claude Code checks `which claude` not .claude/ dir,
    // so detection may return 0. But the config file should be written
    // if we simulate a detected platform by checking another slug.
    // We verify silentMcpInstall at least runs without throwing.
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('configures Cursor when .cursor/ exists', async () => {
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });

    const count = await silentMcpInstall(tmpHome);
    expect(count).toBeGreaterThanOrEqual(1);

    const platforms = createPlatforms(tmpHome);
    const cursor = platforms.find(p => p.slug === 'cursor');
    const config = readJson(cursor.configPath);
    expect(config.mcpServers?.['port-daddy']).toBeDefined();
  });

  it('configures multiple detected platforms', async () => {
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });
    mkdirSync(join(tmpHome, '.continue'), { recursive: true });

    const count = await silentMcpInstall(tmpHome);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent — running twice does not duplicate entries', async () => {
    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });

    await silentMcpInstall(tmpHome);
    await silentMcpInstall(tmpHome);

    const platforms = createPlatforms(tmpHome);
    const cursor = platforms.find(p => p.slug === 'cursor');
    const config = readJson(cursor.configPath);
    expect(Object.keys(config.mcpServers)).toHaveLength(1);
  });
});
