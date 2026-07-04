/**
 * I/O dispatch bridge — the seam that finally wires the pluggable
 * trigger/output registry (`lib/fleet/triggers/*`, `lib/fleet/outputs/*`)
 * into the fleet engine (`lib/fleet-engine.ts`).
 *
 * Until this module existed the registry was an unwired island: fully
 * typed, partially real, but with zero engine callers. The engine treated
 * `agent.trigger` purely as a coordination-channel name and had no concept
 * of registry-backed output sinks at all.
 *
 * This bridge does three things and nothing else:
 *   1. classify a trigger string as a *registry-kind* trigger (file,
 *      webhook, email, sms, calendar) vs a *legacy-channel* trigger
 *      (pd/git/github coordination channels, schedule/cron) that the engine
 *      already owns. The engine keeps dispatching the legacy ones on its
 *      existing path so nothing double-fires.
 *   2. start a registry trigger honestly: probe `available()` first and
 *      REFUSE (with a typed reason) instead of silently hanging when the
 *      source is not ready (e.g. the email/sms/calendar stubs).
 *   3. dispatch declared agent outputs through the output registry, with
 *      consent gating left inside each sink (sinks already call
 *      `getSharedConsentGate().assertAllowed`).
 *
 * Design note — why a separate module:
 *   fleet-engine.ts is 70k and already imports a long tail of subsystems.
 *   Keeping the registry plumbing here lets it be unit-tested in isolation
 *   (start a real file watcher, write a real file) without standing up the
 *   whole runner, and keeps the engine diff small + reviewable.
 */

import {
  buildTriggerRegistry,
  resolveTrigger,
  type TriggerRegistry,
} from './triggers/index.js';
import {
  buildOutputRegistry,
  resolveOutput,
  type OutputRegistry,
} from './outputs/index.js';
import { getSharedConsentGate } from './consent-gate.js';
import {
  parseTriggerSpec,
  parseOutputTarget,
  type FleetTriggerEvent,
  type OutputPayload,
  type OutputResult,
  type OutputSinkKind,
  type TriggerHandle,
  type TriggerSourceKind,
} from './types.js';

/**
 * Trigger kinds the *registry* owns end-to-end (the engine starts a
 * `TriggerSource` for these). Everything else (`pd`, `git`, `github`,
 * `schedule`) stays on the engine's pre-existing channel/cron path to
 * avoid double-dispatch — those already work and the registry façades for
 * them exist only for the future health-board/designer surfaces.
 *
 * Phase 1 proves `file` end-to-end. `webhook` is registry-owned at the
 * type level but its `start()` is inert until a receiver `registerHandler`
 * dep is injected (Phase 2). `email`/`sms`/`calendar` are registry-owned
 * but `available()` returns `{ready:false}` — they resolve and then refuse.
 */
const REGISTRY_OWNED_TRIGGER_KINDS: ReadonlySet<TriggerSourceKind> = new Set<TriggerSourceKind>([
  'file',
  'webhook',
  'email',
  'sms',
  'calendar',
]);

/** Trigger kinds the legacy engine path keeps owning. */
const LEGACY_TRIGGER_KINDS: ReadonlySet<TriggerSourceKind> = new Set<TriggerSourceKind>([
  'pd',
  'git',
  'github',
  'schedule',
]);

export type TriggerClassification =
  | { kind: 'registry'; sourceKind: TriggerSourceKind; raw: string }
  | { kind: 'legacy-channel'; raw: string };

/**
 * Decide whether a `trigger:` string should be dispatched through the
 * pluggable registry or left to the engine's legacy channel/cron path.
 *
 * Rules:
 *   - Parses as a registry trigger spec AND the kind is registry-owned
 *     → `registry`.
 *   - Parses as a registry spec but the kind is a legacy/coordination kind
 *     (pd/git/github/schedule) → `legacy-channel` (engine owns it).
 *   - Does not parse as a spec at all (e.g. a bare channel name like
 *     `qa:findings` — which actually *does* parse since `qa` is not a known
 *     kind, returning null) → `legacy-channel`.
 */
export function classifyTrigger(raw: string): TriggerClassification {
  const spec = parseTriggerSpec(raw);
  if (spec && REGISTRY_OWNED_TRIGGER_KINDS.has(spec.kind)) {
    return { kind: 'registry', sourceKind: spec.kind, raw };
  }
  return { kind: 'legacy-channel', raw };
}

// ─── Registry build deps ─────────────────────────────────────────────────────

/**
 * Optional dependencies for the trigger registry. Phase-1 sources (`file`,
 * `schedule`) need none of these; the engine injects channel/cron/webhook
 * primitives when it has them. When a dep is absent the corresponding
 * source still *registers* but will report itself unavailable or be a
 * no-op, which is the honest behavior.
 */
export interface IoDispatchDeps {
  channelSubscribe?: (channel: string, callback: (message: unknown) => void) => (() => void) | null;
  resolveChannel?: (channel: string) => string;
  scheduleCron?: (expression: string, fn: () => void) => () => void;
  registerWebhookHandler?: Parameters<typeof buildTriggerRegistry>[0]['registerWebhookHandler'];
  /** Internal pd output sink deps. Defaults throw if the `pd` sink is used
   *  without being configured — file/notify/webhook/github sinks do not
   *  touch these. */
  pd?: Parameters<typeof buildOutputRegistry>[0]['pd'];
}

