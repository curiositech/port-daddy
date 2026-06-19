/**
 * Local git trigger source — driven by the post-commit hook installed in
 * the repo, which publishes to the `project:<name>:<hash>:git:committed`
 * channel.
 *
 * This is the original "fleet trigger" — preserved verbatim through the
 * uniform TriggerSource contract so the new shape and the old shape
 * compose. Existing `trigger: git:committed` yml entries route through
 * here.
 */

import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

interface GitCommitEventPayload {
  /** Project basename slug (matches fleet-channels.ts). */
  project: string;
  /** Resolved git:committed channel name. */
  channel: string;
  /** Optional commit SHA passed by the post-commit hook. */
  sha?: string;
  /** Optional list of changed files. */
  files?: string[];
}

export interface GitTriggerSourceDeps {
  /**
   * The fleet engine already owns a messaging subscription primitive.
   * We pass it in (instead of importing it) so this module stays a leaf
   * dependency and is trivially testable with a fake.
   */
  subscribe: (channel: string, callback: (message: unknown) => void) => (() => void) | null;
  /**
   * Resolves the project-scoped channel name (e.g. for `git:committed`
   * we get back `project:port-daddy:<hash>:git:committed`).
   */
  resolveChannel: (channel: string) => string;
}

export class GitTriggerSource implements TriggerSource {
  readonly kind = 'git' as const;

  constructor(private readonly deps: GitTriggerSourceDeps) {}

  async available(): Promise<TriggerAvailability> {
    // Local git is always available — the post-commit hook is wired by
    // pd install. We don't probe for the hook's existence here because
    // the fleet boot path already does that and surfaces it elsewhere.
    return { ready: true };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    // For a `git:committed` spec the channel is literally "git:committed";
    // for future subtypes like `git:tag-pushed` we expand here.
    const channelBase = `git:${spec.type}`;
    const channel = this.deps.resolveChannel(channelBase);

    const unsubscribe = this.deps.subscribe(channel, (raw) => {
      const payload = normalizeCommitPayload(raw, channel);
      const event: FleetTriggerEvent<GitCommitEventPayload> = {
        source: 'git',
        type: spec.type,
        timestamp: Date.now(),
        payload,
        metadata: {
          correlation_id: payload.sha,
          sender: payload.project,
          consent_verified: true, // Local git is the operator by definition.
        },
      };
      emit(event);
    });

    return {
      async stop() {
        if (typeof unsubscribe === 'function') unsubscribe();
      },
    };
  }
}

function normalizeCommitPayload(raw: unknown, channel: string): GitCommitEventPayload {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return {
      project: typeof obj.project === 'string' ? obj.project : 'unknown',
      channel,
      sha: typeof obj.sha === 'string' ? obj.sha : undefined,
      files: Array.isArray(obj.files) ? (obj.files as string[]) : undefined,
    };
  }
  return { project: 'unknown', channel };
}
