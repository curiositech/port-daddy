/**
 * `pd batten` — declarative release-artifact packing gate.
 *
 * "Battening down the hatches": before a release tarball sails, every artifact
 * that MUST be aboard is sealed and checked against a manifest. This generalizes
 * the scattered `test -s dist/<name>` shell asserts that #3496 (pd-bosun) and the
 * squid-tentacle staging step each introduced — a pattern that silently drifts,
 * one binary at a time, and shipped releases with a missing watchdog / missing
 * hooks GREEN. release-artifacts.json is now the single source of truth.
 *
 *   pd batten verify [--staged-dir <dir>] [--manifest <file>] [--json]
 *     For every manifest entry, assert the staged path exists, is executable if
 *     declared executable, and is >= minBytes. Collects ALL failures (never
 *     stops at the first) and exits nonzero with a per-artifact report. This is
 *     the anti-silent-failure gate.
 *
 *   pd batten imprint [--staged-dir <dir>] [--manifest <file>] [--out <file>]
 *     sha256 every staged artifact and write a release-imprint.json — the
 *     content-addressed record of the sealed cargo (id -> {sha256, bytes,
 *     stagedPath}).
 *
 * Dependency-light on purpose: node stdlib only (fs, path, crypto). This runs
 * offline in CI against a staged dir; it never talks to the daemon.
 */
import {
  createHash,
} from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ui from '../utils/ui.js';
import type { CLIOptions } from '../types.js';

const __batten_dir = dirname(fileURLToPath(import.meta.url));

export type ArtifactType = 'file' | 'dir';

export interface ArtifactEntry {
  id: string;
  buildCmd?: string;
  sourcePath?: string;
  stagedPath: string;
  type?: ArtifactType;
  required?: boolean;
  executable?: boolean;
  minBytes?: number;
}

export interface ReleaseManifest {
  version?: number;
  artifacts: ArtifactEntry[];
}

export interface ArtifactVerifyResult {
  id: string;
  stagedPath: string;
  absPath: string;
  required: boolean;
  type: ArtifactType;
  present: boolean;
  isExecutable: boolean | null;
  bytes: number | null;
  /** Human-readable failure reasons; empty means the artifact passed. */
  failures: string[];
}

export interface VerifyReport {
  ok: boolean;
  stagedDir: string;
  results: ArtifactVerifyResult[];
  /** ids of required artifacts that failed — the loud list. */
  failedRequired: string[];
}

export interface ArtifactImprint {
  id: string;
  stagedPath: string;
  bytes: number;
  sha256: string;
}

export interface ImprintRecord {
  version: number;
  generatedAt: string;
  stagedDir: string;
  /**
   * The commit these artifacts were built from, as a full lowercase SHA.
   *
   * The Homebrew tap's release-evidence verifier compares this against the
   * candidate commit it is asked to roll and REFUSES the formula update on a
   * mismatch — that is the whole point of the imprint: proving the bytes came
   * from the commit being tagged. It was never emitted, so v3.28.0 built,
   * signed, notarized, and published green and then failed in the tap with
   * "sourceCommit does not match candidate" (undefined matches nothing),
   * leaving every `brew upgrade` user on 3.27.0.
   *
   * Resolved from GITHUB_SHA (set on every Actions runner) and otherwise from
   * `git rev-parse HEAD`; `null` only outside a git checkout, which the
   * verifier will correctly still reject.
   */
  sourceCommit: string | null;
  artifacts: Record<string, ArtifactImprint>;
  /** required artifacts that were absent at imprint time (empty on a sealed release). */
  missingRequired: string[];
}

/**
 * Resolve the manifest path. Precedence: explicit --manifest, then
 * release-artifacts.json in the cwd (CI runs from repo root), then a
 * module-relative repo-root fallback (dev-from-source).
 */
export function resolveManifestPath(explicit?: string): string {
  if (explicit) return resolve(explicit);
  const cwdCandidate = resolve(process.cwd(), 'release-artifacts.json');
  if (existsSync(cwdCandidate)) return cwdCandidate;
  // cli/commands/batten.ts -> repo root is two dirs up.
  return resolve(__batten_dir, '..', '..', 'release-artifacts.json');
}

