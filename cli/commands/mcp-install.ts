/**
 * pd mcp install — Universal AI Agent Connection
 *
 * Auto-detects installed AI platforms (Claude, Cursor, Windsurf, Gemini,
 * VS Code, Continue, Cline) and configures Port Daddy as an MCP server for each.
 * Also installs the agent skill, Port Daddy Pilot agent definitions, and offers
 * shell prompt hook setup.
 *
 * Usage:
 *   pd mcp install              # Auto-detect and configure all
 *   pd mcp install --cursor     # Configure specific platform
 *   pd mcp install --list       # Show detected platforms
 *   pd mcp install --shell      # Install shell prompt hook only
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as ui from '../utils/ui.js';
import {
  installPilotAgents,
  resolvePilotSourceDir,
  type PilotInstallResult,
} from '../../lib/pilot-agent-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const DEFAULT_HOME = process.env.HOME || process.env.USERPROFILE || '';
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

// ─── Platform Definitions ──────────────────────────────────────────────────

interface McpPlatform {
  name: string;
  slug: string;
  configPath: string;
  configKey: 'mcpServers' | 'servers';
  detect(): boolean;
  serverEntry(): Record<string, unknown>;
}

function getPdCommand(): string {
  // Find pd binary path for MCP config
  try {
    const which = IS_WIN ? 'where' : 'which';
    return execFileSync(which, ['pd'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
  } catch {
    return 'pd'; // Fall back to bare command name
  }
}

function makeServerEntry(): Record<string, unknown> {
  return {
    command: getPdCommand(),
    args: ['mcp'],
  };
}

// Exported for testing — build platform list against a given home dir
export function createPlatforms(home: string): McpPlatform[] {
  return buildPlatforms(home);
}

function buildPlatforms(home: string): McpPlatform[] {
  const desktopConfigPath = IS_MAC
    ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : IS_WIN
      ? join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
      : join(home, '.config', 'Claude', 'claude_desktop_config.json');

  const clineConfigPath = IS_MAC
    ? join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
    : IS_WIN
      ? join(home, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
      : join(home, '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');

  const windsurfConfigPath = IS_MAC
    ? join(home, '.codeium', 'windsurf', 'mcp_config.json')
    : join(home, '.windsurf', 'mcp.json');

  return [
    {
      name: 'Claude Code',
      slug: 'claude-code',
      configPath: join(home, '.claude', 'settings.json'),
      configKey: 'mcpServers',
      detect: () => {
        try {
          execFileSync('which', ['claude'], { stdio: ['pipe', 'pipe', 'pipe'] });
          return true;
        } catch { return false; }
      },
      serverEntry: makeServerEntry,
    },
    {
      name: 'Claude Desktop',
      slug: 'claude-desktop',
      configPath: desktopConfigPath,
      configKey: 'mcpServers',
      detect: () => existsSync(dirname(desktopConfigPath)),
      serverEntry: makeServerEntry,
    },
    {
      name: 'Cursor',
      slug: 'cursor',
      configPath: join(home, '.cursor', 'mcp.json'),
      configKey: 'mcpServers',
      detect: () => existsSync(join(home, '.cursor')),
      serverEntry: makeServerEntry,
    },
    {
      name: 'Windsurf',
      slug: 'windsurf',
      configPath: windsurfConfigPath,
      configKey: 'mcpServers',
      detect: () =>
        existsSync(join(home, '.codeium', 'windsurf')) ||
        existsSync(join(home, '.windsurf')),
      serverEntry: makeServerEntry,
    },
    {
      name: 'Gemini CLI',
      slug: 'gemini',
      configPath: join(home, '.gemini', 'settings.json'),
      configKey: 'mcpServers',
      detect: () => {
        if (existsSync(join(home, '.gemini'))) return true;
        try {
          execFileSync('which', ['gemini'], { stdio: ['pipe', 'pipe', 'pipe'] });
          return true;
        } catch { return false; }
      },
      serverEntry: makeServerEntry,
    },
    {
      name: 'VS Code (Copilot)',
      slug: 'vscode',
      configPath: join(home, '.vscode', 'mcp.json'),
      configKey: 'servers',  // VS Code uses "servers" not "mcpServers"
      detect: () => {
        try {
          execFileSync('which', ['code'], { stdio: ['pipe', 'pipe', 'pipe'] });
          return true;
        } catch { return existsSync(join(home, '.vscode')); }
      },
      serverEntry: () => ({
        ...makeServerEntry(),
        type: 'stdio',  // VS Code requires explicit type
      }),
    },
    {
      name: 'Continue.dev',
      slug: 'continue',
      configPath: join(home, '.continue', 'config.json'),
      configKey: 'mcpServers',
      detect: () => existsSync(join(home, '.continue')),
      serverEntry: makeServerEntry,
    },
    {
      name: 'Cline',
      slug: 'cline',
      configPath: clineConfigPath,
      configKey: 'mcpServers',
      detect: () => existsSync(dirname(clineConfigPath)),
      serverEntry: makeServerEntry,
    },
  ];
}

// ─── Config Writing ────────────────────────────────────────────────────────

export function configurePlatform(platform: McpPlatform): { success: boolean; error?: string; created?: boolean } {
  try {
    // Read or create config
    let config: Record<string, unknown> = {};
    if (existsSync(platform.configPath)) {
      const raw = readFileSync(platform.configPath, 'utf-8').trim();
      if (raw) config = JSON.parse(raw);
    }

    // Get or create the servers section
    const key = platform.configKey;
    if (!config[key] || typeof config[key] !== 'object') {
      config[key] = {};
    }

    const servers = config[key] as Record<string, unknown>;

    // Check if already configured
    const alreadyExists = 'port-daddy' in servers;

    // Add/update port-daddy entry
    servers['port-daddy'] = platform.serverEntry();

    // Write back
    mkdirSync(dirname(platform.configPath), { recursive: true });
    writeFileSync(platform.configPath, JSON.stringify(config, null, 2) + '\n');

    return { success: true, created: !alreadyExists };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─── Skill Installation ────────────────────────────────────────────────────

function installSkill(home = DEFAULT_HOME): string | null {
  const skillSrc = join(PROJECT_ROOT, 'skills', 'port-daddy-agent-skill', 'SKILL.md');
  const skillDst = join(home, '.port-daddy', 'skills', 'SKILL.md');

  if (!existsSync(skillSrc)) {
    // Try alternative locations
    const alt = join(PROJECT_ROOT, 'skills', 'port-daddy', 'SKILL.md');
    if (!existsSync(alt)) return null;
    mkdirSync(dirname(skillDst), { recursive: true });
    copyFileSync(alt, skillDst);
    return skillDst;
  }

  mkdirSync(dirname(skillDst), { recursive: true });
  copyFileSync(skillSrc, skillDst);
  return skillDst;
}

// ─── Pilot Agent Installation ───────────────────────────────────────────────

export function installPilotDefinitions(
  home = DEFAULT_HOME,
  options: { dryRun?: boolean; sourceDir?: string } = {},
): PilotInstallResult | null {
  const sourceDir = options.sourceDir ?? resolvePilotSourceDir(PROJECT_ROOT);
  if (!sourceDir) return null;
  return installPilotAgents({ sourceDir, baseDir: home, dryRun: options.dryRun });
}

function printPilotInstallSummary(result: PilotInstallResult | null, dryRun: boolean): void {
  if (!result) {
    ui.warn('Port Daddy Pilot source not found in brew prefix or repo checkout');
    return;
  }

  const changed = result.written.filter((w) => w.changed).length;
  console.log('  Pilot agent definitions:');
  console.log(
    `    ${result.errors.length ? '!' : '✓'} ${result.outcome}: ${dryRun ? 'would install' : 'installed'} ${result.written.length} runtime definition(s)` +
    (changed ? ` (${changed} updated)` : ' (all current)'),
  );
  for (const err of result.errors.slice(0, 3)) {
    console.log(`    \x1b[31m✗\x1b[0m ${err.runtime}: ${err.error}`);
  }
  console.log('');
}

// ─── Shell Hook Installation ───────────────────────────────────────────────

function detectShell(): 'zsh' | 'bash' | 'fish' | 'powershell' | null {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  if (shell.includes('fish')) return 'fish';
  if (IS_WIN) return 'powershell';
  return null;
}

function getShellRcPath(shell: string, home = DEFAULT_HOME): string | null {
  switch (shell) {
    case 'zsh': return join(home, '.zshrc');
    case 'bash': return join(home, '.bashrc');
    case 'fish': return join(home, '.config', 'fish', 'config.fish');
    case 'powershell': {
      // PowerShell profile path
      try {
        const profile = execFileSync('pwsh', ['-NoProfile', '-Command', '$PROFILE'], {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return profile || null;
      } catch { return null; }
    }
    default: return null;
  }
}

function getHookSourceLine(shell: string): string {
  const completionsDir = join(PROJECT_ROOT, 'completions');
  switch (shell) {
    case 'zsh': return `source "${completionsDir}/fleet-prompt.zsh"`;
    case 'bash': return `source "${completionsDir}/fleet-prompt.bash"`;
    case 'fish': return `source "${completionsDir}/fleet-prompt.fish"`;
    case 'powershell': return `. "${completionsDir}/fleet-prompt.ps1"`;
    default: return '';
  }
}

async function installShellHook(shell: string, home = DEFAULT_HOME): Promise<{ success: boolean; path?: string; alreadyInstalled?: boolean }> {
  const rcPath = getShellRcPath(shell, home);
  if (!rcPath) return { success: false };

  const sourceLine = getHookSourceLine(shell);
  if (!sourceLine) return { success: false };

  // Check if already installed
  if (existsSync(rcPath)) {
    const existing = readFileSync(rcPath, 'utf-8');
    if (existing.includes('fleet-prompt')) {
      return { success: true, path: rcPath, alreadyInstalled: true };
    }
  }

  // Append
  const comment = `\n# Port Daddy fleet prompt — shows agent results after each command\n${sourceLine}\n`;
  mkdirSync(dirname(rcPath), { recursive: true });
  const { openSync, writeSync, closeSync } = await import('node:fs');
  const fd = openSync(rcPath, 'a');
  writeSync(fd, comment);
  closeSync(fd);

  return { success: true, path: rcPath };
}

// ─── Main Command ──────────────────────────────────────────────────────────

export async function handleMcpInstall(options: Record<string, unknown>, _home = DEFAULT_HOME): Promise<void> {
  const platforms = buildPlatforms(_home);
  const listOnly = !!options.list;
  const shellOnly = !!options.shell;
  const specificPlatform = platforms.find(p =>
    options[p.slug] || options[p.slug.replace(/-/g, '')]
  );

  console.log('');
  ui.info('Port Daddy MCP Installer');
  console.log('');

  // ─── Detect platforms ────────────────────────────────────────────────

  const detected = platforms.filter(p => p.detect());
  const targets = specificPlatform ? [specificPlatform] : detected;

  if (listOnly) {
    console.log('  Detected AI platforms:');
    for (const p of platforms) {
      const status = p.detect() ? '\x1b[32m✓ installed\x1b[0m' : '\x1b[2m- not found\x1b[0m';
      const configured = existsSync(p.configPath) && readFileSync(p.configPath, 'utf-8').includes('port-daddy')
        ? ' \x1b[32m(configured)\x1b[0m' : '';
      console.log(`    ${p.name.padEnd(20)} ${status}${configured}`);
    }
    console.log('');
    return;
  }

  let shouldInstallSkill = !shellOnly;

  if (!shellOnly) {
    // ─── Configure MCP for each platform ──────────────────────────────

    if (targets.length === 0) {
      ui.warn('No AI platforms detected.');
      console.log('  Supported: Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI, VS Code, Continue, Cline');
      console.log('  Continuing with the shared Port Daddy skill and shell prompt hook.');
      console.log('');
      shouldInstallSkill = true;
    } else {
      console.log('  Configuring MCP server:');
      for (const platform of targets) {
        const result = configurePlatform(platform);
        if (result.success) {
          const note = result.created ? 'configured' : 'updated';
          const keyNote = platform.configKey === 'servers' ? ' (uses "servers" key)' : '';
          console.log(`    \x1b[32m✓\x1b[0m ${platform.name.padEnd(20)} ${note}${keyNote}`);
        } else {
          console.log(`    \x1b[31m✗\x1b[0m ${platform.name.padEnd(20)} ${result.error}`);
        }
      }
      console.log('');
    }

    // ─── Install skill + Pilot persona ────────────────────────────────

    if (shouldInstallSkill) {
      const skillPath = installSkill(_home);
      if (skillPath) {
        console.log(`  Skill installed:`);
        console.log(`    \x1b[32m✓\x1b[0m ${skillPath}`);
        console.log('');
      }
    }

    if (!options['no-agents']) {
      const pilot = installPilotDefinitions(_home, { dryRun: !!options['dry-run'] });
      printPilotInstallSummary(pilot, !!options['dry-run']);
      if (!pilot || pilot.errors.length) {
        process.exitCode = 1;
        return;
      }
    }
  }

  // ─── Shell hook ───────────────────────────────────────────────────────

  const shell = detectShell();
  if (shell) {
    const hookResult = await installShellHook(shell, _home);
    if (hookResult.success) {
      console.log('  Shell hook:');
      if (hookResult.alreadyInstalled) {
        console.log(`    \x1b[32m✓\x1b[0m Already in ${hookResult.path}`);
      } else {
        console.log(`    \x1b[32m✓\x1b[0m Added fleet prompt to ${hookResult.path}`);
      }
      console.log('');
    }
  }

  // ─── Next steps ───────────────────────────────────────────────────────

  if (!shellOnly) {
    console.log('  Next steps:');
    console.log('    1. Restart your editors to activate Port Daddy tools');
    console.log('    2. cd your-project && pd fleet init');
    console.log('    3. git commit — fleet agents fire automatically');
    console.log('');
  }
}

/**
 * Silent MCP install for use by pd init — configures all detected platforms,
 * returns count of platforms configured. No output.
 */
export async function silentMcpInstall(_home = DEFAULT_HOME): Promise<number> {
  const platforms = buildPlatforms(_home);
  const detected = platforms.filter(p => p.detect());
  let count = 0;
  for (const p of detected) {
    const result = configurePlatform(p);
    if (result.success) count++;
  }
  return count;
}
