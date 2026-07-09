/**
 * Spawn forecast — "how many LLM calls per hour, on which models, is this
 * machine armed to make?"
 *
 * Answers the operator question the popover previously couldn't: is the fleet
 * about to make 100 gpt-5.4 calls an hour or 4 gpt-5.3-codex calls? The
 * forecast is built from the SAME primitives the engine actually runs on, so
 * it reflects reality rather than intent:
 *
 *  - Scheduled agents: the engine arms `setInterval(parseCronInterval(cron))`
 *    with NO fire-time cron-match gate (lib/fleet-engine.ts startAgent). That
 *    means a cron the parser can't represent (e.g. weekly `0 8 * * 1`) falls
 *    to the 10-minute default and ACTUALLY fires 6×/hour. The forecast mirrors
 *    that and flags it (`approxSchedule`) instead of pretending the YAML's
 *    intent is what runs.
 *  - Cooldowns damp the effective rate: an agent can't fire faster than
 *    3600000/cooldownMs regardless of its interval.
 *  - Event-triggered agents have no deterministic rate; they are listed with
 *    their triggers and forecast from observed history at the route layer.
 *  - The per-project `max_spawns_per_hour` limit caps the total.
 *  - The forced CLI backend (PD_USE_CLI_BACKEND / ~/.port-daddy-cli-backend)
 *    reroutes EVERY spawn, so the effective backend/model per agent is
 *    computed with the same placeholder rules as the cli-tube launcher.
 */

import { resolveFleetAgentRuntime, parseCronInterval, type FleetConfig, type FleetAgent } from './fleet-engine.js';
import { resolveModel } from './model-registry.js';

// Mirrors ONLY the placeholder-detection half of lib/spawner/backends/cli-tube.ts
// (its PLACEHOLDER_MODELS + CLI_DEFAULT_MODEL substitution): a model equal to a
// backend/CLI name is a placeholder the CLIs reject, so the launcher drops
// --model and the CLI's authenticated account default runs. This module is
// NOT a full mirror of cli-tube's resolution — for a real (non-placeholder)
// model it defers to `resolveModel` from model-registry below, which pins its
// own Claude/Codex defaults independently of cli-tube. Readers should not
// assume this file tracks cli-tube byte-for-byte outside the placeholder case.
const PLACEHOLDER_MODELS = new Set([
  'claude-code', 'codex', 'agy', 'gemini', 'groq', 'grok',
  'claude-cli', 'codex-cli', 'agy-cli', 'agy-default', 'cli',
]);

const CLI_ACCOUNT_DEFAULT = 'CLI account default';

export interface AgentSpawnForecast {
  agent: string;
  kind: 'scheduled' | 'event' | 'manual';
  /** Raw cron string from pd-fleet.yml, when scheduled. */
  schedule?: string;
  /**
   * True when the cron pattern is NOT representable by the engine's
   * interval parser — the agent really fires at the 10-minute default,
   * not at the cadence the YAML implies.
   */
  approxSchedule?: boolean;
  /** Channel/registry triggers, when event-driven. */
  triggers?: string[];
  /** Deterministic spawns/hour (scheduled agents only; cooldown-damped). */
  perHour: number | null;
  /** Backend declared/resolved from the agent config. */
  configuredBackend: string | null;
  /** Backend after the forced-CLI override is applied. */
  effectiveBackend: string | null;
  /** Model that will be passed to the launcher (or the CLI account default). */
  model: string;
  /**
   * True when a forced CLI override reroutes an agent whose resolved model
   * belongs to a DIFFERENT provider — the launch passes that model id to the
   * CLI verbatim, which may reject it.
   */
  modelMismatchRisk?: boolean;
}

