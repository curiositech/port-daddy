/**
 * pd init — Project Onboarding
 *
 * Single-command project onboarding. Scans the current project, generates a fleet,
 * installs MCP in every detected AI editor, and installs a git hook.
 * One command → running fleet, MCP tools in editor, git hook publishing to Port Daddy.
 *
 * Usage:
 *   pd init              # Full onboarding: scan + fleet + mcp + git hook
 *   pd init --no-fleet   # Skip fleet creation
 *   pd init --no-mcp     # Skip MCP installation
 *   pd init --no-hook    # Skip git hook installation
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ui from '../utils/ui.js';
import { getDaemonTcpUrl } from '../../shared/daemon-discovery.js';
import {
  isLegacyPortDaddyPostCommitHook,
  isScopedPortDaddyPostCommitHook,
  loadPostCommitHookTemplate,
} from '../utils/post-commit-hook.js';

export async function handleInit(options: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const noFleet = !!options['no-fleet'];
  const noMcp = !!options['no-mcp'];
  const noHook = !!options['no-hook'];
  const noSkill = !!options['no-skill'];
  const noSplash = !!options['no-splash'] || !!options['quiet'] || !!options['json'];

  // ─── 0. Splash (the silly-name-deserves-a-flourish moment) ─────────────────
  if (!noSplash) {
    try {
      const { renderSplash } = await import('../../lib/splash.js');
      console.log(renderSplash());
    } catch {
      // If splash module fails for any reason, fall through silently —
      // never block onboarding for a decoration.
    }
  }

  console.log('');
  ui.info(`Initializing Port Daddy for ${cwd}`);
  console.log('');

  const results: string[] = [];
  const warnings: string[] = [];

  // ─── 1. Scan project ────────────────────────────────────────────────────────

  let detectedStack: string[] = [];
  try {
    const { detectStack } = await import('../../lib/detect.js');
    const detected = detectStack(cwd);
    if (detected) {
      detectedStack = [detected.name, detected.stackType]
        .filter((x): x is string => !!x && x !== 'unknown');
    }
    if (detectedStack.length > 0) {
      ui.success(`Detected: ${detectedStack.join(', ')}`);
      results.push(`Stack detected: ${detectedStack.join(', ')}`);
    } else {
      ui.info('No specific framework detected — using generic fleet template');
    }
  } catch {
    ui.info('Stack detection skipped');
  }

  // ─── 2. Register project with daemon ───────────────────────────────────────

  try {
    const baseUrl = getDaemonTcpUrl();
    const res = await fetch(`${baseUrl}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: cwd, deep: false }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      results.push('Project registered with daemon');
      ui.success('Registered with daemon');
    }
  } catch {
    // Daemon not running — not a blocker for init
    warnings.push('Daemon not running — project will register on next pd start');
  }

  // ─── 3. Create .portdaddy/ context ─────────────────────────────────────────

  const portdaddyDir = join(cwd, '.portdaddy');
  if (!existsSync(portdaddyDir)) {
    mkdirSync(portdaddyDir, { recursive: true });
    writeFileSync(
      join(portdaddyDir, 'context.json'),
      JSON.stringify({
        project: cwd.split('/').pop() ?? 'project',
        initialized: new Date().toISOString(),
        stack: detectedStack,
      }, null, 2) + '\n'
    );
    // Ensure .portdaddy is gitignored
    const gitignorePath = join(cwd, '.gitignore');
    if (existsSync(gitignorePath)) {
      const { readFileSync, appendFileSync } = await import('node:fs');
      const existing = readFileSync(gitignorePath, 'utf-8');
      if (!existing.includes('.portdaddy/')) {
        appendFileSync(gitignorePath, '\n# Port Daddy\n.portdaddy/\n');
      }
    }
    results.push('Created .portdaddy/');
    ui.success('Created .portdaddy/context.json');
  } else {
    ui.info('.portdaddy/ already exists');
  }

  // ─── 4. Fleet init ──────────────────────────────────────────────────────────

  if (!noFleet) {
    const fleetPath = join(cwd, 'pd-fleet.yml');
    if (existsSync(fleetPath)) {
      ui.info('pd-fleet.yml already exists — skipping fleet creation');
    } else {
      try {
        const { handleFleet } = await import('./fleet.js');
        await handleFleet(['init'], {});
        results.push('Created pd-fleet.yml');
      } catch (err) {
        warnings.push(`Fleet init failed: ${(err as Error).message}`);
        ui.warn('Fleet init failed — run pd fleet init manually');
      }
    }
  } else {
    ui.info('Skipping fleet (--no-fleet)');
  }

  // ─── 5. MCP install (silent) ────────────────────────────────────────────────

  if (!noMcp) {
    try {
      const { silentMcpInstall } = await import('./mcp-install.js');
      const count = await silentMcpInstall();
      if (count > 0) {
        results.push(`MCP configured in ${count} AI editor${count > 1 ? 's' : ''}`);
        ui.success(`MCP configured in ${count} AI editor${count > 1 ? 's' : ''}`);
        ui.info('Restart your editors to activate Port Daddy tools');
      } else {
        ui.info('No AI editors detected — run pd mcp install after installing one');
      }
    } catch (err) {
      warnings.push(`MCP install failed: ${(err as Error).message}`);
      ui.warn('MCP install failed — run pd mcp install manually');
    }
  } else {
    ui.info('Skipping MCP (--no-mcp)');
  }

  // ─── 5b. Agent-CLI interactive hooks (silent, per-project) ──────────────────
  // Wire the Giant Squid Harness tentacles into THIS project's interactive
  // surfaces (claude/gemini project config; codex/agy gated user config). A
  // runtime gate keeps every hook inert unless the daemon is up and you are
  // inside this pd project — never machine-wide-always-on.
  // Gated by --no-hooks only: --no-mcp is about MCP server registration and
  // must not silently drop coordination hooks or the identity surfaces.

  if (!options['no-hooks']) {
    try {
      const { silentHooksInstall } = await import('./hooks-install.js');
      const hooks = silentHooksInstall(undefined, { cwd });
      if (hooks.tentaclesMissing) {
        warnings.push('Agent-CLI hooks skipped — squid tentacles (bin/pd-hook-*) not on this build');
      } else if (hooks.failures.length > 0) {
        warnings.push(`Agent-CLI hook wiring incomplete: ${hooks.failures.join('; ')}`);
      } else if (hooks.configured > 0) {
        results.push(`Interactive hooks wired for this project (${hooks.configured} agent CLI${hooks.configured > 1 ? 's' : ''})`);
        ui.success(`Coordination hooks wired for this project — ${hooks.detected.join(', ')} (gated: only active when the daemon runs)`);
      } else if (hooks.detected.length === 0) {
        ui.info('No agent CLIs detected — run pd hooks install after installing one');
      }

      // Visual identity: the ◆ PD statusline badge + /squid toggle command, so a
      // harnessed Claude Code session in this project is identifiable at a glance.
      const { stageStatusline, installStatusline, installSlashCommand } = await import('../../lib/squid/identity.js');
      if (stageStatusline()) {
        const sl = installStatusline(cwd);
        if (sl.changed) results.push('Port Daddy statusline wired (◆ PD badge in Claude Code)');
        const slash = installSlashCommand(cwd);
        if (slash.changed) results.push('/squid slash command installed (.claude/commands/squid.md)');
      }
    } catch (err) {
      warnings.push(`Agent-CLI hooks failed: ${(err as Error).message}`);
      ui.warn('Agent-CLI hooks failed — run pd hooks install manually');
    }
  }

  // ─── 6. Project-local skill symlinks ───────────────────────────────────────
  // Drop the canonical Port Daddy skill into <project>/.claude/skills/,
  // <project>/.cursor/rules/, etc. so every agent in this project sees the
  // same skill content the user-level install gets.

  if (!noSkill) {
    try {
      const { installSkillSymlinksAt } = await import('./setup.js');
      const ok = installSkillSymlinksAt(cwd, 'project');
      if (ok) {
        results.push('Project-local skill symlinks installed');
      } else {
        warnings.push('Project skill symlinks could not be installed');
      }
    } catch (err) {
      warnings.push(`Project skill symlinks failed: ${(err as Error).message}`);
    }
  } else {
    ui.info('Skipping project skill symlinks (--no-skill)');
  }

  // ─── 7. Git hook (post-commit → project-scoped git:committed channel) ─────

  if (!noHook) {
    const gitDir = join(cwd, '.git');
    if (!existsSync(gitDir)) {
      ui.info('No .git directory — skipping post-commit hook');
    } else {
      const hookPath = join(gitDir, 'hooks', 'post-commit');
      if (existsSync(hookPath)) {
        const { chmodSync, readFileSync } = await import('node:fs');
        const existing = readFileSync(hookPath, 'utf-8');
        if (isScopedPortDaddyPostCommitHook(existing)) {
          ui.info('Post-commit hook already publishes to the project-scoped git:committed channel');
        } else if (isLegacyPortDaddyPostCommitHook(existing)) {
          writeFileSync(hookPath, loadPostCommitHookTemplate());
          chmodSync(hookPath, 0o755);
          results.push('Upgraded .git/hooks/post-commit');
          ui.success('Upgraded legacy post-commit hook to the project-scoped git:committed channel');
        } else {
          warnings.push('Existing post-commit hook found — run pd fleet init to merge the hook');
        }
      } else {
        const hookDir = join(gitDir, 'hooks');
        mkdirSync(hookDir, { recursive: true });
        writeFileSync(hookPath, loadPostCommitHookTemplate());
        const { chmodSync } = await import('node:fs');
        chmodSync(hookPath, 0o755);
        results.push('Installed .git/hooks/post-commit');
        ui.success('Installed post-commit hook (publishes to the project-scoped git:committed channel)');
      }
    }
  } else {
    ui.info('Skipping git hook (--no-hook)');
  }

  // ─── 8. SessionStart steering (adopt the Port Daddy Pilot agent) ──────────────

  if (!noHook) {
    try {
      const { installPilotSessionStartHook, stagePilotSessionStartHook } = await import('../../lib/pilot-sessionstart-hook.js');
      const stagedPilot = stagePilotSessionStartHook();
      const hookResult = stagedPilot
        ? installPilotSessionStartHook({ projectDir: cwd, scriptPath: stagedPilot })
        : { changed: false, settingsPath: join(cwd, '.claude', 'settings.json'), command: null, reason: 'hook script missing on this build', ok: false };
      if (hookResult.changed) {
        results.push(`SessionStart Pilot hook (${hookResult.reason})`);
        ui.success('Wired SessionStart hook — new sessions adopt the Port Daddy Pilot agent (unless --agent <other>)');
      } else if (hookResult.command) {
        ui.info(`SessionStart Pilot hook: ${hookResult.reason}`);
      } else {
        warnings.push(`SessionStart Pilot hook not installed: ${hookResult.reason}`);
      }
    } catch (err) {
      warnings.push(`SessionStart Pilot hook failed: ${(err as Error).message}`);
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log('');
  if (results.length > 0) {
    ui.info('Done:');
    for (const r of results) console.log(`  + ${r}`);
    console.log('');
  }

  if (warnings.length > 0) {
    for (const w of warnings) ui.warn(w);
    console.log('');
  }

  console.log('  Next steps:');
  if (!existsSync(join(cwd, 'pd-fleet.yml'))) {
    console.log('    pd fleet init       # create agent fleet');
  }
  console.log('    pd fleet up         # start background agents');
  console.log('    pd begin "your task" --lifecycle durable  # start a coordination session');
  console.log('    git commit          # fleet agents trigger automatically');
  console.log('');
}
