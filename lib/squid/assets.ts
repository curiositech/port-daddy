/**
 * One resolver for every Giant Squid runtime asset.
 *
 * Source checkouts keep scripts under bin/ and hooks/. Release archives keep
 * the same relative directories beside the compiled `pd` binary, while older
 * archives may keep tentacles flat beside it. Callers must not each invent a
 * different layout: that is how `pd squid on` reported success while the
 * installed build could not find the files it had promised to wire.
 */
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
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

  const leaf = basename(assetPath);
  const family = assetPath.includes('/') ? dirname(assetPath) : 'bin';
  const execDir = options.execDir ?? dirname(process.execPath);
  const resourceDir = options.resourceDir === undefined
    ? (process.env.PORT_DADDY_RESOURCE_DIR?.trim() || null)
    : options.resourceDir;
  const candidates: string[] = [];

  if (options.sourceDir) {
    candidates.push(join(options.sourceDir, assetPath), join(options.sourceDir, leaf));
  }

  // Canonical release layout first, then the legacy flat/bin fallbacks.
  candidates.push(
    join(execDir, assetPath),
    join(execDir, family, leaf),
    join(execDir, leaf),
    join(execDir, 'bin', leaf),
    join(execDir, 'hooks', leaf),
  );

  // launchd/Homebrew can keep executable code in bin/ and durable assets in a
  // package share root. PORT_DADDY_RESOURCE_DIR is the canonical launch-time
  // declaration; the relative share path covers ordinary Homebrew CLI use.
  for (const root of [resourceDir, join(execDir, '..', 'share', 'port-daddy')]) {
    if (!root) continue;
    candidates.push(
      join(root, assetPath),
      join(root, family, leaf),
      join(root, leaf),
      join(root, 'bin', leaf),
      join(root, 'hooks', leaf),
    );
  }

  // Source and transpiled-module fallback: walk upward to a repository root.
  let dir = options.moduleDir ?? MODULE_DIR;
  for (let depth = 0; depth < 8; depth++) {
    candidates.push(
      join(dir, assetPath),
      join(dir, family, leaf),
      join(dir, 'bin', leaf),
      join(dir, 'hooks', leaf),
    );
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
