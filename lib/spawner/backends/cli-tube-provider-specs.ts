import { normalizeNativeHarnessSessionId } from '../../harness-session-id.js';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

export type CliTubePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export interface CliTubeBuildArgsInput {
  prompt: string;
  outputPath?: string;
  model?: string;
  permissionMode?: CliTubePermissionMode;
  codexConfig?: string[];
  /** Extra writable roots for Codex's workspace-write sandbox. */
  additionalWritableDirs?: string[];
  timeoutMs?: number;
  resumeSessionId?: string;
}

export interface CliTubeBuildArgsResult {
  args: string[];
  stdin: string | null;
}

export type CliTubeArgStyle =
  | { kind: 'claude-stream-json' }
  | { kind: 'codex-exec-json' }
  | { kind: 'print'; timeoutFlag: '--print-timeout' }
  | { kind: 'prompt-flag' };

export interface CliTubeModelPolicy {
  /**
   * Extra sentinels that mean "let this CLI/provider choose", in addition to
   * the provider id itself plus the generic `default`/`cli` sentinels.
   */
  extraPlaceholderModels?: readonly string[];
  /**
   * Optional concrete fallback when a placeholder must still become a real
   * model argument for that provider.
   */
  placeholderFallback?: string;
}

interface CliTubeProviderSpecBase<TTool extends string = string> {
  id: TTool;
  defaultBinary: string;
  binaryEnvOverride: `PD_CLI_${string}_BIN`;
  authNextStep: string;
  argStyle: CliTubeArgStyle;
  modelPolicy?: CliTubeModelPolicy;
  stripEnvKeys?: readonly string[];
  stalePathOverrideFallback?: 'default-command';
  outputCapture?: 'last-message-file';
}

type EmptySuccessPolicy =
  | { emptySuccess: 'allow'; emptySuccessError?: never }
  | { emptySuccess: 'fail'; emptySuccessError: string };

type CliTubeProviderDefinition<TTool extends string = string> =
  CliTubeProviderSpecBase<TTool> & EmptySuccessPolicy;

export type CliTubeProviderSpec<TTool extends string = string> =
  CliTubeProviderDefinition<TTool> & {
    buildArgs: (input: CliTubeBuildArgsInput) => CliTubeBuildArgsResult;
  };

type CliTubeProviderDefinitionInput =
  Omit<CliTubeProviderSpecBase<string>, 'id'> & EmptySuccessPolicy;

const CODEX_CONFIG_KEY = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const MAX_CODEX_CONFIG_OVERRIDES = 32;
const MAX_CODEX_CONFIG_OVERRIDE_LENGTH = 512;

/**
 * Codex's workspace-write sandbox denies network unless this permission is
 * explicit. Port Daddy agents need loopback access to their selected daemon
 * for attention, heartbeats, notes, and collection. This remains the fallback
 * when Coast Guard cannot provide an OS sandbox itself.
 */
export const CODEX_WORKSPACE_NETWORK_CONFIG = 'sandbox_workspace_write.network_access=true';
export const CODEX_EXTERNAL_SANDBOX_FLAG = '--dangerously-bypass-approvals-and-sandbox';
const CODEX_COORDINATION_ENV_KEYS = [
  'PATH',
  'PORT_DADDY_URL',
  'PORT_DADDY_CLI',
  'PORT_DADDY_DAEMON',
  'PD_ACTIVE_DAEMON',
  'PD_AGENT_ID',
  'PD_SESSION_ID',
] as const;

const CODEX_PROFILE_SHELL_ENV_KEYS = ['ZDOTDIR', 'BASH_ENV', 'ENV'] as const;

function codexEnvironmentConfig(key: string, value: string): string {
  if (/[\0\r\n]/.test(value)) {
    throw new Error(`Unsafe ${key} value cannot be forwarded to the Codex shell environment`);
  }
  const config = `shell_environment_policy.set.${key}=${JSON.stringify(value)}`;
  if (config.length > MAX_CODEX_CONFIG_OVERRIDE_LENGTH) {
    throw new Error(`Selected ${key} value exceeds the Codex shell environment limit`);
  }
  return config;
}

