import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type winston from 'winston';
import { loadUiPreferences } from './ui-preferences.js';

interface FleetBarLaunchResult {
  launched: boolean;
  reason: string;
  target?: string;
}

type FleetBarTarget =
  | { kind: 'app'; path: string }
  | { kind: 'bin'; path: string };

function isFleetBarRunning(): boolean {
  try {
    const result = spawnSync('/usr/bin/pgrep', ['-x', 'FleetBar'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function findFleetBarTarget(repoRoot: string): FleetBarTarget | null {
  const home = process.env.HOME || '';
  const targets: FleetBarTarget[] = [
    { kind: 'app', path: join('/Applications', 'FleetBar.app') },
    { kind: 'app', path: join(home, 'Applications', 'FleetBar.app') },
    { kind: 'bin', path: join(repoRoot, 'apps', 'FleetBar', '.build', 'arm64-apple-macosx', 'release', 'FleetBar') },
    { kind: 'bin', path: join(repoRoot, 'apps', 'FleetBar', '.build', 'arm64-apple-macosx', 'debug', 'FleetBar') },
  ];

  return targets.find((target) => existsSync(target.path)) ?? null;
}

function spawnDetached(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    env: env ? { ...process.env, ...env } : process.env,
  });
  child.unref();
}

export function launchFleetBarIfEnabled(opts: {
  logger: winston.Logger;
  repoRoot: string;
  daemonPort: number;
}): FleetBarLaunchResult {
  const { logger, repoRoot, daemonPort } = opts;

  if (process.platform !== 'darwin') {
    return { launched: false, reason: 'not_macos' };
  }

  const prefs = loadUiPreferences();
  if (!prefs.launchFleetBarOnDaemonStart) {
    return { launched: false, reason: 'disabled_by_user' };
  }

  if (isFleetBarRunning()) {
    return { launched: false, reason: 'already_running' };
  }

  const target = findFleetBarTarget(repoRoot);
  if (!target) {
    logger.info('fleetbar_launch_skipped', {
      reason: 'not_found',
      searchedFrom: repoRoot,
    });
    return { launched: false, reason: 'not_found' };
  }

  try {
    if (target.kind === 'app') {
      spawnDetached('/usr/bin/open', ['-g', target.path]);
    } else {
      spawnDetached(target.path, [], {
        PORT_DADDY_PORT: String(daemonPort),
        PORT_DADDY_URL: `http://localhost:${daemonPort}`,
      });
    }

    logger.info('fleetbar_launch_requested', {
      target: target.path,
      kind: target.kind,
      daemonPort,
    });

    return { launched: true, reason: 'launched', target: target.path };
  } catch (error) {
    logger.warn('fleetbar_launch_failed', {
      target: target.path,
      error: (error as Error).message,
    });
    return { launched: false, reason: 'spawn_failed', target: target.path };
  }
}
