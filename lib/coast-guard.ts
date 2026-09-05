/**
 * lib/coast-guard.ts — the Coast Guard: confine + broker + cap for spawned agents.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY (ADR-0050 — read docs/adr/0050-coast-guard.md for the full threat model)
 * ════════════════════════════════════════════════════════════════════════
 * Port Daddy spawns subprocess agents (codex, claude-cli, aider, custom,
 * cli:*) that get a real shell on the operator's machine. A single
 * `cat ~/.ssh/id_ed25519` or `cat .env.local` by any of them is total
 * key/secret exfiltration; a looping agent is unbounded API spend. The
 * operator named it: *"any bash command has the power of a god who can
 * bankrupt me."*
 *
 * The Coast Guard wraps every such subprocess in THREE protections, ON BY
 * DEFAULT (opt-out, not opt-in):
 *
 *   1. CONFINE  — an OS sandbox profile (macOS Seatbelt via `sandbox-exec`;
 *      Linux Landlock/seccomp via a helper when available) DENIES reads to
 *      the crown jewels (~/.ssh, ~/.aws, ~/.gnupg, ~/.config/gcloud, every
 *      dotenv file `.env` / `.env.local`) while ALLOWING the project working dir.
 *   2. BROKER   — the spawned agent's env carries NO raw API key. The keys
 *      live in the daemon's sealed cache (lib/secret-env.ts getSecret); the
 *      egress proxy injects the real key into outbound calls. `cat .env.local`
 *      and an env dump both yield nothing usable.
 *   3. CAP      — all outbound API traffic is forced through a local metering
 *      proxy with a HARD per-agent request/byte cap. The over-cap request is
 *      refused. A runaway agent cannot exceed budget.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  HONESTY RULE (non-negotiable — in code, docs, and the receipt)
 * ════════════════════════════════════════════════════════════════════════
 * This defends the COOPERATIVE case: runaway/looping spend, leaked-key blast
 * radius, confused-deputy, accidental exfiltration. It does NOT defend a
 * truly-malicious same-UID agent: it can `unset HTTPS_PROXY` and egress
 * directly, debug the daemon for the cached key, or refuse to launch under the
 * wrapper. *A secret a process can use, it can copy.* Real enforcement against
 * that needs a separate UID / VM + pf/nftables forced egress — ADR-0050
 * phase 4. We never claim more than we deliver.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { managedSecretKeys, getSecret } from './secret-env.js';
// Type-only import (erased at compile time → no runtime import cycle). The
// scope-tier vocabulary lives in bond-pricing.ts; enforcedContainmentTier()
// reports the Coast Guard's honest posture in that same vocabulary so the pricer
// can compare priced-vs-enforced. Pricing depends on coast-guard (crown jewels,
// scopeTierWritePolicy→writePolicy), not the reverse, so this stays type-only to
// avoid inverting that dependency.
import type { ScopeTier } from './bond-pricing.js';

// ── The crown jewels: paths a confined agent must never read ────────────────
// Structured, explicit allow/deny — NOT keyword matching over free text. These
// are concrete filesystem paths under the operator's $HOME.
//
// HONESTY: this deny list is BLAST-RADIUS REDUCTION, not an exhaustive secret
// vault. The Seatbelt profile is `(allow default)` then carves out the high-
// value, high-frequency crown jewels (the keys the operator actually loses
// sleep over). A determined agent could still read some secret NOT on this list
// (a browser cookie DB, a `~/Library/Keychains` file, a creds file under a tool
// dir we don't enumerate). We deny the common jewels + every dotenv; we do not
// claim to deny every secret on the disk. The truly-complete answer is a
// separate UID/VM (ADR-0050 phase 4), which we disclose, not pretend past.
export interface CrownJewelPaths {
  /** Absolute directories denied entirely (subpath deny). */
  deniedDirs: string[];
  /** The operator $HOME, used to anchor the dotenv-file regex. */
  home: string;
  /**
   * Extra absolute dir roots whose `.env` / `.env.local` files must also be
   * denied — the project workdir, which may live OUTSIDE $HOME (a /var/folders
   * worktree, a sortie dir). Without this a spawned agent could read the
   * dotenv in its own workdir even though it sits outside HOME.
   */
  extraDotenvRoots?: string[];
}

export function defaultCrownJewels(home: string = process.env.HOME || ''): CrownJewelPaths {
  return {
    home,
    deniedDirs: [
      join(home, '.ssh'),
      join(home, '.aws'),
      join(home, '.gnupg'),
      join(home, '.config', 'gcloud'),
      join(home, '.config', 'gh'), // GitHub CLI token
      join(home, '.kube'),
      join(home, '.docker', 'config.json'),
      join(home, '.netrc'),
      join(home, '.npmrc'),
      join(home, '.port-daddy-env'), // PD's own portable secret fallback
    ],
  };
}

/**
 * A legible, read-only snapshot of the Coast Guard's posture on THIS machine —
 * the read path the operator (and the console UI) needs to actually SEE the
 * guard. Confinement is a property of where spawns run, so this is computed
 * locally (no daemon round-trip). Receipts (per-spawn history) are a separate,
 * daemon-side read path; this reports capability + config, never secret values.
 */
export interface CoastGuardStatusReport {
  /** On unless PD_COAST_GUARD_OFF=1. */
  onByDefault: boolean;
  platform: NodeJS.Platform;
  /** OS sandbox mechanism that would confine a spawn here. */
  mechanism: 'seatbelt' | 'landlock-helper' | 'bwrap' | 'none';
  /** True when an OS sandbox is actually present (mechanism !== 'none'). */
  confinementAvailable: boolean;
  protects: {
    /** Every `.env`/`.env.local` under $HOME is denied (secrets, not code). */
    dotenvUnderHome: boolean;
    /** Crown-jewel directories denied outright. */
    deniedDirs: string[];
  };
  /** Outbound provider spend is forced through a hard-capped meter (cap is per-spawn). */
  egressMetering: boolean;
  /** Raw provider keys are scrubbed from the spawned agent's environment. */
  secretBroker: boolean;
}

