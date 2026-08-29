/**
 * Port Daddy Pilot — per-tool agent renderer.
 *
 * One canonical source (agents/port-daddy-pilot/AGENT.md + agent.config.json)
 * is rendered into every runtime's native agent format:
 *
 *   - Claude Code / Desktop  → ~/.claude/agents/port-daddy-pilot.md   (frontmatter + body)
 *   - Codex CLI              → ~/.codex/agents/port-daddy-pilot.toml   (name/description/developer_instructions)
 *   - Gemini CLI             → ~/.gemini/commands/pd-pilot.toml        (/pd-pilot custom command)
 *   - Antigravity (agy)      → reuses the Gemini command via `agy plugin import` (gemini-cli source)
 *   - Generic .agents drop   → ~/.agents/agents/port-daddy-pilot.md    (universal markdown)
 *
 * Editing the rendered copies by hand is pointless: `pd setup` re-renders them
 * from source on every install/upgrade. Edit AGENT.md instead.
 *
 * This module is pure (string in, string out) so it can be unit-tested without
 * touching the filesystem. installPilotAgents() is the only fs-touching export.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, unlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolve the canonical Pilot source dir (the one holding AGENT.md +
 * agent.config.json). Brew install wins over the repo checkout so an upgraded
 * package re-renders from the shipped source.
 */
export function resolvePilotSourceDir(projectRoot: string): string | null {
  const candidates: string[] = [];
  const brew = spawnSync('brew', ['--prefix'], { encoding: 'utf8' });
  if (brew.status === 0) {
    candidates.push(join(brew.stdout.trim(), 'share', 'port-daddy', 'agents', 'port-daddy-pilot'));
  }
  candidates.push(join(projectRoot, 'agents', 'port-daddy-pilot'));
  return candidates.find((p) => existsSync(join(p, 'AGENT.md'))) ?? null;
}

export interface PilotConfig {
  id: string;
  name: string;
  description: string;
  version?: string;
  color?: string;
  /**
   * Per-surface model intent.
   *
   * `claude_local` is a CLI short-alias (the value the local `claude` binary
   * takes on `--model`), which is why it is a bare string and why the
   * no-hardcoded-model-ids guard exempts this module. Every other surface
   * declares a CAPABILITY and resolves through resolveModel() — the entries
   * used to be vendor display strings ("Gemini 3.1 Pro (High)") and one stale
   * API id, none of which any renderer read, so they drifted silently for as
   * long as they existed. A declaration nothing consumes still has to be true,
   * because the next person to consume it will believe it.
   */
  model?: {
    claude_local?: string;
    claude_cloud?: unknown;
    codex?: { capability?: string };
    gemini?: { capability?: string };
    antigravity?: { capability?: string };
  };
  skills?: string[];
  tools?: {
    portDaddyMcp?: string[];
    windagsMcp?: string[];
    editorLocal?: string[];
    cloudToolset?: string;
    custom?: Array<Record<string, unknown>>;
  };
  multiagent?: { agents?: Array<{ role: string; purpose: string }> };
}

/**
 * Pull the runtime system prompt out of AGENT.md (the text between the BEGIN /
 * END markers). The header above the marker is documentation for humans and is
 * not embedded into runtimes.
 */
export function extractSystemPrompt(agentMd: string): string {
  // Match the markers only when they sit on their own line, so an inline
  // mention of the marker text inside the documentation header (e.g. in a
  // backtick span) cannot be mistaken for the real delimiter.
  const beginRe = /^[ \t]*--- BEGIN SYSTEM PROMPT ---[ \t]*$/m;
  const endRe = /^[ \t]*--- END SYSTEM PROMPT ---[ \t]*$/m;
  const beginMatch = beginRe.exec(agentMd);
  const endMatch = endRe.exec(agentMd);
  if (!beginMatch || !endMatch || endMatch.index < beginMatch.index) {
    throw new Error('AGENT.md is missing the line-delimited BEGIN/END SYSTEM PROMPT markers');
  }
  const start = beginMatch.index + beginMatch[0].length;
  return agentMd.slice(start, endMatch.index).trim();
}

