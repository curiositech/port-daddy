/**
 * `pd upgrade` — the user-facing update-channel command (ADR-0057 phase 7,
 * "dist-update-channel").
 *
 * Fetches the published `latest.json` feed, compares the advertised version to
 * the version embedded in THIS binary, and reports (or, with `--apply`, performs)
 * an update. Honest about privilege: a brew-installed daemon is replaced by
 * Homebrew, so `--apply` shells out to `brew upgrade <formula>` rather than
 * pretending to self-replace a running, possibly-signed binary in place. When
 * the install is NOT a Homebrew install (npm, source, manual), `pd upgrade`
 * reports the newer version + the verified download URL and instructs the user
 * — it does not silently overwrite an artifact it did not install.
 *
 * Distinct from `pd self-update` (ADR-0062): that is the unattended hourly
 * freshness LaunchAgent that always brew-upgrades + restarts the daemon and
 * FleetBar. `pd upgrade` is the interactive "is there a newer release, and what
 * is it" command that consumes the shared feed. They share the brew path; they
 * differ in audience.
 *
 * Integrity, stated plainly: `pd upgrade` SURFACES the daemon asset's published
 * SHA-256 from the feed (so a human/GUI can verify a manual download) but does
 * NOT itself download-then-verify the bottle. On `--apply` it shells out to
 * `brew upgrade <formula>`, and Homebrew is what actually verifies the bottle's
 * integrity before installing it. `verifyChecksum` / `sha256File` below are
 * helpers for the deferred manual/GUI verify path; the current command does not
 * exercise them on its own download.
 *
 * What is wired vs. deferred (honest):
 *   - Detect newer version from the feed:           DONE (decideUpgrade)
 *   - Surface the asset's published SHA-256:        DONE (printed in the report)
 *   - Verify the actual installed bottle's integrity: DELEGATED to Homebrew
 *     (`brew upgrade` checks the bottle; `pd upgrade` does not re-download)
 *   - Standalone SHA-256 verify of a manual download: helper only, NOT invoked
 *     by this command (verifyChecksum/sha256File — for the deferred GUI path)
 *   - Perform the brew-upgrade path (--apply):      DONE (macOS + brew install)
 *   - Privileged in-place self-replace of a signed
 *     relocated binary:                             DEFERRED to brew by design
 *     (a process replacing its own signed executable mid-run is unsafe; brew
 *     owns the formula's bottle + the launchd restart).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import {
  parseLatestManifest,
  decideUpgrade,
  artifactFor,
  DEFAULT_LATEST_FEED_URL,
  type LatestManifest,
  type UpgradeDecision,
} from '../../lib/latest-manifest.js';

/**
 * Default location of the published feed (ADR-0057 §5). Re-exported from
 * lib/latest-manifest.ts — the single source of truth, shared with the passive
 * staleness nudge. Overridable with `--feed <url>` or `PORT_DADDY_LATEST_FEED`.
 */
export const DEFAULT_FEED_URL = DEFAULT_LATEST_FEED_URL;

const FORMULA = 'port-daddy';