export function coastGuardStatus(home: string = process.env.HOME || ''): CoastGuardStatusReport {
  let mechanism: CoastGuardStatusReport['mechanism'] = 'none';
  if (process.platform === 'darwin' && seatbeltAvailable()) {
    mechanism = 'seatbelt';
  } else if (process.platform === 'linux') {
    const kind = detectLinuxSandbox();
    if (kind !== 'none') mechanism = kind;
  }
  return {
    onByDefault: process.env.PD_COAST_GUARD_OFF !== '1',
    platform: process.platform,
    mechanism,
    confinementAvailable: mechanism !== 'none',
    protects: {
      dotenvUnderHome: true,
      deniedDirs: defaultCrownJewels(home).deniedDirs,
    },
    egressMetering: true,
    secretBroker: true,
  };
}

// ════════════════════════════════════════════════════════════════════════
//  ENFORCED CONTAINMENT TIER — what the Coast Guard ACTUALLY bounds today,
//  expressed in lib/bond-pricing.ts's scope-tier vocabulary so the pricer can
//  compare the tier it PRICED against the tier the platform CONTAINS.
// ════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS (the ×2-review-confirmed structural gap)
// --------------------------------------------------------
// lib/bond-pricing.ts prices a Float Plan into a ScopeTier (read/write/critical/
// full) and escrows a bond proportional to that tier's blast radius. But pricing
// is NOT containment (see that module's "PRICING IS NOT CONTAINMENT" header): the
// bond can price `full`/`critical` while the runtime structurally bounds far
// less. When the PRICED tier exceeds the ENFORCED tier, the economics carry
// weight the structure should — the bond underwrites damage the platform cannot
// actually prevent. `enforcedContainmentTier` is the read side of closing that
// gap: it answers "what tier does the Coast Guard, as it exists on THIS machine
// TODAY, actually contain?" so a caller can flag the over-pricing (bond-pricing.ts
// `uncontainedScope`). It is ADVISORY — it changes no escrow and refuses nothing.
//
// THE HONEST MAPPING (grounded in this module's REAL capabilities, above)
// ----------------------------------------------------------------------
// What the Coast Guard genuinely bounds today — always, for every spawn under a
// live OS sandbox:
//   • crown-jewel READ-DENY (~/.ssh, ~/.aws, … + every dotenv) → secret-exfil
//     blast radius bounded.
//   • secret BROKER (raw provider keys scrubbed from the agent env) → key-leak
//     blast radius bounded.
//   • egress METER with a hard request/byte CAP → runaway spend bounded.
// PLUS, since PR #339's scope-tier write containment landed: a `read`-priced
// spawn can be PHYSICALLY confined to deny writes to the project workdir
// (WriteConfinement / `buildSeatbeltProfile(write)` here; driven by bond-pricing.ts
// `scopeTierWritePolicy`, which maps `read`→`read-only`). So the `read` tier is
// now structurally backed, not merely priced.
//
// What the Coast Guard STILL does NOT bound today (the HONEST limitation — the
// gap the priced `write`/`critical`/`full` tiers assume coverage for and DON'T
// get). Note `scopeTierWritePolicy` maps EVERY tier above `read` to
// `unrestricted` — by design ("the bond covers the write blast radius") — so:
//   • NO write-deny for write/critical/full tiers. A `full`-priced spawn (the
//     DEFAULT spawn path: `spawn:agent` + `backend:<id>` → full) writes the
//     project freely; the runtime denies it nothing structural beyond the
//     secret/egress floor. The bond, not the sandbox, is its only check.
//   • NO force-push / branch-protection / destructive-git gate at ANY tier. A
//     confined agent with a shell can `git push --force`, `rm -rf`, rewrite
//     history. (A read-tier workdir write-deny does not stop git over the wire
//     or writes outside the workdir — see scopeTierWritePolicy's own caveats.)
//   • NO DB-write / deploy / production gate beyond the egress cap.
// The hard per-tier write/destructive-git refusal that WOULD close THIS half is
// unbuilt Layer-1 enforcement — a refusal on a core primitive needing operator
// sign-off — out of scope for this advisory read.
//
// Therefore the HONEST enforced CEILING, even with a live sandbox AND the new
// read-tier write confinement, is `read`: the platform reliably contains a
// read-tier blast radius (read-only workdir + crown-jewel deny + egress cap) and
// NOTHING STRONGER. We deliberately do NOT map today's posture to `'write'`+:
// claiming `'write'` containment would assert a write boundary the runtime does
// not enforce for write+ tiers, which is exactly the overclaim the HONESTY RULE
// (module header) forbids. When NO sandbox is present (mechanism === 'none'),
// even crown-jewel reads and the read-tier write-deny are unconfined, so the
// enforced tier DEGRADES below `read` — modelled as `null` (no filesystem
// containment tier at all; only the env-level broker + egress meter remain).
//
// ⚠ This mapping is INTENTIONALLY conservative. It reports the floor of what is
// structurally guaranteed, not the ceiling of what usually happens. As real
// per-tier write enforcement grows past `read` (the unbuilt Layer-1 gate), this
// function is the one place to RAISE the enforced tier — never raise it ahead of
// the mechanism, or `uncontainedScope` goes quiet on a gap that is still open.

