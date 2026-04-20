import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

interface OperatorRouteDeps {
  logger?: {
    info?: (meta: Record<string, unknown>, message?: string) => void;
    error?: (meta: Record<string, unknown>, message?: string) => void;
  };
}

interface OpenFileBody {
  path?: string;
  projectDir?: string;
  mode?: 'editor' | 'finder';
}

interface FilePreviewBody {
  path?: string;
  projectDir?: string;
  maxLines?: number;
}

type PreviewLineKind = 'meta' | 'hunk' | 'add' | 'remove' | 'context';

interface PreviewLine {
  kind: PreviewLineKind;
  text: string;
}

/**
 * Resolve an operator-surfaced file token against the current project.
 *
 * Example:
 * - input: `('routes/operator.ts', '/Users/me/port-daddy')`
 * - output: `/Users/me/port-daddy/routes/operator.ts`
 */
function resolveRequestedPath(filePath: string, projectDir?: string): string {
  if (filePath.startsWith('/')) {
    return resolve(filePath);
  }
  return resolve(projectDir || process.cwd(), filePath);
}

/**
 * Find the Git worktree root that should contextualize previews for a file.
 *
 * Example:
 * - input: `('/Users/me/port-daddy', '/Users/me/port-daddy/routes/operator.ts')`
 * - output: `/Users/me/port-daddy`
 */
function resolveGitRoot(projectDir: string | undefined, resolvedPath: string): string | null {
  const candidates = [
    projectDir,
    dirname(resolvedPath),
    process.cwd(),
  ].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    const probe = spawnSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (probe.status === 0) {
      const root = probe.stdout.trim();
      if (root) return root;
    }
  }

  return null;
}

/**
 * Run a Git command and return stdout, collapsing failures into an empty string
 * so preview generation can gracefully fall through to the next strategy.
 *
 * Example:
 * - input: `['-C', '/repo', 'status', '--porcelain=v1', '--', 'routes/operator.ts']`
 * - output: `' M routes/operator.ts\n'`
 */
function runGit(args: string[]): string {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout : '';
}

/**
 * Clamp preview output to a small card-sized window.
 *
 * Example:
 * - input: 90 parsed diff lines, `24`
 * - output: first 24 lines plus `truncated: true`
 */
function trimPreviewLines(lines: PreviewLine[], maxLines: number): { lines: PreviewLine[]; truncated: boolean } {
  if (lines.length <= maxLines) return { lines, truncated: false };
  return {
    lines: lines.slice(0, maxLines),
    truncated: true,
  };
}

/**
 * Count visible additions and deletions in the preview payload.
 *
 * Example:
 * - input: `[add, add, remove, context]`
 * - output: `{ additions: 2, deletions: 1 }`
 */
function summarizeChanges(lines: PreviewLine[]): { additions: number; deletions: number } {
  return lines.reduce((acc, line) => {
    if (line.kind === 'add') acc.additions += 1;
    if (line.kind === 'remove') acc.deletions += 1;
    return acc;
  }, { additions: 0, deletions: 0 });
}

/**
 * Convert a unified diff into the lightweight line model consumed by FleetBar.
 *
 * Example:
 * - input: `'@@ -1,2 +1,2 @@\n-old\n+new'`
 * - output: `[{ kind: 'hunk', ... }, { kind: 'remove', ... }, { kind: 'add', ... }]`
 */
function parseUnifiedDiff(diffText: string, maxLines: number): {
  lines: PreviewLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
} {
  const lines = diffText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.startsWith('diff --git'))
    .filter((line) => !line.startsWith('index '))
    .map((line): PreviewLine => {
      if (line.startsWith('@@')) return { kind: 'hunk', text: line };
      if (line.startsWith('+++') || line.startsWith('---')) return { kind: 'meta', text: line };
      if (line.startsWith('+')) return { kind: 'add', text: line };
      if (line.startsWith('-')) return { kind: 'remove', text: line };
      return { kind: 'context', text: line };
    });

  const { lines: trimmedLines, truncated } = trimPreviewLines(lines, maxLines);
  const { additions, deletions } = summarizeChanges(trimmedLines);
  return { lines: trimmedLines, additions, deletions, truncated };
}

