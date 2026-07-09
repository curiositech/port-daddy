import { createRequire } from 'node:module';
import { join } from 'node:path';
import { assessBackendTelemetryPolicy } from './backend-telemetry-policy.js';
import { getSecret } from './secret-env.js';
import { CLOUDFLARE_BACKEND_SETUP_LINKS, type BackendSetupLink } from './backend-setup-links.js';

export interface BackendReadiness {
  backend: string;
  status: 'ready' | 'needs_setup' | 'manual_check' | 'unknown';
  /**
   * True when the daemon may attempt a spawn even though `status` is not
   * `ready`. Set for installed local CLI backends whose auth genuinely cannot
   * be verified offline (the `cli:*` tube backends): the binary is present,
   * and a missing/expired token surfaces as a real non-zero-exit error at
   * runtime — `lib/spawner/backends/cli-tube.ts` maps auth-failure stderr to an
   * actionable message and enforces a kill-timeout, so there is no silent hang.
   * Deliberately NOT set for probed-and-degraded `manual_check` states such as
   * ollama with its server down, where a launch cannot succeed. The launch gate
   * (`lib/spawn-preflight.ts`) treats `ready || launchableUnverified` as
   * launchable; everything else stays blocked.
   */
  launchableUnverified?: boolean;
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

// Agent CLIs (claude-code, codex, …) commonly install to per-user dirs that are
// NOT on the daemon's launchd PATH (which is bare: /usr/bin:/bin:/usr/sbin:/sbin).
// The spawner's executor already augments PATH with ~/.local/bin at exec time
// (lib/spawner.ts runClaudeCli), so a launch would actually find the binary — but
// this readiness check used the bare PATH and fail-closed BEFORE the executor ran,
// reporting "Claude CLI binary not found" for an install that works in the user's
// shell. Resolve the same locations the executor does so the gate matches reality.
// Standard per-user CLI install dirs live in lib/cli-bin-dirs.ts, shared
// with the spawn path (lib/spawner/backends/cli-tube.ts) so this readiness
// gate and the actual spawn resolve binaries against the SAME locations —
// otherwise readiness can say "binary exists" while the spawn fails under
// launchd's bare PATH.
import { cliBinDirs, resolveCliBinary, type CliBinaryResolution } from './cli-bin-dirs.js';
export { cliBinDirs, resolveCliBinary };

export function commandExists(command: string): boolean {
  return resolveCliBinary(command).found;
}

function cliSummary(label: string, resolution: CliBinaryResolution, suffix: string): string {
  const base = `${label} binary found at ${resolution.command}; ${suffix}`;
  return resolution.warning ? `${base}. ${resolution.warning}` : base;
}

function cliMissingSummary(label: string, resolution: CliBinaryResolution): string {
  const base = `${label} binary "${resolution.command}" not found`;
  return resolution.warning ? `${base}. ${resolution.warning}` : base;
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

/** LM Studio's OpenAI-compatible local server base URL (override via env). */
const LMSTUDIO_API_BASE =
  process.env.LMSTUDIO_API_BASE || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';

/**
 * Probe the LM Studio local server's `/v1/models` endpoint. Returns the loaded
 * model id when reachable (LM Studio reports whatever model is loaded), or null
 * when the server is off/unreachable — handled gracefully, never throws.
 */
async function lmStudioLoadedModel(): Promise<string | null> {
  try {
    const res = await fetch(`${LMSTUDIO_API_BASE.replace(/\/$/, '')}/models`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const first = data?.data?.find((m) => typeof m?.id === 'string');
    return first && typeof first.id === 'string' ? first.id : '';
  } catch {
    return null;
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
    // A telemetry-policy block must override the launchable-unverified opt-in:
    // never let an installed CLI backend launch past a data-egress refusal.
    launchableUnverified: false,
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
      const resolution = resolveCliBinary('claude', { envOverride: 'PD_CLI_CLAUDE_CODE_BIN' });
      if (!resolution.found) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: cliMissingSummary('Claude CLI', resolution),
          nextStep: 'Install the Claude CLI, then run it interactively once to establish login.',
          setupCommand: 'claude',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        // The CLI manages its own auth (OAuth/keychain); a found binary is
        // launchable-with-a-warning, exactly like its cli:claude-code twin.
        // Without this flag preflight refused every claude-cli launch through
        // the daemon ("no launchable backend").
        launchableUnverified: true,
        summary: cliSummary('Claude CLI', resolution, 'login cannot be verified non-interactively'),
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
        // Codex manages its own auth (ChatGPT OAuth / OPENAI_API_KEY); a found
        // binary is launchable-with-a-warning, exactly like its cli:codex twin.
        // Without this flag preflight refused every codex launch through the
        // daemon ("no launchable backend: codex — manual_check").
        launchableUnverified: true,
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

    case 'gemini': {
      // REST-based adapter (lib/llm-call.ts geminiAdapter) — no SDK package
      // required. Readiness is purely a key-present check.
      const geminiKeyPresent = getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_API_KEY');
      return applyTelemetryPolicy(
        geminiKeyPresent
          ? {
            backend,
            status: 'ready',
            summary: 'Gemini API key present',
            ...setupForKeys(['GEMINI_API_KEY']),
            credentialAlternates: ['GOOGLE_API_KEY'],
          }
          : {
            backend,
            status: 'needs_setup',
            summary: 'Gemini API key missing',
            nextStep: 'Run `pd secret set GEMINI_API_KEY` (or add GEMINI_API_KEY / GOOGLE_API_KEY to ~/.port-daddy-env), then restart the daemon.',
            ...setupForKeys(['GEMINI_API_KEY']),
            credentialAlternates: ['GOOGLE_API_KEY'],
          },
        telemetryPolicy
      );
    }

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

    case 'groq': {
      // OpenAI-compatible REST adapter (lib/spawner/backends/groq.ts) — no
      // SDK package required. Readiness is a key-present check.
      const apiKey = getSecret('GROQ_API_KEY') || process.env.GROQ_API_KEY;
      if (apiKey) {
        return applyTelemetryPolicy({
          backend,
          status: 'ready',
          summary: 'GROQ_API_KEY present',
          ...setupForKeys(['GROQ_API_KEY']),
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'needs_setup',
        summary: 'GROQ_API_KEY missing',
        nextStep: 'Run `pd secret set GROQ_API_KEY` (or add GROQ_API_KEY to ~/.port-daddy-env), then restart the daemon.',
        ...setupForKeys(['GROQ_API_KEY']),
        setupCommand: 'printf \'\\nGROQ_API_KEY=<paste-value>\\n\' >> ~/.port-daddy-env\npd restart',
      }, telemetryPolicy);
    }

    case 'deepseek': {
      // OpenAI-compatible REST adapter (lib/spawner/backends/deepseek.ts) — no
      // SDK package required. Readiness is a key-present check.
      const apiKey = getSecret('DEEPSEEK_API_KEY') || process.env.DEEPSEEK_API_KEY;
      if (apiKey) {
        return applyTelemetryPolicy({
          backend,
          status: 'ready',
          summary: 'DEEPSEEK_API_KEY present',
          ...setupForKeys(['DEEPSEEK_API_KEY']),
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'needs_setup',
        summary: 'DEEPSEEK_API_KEY missing',
        nextStep: 'Run `pd secret set DEEPSEEK_API_KEY` (or add DEEPSEEK_API_KEY to ~/.port-daddy-env), then restart the daemon.',
        ...setupForKeys(['DEEPSEEK_API_KEY']),
        setupCommand: 'printf \'\\nDEEPSEEK_API_KEY=<paste-value>\\n\' >> ~/.port-daddy-env\npd restart',
      }, telemetryPolicy);
    }

    case 'xai': {
      // OpenAI-compatible REST adapter (lib/spawner/backends/xai.ts) — no
      // SDK package required. Readiness is a key-present check.
      const apiKey = getSecret('XAI_API_KEY') || process.env.XAI_API_KEY;
      if (apiKey) {
        return applyTelemetryPolicy({
          backend,
          status: 'ready',
          summary: 'XAI_API_KEY present',
          ...setupForKeys(['XAI_API_KEY']),
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'needs_setup',
        summary: 'XAI_API_KEY missing',
        nextStep: 'Run `pd secret set XAI_API_KEY` (or add XAI_API_KEY to ~/.port-daddy-env), then restart the daemon.',
        ...setupForKeys(['XAI_API_KEY']),
        setupCommand: 'printf \'\\nXAI_API_KEY=<paste-value>\\n\' >> ~/.port-daddy-env\npd restart',
      }, telemetryPolicy);
    }

    case 'cli:claude-code': {
      const resolution = resolveCliBinary('claude', { envOverride: 'PD_CLI_CLAUDE_CODE_BIN' });
      if (!resolution.found) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: cliMissingSummary('Claude Code CLI', resolution),
          nextStep: 'Install Claude Code (https://claude.com/code) and run `claude setup-token` once to authenticate.',
          setupCommand: 'brew install claude  # or: curl -fsSL https://claude.ai/install.sh | sh',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        launchableUnverified: true,
        summary: cliSummary('Claude Code CLI', resolution, 'auth cannot be verified non-interactively'),
        nextStep: 'Run `claude -p "hello"` once to confirm auth. PD_USE_CLI_BACKEND=claude-code forces all spawns through this CLI.',
        setupCommand: 'claude -p "hello"',
      }, telemetryPolicy);
    }

    case 'cli:codex': {
      const resolution = resolveCliBinary('codex', { envOverride: 'PD_CLI_CODEX_BIN' });
      if (!resolution.found) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: cliMissingSummary('Codex CLI', resolution),
          nextStep: 'Install the Codex CLI and authenticate before using this backend.',
          setupCommand: 'codex --help',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        launchableUnverified: true,
        summary: cliSummary('Codex CLI', resolution, 'auth cannot be verified non-interactively'),
        nextStep: 'Run `codex exec "hello"` once to confirm auth. PD_USE_CLI_BACKEND=codex forces all spawns through this CLI.',
        setupCommand: 'codex exec "hello"',
      }, telemetryPolicy);
    }

    case 'cli:agy': {
      const resolution = resolveCliBinary('agy', { envOverride: 'PD_CLI_AGY_BIN' });
      if (!resolution.found) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: cliMissingSummary('Antigravity agy CLI', resolution),
          nextStep: 'Install the agy CLI and authenticate before using this backend.',
          setupCommand: 'agy --help',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        launchableUnverified: true,
        summary: cliSummary('Antigravity agy CLI', resolution, 'auth cannot be verified non-interactively'),
        nextStep: 'Run `agy --print "hello"` once to confirm auth. PD_USE_CLI_BACKEND=agy forces all spawns through this CLI.',
        setupCommand: 'agy --print "hello"',
      }, telemetryPolicy);
    }

    case 'cli:gemini': {
      const resolution = resolveCliBinary('gemini', { envOverride: 'PD_CLI_GEMINI_BIN' });
      if (!resolution.found) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: cliMissingSummary('Gemini CLI', resolution),
          nextStep: 'Install the Gemini CLI (npm install -g @google/gemini-cli) and run `gemini` once to authenticate.',
          setupCommand: 'npm install -g @google/gemini-cli',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        launchableUnverified: true,
        summary: cliSummary('Gemini CLI', resolution, 'auth cannot be verified non-interactively'),
        nextStep: 'Run `gemini -p "hello"` once to confirm auth. PD_USE_CLI_BACKEND=gemini forces all spawns through this CLI.',
        setupCommand: 'gemini -p "hello"',
      }, telemetryPolicy);
    }

    case 'cli:groq': {
      const resolution = resolveCliBinary('groq', { envOverride: 'PD_CLI_GROQ_BIN' });
      if (!resolution.found) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: cliMissingSummary('Groq CLI', resolution),
          nextStep: 'Install the Groq Code CLI (npm install -g groq-code-cli) and run `groq` once to authenticate.',
          setupCommand: 'npm install -g groq-code-cli',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        launchableUnverified: true,
        summary: cliSummary('Groq CLI', resolution, 'auth cannot be verified non-interactively'),
        nextStep: 'Run `groq -p "hello"` once to confirm auth. PD_USE_CLI_BACKEND=groq forces all spawns through this CLI.',
        setupCommand: 'groq -p "hello"',
      }, telemetryPolicy);
    }

    case 'cli:grok': {
      const resolution = resolveCliBinary('grok', { envOverride: 'PD_CLI_GROK_BIN' });
      if (!resolution.found) {
        return applyTelemetryPolicy({
          backend,
          status: 'needs_setup',
          summary: cliMissingSummary('Grok CLI', resolution),
          nextStep: 'Install the Grok CLI (npm install -g @vibe-kit/grok-cli) and authenticate before using this backend.',
          setupCommand: 'npm install -g @vibe-kit/grok-cli',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'manual_check',
        launchableUnverified: true,
        summary: cliSummary('Grok CLI', resolution, 'auth cannot be verified non-interactively'),
        nextStep: 'Run `grok -p "hello"` once to confirm auth. PD_USE_CLI_BACKEND=grok forces all spawns through this CLI.',
        setupCommand: 'grok -p "hello"',
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

    case 'lmstudio': {
      // LM Studio runs an OpenAI-compatible local server; GET /v1/models lists
      // the loaded model. Reachable → ready (and we surface the loaded id);
      // unreachable → needs_setup with the "Start Server" next step. The server
      // is OFF by default, so the graceful-down path is the common case.
      const loaded = await lmStudioLoadedModel();
      if (loaded !== null) {
        return applyTelemetryPolicy({
          backend,
          status: 'ready',
          summary: loaded
            ? `LM Studio server reachable at ${LMSTUDIO_API_BASE}; loaded model: ${loaded}`
            : `LM Studio server reachable at ${LMSTUDIO_API_BASE}, but no model is loaded`,
          nextStep: loaded
            ? undefined
            : 'Load a model in LM Studio (e.g. Qwen 3 Next Coder) so spawns have a model to serve.',
        }, telemetryPolicy);
      }
      return applyTelemetryPolicy({
        backend,
        status: 'needs_setup',
        summary: `LM Studio server not reachable at ${LMSTUDIO_API_BASE}`,
        nextStep: 'Start the LM Studio local server (Developer → Start Server) and load a model.',
        setupCommand: 'open -a "LM Studio"',
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
