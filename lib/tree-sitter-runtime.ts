/**
 * Resolve the complete Tree-sitter WASM cargo before initializing Emscripten.
 *
 * Source runs load from the installed packages. Compiled releases stage the
 * same files under native/tree-sitter beside the executable. Never hand
 * web-tree-sitter a build-machine path and let it discover the failure inside
 * Emscripten: Bun compiled executables can crash instead of returning a useful
 * error when that path no longer exists.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';

export const TREE_SITTER_RUNTIME_FILE = 'tree-sitter.wasm';
export const TREE_SITTER_RUNTIME_POINTER = 'current.json';

export const TREE_SITTER_GRAMMAR_FILES = Object.freeze({
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
});

export type TreeSitterLanguage = keyof typeof TREE_SITTER_GRAMMAR_FILES;

export interface TreeSitterRuntimeAssets {
  source: 'packaged' | 'package';
  root: string;
  runtimeWasm: string;
  grammars: Record<TreeSitterLanguage, string>;
}

interface SourceFiles {
  runtimeWasm: string;
  grammars: Record<TreeSitterLanguage, string>;
}

interface TreeSitterRuntimeManifestFile {
  name: string;
  sizeBytes: number;
  sha256: string;
}

interface TreeSitterRuntimeManifest {
  version: 1;
  cargoDir: string;
  files: TreeSitterRuntimeManifestFile[];
}

type PublishedCargoResolution =
  | {
    state: 'valid';
    paths: Omit<TreeSitterRuntimeAssets, 'source'>;
    reason: '';
  }
  | {
    state: 'absent' | 'invalid';
    paths: null;
    reason: string;
  };

export interface TreeSitterRuntimeResolveOptions {
  /** Override the executable directory for hermetic tests. */
  execDir?: string;
  /** Override the package/share resource root for hermetic tests. */
  resourceDir?: string | null;
  /** Explicit source-package files; null disables the source fallback. */
  sourceFiles?: SourceFiles | null;
}

/**
 * Test a candidate without leaking transient filesystem errors to discovery.
 *
 * Design intent: fallback resolution should describe unavailable cargo as a
 * missing candidate while authenticated publication checks remain fail-closed.
 *
 * @param path - Candidate filesystem path.
 * @returns True only for an accessible regular file.
 */
function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Normalize and deduplicate candidate roots before inspecting them.
 *
 * Purpose: equivalent executable and resource paths should produce one stable
 * diagnostic instead of redundant filesystem work and repeated error text.
 *
 * @param paths - Candidate paths in resolution priority order.
 * @returns Normalized paths with the first occurrence preserved.
 */
function unique(paths: string[]): string[] {
  return [...new Set(paths.map(path => normalize(path)))];
}

/**
 * Decide containment using real paths instead of lexical prefixes.
 *
 * Design intent: a release payload is a hostile filesystem boundary. A
 * symlink named `native/tree-sitter` must not redirect runtime validation to
 * arbitrary host bytes that merely share a string prefix with the payload.
 *
 * @param root - Realpath-resolved publication root.
 * @param candidate - Realpath-resolved candidate cargo directory.
 * @returns True only when candidate is root or a descendant of root.
 */
function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/**
 * Build the runtime and grammar path set rooted in one indivisible cargo.
 *
 * Design intent: all Tree-sitter assets resolve from the same authenticated
 * directory; callers never compose a partial cargo across roots.
 *
 * @param root - Complete cargo directory.
 * @returns Runtime and grammar paths for that cargo.
 */
function pathsForRoot(root: string): Omit<TreeSitterRuntimeAssets, 'source'> {
  return {
    root,
    runtimeWasm: join(root, TREE_SITTER_RUNTIME_FILE),
    grammars: Object.fromEntries(
      Object.entries(TREE_SITTER_GRAMMAR_FILES).map(([language, file]) => [
        language,
        join(root, file),
      ]),
    ) as Record<TreeSitterLanguage, string>,
  };
}

/**
 * Identify absent regular files in a candidate cargo.
 *
 * Purpose: source-package fallback diagnostics name the exact incomplete
 * inventory instead of surfacing an opaque Emscripten initialization failure.
 *
 * @param paths - Runtime and grammar paths from one cargo root.
 * @returns Paths that are not accessible regular files.
 */
function missingFiles(paths: Omit<TreeSitterRuntimeAssets, 'source'>): string[] {
  return [
    paths.runtimeWasm,
    ...Object.values(paths.grammars),
  ].filter(path => !isFile(path));
}

