/**
 * Register the Port Daddy Pilot SessionStart steering hook into a project's
 * .claude/settings.json. Idempotent: re-running refreshes the script path
 * (e.g. after a brew upgrade) without duplicating the entry.
 *
 * The hook script itself (hooks/sessionstart-pilot.mjs) is dependency-free and
 * daemon-independent — see that file. This module only wires it into settings.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_FILENAME = 'sessionstart-pilot.mjs';

/**
 * Resolve the absolute path to the shipped SessionStart hook script. Checks, in
 * order: the brew share dir, an explicit projectRoot (dev checkout), and a
 * module-relative walk-up so callers that don't know the repo root still work.
 */
export function resolvePilotHookScript(projectRoot?: string): string | null {
  const candidates: string[] = [];
  const brew = spawnSync('brew', ['--prefix'], { encoding: 'utf8' });
  if (brew.status === 0) {
    candidates.push(join(brew.stdout.trim(), 'share', 'port-daddy', 'hooks', HOOK_FILENAME));
  }
  if (projectRoot) candidates.push(join(projectRoot, 'hooks', HOOK_FILENAME));

  // Module-relative fallback: walk up from this file looking for hooks/<name>.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    candidates.push(join(dir, 'hooks', HOOK_FILENAME));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return candidates.find((p) => existsSync(p)) ?? null;
}

interface ClaudeHookEntry {
  type: string;
  command: string;
}
interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}
interface ClaudeSettings {
  hooks?: { SessionStart?: ClaudeHookGroup[] } & Record<string, unknown>;
  [k: string]: unknown;
}

export interface PilotHookInstallResult {
  changed: boolean;
  settingsPath: string;
  command: string | null;
  reason: string;
}

/**
 * Add (or refresh) the Pilot SessionStart hook in <projectDir>/.claude/settings.json.
 *
 * We match our own entry by the hook filename so we never duplicate it and so a
 * moved script path gets rewritten in place. Any other SessionStart hooks
 * (e.g. `pd attention`) are preserved untouched.
 */
export function installPilotSessionStartHook(options: {
  projectDir: string;
  projectRoot: string;
  dryRun?: boolean;
}): PilotHookInstallResult {
  const settingsPath = join(options.projectDir, '.claude', 'settings.json');
  const script = resolvePilotHookScript(options.projectRoot);
  if (!script) {
    return { changed: false, settingsPath, command: null, reason: 'hook script not found' };
  }
  const command = `node ${script}`;

  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
    } catch {
      return { changed: false, settingsPath, command, reason: 'existing settings.json is not valid JSON — skipping' };
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
  const sessionStart = settings.hooks.SessionStart as ClaudeHookGroup[];

  // Find an existing group that already runs our script.
  let foundEntry: ClaudeHookEntry | null = null;
  for (const group of sessionStart) {
    for (const entry of group.hooks ?? []) {
      if (typeof entry.command === 'string' && entry.command.includes(HOOK_FILENAME)) {
        foundEntry = entry;
      }
    }
  }

  if (foundEntry) {
    if (foundEntry.command === command) {
      return { changed: false, settingsPath, command, reason: 'already registered' };
    }
    foundEntry.command = command; // refresh moved path
  } else {
    sessionStart.push({ hooks: [{ type: 'command', command }] });
  }

  if (!options.dryRun) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }
  return {
    changed: true,
    settingsPath,
    command,
    reason: foundEntry ? 'refreshed script path' : 'registered new hook',
  };
}
