const KNOWN_PATH_PREFIXES = [
  'apps/',
  'bin/',
  'cli/',
  'completions/',
  'config/',
  'docs/',
  'fleet-config-ui/',
  'lib/',
  'mcp/',
  'public/',
  'routes/',
  'scripts/',
  'shared/',
  'skills/',
  'tests/',
  'website-v2/',
  '.cartographer/',
  '.claude-plugin/',
  '.portdaddy/',
  '.spark/',
  '.spider/',
];

// A dot anywhere in the basename is not enough: model ids like
// `ollama/qwen2.5-coder` carry version dots without being files. Require a
// trailing extension shape — final dot followed by a letter-led short suffix.
const TRAILING_FILE_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/**
 * Decide whether a slash-delimited token looks like a real repo path instead of
 * prose such as `FleetBar/control-plane` or `Center/Fleet`.
 *
 * Example:
 * - input: `fleet-config-ui/src/components/FileActionLinks.tsx`
 * - output: `true`
 *
 * Example:
 * - input: `FleetBar/control-plane`
 * - output: `false`
 *
 * Example:
 * - input: `ollama/qwen2.5-coder`
 * - output: `false`
 */
function looksLikeRepoPath(candidate: string): boolean {
  if (!candidate || !candidate.includes('/')) return false;
  if (candidate.includes('://')) return false;

  const normalized = candidate
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .replace(/^\.\.\//, '');

  if (!normalized) return false;
  if (KNOWN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) return false;

  const basename = parts[parts.length - 1] ?? '';
  return TRAILING_FILE_EXTENSION.test(basename);
}

/**
 * Extract likely repo-relative or absolute file paths from human-readable text.
 * The matcher is intentionally conservative so FleetBar shows real mutation
 * evidence instead of slash phrases pulled from prose.
 *
 * Example:
 * - input: `Touched fleet-config-ui/src/components/FileActionLinks.tsx and docs/recovery/CURRENT-WORK.md`
 * - output: `['fleet-config-ui/src/components/FileActionLinks.tsx', 'docs/recovery/CURRENT-WORK.md']`
 */
export function extractMentionedPaths(text: string, limit = 8): string[] {
  const matches = text.match(/(?:\.{1,2}\/|\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9_-]+)?/g) ?? [];
  return [...new Set(matches.filter(looksLikeRepoPath).slice(0, limit))];
}
