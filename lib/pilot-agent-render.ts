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

import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, unlinkSync, rmSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

/**
 * Resolve the canonical Pilot source dir (the one holding AGENT.md +
 * agent.config.json). The design preserves package-first upgrades only when
 * no explicit source is selected; an explicit invalid selection never falls
 * back to a different prompt.
 * @param projectRoot Checkout used as the default fallback after Homebrew.
 * @param explicitSourceDir Exact optional source selection, including relative paths.
 * @returns The selected physical source directory, or null when no default exists.
 */
export function resolvePilotSourceDir(projectRoot: string, explicitSourceDir?: string): string | null {
  if (explicitSourceDir !== undefined) return pilotSourcePaths(explicitSourceDir).sourceDir;
  const candidates: string[] = [];
  const brew = spawnSync('brew', ['--prefix'], { encoding: 'utf8' });
  if (brew.status === 0) {
    candidates.push(join(brew.stdout.trim(), 'share', 'port-daddy', 'agents', 'port-daddy-pilot'));
  }
  candidates.push(join(projectRoot, 'agents', 'port-daddy-pilot'));
  for (const candidate of candidates) {
    try { return pilotSourcePaths(candidate).sourceDir; } catch { /* Try the next default only. */ }
  }
  return null;
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

export interface PilotSourceHashes {
  agentSha256: string;
  configSha256: string;
}

export interface PilotSourceProvenance extends PilotSourceHashes {
  sourceDir: string;
  agentPath: string;
  configPath: string;
}

export interface PilotInstallResult {
  written: Array<{ runtime: string; path: string; changed: boolean }>;
  cleaned: Array<{ runtime: string; path: string; changed: boolean }>;
  errors: Array<{ runtime: string; path: string; error: string }>;
  sourceDir: string;
  /** Exact source bytes used by the renderers; null if source loading failed. */
  provenance: PilotSourceProvenance | null;
}

/**
 * Resolve physical inputs before reading, by design rejecting absent or special files.
 * This is source provenance, not a filesystem sandbox or atomic multi-file snapshot.
 * @param sourceDir Explicit or discovered directory containing the two source files.
 * @returns Physical directory and regular input paths without reading their contents.
 */
function pilotSourcePaths(sourceDir: string): Pick<PilotSourceProvenance, 'sourceDir' | 'agentPath' | 'configPath'> {
  if (typeof sourceDir !== 'string' || sourceDir.trim().length === 0) {
    throw new Error('Pilot source directory must be a nonempty path');
  }
  try {
    const physicalDir = realpathSync(sourceDir);
    const agentPath = realpathSync(join(physicalDir, 'AGENT.md'));
    const configPath = realpathSync(join(physicalDir, 'agent.config.json'));
    if (statSync(physicalDir).isDirectory() && statSync(agentPath).isFile() && statSync(configPath).isFile()) {
      return { sourceDir: physicalDir, agentPath, configPath };
    }
  } catch { /* Keep the source diagnostic actionable without exposing filesystem error data. */ }
  throw new Error('Pilot source requires a directory containing regular AGENT.md and agent.config.json files');
}

/**
 * Capture each input once so hashes and parsed/rendered content share the same bytes.
 * The motivation is reviewable provenance, not an assertion of installation or trust.
 * @param sourceDir Selected source directory; invalid explicit input never falls back.
 * @returns Existing config/system contract plus physical paths and exact SHA-256 digests.
 */
export function loadPilotSource(sourceDir: string): { config: PilotConfig; system: string; provenance: PilotSourceProvenance } {
  const paths = pilotSourcePaths(sourceDir);
  const configBytes = readFileSync(paths.configPath);
  const agentBytes = readFileSync(paths.agentPath);
  const config = JSON.parse(configBytes.toString('utf8')) as PilotConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || typeof config.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(config.id)
    || typeof config.name !== 'string' || typeof config.description !== 'string') {
    throw new Error('Pilot config requires a safe agent id and string name/description');
  }
  const system = extractSystemPrompt(agentBytes.toString('utf8'));
  const provenance = {
    ...paths,
    agentSha256: createHash('sha256').update(agentBytes).digest('hex'),
    configSha256: createHash('sha256').update(configBytes).digest('hex'),
  };
  return { config, system, provenance };
}

/**
 * Render + write every per-tool definition under baseDir (default: $HOME).
 *
 * We write real files (not symlinks) because each runtime needs a different
 * *format* — a symlink can't be a .md here and a .toml there. The header of
 * each rendered file points back to AGENT.md so nobody hand-edits the copy.
 * Design: validate source/pins before entering any target cleanup or write.
 * @param options Source, optional target directory, preview flag and paired reviewed hashes.
 * @returns Per-target outcomes and captured provenance, or a zero-write source error.
 */
export function installPilotAgents(options: {
  sourceDir: string;
  baseDir?: string;
  dryRun?: boolean;
  expectedSource?: PilotSourceHashes;
}): PilotInstallResult {
  const baseDir = options.baseDir ?? homedir();
  const result: PilotInstallResult = { written: [], cleaned: [], errors: [], sourceDir: options.sourceDir, provenance: null };
  let config: PilotConfig;
  let system: string;
  try {
    const expected = options.expectedSource;
    if (expected !== undefined && (!expected || typeof expected !== 'object'
      || Object.keys(expected).length !== 2
      || typeof expected.agentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.agentSha256)
      || typeof expected.configSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.configSha256))) {
      throw new Error('Expected Pilot source requires both lowercase SHA-256 digests');
    }
    const loaded = loadPilotSource(options.sourceDir);
    ({ config, system } = loaded);
    result.provenance = loaded.provenance;
    if (expected && (expected.agentSha256 !== loaded.provenance.agentSha256
      || expected.configSha256 !== loaded.provenance.configSha256)) {
      throw new Error('Pilot source changed: reviewed AGENT.md or agent.config.json SHA-256 does not match');
    }
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
