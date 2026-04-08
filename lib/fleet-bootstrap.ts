import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isLegacyPortDaddyPostCommitHook,
  isScopedPortDaddyPostCommitHook,
  loadPostCommitHookTemplate,
} from './post-commit-hook.js';

export interface FleetBootstrapResult {
  fleetPath: string;
  createdFleetConfig: boolean;
  hookStatus: 'created' | 'upgraded' | 'merged' | 'already_current' | 'skipped_no_git' | 'missing_template';
  createdOutputDirs: string[];
  addedGitignoreEntries: string[];
  warnings: string[];
}

function loadStarterFleetTemplate(): string {
  const templatePath = fileURLToPath(new URL('../templates/pd-fleet-starter.yml', import.meta.url));
  return readFileSync(templatePath, 'utf-8');
}

export function ensureStarterFleetProject(projectDir: string): FleetBootstrapResult {
  const fleetPath = join(projectDir, 'pd-fleet.yml');
  const hookDir = join(projectDir, '.git', 'hooks');
  const hookPath = join(hookDir, 'post-commit');
  const warnings: string[] = [];
  const createdOutputDirs: string[] = [];
  const addedGitignoreEntries: string[] = [];

  let createdFleetConfig = false;
  if (!existsSync(fleetPath)) {
    writeFileSync(fleetPath, loadStarterFleetTemplate());
    createdFleetConfig = true;
  }

  let hookStatus: FleetBootstrapResult['hookStatus'] = 'skipped_no_git';
  if (existsSync(join(projectDir, '.git'))) {
    const hookTemplate = loadPostCommitHookTemplate();
    if (!hookTemplate.trim()) {
      hookStatus = 'missing_template';
      warnings.push('Could not load the Port Daddy post-commit hook template.');
    } else if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, 'utf-8');
      if (isScopedPortDaddyPostCommitHook(existing)) {
        hookStatus = 'already_current';
      } else if (isLegacyPortDaddyPostCommitHook(existing)) {
        writeFileSync(hookPath, hookTemplate);
        chmodSync(hookPath, 0o755);
        hookStatus = 'upgraded';
      } else {
        const withoutShebang = hookTemplate.replace(/^#!.*\n/, '');
        writeFileSync(hookPath, existing.trimEnd() + '\n\n# --- Port Daddy fleet trigger ---\n' + withoutShebang);
        chmodSync(hookPath, 0o755);
        hookStatus = 'merged';
      }
    } else {
      mkdirSync(hookDir, { recursive: true });
      writeFileSync(hookPath, hookTemplate);
      chmodSync(hookPath, 0o755);
      hookStatus = 'created';
    }
  }

  const outputDirs = [
    join(projectDir, '.spark', 'ideas'),
    join(projectDir, '.spider', 'connections'),
    join(projectDir, '.cartographer'),
  ];
  for (const dir of outputDirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      createdOutputDirs.push(dir);
    }
  }

  const gitignorePath = join(projectDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    const additions: string[] = [];
    if (!gitignore.includes('.spark/')) additions.push('.spark/');
    if (!gitignore.includes('.spider/')) additions.push('.spider/');
    if (!gitignore.includes('.cartographer/')) additions.push('.cartographer/');
    if (additions.length > 0) {
      writeFileSync(gitignorePath, gitignore.trimEnd() + '\n\n# Port Daddy fleet output\n' + additions.join('\n') + '\n');
      addedGitignoreEntries.push(...additions);
    }
  }

  return {
    fleetPath,
    createdFleetConfig,
    hookStatus,
    createdOutputDirs,
    addedGitignoreEntries,
    warnings,
  };
}
