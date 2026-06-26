/**
 * Version Staleness — the passive once/day "you're behind" nudge (ADR-0054 Phase 2)
 *
 * Port Daddy already has two ACTIVE upgrade paths, both built on the published
 * `latest.json` feed (ADR-0057):
 *   - `pd upgrade`     — interactive: checks the feed, `--apply` runs brew upgrade.
 *   - `pd self-update` — unattended hourly brew-upgrade LaunchAgent (ADR-0062),
 *                        macOS + Homebrew only.
 *
 * Both require the user to either remember to run a command or be on a brew/macOS
 * box. An npm install, a Linux box, or a brew user who disabled the LaunchAgent
 * gets NO signal that their `pd` has drifted behind the latest release.
 *
 * This module is the cross-platform complement: a lightweight, PASSIVE check that,
 * at most once a day on `pd` startup, prints a one-line nudge when the running
 * binary is behind — then points at the existing `pd upgrade` to do the work:
 *
 *     pd 3.19.0 installed; 3.22.0 available — run `pd upgrade` to update
 *
 * It NEVER upgrades anything. On an auto-upgraded machine the binary is never
 * behind, so this stays silent — complementary, not redundant.
 *
 * It deliberately reuses the SAME feed + schema + semver math as `pd upgrade`
 * (lib/latest-manifest.ts) rather than introducing a parallel version-check path.
 * The only thing it adds is the once/day throttle and the fail-soft, stderr-only,
 * TTY-gated nudge wiring.
 *
 * Design constraints:
 *   - Fail-soft ALWAYS. No network, a 500, a malformed feed, clock skew: all
 *     degrade to "say nothing", never throw. (This is the opposite stance from
 *     `pd upgrade`, which fails loud — correct there, wrong for a passive nudge.)
 *   - Throttled. At most one network call per day. 99% of invocations read a tiny
 *     cache file and do a string compare — microseconds, no network.
 *   - Injectable. Fetch, clock, and state I/O are injectable for unit tests.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PD_HOME } from '../shared/paths.js';
import {
  parseLatestManifest,
  isNewerVersion,
  DEFAULT_LATEST_FEED_URL,
} from './latest-manifest.js';

/** Throttle window: check the network at most this often. */
export const DEFAULT_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** Network budget for the feed lookup. Kept tight — this is on a hot path. */
export const DEFAULT_FETCH_TIMEOUT_MS = 1500;

/** Where the throttle cache lives. */
export const UPDATE_CHECK_FILE = join(PD_HOME, 'update-check.json');

/** Opt out of the whole mechanism. */
export const OPT_OUT_ENV = 'PORT_DADDY_NO_UPDATE_CHECK';

/** Resolve the feed URL, honoring the same override `pd upgrade` uses. */
export function resolveFeedUrl(): string {
  return (process.env.PORT_DADDY_LATEST_FEED ?? DEFAULT_LATEST_FEED_URL).trim();
}

/** True iff `current` is strictly older than `latest`, never throwing. */
export function isBehind(current: string | null | undefined, latest: string | null | undefined): boolean {
  if (!current || !latest) return false;
  try {
    return isNewerVersion(latest, current);
  } catch {
    return false;
  }
}

/** The one-line nudge. Points at the existing `pd upgrade` (cross-platform). */
export function formatStalenessNudge(current: string, latest: string): string {
  return `pd ${current} installed; ${latest} available — run \`pd upgrade\` to update`;
}

// ---------------------------------------------------------------------------
// Network: latest version from the published feed
// ---------------------------------------------------------------------------

export interface FetchLatestOptions {
  url?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch + validate the `latest.json` feed and return its advertised version.
 * Reuses `parseLatestManifest` (schema validation) so it can't disagree with
 * `pd upgrade` about what a valid feed looks like. Fail-soft: returns `null` on
 * timeout, non-2xx, network error, or a malformed feed. Never throws.
 */
export async function fetchLatestFeedVersion(opts: FetchLatestOptions = {}): Promise<string | null> {
  const url = opts.url ?? resolveFeedUrl();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'port-daddy-cli' },
    });
    if (!res.ok) return null;
    const manifest = parseLatestManifest(await res.json());
    return manifest.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Throttle state
// ---------------------------------------------------------------------------

export interface UpdateCheckState {
  /** Epoch ms of the last network attempt (success or failure). */
  checkedAt: number;
  /** Last known latest version, or null if the last fetch failed. */
  latest: string | null;
}

export function readUpdateCheckState(file: string = UPDATE_CHECK_FILE): UpdateCheckState | null {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<UpdateCheckState>;
    if (typeof parsed?.checkedAt !== 'number') return null;
    return {
      checkedAt: parsed.checkedAt,
      latest: typeof parsed.latest === 'string' ? parsed.latest : null,
    };
  } catch {
    return null;
  }
}

export function writeUpdateCheckState(state: UpdateCheckState, file: string = UPDATE_CHECK_FILE): void {
  try {
    writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // Best-effort; a missing cache just means we re-check next time.
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface EvaluateStalenessOptions {
  /** The running version (e.g. PKG.version). */
  current: string;
  /** Bypass the throttle and always hit the network. */
  force?: boolean;
  throttleMs?: number;
  now?: () => number;
  stateFile?: string;
  fetchLatest?: (opts?: FetchLatestOptions) => Promise<string | null>;
  fetchOptions?: FetchLatestOptions;
  /** Injectable state accessors (default to the on-disk cache). For tests. */
  readState?: (file: string) => UpdateCheckState | null;
  writeState?: (state: UpdateCheckState, file: string) => void;
}

export interface StalenessResult {
  current: string;
  latest: string | null;
  behind: boolean;
  /** Where `latest` came from: a fresh network call, the throttle cache, or nothing. */
  source: 'network' | 'cache' | 'none';
  /** The ready-to-print nudge, present only when `behind`. */
  nudge?: string;
}

/**
 * Decide whether the running `pd` is behind the latest release, respecting the
 * once/day throttle. Within the throttle window it answers from cache (no
 * network); outside it (or when `force`) it fetches and refreshes the cache.
 * Always resolves — never throws.
 */
export async function evaluateStaleness(opts: EvaluateStalenessOptions): Promise<StalenessResult> {
  const now = opts.now ?? Date.now;
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  const stateFile = opts.stateFile ?? UPDATE_CHECK_FILE;
  const fetchLatest = opts.fetchLatest ?? fetchLatestFeedVersion;
  const readState = opts.readState ?? readUpdateCheckState;
  const writeState = opts.writeState ?? writeUpdateCheckState;

  const cached = readState(stateFile);
  const withinWindow = !opts.force && cached !== null && now() - cached.checkedAt < throttleMs;

  let latest: string | null;
  let source: StalenessResult['source'];
  if (withinWindow) {
    latest = cached!.latest;
    source = latest ? 'cache' : 'none';
  } else {
    latest = await fetchLatest(opts.fetchOptions);
    // Record the attempt timestamp regardless of success so a network outage
    // throttles retries to once/day instead of hammering on every command.
    writeState({ checkedAt: now(), latest }, stateFile);
    source = latest ? 'network' : 'none';
  }

  const behind = isBehind(opts.current, latest);
  const result: StalenessResult = { current: opts.current, latest, behind, source };
  if (behind && latest) result.nudge = formatStalenessNudge(opts.current, latest);
  return result;
}
