import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

function resolveRequestedPath(filePath: string, projectDir?: string): string {
  if (filePath.startsWith('/')) {
    return resolve(filePath);
  }
  return resolve(projectDir || process.cwd(), filePath);
}

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
};
