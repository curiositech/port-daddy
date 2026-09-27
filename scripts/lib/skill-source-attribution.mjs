import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

// An upstream attribution may survive a product rename without becoming a
// first-party discovery, hook, execution, or installation authority.
export const RETIRED_TOKEN = ['win', 'dags'].join('');
export const MANIFEST_PATH = 'config/skill-source-attribution.json';
export const CATALOG_PATH = 'docs/research/skills-reconciliation-20260923/skill-catalog.csv';
const REPORT_PREFIX = 'docs/research/skills-reconciliation-20260923/';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const containsAttribution = (path, bytes) =>
  path.toLowerCase().includes(RETIRED_TOKEN) || bytes.toString('utf8').toLowerCase().includes(RETIRED_TOKEN);

export function eligibleAttributionPath(path, sourceNames) {
  if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\') ||
      path.split('/').some((part) => !part || part === '.' || part === '..')) return false;
  const parts = path.split('/');
  const authorityNames = new Set(['agents.md', 'claude.md', 'gemini.md', '.claude', '.codex', '.cursor', '.agents', '.gemini', '.github', 'hooks']);
  if (parts.some((part) => authorityNames.has(part.toLowerCase()))) return false;
  if (path.startsWith(REPORT_PREFIX)) return true;
  return parts.length >= 3 && parts[0] === 'skills' && sourceNames.has(parts[1]) &&
    !parts[1].startsWith('port-daddy') && !parts[1].startsWith('jury-rig');
}

export function validateAttributionManifest(manifest, files, sourceNames) {
  const errors = [];
  if (!manifest || Object.keys(manifest).sort().join(',') !== 'entries,schemaVersion' ||
      manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) return ['invalid manifest schema'];
  const approved = new Set();
  for (const entry of manifest.entries) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'path,sha256' ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !eligibleAttributionPath(entry.path, sourceNames)) {
      errors.push(`ineligible attribution: ${entry?.path}`);
      continue;
    }
    if (approved.has(entry.path)) errors.push(`duplicate attribution: ${entry.path}`);
    approved.add(entry.path);
    const bytes = files.get(entry.path);
    if (!bytes || digest(bytes) !== entry.sha256) errors.push(`stale attribution: ${entry.path}`);
    else if (!containsAttribution(entry.path, bytes)) errors.push(`unneeded attribution: ${entry.path}`);
  }
  for (const [path, bytes] of files) {
    if (path !== MANIFEST_PATH && containsAttribution(path, bytes) && !approved.has(path)) {
      errors.push(`unreviewed attribution: ${path}`);
    }
  }
  return errors;
}

// Follow internal reference links, but never hash external content into this
// repository's receipt. Process one file at a time; large unrelated PDFs and
// images do not accumulate in the validation map.
export function isContainedTarget(root, target) {
  const path = relative(root, target);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

export function collectAttributionFiles(repo, manifest = { entries: [] }) {
  const root = realpathSync(repo);
  const referenced = new Set((manifest.entries ?? []).map((entry) => entry.path));
  const paths = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })
    .toString('utf8').split('\0').filter((path) => path && existsSync(join(root, path))))].sort();
  const files = new Map();
  for (const path of paths) {
    if (!isContainedTarget(root, realpathSync(join(root, path)))) throw new Error(`External source target: ${path}`);
    const bytes = readFileSync(join(root, path));
    if (referenced.has(path) || containsAttribution(path, bytes)) files.set(path, bytes);
  }
  return files;
}
