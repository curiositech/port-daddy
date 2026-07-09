import * as childProcess from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export const CLI_TUBE_TOOLS = ['claude-code', 'codex', 'agy', 'gemini', 'groq', 'grok'] as const;
export type CliTubeTool = typeof CLI_TUBE_TOOLS[number];

export type CliTubePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export interface CliTubeBuildArgsInput {
  prompt: string;
  outputPath?: string;
  model?: string;
  permissionMode?: CliTubePermissionMode;
  codexConfig?: string[];
  timeoutMs?: number;
}

export interface CliTubeBuildArgsResult {
  args: string[];
  stdin: string | null;
}

interface CliTubeProviderSpecBase<TTool extends CliTubeTool = CliTubeTool> {
  id: TTool;
  defaultBinary: string;
  binaryEnvOverride: `PD_CLI_${string}_BIN`;
  authNextStep: string;
  buildArgs: (input: CliTubeBuildArgsInput) => CliTubeBuildArgsResult;
  stripEnvKeys?: readonly string[];
  stalePathOverrideFallback?: 'default-command';
  outputCapture?: 'last-message-file';
}

type EmptySuccessPolicy =
  | { emptySuccess: 'allow'; emptySuccessError?: never }
  | { emptySuccess: 'fail'; emptySuccessError: string };

export type CliTubeProviderSpec<TTool extends CliTubeTool = CliTubeTool> =
  CliTubeProviderSpecBase<TTool> & EmptySuccessPolicy;

const PLACEHOLDER_MODELS = new Set([
  'claude-code',
  'codex',
  'agy',
  'gemini',
  'groq',
  'grok',
  'claude-cli',
  'codex-cli',
  'agy-cli',
  'agy-default',
  'default',
  'cli',
]);

const CODEX_CONFIG_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const MAX_CODEX_CONFIG_OVERRIDES = 32;
const MAX_CODEX_CONFIG_OVERRIDE_LENGTH = 512;

export function normalizeCodexConfigOverrides(configs: readonly string[] | undefined | null): string[] {
  const normalized: string[] = [];
  for (const raw of configs ?? []) {
    if (typeof raw !== 'string') continue;
    const config = raw.trim();
    if (!config) continue;
    if (normalized.length >= MAX_CODEX_CONFIG_OVERRIDES) {
      throw new Error(`Too many Codex config overrides; maximum is ${MAX_CODEX_CONFIG_OVERRIDES}`);
    }
    if (config.length > MAX_CODEX_CONFIG_OVERRIDE_LENGTH || /[\0\r\n]/.test(config)) {
      throw new Error(`Invalid Codex config override "${config}": value is too long or contains a control character`);
    }
    const separator = config.indexOf('=');
    const key = separator > 0 ? config.slice(0, separator).trim() : '';
    if (!key || !CODEX_CONFIG_KEY.test(key)) {
      throw new Error(`Invalid Codex config override "${config}": expected key=value with a simple key`);
    }
    normalized.push(config);
  }
  return normalized;
}

function effectiveModel(model: string | undefined, placeholderFallback?: string): string | undefined {
  if (model && !PLACEHOLDER_MODELS.has(model)) return model;
  return placeholderFallback;
}

function buildClaudeArgs(input: CliTubeBuildArgsInput): CliTubeBuildArgsResult {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  const model = effectiveModel(input.model, 'sonnet');
  if (model) args.push('--model', model);
  if (input.permissionMode) args.push('--permission-mode', input.permissionMode);
  args.push(input.prompt);
  return { args, stdin: null };
}

function buildCodexArgs(input: CliTubeBuildArgsInput): CliTubeBuildArgsResult {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--full-auto',
    '--sandbox', 'workspace-write',
    '--json',
  ];
  if (input.outputPath) args.push('--output-last-message', input.outputPath);
  const model = effectiveModel(input.model);
  if (model) args.push('--model', model);
  for (const config of normalizeCodexConfigOverrides(input.codexConfig)) {
    args.push('-c', config);
  }
  args.push(input.prompt);
  return { args, stdin: null };
}

function buildAgyArgs(input: CliTubeBuildArgsInput): CliTubeBuildArgsResult {
  const args = ['--print'];
  const model = effectiveModel(input.model);
  if (model) args.push('--model', model);
  if (input.timeoutMs && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0) {
    args.push('--print-timeout', `${Math.max(1, Math.ceil(input.timeoutMs / 1000))}s`);
  }
  args.push(input.prompt);
  return { args, stdin: null };
}

function buildPromptFlagArgs(input: CliTubeBuildArgsInput): CliTubeBuildArgsResult {
  const args = ['-p'];
  const model = effectiveModel(input.model);
  if (model) args.push('--model', model);
  args.push(input.prompt);
  return { args, stdin: null };
}