export interface ProjectSpawnForecast {
  project: string;
  projectDir: string;
  running: boolean;
  maxSpawnsPerHour: number | null;
  /** Sum of scheduled agents' rates before the project cap. */
  scheduledPerHourRaw: number;
  /** Scheduled rate after the project's max_spawns_per_hour cap. */
  scheduledPerHour: number;
  agents: AgentSpawnForecast[];
  eventAgentCount: number;
  watcherCount: number;
}

export interface SpawnForecastTotals {
  /** Cap-adjusted deterministic spawns/hour across all running fleets. */
  scheduledPerHour: number;
  /** Same total, grouped by effective (backend, model). */
  byModel: Array<{ backend: string; model: string; perHour: number }>;
}

export interface SpawnForecast {
  generatedAt: string;
  forcedCliBackend: string | null;
  projects: ProjectSpawnForecast[];
  totals: SpawnForecastTotals;
}

export interface ForecastInputFleet {
  project: string;
  projectDir: string;
  running: boolean;
  config: FleetConfig;
}

/** Spawns/hour implied by a cron schedule, as the ENGINE runs it. */
export function cronPerHour(cron: string): number {
  const intervalMs = parseCronInterval(cron);
  return +(3_600_000 / intervalMs).toFixed(2);
}

// True when the engine's interval parser actually understands this cron —
// `*/N * * * *`, `0 */N * * *`, or top-of-hour `0 * * * *`. Anything else
// silently becomes the 10-minute default interval.
export function cronIsRepresentable(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [minute, hour] = parts;
  if (minute.startsWith('*/')) {
    const n = parseInt(minute.slice(2), 10);
    return !isNaN(n) && n > 0;
  }
  if (hour.startsWith('*/')) {
    const n = parseInt(hour.slice(2), 10);
    return !isNaN(n) && n > 0;
  }
  return minute === '0' && hour === '*';
}

interface EffectiveRuntime {
  configuredBackend: string | null;
  effectiveBackend: string | null;
  model: string;
  modelMismatchRisk: boolean;
}

/** Providers whose model ids a given CLI accepts (prefix heuristics). */
function modelBelongsToCli(model: string, cli: string): boolean {
  const m = model.toLowerCase();
  if (cli === 'cli:codex') return m.startsWith('gpt') || m.includes('codex') || m.startsWith('o');
  if (cli === 'cli:claude-code') return m.startsWith('claude') || ['sonnet', 'opus', 'haiku'].includes(m);
  if (cli === 'cli:agy') return true; // agy owns its model names/account default.
  if (cli === 'cli:gemini') return m.startsWith('gemini');
  if (cli === 'cli:groq' || cli === 'cli:grok') return true; // routers accept many ids
  return true;
}

function resolveEffectiveRuntime(agent: FleetAgent, forcedCliBackend: string | null): EffectiveRuntime {
  const runtime = resolveFleetAgentRuntime(agent);
  const configuredBackend = runtime.backend;
  const effectiveBackend = forcedCliBackend ?? configuredBackend;

  let model = runtime.model ?? null;
  let modelMismatchRisk = false;

  const isPlaceholder = !model || PLACEHOLDER_MODELS.has(model);
  if (isPlaceholder) {
    // Same substitution ladder as the launcher: a known-good per-CLI default
    // where one exists, otherwise the CLI's own account default.
    if (effectiveBackend === 'cli:claude-code' || effectiveBackend === 'claude-cli') {
      model = resolveModel({ backend: 'claude-cli', capability: 'cheap' });
    } else if (effectiveBackend === 'cli:codex' || effectiveBackend === 'codex') {
      model = resolveModel({ backend: 'codex', capability: 'cheap' });
    } else {
      model = null;
    }
  } else if (forcedCliBackend && model && !modelBelongsToCli(model, forcedCliBackend)) {
    // A real (non-placeholder) model resolved for the ORIGINAL backend is
    // passed verbatim to the forced CLI — cross-provider ids may be rejected.
    modelMismatchRisk = true;
  }

  return {
    configuredBackend,
    effectiveBackend,
    model: model ?? CLI_ACCOUNT_DEFAULT,
    modelMismatchRisk,
  };
}