/**
 * Codex intentionally filters the environment exposed to model-generated
 * shells. Re-introduce only the selected-daemon and source-CLI context plus
 * PATH, after Coast Guard has scrubbed secrets from the parent environment.
 */
export function codexCoordinationEnvironmentConfigs(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const configs: string[] = [];
  for (const key of CODEX_COORDINATION_ENV_KEYS) {
    const value = key === 'PATH' ? compactCodexShellPath(env) : env[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    configs.push(codexEnvironmentConfig(key, value));
  }
  for (const [key, value] of trustedCodexProfileShellEnvironment(env)) {
    configs.push(codexEnvironmentConfig(key, value));
  }
  return configs;
}

function compactCodexShellPath(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const inherited = env.PATH?.split(delimiter) ?? [];
  const sourceCliDir = env.PORT_DADDY_CLI ? dirname(env.PORT_DADDY_CLI) : undefined;
  if (sourceCliDir) {
    if (!isAbsolute(sourceCliDir)) {
      throw new Error('PORT_DADDY_CLI must be absolute before forwarding its directory to Codex');
    }
    const requiredConfig = `shell_environment_policy.set.PATH=${JSON.stringify(sourceCliDir)}`;
    if (requiredConfig.length > MAX_CODEX_CONFIG_OVERRIDE_LENGTH) {
      throw new Error('Selected source CLI directory exceeds the Codex shell environment limit');
    }
  }
  const candidates = inherited.filter((value) => value.length > 0);
  const unique = [...new Set(candidates)];
  const kept: string[] = sourceCliDir ? [sourceCliDir] : [];
  for (const candidate of unique) {
    if (candidate === sourceCliDir) continue;
    const next = [...kept, candidate].join(delimiter);
    const config = `shell_environment_policy.set.PATH=${JSON.stringify(next)}`;
    if (config.length <= MAX_CODEX_CONFIG_OVERRIDE_LENGTH) kept.push(candidate);
  }
  return kept.length > 0 ? kept.join(delimiter) : undefined;
}

/**
 * Shell startup variables execute code before a model-generated command. Never
 * forward caller-supplied values. A named development daemon may opt into the
 * profile-local init that Port Daddy installed beside its source-matched CLI;
 * derive those paths from that trusted layout instead.
 */
function trustedCodexProfileShellEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Array<readonly [typeof CODEX_PROFILE_SHELL_ENV_KEYS[number], string]> {
  const cli = env.PORT_DADDY_CLI;
  const prefix = env.PORT_DADDY_PREFIX;
  if (!cli || !prefix || !isAbsolute(prefix)) return [];
  const expectedCli = join(prefix, 'dev-bin', 'pd');
  if (cli !== expectedCli) return [];
  const shellDir = join(prefix, 'dev-shell');
  const shellInit = join(shellDir, 'pd-env.sh');
  return [
    ['ZDOTDIR', shellDir],
    ['BASH_ENV', shellInit],
    ['ENV', shellInit],
  ];
}

/**
 * Select Codex's documented externally-sandboxed mode when Coast Guard is the
 * confirmed OS-sandbox authority. macOS does not allow Codex to install a
 * second Seatbelt profile inside Coast Guard's Seatbelt process tree. Caller
 * config is preserved; only Port Daddy's inner-sandbox defaults are removed.
 */
export function codexArgsForExternalSandbox(args: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--full-auto' || arg === CODEX_EXTERNAL_SANDBOX_FLAG) continue;
    if (arg === '--sandbox' && args[index + 1] === 'workspace-write') {
      index += 1;
      continue;
    }
    if (arg === '-c' && args[index + 1] === CODEX_WORKSPACE_NETWORK_CONFIG) {
      index += 1;
      continue;
    }
    result.push(arg);
  }
  const insertAt = result[0] === 'exec' && result[1] === 'resume' ? 2 : 1;
  result.splice(insertAt, 0, CODEX_EXTERNAL_SANDBOX_FLAG);
  return result;
}

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

