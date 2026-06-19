import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const PROJECT_SCOPE_HASH_LENGTH = 12;
const PROJECT_SCOPE_SLUG_MAX = 24;
const GLOBAL_PREFIX = 'global:';
const PROJECT_PREFIX = 'project:';

function normalizeProjectSlug(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned || 'project').slice(0, PROJECT_SCOPE_SLUG_MAX);
}

function projectScopeHash(projectDir: string): string {
  return createHash('sha256')
    .update(projectDir.replace(/\\/g, '/'))
    .digest('hex')
    .slice(0, PROJECT_SCOPE_HASH_LENGTH);
}

export function getProjectScope(projectDir: string, projectName?: string): string {
  const slug = normalizeProjectSlug(projectName || basename(projectDir));
  return `${PROJECT_PREFIX}${slug}:${projectScopeHash(projectDir)}`;
}

export function resolveFleetChannel(channel: string, projectDir: string, projectName?: string): string {
  const trimmed = channel.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith(PROJECT_PREFIX)) return trimmed;
  if (trimmed.startsWith(GLOBAL_PREFIX)) return trimmed.slice(GLOBAL_PREFIX.length);
  return `${getProjectScope(projectDir, projectName)}:${trimmed}`;
}

export function projectScopedGitChannel(projectDir: string, projectName?: string): string {
  return resolveFleetChannel('git:committed', projectDir, projectName);
}
