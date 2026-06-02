/**
 * Output sink registry — mirrors `lib/fleet/triggers/index.ts`.
 *
 * To add a new sink:
 *   1. Implement `OutputSink` in this directory.
 *   2. Add the kind to `OutputSinkKind` in `../types.ts`.
 *   3. Wire it here in `buildOutputRegistry`.
 *
 * Every sink that touches PII MUST call through `ConsentGate` first.
 * See lib/fleet/consent-gate.ts.
 */

import {
  parseOutputTarget,
  type OutputPayload,
  type OutputSink,
  type OutputSinkKind,
} from '../types.js';
import { GitHubOutputSink } from './github.js';
import { MacOSNotificationSink } from './notify-macos.js';
import { CalendarOutputSink } from './calendar.js';
import { EmailOutputSink } from './email.js';
import { SmsOutputSink } from './sms.js';
import { WebhookOutputSink } from './webhook.js';
import { FileOutputSink } from './file.js';
import { PdOutputSink, type PdOutputDeps } from './pd.js';

export type OutputRegistry = Map<OutputSinkKind, OutputSink>;

export interface BuildOutputRegistryDeps {
  /** PD internal sink needs in-process daemon hooks (no HTTP round-trip). */
  pd: PdOutputDeps;
}

/**
 * Build a registry of every output sink we ship.
 */
export function buildOutputRegistry(deps: BuildOutputRegistryDeps): OutputRegistry {
  const sinks: OutputSink[] = [
    new GitHubOutputSink(),
    new MacOSNotificationSink(),
    new CalendarOutputSink(),
    new EmailOutputSink(),
    new SmsOutputSink(),
    new WebhookOutputSink(),
    new FileOutputSink(),
    new PdOutputSink(deps.pd),
  ];
  const registry: OutputRegistry = new Map();
  for (const sink of sinks) {
    registry.set(sink.kind, sink);
  }
  return registry;
}

/**
 * Resolve a yml `outputs:` target string + agent-supplied payload fields
 * into a fully populated OutputPayload + the sink that should dispatch it.
 *
 * Returns null when the target string is malformed or refers to an
 * unknown sink. The fleet engine surfaces the null as a config-load
 * error so the operator can fix the yml.
 */
export function resolveOutput(
  raw: string,
  partial: Omit<OutputPayload, 'sink' | 'type'>,
  registry: OutputRegistry,
): { sink: OutputSink; payload: OutputPayload } | null {
  const target = parseOutputTarget(raw);
  if (!target) return null;
  const sink = registry.get(target.sink);
  if (!sink) return null;
  // If the parsed target carried a positional arg (e.g. file path,
  // webhook URL), use it as the recipient unless the agent supplied one.
  const recipient = partial.recipient ?? target.arg;
  const payload: OutputPayload = {
    ...partial,
    sink: target.sink,
    type: target.type,
    recipient,
  };
  return { sink, payload };
}

export { parseOutputTarget } from '../types.js';
