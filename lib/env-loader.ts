/**
 * Synchronous .env file loader for daemon startup.
 *
 * Why this exists separately: server.ts must snapshot sensitive env vars
 * (lib/secret-env.ts) very early, but the values often live in
 * .env / .env.local at the project root rather than in launchd's env.
 * If we load env files only at fleet-daemon startup (which happens
 * after the snapshot), getSecret() returns undefined because the
 * snapshot ran on an empty env.
 *
 * Fix: load env files BEFORE snapshotSensitiveEnv(). This module is
 * the shared loader called from both places.
 *
 * Order of precedence (first wins): existing process.env > .env.local > .env > .port-daddy-env
 * Existing env vars are never overwritten — explicit launchd config wins.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE_NAMES = ['.env.local', '.env', '.port-daddy-env'] as const;

export function loadEnvFiles(projectDir: string): void {
  const searchDirs = [projectDir, process.env.HOME || ''];

  for (const dir of searchDirs) {
    if (!dir) continue;
    for (const name of FILE_NAMES) {
      try {
        const lines = readFileSync(join(dir, name), 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      } catch {
        // Non-critical — file likely doesn't exist
      }
    }
  }
}
