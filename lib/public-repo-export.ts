import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export type PublicRepoExportConfig = {
  version: number;
  purpose: string;
  defaultRef: string;
  defaultOutputDir: string;
  includeExactPaths: string[];
  includePrefixes: string[];
  excludeExactPaths: string[];
  excludePrefixes: string[];
  excludeRegexes: string[];
  smokeIncludedPaths: string[];
  smokeExcludedPaths: string[];
};

export type PublicRepoExportValidation = {
  missingIncludedSmokePaths: string[];
  leakedExcludedSmokePaths: string[];
};

export type PublicRepoExportResult = {
  ref: string;
  outDir: string;
  selectedPaths: string[];
  validation: PublicRepoExportValidation;
};

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultConfigPath = resolve(repoRoot, 'config/public-repo-export.json');

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function loadPublicRepoExportConfig(configPath: string = defaultConfigPath): PublicRepoExportConfig {
  return JSON.parse(readFileSync(configPath, 'utf8')) as PublicRepoExportConfig;
}

export function listTrackedFilesAtRef(ref: string = 'HEAD', cwd: string = repoRoot): string[] {
  const output = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], {
    cwd,
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .map((line) => normalizeRepoPath(line.trim()))
    .filter(Boolean);
}

export function shouldExportPath(path: string, config: PublicRepoExportConfig): boolean {
  const normalized = normalizeRepoPath(path);
  const included = config.includeExactPaths.includes(normalized)
    || config.includePrefixes.some((prefix) => normalized.startsWith(prefix));

  if (!included) return false;

  if (config.excludeExactPaths.includes(normalized)) return false;
  if (config.excludePrefixes.some((prefix) => normalized.startsWith(prefix))) return false;
  if (config.excludeRegexes.some((pattern) => new RegExp(pattern).test(normalized))) return false;

  return true;
}

export function selectPublicExportPaths(
  trackedFiles: string[],
  config: PublicRepoExportConfig,
): string[] {
  return trackedFiles
    .map((path) => normalizeRepoPath(path))
    .filter((path) => shouldExportPath(path, config))
    .sort();
}

export function validatePublicExportSelection(
  selectedPaths: string[],
  config: PublicRepoExportConfig,
): PublicRepoExportValidation {
  const selectedSet = new Set(selectedPaths);

  return {
    missingIncludedSmokePaths: config.smokeIncludedPaths.filter((path) => !selectedSet.has(path)),
    leakedExcludedSmokePaths: config.smokeExcludedPaths.filter((path) => selectedSet.has(path)),
  };
}

function readBlobAtRef(ref: string, path: string, cwd: string = repoRoot): Buffer {
  return execFileSync('git', ['show', `${ref}:${path}`], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function assertCleanOutputDir(outDir: string, clean: boolean): void {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
    return;
  }

  if (clean) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    return;
  }

  const entries = readdirSync(outDir);
  if (entries.length > 0) {
    throw new Error(`Output directory already exists and is not empty: ${outDir}. Pass --clean to replace it.`);
  }
}

export function exportPublicRepo(options: {
  outDir?: string;
  ref?: string;
  clean?: boolean;
  configPath?: string;
  cwd?: string;
  trackedFilesOverride?: string[];
  validateSelection?: boolean;
} = {}): PublicRepoExportResult {
  const cwd = options.cwd || repoRoot;
  const config = loadPublicRepoExportConfig(options.configPath || defaultConfigPath);
  const ref = options.ref || config.defaultRef;
  const trackedFiles = options.trackedFilesOverride || listTrackedFilesAtRef(ref, cwd);
  const selectedPaths = selectPublicExportPaths(trackedFiles, config);
  const validation = validatePublicExportSelection(selectedPaths, config);

  if (
    options.validateSelection !== false
    && (validation.missingIncludedSmokePaths.length > 0 || validation.leakedExcludedSmokePaths.length > 0)
  ) {
    const problems = [
      ...validation.missingIncludedSmokePaths.map((path) => `missing required exported path: ${path}`),
      ...validation.leakedExcludedSmokePaths.map((path) => `excluded path leaked into export: ${path}`),
    ];
    throw new Error(`Public export manifest validation failed:\n- ${problems.join('\n- ')}`);
  }

  const outDir = resolve(cwd, options.outDir || config.defaultOutputDir);
  assertCleanOutputDir(outDir, Boolean(options.clean));

  for (const path of selectedPaths) {
    const destination = join(outDir, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readBlobAtRef(ref, path, cwd));
  }

  writeFileSync(
    join(outDir, 'PORT_DADDY_PUBLIC_EXPORT.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        purpose: config.purpose,
        ref,
        selectedCount: selectedPaths.length,
        selectedPaths,
      },
      null,
      2,
    ),
  );

  return { ref, outDir, selectedPaths, validation };
}
