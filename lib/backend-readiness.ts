import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { assessBackendTelemetryPolicy } from './backend-telemetry-policy.js';
import { getSecret } from './secret-env.js';
import { CLOUDFLARE_BACKEND_SETUP_LINKS, type BackendSetupLink } from './backend-setup-links.js';

export interface BackendReadiness {
  backend: string;
  status: 'ready' | 'needs_setup' | 'manual_check' | 'unknown';
  summary: string;
  nextStep?: string;
  credentialKeys?: string[];
  credentialAlternates?: string[];
  setupLinks?: BackendSetupLink[];
  setupCommand?: string;
  setupFiles?: string[];
  restartRequired?: boolean;
}

const require = createRequire(import.meta.url);

function commandExists(command: string): boolean {
  const result = spawnSync('which', [command], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
  });
  return (result.status ?? 1) === 0;
}

function packageInstalled(specifier: string): boolean {
  try {
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

async function ollamaReachable(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function applyTelemetryPolicy(
  readiness: BackendReadiness,
  telemetryPolicy: ReturnType<typeof assessBackendTelemetryPolicy>,
): BackendReadiness {
  if (telemetryPolicy.launchAllowed) {
    return readiness;
  }

  const summary = `${readiness.summary}. ${telemetryPolicy.summary}`;
  const nextStep = [readiness.nextStep, telemetryPolicy.nextStep]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' ');

  return {
    ...readiness,
    status: 'needs_setup',
    summary,
    nextStep: nextStep || undefined,
  };
}

function setupForKeys(keys: string[]): Pick<BackendReadiness, 'credentialKeys' | 'setupCommand' | 'setupFiles' | 'restartRequired'> {
  const body = keys.map((key) => `${key}=<paste-value>`).join('\\n');
  return {
    credentialKeys: keys,
    setupFiles: ['~/.port-daddy-env', '.env.local', '.env'],
    setupCommand: `printf '\\n${body}\\n' >> ~/.port-daddy-env\npd restart`,
    restartRequired: true,
  };
}

export async function assessBackendReadiness(
  backend: string,
  opts: { model?: string | null } = {},
): Promise<BackendReadiness> {
  const telemetryPolicy = assessBackendTelemetryPolicy(backend, opts.model);

  switch (backend) {
    case 'claude-cli': {
      if (!commandExists('claude')) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: 'Claude CLI binary not found',
          nextStep: 'Install the Claude CLI, then run it interactively once to establish login.',
          setupCommand: 'claude',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        summary: 'Claude CLI binary found; login cannot be verified non-interactively',
        nextStep: 'Run `claude` once interactively if needed. In sandboxed runners, approve an unsandboxed Port Daddy/Claude command path first.',
        setupCommand: 'claude',
      }, telemetryPolicy);
    }

    case 'codex': {
      if (!commandExists('codex')) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: 'Codex CLI binary not found',
          nextStep: 'Install the Codex CLI, then run `codex exec` once interactively to verify auth and model access.',
          setupCommand: 'codex exec "print ok"',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        summary: 'Codex CLI binary found; OpenAI auth and model access cannot be verified non-interactively',
        nextStep: 'Run `codex exec` once interactively if needed. In sandboxed runners, approve an unsandboxed Port Daddy/Codex command path first.',
        setupCommand: 'codex exec "print ok"',
      }, telemetryPolicy);
    }

    case 'claude':
      if (!packageInstalled('@anthropic-ai/sdk')) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: '@anthropic-ai/sdk is not installed',
          nextStep: 'Run `npm install @anthropic-ai/sdk` before using the Claude SDK backend.',
          ...setupForKeys(['ANTHROPIC_API_KEY']),
          setupCommand: 'npm install @anthropic-ai/sdk\nprintf \'\\nANTHROPIC_API_KEY=<paste-value>\\n\' >> ~/.port-daddy-env\npd restart',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy(
        getSecret('ANTHROPIC_API_KEY')
          ? {
            backend,
            status: 'ready',
            summary: 'ANTHROPIC_API_KEY present and Claude SDK installed',
            ...setupForKeys(['ANTHROPIC_API_KEY']),
          }
          : {
            backend,
            status: 'needs_setup',
            summary: 'ANTHROPIC_API_KEY missing',
            nextStep: 'Add ANTHROPIC_API_KEY to ~/.port-daddy-env or your project .env file, then restart the daemon.',
            ...setupForKeys(['ANTHROPIC_API_KEY']),
          },
        telemetryPolicy
      );

    case 'gemini':
      if (!packageInstalled('@google/generative-ai')) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: '@google/generative-ai is not installed',
          nextStep: 'Run `npm install @google/generative-ai` before using the Gemini backend.',
          ...setupForKeys(['GEMINI_API_KEY']),
          credentialAlternates: ['GOOGLE_API_KEY'],
          setupCommand: 'npm install @google/generative-ai\nprintf \'\\nGEMINI_API_KEY=<paste-value>\\n\' >> ~/.port-daddy-env\npd restart',
        }, telemetryPolicy);
      }
      const geminiKeyPresent = getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_API_KEY');
      return applyTelemetryPolicy(
        geminiKeyPresent
          ? {
            backend,
            status: 'ready',
            summary: 'Gemini API key present and Gemini SDK installed',
            ...setupForKeys(['GEMINI_API_KEY']),
            credentialAlternates: ['GOOGLE_API_KEY'],
          }
          : {
            backend,
            status: 'needs_setup',
            summary: 'Gemini API key missing',
            nextStep: 'Add GEMINI_API_KEY or GOOGLE_API_KEY to ~/.port-daddy-env or your project .env file, then restart the daemon.',
            ...setupForKeys(['GEMINI_API_KEY']),
            credentialAlternates: ['GOOGLE_API_KEY'],
          },
        telemetryPolicy
      );

    case 'cloudflare': {
      const accountId = getSecret('CLOUDFLARE_ACCOUNT_ID')
        || process.env.CLOUDFLARE_ACCOUNT_ID
        || getSecret('CF_ACCOUNT_ID')
        || process.env.CF_ACCOUNT_ID;
      const token = getSecret('CLOUDFLARE_API_TOKEN')
        || getSecret('CLOUDFLARE_API_KEY')
        || getSecret('CF_API_TOKEN');
      if (accountId && token) {
        return applyTelemetryPolicy({
          backend,
          status: 'ready',
          summary: 'Cloudflare Workers AI credentials present',
          ...setupForKeys(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']),
          credentialAlternates: ['CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CF_ACCOUNT_ID'],
          setupLinks: CLOUDFLARE_BACKEND_SETUP_LINKS,
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'needs_setup',
        summary: 'Cloudflare Workers AI credentials missing',
        nextStep: 'Create a Cloudflare token from the Port Daddy template, then save CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the console or ~/.port-daddy-env.',
        ...setupForKeys(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']),
        credentialAlternates: ['CLOUDFLARE_API_KEY', 'CF_API_TOKEN', 'CF_ACCOUNT_ID'],
        setupLinks: CLOUDFLARE_BACKEND_SETUP_LINKS,
      }, telemetryPolicy);
    }

    case 'openai': {
      const apiKey = getSecret('OPENAI_API_KEY') || process.env.OPENAI_API_KEY;
      if (apiKey) {
        return applyTelemetryPolicy({
          backend,
          status: 'ready',
          summary: 'OPENAI_API_KEY present',
          ...setupForKeys(['OPENAI_API_KEY']),
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'needs_setup',
        summary: 'OPENAI_API_KEY missing',
        nextStep: 'Add OPENAI_API_KEY to ~/.port-daddy-env or your project .env file, then restart the daemon.',
        ...setupForKeys(['OPENAI_API_KEY']),
        setupCommand: 'printf \'\\nOPENAI_API_KEY=<paste-value>\\n\' >> ~/.port-daddy-env\npd restart',
      }, telemetryPolicy);
    }

    case 'cli:claude-code': {
      const bin = process.env.PD_CLI_CLAUDE_CODE_BIN || 'claude';
      if (!commandExists(bin)) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: `Claude Code CLI binary "${bin}" not found`,
          nextStep: 'Install Claude Code (https://claude.com/code) and run `claude setup-token` once to authenticate.',
          setupCommand: 'brew install claude  # or: curl -fsSL https://claude.ai/install.sh | sh',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        summary: 'Claude Code CLI binary found; auth cannot be verified non-interactively',
        nextStep: 'Run `claude -p "hello"` once to confirm auth. PD_USE_CLI_BACKEND=claude-code forces all spawns through this CLI.',
        setupCommand: 'claude -p "hello"',
      }, telemetryPolicy);
    }

    case 'cli:codex': {
      const bin = process.env.PD_CLI_CODEX_BIN || 'codex';
      if (!commandExists(bin)) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: `Codex CLI binary "${bin}" not found`,
          nextStep: 'Install the Codex CLI and authenticate before using this backend.',
          setupCommand: 'codex --help',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        summary: 'Codex CLI binary found; auth cannot be verified non-interactively',
        nextStep: 'Run `codex exec "hello"` once to confirm auth. PD_USE_CLI_BACKEND=codex forces all spawns through this CLI.',
        setupCommand: 'codex exec "hello"',
      }, telemetryPolicy);
    }

    case 'ollama': {
      if (await ollamaReachable()) {
        return applyTelemetryPolicy({
          backend,
          status: 'ready',
          summary: 'Ollama API reachable at http://localhost:11434',
        }, telemetryPolicy);
      }
      if (commandExists('ollama')) {
        return applyTelemetryPolicy({
          backend,
          status: 'manual_check',
          summary: 'Ollama CLI found, but local API is not reachable',
          nextStep: 'Start `ollama serve`, or switch this agent to a remote backend.',
          setupCommand: 'ollama serve',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'needs_setup',
        summary: 'Ollama not installed and API not reachable',
        nextStep: 'Install Ollama or choose a different backend.',
        setupCommand: 'brew install ollama\nollama serve',
      }, telemetryPolicy);
    }

    case 'aider':
      return applyTelemetryPolicy(
        commandExists('aider')
          ? {
            backend,
            status: 'manual_check',
            summary: 'Aider binary found; underlying model/provider auth is external',
            nextStep: 'Verify your Aider model provider is configured before running fleet agents.',
            setupCommand: 'aider --help',
          }
          : {
            backend,
            status: 'needs_setup',
            summary: 'Aider binary not found',
            nextStep: 'Install Aider and configure its model provider before using this backend.',
            setupCommand: 'python -m pip install aider-install\naider-install',
          },
        telemetryPolicy
      );

    case 'custom':
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        summary: 'Custom backend cannot be preflight-verified automatically',
        nextStep: 'Verify the command, permissions, and any sandbox restrictions manually.',
        setupCommand: 'pd fleet models',
      }, telemetryPolicy);

    default:
      return applyTelemetryPolicy({
        backend,
        status: 'unknown',
        summary: 'No readiness probe exists for this backend yet',
        nextStep: 'Treat this backend as unverified until a readiness probe is added.',
        setupCommand: 'pd fleet models',
      }, telemetryPolicy);
  }
}
