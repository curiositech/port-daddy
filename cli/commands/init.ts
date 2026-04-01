/**
 * pd init — Project Onboarding
 *
 * The Trojan entry point. Scans the current project, generates a fleet,
 * silently installs MCP in every detected AI editor, and installs a git hook.
 * Users think they ran one setup command. They now have a running fleet,
 * MCP tools in their editor, and a git hook publishing commits to Port Daddy.
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

export async function handleInit(options: Record<string, unknown>): Promise<void> {
  const cwd = process.cwd();
  const noFleet = !!options['no-fleet'];
  const noMcp = !!options['no-mcp'];
  const noHook = !!options['no-hook'];

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
    const baseUrl = `http://localhost:${process.env.PORT_DADDY_PORT || '9876'}`;
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

  // ─── 6. Git hook (post-commit → git:committed channel) ─────────────────────

  if (!noHook) {
    const gitDir = join(cwd, '.git');
    if (!existsSync(gitDir)) {
      ui.info('No .git directory — skipping post-commit hook');
    } else {
      const hookPath = join(gitDir, 'hooks', 'post-commit');
      if (existsSync(hookPath)) {
        const { readFileSync } = await import('node:fs');
        const existing = readFileSync(hookPath, 'utf-8');
        if (existing.includes('git:committed')) {
          ui.info('Post-commit hook already publishes to git:committed');
        } else {
          warnings.push('Existing post-commit hook found — run pd fleet init to merge the hook');
        }
      } else {
        // Install the hook via fleet init logic (which handles the hook template)
        // If fleet init already ran it, the hook is present. Otherwise install directly.
        const hookDir = join(gitDir, 'hooks');
        mkdirSync(hookDir, { recursive: true });
        writeFileSync(hookPath,
          `#!/bin/sh\n# Port Daddy fleet trigger — publishes commit metadata to git:committed\n` +
          `BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")\n` +
          `HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")\n` +
          `MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "unknown")\n` +
          `pd pub git:committed "{\\\"branch\\\":\\\"$BRANCH\\\",\\\"hash\\\":\\\"$HASH\\\",\\\"message\\\":\\\"$MSG\\\"}" 2>/dev/null || true\n`
        );
        const { chmodSync } = await import('node:fs');
        chmodSync(hookPath, 0o755);
        results.push('Installed .git/hooks/post-commit');
        ui.success('Installed post-commit hook (publishes to git:committed)');
      }
    }
  } else {
    ui.info('Skipping git hook (--no-hook)');
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
  console.log('    pd begin            # start a coordination session');
  console.log('    git commit          # fleet agents trigger automatically');
  console.log('');
}
