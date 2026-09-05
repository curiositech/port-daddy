import { normalizeNativeHarnessSessionId } from '../../harness-session-id.js';

export type CliTubePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export interface CliTubeBuildArgsInput {
  prompt: string;
  outputPath?: string;
  model?: string;
  permissionMode?: CliTubePermissionMode;
  codexConfig?: string[];
  timeoutMs?: number;
  resumeSessionId?: string;
  /** Request external confinement; the launcher must prove its wrapper before spawn. */
  externalConfinement?: boolean;
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
    modelPolicy: {
      extraPlaceholderModels: ['codex-cli'],
    },
    outputCapture: 'last-message-file',
    emptySuccess: 'allow',
  },
  agy: {
    // NOT STREAMED, deliberately (2026-08-23). Every other lane in this file
    // either has a documented per-event JSON format (claude-code's stream-json,
    // codex's --json) or falls back to whole-output print mode. Antigravity
    // documents no streaming format, and inventing a parser for an undocumented
    // one is how a lane silently drops turns — which is worse than an honest
    // batch lane, because a partial stream LOOKS live. When agy publishes one,
    // this becomes an argStyle change plus a mapper, exactly like the other two.
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

/**
 * Build provider-native fresh or resume arguments from one policy definition.
 * Design: managed Codex overrides follow caller settings so dynamic skill
 * discovery remains available without eager catalog instructions.
 * @param spec Provider capabilities and argument style.
 * @param input Prompt, model, capture, resume, and confinement settings.
 * @returns Native argument vector and optional standard input.
 */
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
      // One policy flag only. External mode is admitted by the launcher only
      // after Coast Guard confirms a real OS confinement wrapper.
      const approvalFlag = input.externalConfinement
        ? '--dangerously-bypass-approvals-and-sandbox'
        : '--approve-for-me';
      const args = resumeSessionId
        ? ['exec', approvalFlag, 'resume', '--skip-git-repo-check', '--json']
        : ['exec', '--skip-git-repo-check', approvalFlag, '--json'];
      if (input.outputPath) args.push('--output-last-message', input.outputPath);
      pushModelArg(args, spec, input.model);
      for (const config of normalizeCodexConfigOverrides(input.codexConfig)) {
        args.push('-c', config);
      }
      // Keep discovery available without eagerly injecting the installed skill
      // catalog. Last override wins even when callers request eager instructions.
      args.push('-c', 'skills.include_instructions=false');
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