/**
 * Resolve and authenticate the immutable cargo selected by `current.json`.
 *
 * Purpose: the publisher commits a complete content-addressed directory and
 * then atomically swaps a tiny pointer. Runtime resolution repeats the exact
 * inventory, size, hash, regular-file, and containment checks so a payload
 * altered after build cannot reach Emscripten as if it were release cargo.
 *
 * @param publicationRoot - Executable/resource-relative native/tree-sitter root.
 * @returns Either verified runtime paths or a precise rejection reason.
 */
function resolvePublishedCargo(publicationRoot: string): PublishedCargoResolution {
  let rootStat;
  try {
    rootStat = lstatSync(publicationRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: 'absent', paths: null, reason: 'publication root is missing' };
    }
    return { state: 'invalid', paths: null, reason: (error as Error).message };
  }

  try {
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return { state: 'invalid', paths: null, reason: 'publication root is not a real directory' };
    }
    const realRoot = realpathSync(publicationRoot);
    const pointerPath = join(realRoot, TREE_SITTER_RUNTIME_POINTER);
    if (!existsSync(pointerPath)) {
      return { state: 'invalid', paths: null, reason: `${TREE_SITTER_RUNTIME_POINTER} is missing` };
    }
    const pointerStat = lstatSync(pointerPath);
    if (pointerStat.isSymbolicLink() || !pointerStat.isFile()) {
      return { state: 'invalid', paths: null, reason: `${TREE_SITTER_RUNTIME_POINTER} is not a regular file` };
    }

    const manifest = JSON.parse(readFileSync(pointerPath, 'utf8')) as Partial<TreeSitterRuntimeManifest>;
    if (
      manifest.version !== 1 ||
      typeof manifest.cargoDir !== 'string' ||
      basename(manifest.cargoDir) !== manifest.cargoDir ||
      !manifest.cargoDir.startsWith('cargo-') ||
      !Array.isArray(manifest.files)
    ) {
      return { state: 'invalid', paths: null, reason: `${TREE_SITTER_RUNTIME_POINTER} is malformed` };
    }

    const cargoPath = join(realRoot, manifest.cargoDir);
    if (!existsSync(cargoPath)) {
      return { state: 'invalid', paths: null, reason: `selected cargo is missing: ${manifest.cargoDir}` };
    }
    const cargoStat = lstatSync(cargoPath);
    if (cargoStat.isSymbolicLink() || !cargoStat.isDirectory()) {
      return { state: 'invalid', paths: null, reason: 'selected cargo is not a real directory' };
    }
    const realCargo = realpathSync(cargoPath);
    if (!isContained(realRoot, realCargo)) {
      return { state: 'invalid', paths: null, reason: 'selected cargo escapes publication root' };
    }

    const requiredNames = [TREE_SITTER_RUNTIME_FILE, ...Object.values(TREE_SITTER_GRAMMAR_FILES)].sort();
    const entries = readdirSync(realCargo, { withFileTypes: true });
    const actualNames = entries.map(entry => entry.name).sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(requiredNames)) {
      const missing = requiredNames.filter(name => !actualNames.includes(name));
      const unexpected = actualNames.filter(name => !requiredNames.includes(name));
      return {
        state: 'invalid',
        paths: null,
        reason: `cargo inventory mismatch: missing ${missing.join(', ') || 'none'}; ` +
          `unexpected ${unexpected.join(', ') || 'none'}`,
      };
    }
    const receiptByName = new Map<string, TreeSitterRuntimeManifestFile>();
    for (const entry of manifest.files) {
      if (
        !entry ||
        typeof entry.name !== 'string' ||
        !requiredNames.includes(entry.name) ||
        receiptByName.has(entry.name) ||
        !Number.isInteger(entry.sizeBytes) ||
        (entry.sizeBytes ?? 0) < 1 ||
        typeof entry.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      ) {
        return { state: 'invalid', paths: null, reason: 'cargo receipt contains an invalid entry' };
      }
      receiptByName.set(entry.name, entry as TreeSitterRuntimeManifestFile);
    }
    if (receiptByName.size !== requiredNames.length) {
      return {
        state: 'invalid',
        paths: null,
        reason: 'cargo receipt does not describe the exact required inventory',
      };
    }

    for (const entry of entries) {
      const path = join(realCargo, entry.name);
      const receipt = receiptByName.get(entry.name)!;
      if (!entry.isFile() || entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
        return { state: 'invalid', paths: null, reason: `cargo asset is not a regular file: ${entry.name}` };
      }
      const sizeBytes = statSync(path).size;
      const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
      if (sizeBytes !== receipt.sizeBytes || sha256 !== receipt.sha256) {
        return { state: 'invalid', paths: null, reason: `cargo asset does not match receipt: ${entry.name}` };
      }
    }

    return { state: 'valid', paths: pathsForRoot(realCargo), reason: '' };
  } catch (error) {
    return { state: 'invalid', paths: null, reason: (error as Error).message };
  }
}

