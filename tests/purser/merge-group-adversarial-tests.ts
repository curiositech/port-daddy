import { describe, it, expect } from 'vitest';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { handleGithubWebhook, channelsForWebhook } from '../../src/github-webhook.js';
import type { Env, FleetRunJob } from '../../src/types.js';

const SECRET = 'super-secret-webhook-key';

function sign(secret: string, body: string): string {
  const key = Buffer.from(secret);
  const hmacSig = hmac(sha256, key, Buffer.from(body));
  return `sha256=${hmacSig.toString('hex')}`;
}

function webhookReq(options: { body: string; signature: string; event: string; delivery: string }) {
  return {
    headers: {
      'x-github-event': options.event,
      'x-github-delivery': options.delivery,
      'x-hub-signature-256': options.signature,
    },
    text: async () => options.body,
  };
}

function makeEnv(
  cap: { events: any[]; audits: any[] },
  publishedChannels: string[],
  secret: string | undefined = SECRET,
  enqueued?: FleetRunJob[],
): Env {
  const harborChannel = {
    idFromName: (name: string) => ({ name }),
    get: (_id: { name: string }) => ({ name: 'harbor' }),
    put: () => Promise.resolve(),
  };

  return {
    HARBOR: {
      CHANNELS: harborChannel,
      EVENTS: {
        put: (event: any) => {
          cap.events.push(event);
          return Promise.resolve();
        },
      },
    },
    AUDIT: {
      put: (audit: any) => {
        cap.audits.push(audit);
        return Promise.resolve();
      },
    },
    FLEET_RUNS: {
      send: (job: FleetRunJob) => {
        if (enqueued) enqueued.push(job);
      },
    },
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

describe('merge-group adversarial tests', () => {
  it('handles missing merge_group payload', async () => {
    const cap: { events: any[]; audits: any[] } = { events: [], audits: [] };
    const published: string[] = [];
    const enqueued: FleetRunJob[] = [];
    const env = makeEnv(cap, published, SECRET, enqueued);
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 },
    });

    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sign(SECRET, body), event: 'merge_group', delivery: 'merge-group-1' }),
      env
    );

    expect(res.status).toBe(204);
    expect(published).toEqual([
      'github:webhook:merge_group',
      'github:webhook:merge_group:checks_requested',
      'github:curiositech/port-daddy:merge_group',
    ]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].prNumber).toBeNull();
  });

  it('handles malformed head_ref with no PR number', async () => {
    const cap: { events: any[]; audits: any[] } = { events: [], audits: [] };
    const published: string[] = [];
    const enqueued: FleetRunJob[] = [];
    const env = makeEnv(cap, published, SECRET, enqueued);
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      merge_group: {
        head_sha: 'MERGEGROUPSHA',
        head_ref: 'refs/heads/gh-readonly-queue/main',
      },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 },
    });

    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sign(SECRET, body), event: 'merge_group', delivery: 'merge-group-1' }),
      env
    );

    expect(res.status).toBe(204);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].prNumber).toBeNull();
  });

  it('handles multiple PR numbers in head_ref', async () => {
    const cap: { events: any[]; audits: any[] } = { events: [], audits: [] };
    const published: string[] = [];
    const enqueued: FleetRunJob[] = [];
    const env = makeEnv(cap, published, SECRET, enqueued);
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      merge_group: {
        head_sha: 'MERGEGROUPSHA',
        head_ref: 'refs/heads/gh-readonly-queue/main/pr-5062-base-pr-6789',
      },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 },
    });

    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sign(SECRET, body), event: 'merge_group', delivery: 'merge-group-1' }),
      env
    );

    expect(res.status).toBe(204);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].prNumber).toBe(5062);
  });

  it('handles invalid PR number format', async () => {
    const cap: { events: any[]; audits: any[] } = { events: [], audits: [] };
    const published: string[] = [];
    const enqueued: FleetRunJob[] = [];
    const env = makeEnv(cap, published, SECRET, enqueued);
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      merge_group: {
        head_sha: 'MERGEGROUPSHA',
        head_ref: 'refs/heads/pr-abc-123',
      },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 },
    });

    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sign(SECRET, body), event: 'merge_group', delivery: 'merge-group-1' }),
      env
    );

    expect(res.status).toBe(204);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].prNumber).toBeNull();
  });

  it('handles merge_group as non-object', async () => {
    const cap: { events: any[]; audits: any[] } = { events: [], audits: [] };
    const published: string[] = [];
    const enqueued: FleetRunJob[] = [];
    const env = makeEnv(cap, published, SECRET, enqueued);
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      merge_group: 'not-an-object',
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 },
    });

    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sign(SECRET, body), event: 'merge_group', delivery: 'merge-group-1' }),
      env
    );

    expect(res.status).toBe(204);
    expect(enqueued).toHaveLength(0);
  });

  it('handles missing installation ID', async () => {
    const cap: { events: any[]; audits: any[] } = { events: [], audits: [] };
    const published: string[] = [];
    const enqueued: FleetRunJob[] = [];
    const env = makeEnv(cap, published, SECRET, enqueued);
    const body = JSON.stringify({
      action: 'checks_requested',
      merge_group: {
        head_sha: 'MERGEGROUPSHA',
        head_ref: 'refs/heads/gh-readonly-queue/main/pr-5062-base',
      },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 },
    });

    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sign(SECRET, body), event: 'merge_group', delivery: 'merge-group-1' }),
      env
    );

    expect(res.status).toBe(204);
    expect(enqueued).toHaveLength(0);
  });
});