import { hasExactModelRate } from './cost-tracker.js';
import { resolveModel } from './model-registry.js';

export interface BackendTelemetryPolicy {
  backend: string;
  launchAllowed: boolean;
  summary: string;
  nextStep?: string;
  effectiveModel?: string | null;
}

// Operator-default models are the registry's `cheap` tier per backend — resolved
// at load time, NOT hardcoded. Change the IDs in lib/model-registry-data.ts; the
// names below stay stable for back-compat with importers.
export const DEFAULT_OPERATOR_CLAUDE_MODEL = resolveModel({ backend: 'claude', capability: 'cheap' });
export const DEFAULT_OPERATOR_CODEX_MODEL = resolveModel({ backend: 'codex', capability: 'cheap' });
export const DEFAULT_OPERATOR_CLOUDFLARE_MODEL = resolveModel({ backend: 'cloudflare', capability: 'cheap' });
export const DEFAULT_OPERATOR_OPENAI_MODEL = resolveModel({ backend: 'openai', capability: 'cheap' });
export const DEFAULT_OPERATOR_GEMINI_MODEL = resolveModel({ backend: 'gemini', capability: 'cheap' });
export const DEFAULT_OPERATOR_GROQ_MODEL = resolveModel({ backend: 'groq', capability: 'cheap' });
export const DEFAULT_OPERATOR_DEEPSEEK_MODEL = resolveModel({ backend: 'deepseek', capability: 'cheap' });
export const DEFAULT_OPERATOR_XAI_MODEL = resolveModel({ backend: 'xai', capability: 'cheap' });

function blocked(backend: string, summary: string, nextStep?: string): BackendTelemetryPolicy {
  return {
    backend,
    launchAllowed: false,
    summary,
    nextStep,
    effectiveModel: null,
  };
}