/**
 * The consequential-scope tier (lib/bond-pricing.ts `ScopeTier`) that the Coast
 * Guard ACTUALLY contains on this machine today, derived honestly from a
 * `CoastGuardStatusReport`.
 *
 * Returns:
 *   • `'read'` — an OS sandbox is present (`mechanism !== 'none'`) AND the
 *     crown-jewel read-deny + egress meter + secret broker are in force. The
 *     read/exfil/spend axis is contained, and (post-#339) a `read`-priced spawn
 *     is physically write-confined to the workdir. This is the honest MODEST
 *     CEILING — NOT `'write'`/`'critical'`/`'full'`, because `scopeTierWritePolicy`
 *     leaves every tier above `read` `unrestricted` (no write-deny), and there is
 *     no force-push gate, no DB/deploy gate, at any tier.
 *   • `null` — DEGRADED: no OS sandbox (`mechanism === 'none'`), OR the guard is
 *     disabled (`onByDefault === false`). Even crown-jewel reads are unconfined;
 *     the Coast Guard contains no filesystem scope tier. (`null`, not `'read'`,
 *     so a caller never treats a degraded posture as `'read'`-level containment.)
 *
 * HONEST LIMITATION (do not paper over it): a `'read'` return is the enforced
 * CEILING — it means "the platform contains a read-tier blast radius," NOT "the
 * agent can only read." A `full`-priced agent (the default spawn) can still write
 * the project, force-push, and run destructive git: it is priced for that, not
 * contained from it, until per-tier write enforcement grows past `read` (Layer-1).
 * See the block comment above and lib/bond-pricing.ts's "PRICING IS NOT
 * CONTAINMENT" header.
 *
 * Pure: a deterministic function of the report. No I/O.
 */
export function enforcedContainmentTier(
  report: CoastGuardStatusReport,
): ScopeTier | null {
  // Guard off, or no OS sandbox → no filesystem containment tier at all.
  // (The broker + egress meter still run, but those bound key-leak/spend, not a
  // filesystem scope tier — so this is DEGRADED, below even `read`.)
  if (!report.onByDefault) return null;
  if (report.mechanism === 'none' || !report.confinementAvailable) return null;

  // OS sandbox present. The enforced CEILING is the read/exfil/spend axis plus
  // the read-tier workdir write-deny: crown-jewel read-deny (+ dotenv) bounds
  // secret exfil, the broker bounds key leak, the egress cap bounds spend, and a
  // read-priced spawn is physically write-confined (scopeTierWritePolicy). There
  // is NO write-deny for write+/-tiers and no force-push gate, so the enforced
  // tier is `read` (MODEST), never higher. We require the three always-on bounds
  // to be present to claim even `read`; if any is somehow off, DEGRADE rather
  // than overclaim.
  const secretExfilBounded =
    report.protects.dotenvUnderHome && report.protects.deniedDirs.length > 0;
  const spendBounded = report.egressMetering;
  const keyLeakBounded = report.secretBroker;
  if (secretExfilBounded && spendBounded && keyLeakBounded) return 'read';

  // Sandbox present but a core bound is missing — don't claim `read` containment.
  return null;
}

// ════════════════════════════════════════════════════════════════════════
//  macOS — Seatbelt (sandbox-exec) profile
// ════════════════════════════════════════════════════════════════════════
//
// `(allow default)` keeps normal work intact; we only carve out denials for
// the crown jewels. This mirrors and hardens tools/coast-guard/pd-cutter's
// prototype profile. The **/.env regex denies every dotenv anywhere under
// $HOME (the project's own .env included) — reads of secrets, not of code.

/**
 * Options governing scope-tier WRITE confinement in a Seatbelt profile. When
 * `writePolicy` is `read-only`, the profile adds `(deny file-write* (subpath
 * <root>))` for each `readOnlyRoots` entry — turning a `read`-priced scope tier
 * (lib/bond-pricing.ts `scopeTierWritePolicy`) into a PHYSICAL boundary: the
 * agent cannot write the project workdir (the shared state the bond protects).
 * `unrestricted` (the default and every non-read tier) adds nothing.
 */
export interface WriteConfinement {
  /** 'read-only' denies writes to readOnlyRoots; 'unrestricted' allows all. */
  writePolicy: 'read-only' | 'unrestricted';
  /** Absolute roots a read-only agent may NOT write (subpath deny). */
  readOnlyRoots: readonly string[];
}

/** The default (no write confinement) — every non-read tier uses this. */
const UNRESTRICTED_WRITE: WriteConfinement = { writePolicy: 'unrestricted', readOnlyRoots: [] };

/**
 * Thrown when a path that is about to be interpolated into an SBPL `(subpath
 * "...")` literal carries a character that would break OUT of the quoted string
 * — i.e. an SBPL-injection attempt. Fail-closed: we never emit a profile from an
 * unsafe root, because a syntactically-valid injected `(allow file-write*
 * (subpath "/"))` AFTER our deny would re-open writes (SBPL is last-match-wins).
 */
export class SbplInjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SbplInjectionError';
  }
}

/**
 * Guard a path before it is interpolated RAW into an SBPL `(subpath "<path>")`
 * string literal. This is the fix for the #339 write-containment injection: the
 * write-deny and crown-jewel deny lines build a *double-quoted* SBPL literal, so
 * any `"` in the path ends the literal early and the remainder is parsed as
 * further S-expressions. A payload like
 *
 *     /work")) (allow file-write* (subpath "/
 *
 * yields the SYNTACTICALLY-VALID profile line
 *
 *     (deny file-write* (subpath "/work")) (allow file-write* (subpath "/"))
 *
 * whose injected `allow` comes AFTER the deny — and SBPL is last-match-wins, so
 * the read-only confinement is silently re-opened.
 *
 * A legitimate absolute filesystem path cannot contain a double-quote, a
 * backslash, a newline/CR, or a NUL (`"` and `\` are SBPL string metacharacters;
 * newline/NUL cannot occur in a path we would ever sandbox). So we FAIL CLOSED:
 * reject any such root with {@link SbplInjectionError} rather than escape it.
 * Rejecting (vs escaping) keeps the guarantee total — a confined spawn either
 * runs under a trustworthy profile or does not run at all.
 *
 * Returns the path unchanged when safe (callers interpolate the return value).
 */
