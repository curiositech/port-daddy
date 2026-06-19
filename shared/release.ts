/**
 * Release orchestration — `pd release cut` (ADR-0084 Phase 3, the manual RC cut).
 *
 * A release bundles the three decoupled artifacts that otherwise build independently:
 * the bun-compiled daemon binary, the Rust cdylib kernel, and the FleetBar.app. This
 * module is the single source of truth for *which* artifacts a cut contains and *how*
 * each is built, hashed, optionally signed (ADR-0057 / `scripts/sign-and-notarize.mjs`),
 * and recorded in a manifest. It is the deliberate human/CI act the berth model defers
 * to (the `stable` tier is "whatever this cut produced").
 *
 * Split into a pure planner (`planRelease`) + a runner with injected effects
 * (`runRelease`) so the orchestration — build order, artifact paths, the manifest shape,
 * the signed/unsigned accounting — is fully testable without invoking bun/cargo/swift.
 * Honest by default: signing is opt-in; an unsigned cut says so in the manifest.
 */

import type { BerthTier } from './daemon-berths.js';

export type ReleaseArtifactKind = 'daemon' | 'core' | 'fleetbar';

export interface ReleaseArtifact {
  name: string;
  kind: ReleaseArtifactKind;
  /** The existing build script that produces this artifact. */
  build: { cmd: string; args: string[] };
  /** Where the build script writes the artifact (repo-relative). */
  output: string;
  /** Whether this artifact can be code-signed on this platform. */
  signable: boolean;
}

export interface ReleasePlan {
  version: string;
  gitSha: string;
  tier: BerthTier;
  platform: NodeJS.Platform;
  outDir: string;
  artifacts: ReleaseArtifact[];
}

/** Compute the artifacts a cut contains, their build commands, and their output paths.
 *  Pure — no IO. */
export function planRelease(opts: {
  version: string;
  gitSha: string;
  platform: NodeJS.Platform;
  tier?: BerthTier;
}): ReleasePlan {
  const { version, gitSha, platform } = opts;
  const libExt = platform === 'darwin' ? 'dylib' : 'so';
  const daemonBin = platform === 'win32' ? 'port-daddy-daemon.exe' : 'port-daddy-daemon';
  const outDir = `dist/release/${version}`;
  return {
    version,
    gitSha,
    tier: opts.tier ?? 'stable',
    platform,
    outDir,
    artifacts: [
      {
        name: daemonBin,
        kind: 'daemon',
        build: { cmd: 'node', args: ['scripts/build-daemon-binary.mjs'] },
        output: `dist/daemon/${daemonBin}`,
        signable: platform === 'darwin',
      },
      {
        name: `libharbor_card_rs.${libExt}`,
        kind: 'core',
        build: { cmd: 'bash', args: ['scripts/build-core.sh'] },
        output: `dist/core/libharbor_card_rs.${libExt}`,
        signable: platform === 'darwin',
      },
      {
        // package-fleetbar.sh takes the output dir as $1 and writes FleetBar.app.zip there
        name: 'FleetBar.app.zip',
        kind: 'fleetbar',
        build: { cmd: 'bash', args: ['scripts/package-fleetbar.sh', outDir] },
        output: `${outDir}/FleetBar.app.zip`,
        signable: platform === 'darwin',
      },
    ],
  };
}

export interface ReleaseManifestEntry {
  name: string;
  kind: ReleaseArtifactKind;
  path: string;
  sha256: string;
  bytes: number;
  signed: boolean;
}

export interface ReleaseManifest {
  version: string;
  gitSha: string;
  tier: BerthTier;
  platform: NodeJS.Platform;
  createdAt: number;
  /** True iff signing was requested AND every signable artifact was signed. */
  signed: boolean;
  artifacts: ReleaseManifestEntry[];
}

/**
 * Env vars the signing recipe (ADR-0057, `scripts/sign-and-notarize.mjs`) reads.
 * Named here so the cut's pre-flight and the script agree on one set of keys.
 */
export const SIGN_ENV = {
  identity: 'PORT_DADDY_SIGN_IDENTITY',
  notaryProfile: 'PORT_DADDY_NOTARY_PROFILE',
  skipNotarize: 'PORT_DADDY_SKIP_NOTARIZE',
} as const;

export interface SigningPreflight {
  ok: boolean;
  /** Why a required cut can't be signed (only set when ok === false). */
  reason?: string;
  /** Whether notarization will run (false when PORT_DADDY_SKIP_NOTARIZE=1). */
  willNotarize: boolean;
}

