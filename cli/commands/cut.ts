/**
 * pd release cut — the manual RC cut (ADR-0084 Phase 3).
 *
 * Builds the three release artifacts (daemon binary, Rust cdylib, FleetBar.app) via the
 * existing build scripts, collects them into `dist/release/<version>/`, hashes each, and
 * writes a manifest. Signing (ADR-0057) is opt-in via --sign; without it the manifest
 * records the cut as UNSIGNED (not distributable, and it says so).
 *
 *   pd cut                 build + hash an unsigned cut
 *   pd cut --sign          also code-sign + notarize each signable artifact (best-effort)
 *   pd cut --require-sign  like --sign, but fail the cut if signing can't complete
 *   pd cut --tier dev-latest   label the cut for a non-stable tier
 *   pd cut --json          print the manifest as JSON
 *
 * --sign vs --require-sign: --sign records an honest unsigned manifest and exits 0
 * if creds are absent (a dev convenience). --require-sign is for the actual release
 * pipeline — it pre-flights the signing creds before building (fail fast) and exits
 * non-zero if any signable artifact ends up unsigned, so an unsigned binary can never
 * be mistaken for a distributable cut.
 *
 * (Verb is `cut`, not `release` — `pd release` already releases a claimed port.)
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { planRelease, runRelease, signingPreflight, type ReleaseManifest } from '../../shared/release.js';
import type { BerthTier } from '../../shared/daemon-berths.js';
import { CLIOptions, isJson } from '../types.js';
import * as ui from '../utils/ui.js';

export async function handleCut(_args: string[], options: CLIOptions): Promise<void> {
  const repoRoot = process.cwd();
  let version: string;
  try {
    version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  } catch {
    ui.error('release cut must run from the repo root (package.json not found)');
    process.exit(1);
  }
  let gitSha = 'unknown';
  const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  if (rev.status === 0) gitSha = rev.stdout.trim();

  const tier = (typeof options.tier === 'string' ? options.tier : 'stable') as BerthTier;
  const requireSign = !!options['require-sign'];
  // --require-sign implies --sign; a required cut always attempts to sign.
  const sign = requireSign || !!options.sign;

  // Fail fast: when signing is REQUIRED, verify the creds are present before we
  // spend minutes building three artifacts only to discover we can't sign them.
  if (requireSign) {
    const pre = signingPreflight({ platform: process.platform, env: process.env });
    if (!pre.ok) {
      ui.error(`--require-sign: ${pre.reason}`);
      process.exit(1);
    }
    if (!isJson(options)) {
      ui.info(pre.willNotarize ? 'Signing creds present — will codesign + notarize' : 'Signing creds present — will codesign only (notarization skipped)');
    }
  }

  const plan = planRelease({ version, gitSha, platform: process.platform, tier });
  mkdirSync(join(repoRoot, plan.outDir), { recursive: true });

  if (!isJson(options)) {
    ui.info(`Cutting release ${version} (${tier}, ${gitSha})${sign ? ' — signed' : ' — UNSIGNED'}`);
  }

  let manifest: ReleaseManifest;
  try {
    manifest = runRelease(
      plan,
      {
        exec: (cmd, a, env) => {
          const r = spawnSync(cmd, a, {
            cwd: repoRoot,
            stdio: isJson(options) ? 'ignore' : 'inherit',
            env: env ? { ...process.env, ...env } : process.env,
          });
          if (r.status !== 0) throw new Error(`build failed: ${cmd} ${a.join(' ')} (exit ${r.status ?? 'signal'})`);
        },
        hashFile: (p) => {
          const abs = join(repoRoot, p);
          return { sha256: createHash('sha256').update(readFileSync(abs)).digest('hex'), bytes: statSync(abs).size };
        },
        collect: (from, name) => {
          const dest = join(plan.outDir, name);
          copyFileSync(join(repoRoot, from), join(repoRoot, dest));
          return dest;
        },
        sign: (p) => {
          // Capture the per-artifact signing manifest (codesign/notarize/gatekeeper
          // detail) next to the cut, so a release leaves an auditable signing trail.
          const signManifest = join(plan.outDir, `sign-${basename(p)}.json`);
          const r = spawnSync('node', ['scripts/sign-and-notarize.mjs', p, '--manifest', signManifest], {
            cwd: repoRoot,
            stdio: isJson(options) ? 'ignore' : 'inherit',
          });
          return r.status === 0;
        },
        writeManifest: (path, m) => writeFileSync(join(repoRoot, path), JSON.stringify(m, null, 2) + '\n'),
        log: (msg) => { if (!isJson(options)) console.log(msg); },
        now: () => Date.now(),
      },
      { sign },
    );
  } catch (err) {
    ui.error((err as Error).message);
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(manifest, null, 2));
  } else if (!manifest.signed) {
    ui.warn('Cut is UNSIGNED — not distributable. Re-run with --sign and signing creds (PORT_DADDY_SIGN_IDENTITY / PORT_DADDY_NOTARY_PROFILE).');
  } else {
    ui.success(`Signed release ${version} ready in ${plan.outDir}`);
  }

  // Fail-closed: a required cut that came out unsigned is a release-pipeline
  // failure, not a warning. Pre-flight passed, so this means codesign/notarize
  // itself failed (e.g. an expired cert or a rejected notarization) — exit
  // non-zero so the pipeline halts and the unsigned artifacts aren't shipped.
  if (requireSign && !manifest.signed) {
    ui.error('--require-sign: cut completed but is UNSIGNED (codesign/notarize failed). Inspect the sign-*.json manifests in the cut dir.');
    process.exit(3);
  }
}
