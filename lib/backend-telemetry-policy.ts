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
      const effectiveModel = model?.trim() || DEFAULT_OPERATOR_CLAUDE_MODEL;
      return {
        ...blocked(
          backend,
          'Claude CLI is blocked until exact token counts and exact nonzero cost are recorded end-to-end.',
          'Keep Claude CLI disabled for operator launches until subprocess telemetry is exact and test-covered.'
        ),
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

    case 'ollama':
      return blocked(
        backend,
        'Ollama is blocked until Port Daddy can attach exact token counts and a nonzero cost rate to every operation.',
        'Keep Ollama disabled until the telemetry contract explicitly supports nonzero rate accounting for local inference.'
      );

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