/**
 * Fall back to a direct file snapshot when there is no meaningful diff to show.
 *
 * Example:
 * - input: `('/repo/new-file.ts', 8, 'untracked')`
 * - output: preview lines prefixed as additions
 */
function buildSnapshotPreview(resolvedPath: string, maxLines: number, kind: 'untracked' | 'snapshot'): {
  lines: PreviewLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
} {
  const raw = readFileSync(resolvedPath, 'utf8');
  const fileLines = raw.split('\n').slice(0, maxLines).map((line): PreviewLine => ({
    kind: kind === 'untracked' ? 'add' : 'context',
    text: kind === 'untracked' ? `+${line}` : ` ${line}`,
  }));
  const truncated = raw.split('\n').length > maxLines;
  return {
    lines: fileLines,
    additions: kind === 'untracked' ? fileLines.length : 0,
    deletions: 0,
    truncated,
  };
}

/**
 * Produce the best available file preview for hover cards:
 * working tree diff, staged diff, untracked snapshot, or plain snapshot.
 *
 * Example:
 * - input: `('routes/operator.ts', '/repo/routes/operator.ts', '/repo', 24)`
 * - output: `{ source: 'working-tree', additions: 3, deletions: 1, lines: [...] }`
 */
function previewForPath(
  requestedPath: string,
  resolvedPath: string,
  projectDir?: string,
  maxLines = 24,
): {
  requestedPath: string;
  resolvedPath: string;
  displayPath: string;
  source: 'working-tree' | 'staged' | 'untracked' | 'snapshot';
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: PreviewLine[];
} {
  const clampedMaxLines = Math.max(6, Math.min(60, maxLines));
  const repoRoot = resolveGitRoot(projectDir, resolvedPath);
  const displayPath = repoRoot
    ? relative(repoRoot, resolvedPath).split('\\').join('/')
    : requestedPath;

  if (!repoRoot) {
    const snapshot = buildSnapshotPreview(resolvedPath, clampedMaxLines, 'snapshot');
    return {
      requestedPath,
      resolvedPath,
      displayPath,
      source: 'snapshot',
      ...snapshot,
    };
  }

  const relativePath = relative(repoRoot, resolvedPath).split('\\').join('/');
  const workingTreeDiff = runGit(['-C', repoRoot, 'diff', '--no-ext-diff', '--no-color', '--unified=3', '--', relativePath]).trim();
  if (workingTreeDiff) {
    return {
      requestedPath,
      resolvedPath,
      displayPath,
      source: 'working-tree',
      ...parseUnifiedDiff(workingTreeDiff, clampedMaxLines),
    };
  }

  const stagedDiff = runGit(['-C', repoRoot, 'diff', '--cached', '--no-ext-diff', '--no-color', '--unified=3', '--', relativePath]).trim();
  if (stagedDiff) {
    return {
      requestedPath,
      resolvedPath,
      displayPath,
      source: 'staged',
      ...parseUnifiedDiff(stagedDiff, clampedMaxLines),
    };
  }

  const status = runGit(['-C', repoRoot, 'status', '--porcelain=v1', '--', relativePath]).trim();
  if (status.startsWith('??')) {
    return {
      requestedPath,
      resolvedPath,
      displayPath,
      source: 'untracked',
      ...buildSnapshotPreview(resolvedPath, clampedMaxLines, 'untracked'),
    };
  }

  return {
    requestedPath,
    resolvedPath,
    displayPath,
    source: 'snapshot',
    ...buildSnapshotPreview(resolvedPath, clampedMaxLines, 'snapshot'),
  };
}

/**
 * Translate a resolved path into the platform-native open/reveal command.
 *
 * Example:
 * - input: `('/repo/routes/operator.ts', 'finder', false)`
 * - output on macOS: `{ command: 'open', args: ['-R', '/repo/routes/operator.ts'] }`
 */