export function loadManifest(manifestPath: string): ReleaseManifest {
  if (!existsSync(manifestPath)) {
    throw new Error(`release manifest not found: ${manifestPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`release manifest is not valid JSON (${manifestPath}): ${(err as Error).message}`);
  }
  const obj = parsed as Partial<ReleaseManifest>;
  if (!obj || !Array.isArray(obj.artifacts)) {
    throw new Error(`release manifest ${manifestPath} must have an "artifacts" array`);
  }
  const seen = new Set<string>();
  for (const [i, a] of obj.artifacts.entries()) {
    if (!a || typeof a.id !== 'string' || a.id.length === 0) {
      throw new Error(`release manifest artifact[${i}] is missing a string "id"`);
    }
    if (typeof a.stagedPath !== 'string' || a.stagedPath.length === 0) {
      throw new Error(`release manifest artifact "${a.id}" is missing a string "stagedPath"`);
    }
    if (seen.has(a.id)) {
      throw new Error(`release manifest has a duplicate artifact id: "${a.id}"`);
    }
    seen.add(a.id);
  }
  return { version: obj.version, artifacts: obj.artifacts };
}

function isExecutableMode(mode: number): boolean {
  // any of owner/group/other execute bits
  return (mode & 0o111) !== 0;
}

/**
 * Verify every artifact against the staged dir. Pure: no process.exit, no
 * printing. Collects ALL failures for ALL artifacts (the anti-silent-failure
 * contract) so a caller can report every problem at once.
 */
export function verifyArtifacts(manifest: ReleaseManifest, stagedDir: string): VerifyReport {
  const stagedDirAbs = resolve(stagedDir);
  const results: ArtifactVerifyResult[] = [];
  const failedRequired: string[] = [];

  for (const entry of manifest.artifacts) {
    const required = entry.required !== false; // default true
    const type: ArtifactType = entry.type === 'dir' ? 'dir' : 'file';
    const wantExecutable = entry.executable === true;
    const absPath = isAbsolute(entry.stagedPath)
      ? entry.stagedPath
      : join(stagedDirAbs, entry.stagedPath);

    const failures: string[] = [];
    let present = false;
    let isExecutable: boolean | null = null;
    let bytes: number | null = null;

    if (!existsSync(absPath)) {
      present = false;
      failures.push(`missing: expected ${type} at ${entry.stagedPath} (${absPath})`);
    } else {
      try {
        const st = statSync(absPath);
        present = true;
        if (type === 'dir') {
          if (!st.isDirectory()) {
            failures.push(`expected a directory at ${entry.stagedPath}, found a file`);
          } else {
            try {
              const kids = readdirSync(absPath);
              bytes = kids.length; // reuse bytes field as entry count for dirs
              if (kids.length === 0) {
                failures.push(`directory ${entry.stagedPath} is empty`);
              }
            } catch (error) {
              failures.push(`cannot read directory ${entry.stagedPath}: ${(error as Error).message}`);
            }
          }
        } else {
          if (st.isDirectory()) {
            failures.push(`expected a file at ${entry.stagedPath}, found a directory`);
          } else {
            bytes = st.size;
            isExecutable = isExecutableMode(st.mode);
            const floor = typeof entry.minBytes === 'number' ? entry.minBytes : 1;
            if (st.size < floor) {
              failures.push(`too small: ${st.size} bytes < required minimum ${floor}`);
            }
            if (wantExecutable && !isExecutable) {
              failures.push(`not executable: ${entry.stagedPath} is missing an execute bit (mode ${(st.mode & 0o777).toString(8)})`);
            }
          }
        }
      } catch (error) {
        present = true;
        failures.push(`cannot inspect ${entry.stagedPath}: ${(error as Error).message}`);
      }
    }

    // A non-required, absent artifact is not a failure — clear its reasons.
    const effectiveFailures = required || present ? failures : [];
    if (required && effectiveFailures.length > 0) {
      failedRequired.push(entry.id);
    }

    results.push({
      id: entry.id,
      stagedPath: entry.stagedPath,
      absPath,
      required,
      type,
      present,
      isExecutable,
      bytes,
      failures: effectiveFailures,
    });
  }

  return {
    ok: failedRequired.length === 0,
    stagedDir: stagedDirAbs,
    results,
    failedRequired,
  };
}

function sha256File(absPath: string): { sha256: string; bytes: number } {
  const hash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(absPath, 'r');
  let bytes = 0;
  try {
    for (;;) {
      const read = readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (read === 0) break;
      hash.update(chunk.subarray(0, read));
      bytes += read;
    }
  } finally {
    closeSync(descriptor);
  }
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * Content-address every present file artifact under the staged dir. Directory
 * artifacts (type: dir) are skipped (a dir has no single stable hash). Returns
 * the imprint record plus the list of required-but-absent artifacts.
 */
export function imprintArtifacts(manifest: ReleaseManifest, stagedDir: string): ImprintRecord {
  const stagedDirAbs = resolve(stagedDir);
  const artifacts: Record<string, ArtifactImprint> = {};
  const missingRequired: string[] = [];

  for (const entry of manifest.artifacts) {
    const required = entry.required !== false;
    const type: ArtifactType = entry.type === 'dir' ? 'dir' : 'file';
    const absPath = isAbsolute(entry.stagedPath)
      ? entry.stagedPath
      : join(stagedDirAbs, entry.stagedPath);

    if (!existsSync(absPath)) {
      if (required) missingRequired.push(entry.id);
      continue;
    }
    if (type === 'dir' || statSync(absPath).isDirectory()) {
      // Directories are validated by verify, not imprinted.
      continue;
    }
    const { sha256, bytes } = sha256File(absPath);
    artifacts[entry.id] = { id: entry.id, stagedPath: entry.stagedPath, bytes, sha256 };
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    stagedDir: stagedDirAbs,
    sourceCommit: resolveSourceCommit(),
    artifacts,
    missingRequired,
  };
}

/**
 * The commit the staged artifacts were built from, as a full lowercase SHA.
 *
 * Prefers GITHUB_SHA — on a tag build that is exactly the commit the tap will
 * be asked to roll — and falls back to the working tree's HEAD for local
 * imprints. Returns null when neither is available rather than guessing, so a
 * consumer sees "no evidence" instead of a plausible-but-wrong commit.
 */
function resolveSourceCommit(): string | null {
  const fromEnv = process.env.GITHUB_SHA?.trim().toLowerCase();
  if (fromEnv && /^[0-9a-f]{40}$/.test(fromEnv)) return fromEnv;
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
      .trim()
      .toLowerCase();
    return /^[0-9a-f]{40}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

function stagedDirFromOptions(options: CLIOptions): string {
  const raw = options['staged-dir'] ?? options.stagedDir ?? 'dist';
  return typeof raw === 'string' ? raw : 'dist';
}

function manifestFromOptions(options: CLIOptions): string {
  const raw = options.manifest;
  return resolveManifestPath(typeof raw === 'string' ? raw : undefined);
}

function printVerifyReport(report: VerifyReport, manifestPath: string, options: CLIOptions): void {
  if (options.json || options.j) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  ui.intro('pd batten verify');
  console.log(`manifest:   ${manifestPath}`);
  console.log(`staged dir: ${report.stagedDir}`);
  console.log('');
  for (const r of report.results) {
    const tag = r.required ? '' : ' (optional)';
    if (r.failures.length === 0) {
      const detail = r.type === 'dir'
        ? (r.present ? `dir, ${r.bytes ?? 0} entries` : 'absent')
        : `${r.bytes ?? 0} bytes${r.isExecutable ? ', +x' : ''}`;
      ui.success(`${r.id}${tag} — ${r.stagedPath} (${detail})`);
    } else {
      for (const f of r.failures) {
        ui.error(`${r.id}${tag} — ${f}`);
      }
    }
  }
  console.log('');
  if (report.ok) {
    ui.success(`All required release artifacts present and valid (${report.results.length} declared).`);
  } else {
    ui.error(`Release NOT sealed — ${report.failedRequired.length} required artifact(s) failed: ${report.failedRequired.join(', ')}`);
    ui.error('Fix the staging steps in .github/workflows/release.yml (or release-artifacts.json) before shipping.');
  }
}

async function runVerify(options: CLIOptions): Promise<void> {
  const manifestPath = manifestFromOptions(options);
  const manifest = loadManifest(manifestPath);
  const stagedDir = stagedDirFromOptions(options);
  const report = verifyArtifacts(manifest, stagedDir);
  printVerifyReport(report, manifestPath, options);
  if (!report.ok) process.exit(1);
}

async function runImprint(options: CLIOptions): Promise<void> {
  const manifestPath = manifestFromOptions(options);
  const manifest = loadManifest(manifestPath);
  const stagedDir = stagedDirFromOptions(options);
  const record = imprintArtifacts(manifest, stagedDir);

  const outRaw = options.out;
  const outPath = typeof outRaw === 'string'
    ? resolve(outRaw)
    : resolve(record.stagedDir, 'release-imprint.json');
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);

  if (options.json || options.j) {
    console.log(JSON.stringify({ ...record, outPath }, null, 2));
  } else {
    ui.intro('pd batten imprint');
    console.log(`manifest:   ${manifestPath}`);
    console.log(`staged dir: ${record.stagedDir}`);
    console.log('');
    for (const [id, imp] of Object.entries(record.artifacts)) {
      console.log(`  ${imp.sha256}  ${imp.bytes.toString().padStart(9)}  ${id} (${imp.stagedPath})`);
    }
    console.log('');
    if (record.missingRequired.length > 0) {
      ui.warn(`Wrote an INCOMPLETE imprint for ${Object.keys(record.artifacts).length} artifact(s) -> ${outPath}`);
      ui.warn(`required artifacts absent (not imprinted): ${record.missingRequired.join(', ')}`);
    } else {
      ui.success(`Wrote imprint for ${Object.keys(record.artifacts).length} artifact(s) -> ${outPath}`);
    }
  }
  // A seal over absent required cargo is not a seal.
  if (record.missingRequired.length > 0) process.exit(1);
}

function printUsage(): void {
  console.log(`pd batten — declarative release-artifact packing gate

Usage:
  pd batten verify [--staged-dir <dir>] [--manifest <file>] [--json]
      Assert every required artifact in release-artifacts.json is present,
      executable (if declared), and >= minBytes under <dir> (default: dist).
      Collects ALL failures and exits nonzero with a per-artifact report.

  pd batten imprint [--staged-dir <dir>] [--manifest <file>] [--out <file>]
      sha256 every staged artifact and write release-imprint.json
      (default: <staged-dir>/release-imprint.json).

The manifest (release-artifacts.json) is the single source of truth for what a
release tarball must contain — it replaces scattered \`test -s dist/<name>\`
shell asserts.`);
}

export async function handleBatten(positional: string[], options: CLIOptions): Promise<void> {
  const subcommand = positional[0] || 'help';
  switch (subcommand) {
    case 'verify':
      await runVerify(options);
      return;
    case 'imprint':
      await runImprint(options);
      return;
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;
    default:
      ui.error(`unknown batten subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}
