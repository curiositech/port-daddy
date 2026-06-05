import { hasExactModelRate } from './cost-tracker.js';

export interface BackendTelemetryPolicy {
  backend: string;
  launchAllowed: boolean;
  summary: string;
  nextStep?: string;
  effectiveModel?: string | null;
}

export const DEFAULT_OPERATOR_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_OPERATOR_CODEX_MODEL = 'gpt-5.4-mini';
export const DEFAULT_OPERATOR_CLOUDFLARE_MODEL = '@cf/zai-org/glm-4.7-flash';
export const DEFAULT_OPERATOR_OPENAI_MODEL = 'gpt-5-mini';
export const DEFAULT_OPERATOR_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_OPERATOR_GROQ_MODEL = 'llama-3.3-70b-versatile';

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

    case 'cli:claude-code':
    case 'cli:codex': {
      // CLI-tube backends route through the operator's local Claude
      // Code / Codex CLI. Auth + billing live in that CLI; this app
      // doesn't see per-token cost. We mark these as flat-rate
      // "subscription" backends — launch is allowed under the
      // assumption the operator pays for Claude Max / ChatGPT Pro.
      // Operators MUST still set a daily project budget; the kill-switch
      // monitors call count and per-spawn timeouts.
      const effectiveModel = model?.trim() || (backend === 'cli:claude-code' ? 'claude-code' : 'codex');
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
          'Re-run with --model <name>, e.g. --model qwen2.5-coder:7b.'
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
