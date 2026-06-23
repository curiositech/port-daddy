/**
 * lib/latest-manifest.ts — the `latest.json` update feed (ADR-0057 phase 7,
 * "dist-update-channel").
 *
 * `latest.json` is the single, signed-adjacent manifest published alongside each
 * GitHub Release that describes the current version plus, per distributable
 * surface (daemon, console, fleetbar), a download URL + SHA-256 checksum. It is
 * the Tauri/Sparkle-shaped feed the `rust-app-distribution` skill documents and
 * the shared update channel ADR-0057 §5 requires: one feed, every limb checks
 * the same truth.
 *
 * This module is intentionally dependency-free and side-effect-free so it can be
 * imported by (a) `scripts/build-latest-json.mjs` at release time to GENERATE the
 * manifest from built artifacts, and (b) `cli/commands/upgrade.ts` (and, later,
 * the GUI apps) to PARSE a fetched manifest and decide whether an upgrade is
 * available. Keeping the schema + semver math in one tested place means the
 * producer and every consumer agree by construction.
 *
 * No keyword/NLP guessing lives here — every comparison is over structured
 * semver fields and exact checksum hex.
 */

/** Schema version of the manifest envelope itself (NOT the product version). */
export const LATEST_MANIFEST_SCHEMA = 1 as const;

/**
 * The distributable surfaces ADR-0057 unifies. `daemon` is the bun-compiled
 * `pd` CLI/daemon (the formula); `console` is the signed `pd-console.app`;
 * `fleetbar` is the signed FleetBar menu-bar `.app`. The MCP server and agent
 * skill ride inside the daemon binary, so they are surfaces of `daemon`, not
 * separate feed entries (ADR-0057 "What rides along for free").
 */
export type ArtifactSurface = 'daemon' | 'console' | 'fleetbar';

/** A single per-artifact entry in the feed. */
export interface ArtifactEntry {
  /** Stable surface id. */
  surface: ArtifactSurface;
  /** Filename of the release asset (e.g. `pd-darwin-arm64.tar.gz`). */
  filename: string;
  /** Absolute download URL on the GitHub Release. */
  url: string;
  /** Lowercase hex SHA-256 of the asset bytes. */
  sha256: string;
  /** Asset size in bytes, when known (null if the producer could not stat it). */
  sizeBytes: number | null;
  /** Target triple / platform tag for the asset (e.g. `darwin-arm64`). */
  platform: string;
  /** Was this artifact Developer-ID signed + notarized at release time? */
  signed: boolean;
}

/** The published feed. */
export interface LatestManifest {
  /** Envelope schema version (LATEST_MANIFEST_SCHEMA). */
  schema: number;
  /** The product version this release ships, e.g. `3.20.0` (no leading `v`). */
  version: string;
  /** The git tag the release was cut from, e.g. `v3.20.0`. */
  tag: string;
  /** ISO-8601 timestamp the feed was generated. */
  publishedAt: string;
  /** Canonical URL of the GitHub Release page. */
  releaseUrl: string;
  /** The Homebrew formula name that delivers the daemon (`pd upgrade` re-points brew here). */
  brewFormula: string;
  /** Per-surface artifacts. */
  artifacts: ArtifactEntry[];
}

/** Parsed, validated semantic version. Prerelease/build metadata is preserved for display but does NOT affect ordering beyond the prerelease rule below. */
export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers (empty for a normal release). */
  prerelease: string[];
}

/**
 * Parse a semver string. Accepts an optional leading `v`. Returns null for
 * anything that is not `MAJOR.MINOR.PATCH[-prerelease][+build]`. Build metadata
 * is ignored (per semver §10 it does not participate in precedence).
 */
export function parseSemver(input: string): ParsedSemver | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().replace(/^v(?=\d)/i, '');
  // MAJOR.MINOR.PATCH, optional -prerelease, optional +build
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(trimmed);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

/**
 * Compare two semver strings. Returns:
 *   -1 if a < b, 0 if a === b, 1 if a > b.
 * Throws on an unparseable input so a malformed feed never silently reads as
 * "no upgrade." Implements the semver precedence rules: numeric fields compare
 * numerically; a version WITH a prerelease has LOWER precedence than the same
 * version without one; prerelease identifiers compare per semver §11.4.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa) throw new Error(`compareSemver: unparseable version "${a}"`);
  if (!pb) throw new Error(`compareSemver: unparseable version "${b}"`);

  for (const k of ['major', 'minor', 'patch'] as const) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }

  // Equal core. A prerelease has lower precedence than no prerelease.
  const aPre = pa.prerelease;
  const bPre = pb.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1; // a is the full release, b is a prerelease
  if (bPre.length === 0) return -1;

  const len = Math.min(aPre.length, bPre.length);
  for (let i = 0; i < len; i++) {
    const x = aPre[i];
    const y = bPre[i];
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) < Number(y) ? -1 : 1;
    if (xNum) return -1; // numeric identifiers have lower precedence than alphanumeric
    if (yNum) return 1;
    return x < y ? -1 : 1;
  }
  if (aPre.length !== bPre.length) return aPre.length < bPre.length ? -1 : 1;
  return 0;
}

/**
 * Is `candidate` strictly newer than `current`? Pure wrapper over compareSemver.
 * Throws on unparseable input (the caller surfaces it rather than treating a
 * malformed feed as "up to date").
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) === 1;
}

/** Inputs the producer hands `buildLatestManifest`. */
export interface BuildLatestManifestInput {
  version: string;
  tag: string;
  releaseUrl: string;
  brewFormula?: string;
  artifacts: ArtifactEntry[];
  /** Override for the timestamp (testing). */
  now?: () => Date;
}