export const CLI_TUBE_PROVIDER_SPECS: { [TTool in CliTubeTool]: CliTubeProviderSpec<TTool> } = {
  'claude-code': {
    id: 'claude-code',
    defaultBinary: 'claude',
    binaryEnvOverride: 'PD_CLI_CLAUDE_CODE_BIN',
    authNextStep: 'Run `claude setup-token` or `claude auth` to authenticate.',
    buildArgs: buildClaudeArgs,
    stripEnvKeys: ['ANTHROPIC_API_KEY'],
    stalePathOverrideFallback: 'default-command',
    emptySuccess: 'allow',
  },
  codex: {
    id: 'codex',
    defaultBinary: 'codex',
    binaryEnvOverride: 'PD_CLI_CODEX_BIN',
    authNextStep: 'Set OPENAI_API_KEY in ~/.codex/config or `codex auth login`.',
    buildArgs: buildCodexArgs,
    outputCapture: 'last-message-file',
    emptySuccess: 'allow',
  },
  agy: {
    id: 'agy',
    defaultBinary: 'agy',
    binaryEnvOverride: 'PD_CLI_AGY_BIN',
    authNextStep: 'Run `agy --print "hello"` once interactively to confirm authentication.',
    buildArgs: buildAgyArgs,
    emptySuccess: 'fail',
    emptySuccessError: 'agy produced no stdout or stderr in print mode.',
  },
  gemini: {
    id: 'gemini',
    defaultBinary: 'gemini',
    binaryEnvOverride: 'PD_CLI_GEMINI_BIN',
    authNextStep: 'Run `gemini` once interactively to sign in, or set GEMINI_API_KEY.',
    buildArgs: buildPromptFlagArgs,
    emptySuccess: 'allow',
  },
  groq: {
    id: 'groq',
    defaultBinary: 'groq',
    binaryEnvOverride: 'PD_CLI_GROQ_BIN',
    authNextStep: 'Run `groq` once interactively to sign in, or set GROQ_API_KEY.',
    buildArgs: buildPromptFlagArgs,
    emptySuccess: 'allow',
  },
  grok: {
    id: 'grok',
    defaultBinary: 'grok',
    binaryEnvOverride: 'PD_CLI_GROK_BIN',
    authNextStep: 'Run `grok` once interactively to sign in, or set GROK_API_KEY / XAI_API_KEY.',
    buildArgs: buildPromptFlagArgs,
    emptySuccess: 'allow',
  },
};

export function getCliTubeProviderSpec<TTool extends CliTubeTool>(
  tool: TTool,
): CliTubeProviderSpec<TTool> {
  const spec = CLI_TUBE_PROVIDER_SPECS[tool];
  if (!spec) {
    throw new Error(`unknown cli tool: ${tool}`);
  }
  return spec;
}

export function buildCliTubeArgs(
  tool: CliTubeTool,
  input: CliTubeBuildArgsInput,
): CliTubeBuildArgsResult {
  return getCliTubeProviderSpec(tool).buildArgs(input);
}

export interface CliChildWaitResult {
  code: number;
  timedOut: boolean;
  spawnErr: string | null;
}

interface WaitForCliChildOptions {
  timeoutMs: number;
  killGraceMs: number;
}

export function waitForCliChildProcess(
  child: ChildProcess,
  opts: WaitForCliChildOptions,
): Promise<CliChildWaitResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let knownTreePids: number[] = [];
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    const settle = (code: number, spawnErr: string | null = null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ code, timedOut, spawnErr });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      knownTreePids = collectProcessTreePids(child.pid);
      signalCliProcessTree(child, 'SIGTERM', knownTreePids);
      forceKillTimer = setTimeout(() => {
        knownTreePids = dedupePids([
          ...knownTreePids,
          ...collectProcessTreePids(child.pid),
        ]);
        signalCliProcessTree(child, 'SIGKILL', knownTreePids);
      }, opts.killGraceMs);
      forceKillTimer.unref?.();
    }, opts.timeoutMs);
    timer.unref?.();

    child.on('close', (code) => {
      settle(typeof code === 'number' ? code : -1);
    });
    child.on('error', (err) => {
      settle(-1, err.message);
    });
  });
}

function signalCliProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
  knownTreePids: readonly number[],
): void {
  const pid = child.pid;
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, signal);
    } catch {
      // Fall back for non-detached, platform-limited, or mocked processes.
    }
  }
  for (const targetPid of knownTreePids) {
    try {
      process.kill(targetPid, signal);
    } catch {
      // Best effort; another signal path may already have reaped it.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Best effort; close/error owns the final result.
  }
}

function collectProcessTreePids(rootPid: number | undefined): number[] {
  if (typeof rootPid !== 'number' || rootPid <= 0) return [];
  const descendants = new Map<number, number[]>();
  try {
    const output = childProcess.execFileSync('ps', ['-axo', 'pid=,ppid='], {
      encoding: 'utf8',
      timeout: 1_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split('\n')) {
      const [pidText, ppidText] = line.trim().split(/\s+/);
      const pid = Number(pidText);
      const ppid = Number(ppidText);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      const children = descendants.get(ppid) ?? [];
      children.push(pid);
      descendants.set(ppid, children);
    }
  } catch {
    return [rootPid];
  }

  const tree = [rootPid];
  for (let index = 0; index < tree.length; index += 1) {
    for (const childPid of descendants.get(tree[index]) ?? []) {
      if (!tree.includes(childPid)) tree.push(childPid);
    }
  }
  return tree;
}

function dedupePids(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}
