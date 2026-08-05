import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, join, resolve } from 'node:path';

type SetupAction = 'status' | 'full' | 'mcp-skills' | 'fleetbar' | 'project-init';

interface SetupRunBody {
  action?: SetupAction;
  projectDir?: string;
  confirmed?: boolean;
  setupToken?: string;
}

interface SetupRouteDeps {
  repoRoot?: string;
  VERSION?: string;
  CODE_HASH?: string;
  logger?: {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
  };
}

const MUTATING_ACTIONS = new Set<SetupAction>(['full', 'mcp-skills', 'fleetbar', 'project-init']);
const MAX_OUTPUT_CHARS = 24_000;
const SETUP_TIMEOUT_MS = 1000 * 60 * 8;
const SETUP_TOKEN_BYTES = 32;

function xmlUnescape(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * The one macOS daemon supervisor. Homebrew owns the launchd job; current Port
 * Daddy code never installs a competing service label.
 */
export const DAEMON_LAUNCH_AGENT_LABELS = ['homebrew.mxcl.port-daddy'] as const;

function readLaunchAgentProgramArguments(): { path: string; exists: boolean; programArguments: string[] | null; label: string | null } {
  if (platform() !== 'darwin') {
    const path = join(homedir(), 'Library', 'LaunchAgents', `${DAEMON_LAUNCH_AGENT_LABELS[0]}.plist`);
    return { path, exists: false, programArguments: null, label: null };
  }

  for (const label of DAEMON_LAUNCH_AGENT_LABELS) {
    const path = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    if (!existsSync(path)) continue;

    const text = readFileSync(path, 'utf8');
    const programArguments = text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
    if (!programArguments) return { path, exists: true, programArguments: null, label };

    return {
      path,
      exists: true,
      label,
      programArguments: Array.from(programArguments[1].matchAll(/<string>([\s\S]*?)<\/string>/g))
        .map((match) => xmlUnescape(match[1].trim())),
    };
  }

  // None found — report against the canonical label so the message points the
  // operator at the right thing.
  const path = join(homedir(), 'Library', 'LaunchAgents', `${DAEMON_LAUNCH_AGENT_LABELS[0]}.plist`);
  return { path, exists: false, programArguments: null, label: null };
}

/**
 * The binary the LaunchAgent actually launches (first ProgramArgument that is an
 * existing executable path), e.g. `/opt/homebrew/opt/port-daddy/bin/pd`. Falls
 * back to the source-install candidate (`<repoRoot>/dist/daemon`) so dev trees
 * still report something sensible.
 */
export function resolveBinaryCandidate(programArguments: string[] | null, repoRoot: string): string {
  if (programArguments && programArguments.length > 0) {
    const first = programArguments[0];
    if (first.startsWith('/') && existsSync(first)) return first;
  }
  return join(repoRoot, 'dist', 'daemon');
}

export function daemonMode(programArguments: string[] | null): 'binary' | 'source' | 'unknown' {
  if (!programArguments || programArguments.length === 0) return 'unknown';
  const joined = programArguments.join(' ');
  if (joined.includes('tsx') || joined.includes('server.ts')) return 'source';
  return 'binary';
}

function safeProjectDir(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const resolved = resolve(value.trim());
  if (!existsSync(resolved)) return null;
  return resolved;
}

function isLoopbackRequest(request: FastifyRequest): boolean {
  const ip = request.ip;
  return ip === '127.0.0.1'
    || ip === '::1'
    || ip === '::ffff:127.0.0.1'
    || ip === 'localhost';
}

function setupInvocation(repoRoot: string): { command: string; baseArgs: string[]; label: string } {
  const cliTs = join(repoRoot, 'bin', 'port-daddy-cli.ts');
  const tsxBin = join(repoRoot, 'node_modules', '.bin', platform() === 'win32' ? 'tsx.cmd' : 'tsx');
  if (existsSync(cliTs) && existsSync(tsxBin)) {
    return { command: tsxBin, baseArgs: [cliTs, 'setup'], label: `${basename(tsxBin)} ${cliTs} setup` };
  }
  return { command: 'pd', baseArgs: ['setup'], label: 'pd setup' };
}

function argsForAction(action: SetupAction, projectDir: string | null): string[] {
  switch (action) {
    case 'status':
      return ['--status'];
    case 'mcp-skills':
      return ['--no-daemon', '--no-fleetbar', '--no-init'];
    case 'fleetbar':
      return ['--no-daemon', '--no-mcp', '--no-skill', '--no-init'];
    case 'project-init':
      return projectDir ? ['--no-daemon', '--no-mcp', '--no-fleetbar', '--project', projectDir] : ['--no-daemon', '--no-mcp', '--no-fleetbar', '--no-init'];
    case 'full':
      return projectDir ? ['--project', projectDir] : ['--no-init'];
  }
}

function trimOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n\n[output trimmed to ${MAX_OUTPUT_CHARS} chars]`;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number | null; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, SETUP_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = trimOutput(stdout + chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = trimOutput(stderr + chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolveRun({ exitCode: 1, timedOut, stdout, stderr: trimOutput(`${stderr}\n${error.message}`.trim()) });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolveRun({ exitCode, timedOut, stdout: trimOutput(stdout), stderr: trimOutput(stderr) });
    });
  });
}

export const setupPlugin: FastifyPluginAsync<{ deps: SetupRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps;
  const repoRoot = deps.repoRoot ?? process.cwd();
  const setupToken = randomBytes(SETUP_TOKEN_BYTES).toString('base64url');

  fastify.get('/setup/overview', async (request: FastifyRequest, reply) => {
    if (!isLoopbackRequest(request)) {
      reply.code(403);
      return { success: false, error: 'Setup overview is only available from the local machine.' };
    }

    const launchAgent = readLaunchAgentProgramArguments();
    const mode = daemonMode(launchAgent.programArguments);
    const stablePath = join(homedir(), 'port-daddy-stable');
    const binaryCandidate = resolveBinaryCandidate(launchAgent.programArguments, repoRoot);
    const invocation = setupInvocation(repoRoot);

    return {
      success: true,
      version: deps.VERSION ?? null,
      codeHash: deps.CODE_HASH ?? null,
      setupToken,
      platform: platform(),
      installDir: repoRoot,
      currentProcess: {
        execPath: process.execPath,
        argv: process.argv.slice(0, 4),
      },
      daemon: {
        mode,
        launchAgentLabel: launchAgent.label,
        launchAgentPath: launchAgent.path,
        launchAgentExists: launchAgent.exists,
        programArguments: launchAgent.programArguments,
        binaryCandidate,
        binaryCandidateExists: existsSync(binaryCandidate),
        summary: mode === 'binary'
          ? 'The installed daemon LaunchAgent appears to run a binary.'
          : mode === 'source'
            ? 'The installed daemon LaunchAgent still appears to run the source/tsx daemon.'
            : 'No installed daemon LaunchAgent was detected for this platform.',
      },
      stableTree: {
        path: stablePath,
        exists: existsSync(stablePath),
        cleanupPolicy: 'Do not delete automatically. Archive or remove only after the binary daemon, CLI shims, skills, MCPs, and FleetBar all pass health checks.',
      },
      setupCommand: {
        label: invocation.label,
        command: invocation.command,
        baseArgs: invocation.baseArgs,
      },
      actions: [
        { id: 'status', label: 'Check setup status', mutates: false },
        { id: 'mcp-skills', label: 'Install MCP and skills', mutates: true },
        { id: 'fleetbar', label: 'Install FleetBar', mutates: true },
        { id: 'full', label: 'Run full local setup', mutates: true },
      ],
    };
  });

  fastify.post('/setup/run', async (request: FastifyRequest, reply) => {
    const body = (request.body ?? {}) as SetupRunBody;
    const action = body.action;
    if (!action || !['status', 'full', 'mcp-skills', 'fleetbar', 'project-init'].includes(action)) {
      reply.code(400);
      return { success: false, error: 'Unknown setup action.' };
    }
    if (!isLoopbackRequest(request)) {
      reply.code(403);
      return { success: false, error: 'Setup actions are only available from the local machine.' };
    }
    if (MUTATING_ACTIONS.has(action) && body.confirmed !== true) {
      reply.code(400);
      return { success: false, error: 'Mutating setup actions require explicit GUI confirmation.' };
    }
    if (MUTATING_ACTIONS.has(action) && body.setupToken !== setupToken) {
      reply.code(403);
      return { success: false, error: 'Mutating setup actions require a current setup capability token.' };
    }

    const projectDir = safeProjectDir(body.projectDir);
    if (action === 'project-init' && !projectDir) {
      reply.code(400);
      return { success: false, error: 'Project initialization requires a valid project directory.' };
    }

    const invocation = setupInvocation(repoRoot);
    const args = [...invocation.baseArgs, ...argsForAction(action, projectDir)];
    const cwd = projectDir ?? repoRoot;

    deps.logger?.info('setup_action_started', { action, cwd, command: invocation.command, args });
    const result = await runCommand(invocation.command, args, cwd);
    const success = !result.timedOut && result.exitCode === 0;
    const payload = {
      success,
      action,
      command: invocation.command,
      args,
      cwd,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
    };

    if (!success) {
      deps.logger?.warn('setup_action_failed', { action, exitCode: result.exitCode, timedOut: result.timedOut });
      return payload;
    }

    deps.logger?.info('setup_action_completed', { action, exitCode: result.exitCode });
    return payload;
  });
};
