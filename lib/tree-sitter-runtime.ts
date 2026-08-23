/**
 * Resolve the complete Tree-sitter WASM cargo before initializing Emscripten.
 *
 * Source runs load from the installed packages. Compiled releases stage the
 * same files under native/tree-sitter beside the executable. Never hand
 * web-tree-sitter a build-machine path and let it discover the failure inside
 * Emscripten: Bun compiled executables can crash instead of returning a useful
 * error when that path no longer exists.
 */
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, normalize } from 'node:path';

export const TREE_SITTER_RUNTIME_FILE = 'tree-sitter.wasm';

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

export interface TreeSitterRuntimeResolveOptions {
  /** Override the executable directory for hermetic tests. */
  execDir?: string;
  /** Override the package/share resource root for hermetic tests. */
  resourceDir?: string | null;
  /** Explicit source-package files; null disables the source fallback. */
  sourceFiles?: SourceFiles | null;
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function unique(paths: string[]): string[] {
  return [...new Set(paths.map(path => normalize(path)))];
}

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

function missingFiles(paths: Omit<TreeSitterRuntimeAssets, 'source'>): string[] {
  return [
    paths.runtimeWasm,
    ...Object.values(paths.grammars),
  ].filter(path => !isFile(path));
}

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
    const paths = pathsForRoot(root);
    const missing = missingFiles(paths);
    if (missing.length === 0) return { source: 'packaged', ...paths };
    inspected.push(`${root} (missing: ${missing.map(path => basename(path)).join(', ')})`);
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

/** Emscripten asks locateFile for tree-sitter.wasm during Parser.init(). */
export function createTreeSitterLocateFile(runtimeWasm: string) {
  return (scriptName: string): string => (
    basename(scriptName) === TREE_SITTER_RUNTIME_FILE ? runtimeWasm : scriptName
  );
}