/** Build the flat Claude-style tool allowlist (MCP tools get the mcp__ prefix). */
export function claudeToolList(config: PilotConfig): string[] {
  const tools: string[] = [];
  for (const t of config.tools?.portDaddyMcp ?? []) tools.push(`mcp__port-daddy__${t}`);
  for (const t of config.tools?.windagsMcp ?? []) tools.push(`mcp__windags__${t}`);
  for (const t of config.tools?.editorLocal ?? []) tools.push(t);
  return tools;
}

/** YAML double-quoted scalar that survives colons, quotes, and newlines. */
function yamlScalar(value: string): string {
  // JSON string form is a valid YAML double-quoted scalar.
  return JSON.stringify(value);
}

/** TOML basic single-line string with escaping. */
function tomlBasicString(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

/**
 * TOML multi-line *literal* string ('''…'''). No escape processing, so the
 * prompt survives verbatim. Guard the only thing literal strings can't hold:
 * a ''' sequence inside the body.
 */
function tomlMultilineLiteral(value: string): string {
  const safe = value.replace(/'''/g, "''​'");
  return "'''\n" + safe + "\n'''";
}

/** Claude Code / Desktop subagent: YAML frontmatter + markdown body. */
export function renderClaude(config: PilotConfig, system: string): string {
  const tools = claudeToolList(config).join(', ');
  const model = config.model?.claude_local ?? 'opus';
  const lines = [
    '---',
    `name: ${config.id}`,
    `description: ${yamlScalar(config.description)}`,
    `tools: ${tools}`,
    `model: ${model}`,
  ];
  if (config.color) lines.push(`color: ${config.color}`);
  lines.push('---', '', system, '');
  return lines.join('\n');
}

/** Generic ".agents" universal drop — same markdown, model left to the runtime. */
export function renderUniversalMarkdown(config: PilotConfig, system: string): string {
  const tools = claudeToolList(config).join(', ');
  return [
    '---',
    `name: ${config.id}`,
    `description: ${yamlScalar(config.description)}`,
    `tools: ${tools}`,
    '---',
    '',
    system,
    '',
  ].join('\n');
}

/** Codex CLI agent TOML (~/.codex/agents/<id>.toml). */
export function renderCodexToml(config: PilotConfig, system: string): string {
  return [
    `name = ${tomlBasicString(config.id)}`,
    `description = ${tomlBasicString(config.description)}`,
    `developer_instructions = ${tomlMultilineLiteral(system)}`,
    '',
  ].join('\n');
}

/** Gemini CLI custom command TOML (~/.gemini/commands/pd-pilot.toml → /pd-pilot). */
export function renderGeminiCommandToml(config: PilotConfig, system: string): string {
  const prompt = `Adopt the following operating persona for the remainder of this session, unless the user explicitly asks for a different agent.\n\n${system}`;
  return [
    `description = ${tomlBasicString(config.description.slice(0, 240))}`,
    `prompt = ${tomlMultilineLiteral(prompt)}`,
    '',
  ].join('\n');
}

export interface PilotRenderTarget {
  runtime: string;
  path: string;
  content: string;
  /** Stale copies in other formats to remove so we don't double-register. */
  cleanup?: string[];
}

/**
 * Compute every per-tool render target for a given home/base dir. Pure: takes
 * the already-loaded config + system prompt, returns paths and contents.
 */
export function pilotRenderTargets(
  baseDir: string,
  config: PilotConfig,
  system: string,
): PilotRenderTarget[] {
  return [
    {
      runtime: 'Claude Code',
      path: join(baseDir, '.claude', 'agents', `${config.id}.md`),
      content: renderClaude(config, system),
      cleanup: [join(baseDir, '.claude', 'agents', `${config.id}.toml`)],
    },
    {
      runtime: 'Codex CLI',
      path: join(baseDir, '.codex', 'agents', `${config.id}.toml`),
      content: renderCodexToml(config, system),
      cleanup: [join(baseDir, '.codex', 'agents', `${config.id}.md`)],
    },
    {
      runtime: 'Gemini CLI',
      path: join(baseDir, '.gemini', 'commands', 'pd-pilot.toml'),
      content: renderGeminiCommandToml(config, system),
      cleanup: [join(baseDir, '.gemini', 'commands', `${config.id}.toml`)],
    },
    {
      // Inside the Port Daddy Gemini extension so Antigravity (`agy plugin
      // import gemini`) picks it up alongside the extension's MCP + skills.
      runtime: 'Gemini extension (Antigravity)',
      path: join(baseDir, '.gemini', 'extensions', 'port-daddy', 'commands', 'pd-pilot.toml'),
      content: renderGeminiCommandToml(config, system),
      cleanup: [join(baseDir, '.gemini', 'extensions', 'port-daddy', `${config.id}.toml`)],
    },
    {
      runtime: 'Generic agents',
      path: join(baseDir, '.agents', 'agents', `${config.id}.md`),
      content: renderUniversalMarkdown(config, system),
      cleanup: [join(baseDir, '.agents', `${config.id}.md`)],
    },
  ];
}

export interface PilotInstallResult {
  written: Array<{ runtime: string; path: string; changed: boolean }>;
  cleaned: Array<{ runtime: string; path: string; changed: boolean }>;
  errors: Array<{ runtime: string; path: string; error: string }>;
  sourceDir: string;
}

/** Load the canonical config + system prompt from a source directory. */
export function loadPilotSource(sourceDir: string): { config: PilotConfig; system: string } {
  const configPath = join(sourceDir, 'agent.config.json');
  const agentMdPath = join(sourceDir, 'AGENT.md');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as PilotConfig;
  const system = extractSystemPrompt(readFileSync(agentMdPath, 'utf8'));
  return { config, system };
}

/**
 * Render + write every per-tool definition under baseDir (default: $HOME).
 *
 * We write real files (not symlinks) because each runtime needs a different
 * *format* — a symlink can't be a .md here and a .toml there. The header of
 * each rendered file points back to AGENT.md so nobody hand-edits the copy.
 */
export function installPilotAgents(options: {
  sourceDir: string;
  baseDir?: string;
  dryRun?: boolean;
}): PilotInstallResult {
  const baseDir = options.baseDir ?? homedir();
  const result: PilotInstallResult = { written: [], cleaned: [], errors: [], sourceDir: options.sourceDir };
  let config: PilotConfig;
  let system: string;
  try {
    ({ config, system } = loadPilotSource(options.sourceDir));
  } catch (err) {
    result.errors.push({ runtime: 'source', path: options.sourceDir, error: (err as Error).message });
    return result;
  }

  for (const target of pilotRenderTargets(baseDir, config, system)) {
    try {
      for (const stalePath of target.cleanup ?? []) {
        result.cleaned.push({
          runtime: target.runtime,
          path: stalePath,
          changed: removeGeneratedPilotFile(stalePath, config.id, !!options.dryRun),
        });
      }

      const dir = dirname(target.path);
      if (!options.dryRun && !existsSync(dir)) mkdirSync(dir, { recursive: true });

      // Never clobber a real file the user authored at the same path that isn't
      // ours — only overwrite our own generated files (detected by the header).
      let changed = true;
      if (existsSync(target.path)) {
        const existing = readFileSync(target.path, 'utf8');
        if (existing === target.content) {
          changed = false;
        } else if (!existing.includes(config.id)) {
          result.errors.push({
            runtime: target.runtime,
            path: target.path,
            error: 'exists and is not a Port Daddy Pilot file — skipping',
          });
          continue;
        }
      }

      if (changed && !options.dryRun) {
        // If a symlink sits where we want a real file, drop it first.
        try {
          if (lstatSync(target.path).isSymbolicLink()) unlinkSync(target.path);
        } catch { /* not present */ }
        writeFileSync(target.path, target.content, 'utf8');
      }
      result.written.push({ runtime: target.runtime, path: target.path, changed });
    } catch (err) {
      result.errors.push({ runtime: target.runtime, path: target.path, error: (err as Error).message });
    }
  }

  return result;
}

function removeGeneratedPilotFile(path: string, id: string, dryRun: boolean): boolean {
  if (!existsSync(path)) return false;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() && !stat.isSymbolicLink()) return false;
    const existing = readFileSync(path, 'utf8');
    if (!existing.includes(id)) return false;
    if (!dryRun) rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Remove every rendered Pilot definition (used by tests / uninstall). */
export function uninstallPilotAgents(baseDir: string, id = 'port-daddy-pilot'): void {
  const stub: PilotConfig = { id, name: id, description: '', tools: {} };
  for (const target of pilotRenderTargets(baseDir, stub, '')) {
    try { rmSync(target.path, { force: true }); } catch { /* ignore */ }
  }
}
