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

// ════════════════════════════════════════════════════════════════════════
//  A3 — crown-jewel permission audit (lib/safe/perms-audit.ts)
// ════════════════════════════════════════════════════════════════════════

/**
 * Severity of a permission finding. `exposed` = a secret path the group/other
 * bits can read (the dangerous case). `loose` = group/other have non-read bits
 * (write/exec) on a secret path or its parent dir. `ok` = locked down.
 */
export type PermSeverity = 'ok' | 'loose' | 'exposed';

/**
 * One crown-jewel path's `stat`-derived permission posture. Read-only — the
 * `priorMode` field is what A9's opt-in reversible `fix --auto` records before a
 * `chmod`, so the change can be rolled back. No secret content is ever read here;
 * this is a metadata (mode/owner) audit only.
 */
export interface PermFinding {
  /** Absolute path audited. */
  path: string;
  /** True when the path exists and was `stat`-able. */
  exists: boolean;
  /** True when the path is a directory (vs a file). */
  isDir: boolean;
  /** Octal mode string, e.g. `0600`, `0644`, `0700`. Empty when not stat-able. */
  mode: string;
  /** True when group-readable (mode & 0o040). */
  groupReadable: boolean;
  /** True when world/other-readable (mode & 0o004). */
  worldReadable: boolean;
  /** True when group OR world has write/exec on a secret path (a looser leak). */
  groupOrWorldWritable: boolean;
  severity: PermSeverity;
  /**
   * The tightened mode A9's `fix --auto` would set (e.g. `0600` for a key file,
   * `0700` for a dir), or null when nothing to fix. The current `mode` is the
   * value to record as `priorMode` before applying.
   */
  recommendedMode: string | null;
}

/** The A3 audit result: per-path permission findings + the Coast Guard posture. */
export interface PermsAuditResult {
  findings: PermFinding[];
  /**
   * Whether the Coast Guard deny-list is actually in force on this machine
   * (from `coastGuardStatus()` in lib/coast-guard.ts). A path can be `0600` yet
   * still readable by a same-UID agent if the guard is off — both facts matter.
   */
  coastGuard: {
    onByDefault: boolean;
    confinementAvailable: boolean;
    mechanism: string;
  };
}

// ════════════════════════════════════════════════════════════════════════
//  A4/A5 — binary trust (lib/safe/binary-trust.ts, trust-ledger.ts)
// ════════════════════════════════════════════════════════════════════════

/**
 * Code-signing classification buckets, most-trusted → least. `platform` = an
 * Apple platform binary (`/bin`, `/usr/bin`). `dev-id-notarized` = signed with a
 * Developer ID cert AND notarized by Apple. `dev-id-unnotarized` = Developer ID
 * signed but Apple never stapled a notarization. `ad-hoc` = signed with no
 * identity (the `adhoc` flag — anyone can produce one). `unsigned` = no signature
 * at all. `unknown` = `codesign` could not be run / output unparseable.
 */
export type BinaryTrustClass =
  | 'platform'
  | 'dev-id-notarized'
  | 'dev-id-unnotarized'
  | 'ad-hoc'
  | 'unsigned'
  | 'unknown';

/**
 * Where a binary came from. `quarantine` = it carries `com.apple.quarantine`
 * (browser/AirDrop download — Gatekeeper saw it). `no-quarantine` = the xattr is
 * ABSENT, which is the DANGEROUS path (curl|bash, scp, git-clone, npm/pip leave
 * none) → provenance is UNKNOWN, never assumed safe.
 */
export type QuarantineOrigin = 'quarantine' | 'no-quarantine' | 'unknown';

/** A path-origin tag for where the binary was found on disk. */
export type BinaryPathOrigin =
  | 'running-process'
  | 'downloads'
  | 'tmp'
  | 'npm-global'
  | 'pip-global'
  | 'system'
  | 'other';

/**
 * One binary's trust posture. Built from `codesign --verify/--display` +
 * `codesign --check-notarization` + the quarantine xattr. No file CONTENT is
 * read; this is signature + provenance metadata only.
 */