/**
 * Discover source-package WASM files for development-only fallback.
 *
 * Design intent: compiled payloads prefer authenticated executable-relative
 * cargo, while source checkouts can still run through installed dependencies.
 *
 * @returns Source-package paths, or null when dependencies are unavailable.
 */
function resolvePackageSources(): SourceFiles | null {
  try {
    const requireFromModule = createRequire(import.meta.url);
    const runtimeWasm = requireFromModule.resolve('web-tree-sitter/tree-sitter.wasm');
    const grammarRoot = join(
      dirname(requireFromModule.resolve('tree-sitter-wasms/package.json')),
      'out',
    );
    return {
      runtimeWasm,
      grammars: Object.fromEntries(
        Object.entries(TREE_SITTER_GRAMMAR_FILES).map(([language, file]) => [
          language,
          join(grammarRoot, file),
        ]),
      ) as Record<TreeSitterLanguage, string>,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve one complete cargo. Partial directories never compose with another
 * root: a release is either internally complete or rejected with an explicit
 * inventory of the missing files.
 *
 * Design intent: compiled releases fail closed on tampered publication cargo,
 * but source checkouts retain an explicit dependency-backed development path.
 *
 * @param options - Optional executable, resource, and source paths.
 * @returns The first complete authenticated cargo in resolution priority order.
 */
export function resolveTreeSitterRuntimeAssets(
  options: TreeSitterRuntimeResolveOptions = {},
): TreeSitterRuntimeAssets {
  const execDir = options.execDir ?? dirname(process.execPath);
  const resourceDir = options.resourceDir === undefined
    ? (process.env.PORT_DADDY_RESOURCE_DIR?.trim() || null)
    : options.resourceDir;
  const packagedRoots = unique([
    join(execDir, 'native', 'tree-sitter'),
    ...(resourceDir ? [join(resourceDir, 'native', 'tree-sitter')] : []),
    join(execDir, '..', 'share', 'port-daddy', 'native', 'tree-sitter'),
  ]);
  const inspected: string[] = [];

  for (const root of packagedRoots) {
    const published = resolvePublishedCargo(root);
    if (published.state === 'valid') return { source: 'packaged', ...published.paths };
    if (published.state === 'invalid') {
      throw new Error(
        `[symbol-index] Tree-sitter packaged runtime rejected at ${root}: ${published.reason}`,
      );
    }
    inspected.push(`${root} (${published.reason})`);
  }

  const sourceFiles = options.sourceFiles === undefined
    ? resolvePackageSources()
    : options.sourceFiles;
  if (sourceFiles) {
    const sourcePaths = {
      root: dirname(sourceFiles.runtimeWasm),
      runtimeWasm: sourceFiles.runtimeWasm,
      grammars: sourceFiles.grammars,
    };
    const missing = missingFiles(sourcePaths);
    if (missing.length === 0) return { source: 'package', ...sourcePaths };
    inspected.push(`source packages (missing: ${missing.join(', ')})`);
  } else {
    inspected.push('source packages (unresolvable)');
  }

  throw new Error(
    '[symbol-index] Tree-sitter runtime unavailable; required WASM cargo is incomplete. ' +
    `Inspected: ${inspected.join('; ')}`,
  );
}

/**
 * Create Emscripten's runtime WASM locator for Parser.init().
 *
 * Purpose: only the web-tree-sitter runtime file is redirected; unrelated
 * Emscripten lookups keep their original script names.
 *
 * @param runtimeWasm - Authenticated tree-sitter.wasm path.
 * @returns A locateFile callback suitable for web-tree-sitter initialization.
 */
export function createTreeSitterLocateFile(runtimeWasm: string) {
  return (scriptName: string): string => (
    basename(scriptName) === TREE_SITTER_RUNTIME_FILE ? runtimeWasm : scriptName
  );
}
