import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LEGACY_GIT_CHANNEL = '/msg/git:committed';
const SCOPED_CHANNEL_MARKER = 'CHANNEL="project:';
const PORT_DADDY_MARKERS = [
  'Port Daddy Post-Commit Hook',
  'Port Daddy fleet trigger',
  LEGACY_GIT_CHANNEL,
  'project-scoped git:committed',
];

export function isPortDaddyPostCommitHook(content: string): boolean {
  return PORT_DADDY_MARKERS.some(marker => content.includes(marker));
}

export function isLegacyPortDaddyPostCommitHook(content: string): boolean {
  if (!isPortDaddyPostCommitHook(content)) return false;
  if (content.includes(SCOPED_CHANNEL_MARKER)) return false;
  return content.includes(LEGACY_GIT_CHANNEL) || content.includes('Publishes to the git:committed channel');
}

export function isScopedPortDaddyPostCommitHook(content: string): boolean {
  return isPortDaddyPostCommitHook(content) && content.includes(SCOPED_CHANNEL_MARKER);
}

export function loadPostCommitHookTemplate(): string {
  const templatePath = fileURLToPath(new URL('../../templates/post-commit-hook', import.meta.url));
  return readFileSync(templatePath, 'utf-8');
}
