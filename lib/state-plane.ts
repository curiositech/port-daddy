/**
 * Port Daddy — State-Plane Classification (S1: daemon plane identity)
 *
 * Every daemon self-classifies which *state plane* it lives on at boot, and
 * surfaces that plane everywhere its identity travels (`GET /version`,
 * `GET /health`, the berth registry, the daemon heartbeat file). The plane
 * answers one operator question: **"if I write through this daemon, whose
 * state am I mutating?"**
 *
 *   - `prod`               — the canonical `~/.port-daddy` daemon. Writes are real.
 *   - `dev-latest`         — the standing origin/main lane on :9886.
 *   - `ephemeral:<label>`  — any other berth (worktree/codebase/soak daemon);
 *                            state is disposable with the berth.
 *
 * Classification is a pure function of injected signals — no env reads — so it
 * is exhaustively unit-testable (tests/unit/state-plane.test.js) and can never
 * block boot. The one filesystem touch is a best-effort `realpathSync` when
 * comparing the prefix against `~/.port-daddy`, so a symlinked prefix cannot
 * hide the prod plane; it never throws (missing paths fall back to the
 * string-resolved form).
 *
 * Precedence (first match wins):
 *   1. Explicit `PORT_DADDY_PLANE` override.
 *   2. Canonical prefix (unset prefix, or a path resolving to `~/.port-daddy`) → `prod`.
 *   3. The dev-latest lane: port {@link DEV_LATEST_PORT} or a profile literally
 *      named `dev-latest`.
 *   4. `ephemeral:<basename of prefix, else profile name, else "unknown">`.
 *
 * Scope guard: this module is identity ONLY. Provenance envelopes, write
 * policies, and quarantine are S2/S3 territory and do not belong here.
 */

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DEV_LATEST_PORT } from '../shared/daemon-berths.js';

/** The env var a daemon reads for an explicit plane override. Wins over inference. */
export const STATE_PLANE_ENV = 'PORT_DADDY_PLANE';

/** A daemon's state plane. `ephemeral:` carries the berth/worktree label. */
export type StatePlane = 'prod' | 'dev-latest' | `ephemeral:${string}`;

export interface ClassifyPlaneInput {
  /** `PORT_DADDY_PREFIX` — unset/empty means the canonical `~/.port-daddy` install. */
  prefixPath?: string | null;
  /** The TCP port this daemon is configured to bind. */
  port?: number | null;
  /** The berth/profile label (`PD_DAEMON_LABEL`), when one was set at launch. */
  profileName?: string | null;
  /** Raw `PORT_DADDY_PLANE` value — an explicit override that wins outright. */
  envOverride?: string | null;
  /** Injectable home directory (tests). Defaults to `os.homedir()`. */
  homeDir?: string;
}

/** Expand a leading `~` / `~/…` to the given home directory. */
function expandTilde(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

/** Trim trailing path separators without destroying the root path itself. */
function stripTrailingSlashes(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * Best-effort symlink resolution. Missing paths (unit tests, not-yet-created
 * prefixes) fall back to the input unchanged — this never throws, so it can
 * never block boot.
 */
function tryRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Normalize an explicit `PORT_DADDY_PLANE` override into the plane union.
 * Known planes pass through verbatim; anything else is namespaced as
 * `ephemeral:<value>` so a typo can never masquerade as prod.
 */
function normalizeOverride(raw: string): StatePlane {
  if (raw === 'prod' || raw === 'dev-latest') return raw;
  if (raw.startsWith('ephemeral:')) return raw as StatePlane;
  return `ephemeral:${raw}`;
}

/**
 * Classify which state plane a daemon lives on. Pure — see module docs for
 * the precedence ladder.
 *
 * Input:
 *
 * ```ts
 * classifyPlane({ prefixPath: '~/coding/tmp/pd-feat-x', port: 4242 })
 * ```
 *
 * Output:
 *
 * ```ts
 * 'ephemeral:pd-feat-x'
 * ```
 */
export function classifyPlane(input: ClassifyPlaneInput): StatePlane {
  const home = input.homeDir ?? homedir();

  // 1. Explicit override wins.
  const override = input.envOverride?.trim();
  if (override) return normalizeOverride(override);

  // 2. Canonical prefix → prod. An unset prefix means the daemon runs out of
  //    the default ~/.port-daddy install (the brew/launchd daemon).
  const rawPrefix = input.prefixPath?.trim();
  if (!rawPrefix) return 'prod';
  const resolvedPrefix = stripTrailingSlashes(resolve(expandTilde(rawPrefix, home)));
  const canonical = stripTrailingSlashes(resolve(join(home, '.port-daddy')));
  if (resolvedPrefix === canonical) return 'prod';
  // Compare real filesystem identity too: a symlinked PORT_DADDY_PREFIX that
  // points at ~/.port-daddy (or vice versa) is still the prod plane.
  if (tryRealpath(resolvedPrefix) === tryRealpath(canonical)) return 'prod';

  // 3. The standing dev-latest lane.
  if (input.port === DEV_LATEST_PORT) return 'dev-latest';
  if (input.profileName?.trim() === 'dev-latest') return 'dev-latest';

  // 4. Everything else is ephemeral, labeled by where it lives.
  const prefixLabel = basename(resolvedPrefix).trim();
  const label = prefixLabel || input.profileName?.trim() || 'unknown';
  return `ephemeral:${label}`;
}

/** True only for the canonical prod plane. Null/undefined/unknown → false. */
export function isProdPlane(plane: string | null | undefined): boolean {
  return plane === 'prod';
}