export interface BinaryTrust {
  /** Absolute path to the binary. */
  path: string;
  /** The classification bucket. */
  trustClass: BinaryTrustClass;
  /** Where on disk it was found. */
  pathOrigin: BinaryPathOrigin;
  /** Quarantine provenance — missing xattr → `no-quarantine` (UNKNOWN, not safe). */
  quarantine: QuarantineOrigin;
  /** Apple Team Identifier from the signature, or null. */
  teamId: string | null;
  /** The signing identifier (`Identifier=` from `codesign -dv`), or null. */
  signingId: string | null;
  /** The Authority chain (leaf → root) from `codesign -dv`, top-first. */
  authority: string[];
  /** Code Directory Hash (the cdhash) — the ledger key when present. */
  cdhash: string | null;
  /** True when the signature is ad-hoc (`flags=…0x2` / `Signature=adhoc`). */
  adhoc: boolean;
  /** True when `codesign --verify --deep --strict` succeeded. */
  verified: boolean;
  /** True when `codesign --check-notarization` reports notarized. */
  notarized: boolean;
  /** Optional PID when this binary was found as a running process. */
  pid?: number;
}

// ════════════════════════════════════════════════════════════════════════
//  A6 — egress snapshot (lib/safe/egress-snapshot.ts)
// ════════════════════════════════════════════════════════════════════════

/**
 * A minimal view of a known PD-managed agent, used to correlate an egress flow
 * to a real sortie/agent instead of a bare PID. The daemon supplies a lookup
 * `pid -> KnownSpawn | null` from its in-memory spawn registry (lib/spawner.ts);
 * tests inject a map.
 */
export interface KnownSpawn {
  agentId: string;
  name: string;
  identity: string | null;
  pid: number;
}

/**
 * One point-in-time egress flow. `nettop -P -m route -l 1` (no sudo) gives the
 * per-PID byte counters + remote host; `lsof -i -nP` (own-UID) gives the
 * pid↔binary↔remote mapping. Volumetric + destination EVIDENCE only — TLS bodies
 * are opaque; this is NOT enforcement.
 */
export interface EgressFlow {
  pid: number;
  /** The process command/binary name (from lsof / nettop), or null. */
  binary: string | null;
  /** Remote host (IP or resolved name) the flow talks to, or null. */
  remoteHost: string | null;
  /** Remote port when known. */
  remotePort: number | null;
  /** Bytes the flow has moved (in+out where available), or null. */
  bytes: number | null;
  /** The correlated known PD agent, when the PID is in the spawn registry. */
  agent: KnownSpawn | null;
}

/** The A6 snapshot: correlated flows + whether each tool produced any output. */
export interface EgressSnapshot {
  flows: EgressFlow[];
  /** True when `nettop` produced parseable rows (vs absent/empty). */
  nettopAvailable: boolean;
  /** True when `lsof` produced parseable rows. */
  lsofAvailable: boolean;
}

// ════════════════════════════════════════════════════════════════════════
//  A7 — MCP / skill supply-chain inventory (lib/safe/mcp-inventory.ts)
// ════════════════════════════════════════════════════════════════════════

/** Which config file an MCP server entry came from. */
export type McpConfigSource =
  | 'project-mcp-json'
  | 'cursor-mcp-json'
  | 'claude-config'
  | 'other';

/**
 * Why an MCP server entry was flagged. `unpinned-npx` / `unpinned-uvx` = the
 * command fetches a package at run time with no pinned version (the typosquat /
 * tool-poisoning vector). Determined by STRUCTURED inspection of the `command`
 * array, never NLP over a description string.
 */
export type McpFlagReason = 'unpinned-npx' | 'unpinned-uvx';

/**
 * One configured MCP server. `command` + `args` are the structured fields
 * inspected; `flags` lists the structural reasons it was flagged (empty = clean).
 */
export interface McpServerEntry {
  /** The server key/name in the config. */
  name: string;
  source: McpConfigSource;
  /** Absolute path of the config file this entry came from. */
  configPath: string;
  /** The launch command (e.g. `npx`, `uvx`, `node`, an abs path), or null. */
  command: string | null;
  /** The argument array (structured — never free-text classified). */
  args: string[];
  /** Structural flags; empty array = nothing structurally wrong. */
  flags: McpFlagReason[];
}

/** The A7 inventory: every configured server + which configs were found. */
export interface McpInventoryResult {
  servers: McpServerEntry[];
  /** Absolute paths of the config files that existed and parsed. */
  configsScanned: string[];
}