function agentKind(agent: FleetAgent): AgentSpawnForecast['kind'] {
  if (agent.schedule) return 'scheduled';
  if (agent.trigger || (agent.triggers && agent.triggers.length > 0)) return 'event';
  return 'manual';
}

export function computeSpawnForecast(
  fleets: ForecastInputFleet[],
  opts: { forcedCliBackend: string | null; now?: Date },
): SpawnForecast {
  const projects: ProjectSpawnForecast[] = [];
  const byModelTotals = new Map<string, { backend: string; model: string; perHour: number }>();
  let totalScheduled = 0;

  for (const fleet of fleets) {
    const agents: AgentSpawnForecast[] = [];
    let scheduledRaw = 0;

    for (const agent of fleet.config.agents) {
      const kind = agentKind(agent);
      const runtime = resolveEffectiveRuntime(agent, opts.forcedCliBackend);

      let perHour: number | null = null;
      let approxSchedule: boolean | undefined;
      if (kind === 'scheduled' && agent.schedule) {
        perHour = cronPerHour(agent.schedule);
        approxSchedule = !cronIsRepresentable(agent.schedule) || undefined;
        // Cooldown damps the effective rate regardless of the interval.
        if (agent.cooldownMs && agent.cooldownMs > 0) {
          perHour = Math.min(perHour, +(3_600_000 / agent.cooldownMs).toFixed(2));
        }
        scheduledRaw += perHour;
      }

      const entry: AgentSpawnForecast = {
        agent: agent.name,
        kind,
        perHour,
        configuredBackend: runtime.configuredBackend,
        effectiveBackend: runtime.effectiveBackend,
        model: runtime.model,
      };
      if (agent.schedule) entry.schedule = agent.schedule;
      if (approxSchedule) entry.approxSchedule = true;
      if (kind === 'event') {
        entry.triggers = agent.triggers ?? (agent.trigger ? [agent.trigger] : []);
      }
      if (runtime.modelMismatchRisk) entry.modelMismatchRisk = true;
      agents.push(entry);
    }

    const cap = fleet.config.limits?.maxSpawnsPerHour ?? null;
    const scheduledCapped = cap !== null ? Math.min(scheduledRaw, cap) : scheduledRaw;
    // Only RUNNING fleets contribute to the machine-wide totals — a stopped
    // fleet's schedule is a plan, not a rate.
    if (fleet.running) {
      totalScheduled += scheduledCapped;
      // Attribute the capped total proportionally across scheduled agents so
      // the by-model split still sums to the capped rate.
      const scale = scheduledRaw > 0 ? scheduledCapped / scheduledRaw : 0;
      for (const a of agents) {
        if (a.perHour === null) continue;
        const key = `${a.effectiveBackend ?? '(none)'}::${a.model}`;
        const existing = byModelTotals.get(key) ?? {
          backend: a.effectiveBackend ?? '(none)',
          model: a.model,
          perHour: 0,
        };
        existing.perHour = +(existing.perHour + a.perHour * scale).toFixed(2);
        byModelTotals.set(key, existing);
      }
    }

    projects.push({
      project: fleet.project,
      projectDir: fleet.projectDir,
      running: fleet.running,
      maxSpawnsPerHour: cap,
      scheduledPerHourRaw: +scheduledRaw.toFixed(2),
      scheduledPerHour: +scheduledCapped.toFixed(2),
      agents,
      eventAgentCount: agents.filter((a) => a.kind === 'event').length,
      watcherCount: fleet.config.watchers.length,
    });
  }

  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    forcedCliBackend: opts.forcedCliBackend,
    projects,
    totals: {
      scheduledPerHour: +totalScheduled.toFixed(2),
      byModel: [...byModelTotals.values()].sort((a, b) => b.perHour - a.perHour),
    },
  };
}
