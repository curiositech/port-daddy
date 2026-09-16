import { homedir } from 'node:os';

/**
 * Renders a local path without disclosing an operator's absolute home
 * directory. The daemon profile and Squid preview both surface local
 * provenance, so they share this boundary rather than growing subtly
 * different redaction rules over time.
 *
 * @param path candidate local path; absent runtime metadata is rendered as a
 *   clear placeholder rather than throwing while reporting a degraded daemon.
 * @param home home directory to collapse, mainly injectable for deterministic
 *   CLI tests and provider environments that use USERPROFILE instead of HOME.
 * @returns a stable display path with the home prefix collapsed to `~`.
 */
export function displayPathRelativeToHome(
  path: string | null | undefined,
  home = process.env.HOME || process.env.USERPROFILE || homedir(),
): string {
  if (!path) return '-';

  const trimTrailingSlashes = (value: string): string => value === '/' ? value : value.replace(/\/+$/, '');
  const normalizedHome = trimTrailingSlashes(home);
  const normalizedPath = trimTrailingSlashes(path);

  // An unavailable HOME must not make every absolute path look private.
  if (!normalizedHome) return normalizedPath;
  if (normalizedPath === normalizedHome) return '~';
  if (normalizedHome === '/') return normalizedPath.startsWith('/') ? `~${normalizedPath}` : normalizedPath;
  return normalizedPath.startsWith(`${normalizedHome}/`)
    ? `~/${normalizedPath.slice(normalizedHome.length + 1)}`
    : normalizedPath;
}
