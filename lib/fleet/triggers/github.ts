/**
 * GitHub trigger source — webhook-driven events from a GitHub repo.
 *
 * The actual webhook intake lives at POST /webhooks/github in
 * routes/github-webhook.ts. That route verifies the CF Worker bearer token
 * (or GitHub HMAC directly) and publishes the envelope onto
 * `github:webhook:<event>` — this trigger source subscribes to that channel
 * and translates each message into a FleetTriggerEvent.
 *
 * Backward compatibility:
 *   The existing pd-fleet.yml shape uses `trigger: git:committed` which
 *   routes through the local git post-commit hook, not GitHub. Both work
 *   side by side: `github:pull_request` listens for the remote-side
 *   webhook payload; `git:committed` listens for the local-side post-
 *   commit channel. See triggers/git.ts for the latter.
 */

import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

interface GitHubWebhookPayload {
  action?: string;
  pull_request?: { number: number; html_url: string; title: string; user?: { login?: string } };
  issue?: { number: number; html_url: string; title: string; user?: { login?: string } };
  sender?: { login: string };
  repository?: { full_name: string };
}

export interface GitHubTriggerSourceDeps {
  /** Subscribe to a PD messaging channel; returns an unsubscribe fn or null. */
  subscribe: (channel: string, callback: (msg: unknown) => void) => (() => void) | null;
}

export class GitHubTriggerSource implements TriggerSource {
  readonly kind = 'github' as const;

  constructor(private readonly deps?: GitHubTriggerSourceDeps) {}

  async available(): Promise<TriggerAvailability> {
    const hasToken = Boolean(process.env.PD_GITHUB_FORWARD_TOKEN);
    const hasSecret = Boolean(process.env.PD_GITHUB_WEBHOOK_SECRET);
    const allowUnauth = process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH === '1';
    if (!hasToken && !hasSecret && !allowUnauth) {
      return {
        ready: false,
        reason: 'GitHub webhook auth not configured (set PD_GITHUB_FORWARD_TOKEN or PD_GITHUB_WEBHOOK_SECRET).',
        requires: ['PD_GITHUB_FORWARD_TOKEN'],
      };
    }
    return { ready: true };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    const channel = `github:webhook:${spec.type}`;

    const subscribe = this.deps?.subscribe;
    let unsub: (() => void) | null = null;

    if (subscribe) {
      unsub = subscribe(channel, (raw) => {
        const payload = raw as GitHubWebhookPayload;
        const event: FleetTriggerEvent<GitHubWebhookPayload> = {
          source: 'github',
          type: spec.type,
          timestamp: Date.now(),
          payload,
          metadata: {
            correlation_id:
              payload.pull_request?.html_url ??
              payload.issue?.html_url ??
              payload.repository?.full_name,
            sender: payload.sender?.login,
            subject: payload.pull_request?.title ?? payload.issue?.title,
            consent_verified: true,
          },
        };
        emit(event);
      });
    }

    return {
      async stop() {
        unsub?.();
      },
    };
  }
}
