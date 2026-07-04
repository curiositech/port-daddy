/**
 * lib/safe/binary-trust.ts — A4, the binary trust scanner (ADR-0088 Phase A).
 *
 * Per binary (scope: running processes + `~/Downloads` + npm/pip global bins):
 *
 *   • `codesign --verify --deep --strict`        → signature validity
 *   • `codesign -dv --verbose=4`                 → Authority chain, TeamIdentifier,
 *                                                  Identifier, CDHash, ad-hoc flag
 *   • `codesign --test-requirement="=notarized" -v` (SecCode) → notarization
 *                                                  (exit 0 = notarized). This is the
 *                                                  real CLI-binary notarization probe;
 *                                                  `--check-notarization` is not a
 *                                                  codesign verb on shipping macOS.
 *   • `xattr -p com.apple.quarantine`            → provenance — but MISSING
 *                                                  quarantine is UNKNOWN, NEVER SAFE
 *                                                  (curl|bash, scp, git-clone,
 *                                                  npm/pip leave no quarantine xattr).
 *
 * `codesign`/SecCode is used for bare CLI binaries; `spctl -a -t exec` is reserved
 * for `.app` bundles only (it misreports on standalone CLI executables — the common
 * agent/MCP shim shape).
 *
 * Classification: platform | dev-id-notarized | dev-id-unnotarized | ad-hoc |
 * unsigned | unknown, plus a path-origin tag.
 *
 * No file CONTENT is read — only signature/provenance metadata. All shelling is
 * behind an injectable runner so the parsers are unit-testable without a real
 * `codesign`.
 */

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import type {
  BinaryTrust,
  BinaryTrustClass,
  BinaryPathOrigin,
  QuarantineOrigin,
} from './types.js';

/** The raw outputs collected for one binary, before classification. Pure input. */
export interface CodesignRaw {
  /** Exit-0 of `codesign --verify --deep --strict`. */
  verifyOk: boolean;
  /** Combined stdout+stderr of `codesign -dv --verbose=4` (info goes to stderr). */
  displayText: string;
  /** Exit-0 of `codesign --test-requirement="=notarized" -v` (true = notarized). */
  notarizedOk: boolean;
  /** The `com.apple.quarantine` xattr value, or null when the xattr is ABSENT. */
  quarantineXattr: string | null;
}

/**
 * Injectable command runner. Returns combined stdout+stderr and exit success.
 * `null` means the command could not be run (binary missing, platform mismatch).
 */
export type TrustRunner = (
  cmd: string,
  args: string[],
) => { ok: boolean; out: string } | null;

/**
 * Real runner over `spawnSync`. We capture BOTH stdout and stderr regardless of
 * exit code — `codesign -dv` writes its display to STDERR even on exit 0, and
 * `xattr -p` writes "No such xattr" to stderr when an attribute is ABSENT (a
 * real, non-null signal: the probe RAN, the attribute is gone). `null` is
 * reserved for a command that could not run at all (ENOENT: binary missing) —
 * distinct from "ran and reported nothing".
 */
export const realTrustRunner: TrustRunner = (cmd, args) => {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  // ENOENT / spawn failure → the command itself could not run.
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') return null;
  if (res.error) return null;
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { ok: res.status === 0, out };
};

// ── Parsers (pure over raw text) ─────────────────────────────────────────────

/** Pull the first capture of the first matching line, trimmed, or null. */
function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m && m[1] != null ? m[1].trim() : null;
}

/** Parse `TeamIdentifier=ABCDE12345` (or `not set`). */
export function parseTeamId(displayText: string): string | null {
  const v = firstMatch(displayText, /^TeamIdentifier=(.+)$/m);
  if (!v || v.toLowerCase() === 'not set') return null;
  return v;
}

/** Parse `Identifier=com.example.tool`. */
export function parseSigningId(displayText: string): string | null {
  return firstMatch(displayText, /^Identifier=(.+)$/m);
}