/**
 * Build a `LatestManifest` from release inputs. Validates the version parses and
 * that artifact checksums are well-formed hex so a malformed feed is caught at
 * GENERATION time (in CI), not at a user's `pd upgrade`.
 */
export function buildLatestManifest(input: BuildLatestManifestInput): LatestManifest {
  if (!parseSemver(input.version)) {
    throw new Error(`buildLatestManifest: version "${input.version}" is not valid semver`);
  }
  for (const a of input.artifacts) {
    if (!/^[0-9a-f]{64}$/.test(a.sha256)) {
      throw new Error(`buildLatestManifest: artifact ${a.surface} has invalid sha256 "${a.sha256}"`);
    }
  }
  const now = input.now ?? (() => new Date());
  return {
    schema: LATEST_MANIFEST_SCHEMA,
    version: input.version.trim().replace(/^v(?=\d)/i, ''),
    tag: input.tag,
    publishedAt: now().toISOString(),
    releaseUrl: input.releaseUrl,
    brewFormula: input.brewFormula ?? 'port-daddy',
    artifacts: input.artifacts,
  };
}

/**
 * Parse + validate a fetched manifest from untrusted JSON. Returns the typed
 * manifest or throws a descriptive error. Never trusts shape blindly — a
 * truncated/garbage feed must fail loud, not read as "no upgrade."
 */
export function parseLatestManifest(raw: unknown): LatestManifest {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('latest.json: not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== 'string' || !parseSemver(obj.version)) {
    throw new Error(`latest.json: missing/invalid "version" (${String(obj.version)})`);
  }
  if (!Array.isArray(obj.artifacts)) {
    throw new Error('latest.json: missing "artifacts" array');
  }
  const artifacts: ArtifactEntry[] = obj.artifacts.map((a, i) => {
    if (a === null || typeof a !== 'object') throw new Error(`latest.json: artifacts[${i}] not an object`);
    const e = a as Record<string, unknown>;
    if (typeof e.surface !== 'string') throw new Error(`latest.json: artifacts[${i}].surface missing`);
    if (typeof e.url !== 'string') throw new Error(`latest.json: artifacts[${i}].url missing`);
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) {
      throw new Error(`latest.json: artifacts[${i}].sha256 not a 64-char hex string`);
    }
    return {
      surface: e.surface as ArtifactSurface,
      filename: typeof e.filename === 'string' ? e.filename : '',
      url: e.url,
      sha256: e.sha256,
      sizeBytes: typeof e.sizeBytes === 'number' ? e.sizeBytes : null,
      platform: typeof e.platform === 'string' ? e.platform : '',
      signed: e.signed === true,
    };
  });
  return {
    schema: typeof obj.schema === 'number' ? obj.schema : LATEST_MANIFEST_SCHEMA,
    version: (obj.version as string).trim().replace(/^v(?=\d)/i, ''),
    tag: typeof obj.tag === 'string' ? obj.tag : `v${obj.version}`,
    publishedAt: typeof obj.publishedAt === 'string' ? obj.publishedAt : '',
    releaseUrl: typeof obj.releaseUrl === 'string' ? obj.releaseUrl : '',
    brewFormula: typeof obj.brewFormula === 'string' ? obj.brewFormula : 'port-daddy',
    artifacts,
  };
}

/** Find a specific surface's artifact entry, or null. */
export function artifactFor(manifest: LatestManifest, surface: ArtifactSurface): ArtifactEntry | null {
  return manifest.artifacts.find((a) => a.surface === surface) ?? null;
}

/** Result of comparing a fetched manifest to the embedded version. */
export interface UpgradeDecision {
  current: string;
  latest: string;
  /** True iff the feed advertises a strictly newer version. */
  upgradeAvailable: boolean;
  /** The daemon artifact entry (for checksum verification of a downloaded asset). */
  daemonArtifact: ArtifactEntry | null;
}

/**
 * Decide whether to upgrade given the embedded version and a fetched manifest.
 * Pure — the IO (fetch, brew) lives in the CLI command; this is the unit-tested
 * decision so "is a newer version available" is verifiable without a network or
 * Homebrew.
 */
export function decideUpgrade(currentVersion: string, manifest: LatestManifest): UpgradeDecision {
  return {
    current: currentVersion.trim().replace(/^v(?=\d)/i, ''),
    latest: manifest.version,
    upgradeAvailable: isNewerVersion(manifest.version, currentVersion),
    daemonArtifact: artifactFor(manifest, 'daemon'),
  };
}
