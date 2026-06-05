import { assessBackendReadiness, type BackendReadiness } from './backend-readiness.js';
import { assessBackendTelemetryPolicy } from './backend-telemetry-policy.js';
import type { BudgetStatus, CostTracker } from './cost-tracker.js';
import {
  resolveFleetAgentRuntime,
  type FleetModelTier,
  type FleetRuntimeTarget,
} from './fleet-engine.js';

export const LOCAL_EXECUTION_BACKENDS = new Set(['claude-cli', 'codex', 'ollama', 'aider', 'custom', 'cli:claude-code', 'cli:codex']);

const LOCAL_EXECUTION_NOTE = 'Local CLI backends and Port Daddy socket/IPC operations may need unsandboxed approval in restricted runners.';

export interface SpawnPreflightInput {
  backend?: string | null;
  model?: string | null;
  modelTier?: FleetModelTier;
  fallbacks?: FleetRuntimeTarget[];
  identity?: string | null;
  /**
   * Per-call spend ceiling. Required to be a positive number — the daemon
   * refuses unmetered launches. This is NOT a daily project ceiling and is
   * therefore not compared against accrued 24h project spend; the per-call
   * cap is enforced inside the spawner during execution.
   */
  budgetUsd?: number | null;
  /**
   * Optional daily project ceiling in USD. When provided, the preflight gates
   * launches if the project's 24h accrued spend already exceeds this number.
   * Sortie launches do not set this — daily ceilings come from project wallet
   * / fleet config, not from a per-mission `--budget` flag. Fleet engine and
   * project-wallet-aware callers may pass it.
   */
  dailyBudgetUsd?: number | null;
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
  // The daily-ceiling overage check uses `dailyBudgetUsd`, not the per-call
  // `budgetUsd`. Conflating the two caused project-spend-vs-per-mission-cap
  // false blocks (see docs/operations/sortie-runbook.md "Budget exceeded for
  // <project>"). Callers that want the overage gate must opt in by passing a
  // configured daily ceiling explicitly; everyone else's per-call budget is
  // enforced by the spawner during execution.
  const budget = (
    deps.costTracker
    && projectName
    && typeof input.dailyBudgetUsd === 'number'
    && Number.isFinite(input.dailyBudgetUsd)
  )
    ? deps.costTracker.budgetStatus(projectName, input.dailyBudgetUsd)
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
  const readyAttempts = dedupedAttempts.filter((attempt) => attempt.backend && attempt.readinessStatus === 'ready');

  if (dedupedAttempts.length === 0 || dedupedAttempts.every((attempt) => !attempt.backend)) {
    blockedReasons.push('No backend resolved for this launch.');
  } else if (readyAttempts.length === 0) {
    // Surface each blocked attempt with its actual reason. Manual-check
    // backends are intentionally not enough to power agents; the control plane
    // should only launch runtimes the daemon can prove are setup and ready.
    const detail = dedupedAttempts
      .map((a) => {
        const status = a.readinessStatus || 'unknown';
        const summary = (a.readinessSummary || status).trim();
        const nextStep = a.readinessNextStep ? ` Next: ${a.readinessNextStep.trim()}` : '';
        return `  • ${a.backend}${a.model ? `:${a.model}` : ''} — ${status}: ${summary}${nextStep}`;
      })
      .join('\n');
    blockedReasons.push(
      `No launchable backend (no configured attempt is setup-ready):\n${detail}`,
    );
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