function noopUnsub(): null {
  return null;
}

function defaultPdDeps(): Parameters<typeof buildOutputRegistry>[0]['pd'] {
  const unconfigured = async (): Promise<never> => {
    throw new Error('pd output sink is not configured in this fleet runner (no daemon hooks injected)');
  };
  return {
    appendNote: unconfigured as never,
    sendToInbox: unconfigured as never,
    publishChannel: unconfigured as never,
  };
}

/**
 * The bridge object the engine holds for the lifetime of a fleet runner.
 * Build it once; reuse its registries for every trigger/output dispatch.
 */
export class IoDispatch {
  private readonly triggerRegistry: TriggerRegistry;
  private readonly outputRegistry: OutputRegistry;

  constructor(deps: IoDispatchDeps = {}) {
    this.triggerRegistry = buildTriggerRegistry({
      channelSubscribe: deps.channelSubscribe ?? noopUnsub,
      resolveChannel: deps.resolveChannel ?? ((c) => c),
      scheduleCron: deps.scheduleCron ?? (() => () => {}),
      registerWebhookHandler:
        deps.registerWebhookHandler ?? (() => () => {}),
    });
    this.outputRegistry = buildOutputRegistry({
      pd: deps.pd ?? defaultPdDeps(),
    });
  }

  /** Expose classification for callers that want to fork before starting. */
  classifyTrigger(raw: string): TriggerClassification {
    return classifyTrigger(raw);
  }

  /**
   * Start a registry-backed trigger. Probes `available()` first; if the
   * source is not ready, returns `{ started:false, reason }` instead of
   * starting (so the engine can log "email:received won't fire — not
   * wired" rather than silently hanging). On success returns the
   * `TriggerHandle` the engine adds to its cleanup list.
   *
   * `onFire` receives the raw FleetTriggerEvent; the engine converts it to
   * a FleetRunContext.
   */
  async startTrigger(
    raw: string,
    onFire: (event: FleetTriggerEvent) => void,
  ): Promise<StartTriggerResult> {
    const resolved = resolveTrigger(raw, this.triggerRegistry);
    if (!resolved) {
      return { started: false, reason: `unknown or malformed trigger: "${raw}"` };
    }
    const { source, spec } = resolved;
    const availability = await source.available();
    if (!availability.ready) {
      return {
        started: false,
        reason:
          availability.reason ??
          `${spec.kind} trigger source is not available`,
        requires: availability.requires,
      };
    }
    try {
      const handle = await source.start(spec, onFire);
      return { started: true, handle, sourceKind: spec.kind };
    } catch (err) {
      return {
        started: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Dispatch a single declared output target. Resolves the target string
   * + agent-supplied payload fields through the registry, probes the
   * sink's `available()`, then dispatches. Consent gating happens inside
   * the sink.
   */
  async dispatchOutput(
    target: string,
    payload: Omit<OutputPayload, 'sink' | 'type'>,
  ): Promise<DispatchOutputResult> {
    const resolved = resolveOutput(target, payload, this.outputRegistry);
    if (!resolved) {
      return { ok: false, target, reason: `unknown or malformed output target: "${target}"` };
    }
    const { sink, payload: full } = resolved;
    const availability = await sink.available();
    if (!availability.ready) {
      return {
        ok: false,
        target,
        sinkKind: full.sink,
        reason: availability.reason ?? `${full.sink} sink is not available`,
        requires: availability.requires,
      };
    }
    try {
      // Consent is ALSO asserted at the bridge for high-PII payloads
      // (ADR-0093 §5.3 defense in depth): a future sink that forgets its own
      // gate must not become a consent bypass for the highest-stakes data.
      // Below `high`, each sink's own pii threshold stays authoritative
      // (e.g. the file sink deliberately gates only pii:high — local file
      // writes of low-pii run summaries need no operator grant). Sinks that
      // ALWAYS require consent (sms/email coerce pii to high internally)
      // keep their stricter internal check.
      if ((full.pii ?? 'high') === 'high') {
        getSharedConsentGate().assertAllowed(full.sink, full);
      }
      const result = await sink.dispatch(full);
      return { ok: true, target, sinkKind: full.sink, result };
    } catch (err) {
      return {
        ok: false,
        target,
        sinkKind: full.sink,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Dispatch every declared output for an agent run. Never throws — each
   * sink failure is captured in its own result so one broken output does
   * not stop the others (or crash the agent). The engine logs the
   * aggregate.
   */
  async dispatchOutputs(
    targets: readonly string[],
    payload: Omit<OutputPayload, 'sink' | 'type'>,
  ): Promise<DispatchOutputResult[]> {
    const results: DispatchOutputResult[] = [];
    for (const target of targets) {
      results.push(await this.dispatchOutput(target, payload));
    }
    return results;
  }
}

export type StartTriggerResult =
  | { started: true; handle: TriggerHandle; sourceKind: TriggerSourceKind }
  | { started: false; reason: string; requires?: string[] };

export type DispatchOutputResult =
  | { ok: true; target: string; sinkKind: OutputSinkKind; result: OutputResult }
  | { ok: false; target: string; sinkKind?: OutputSinkKind; reason: string; requires?: string[] };

/** Re-exports so the engine imports a single module. */
export { parseTriggerSpec, parseOutputTarget };
export { LEGACY_TRIGGER_KINDS, REGISTRY_OWNED_TRIGGER_KINDS };