interface ShResult { code: number; stdout: string; stderr: string }
function sh(cmd: string, args: string[], timeoutMs = 600_000): ShResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Compute the lowercase-hex SHA-256 of a file on disk. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * PURE: does a file's bytes match the expected checksum? `expected` is compared
 * case-insensitively against the lowercase-hex digest of the file.
 *
 * NOTE (honest): this helper is NOT invoked by the current `pd upgrade` flow —
 * `--apply` delegates bottle integrity to `brew upgrade`, and the bare path only
 * prints the published SHA-256. It exists for the deferred manual/GUI verify
 * path (verify a hand-downloaded asset against the feed's advertised digest) and
 * is unit-tested directly so that path is ready when wired.
 */
export function verifyChecksum(path: string, expected: string): boolean {
  if (!existsSync(path)) return false;
  return sha256File(path) === expected.trim().toLowerCase();
}

/**
 * Is the running `pd` a Homebrew install? If the resolved binary lives under a
 * Homebrew Cellar/prefix, `brew upgrade` is the correct apply path. We probe by
 * asking brew where its formula is rather than string-sniffing argv[0], so a
 * symlinked `pd` still resolves correctly. Pure-ish: shells out to `brew`, but
 * the *decision* is structured (exit code + path prefix), not text heuristics.
 */
export function isHomebrewInstall(runner: (cmd: string, args: string[]) => ShResult = sh): boolean {
  if (process.platform === 'win32') return false;
  const r = runner('brew', ['--prefix', FORMULA]);
  if (r.code !== 0) return false;
  const prefix = r.stdout.trim();
  return prefix.length > 0 && existsSync(prefix);
}

export interface UpgradeOptions {
  /** Feed URL override (else PORT_DADDY_LATEST_FEED, else DEFAULT_FEED_URL). */
  feed?: string;
  /** Actually perform the upgrade (brew path) rather than only reporting. */
  apply?: boolean;
  /** Emit machine-readable JSON instead of human text. */
  json?: boolean;
}

/** Resolve the effective feed URL from option → env → default. */
export function resolveFeedUrl(opt?: string): string {
  return (opt ?? process.env.PORT_DADDY_LATEST_FEED ?? DEFAULT_FEED_URL).trim();
}

/**
 * Fetch + parse the feed. Separated so callers (and tests) can inject a fetched
 * body. Uses the global `fetch` (Node 18+/bun). Network/parse failures throw a
 * descriptive error so a broken feed never silently reads as "up to date."
 */
export async function fetchManifest(feedUrl: string): Promise<LatestManifest> {
  let res: Response;
  try {
    res = await fetch(feedUrl, { redirect: 'follow' });
  } catch (e) {
    throw new Error(`could not reach update feed ${feedUrl}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`update feed ${feedUrl} returned HTTP ${res.status}`);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (e) {
    throw new Error(`update feed ${feedUrl} was not valid JSON: ${(e as Error).message}`);
  }
  return parseLatestManifest(raw);
}

/**
 * Render the decision for a human. Kept separate from IO so the formatting is
 * trivially testable and the dispatch stays a thin shell.
 */
export function formatDecision(decision: UpgradeDecision, manifest: LatestManifest, brewInstall: boolean): string[] {
  const lines: string[] = [];
  if (!decision.upgradeAvailable) {
    lines.push(`Port Daddy ${decision.current} is current (latest release: ${decision.latest}).`);
    return lines;
  }
  lines.push(`A newer Port Daddy is available: ${decision.current} → ${decision.latest}`);
  if (manifest.releaseUrl) lines.push(`  Release notes: ${manifest.releaseUrl}`);
  const daemon = artifactFor(manifest, 'daemon');
  if (daemon) {
    lines.push(`  Daemon asset:  ${daemon.url}`);
    lines.push(`  SHA-256:       ${daemon.sha256}`);
    lines.push(`  Signed:        ${daemon.signed ? 'yes (Developer ID + notarized)' : 'no'}`);
  }
  if (brewInstall) {
    lines.push('');
    lines.push('To upgrade:  pd upgrade --apply    (runs `brew upgrade port-daddy`)');
    lines.push('         or:  brew upgrade port-daddy');
  } else {
    lines.push('');
    lines.push('This `pd` was not installed via Homebrew, so `pd upgrade --apply` will not');
    lines.push('replace it. Reinstall from the verified asset above, or:');
    lines.push('  npm:   npm install -g port-daddy@latest');
    lines.push('  brew:  brew install curiositech/tap/port-daddy   (then `pd upgrade --apply`)');
  }
  return lines;
}

export interface HandleUpgradeResult {
  current: string;
  latest: string;
  upgradeAvailable: boolean;
  applied: boolean;
  /** Non-zero on a hard failure (feed unreachable, brew upgrade failed). */
  exitCode: number;
}

/**
 * `pd upgrade` entry point. `currentVersion` is the embedded `PKG.version` so
 * the comparison is against the version THIS binary actually ships, not a value
 * read at runtime from a possibly-newer source tree (the Goodhart trap ADR-0057
 * calls out).
 */
export async function handleUpgrade(
  currentVersion: string,
  options: UpgradeOptions = {},
): Promise<HandleUpgradeResult> {
  const feedUrl = resolveFeedUrl(options.feed);
  const manifest = await fetchManifest(feedUrl);
  const decision = decideUpgrade(currentVersion, manifest);
  const brewInstall = isHomebrewInstall();

  if (options.json) {
    console.log(JSON.stringify({
      current: decision.current,
      latest: decision.latest,
      upgradeAvailable: decision.upgradeAvailable,
      homebrewInstall: brewInstall,
      feed: feedUrl,
      releaseUrl: manifest.releaseUrl,
      daemon: decision.daemonArtifact,
    }, null, 2));
  } else {
    for (const line of formatDecision(decision, manifest, brewInstall)) console.log(line);
  }

  if (!decision.upgradeAvailable) {
    return { current: decision.current, latest: decision.latest, upgradeAvailable: false, applied: false, exitCode: 0 };
  }

  if (!options.apply) {
    return { current: decision.current, latest: decision.latest, upgradeAvailable: true, applied: false, exitCode: 0 };
  }

  // --apply path. Honest: we only self-apply the install method we own (brew).
  if (!brewInstall) {
    if (!options.json) {
      console.log('');
      console.log('Refusing to self-replace a non-Homebrew install. Follow the instructions above.');
    }
    return { current: decision.current, latest: decision.latest, upgradeAvailable: true, applied: false, exitCode: 1 };
  }
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    if (!options.json) console.log('`pd upgrade --apply` is supported on macOS and Linux Homebrew installs only.');
    return { current: decision.current, latest: decision.latest, upgradeAvailable: true, applied: false, exitCode: 1 };
  }

  if (!options.json) console.log('\nUpgrading via Homebrew…');
  sh('brew', ['update'], 120_000);
  const up = sh('brew', ['upgrade', FORMULA]);
  if (up.code !== 0) {
    if (!options.json) {
      console.log('brew upgrade failed:');
      if (up.stderr.trim()) console.log(up.stderr.trim());
    }
    return { current: decision.current, latest: decision.latest, upgradeAvailable: true, applied: false, exitCode: up.code };
  }
  // Restart the daemon onto the new code if it's brew-supervised (best effort).
  if (process.platform === 'darwin') {
    sh('brew', ['services', 'restart', FORMULA], 60_000);
  }
  if (!options.json) console.log(`Upgraded to ${decision.latest}. Run \`pd version\` to confirm.`);
  return { current: decision.current, latest: decision.latest, upgradeAvailable: true, applied: true, exitCode: 0 };
}
