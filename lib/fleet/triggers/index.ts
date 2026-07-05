/**
 * Trigger source registry — the single place the fleet engine asks
 * "what trigger sources do we know about?".
 *
 * To add a new source:
 *   1. Implement `TriggerSource` in this directory.
 *   2. Add the kind to `TriggerSourceKind` in `../types.ts`.
 *   3. Wire it here in `buildTriggerRegistry`.
 *
 * Backward compatibility: nothing in the existing fleet pipeline has to
 * call this registry. The new trigger architecture is additive — yml
 * with `trigger: git:committed` still works through the legacy channel
 * subscription path. The registry exists so the next layer of plumbing
 * (a unified "fleet trigger router") can be built against it without
 * coupling to internals of every source.
 */

import {
  type TriggerSource,
  type TriggerSourceKind,
  parseTriggerSpec,
  type TriggerSpec,
} from '../types.js';
import { GitHubTriggerSource, type GitHubTriggerSourceDeps } from './github.js';
import { GitTriggerSource, type GitTriggerSourceDeps } from './git.js';
import { CronTriggerSource, type CronTriggerSourceDeps } from './cron.js';
import { EmailTriggerSource } from './email.js';
import { SmsTriggerSource } from './sms.js';
import { CalendarTriggerSource } from './calendar.js';
import { FileTriggerSource } from './file.js';
import { WebhookTriggerSource, type WebhookTriggerDeps } from './webhook.js';
import { PdTriggerSource, type PdTriggerSourceDeps } from './pd.js';

export type TriggerRegistry = Map<TriggerSourceKind, TriggerSource>;

export interface BuildRegistryDeps {
  /** Channel subscription primitive used by `git` and `pd` sources. */
  channelSubscribe: (channel: string, callback: (message: unknown) => void) => (() => void) | null;
  /** Resolve a channel name to its project-scoped form. */
  resolveChannel: (channel: string) => string;
  /** Cron scheduler primitive used by the schedule source. */
  scheduleCron: (expression: string, fn: () => void) => () => void;
  /** Webhook router registration primitive. */
  registerWebhookHandler: WebhookTriggerDeps['registerHandler'];
}

/**
 * Build a registry of every trigger source we ship. Pass an empty/stub
 * dep for any subsystem the daemon hasn't wired yet — the source will
 * still register but `available()` will reflect the missing dep.
 */
export function buildTriggerRegistry(deps: BuildRegistryDeps): TriggerRegistry {
  const gitDeps: GitTriggerSourceDeps = {
    subscribe: deps.channelSubscribe,
    resolveChannel: deps.resolveChannel,
  };
  const cronDeps: CronTriggerSourceDeps = { scheduleCron: deps.scheduleCron };
  const webhookDeps: WebhookTriggerDeps = { registerHandler: deps.registerWebhookHandler };
  const pdDeps: PdTriggerSourceDeps = { subscribe: deps.channelSubscribe };

  const githubDeps: GitHubTriggerSourceDeps = { subscribe: deps.channelSubscribe };
  const sources: TriggerSource[] = [
    new GitHubTriggerSource(githubDeps),
    new GitTriggerSource(gitDeps),
    new CronTriggerSource(cronDeps),
    // Email shares the webhook receiver primitive for its inbound-webhook
    // delivery mode (Cloudflare Email Routing → Worker → daemon).
    new EmailTriggerSource({}, { registerHandler: deps.registerWebhookHandler }),
    new SmsTriggerSource(),
    new CalendarTriggerSource(),
    new FileTriggerSource(),
    new WebhookTriggerSource(webhookDeps),
    new PdTriggerSource(pdDeps),
  ];

  const registry: TriggerRegistry = new Map();
  for (const source of sources) {
    registry.set(source.kind, source);
  }
  return registry;
}

/**
 * Convenience: resolve a `trigger:` yml string to (source, parsed spec).
 * Returns null if the string is malformed OR refers to an unknown source.
 */
export function resolveTrigger(
  raw: string,
  registry: TriggerRegistry,
): { source: TriggerSource; spec: TriggerSpec } | null {
  const spec = parseTriggerSpec(raw);
  if (!spec) return null;
  const source = registry.get(spec.kind);
  if (!source) return null;
  return { source, spec };
}

export { parseTriggerSpec } from '../types.js';
