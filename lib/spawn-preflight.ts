import { assessBackendReadiness, type BackendReadiness } from './backend-readiness.js';
import { assessBackendTelemetryPolicy } from './backend-telemetry-policy.js';
import type { BudgetStatus, CostTracker } from './cost-tracker.js';
import {
  resolveFleetAgentRuntime,
  type FleetModelTier,
  type FleetRuntimeTarget,
} from './fleet-engine.js';

export const LOCAL_EXECUTION_BACKENDS = new Set(['claude-cli', 'codex', 'ollama', 'aider', 'custom']);

const LOCAL_EXECUTION_NOTE = 'Local CLI backends and Port Daddy socket/IPC operations may need unsandboxed approval in restricted runners.';

export interface SpawnPreflightInput {
  backend?: string | null;
  model?: string | null;
  modelTier?: FleetModelTier;
  fallbacks?: FleetRuntimeTarget[];
  identity?: string | null;
  budgetUsd?: number | null;
}

export interface SpawnPreflightAttempt {
  attempt: number;
  backend: string | null;
  model: string | null;
  modelTier: FleetModelTier | null;
  backendSource: 'agent' | 'env' | 'missing';
  modelSource: 'agent' | 'tier' | 'env' | 'unset';
  warnings: string[];
  readinessStatus: BackendReadiness['status'];
  readinessSummary: string;
  readinessNextStep?: string;
}

export interface SpawnPreflightResult {
  launchReady: boolean;
  blockedReasons: string[];
  warnings: string[];
  attempts: SpawnPreflightAttempt[];
  projectName: string | null;
  budget: BudgetStatus | null;
  localExecutionLikely: boolean;
  localExecutionNote?: string;
}

function inferProjectName(identity?: string | null): string | null {
  if (!identity) return null;
  const [projectName] = identity.split(':');
  return projectName?.trim() || null;
}

function mergeRuntimeTarget(base: FleetRuntimeTarget, fallback?: FleetRuntimeTarget): FleetRuntimeTarget {
  const fallbackBackend = fallback?.backend?.trim();
  const baseBackend = base.backend?.trim();
  const sameBackend = !fallbackBackend || fallbackBackend === baseBackend;
  return {
    backend: fallbackBackend || baseBackend,
    model: fallback?.model?.trim() || (sameBackend ? base.model?.trim() : undefined),
    modelTier: fallback?.modelTier || (sameBackend ? base.modelTier : undefined),
  };
}

function buildAttemptTargets(input: SpawnPreflightInput): FleetRuntimeTarget[] {
  const primary: FleetRuntimeTarget = {
    backend: input.backend?.trim(),
    model: input.model?.trim(),
    modelTier: input.modelTier,
  };

  const targets = [primary];
  for (const fallback of input.fallbacks || []) {
    targets.push(mergeRuntimeTarget(primary, fallback));
  }

  return targets;
}

function dedupeAttempts(attempts: SpawnPreflightAttempt[]): SpawnPreflightAttempt[] {
  const seen = new Set<string>();
  const deduped: SpawnPreflightAttempt[] = [];

  for (const attempt of attempts) {
    const key = [
      attempt.backend || '__missing__',
      attempt.model || '__default__',
      attempt.modelTier || '__unset__',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...attempt, attempt: deduped.length + 1 });
  }

  return deduped;
}

function uniqueWarnings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function assessSpawnPreflight(
  input: SpawnPreflightInput,
  deps: { costTracker?: CostTracker } = {},
): Promise<SpawnPreflightResult> {
  const attempts = await Promise.all(
    buildAttemptTargets(input).map(async (target, index): Promise<SpawnPreflightAttempt> => {
      const runtime = resolveFleetAgentRuntime(target);
      const telemetryPolicy = runtime.backend
        ? assessBackendTelemetryPolicy(runtime.backend, runtime.model ?? null)
        : null;
      const readiness = runtime.backend
        ? await assessBackendReadiness(runtime.backend, { model: telemetryPolicy?.effectiveModel ?? runtime.model ?? null })
        : {
            backend: 'missing',
            status: 'needs_setup' as const,
            summary: 'No backend resolved',
            nextStep: 'Set --backend, or export PD_FLEET_DEFAULT_BACKEND / PORT_DADDY_FLEET_DEFAULT_BACKEND.',
          };

      return {
        attempt: index + 1,
        backend: runtime.backend,
        model: runtime.model ?? telemetryPolicy?.effectiveModel ?? null,
        modelTier: runtime.modelTier ?? null,
        backendSource: runtime.backendSource,
        modelSource: runtime.modelSource,
        warnings: runtime.warnings,
        readinessStatus: readiness.status,
        readinessSummary: readiness.summary,
        readinessNextStep: readiness.nextStep,
      };
    })
  );

  const dedupedAttempts = dedupeAttempts(attempts);
  const projectName = inferProjectName(input.identity);
  const budget = (
    deps.costTracker
    && projectName
    && typeof input.budgetUsd === 'number'
    && Number.isFinite(input.budgetUsd)
  )
    ? deps.costTracker.budgetStatus(projectName, input.budgetUsd)
    : null;

  const blockedReasons: string[] = [];
  if (!deps.costTracker) {
    blockedReasons.push('Cost tracker unavailable; refusing unmetered agent launch.');
  }
  if (input.budgetUsd == null || !Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) {
    blockedReasons.push('A positive budget ceiling is required for every agentic launch.');
  }
  if (!projectName) {
    blockedReasons.push('Semantic identity is required so spend can be attributed to a project budget.');
  }
  if (dedupedAttempts.length === 0 || dedupedAttempts.every((attempt) => !attempt.backend)) {
    blockedReasons.push('No backend resolved for this launch.');
  } else if (dedupedAttempts.every((attempt) => attempt.readinessStatus === 'needs_setup')) {
    blockedReasons.push('Every configured runtime attempt still needs setup.');
  }

  if (budget?.overBudget) {
    blockedReasons.push(`Budget exceeded for ${budget.project} ($${budget.spentUsd.toFixed(2)} / $${budget.budgetUsdPerDay.toFixed(2)}).`);
  }

  const warnings = uniqueWarnings([
    ...dedupedAttempts.flatMap((attempt) => attempt.warnings),
  ]);

  const localExecutionLikely = dedupedAttempts.some((attempt) => attempt.backend && LOCAL_EXECUTION_BACKENDS.has(attempt.backend));

  return {
    launchReady: blockedReasons.length === 0,
    blockedReasons,
    warnings,
    attempts: dedupedAttempts,
    projectName,
    budget,
    localExecutionLikely,
    localExecutionNote: localExecutionLikely ? LOCAL_EXECUTION_NOTE : undefined,
  };
}
