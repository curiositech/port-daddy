/**
 * Tests for handleGithubWebhook — the GitHub webhook ingress gate.
 *
 * GitHub is not a card-holder; the HMAC-SHA256 signature over the RAW request
 * body is the SOLE authentication gate. These tests pin that gate end-to-end:
 *   - a REAL, correctly-computed signature → 204 + fan-out to the spec channels
 *   - a wrong signature → 401 (and NOTHING is published)
 *   - a missing signature → 401
 *   - a non-POST method → 405
 *   - a malformed body (valid sig over garbage bytes) → 400
 *
 * The HMAC is computed in-test with the SAME algorithm the handler uses
 * (@noble/hashes hmac+sha256, hex), so the happy path is genuinely verified,
 * not mocked away.
 */

import { describe, it, expect } from 'vitest';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { handleGithubWebhook, channelsForWebhook } from '../src/github-webhook.js';
import type { Env } from '../src/types.js';

const SECRET = 'super-secret-webhook-key';

// ── stateful D1 mock: a real per-(sender,channel) event chain ─────────────────
// insertEvent() calls getLastEventSeq() (SELECT ... ORDER BY seq DESC LIMIT 1)
// then INSERT INTO events, and upsertChainHead()/appendAudit() also run. We model
// just enough: an events store keyed by (sender|channel) and no-op everything else.
interface Captured {
  events: Array<{ sender: string; channel: string; seq: number; this_hash: string }>;
  audits: Array<{ action: string; target: string | null }>;
}

