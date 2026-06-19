/**
 * pd release cut — the manual RC cut (ADR-0084 Phase 3).
 *
 * Builds the three release artifacts (daemon binary, Rust cdylib, FleetBar.app) via the
 * existing build scripts, collects them into `dist/release/<version>/`, hashes each, and
 * writes a manifest. Signing (ADR-0057) is opt-in via --sign; without it the manifest
 * records the cut as UNSIGNED (not distributable, and it says so).
 *
 *   pd cut                 build + hash an unsigned cut
 *   pd cut --sign          also code-sign + notarize each signable artifact
 *   pd cut --tier dev-latest   label the cut for a non-stable tier
 *   pd cut --json          print the manifest as JSON
 *
 * (Verb is `cut`, not `release` — `pd release` already releases a claimed port.)
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { planRelease, runRelease, type ReleaseManifest } from '../../shared/release.js';
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
  const sign = !!options.sign;
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
        exec: (cmd, a) => {
          const r = spawnSync(cmd, a, { cwd: repoRoot, stdio: isJson(options) ? 'ignore' : 'inherit' });
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
          const r = spawnSync('node', ['scripts/sign-and-notarize.mjs', p], {
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
}