/**
 * Decide, *before any heavy build*, whether a sign-required cut can actually be
 * signed on this machine — so `pd cut --require-sign` fails fast instead of after
 * a multi-minute build. Pure: reads an injected env + platform, touches nothing.
 *
 * A distributable cut needs:
 *   - darwin (codesign/notarytool are macOS-only),
 *   - PORT_DADDY_SIGN_IDENTITY (the Developer ID), and
 *   - PORT_DADDY_NOTARY_PROFILE unless PORT_DADDY_SKIP_NOTARIZE=1 (local sign-only).
 */
export function signingPreflight(opts: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}): SigningPreflight {
  const { platform, env } = opts;
  const skipNotarize = env[SIGN_ENV.skipNotarize] === '1';
  if (platform !== 'darwin') {
    return { ok: false, willNotarize: false, reason: `signing requires darwin (this is ${platform})` };
  }
  if (!env[SIGN_ENV.identity]?.trim()) {
    return { ok: false, willNotarize: !skipNotarize, reason: `${SIGN_ENV.identity} is not set (the Developer ID codesign identity)` };
  }
  if (!skipNotarize && !env[SIGN_ENV.notaryProfile]?.trim()) {
    return {
      ok: false,
      willNotarize: true,
      reason: `${SIGN_ENV.notaryProfile} is not set (create with: xcrun notarytool store-credentials), or set ${SIGN_ENV.skipNotarize}=1 to sign without notarizing`,
    };
  }
  return { ok: true, willNotarize: !skipNotarize };
}

export interface RunReleaseDeps {
  /** Run a build script; MUST throw if the build fails. */
  exec: (cmd: string, args: string[]) => void;
  hashFile: (path: string) => { sha256: string; bytes: number };
  /** Copy `from` into the release outDir under `toName`; return the destination path. */
  collect: (from: string, toName: string) => string;
  /** Sign one binary (e.g. via scripts/sign-and-notarize.mjs); return true on success. */
  sign?: (path: string) => boolean;
  writeManifest: (manifestPath: string, manifest: ReleaseManifest) => void;
  log: (msg: string) => void;
  now: () => number;
}

/**
 * Build every artifact, collect it into the release dir, hash it, optionally sign it,
 * and write `<outDir>/manifest.json`. Returns the manifest. Build failures propagate
 * (a partial cut must not be recorded as a release).
 */
export function runRelease(plan: ReleasePlan, deps: RunReleaseDeps, opts: { sign?: boolean } = {}): ReleaseManifest {
  const wantSign = !!opts.sign;
  const entries: ReleaseManifestEntry[] = [];

  for (const a of plan.artifacts) {
    deps.log(`▸ ${a.kind}: ${a.build.cmd} ${a.build.args.join(' ')}`);
    deps.exec(a.build.cmd, a.build.args);
    // fleetbar already writes into outDir; the others are collected in from their build dir
    const dest = a.kind === 'fleetbar' ? a.output : deps.collect(a.output, a.name);

    let signed = false;
    if (wantSign && a.signable && deps.sign) {
      signed = deps.sign(dest);
    }
    const { sha256, bytes } = deps.hashFile(dest);
    entries.push({ name: a.name, kind: a.kind, path: dest, sha256, bytes, signed });
    deps.log(`  ✓ ${dest} — ${bytes} B, sha256 ${sha256.slice(0, 12)}…${signed ? ' (signed)' : wantSign && a.signable ? ' (SIGN FAILED)' : ''}`);
  }

  // A cut is "signed" only if every signable artifact actually got signed.
  const allSignableSigned = entries
    .filter((e) => plan.artifacts.find((a) => a.name === e.name)?.signable)
    .every((e) => e.signed);

  const manifest: ReleaseManifest = {
    version: plan.version,
    gitSha: plan.gitSha,
    tier: plan.tier,
    platform: plan.platform,
    createdAt: deps.now(),
    signed: wantSign && allSignableSigned,
    artifacts: entries,
  };
  deps.writeManifest(`${plan.outDir}/manifest.json`, manifest);
  deps.log(
    manifest.signed
      ? `release ${plan.version} (${plan.tier}) cut + signed → ${plan.outDir}`
      : `release ${plan.version} (${plan.tier}) cut UNSIGNED → ${plan.outDir} (run with --sign + signing creds for a distributable cut)`,
  );
  return manifest;
}