function defineCliTubeProviderRegistry<const TDefinitions extends Record<string, CliTubeProviderDefinitionInput>>(
  definitions: TDefinitions,
): { [TTool in Extract<keyof TDefinitions, string>]: CliTubeProviderSpec<TTool> } {
  const specs = {} as { [TTool in Extract<keyof TDefinitions, string>]: CliTubeProviderSpec<TTool> };
  for (const id of Object.keys(definitions) as Array<Extract<keyof TDefinitions, string>>) {
    const definition = definitions[id];
    const spec: CliTubeProviderSpec<typeof id> = {
      id,
      ...definition,
      buildArgs: (input) => buildCliTubeArgsFromSpec(spec, input),
    };
    specs[id] = spec;
  }
  return specs;
}

export const CLI_TUBE_PROVIDER_SPECS = defineCliTubeProviderRegistry({
  'claude-code': {
    defaultBinary: 'claude',
    binaryEnvOverride: 'PD_CLI_CLAUDE_CODE_BIN',
    authNextStep: 'Run `claude setup-token` or `claude auth` to authenticate.',
    argStyle: { kind: 'claude-stream-json' },
    modelPolicy: {
      extraPlaceholderModels: ['claude-cli', 'codex'],
      placeholderFallback: 'sonnet',
    },
    stripEnvKeys: ['ANTHROPIC_API_KEY'],
    stalePathOverrideFallback: 'default-command',
    emptySuccess: 'allow',
  },
  codex: {
    defaultBinary: 'codex',
    binaryEnvOverride: 'PD_CLI_CODEX_BIN',
    authNextStep: 'Set OPENAI_API_KEY in ~/.codex/config or `codex auth login`.',
    argStyle: { kind: 'codex-exec-json' },
    // Shell startup hooks are code-execution surfaces. Remove every inherited
    // or per-spawn value from the Codex process; the argument builder injects
    // only the profile-local paths derived by trustedCodexProfileShellEnvironment.
    stripEnvKeys: ['ZDOTDIR', 'BASH_ENV', 'ENV'],
    modelPolicy: {
      extraPlaceholderModels: ['codex-cli'],
    },
    outputCapture: 'last-message-file',
    emptySuccess: 'allow',
  },
  agy: {
    defaultBinary: 'agy',
    binaryEnvOverride: 'PD_CLI_AGY_BIN',
    authNextStep: 'Run `agy --print "hello"` once interactively to confirm authentication.',
    argStyle: { kind: 'print', timeoutFlag: '--print-timeout' },
    modelPolicy: {
      extraPlaceholderModels: ['agy-cli', 'agy-default'],
    },
    emptySuccess: 'fail',
    emptySuccessError: 'agy produced no stdout or stderr in print mode.',
  },
  gemini: {
    defaultBinary: 'gemini',
    binaryEnvOverride: 'PD_CLI_GEMINI_BIN',
    authNextStep: 'Run `gemini` once interactively to sign in, or set GEMINI_API_KEY.',
    argStyle: { kind: 'prompt-flag' },
    modelPolicy: {},
    emptySuccess: 'allow',
  },
  groq: {
    defaultBinary: 'groq',
    binaryEnvOverride: 'PD_CLI_GROQ_BIN',
    authNextStep: 'Run `groq` once interactively to sign in, or set GROQ_API_KEY.',
    argStyle: { kind: 'prompt-flag' },
    modelPolicy: {},
    emptySuccess: 'allow',
  },
  grok: {
    defaultBinary: 'grok',
    binaryEnvOverride: 'PD_CLI_GROK_BIN',
    authNextStep: 'Run `grok` once interactively to sign in, or set GROK_API_KEY / XAI_API_KEY.',
    argStyle: { kind: 'prompt-flag' },
    modelPolicy: {},
    emptySuccess: 'allow',
  },
});

export type CliTubeTool = Extract<keyof typeof CLI_TUBE_PROVIDER_SPECS, string>;
export const CLI_TUBE_TOOLS = Object.keys(CLI_TUBE_PROVIDER_SPECS) as CliTubeTool[];

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