/** Parse `CDHash=...` (verbose=4 prints it as `CDHash=<hex>`). */
export function parseCdhash(displayText: string): string | null {
  return firstMatch(displayText, /^CDHash=([0-9a-fA-F]+)$/m);
}

/** Parse every `Authority=...` line (leaf → root, in print order). */
export function parseAuthority(displayText: string): string[] {
  const out: string[] = [];
  const re = /^Authority=(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(displayText)) !== null) out.push(m[1].trim());
  return out;
}

/**
 * True when the signature is ad-hoc. `codesign -dv` prints `Signature=adhoc`;
 * the CodeDirectory flags also carry `0x2` (adhoc). Match either form.
 */
export function parseAdhoc(displayText: string): boolean {
  if (/^Signature=adhoc$/m.test(displayText)) return true;
  // flags line shape: `CodeDirectory v=... flags=0x2(adhoc) ...`
  if (/flags=0x[0-9a-fA-F]*\b.*\badhoc\b/i.test(displayText)) return true;
  return false;
}

/**
 * Classify the binary from its raw signing facts. Pure. Order of precedence:
 *   1. Unsigned        → `displayText` has no Authority AND verify failed with
 *                        an "code object is not signed" signal.
 *   2. Ad-hoc          → the adhoc flag.
 *   3. Platform        → Authority chain rooted at "Apple Root CA" with an
 *                        "Apple Code Signing"/"Software Signing" leaf (the OS
 *                        platform binaries) AND a known platform path.
 *   4. dev-id-notarized / dev-id-unnotarized — Developer ID Application leaf,
 *      split by the notarization check.
 */
export function classifyTrust(
  raw: CodesignRaw,
  pathOrigin: BinaryPathOrigin,
): BinaryTrustClass {
  const { displayText, verifyOk, notarizedOk } = raw;
  const hasContent = displayText.trim().length > 0;
  const authority = parseAuthority(displayText);
  const adhoc = parseAdhoc(displayText);
  const cdhash = parseCdhash(displayText);

  // No codesign output at all → we cannot say anything → unknown (NOT unsigned;
  // "unsigned" is a positive claim that the binary carries no signature, which we
  // can only make when codesign actually ran and reported it).
  if (!hasContent) return 'unknown';

  // Explicit "not signed at all", OR codesign ran and produced output that
  // carries NONE of the signature anchors (no Authority / Signature / CDHash).
  const unsignedSignal =
    /code object is not signed at all/i.test(displayText) ||
    (authority.length === 0 && !adhoc &&
      !/^Signature=/m.test(displayText) &&
      !cdhash);

  if (unsignedSignal) return 'unsigned';
  if (adhoc) return 'ad-hoc';

  const leaf = authority[0] ?? '';
  const root = authority[authority.length - 1] ?? '';
  const isAppleRoot = /Apple Root CA/i.test(root) || /Apple Root CA/i.test(authority.join(' '));

  // Apple platform binaries: leaf is "Software Signing" / "Apple Code Signing"
  // (NOT a Developer ID), chained to the Apple Root.
  if (isAppleRoot && /Software Signing|Apple Code Signing/i.test(leaf)) {
    return 'platform';
  }

  if (/Developer ID Application/i.test(leaf)) {
    return notarizedOk ? 'dev-id-notarized' : 'dev-id-unnotarized';
  }

  // Signed (has authority / cdhash / verify) but not a shape we recognize.
  if (authority.length > 0 || parseCdhash(displayText) || verifyOk) {
    // A signed-but-unrecognized leaf is safest reported as dev-id-unnotarized
    // when there is an Authority chain, else unknown.
    if (authority.length > 0) return 'dev-id-unnotarized';
  }
  return 'unknown';
}

/**
 * Quarantine provenance. MISSING xattr → `no-quarantine` (the UNKNOWN/dangerous
 * path — never SAFE). Present → `quarantine`. `null` input from a failed probe
 * (not the same as absent) → `unknown`.
 */