export function assessBackendTelemetryPolicy(backend: string, model?: string | null): BackendTelemetryPolicy {
  switch (backend) {
    case 'claude': {
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_CLAUDE_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return blocked(
          backend,
          `Claude model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
          'Add an exact model rate before enabling this model.'
        );
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for Claude model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'claude-cli': {
      // The Claude CLI reports its OWN usage when invoked with
      // `--output-format json` (input/output token counts + total_cost_usd),
      // which runClaudeCli now captures (lib/spawner.ts). When that usage is
      // present the record is exact; when it is missing we fall back to a
      // clearly-labelled best-guess estimate (rateMode 'estimated') instead of
      // fail-closing the launch. Either way the launch requires a known cost
      // rate for the model, same as the `claude` SDK backend.
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_CLAUDE_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return {
          ...blocked(
            backend,
            `Claude CLI model "${effectiveModel}" has no cost rate entry; cannot price the launch.`,
            'Add a rate for this model to cost-tracker MODEL_RATES before enabling it.'
          ),
          effectiveModel,
        };
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Telemetry policy satisfied for Claude CLI model "${effectiveModel}" (CLI-reported usage, estimated fallback)`,
        effectiveModel,
      };
    }

    case 'codex': {
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_CODEX_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return blocked(
          backend,
          `Codex model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
          'Add an exact model rate before enabling this model.'
        );
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for Codex model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'cloudflare': {
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_CLOUDFLARE_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return blocked(
          backend,
          `Cloudflare Workers AI model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
          'Add an exact model rate before enabling this model.'
        );
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for Cloudflare model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'openai': {
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_OPENAI_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return blocked(
          backend,
          `OpenAI model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
          'Add an exact model rate before enabling this model.'
        );
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for OpenAI model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'gemini': {
      // Gemini REST generateContent returns usageMetadata.promptTokenCount +
      // candidatesTokenCount (+ thoughtsTokenCount for 2.5 thinking models),
      // which lib/llm-call.ts geminiAdapter extracts exactly. The spawner
      // enforces the full pipeline; this gate flips on the model having a
      // known rate in cost-tracker MODEL_RATES.
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_GEMINI_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return blocked(
          backend,
          `Gemini model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
          'Add an exact model rate before enabling this model.'
        );
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for Gemini model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'groq': {
      // Groq's OpenAI-compatible API returns usage.prompt_tokens +
      // completion_tokens, extracted by the shared OpenAI adapter the Groq
      // backend delegates to. Gate flips on a known rate in MODEL_RATES.
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_GROQ_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return blocked(
          backend,
          `Groq model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
          'Add an exact model rate before enabling this model.'
        );
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for Groq model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'deepseek': {
      // DeepSeek's OpenAI-compatible API returns usage.prompt_tokens +
      // completion_tokens, extracted by the shared OpenAI adapter the DeepSeek
      // backend delegates to. Gate flips on a known rate in MODEL_RATES.
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_DEEPSEEK_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return blocked(
          backend,
          `DeepSeek model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
          'Add an exact model rate before enabling this model.'
        );
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for DeepSeek model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'xai': {
      // xAI's OpenAI-compatible API returns usage.prompt_tokens +
      // completion_tokens, extracted by the shared OpenAI adapter the xAI
      // backend delegates to. Gate flips on a known rate in MODEL_RATES.
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_XAI_MODEL;
      if (!hasExactModelRate(effectiveModel)) {
        return blocked(
          backend,
          `xAI model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
          'Add an exact model rate before enabling this model.'
        );
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for xAI model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'cli:claude-code':
    case 'cli:codex':
    case 'cli:agy':
    case 'cli:gemini':
    case 'cli:groq':
    case 'cli:grok': {
      // CLI-tube backends route through the operator's local agent CLI.
      // Auth + billing live in that CLI; this app
      // doesn't see per-token cost. We mark these as flat-rate
      // "subscription" backends — launch is allowed under the
      // assumption the operator pays for Claude Max / ChatGPT Pro.
      // Operators MUST still set a daily project budget; the kill-switch
      // monitors call count and per-spawn timeouts.
      const suppliedModel = model?.trim();
      const effectiveModel = suppliedModel || (backend === 'cli:agy' ? null : backend.slice('cli:'.length));
      return {
        backend,
        launchAllowed: true,
        summary: `CLI-tube backend "${backend}" — flat-rate via local CLI subscription. No per-token telemetry available; cost recorded as flat session estimate.`,
        effectiveModel,
      };
    }

    case 'ollama': {
      // Ollama's HTTP /api/chat returns exact prompt_eval_count + eval_count
      // (see lib/llm-call.ts ollamaAdapter:148-149). The spawner enforces the
      // full pipeline end-to-end (lib/spawner.ts:1005-1052) including the
      // costUsd > 0 check, so the policy gate flips on the model having a
      // known rate in cost-tracker MODEL_RATES.
      const effectiveModel = model?.trim() || '';
      if (!effectiveModel) {
        return blocked(
          backend,
          'Ollama model is required; pass --model to anchor an exact rate.',
          `Re-run with --model <name>, e.g. --model ${resolveModel({ backend: 'ollama', capability: 'cheap' })}.`
        );
      }
      if (!hasExactModelRate(effectiveModel, 'ollama')) {
        return {
          ...blocked(
            backend,
            `Ollama model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
            'Add a rate for this model family to cost-tracker OLLAMA_MODEL_RATES before enabling it.'
          ),
          effectiveModel,
        };
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for Ollama model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'lmstudio': {
      // LM Studio's OpenAI-compatible local server returns exact
      // usage.{prompt_tokens,completion_tokens} on every completion (see
      // lib/spawner/backends/openai.ts), so the exact telemetry path applies
      // just like Ollama. It serves whatever model is loaded in the app, so
      // the id is operator-chosen and unbounded; cost-tracker's lmstudio
      // catch-all electricity-proxy rate prices any id at the local floor.
      // The model id may be the conventional 'local-model' placeholder, which
      // is fine — the catch-all rate matches it.
      const effectiveModel = model?.trim() || 'local-model';
      if (!hasExactModelRate(effectiveModel, 'lmstudio')) {
        return {
          ...blocked(
            backend,
            `LM Studio model "${effectiveModel}" has no exact cost rate entry; fail-closed telemetry policy blocks launch.`,
            'Add a rate for LM Studio to cost-tracker LMSTUDIO_MODEL_RATES before enabling it.'
          ),
          effectiveModel,
        };
      }
      return {
        backend,
        launchAllowed: true,
        summary: `Exact telemetry policy satisfied for LM Studio model "${effectiveModel}"`,
        effectiveModel,
      };
    }

    case 'custom':
      return blocked(
        backend,
        'Custom backend is blocked until Port Daddy can prove exact token counts and a nonzero cost rate for every launch.',
        'Do not re-enable custom backends until their telemetry pipeline is explicit and test-covered.'
      );

    default:
      return blocked(
        backend,
        `${backend} is blocked until exact token counts and an exact nonzero cost rate are recorded end-to-end.`,
        'Re-enable this backend only after the runtime, tracker, and tests prove exact spend recording.'
      );
  }
}
