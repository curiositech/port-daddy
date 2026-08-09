/**
 * pd setup — One-command local onboarding
 *
 * Installs the daemon, MCP integration, FleetBar (macOS), and initializes the
 * current project when it looks like a real project directory.
 */

import { existsSync, mkdirSync, symlinkSync, lstatSync, unlinkSync, readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ui from '../utils/ui.js';
import { isDaemonRunning } from '../utils/fetch.js';
import { detectStack } from '../../lib/detect.js';
import { handleDaemon } from './daemon.js';
import { handleGuard } from './guard.js';
import { handleInit } from './init.js';
import { handleMcpInstall } from './mcp-install.js';
import { silentHooksInstall, unregisterSquidProject } from './hooks-install.js';
import {
  ensureGeminiPortDaddyExtension,
  formatSkillSyncSummary,
  syncAgentSkills,
} from '../../lib/skill-sync.js';
import { installPilotAgents, resolvePilotSourceDir } from '../../lib/pilot-agent-render.js';
import { installSlashCommand, installStatusline, stageStatusline } from '../../lib/squid/identity.js';
import { installPilotSessionStartHook, stagePilotSessionStartHook } from '../../lib/pilot-sessionstart-hook.js';
import {
  HARBOR_AREAS,
  loadFirstValueRecord,
  saveFirstValueRecord,
  transparentHookInventory,
} from '../../lib/agent-harbor/setup-doctor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Walk up from __dirname looking for the repo marker (Formula/port-daddy.rb
// or skills/port-daddy-agent-skill/). Handles both source layout
// (cli/commands/setup.ts → ../..) and compiled layout
// (dist/cli/commands/setup.js → ../../.., since dist/ also contains a
// package.json from npm install).
function findProjectRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'Formula', 'port-daddy.rb'))) return dir;
    if (existsSync(join(dir, 'skills', 'port-daddy-agent-skill', 'SKILL.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(start, '..', '..');
}
const PROJECT_ROOT = findProjectRoot(__dirname);

// Canonical agent-skill id. Single source of truth so renames propagate across
// brew install paths, repo source path, and every runtime mirror without
// drift.
const AGENT_SKILL_ID = 'port-daddy-agent-skill';
const TSX_BIN = join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
const INSTALL_DAEMON_SCRIPT = join(PROJECT_ROOT, 'install-daemon.ts');
const FLEETBAR_INSTALL_SCRIPT = join(PROJECT_ROOT, 'apps', 'FleetBar', 'install.sh');

const PROJECT_MARKERS = [
  '.git',
  '.portdaddy',
  'pd-fleet.yml',
  'pd-fleet.yaml',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'mix.exs',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
];

function looksLikeProjectDir(dir: string): boolean {
  if (!dir || resolve(dir) === resolve(homedir())) {
    return false;
  }

  if (PROJECT_MARKERS.some(marker => existsSync(join(dir, marker)))) {
    return true;
  }

  try {
    return !!detectStack(dir);
  } catch {
    return false;
  }
}

function inferProjectDir(explicitProject: string | undefined): string | null {
  if (explicitProject) {
    const resolved = resolve(explicitProject);
    return existsSync(resolved) ? resolved : null;
  }

  try {
    const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).stdout.trim();
    if (gitRoot && looksLikeProjectDir(gitRoot)) {
      return gitRoot;
    }
  } catch {
    // Fall through to cwd detection.
  }

  return looksLikeProjectDir(process.cwd()) ? process.cwd() : null;
}

function isGitRepository(dir: string): boolean {
  const git = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (git.status ?? 1) === 0 && git.stdout.trim().length > 0;
}

function installRemediation(label: string, command: string): void {
  ui.info(`${label} remediation: ${command}`);
}

async function ensureDaemonInstalledAndRunning(): Promise<boolean> {
  if (await isDaemonRunning()) {
    ui.success('Daemon already running');
    return true;
  }

  // A packaged / Homebrew install has no source `tsx` or `install-daemon.ts` — PROJECT_ROOT
  // resolves off the compiled binary (often `/`), so those paths don't exist. The tsx-based
  // install below only works in a source checkout; attempting it from a brew build fails and
  // printed a FAKE remediation (`pd daemon install`, which is not a real subcommand — see
  // `pd daemon <list|status|start|stop|env>`). A packaged daemon is supervised by Homebrew,
  // not installed via `pd setup`. Detect that and give an honest, REAL command instead.
  if (!existsSync(TSX_BIN) || !existsSync(INSTALL_DAEMON_SCRIPT)) {
    ui.error('Daemon is not reachable, and `pd setup` cannot install it from a packaged build');
    installRemediation('Daemon', 'brew services restart port-daddy');
    return false;
  }

  ui.step('Installing Port Daddy daemon');
  const install = spawnSync(TSX_BIN, [INSTALL_DAEMON_SCRIPT, 'install'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  if ((install.status ?? 1) !== 0) {
    ui.error('Daemon install failed');
    installRemediation('Daemon', 'pd daemon start   (or: brew services restart port-daddy)');
    return false;
  }

  if (!(await isDaemonRunning())) {
    ui.step('Starting Port Daddy daemon');
    await handleDaemon('start');
  }

  if (await isDaemonRunning()) {
    ui.success('Daemon ready');
    return true;
  }

  ui.error('Daemon did not come up');
  installRemediation('Daemon', 'pd doctor && pd daemon start');
  return false;
}

const PREFETCH_MODEL_SCRIPT = join(PROJECT_ROOT, 'scripts', 'prefetch-embedding-model.ts');

/**
 * Pre-download the local embedding model (Xenova/all-MiniLM-L6-v2, ~27 MB) so the
 * first semantic operation isn't blocked on a network fetch. Idempotent (skips if
 * cached) and best-effort — a failure (offline install) never fails setup; the
 * runtime fetches lazily later. (ADR-0061.)
 */
async function prefetchEmbeddingModel(): Promise<void> {
  // The user may cancel the one-time download; `pd doctor` detects the gap and
  // offers the same fetch as a repair (`pd embed prefetch`). Non-interactive
  // installs keep the old default: download.
  const proceed = await ui.confirm('Download the local embedding model now? (one-time, ~27 MB)', true);
  if (!proceed) {
    ui.info('Skipped — hybrid/semantic search stays lexical-only until you run: pd embed prefetch  (or pd doctor)');
    return;
  }
  ui.step('Pre-downloading local embedding model (one-time, ~27 MB)');
  const r = spawnSync(TSX_BIN, [PREFETCH_MODEL_SCRIPT], { cwd: PROJECT_ROOT, stdio: 'inherit' });
  if ((r.status ?? 0) === 0) ui.success('Embedding model ready');
  else ui.info('Embedding model download failed — repair later with: pd embed prefetch  (or pd doctor)');
}

/**
 * Resolve the canonical agent skill source directory.
 *
 * Source priority:
 *   1. Homebrew install: $(brew --prefix)/share/port-daddy/skills/port-daddy
 *   2. Repo checkout: PROJECT_ROOT/skills/port-daddy-agent-skill
 */
export function resolveSkillSource(): string | null {
  const candidates: string[] = [];

  const brew = spawnSync('brew', ['--prefix'], { encoding: 'utf8' });
  if (brew.status === 0) {
    const prefix = brew.stdout.trim();
    candidates.push(join(prefix, 'share', 'port-daddy', 'skills', AGENT_SKILL_ID));
  }
  candidates.push(join(PROJECT_ROOT, 'skills', AGENT_SKILL_ID));

  return candidates.find((p) => existsSync(join(p, 'SKILL.md'))) ?? null;
}

/**
 * Each LLM runtime watches a different directory for skill / instruction
 * files. We symlink the same canonical source into all of them so every
 * runtime sees the same content with no copy drift. Brew updates the source;
 * every link follows automatically.
 *
 * Returns true if at least one runtime got linked. Per-runtime failures are
 * logged but do not abort.
 */
export function installSkillSymlinksAt(baseDir: string, scope: 'user' | 'project'): boolean {
  const source = resolveSkillSource();
  if (!source) {
    ui.warn('Skill source not found in brew prefix or repo checkout');
    return false;
  }

  const targets: { path: string; runtime: string; mode: 'dir' | 'file' }[] = [
    // Codex CLI — first-party fleet runtime.
    { path: join(baseDir, '.codex', 'skills', AGENT_SKILL_ID), runtime: 'Codex CLI', mode: 'dir' },
    // Claude Code & Desktop — per-scope skills directory.
    { path: join(baseDir, '.claude', 'skills', AGENT_SKILL_ID), runtime: 'Claude Code', mode: 'dir' },
    // Generic agents directory — runtime-agnostic skill drop point.
    { path: join(baseDir, '.agents', 'skills', AGENT_SKILL_ID), runtime: 'Generic agent', mode: 'dir' },
    // Windsurf — Codeium agent runtime.
    { path: join(baseDir, '.codeium', 'windsurf', 'skills', AGENT_SKILL_ID), runtime: 'Windsurf', mode: 'dir' },
    // Continue — VS Code extension; uses .continue prompts dir.
    { path: join(baseDir, '.continue', 'prompts', AGENT_SKILL_ID), runtime: 'Continue', mode: 'dir' },
    // Cline / Roo — Claude-Dev-style extensions read from this dir.
    { path: join(baseDir, '.config', 'cline', 'skills', AGENT_SKILL_ID), runtime: 'Cline', mode: 'dir' },
    // Gemini CLI — extensions live here.
    { path: join(baseDir, '.gemini', 'extensions', 'port-daddy', 'skills', AGENT_SKILL_ID), runtime: 'Gemini CLI', mode: 'dir' },
    // Cursor — single-file rule format. Project-local: <project>/.cursor/rules/port-daddy-agent-skill.md
    { path: join(baseDir, '.cursor', 'rules', `${AGENT_SKILL_ID}.md`), runtime: 'Cursor', mode: 'file' },
  ];

  let linkedCount = 0;
  for (const { path: target, runtime, mode } of targets) {
    const linkSource = mode === 'file' ? join(source, 'SKILL.md') : source;
    const targetDir = dirname(target);

    try {
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      const stat = lstatSyncSafe(target);
      if (stat) {
        if (stat.isSymbolicLink()) {
          const current = readlinkSync(target);
          if (current === linkSource) {
            ui.info(`${runtime}: already linked`);
            linkedCount++;
            continue;
          }
          unlinkSync(target);
        } else {
          ui.warn(`${runtime}: ${target} exists and is not a symlink — skipping`);
          continue;
        }
      }
      symlinkSync(linkSource, target, mode === 'file' ? 'file' : 'dir');
      ui.info(`${runtime}: linked ${target} → ${linkSource}`);
      linkedCount++;
    } catch (err) {
      ui.warn(`${runtime}: ${(err as Error).message}`);
    }
  }

  if (linkedCount === 0) {
    ui.warn(`No ${scope} runtimes received the skill symlink`);
    return false;
  }
  const refreshHint = scope === 'user'
    ? 'brew upgrade port-daddy will refresh all of them.'
    : 'pd init will refresh links if the canonical source moves.';
  ui.info(`Skill installed for ${linkedCount} ${scope} runtime(s). ${refreshHint}`);
  return true;
}

function installAgentSkillUnion(options: Record<string, unknown>): boolean {
  const dryRun = !!options['dry-run'];
  const statusOnly = !!options.status || !!options['skill-status'];
  const result = syncAgentSkills({
    baseDir: homedir(),
    projectRoot: PROJECT_ROOT,
    scope: 'user',
    dryRun,
    statusOnly,
  });

  for (const line of formatSkillSyncSummary(result)) {
    ui.info(line);
  }

  const gemini = ensureGeminiPortDaddyExtension(homedir(), PROJECT_ROOT, dryRun || statusOnly);
  if (gemini.written.length > 0) {
    ui.info(`Gemini extension metadata ${dryRun || statusOnly ? 'would refresh' : 'refreshed'}: ${gemini.written.length} file(s)`);
  }
  if (gemini.errors.length > 0) {
    for (const err of gemini.errors.slice(0, 3)) {
      ui.warn(`Gemini extension metadata: ${err.path}: ${err.error}`);
    }
  }

  return result.errors.length === 0;
}

/**
 * Render + install the Port Daddy Pilot agent definition into every local LLM
 * runtime (Claude .md, Codex .toml, Gemini command, generic .agents). Runs on
 * every `pd setup` / brew upgrade so the persona follows the canonical source.
 */
function installPilotAgentDefinitions(options: Record<string, unknown>): boolean {
  const dryRun = !!options['dry-run'];
  const source = resolvePilotSourceDir(PROJECT_ROOT);
  if (!source) {
    ui.warn('Port Daddy Pilot source not found in brew prefix or repo checkout');
    return false;
  }

  const result = installPilotAgents({ sourceDir: source, dryRun });
  const changed = result.written.filter((w) => w.changed).length;
  ui.info(
    `Port Daddy Pilot: ${dryRun ? 'would install' : 'installed'} ${result.written.length} runtime definition(s)` +
    (changed ? ` (${changed} updated)` : ' (all current)'),
  );
  for (const err of result.errors.slice(0, 3)) {
    ui.warn(`Pilot ${err.runtime}: ${err.path}: ${err.error}`);
  }
  return result.errors.length === 0;
}

function lstatSyncSafe(p: string) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

function installFleetBarIfEnabled(skipFleetBar: boolean): boolean {
  if (skipFleetBar) {
    ui.info('Skipping FleetBar (--no-fleetbar)');
    return true;
  }

  if (platform() !== 'darwin') {
    ui.info('FleetBar install skipped (macOS only)');
    return true;
  }

  if (!existsSync(FLEETBAR_INSTALL_SCRIPT)) {
    ui.warn('FleetBar install script not found');
    installRemediation('FleetBar', 'pd setup --no-fleetbar, or download the signed app from the Install page');
    return false;
  }

  ui.step('Installing FleetBar');
  const install = spawnSync('/bin/bash', [FLEETBAR_INSTALL_SCRIPT], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  if ((install.status ?? 1) !== 0) {
    ui.warn('FleetBar install failed');
    installRemediation('FleetBar', 'pd setup --no-fleetbar, then install FleetBar from the signed zip');
    return false;
  }

  ui.success('FleetBar installed');
  return true;
}

async function maybeInitProject(projectDir: string | null, options: Record<string, unknown>): Promise<void> {
  if (!projectDir) {
    ui.info('No project directory detected — skipping pd init');
    ui.info('Run `cd your-project && pd init` when you are ready.');
    return;
  }

  if (options['no-init']) {
    ui.info('Skipping project init (--no-init)');
    return;
  }

  const shouldInit = await ui.confirm(`Initialize Port Daddy in ${projectDir}?`, true);
  if (!shouldInit) {
    ui.info('Skipping project init');
    return;
  }

  const previousCwd = process.cwd();
  process.chdir(projectDir);
  try {
    await handleInit({
      'no-mcp': true,
      'no-fleet': options['no-fleet'],
      'no-hook': options['no-hook'],
    });
  } finally {
    process.chdir(previousCwd);
  }
}

async function installProjectHarness(projectDir: string | null, options: Record<string, unknown>): Promise<boolean> {
  if (!projectDir) {
    ui.info('Project harness skipped (no project directory detected)');
    installRemediation('Project harness', 'cd your-project && pd setup');
    return true;
  }

  if (options['no-harness']) {
    ui.info('Skipping Squid hooks and Guard (--no-harness)');
    installRemediation('Project harness', 'pd squid on && pd guard install --mode enforce');
    return true;
  }

  let ok = true;

  if (!options['no-squid-hooks']) {
    ui.step('Installing Squid hooks for local agent runtimes');
    try {
      const result = silentHooksInstall(undefined, { cwd: projectDir });
      if (result.tentaclesMissing) throw new Error('required pd-hook-* assets are missing from this build');
      if (result.failures.length) throw new Error(result.failures.join('; '));
      if (result.detected.length === 0) ui.info('No supported agent CLIs detected; pd squid on can be re-run after installation');
      else ui.success(`Daemon-gated hooks wired: ${result.detected.join(', ')}`);

      const stagedStatusline = stageStatusline();
      if (!stagedStatusline) throw new Error('pd-statusline is missing from this build');
      const statusline = installStatusline(projectDir, stagedStatusline);
      if (!statusline.ok || statusline.reason.includes('user statusLine')) {
        throw new Error(`visible ◆ PD identity was not installed: ${statusline.reason}`);
      }

      const stagedPilot = stagePilotSessionStartHook();
      if (!stagedPilot) throw new Error('Pilot SessionStart hook is missing from this build');
      const pilot = installPilotSessionStartHook({ projectDir, scriptPath: stagedPilot });
      if (!pilot.ok) throw new Error(`Pilot SessionStart hook was not installed: ${pilot.reason}`);

      const slash = installSlashCommand(projectDir);
      if (!slash.ok) throw new Error(`/squid command was not installed: ${slash.reason}`);
      ui.success('◆ PD identity, Pilot steering, and /squid control are visible in new sessions');
    } catch (err) {
      unregisterSquidProject(projectDir);
      ok = false;
      ui.warn(`Squid hooks could not be installed: ${(err as Error).message}`);
      installRemediation('Squid hooks', 'pd squid on');
    }
  } else {
    ui.info('Skipping Squid hooks (--no-squid-hooks)');
    installRemediation('Squid hooks', 'pd squid on');
  }

  if (!options['no-guard']) {
    if (!isGitRepository(projectDir)) {
      ok = false;
      ui.warn('Coordination Guard skipped (project is not a git repository)');
      installRemediation('Coordination Guard', 'git init, then pd guard install --mode enforce');
    } else {
      ui.step('Installing Coordination Guard in enforce mode');
      try {
        await handleGuard(['install'], { dir: projectDir, mode: 'enforce', yes: true });
        ui.success('Coordination Guard enforces session, claim, and note discipline');
      } catch (err) {
        ok = false;
        ui.warn(`Coordination Guard could not be installed: ${(err as Error).message}`);
        installRemediation('Coordination Guard', 'pd guard install --mode enforce');
      }
    }
  } else {
    ui.info('Skipping Coordination Guard (--no-guard)');
    installRemediation('Coordination Guard', 'pd guard install --mode enforce');
  }

  return ok;
}

export async function handleSetup(options: Record<string, unknown>): Promise<void> {
  console.log('');
  ui.info('Port Daddy setup');
  console.log('');

  if (options.status || options['skill-status']) {
    installAgentSkillUnion({ ...options, status: true });
    return;
  }

  if (!options['no-daemon']) {
    const daemonOk = await ensureDaemonInstalledAndRunning();
    if (!daemonOk) {
      process.exit(1);
    }
  } else {
    ui.info('Skipping daemon install (--no-daemon)');
  }

  if (!options['no-prefetch']) {
    await prefetchEmbeddingModel();
  } else {
    ui.info('Skipping embedding-model prefetch (--no-prefetch)');
  }

  if (!options['no-mcp']) {
    await handleMcpInstall({ 'no-agents': true });
  } else {
    ui.info('Skipping MCP install (--no-mcp)');
  }

  // Agent-CLI interactive hooks — stage the Giant Squid tentacles + the runtime
  // gate, and wire the CLIs that can ONLY be user-level (codex/agy). The gate
  // keeps them inert unless the daemon is up AND you are inside a pd project, so
  // this is never machine-wide-always-on. Claude/Gemini are wired PER PROJECT by
  // `pd init` / `pd hooks install`. Defaults to Yes; --no-hooks opts out.
  if (!options['no-hooks']) {
    try {
      const { stageTentacles, buildTargets, configureTarget, tentacleBinDir } = await import('./hooks-install.js');
      const detected = buildTargets(process.env.HOME || '').filter((t) => t.detect());
      // Only codex/agy have no project surface — those are staged here. Per-project
      // CLIs (claude/gemini) are wired by pd init so they stay project-scoped.
      const globalOnly = detected.filter((t) => !t.projectConfigPath);
      if (detected.length > 0) {
        const wire = ui.canPrompt()
          ? await ui.confirm(`Stage Port Daddy coordination hooks (gated: only active in pd projects when the daemon runs)?`, true)
          : true;
        if (wire) {
          const stage = stageTentacles();
          if (stage.missing.length > 0) {
            ui.warn('Agent-CLI hooks skipped — squid tentacles (bin/pd-hook-*) not on this build');
          } else {
            // Stage the visual-identity statusline alongside the tentacles so
            // `pd init` / `pd squid on` can wire the ◆ PD badge per project.
            const { stageStatusline } = await import('../../lib/squid/identity.js');
            stageStatusline();
            let n = 0;
            for (const t of globalOnly) {
              const r = configureTarget(t, { scope: 'user' });
              if (r.success && !r.skipped) n++;
            }
            ui.success(`Staged tentacles + gate at ${tentacleBinDir()}`);
            if (n > 0) ui.info(`Wired ${n} home-scoped CLI${n > 1 ? 's' : ''} (codex/agy), gated to pd projects`);
            const perProject = detected.filter((t) => t.projectConfigPath).map((t) => t.name);
            if (perProject.length) ui.info(`${perProject.join(', ')} are wired per-project — run \`pd init\` or \`pd hooks install\` in a repo`);
          }
        }
      }
    } catch (err) {
      ui.warn(`Agent-CLI hooks step failed: ${(err as Error).message}`);
    }
  } else {
    ui.info('Skipping agent-CLI hooks (--no-hooks)');
  }

  installFleetBarIfEnabled(!!options['no-fleetbar']);

  if (!options['no-skill']) {
    installAgentSkillUnion(options);
  } else {
    ui.info('Skipping agent skill symlink (--no-skill)');
  }

  if (!options['no-agents']) {
    installPilotAgentDefinitions(options);
  } else {
    ui.info('Skipping Pilot agent definitions (--no-agents)');
  }

  const explicitProject = typeof options.project === 'string' ? options.project : undefined;
  if (explicitProject && !existsSync(resolve(explicitProject))) {
    ui.error(`Project path not found: ${explicitProject}`);
    process.exit(1);
  }

  const projectDir = inferProjectDir(explicitProject);
  await maybeInitProject(projectDir, options);
  const harnessOk = await installProjectHarness(projectDir, options);

  console.log('');
  if (harnessOk) {
    ui.success('Setup complete');
  } else {
    ui.warn('Setup completed with remediation steps above');
  }

  // ── Agent Harbor onboarding receipt (binder ch18 Work Order C8) ──────────
  // 1. Start the first-value clock: time to first OFFICIAL Agent Node is
  //    measured from the moment the default install path completes. Sealed
  //    records are never overwritten — re-running setup does not reset a
  //    metric that already measured real onboarding.
  try {
    const record = loadFirstValueRecord();
    if (!record.setupCompletedAt) {
      saveFirstValueRecord({ ...record, setupCompletedAt: new Date().toISOString() });
      ui.info('First-value clock started — `pd doctor` reports time to your first official Agent Node.');
    }
  } catch (err) {
    ui.warn(`Could not record setup completion time: ${(err as Error).message}`);
  }

  // 2. Transparency receipt: exactly what got installed, by name, and where
  //    each area's data lives (local / syncs / disabled). No hidden hooks.
  console.log('');
  console.log('  What is installed and where your data lives:');
  for (const area of HARBOR_AREAS) {
    console.log(`    ${area.title}: ${area.syncCopy}`);
  }
  console.log('');
  console.log('  Hooks installed (by name — these are the only ones):');
  for (const hook of transparentHookInventory()) {
    console.log(`    ${hook.displayName} (${hook.hookBinary})`);
    console.log(`      ${hook.description} ${hook.privacy}`);
  }
  console.log('');
  console.log('  Repair anything later with one command per issue: pd doctor');

  console.log('  Next steps:');
  if (projectDir) {
    console.log(`    cd ${projectDir}`);
    console.log('    pd fleet up');
  }
  console.log('    pd fleet status');
  console.log('    pd begin "your next task" --lifecycle durable');
  console.log('');
}