function makeMockD1(cap: Captured): D1Database {
  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        bound = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        // getLastEventSeq: SELECT seq, this_hash FROM events WHERE sender=? AND channel=?
        if (query.includes('FROM events') && query.includes('ORDER BY seq DESC')) {
          const [sender, channel] = bound as [string, string];
          const matches = cap.events
            .filter((e) => e.sender === sender && e.channel === channel)
            .sort((a, b) => b.seq - a.seq);
          const top = matches[0];
          return (top ? { seq: top.seq, this_hash: top.this_hash } : null) as T | null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: [] };
      },
      async run() {
        if (query.includes('INSERT INTO events')) {
          const [sender, channel, seq, , this_hash] = bound as [string, string, number, string, string];
          cap.events.push({ sender, channel, seq, this_hash });
        } else if (query.includes('INSERT INTO audit_log')) {
          const [, action, target] = bound as [unknown, string, string | null];
          cap.audits.push({ action, target });
        }
        return { success: true };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return {
    prepare: stmtFor,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

// ── DO mock: record every channel publish() routed to it ──────────────────────
function makeEnv(cap: Captured, publishedChannels: string[], secret: string | undefined = SECRET): Env {
  const harborChannel = {
    idFromName: (name: string) => ({ name }),
    get: (_id: { name: string }) => ({
      async fetch(url: string, init?: { body?: string }) {
        if (url.includes('action=publish') && init?.body) {
          const { event } = JSON.parse(init.body) as { event: string };
          const ev = JSON.parse(event) as { channel: string };
          publishedChannels.push(ev.channel);
        }
        return new Response(null, { status: 204 });
      },
    }),
  };
  return {
    DB: makeMockD1(cap),
    HARBOR_CHANNEL: harborChannel as unknown as DurableObjectNamespace,
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: 'tok',
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    GITHUB_WEBHOOK_SECRET: secret as string,
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

// ── real signature computed exactly as the handler does ───────────────────────
function sign(secret: string, body: string): string {
  const enc = new TextEncoder();
  const mac = hmac(sha256, enc.encode(secret), enc.encode(body));
  return 'sha256=' + Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function webhookReq(opts: {
  method?: string;
  body: string;
  signature?: string | null;
  event?: string | null;
  delivery?: string;
}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.signature !== null && opts.signature !== undefined) {
    headers.set('X-Hub-Signature-256', opts.signature);
  }
  if (opts.event !== null && opts.event !== undefined) {
    headers.set('X-GitHub-Event', opts.event);
  }
  if (opts.delivery) headers.set('X-GitHub-Delivery', opts.delivery);
  return new Request('https://relay.example.com/v1/github/webhook', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.method === 'GET' ? undefined : opts.body,
  });
}

const PR_BODY = JSON.stringify({
  action: 'opened',
  repository: { full_name: 'curiositech/port-daddy', id: 42 },
  sender: { login: 'octocat', id: 1 },
});

describe('channelsForWebhook — canonical channel naming', () => {
  it('emits global, action-scoped, and repo-scoped channels in order', () => {
    expect(channelsForWebhook('pull_request', 'opened', 'curiositech/port-daddy')).toEqual([
      'github:webhook:pull_request',
      'github:webhook:pull_request:opened',
      'github:curiositech/port-daddy:pull_request',
    ]);
  });

  it('omits action and repo channels when those fields are absent', () => {
    expect(channelsForWebhook('push', null, null)).toEqual(['github:webhook:push']);
  });
});

describe('handleGithubWebhook — HMAC ingress gate', () => {
  it('204 and publishes to the expected channels on a valid signature', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const sig = sign(SECRET, PR_BODY);

    const res = await handleGithubWebhook(
      webhookReq({ body: PR_BODY, signature: sig, event: 'pull_request', delivery: 'abc-123' }),
      env
    );

    expect(res.status).toBe(204);
    // 3 channels: global, action-scoped, repo-scoped (action + repo both present).
    expect(published).toEqual([
      'github:webhook:pull_request',
      'github:webhook:pull_request:opened',
      'github:curiositech/port-daddy:pull_request',
    ]);
    // Each channel got a chain-1 event persisted; each publish was audited.
    expect(cap.events.map((e) => e.channel).sort()).toEqual([...published].sort());
    expect(cap.events.every((e) => e.seq === 1)).toBe(true);
    expect(cap.audits.every((a) => a.action === 'github_webhook_publish')).toBe(true);
  });

  it('401 and publishes nothing on a wrong signature', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const wrong = sign('the-wrong-secret', PR_BODY);

    const res = await handleGithubWebhook(
      webhookReq({ body: PR_BODY, signature: wrong, event: 'pull_request' }),
      env
    );

    expect(res.status).toBe(401);
    expect(await res.text()).toContain('BAD_SIGNATURE');
    expect(published).toEqual([]);
    expect(cap.events).toEqual([]);
  });

  it('401 when the signature header is missing', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);

    const res = await handleGithubWebhook(
      webhookReq({ body: PR_BODY, signature: null, event: 'pull_request' }),
      env
    );

    expect(res.status).toBe(401);
    expect(await res.text()).toContain('MISSING_SIGNATURE');
    expect(published).toEqual([]);
  });

  it('405 on a non-POST method', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const sig = sign(SECRET, PR_BODY);

    const res = await handleGithubWebhook(
      webhookReq({ method: 'GET', body: PR_BODY, signature: sig, event: 'pull_request' }),
      env
    );

    expect(res.status).toBe(405);
    expect(published).toEqual([]);
  });

  it('400 on a malformed body even when the signature over those bytes is valid', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const garbage = '{ this is not json ';
    const sig = sign(SECRET, garbage); // a REAL signature over the garbage bytes

    const res = await handleGithubWebhook(
      webhookReq({ body: garbage, signature: sig, event: 'pull_request' }),
      env
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('BAD_JSON');
    expect(published).toEqual([]);
  });

  it('400 when the X-GitHub-Event header is missing', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const sig = sign(SECRET, PR_BODY);

    const res = await handleGithubWebhook(
      webhookReq({ body: PR_BODY, signature: sig, event: null }),
      env
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MISSING_EVENT_HEADER');
    expect(published).toEqual([]);
  });
});