export function sbplSafePath(path: string, context = 'subpath'): string {
  // Reject the SBPL string-literal breakers and control chars. We test for the
  // exact dangerous set rather than an allow-list of "valid path chars" so that
  // unusual-but-legitimate paths (spaces, unicode, parens in a dir name) still
  // pass — those are harmless INSIDE the quoted literal; only `"`/`\`/newline/
  // NUL can escape it.
  if (/["\\\n\r\0]/.test(path)) {
    throw new SbplInjectionError(
      `Refusing to build a Seatbelt ${context} from a path containing a quote, ` +
        `backslash, newline, or NUL (SBPL-injection guard, fail-closed): ${JSON.stringify(path)}`,
    );
  }
  return path;
}

/** Build a guarded SBPL `(<op> (subpath "<root>"))` form; throws on an unsafe root. */
function sbplSubpathRule(op: string, root: string): string {
  return `(${op} (subpath "${sbplSafePath(root, op)}"))`;
}

/**
 * Build a Seatbelt profile (SBPL) that denies reads to the crown jewels while
 * allowing everything else. When `write` is a `read-only` policy, ALSO deny
 * writes to each read-only root (the project workdir) — scope-tier containment.
 * Pure + deterministic for unit testing.
 *
 * SECURITY: every path interpolated into a `(subpath "...")` literal is routed
 * through {@link sbplSafePath} first (fail-closed on quote/backslash/newline/NUL
 * — the SBPL-injection guard). This mirrors the regex-escaping (`esc`) the
 * dotenv read-deny lines already apply; the write-deny + crown-jewel lines build
 * STRING literals, so they reject the breaker characters outright.
 */
export function buildSeatbeltProfile(
  jewels: CrownJewelPaths,
  write: WriteConfinement = UNRESTRICTED_WRITE,
): string {
  const home = jewels.home;
  // Anchor the dotenv regex under $HOME. Seatbelt uses a TRE-ish regex dialect
  // that mishandles some POSIX character classes, so we keep it minimal and
  // VALIDATED on a real macOS box: match `/.env` followed by end-of-path OR a
  // dot (so `.env`, `.env.local`, `.env.production` are denied) but NOT
  // `.environment_notes`. Escape regex metachars in the $HOME prefix.
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Deny dotenv files under $HOME and under each extra root (the project
  // workdir, which may sit outside HOME). `/.env` followed by end-or-dot.
  const dotenvRoots = [home, ...(jewels.extraDotenvRoots ?? [])]
    .filter(Boolean)
    .map((root) => sbplSafePath(root));
  const dotenvDenies = dotenvRoots.map(
    (root) => `(deny file-read* (regex #"^${esc(root)}/.*/\\.env($|\\.)"))`,
  );
  // Also catch a dotenv at the IMMEDIATE root (no intervening dir), e.g.
  // <workdir>/.env.local — the `/.*/` form above requires a subdir.
  const dotenvDirectDenies = dotenvRoots.map(
    (root) => `(deny file-read* (regex #"^${esc(root)}/\\.env($|\\.)"))`,
  );
  // A tracked `.env.example` is documentation, not a credential store. Git
  // needs to read it to establish worktree cleanliness, and denying it made a
  // clean checkout appear to contain a deletion inside Coast Guard. Re-allow
  // only that exact basename under the explicit project roots (never the broad
  // HOME root), and never when a root overlaps a crown-jewel directory. Exact
  // ordering matters in Seatbelt: these narrow rules follow the broad dotenv
  // denies while the unrelated crown-jewel paths remain outside their scope.
  const extraDotenvRoots = (jewels.extraDotenvRoots ?? [])
    .filter(Boolean)
    .map((root) => sbplSafePath(root));
  const templateRoots = extraDotenvRoots.filter(
    (root) =>
      !jewels.deniedDirs.some((deniedDir) => {
        const denied = sbplSafePath(deniedDir);
        return (
          root === denied ||
          root.startsWith(`${denied}/`) ||
          denied.startsWith(`${root}/`)
        );
      }),
  );
  const dotenvTemplateAllows = templateRoots.flatMap((root) => [
    `(allow file-read* (literal "${root}/.env.example"))`,
    `(allow file-read* (regex #"^${esc(root)}/.*/\\.env\\.example$"))`,
  ]);
  // SCOPE-TIER WRITE CONFINEMENT — deny writes to the project workdir for a
  // read-only tier. `(deny file-write* (subpath <root>))` blocks create/write/
  // unlink/rename under the root; reads still pass (the agent can READ the repo
  // it is auditing, it just cannot mutate it). Empty/blank roots are skipped.
  const writeDenies =
    write.writePolicy === 'read-only'
      ? write.readOnlyRoots
          .map((r) => r.trim())
          .filter(Boolean)
          .map((root) => sbplSubpathRule('deny file-write*', root))
      : [];
  const lines = [
    '(version 1)',
    '(allow default)',
    ...jewels.deniedDirs.map((d) => sbplSubpathRule('deny file-read*', d)),
    ...dotenvDenies,
    ...dotenvDirectDenies,
    ...dotenvTemplateAllows,
    ...writeDenies,
  ];
  return lines.join('\n') + '\n';
}

/**
 * True when `sandbox-exec` is present (macOS). Detected by filesystem probe —
 * NOT a subprocess — so it stays mock-safe in tests that stub child_process and
 * adds no fork cost. `sandbox-exec` lives at /usr/bin on every supported macOS.
 */
let _seatbeltAvail: boolean | null = null;
export function seatbeltAvailable(): boolean {
  if (_seatbeltAvail !== null) return _seatbeltAvail;
  if (process.platform !== 'darwin') {
    _seatbeltAvail = false;
    return false;
  }
  _seatbeltAvail = existsSync('/usr/bin/sandbox-exec');
  return _seatbeltAvail;
}

// ════════════════════════════════════════════════════════════════════════
//  Linux — Landlock / seccomp
// ════════════════════════════════════════════════════════════════════════
//
// macOS gives us Seatbelt out of the box. On Linux we prefer a Landlock
// helper (`pd-landlock` or `landrun`) when the operator has installed one,
// then fall back to `bwrap` (bubblewrap) which can `--ro-bind` the project and
// leave the crown jewels unmounted. We DETECT, never assume. When none is
// present we report `confined: false` honestly rather than pretending.

export type LinuxSandboxKind = 'landlock-helper' | 'bwrap' | 'none';

/** Union an existing NO_PROXY value with our loopback exemptions (dedup). */
function mergeNoProxy(existing: string | undefined, additions: string): string {
  const parts = new Set(
    [...(existing ?? '').split(','), ...additions.split(',')]
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return [...parts].join(',');
}

/** Resolve a path's canonical form; return the input unchanged if it can't. */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Probe PATH for an executable without forking (mock-safe). */
function binOnPath(bin: string): boolean {
  const path = process.env.PATH || '';
  for (const dir of path.split(':')) {
    if (dir && existsSync(join(dir, bin))) return true;
  }
  return false;
}

let _linuxKind: LinuxSandboxKind | null = null;
export function detectLinuxSandbox(): LinuxSandboxKind {
  if (_linuxKind !== null) return _linuxKind;
  if (process.platform !== 'linux') {
    _linuxKind = 'none';
    return _linuxKind;
  }
  if (binOnPath('pd-landlock') || binOnPath('landrun')) _linuxKind = 'landlock-helper';
  else if (binOnPath('bwrap')) _linuxKind = 'bwrap';
  else _linuxKind = 'none';
  return _linuxKind;
}

// ════════════════════════════════════════════════════════════════════════
//  Command wrapping
// ════════════════════════════════════════════════════════════════════════

export interface SandboxWrap {
  /** The command to actually exec. */
  cmd: string;
  /** Its argv (the original command is appended after the sandbox flags). */
  args: string[];
  /** Whether OS-level confinement is actually in force. */
  confined: boolean;
  /** Human-readable mechanism in force (for the receipt). */
  mechanism: 'seatbelt' | 'landlock-helper' | 'bwrap' | 'none';
  /** Files to clean up after the run (e.g. the temp profile). */
  cleanup: string[];
}

/**
 * Wrap `(cmd, args)` so it runs under the platform's OS sandbox confining the
 * crown jewels. Falls back to `confined:false` (mechanism 'none') when no
 * sandbox is available — and SAYS SO. The caller decides whether to refuse
 * (fail-closed) or proceed with reduced protection; the spawner's policy is to
 * proceed but record `confined:false` in the receipt, never silently imply
 * confinement that isn't there.
 *
 * `writePolicy` is the scope-tier containment hook (lib/bond-pricing.ts
 * `scopeTierWritePolicy`). When `'read-only'`, the agent is physically denied
 * WRITES to the project workdir (the shared state its bond protects) while
 * still able to READ it — Seatbelt `(deny file-write*)` on macOS, bwrap
 * `--ro-bind` on Linux. The default `'unrestricted'` leaves writes alone.
 */
export function wrapWithSandbox(
  cmd: string,
  args: string[],
  jewels: CrownJewelPaths,
  workdir?: string,
  writePolicy: WriteConfinement['writePolicy'] = 'unrestricted',
): SandboxWrap {
  // Always deny the project workdir's own dotenv files, even when the workdir
  // lives outside $HOME (a /var/folders worktree, a sortie dir). Seatbelt
  // matches against the CANONICAL path (macOS /var → /private/var symlink), so
  // we add both the resolved and the requested path as roots.
  const workdirRoots = workdir
    ? [resolve(workdir), safeRealpath(resolve(workdir))].filter(
        (v, i, a) => a.indexOf(v) === i,
      )
    : [];
  const jewelsForRun: CrownJewelPaths = workdir
    ? {
        ...jewels,
        extraDotenvRoots: [
          ...(jewels.extraDotenvRoots ?? []),
          ...workdirRoots,
        ].filter((v, i, a) => a.indexOf(v) === i),
      }
    : jewels;

  // For a read-only tier, the project workdir (both requested + canonical form)
  // is the write-denied root set. With no workdir there is nothing project-
  // scoped to deny, so read-only degrades to a no-op write policy (honest: we
  // only confine writes to a workdir we were actually given).
  const write: WriteConfinement = {
    writePolicy: workdirRoots.length > 0 ? writePolicy : 'unrestricted',
    readOnlyRoots: workdirRoots,
  };

  if (process.platform === 'darwin' && seatbeltAvailable()) {
    const dir = mkdtempSync(join(tmpdir(), 'pd-coast-'));
    const profile = join(dir, 'profile.sb');
    try {
      // FAIL-CLOSED: buildSeatbeltProfile throws SbplInjectionError on a root
      // that would break out of a `(subpath "...")` literal. We propagate (the
      // spawn aborts) rather than fall through to an unconfined run — but first
      // clean up the temp dir we just created so a rejected spawn leaks nothing.
      writeFileSync(profile, buildSeatbeltProfile(jewelsForRun, write));
    } catch (err) {
      rmSync(dir, { recursive: true, force: true });
      // LOUD-FAIL: the SBPL-injection guard REFUSED to emit a profile from an
      // unsafe root (a `"`/`\`/newline/NUL that would break out of a
      // `(subpath "...")` literal and re-open writes — SBPL is last-match-wins).
      // This is a fail-closed REFUSAL: the spawn aborts rather than run
      // unconfined. We surface it at error level (never a silent fallthrough) so
      // the operator sees a confinement attempt was rejected for a malformed root.
      if (err instanceof SbplInjectionError) {
        console.error(
          `[coast-guard] REFUSED to build a Seatbelt profile — SBPL-injection guard ` +
            `rejected an unsafe write/deny root (fail-closed, spawn aborts): ${err.message}`,
        );
      }
      throw err;
    }
    // Operator visibility: a read-only write-deny profile is in force for this
    // spawn (the project workdir is write-confined — scope-tier containment).
    if (write.writePolicy === 'read-only' && write.readOnlyRoots.length > 0) {
      console.log(
        `[coast-guard] seatbelt read-only write-deny profile built — ` +
          `denying writes to ${write.readOnlyRoots.length} workdir root(s): ` +
          `${write.readOnlyRoots.join(', ')}`,
      );
    }
    return {
      cmd: 'sandbox-exec',
      args: ['-f', profile, cmd, ...args],
      confined: true,
      mechanism: 'seatbelt',
      cleanup: [dir],
    };
  }

  if (process.platform === 'linux') {
    const kind = detectLinuxSandbox();
    const project = workdir ? resolve(workdir) : process.cwd();
    const readOnly = write.writePolicy === 'read-only';
    if (kind === 'bwrap') {
      // bubblewrap: a fresh namespace; bind only what's needed and leave the
      // crown-jewel dirs unmounted, so they simply don't exist for the child.
      // For a read-only tier, bind the project READ-ONLY so the agent can read
      // but not mutate the shared state its bond covers.
      const bwArgs = [
        '--ro-bind', '/usr', '/usr',
        '--ro-bind', '/bin', '/bin',
        '--ro-bind', '/lib', '/lib',
        ...(existsSync('/lib64') ? ['--ro-bind', '/lib64', '/lib64'] : []),
        '--ro-bind', '/etc', '/etc',
        '--proc', '/proc',
        '--dev', '/dev',
        ...(readOnly ? ['--ro-bind', project, project] : ['--bind', project, project]),
        '--chdir', project,
        '--unshare-all',
        '--share-net', // outbound API needs the network (capped by the proxy)
        cmd, ...args,
      ];
      if (readOnly && workdir) {
        console.log(
          `[coast-guard] bwrap read-only profile built — project bound read-only ` +
            `(write-confined): ${project}`,
        );
      }
      return { cmd: 'bwrap', args: bwArgs, confined: true, mechanism: 'bwrap', cleanup: [] };
    }
    if (kind === 'landlock-helper') {
      const helper = binOnPath('pd-landlock') ? 'pd-landlock' : 'landrun';
      // Helper contract: `<helper> --allow <dir> -- <cmd...>`; deny-by-default.
      // Read-only tier: request read-only access to the project. The helper
      // flag is `--ro` (landrun) / `--allow-ro` (pd-landlock); both accept the
      // `--ro <dir>` long form, so we use the portable `--ro` here. A helper
      // that does not understand it will reject the flag loudly (fail-closed),
      // never silently grant write.
      const allowFlags = readOnly ? ['--ro', project] : ['--allow', project];
      if (readOnly && workdir) {
        console.log(
          `[coast-guard] landlock-helper (${helper}) read-only profile built — ` +
            `project granted read-only (write-confined): ${project}`,
        );
      }
      return {
        cmd: helper,
        args: [...allowFlags, '--', cmd, ...args],
        confined: true,
        mechanism: 'landlock-helper',
        cleanup: [],
      };
    }
  }

  // No OS sandbox available — honest degraded mode.
  return { cmd, args, confined: false, mechanism: 'none', cleanup: [] };
}

// ════════════════════════════════════════════════════════════════════════
//  Secret broker — scrub raw keys from the child env
// ════════════════════════════════════════════════════════════════════════
//
// The spawned agent's env must hold NO raw API key. We strip every managed
// secret key (the same allow-list secret-env.ts owns) from the child env.
// `cat .env.local` is already denied by the sandbox; this closes the other
// leak path — an env dump (`env`, /proc/<pid>/environ, `ps -E`).

export interface BrokerResult {
  /** Child env with all managed secret keys removed. */
  env: Record<string, string | undefined>;
  /** Keys that were present and scrubbed (names only — never values). */
  scrubbed: string[];
}

/**
 * Remove raw secret keys from the child env. Two sources are scrubbed:
 *   1. every managed secret key (the `secret-env.ts` allow-list);
 *   2. every key sourced from a loaded `.env` / `.env.local` (`dotenvKeys`) —
 *      because the operator's dotenv files ARE their secret store. Without (2)
 *      a NON-managed secret (STRIPE_SECRET_KEY, DATABASE_URL, GITHUB_TOKEN…)
 *      loaded from the dotenv would survive in the agent's env and defeat the
 *      "no raw key" promise. The sandbox already denies reading the dotenv on
 *      disk; this closes the env-inheritance path for the same files.
 *
 * Returns the scrubbed env plus the (name-only) list of what was removed.
 */
export function scrubRawSecretsFromEnv(
  env: Record<string, string | undefined>,
  dotenvKeys: readonly string[] = [],
): BrokerResult {
  const out: Record<string, string | undefined> = { ...env };
  const toScrub = new Set<string>([...managedSecretKeys(), ...dotenvKeys]);
  const scrubbed: string[] = [];
  for (const key of toScrub) {
    if (out[key] !== undefined && out[key] !== '') {
      scrubbed.push(key);
    }
    delete out[key];
  }
  return { env: out, scrubbed: scrubbed.sort() };
}

/** Lowercased provider host → managed secret key, for broker injection rules. */
const PROVIDER_HOST_TO_SECRET: Record<string, { key: string; header: string; scheme: string }> = {
  'api.anthropic.com': { key: 'ANTHROPIC_API_KEY', header: 'x-api-key', scheme: '' },
  'api.openai.com': { key: 'OPENAI_API_KEY', header: 'authorization', scheme: 'Bearer ' },
  'generativelanguage.googleapis.com': { key: 'GEMINI_API_KEY', header: 'x-goog-api-key', scheme: '' },
  'api.groq.com': { key: 'GROQ_API_KEY', header: 'authorization', scheme: 'Bearer ' },
};

/**
 * Build the broker injection map the egress proxy uses for PLAIN-HTTP outbound
 * calls. Only includes hosts whose key is actually present in the broker
 * (getSecret). Note the honest limit: TLS (https) calls are tunnelled via
 * CONNECT and cannot be injected without a MITM CA (phase 2) — so today this
 * covers the loopback / plain-HTTP shim path. The dominant protection is that
 * the raw key is not in the agent's env at all (scrubRawSecretsFromEnv).
 */
export function buildBrokerRules(): Record<string, { header: string; value: string }> {
  const rules: Record<string, { header: string; value: string }> = {};
  for (const [host, spec] of Object.entries(PROVIDER_HOST_TO_SECRET)) {
    const val = getSecret(spec.key);
    if (val) {
      rules[host] = { header: spec.header, value: `${spec.scheme}${val}` };
    }
  }
  return rules;
}

// ════════════════════════════════════════════════════════════════════════
//  The receipt
// ════════════════════════════════════════════════════════════════════════

export interface CoastGuardReceipt {
  tool: 'pd-coast-guard';
  agentId: string;
  backend: string;
  confined: boolean;
  mechanism: SandboxWrap['mechanism'];
  confinedPaths: string[];
  scrubbedSecrets: string[];
  egressCap: { maxRequests: number; maxBytes: number | null };
  egress: { requests: number; bytes: number; blocked: number; injected: number } | null;
  /**
   * Scope-tier WRITE confinement actually applied (lib/bond-pricing.ts
   * `scopeTierWritePolicy`). `'read-only'` means the agent was denied writes to
   * `writeDeniedPaths` (the project workdir). `'unrestricted'` means writes were
   * allowed (every non-read tier, or no workdir to scope to). Honest: this
   * reflects the policy the profile encoded; if `confined` is false (no OS
   * sandbox) a `'read-only'` policy was advisory, NOT enforced.
   */
  writePolicy: WriteConfinement['writePolicy'];
  /** Roots a read-only agent was write-denied (empty when unrestricted). */
  writeDeniedPaths: string[];
  startedAt: number;
  endedAt: number | null;
  /** The honesty disclosure, copied verbatim into every receipt. */
  honestLimits: string;
}

export const HONEST_LIMITS =
  'Cooperative-case defense: OS sandbox confinement (Seatbelt/Landlock) + raw-key ' +
  'scrub from the agent env + a hard request/byte egress cap. It does NOT defend a ' +
  'truly-malicious same-UID agent, which can bypass the proxy or read the daemon ' +
  "cache — that needs a separate UID/VM + forced egress (ADR-0050 phase 4). The cap " +
  'only meters clients that honor HTTPS_PROXY (most SDKs do; a raw-socket or ' +
  'proxy-ignorant client escapes it — phase 4 forced egress closes that). For HTTPS ' +
  'the cap is per-CONNECT-tunnel + bytes; dollar-accurate, per-request metering needs ' +
  'a MITM CA (phase 2). The path deny list is blast-radius reduction, not a full vault.';

// ════════════════════════════════════════════════════════════════════════
//  The confinement policy (what's on by default; opt-out env)
// ════════════════════════════════════════════════════════════════════════

// The escape hatch is intentionally NOT named in any agent-facing message — a
// guardrail must never advertise its own bypass (repo rule). It lives here for
// the power-user docs only.
const COAST_GUARD_BYPASS_ENV = 'PD_COAST_GUARD_OFF';

export interface CoastGuardPolicy {
  enabled: boolean;
  maxRequests: number;
  maxBytes: number | null;
}

/** Default egress caps — generous enough for real work, finite by construction. */
export const DEFAULT_MAX_REQUESTS = 5000;
export const DEFAULT_MAX_BYTES: number | null = null;

/**
 * Resolve the Coast Guard policy for a spawn. On by default. Disabled only by
 * the explicit operator escape hatch or an explicit per-spec opt-out. Pure +
 * env-injectable for tests.
 */
export function resolveCoastGuardPolicy(
  spec: { coastGuard?: boolean; maxRequests?: number; maxBytes?: number | null } = {},
  env: Record<string, string | undefined> = process.env,
): CoastGuardPolicy {
  const bypassed = env[COAST_GUARD_BYPASS_ENV] === '1' || spec.coastGuard === false;
  return {
    enabled: !bypassed,
    maxRequests: spec.maxRequests ?? DEFAULT_MAX_REQUESTS,
    maxBytes: spec.maxBytes ?? DEFAULT_MAX_BYTES,
  };
}

export { COAST_GUARD_BYPASS_ENV };

// ════════════════════════════════════════════════════════════════════════
//  The factory: confine a subprocess backend
// ════════════════════════════════════════════════════════════════════════

export interface ConfinementHandle {
  /** Sandboxed command + argv to exec instead of the raw one. */
  cmd: string;
  args: string[];
  /** Child env: raw keys scrubbed, HTTPS_PROXY pointed at the capped meter. */
  env: Record<string, string | undefined>;
  /** Whether OS confinement is actually in force (false on unsupported OS). */
  confined: boolean;
  mechanism: SandboxWrap['mechanism'];
  /** Read the live receipt (egress folded in) — call after the run. */
  receipt: () => CoastGuardReceipt;
  /** Tear down the proxy + temp files. Always call in finally. */
  dispose: () => void;
}

export interface CoastGuardDeps {
  /** The egress meter URL for proxy env; provided by the spawner per-agent. */
  proxyUrl: string;
  /** Read the live egress state (from the meter's state file). */
  readEgress: () => { requests: number; bytes: number; blocked: number; injected: number } | null;
  /** Clean up the proxy subprocess. */
  disposeProxy: () => void;
}

/**
 * Confine `(cmd, args, env)` for the given agent. The spawner has already
 * launched the egress meter and passes its handle in via `deps`. Returns a
 * ready-to-exec command, scrubbed env wired to the proxy, and a receipt
 * closure. This is the one place the three protections compose.
 */
export function confineCommand(params: {
  agentId: string;
  backend: string;
  cmd: string;
  args: string[];
  env: Record<string, string | undefined>;
  workdir?: string;
  policy: CoastGuardPolicy;
  deps: CoastGuardDeps;
  jewels?: CrownJewelPaths;
  /** Keys sourced from loaded .env/.env.local — scrubbed in full (see broker). */
  dotenvKeys?: readonly string[];
  /**
   * Scope-tier write confinement (lib/bond-pricing.ts `scopeTierWritePolicy`).
   * `'read-only'` denies writes to the project workdir; default `'unrestricted'`.
   * Only takes effect when a `workdir` is given (nothing project-scoped to deny
   * otherwise) AND an OS sandbox is available (else it is advisory, reported in
   * the receipt as writePolicy with confined:false).
   */
  writePolicy?: WriteConfinement['writePolicy'];
}): ConfinementHandle {
  const jewels = params.jewels ?? defaultCrownJewels();
  const startedAt = Date.now();
  const requestedWritePolicy: WriteConfinement['writePolicy'] = params.writePolicy ?? 'unrestricted';

  // 1. CONFINE — wrap under the OS sandbox (with scope-tier write policy).
  const wrap = wrapWithSandbox(
    params.cmd,
    params.args,
    jewels,
    params.workdir,
    requestedWritePolicy,
  );

  // The write policy is only IN FORCE when read-only was requested AND there is
  // a workdir to scope it to. Report exactly what was applied (honest).
  const writeDeniedPaths =
    requestedWritePolicy === 'read-only' && params.workdir
      ? [resolve(params.workdir), safeRealpath(resolve(params.workdir))].filter(
          (v, i, a) => a.indexOf(v) === i,
        )
      : [];
  const effectiveWritePolicy: WriteConfinement['writePolicy'] =
    writeDeniedPaths.length > 0 ? 'read-only' : 'unrestricted';

  // 2. BROKER — scrub raw secret keys (managed + every dotenv-sourced key).
  const broker = scrubRawSecretsFromEnv(params.env, params.dotenvKeys);

  // 3. CAP — force outbound traffic through the capped meter proxy.
  //
  // NO_PROXY exempts loopback + .local from the proxy so the agent's Port Daddy
  // coordination (the daemon on loopback, Unix sockets, `pd` CLI) and any
  // LOCAL HTTP MCP server keep working AND never consume the external-spend cap.
  // Confinement does not break the coordination bus: the Seatbelt/Landlock
  // profile only denies secret-file READS, not network or process exec, and
  // stdio-based MCP servers (the common case) run as child processes unaffected
  // by the egress proxy entirely. The cap is for OUTBOUND PROVIDER spend.
  const noProxy = 'localhost,127.0.0.1,::1,.local';
  const env: Record<string, string | undefined> = {
    ...broker.env,
    HTTPS_PROXY: params.deps.proxyUrl,
    HTTP_PROXY: params.deps.proxyUrl,
    https_proxy: params.deps.proxyUrl,
    http_proxy: params.deps.proxyUrl,
    NO_PROXY: mergeNoProxy(broker.env.NO_PROXY ?? broker.env.no_proxy, noProxy),
    no_proxy: mergeNoProxy(broker.env.no_proxy ?? broker.env.NO_PROXY, noProxy),
    // Mark the run as Coast-Guarded so in-sandbox tooling can detect it.
    PD_COAST_GUARD: '1',
  };

  const confinedPaths = [
    ...jewels.deniedDirs.map((d) => d.replace(jewels.home, '~')),
    '**/.env',
    '**/.env.local',
  ];

  let endedAt: number | null = null;
  const receipt = (): CoastGuardReceipt => {
    endedAt = endedAt ?? Date.now();
    return {
      tool: 'pd-coast-guard',
      agentId: params.agentId,
      backend: params.backend,
      confined: wrap.confined,
      mechanism: wrap.mechanism,
      confinedPaths,
      scrubbedSecrets: broker.scrubbed,
      egressCap: { maxRequests: params.policy.maxRequests, maxBytes: params.policy.maxBytes },
      egress: params.deps.readEgress(),
      writePolicy: effectiveWritePolicy,
      writeDeniedPaths,
      startedAt,
      endedAt,
      honestLimits: HONEST_LIMITS,
    };
  };

  const dispose = (): void => {
    endedAt = endedAt ?? Date.now();
    params.deps.disposeProxy();
    for (const c of wrap.cleanup) {
      try {
        rmSync(c, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  };

  return {
    cmd: wrap.cmd,
    args: wrap.args,
    env,
    confined: wrap.confined,
    mechanism: wrap.mechanism,
    receipt,
    dispose,
  };
}
