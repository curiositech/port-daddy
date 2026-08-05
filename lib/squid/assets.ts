/**
 * One resolver for every Giant Squid runtime asset.
 *
 * Source checkouts and release archives share one directory-preserving layout:
 * executable assets under bin/ and hook modules under hooks/. Callers must not
 * invent fallback layouts: that is how `pd squid on` once reported success
 * while the installed build could not find the files it had promised to wire.
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export interface SquidAssetResolveOptions {
  /** Explicit source directory retained for hermetic tests and dev tooling. */
  sourceDir?: string;
  /** Override the compiled executable directory in tests. */
  execDir?: string;
  /** Override the module location in tests. */
  moduleDir?: string;
  /** Override the daemon/package resource root in tests. */
  resourceDir?: string | null;
}

function unique(paths: string[]): string[] {
  return [...new Set(paths.map((path) => normalize(path)))];
}

/** Ordered candidates, exposed so release-layout tests can assert the contract. */
export function squidAssetCandidates(
  assetPath: string,
  options: SquidAssetResolveOptions = {},
): string[] {
  if (isAbsolute(assetPath)) return [assetPath];

  const execDir = options.execDir ?? dirname(process.execPath);
  const resourceDir = options.resourceDir === undefined
    ? (process.env.PORT_DADDY_RESOURCE_DIR?.trim() || null)
    : options.resourceDir;
  const candidates: string[] = [];

  if (options.sourceDir) {
    candidates.push(join(options.sourceDir, assetPath));
  }

  candidates.push(join(execDir, assetPath));

  // launchd/Homebrew can keep executable code in bin/ and durable assets in a
  // package share root. PORT_DADDY_RESOURCE_DIR is the canonical launch-time
  // declaration; the relative share path covers ordinary Homebrew CLI use.
  for (const root of [resourceDir, join(execDir, '..', 'share', 'port-daddy')]) {
    if (!root) continue;
    candidates.push(join(root, assetPath));
  }

  // Source and transpiled-module fallback: walk upward to a repository root.
  let dir = options.moduleDir ?? MODULE_DIR;
  for (let depth = 0; depth < 8; depth++) {
    candidates.push(join(dir, assetPath));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return unique(candidates);
}

/** Resolve an asset or return null. The caller decides whether it is required. */
export function resolveSquidAsset(
  assetPath: string,
  options: SquidAssetResolveOptions = {},
): string | null {
  return squidAssetCandidates(assetPath, options).find((path) => existsSync(path)) ?? null;
}

/** Resolve a required asset with an error that names every inspected location. */
export function requireSquidAsset(
  assetPath: string,
  options: SquidAssetResolveOptions = {},
): string {
  const candidates = squidAssetCandidates(assetPath, options);
  const found = candidates.find((path) => existsSync(path));
  if (found) return found;
  throw new Error(`missing Squid asset ${assetPath}; inspected: ${candidates.join(', ')}`);
}
