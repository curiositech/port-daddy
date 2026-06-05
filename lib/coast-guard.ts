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

// ════════════════════════════════════════════════════════════════════════
//  macOS — Seatbelt (sandbox-exec) profile
// ════════════════════════════════════════════════════════════════════════
//
// `(allow default)` keeps normal work intact; we only carve out denials for
// the crown jewels. This mirrors and hardens tools/coast-guard/pd-cutter's
// prototype profile. The **/.env regex denies every dotenv anywhere under
// $HOME (the project's own .env included) — reads of secrets, not of code.

/**
 * Build a Seatbelt profile (SBPL) that denies reads to the crown jewels while
 * allowing everything else. Pure + deterministic for unit testing.
 */
export function buildSeatbeltProfile(jewels: CrownJewelPaths): string {
  const home = jewels.home;
  // Anchor the dotenv regex under $HOME. Seatbelt uses a TRE-ish regex dialect
  // that mishandles some POSIX character classes, so we keep it minimal and
  // VALIDATED on a real macOS box: match `/.env` followed by end-of-path OR a
  // dot (so `.env`, `.env.local`, `.env.production` are denied) but NOT
  // `.environment_notes`. Escape regex metachars in the $HOME prefix.
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Deny dotenv files under $HOME and under each extra root (the project
  // workdir, which may sit outside HOME). `/.env` followed by end-or-dot.
  const dotenvRoots = [home, ...(jewels.extraDotenvRoots ?? [])].filter(Boolean);
  const dotenvDenies = dotenvRoots.map(
    (root) => `(deny file-read* (regex #"^${esc(root)}/.*/\\.env($|\\.)"))`,
  );
  // Also catch a dotenv at the IMMEDIATE root (no intervening dir), e.g.
  // <workdir>/.env.local — the `/.*/` form above requires a subdir.
  const dotenvDirectDenies = dotenvRoots.map(
    (root) => `(deny file-read* (regex #"^${esc(root)}/\\.env($|\\.)"))`,
  );
  const lines = [
    '(version 1)',
    '(allow default)',
    ...jewels.deniedDirs.map((d) => `(deny file-read* (subpath "${d}"))`),
    ...dotenvDenies,
    ...dotenvDirectDenies,
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
 */
export function wrapWithSandbox(
  cmd: string,
  args: string[],
  jewels: CrownJewelPaths,
  workdir?: string,
): SandboxWrap {
  // Always deny the project workdir's own dotenv files, even when the workdir
  // lives outside $HOME (a /var/folders worktree, a sortie dir). Seatbelt
  // matches against the CANONICAL path (macOS /var → /private/var symlink), so
  // we add both the resolved and the requested path as roots.
  const jewelsForRun: CrownJewelPaths = workdir
    ? {
        ...jewels,
        extraDotenvRoots: [
          ...(jewels.extraDotenvRoots ?? []),
          resolve(workdir),
          safeRealpath(resolve(workdir)),
        ].filter((v, i, a) => a.indexOf(v) === i),
      }
    : jewels;

  if (process.platform === 'darwin' && seatbeltAvailable()) {
    const dir = mkdtempSync(join(tmpdir(), 'pd-coast-'));
    const profile = join(dir, 'profile.sb');
    writeFileSync(profile, buildSeatbeltProfile(jewelsForRun));
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
    if (kind === 'bwrap') {
      // bubblewrap: a fresh namespace; bind only what's needed and leave the
      // crown-jewel dirs unmounted, so they simply don't exist for the child.
      const bwArgs = [
        '--ro-bind', '/usr', '/usr',
        '--ro-bind', '/bin', '/bin',
        '--ro-bind', '/lib', '/lib',
        ...(existsSync('/lib64') ? ['--ro-bind', '/lib64', '/lib64'] : []),
        '--ro-bind', '/etc', '/etc',
        '--proc', '/proc',
        '--dev', '/dev',
        '--bind', project, project,
        '--chdir', project,
        '--unshare-all',
        '--share-net', // outbound API needs the network (capped by the proxy)
        cmd, ...args,
      ];
      return { cmd: 'bwrap', args: bwArgs, confined: true, mechanism: 'bwrap', cleanup: [] };
    }
    if (kind === 'landlock-helper') {
      const helper = binOnPath('pd-landlock') ? 'pd-landlock' : 'landrun';
      // Helper contract: `<helper> --allow <dir> -- <cmd...>`; deny-by-default.
      return {
        cmd: helper,
        args: ['--allow', project, '--', cmd, ...args],
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
}): ConfinementHandle {
  const jewels = params.jewels ?? defaultCrownJewels();
  const startedAt = Date.now();

  // 1. CONFINE — wrap under the OS sandbox.
  const wrap = wrapWithSandbox(params.cmd, params.args, jewels, params.workdir);

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