function buildCliTubeArgsFromSpec(
  spec: CliTubeProviderSpec,
  input: CliTubeBuildArgsInput,
): CliTubeBuildArgsResult {
  const resumeSessionId = normalizeResumeSessionId(spec.id, input.resumeSessionId);
  switch (spec.argStyle.kind) {
    case 'claude-stream-json': {
      const args = resumeSessionId
        ? ['--resume', resumeSessionId, '-p', '--output-format', 'stream-json', '--verbose']
        : ['-p', '--output-format', 'stream-json', '--verbose'];
      pushModelArg(args, spec, input.model);
      if (input.permissionMode) args.push('--permission-mode', input.permissionMode);
      args.push(input.prompt);
      return { args, stdin: null };
    }
    case 'codex-exec-json': {
      const args = ['exec'];
      for (const dir of input.additionalWritableDirs ?? []) {
        args.push('--add-dir', dir);
      }
      if (resumeSessionId) {
        args.push('resume', '--skip-git-repo-check', '--full-auto', '--json');
      } else {
        args.push('--skip-git-repo-check', '--full-auto', '--sandbox', 'workspace-write', '--json');
      }
      if (input.outputPath) args.push('--output-last-message', input.outputPath);
      pushModelArg(args, spec, input.model);
      for (const config of normalizeCodexConfigOverrides(input.codexConfig)) {
        args.push('-c', config);
      }
      // Append the invariant after caller overrides so a generic Codex config
      // cannot accidentally disable the loopback coordination plane.
      args.push('-c', CODEX_WORKSPACE_NETWORK_CONFIG);
      if (resumeSessionId) args.push(resumeSessionId);
      args.push(input.prompt);
      return { args, stdin: null };
    }
    case 'print': {
      const args = resumeSessionId ? ['--conversation', resumeSessionId, '--print'] : ['--print'];
      pushModelArg(args, spec, input.model);
      if (input.timeoutMs && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0) {
        args.push(spec.argStyle.timeoutFlag, `${Math.max(1, Math.ceil(input.timeoutMs / 1000))}s`);
      }
      args.push(input.prompt);
      return { args, stdin: null };
    }
    case 'prompt-flag': {
      if (resumeSessionId && spec.id !== 'gemini') {
        throw new Error(`${spec.id} does not expose native session resume`);
      }
      const args = resumeSessionId ? ['--resume', resumeSessionId, '-p'] : ['-p'];
      pushModelArg(args, spec, input.model);
      args.push(input.prompt);
      return { args, stdin: null };
    }
    default: {
      const exhaustive: never = spec.argStyle;
      throw new Error(`Unhandled CLI tube arg style ${JSON.stringify(exhaustive)}`);
    }
  }
}

function normalizeResumeSessionId(tool: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const sessionId = value;
  if (!sessionId.trim() || Buffer.byteLength(sessionId, 'utf8') > 1_024 || /[\0\r\n]/.test(sessionId)) {
    throw new Error('resumeSessionId must be a safe non-empty harness identifier');
  }
  const adapterFamily = tool === 'claude-code'
    ? 'claude-code'
    : tool === 'codex'
      ? 'codex-cli'
      : tool === 'agy'
        ? 'agy-cli'
        : tool === 'gemini'
          ? 'gemini-cli'
          : null;
  if (adapterFamily) return normalizeNativeHarnessSessionId(adapterFamily, sessionId);
  return sessionId.trim();
}

function pushModelArg(args: string[], spec: CliTubeProviderSpec, requestedModel: string | undefined): void {
  const model = resolveCliTubeModel(spec, requestedModel);
  if (model) args.push('--model', model);
}

function resolveCliTubeModel(spec: CliTubeProviderSpec, requestedModel: string | undefined): string | undefined {
  const policy = spec.modelPolicy;
  if (!policy) return requestedModel;
  const placeholders = new Set([
    spec.id,
    'default',
    'cli',
    ...(policy.extraPlaceholderModels ?? []),
  ]);
  if (requestedModel && !placeholders.has(requestedModel)) return requestedModel;
  return policy.placeholderFallback;
}
