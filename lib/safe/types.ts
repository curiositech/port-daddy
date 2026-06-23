/**
 * lib/safe/types.ts — shared types for the `pd safe` host-safety layer (ADR-0088
 * Phase A). The single place the secret scanner (A1), the baseline triage store
 * (A2), and every later sensor agree on shapes.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  THE NO-RAW-SECRET RULE (load-bearing — this is a security feature)
 * ════════════════════════════════════════════════════════════════════════
 * No type in this module — and no value any of these modules emit, log, or
 * return — may carry a raw secret. A `SecretFinding` carries the file `path`,
 * the 1-based `line`, the `ruleId` that matched, the `last4` characters of the
 * matched token (an identifier, NOT a usable credential), and the measured
 * Shannon `entropy`. It NEVER carries the matched value. A leak here is a
 * blocker, not a bug. See ADR-0088 § "Secret detection method".
 */

/**
 * A vendored gitleaks-style structured-format rule. The corpus lives in
 * `lib/safe/rules/gitleaks-rules.json` (a build-time conversion of the upstream
 * gitleaks MIT `config/gitleaks.toml`, recorded with its source commit + a
 * `refreshed-at` date — a maintained dependency, never a constant).
 *
 * The `regex` is a structured KEY-FORMAT anchor (AKIA…, sk-ant-…, ghp_…), never
 * a free-text keyword classifier. The optional `entropy` floor is a per-rule
 * minimum Shannon entropy (bits/char) the matched secret group must clear to be
 * reported — it suppresses low-entropy format collisions.
 */
export interface GitleaksRule {
  /** Stable rule id, e.g. `aws-access-token`, `anthropic-api-key`. */
  id: string;
  /** The structured-format regex (source string; compiled once at load). */
  regex: string;
  /**
   * Optional capture-group index whose entropy is measured (gitleaks
   * `secretGroup`). 0 / undefined → the whole match.
   */
  secretGroup?: number;
  /** Optional per-rule minimum Shannon entropy (bits/char) the secret must clear. */
  entropy?: number;
  /** Human label for the report (never shown to a classifier). */
  description?: string;
}

/** The vendored corpus file shape: provenance + the rule array. */
export interface GitleaksRulePack {
  /** Upstream gitleaks repo the corpus was converted from. */
  source: string;
  /** The exact upstream commit the `config/gitleaks.toml` was taken at. */
  upstreamCommit: string;
  /** ISO date the corpus was last refreshed (it is a maintained dependency). */
  refreshedAt: string;
  /** Upstream license (MIT). */
  license: string;
  rules: GitleaksRule[];
}

/**
 * How a finding was reached. `structured-format` = a vendored regex matched (the
 * verdict). `entropy-fallback` = no structured rule matched, but a high-entropy
 * blob sits on a known credential path or beside a structured anchor (entropy is
 * NEVER the sole verdict on its own — see ADR-0088 § detection method).
 */
export type DetectionMethod = 'structured-format' | 'entropy-fallback';

/**
 * A single secret-at-rest finding. THE RAW VALUE IS NEVER PRESENT. `last4` is
 * the last four characters of the matched token — an identifier for triage, not
 * a usable credential.
 */
export interface SecretFinding {
  /** Absolute (or workdir-relative-resolved) path of the file the match is in. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  /** The rule id that matched, or `high-entropy-blob` for the entropy fallback. */
  ruleId: string;
  /** Last 4 chars of the matched token (identifier only — never the full value). */
  last4: string;
  /** Measured Shannon entropy (bits/char) of the matched token. */
  entropy: number;
  /** How the match was reached. */
  method: DetectionMethod;
  /**
   * Live-verification verdict. Always `null` in Phase A — `pd safe` does NOT
   * call the credential's live endpoint (that is trufflehog's AGPL idea, studied
   * not linked; ADR-0088 prior-art stance). Reserved for a later opt-in phase.
   */
  verified: null;
}

/**
 * A stable fingerprint of a finding, used to key the baseline triage store.
 * `hash(ruleId + path + last4)` — deliberately NOT including the line number so
 * a triaged finding survives the file growing/shrinking above it, and NOT the
 * raw value (which we never hold). Hex sha256.
 */
export type FindingFingerprint = string;

/** A triaged baseline state. A re-scan suppresses everything but NEW findings. */
export type BaselineState = 'accepted' | 'rotated' | 'false-positive';

/** One committed baseline entry — a fingerprint plus its triage decision. */
export interface BaselineEntry {
  fingerprint: FindingFingerprint;
  ruleId: string;
  /** Path at triage time (informational; the fingerprint is the key). */
  path: string;
  /** last4 at triage time (informational; the fingerprint is the key). */
  last4: string;
  state: BaselineState;
  /** ISO timestamp the triage decision was recorded. */
  triagedAt: string;
  /** Optional free-text reason the operator gave (never a secret value). */
  note?: string;
}

/** The committed `.pd-secrets-baseline.json` shape. */
export interface SecretsBaseline {
  /** Schema version for forward-compat migrations. */
  version: 1;
  /** ISO timestamp of the last baseline write. */
  generatedAt: string;
  /** Triaged entries keyed by fingerprint (also stored inline for legibility). */
  entries: BaselineEntry[];
}

/** Options for a scan pass over the host's hiding spots. */
export interface ScanOptions {
  /** Operator $HOME; defaults to process.env.HOME. */
  home?: string;
  /** Extra workdir roots whose `.env*` files are also scanned. */
  extraRoots?: string[];
  /**
   * Max bytes read per file (a guard against scanning a multi-GB log). Files
   * larger than this are read up to the cap, never skipped silently.
   */
  maxFileBytes?: number;
  /** Injected file-content reader (for tests). Maps abs path → contents | null. */
  readFile?: (path: string) => string | null;
  /** Injected path-existence probe (for tests). */
  exists?: (path: string) => boolean;
}

/** The result of a single scan: all findings before baseline suppression. */
export interface ScanResult {
  findings: SecretFinding[];
  /** Absolute paths that were actually read (for the report's coverage line). */
  scannedPaths: string[];
}

/** A scan filtered against a baseline: only NEW (un-triaged) findings surface. */
export interface BaselinedScanResult {
  /** Findings with no baseline entry, or whose entry is not a suppressing state. */
  newFindings: SecretFinding[];
  /** Count of findings suppressed by an `accepted`/`false-positive` baseline. */
  suppressed: number;
  /** All findings the raw scan produced (for totals; still no raw values). */
  allFindings: SecretFinding[];
}
