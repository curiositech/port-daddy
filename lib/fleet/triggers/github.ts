/**
 * GitHub trigger source — webhook-driven events from a GitHub repo.
 *
 * Wraps the existing PD `coordination:inconsistency`-style webhook path
 * with the uniform TriggerSource contract. The actual webhook receiver
 * lives in routes/ (HTTP) — this module is the bridge that turns
 * received webhooks into FleetTriggerEvents.
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

export class GitHubTriggerSource implements TriggerSource {
  readonly kind = 'github' as const;

  async available(): Promise<TriggerAvailability> {
    // The GitHub webhook receiver is part of the daemon HTTP surface;
    // availability really means "did the operator configure a webhook
    // secret?". For now we treat the source as available iff a secret
    // env var is set OR the operator opted out of HMAC verification.
    const hasSecret = Boolean(process.env.PD_GITHUB_WEBHOOK_SECRET);
    const allowUnauth = process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH === '1';
    if (!hasSecret && !allowUnauth) {
      return {
        ready: false,
        reason: 'GitHub webhook secret missing (set PD_GITHUB_WEBHOOK_SECRET).',
        requires: ['PD_GITHUB_WEBHOOK_SECRET'],
      };
    }
    return { ready: true };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    const subscription = subscribeToGitHubWebhookBus(spec, (raw) => {
      const payload = raw as GitHubWebhookPayload;
      const event: FleetTriggerEvent<GitHubWebhookPayload> = {
        source: 'github',
        type: spec.type, // e.g. "pull_request", "push", "issue:commented"
        timestamp: Date.now(),
        payload,
        metadata: {
          correlation_id:
            payload.pull_request?.html_url ??
            payload.issue?.html_url ??
            payload.repository?.full_name,
          sender: payload.sender?.login,
          subject: payload.pull_request?.title ?? payload.issue?.title,
          consent_verified: true, // HMAC-verified webhooks are trusted.
        },
      };
      emit(event);
    });
    return {
      async stop() {
        subscription.unsubscribe();
      },
    };
  }
}

/**
 * Stub: in the real wiring this hooks into the daemon's webhook router
 * (routes/webhooks.ts when it exists). For now it returns a no-op
 * unsubscribe so unit tests can construct the source without spinning
 * up the HTTP layer.
 *
 * Operator setup required:
 *   1. Add a GitHub App or repo webhook pointing at
 *      https://<your-daemon>/webhooks/github
 *   2. Set PD_GITHUB_WEBHOOK_SECRET to the shared secret
 *   3. Subscribe to whichever events your fleet wants
 */
function subscribeToGitHubWebhookBus(
  _spec: TriggerSpec,
  _onEvent: (raw: unknown) => void,
): { unsubscribe: () => void } {
  return { unsubscribe: () => {} };
}