export function classifyQuarantine(
  xattr: string | null,
  probeRan: boolean,
): QuarantineOrigin {
  if (!probeRan) return 'unknown';
  return xattr && xattr.length > 0 ? 'quarantine' : 'no-quarantine';
}

// ── Collection (shells out via the injectable runner) ────────────────────────

/** Run the codesign/xattr probes for one path. Defensive: tolerates failures. */
export function collectRaw(
  path: string,
  run: TrustRunner,
): { raw: CodesignRaw; quarantineProbeRan: boolean } {
  const verify = run('codesign', ['--verify', '--deep', '--strict', path]);
  const display = run('codesign', ['-dv', '--verbose=4', path]);
  // The real CLI-binary notarization probe: exit 0 ⇔ the code satisfies the
  // `=notarized` requirement. `--check-notarization` is not a codesign verb.
  const notar = run('codesign', ['--test-requirement==notarized', '-v', path]);
  const xattr = run('xattr', ['-p', 'com.apple.quarantine', path]);

  // xattr returns null when the attr is ABSENT (ENOATTR, no output) — the
  // dangerous no-quarantine path. A present attr has non-empty output.
  const quarantineProbeRan = xattr !== null;
  const quarantineXattr =
    xattr && xattr.ok && xattr.out.trim().length > 0 ? xattr.out.trim() : null;

  return {
    raw: {
      verifyOk: verify?.ok ?? false,
      displayText: display?.out ?? '',
      notarizedOk: notar?.ok ?? false,
      quarantineXattr,
    },
    quarantineProbeRan,
  };
}

/** Tag a path with where it came from on disk. Pure. */
export function classifyPathOrigin(
  path: string,
  home: string,
  isRunningProcess: boolean,
): BinaryPathOrigin {
  if (isRunningProcess) return 'running-process';
  const downloads = `${home}/Downloads/`;
  if (path.startsWith(downloads)) return 'downloads';
  if (path.startsWith('/tmp/') || path.startsWith('/private/tmp/')) return 'tmp';
  if (/\/node_modules\/\.bin\//.test(path) || /\/lib\/node_modules\//.test(path)) {
    return 'npm-global';
  }
  if (/\/(site-packages|dist-packages)\//.test(path) || /\/\.local\/bin\//.test(path)) {
    return 'pip-global';
  }
  if (path.startsWith('/bin/') || path.startsWith('/usr/bin/') ||
      path.startsWith('/sbin/') || path.startsWith('/usr/sbin/')) {
    return 'system';
  }
  return 'other';
}

/**
 * Assess one binary's trust. Pure over (path, runner, home, origin facts).
 * Combines collection + classification into a single `BinaryTrust`.
 */
export function assessBinary(
  path: string,
  opts: {
    run?: TrustRunner;
    home?: string;
    pid?: number;
    isRunningProcess?: boolean;
  } = {},
): BinaryTrust {
  const run = opts.run ?? realTrustRunner;
  const home = opts.home ?? homedir();
  const isRunningProcess = opts.isRunningProcess ?? typeof opts.pid === 'number';
  const pathOrigin = classifyPathOrigin(path, home, isRunningProcess);

  const { raw, quarantineProbeRan } = collectRaw(path, run);
  const trustClass = classifyTrust(raw, pathOrigin);
  const quarantine = classifyQuarantine(raw.quarantineXattr, quarantineProbeRan);

  const result: BinaryTrust = {
    path,
    trustClass,
    pathOrigin,
    quarantine,
    teamId: parseTeamId(raw.displayText),
    signingId: parseSigningId(raw.displayText),
    authority: parseAuthority(raw.displayText),
    cdhash: parseCdhash(raw.displayText),
    adhoc: parseAdhoc(raw.displayText),
    verified: raw.verifyOk,
    notarized: raw.notarizedOk,
  };
  if (typeof opts.pid === 'number') result.pid = opts.pid;
  return result;
}