function buildOpenCommand(
  targetPath: string,
  mode: 'editor' | 'finder',
  isDirectory: boolean,
): { command: string; args: string[] } {
  if (process.platform === 'darwin') {
    return mode === 'finder'
      ? { command: 'open', args: isDirectory ? [targetPath] : ['-R', targetPath] }
      : { command: 'open', args: [targetPath] };
  }

  if (process.platform === 'win32') {
    return mode === 'finder'
      ? { command: 'explorer', args: isDirectory ? [targetPath] : ['/select,', targetPath] }
      : { command: 'cmd', args: ['/c', 'start', '', targetPath] };
  }

  if (mode === 'finder') {
    return { command: 'xdg-open', args: [isDirectory ? targetPath : dirname(targetPath)] };
  }
  return { command: 'xdg-open', args: [targetPath] };
}

export const operatorPlugin: FastifyPluginAsync<{ deps: OperatorRouteDeps }> = async (fastify, opts) => {
  const logger = opts.deps.logger;

  fastify.post('/operator/open-file', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as OpenFileBody;
    const requestedPath = typeof body.path === 'string' ? body.path.trim() : '';
    const projectDir = typeof body.projectDir === 'string' ? body.projectDir.trim() : '';
    const mode = body.mode === 'finder' ? 'finder' : body.mode === 'editor' ? 'editor' : null;

    if (!requestedPath) {
      reply.code(400);
      return { success: false, error: 'A file path is required.' };
    }
    if (!mode) {
      reply.code(400);
      return { success: false, error: 'Mode must be either "editor" or "finder".' };
    }

    const resolvedPath = resolveRequestedPath(requestedPath, projectDir || undefined);
    if (!existsSync(resolvedPath)) {
      reply.code(404);
      return { success: false, error: `File not found: ${requestedPath}` };
    }

    const stats = statSync(resolvedPath);
    const { command, args } = buildOpenCommand(resolvedPath, mode, stats.isDirectory());

    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      logger?.info?.({
        mode,
        requestedPath,
        resolvedPath,
        projectDir: projectDir || null,
      }, 'operator_open_file');
      return { success: true, mode, path: resolvedPath };
    } catch (error) {
      logger?.error?.({
        err: error,
        mode,
        requestedPath,
        resolvedPath,
      }, 'operator_open_file_failed');
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open file.',
      };
    }
  });

  fastify.post('/operator/file-preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as FilePreviewBody;
    const requestedPath = typeof body.path === 'string' ? body.path.trim() : '';
    const projectDir = typeof body.projectDir === 'string' ? body.projectDir.trim() : '';
    const maxLines = typeof body.maxLines === 'number' ? body.maxLines : 24;

    if (!requestedPath) {
      reply.code(400);
      return { success: false, error: 'A file path is required.' };
    }

    const resolvedPath = resolveRequestedPath(requestedPath, projectDir || undefined);
    if (!existsSync(resolvedPath)) {
      reply.code(404);
      return { success: false, error: `File not found: ${requestedPath}` };
    }

    try {
      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        return {
          success: true,
          preview: {
            requestedPath,
            resolvedPath,
            displayPath: requestedPath,
            source: 'snapshot',
            additions: 0,
            deletions: 0,
            truncated: false,
            lines: [
              { kind: 'meta', text: 'Directory preview unavailable.' },
              { kind: 'context', text: 'Use Finder or your editor to inspect this folder.' },
            ],
          },
        };
      }

      const preview = previewForPath(requestedPath, resolvedPath, projectDir || undefined, maxLines);
      logger?.info?.({
        requestedPath,
        resolvedPath,
        source: preview.source,
        additions: preview.additions,
        deletions: preview.deletions,
        projectDir: projectDir || null,
      }, 'operator_file_preview');
      return { success: true, preview };
    } catch (error) {
      logger?.error?.({
        err: error,
        requestedPath,
        resolvedPath,
        projectDir: projectDir || null,
      }, 'operator_file_preview_failed');
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load file preview.',
      };
    }
  });
};