describe('handleGithubWebhook — ambient-noise event filter', () => {
  // A CI-flood event GitHub Apps fire constantly. Body has no `action`, so the
  // persist gate must reject it on event-type alone.
  const WORKFLOW_RUN_BODY = JSON.stringify({
    workflow_run: { id: 99, conclusion: 'success' },
    repository: { full_name: 'curiositech/port-daddy', id: 42 },
    sender: { login: 'octocat', id: 1 },
  });

  it('204 and persists NOTHING for a non-PR event (still audited as ignored)', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const sig = sign(SECRET, WORKFLOW_RUN_BODY);

    const res = await handleGithubWebhook(
      webhookReq({
        body: WORKFLOW_RUN_BODY,
        signature: sig,
        event: 'workflow_run',
        delivery: 'wf-1',
      }),
      env
    );

    expect(res.status).toBe(204);
    // No fan-out, no event rows, no chain growth.
    expect(published).toEqual([]);
    expect(cap.events).toEqual([]);
    // The delivery is still traceable via a single ignored-audit row.
    expect(cap.audits).toEqual([
      { action: 'github_webhook_ignored', target: 'curiositech/port-daddy' },
    ]);
  });

  it('still HMAC-rejects a non-PR event with a bad signature (security gate unchanged)', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const wrong = sign('the-wrong-secret', WORKFLOW_RUN_BODY);

    const res = await handleGithubWebhook(
      webhookReq({ body: WORKFLOW_RUN_BODY, signature: wrong, event: 'workflow_run' }),
      env
    );

    // Verification happens BEFORE the persist filter — a forged delivery is 401,
    // never a quiet 204.
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('BAD_SIGNATURE');
    expect(published).toEqual([]);
    expect(cap.events).toEqual([]);
    expect(cap.audits).toEqual([]);
  });

  it('204 and persists NOTHING for a pull_request action outside the whitelist', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const body = JSON.stringify({
      action: 'assigned', // not in PERSIST_EVENT_TYPES
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'octocat', id: 1 },
    });
    const sig = sign(SECRET, body);

    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sig, event: 'pull_request', delivery: 'pr-assigned' }),
      env
    );

    expect(res.status).toBe(204);
    expect(published).toEqual([]);
    expect(cap.events).toEqual([]);
    expect(cap.audits).toEqual([
      { action: 'github_webhook_ignored', target: 'curiositech/port-daddy' },
    ]);
  });

  it('persists and fans out a whitelisted PR action other than opened (e.g. labeled)', async () => {
    const cap: Captured = { events: [], audits: [] };
    const published: string[] = [];
    const env = makeEnv(cap, published);
    const body = JSON.stringify({
      action: 'labeled',
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'octocat', id: 1 },
    });
    const sig = sign(SECRET, body);

    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sig, event: 'pull_request', delivery: 'pr-labeled' }),
      env
    );

    expect(res.status).toBe(204);
    expect(published).toEqual([
      'github:webhook:pull_request',
      'github:webhook:pull_request:labeled',
      'github:curiositech/port-daddy:pull_request',
    ]);
    expect(cap.audits.every((a) => a.action === 'github_webhook_publish')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MERGE QUEUE: the fleet must report on the queue branch, or nothing merges.
//
// `Port Daddy Fleet` is a REQUIRED context on the merge queue. Until this
// change the relay enqueued a fleet run only for `pull_request`, so a
// `merge_group` delivery produced no job, no run and no check — and GitHub sat
// waiting for a context no code path could ever create. Observed 2026-08-10:
// `main` had not advanced since 2026-08-06, the queue head had been
// AWAITING_CHECKS for 9+ hours, and the queue branches carried every Actions
// check green with `Port Daddy Fleet` simply absent.

describe('fleet enqueue — merge_group (the merge-queue deadlock)', () => {
  function envWithQueues(reviewSent: unknown[], gateSent?: unknown[]) {
    const cap: Captured = { events: [], audits: [] };
    const env = makeEnv(cap, []) as unknown as Record<string, unknown>;
    env.FLEET_RUNS = { async send(job: unknown) { reviewSent.push(job); } };
    if (gateSent) {
      env.FLEET_GATES = { async send(job: unknown) { gateSent.push(job); } };
    }
    return { env: env as unknown as Env, cap };
  }

  const MERGE_GROUP_BODY = JSON.stringify({
    action: 'checks_requested',
    repository: { full_name: 'curiositech/port-daddy', id: 42 },
    sender: { login: 'octocat', id: 1 },
    installation: { id: 777 },
    merge_group: {
      head_sha: 'b8ae3f4202aeb2b25d7be69b7a3ed6898957c8c1',
      head_ref: 'refs/heads/gh-readonly-queue/main/pr-6455-b8ae3f42',
    },
  });

  it('falls back to the review queue and carries the queue-branch head_sha', async () => {
    const sent: unknown[] = [];
    const { env } = envWithQueues(sent);
    const res = await handleGithubWebhook(
      webhookReq({
        body: MERGE_GROUP_BODY,
        signature: sign(SECRET, MERGE_GROUP_BODY),
        event: 'merge_group',
        delivery: 'mg-1',
      }),
      env
    );

    expect(res.status).toBe(204);
    expect(sent).toHaveLength(1);
    const job = sent[0] as {
      eventType: string;
      action: string;
      prNumber: number | null;
      installationId: number | null;
      payloadMinimal: { merge_group?: { head_sha?: string } };
    };
    expect(job.eventType).toBe('merge_group');
    expect(job.action).toBe('checks_requested');
    // No pull_request on this payload — the head_sha IS the only thing the
    // executor can hang a check run on, so losing it loses the whole fix.
    expect(job.prNumber).toBeNull();
    expect(job.installationId).toBe(777);
    expect(job.payloadMinimal.merge_group?.head_sha).toBe(
      'b8ae3f4202aeb2b25d7be69b7a3ed6898957c8c1'
    );
  });

  it('routes deterministic checks to the independent gate queue when bound', async () => {
    const reviewSent: unknown[] = [];
    const gateSent: unknown[] = [];
    const { env } = envWithQueues(reviewSent, gateSent);
    const res = await handleGithubWebhook(
      webhookReq({
        body: MERGE_GROUP_BODY,
        signature: sign(SECRET, MERGE_GROUP_BODY),
        event: 'merge_group',
        delivery: 'mg-fast-lane',
      }),
      env
    );

    expect(res.status).toBe(204);
    expect(reviewSent).toHaveLength(0);
    expect(gateSent).toHaveLength(1);
  });

  it('ignores merge_group actions that are not checks_requested', async () => {
    const sent: unknown[] = [];
    const body = JSON.stringify({
      action: 'destroyed',
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'octocat', id: 1 },
      installation: { id: 777 },
      merge_group: { head_sha: 'deadbeef' },
    });
    const res = await handleGithubWebhook(
      webhookReq({ body, signature: sign(SECRET, body), event: 'merge_group', delivery: 'mg-2' }),
      envWithQueues(sent).env
    );
    expect(res.status).toBe(204);
    expect(sent).toHaveLength(0);
  });

  it('still enqueues ordinary pull_request deliveries', async () => {
    // Regression guard: widening the predicate must not narrow the path that
    // already worked.
    const reviewSent: unknown[] = [];
    const gateSent: unknown[] = [];
    const res = await handleGithubWebhook(
      webhookReq({
        body: PR_BODY,
        signature: sign(SECRET, PR_BODY),
        event: 'pull_request',
        delivery: 'pr-1',
      }),
      envWithQueues(reviewSent, gateSent).env
    );
    expect(res.status).toBe(204);
    expect(reviewSent).toHaveLength(1);
    expect(gateSent).toHaveLength(0);
    expect((reviewSent[0] as { eventType: string }).eventType).toBe('pull_request');
  });
});
