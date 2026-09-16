/**
 * Episodic wakes — the relay webhook waking the Steward's seat (P1 PR 8).
 *
 * WHAT THESE PIN, AND WHY. The bug this closes was not a wrong line of code;
 * it was a *missing caller*. P1 PR 1 built a wake inbox and assumed the
 * webhook receiver would post to it, nothing ever did, and four green PRs
 * later production D1 still held zero deck-log rows. The class of defect is
 * "everyone assumed someone upstream would knock", so the tests that matter
 * are the ones asserting a knock actually happens on the real handler path —
 * not that a helper returns the right string when called.
 *
 * The other half is the inverse risk. A merge authority wired to a firehose is
 * worse than one wired to nothing: every ignorable event becomes a durable
 * write and a tick, and the deck log — the vital sign a human is supposed to
 * read — fills with noise until nobody reads it. So the filter's *exclusions*
 * are pinned as hard as its inclusions.
 */

import { describe, it, expect } from 'vitest';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { handleGithubWebhook } from '../src/github-webhook.js';
import {
  stewardWakeKind,
  stewardWakePrNumber,
  maybeWakeSteward,
} from '../src/steward-wake.js';
import type { Env } from '../src/types.js';

const SECRET = 'super-secret-webhook-key';
const REPO = 'curiositech/port-daddy';

interface WakeCall {
  name: string;
  url: string;
  body: { kind?: string; deliveryId?: string; prNumber?: number; detail?: string };
}

/**
 * A seat stub that records what the relay actually sent it. `status` is
 * settable so the failure path can be exercised against the real code rather
 * than a rewritten copy of it.
 */
function makeSteward(calls: WakeCall[], status = 202) {
  return {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      async fetch(req: Request) {
        calls.push({
          name: id.name,
          url: req.url,
          body: JSON.parse(await req.text()) as WakeCall['body'],
        });
        return new Response(JSON.stringify({ queued: true }), { status });
      },
    }),
  } as unknown as DurableObjectNamespace;
}

const audits: Array<{ action: string; detail: string }> = [];

function makeDb(): D1Database {
  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        bound = a;
        return stmt;
      },
      async first() {
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        if (query.includes('INSERT INTO audit_log')) {
          const [, action, , , detail] = bound as [unknown, string, unknown, unknown, string];
          audits.push({ action, detail: String(detail ?? '') });
        }
        return { success: true };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return { prepare: stmtFor, batch: async () => [], exec: async () => ({ count: 0, duration: 0 }) } as unknown as D1Database;
}

function makeEnv(steward?: DurableObjectNamespace): Env {
  const noopChannel = {
    idFromName: (name: string) => ({ name }),
    get: () => ({ async fetch() { return new Response(null, { status: 204 }); } }),
  };
  return {
    DB: makeDb(),
    HARBOR_CHANNEL: noopChannel as unknown as DurableObjectNamespace,
    ...(steward ? { STEWARD: steward } : {}),
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: 'tok',
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    GITHUB_WEBHOOK_SECRET: SECRET,
  } as unknown as Env;
}

function sign(body: string): string {
  const mac = hmac(sha256, new TextEncoder().encode(SECRET), new TextEncoder().encode(body));
  return 'sha256=' + Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('');
}

function deliver(env: Env, event: string, body: unknown, delivery = 'd-1'): Promise<Response> {
  const raw = JSON.stringify(body);
  return handleGithubWebhook(
    new Request('https://relay.example.com/v1/github/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Hub-Signature-256': sign(raw),
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': delivery,
      },
      body: raw,
    }),
    env,
  );
}

const REPOSITORY = { full_name: REPO };

describe('the filter — signal in, description-churn out', () => {
  it('wakes on a completed check suite', () => {
    // The single most merge-relevant event there is: it is the transition from
    // "cannot land" to "can land", and without it the seat learns a PR went
    // green only on its next 6h beat.
    expect(stewardWakeKind('check_suite', 'completed')).toBe('checks-completed');
  });

  it('wakes on a new head, a review, and the PR opening or closing', () => {
    expect(stewardWakeKind('pull_request', 'synchronize')).toBe('pr-pushed');
    expect(stewardWakeKind('pull_request_review', 'submitted')).toBe('review-submitted');
    expect(stewardWakeKind('pull_request', 'opened')).toBe('pr-opened');
    expect(stewardWakeKind('pull_request', 'closed')).toBe('pr-closed');
  });

  it('does NOT wake on title, body, or label churn', () => {
    // None of these can change a verdict. Waking on them would make the deck
    // log — §5.3's vital sign — unreadable, which is a slower version of
    // having no vital sign at all.
    expect(stewardWakeKind('pull_request', 'edited')).toBeNull();
    expect(stewardWakeKind('pull_request', 'labeled')).toBeNull();
    expect(stewardWakeKind('pull_request', 'assigned')).toBeNull();
  });

  it('does NOT wake per check RUN, only per check SUITE', () => {
    // One push here completes ~28 check runs and a handful of suites. Both
    // collapse to one tick through the seat's 5s debounce, so run-level
    // granularity buys nothing and costs ~20 durable writes per push.
    expect(stewardWakeKind('check_run', 'completed')).toBeNull();
  });

  it('treats an unknown event as no-wake', () => {
    // Allow-list, not deny-list: a deny-list silently admits whatever GitHub
    // ships next year, and the failure mode is a merge authority woken by
    // something it has no opinion about.
    expect(stewardWakeKind('deployment_status', 'created')).toBeNull();
    expect(stewardWakeKind('issues', 'opened')).toBeNull();
  });
});

describe('the knock actually happens on the real handler path', () => {
  it('a verified check_suite delivery reaches the seat for that repo', async () => {
    // This is the assertion whose absence caused the incident. It runs the
    // real handleGithubWebhook — signature, gates and all — and asserts the
    // seat was called, so a future refactor that drops the call fails here.
    const calls: WakeCall[] = [];
    const env = makeEnv(makeSteward(calls));
    const res = await deliver(env, 'check_suite', {
      action: 'completed',
      repository: REPOSITORY,
      check_suite: { conclusion: 'success', pull_requests: [{ number: 9807 }] },
    });
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(1);
    // Per-repo seat naming — the Single-Writer Kernel rule made concrete, and
    // it must match `apps/steward/src/worker.ts` exactly or the relay would
    // silently create a brand-new empty seat that serves nobody.
    expect(calls[0].name).toBe(`steward:${REPO}`);
    expect(calls[0].url).toContain('/wake');
    expect(calls[0].body.kind).toBe('checks-completed');
    expect(calls[0].body.prNumber).toBe(9807);
  });

  it('passes the GitHub delivery id through as the dedupe key', async () => {
    // The seat dedupes on deliveryId; that is the entire reason at-least-once
    // webhook delivery is safe to point at it. Substituting our own id would
    // make GitHub's redeliveries look like distinct stimuli.
    const calls: WakeCall[] = [];
    await deliver(
      makeEnv(makeSteward(calls)),
      'pull_request',
      { action: 'synchronize', repository: REPOSITORY, pull_request: { number: 42 } },
      'delivery-abc',
    );
    expect(calls[0].body.deliveryId).toBe('delivery-abc');
  });

  it('sends nothing for an event outside the filter', async () => {
    const calls: WakeCall[] = [];
    await deliver(makeEnv(makeSteward(calls)), 'issues', { action: 'opened', repository: REPOSITORY });
    expect(calls).toHaveLength(0);
  });
});

describe('the seat is an accelerant, never a dependency', () => {
  it('still answers 204 when the seat throws', async () => {
    // A 503 here would make GitHub retry the delivery, and the retry re-runs
    // the fleet enqueue that already succeeded — a lost wake costs latency,
    // a failed delivery costs duplicate spend.
    const exploding = {
      idFromName: () => ({}),
      get: () => ({ fetch() { throw new Error('DO unreachable'); } }),
    } as unknown as DurableObjectNamespace;
    audits.length = 0;
    const res = await deliver(makeEnv(exploding), 'check_suite', {
      action: 'completed',
      repository: REPOSITORY,
      check_suite: { pull_requests: [] },
    });
    expect(res.status).toBe(204);
    // Absorbed, but not vanished: the P1 lesson is that an unobservable no-op
    // is indistinguishable from a success.
    expect(audits.some(a => a.action === 'steward_wake_failed')).toBe(true);
  });

  it('records a refusal when the seat answers non-2xx', async () => {
    audits.length = 0;
    const calls: WakeCall[] = [];
    await deliver(makeEnv(makeSteward(calls, 503)), 'check_suite', {
      action: 'completed',
      repository: REPOSITORY,
      check_suite: { pull_requests: [] },
    });
    expect(audits.some(a => a.action === 'steward_wake_failed' && a.detail.includes('503'))).toBe(true);
  });

  it('is a silent no-op when STEWARD is unbound', async () => {
    // Staging depends on this: `env.latest` deliberately omits the binding so
    // a staging delivery cannot wake the production merge authority. The
    // omission is only safe because unbound means "do nothing", not "throw".
    audits.length = 0;
    const res = await deliver(makeEnv(undefined), 'check_suite', {
      action: 'completed',
      repository: REPOSITORY,
      check_suite: { pull_requests: [] },
    });
    expect(res.status).toBe(204);
    expect(audits.some(a => a.action.startsWith('steward_wake'))).toBe(false);
  });

  it('refuses to wake with an empty delivery id', async () => {
    // Every event would collapse onto one dedupe key and the seat would
    // swallow all wakes after the first — the loudest possible failure
    // wearing the costume of the quietest.
    audits.length = 0;
    const calls: WakeCall[] = [];
    await maybeWakeSteward(makeEnv(makeSteward(calls)), 'check_suite', 'completed', '', REPO, {});
    expect(calls).toHaveLength(0);
    expect(audits.some(a => a.action === 'steward_wake_skipped')).toBe(true);
  });

  it('sends nothing when the payload names no repo', async () => {
    // Seats are per-repo; there is no default seat to fall back to, and
    // inventing one would create a phantom that ticks forever over nothing.
    const calls: WakeCall[] = [];
    await maybeWakeSteward(makeEnv(makeSteward(calls)), 'check_suite', 'completed', 'd', null, {});
    expect(calls).toHaveLength(0);
  });
});

describe('PR number extraction — precision, not correctness', () => {
  it('reads it from pull_request and from check_suite alike', () => {
    expect(stewardWakePrNumber({ pull_request: { number: 7 } })).toBe(7);
    expect(stewardWakePrNumber({ check_suite: { pull_requests: [{ number: 9 }] } })).toBe(9);
  });

  it('returns null rather than guessing when the suite has no PR', () => {
    // A suite on a branch with no PR is legitimate and common. The number is
    // context on the log entry; the tick re-surveys every open PR regardless,
    // so absence costs legibility, never a missed verdict.
    expect(stewardWakePrNumber({ check_suite: { pull_requests: [] } })).toBeNull();
    expect(stewardWakePrNumber({})).toBeNull();
  });

  it('omits the field entirely rather than sending null', async () => {
    // The seat's handleWake only records prNumber when it is a number; sending
    // an explicit null would be a silent type mismatch at the boundary.
    const calls: WakeCall[] = [];
    await deliver(makeEnv(makeSteward(calls)), 'check_suite', {
      action: 'completed',
      repository: REPOSITORY,
      check_suite: { pull_requests: [] },
    });
    expect(calls[0].body).not.toHaveProperty('prNumber');
  });
});

describe('the binding, as committed', () => {
  it('binds STEWARD cross-script and claims no migration over it', async () => {
    // Two Workers claiming migration authority over one Durable Object class
    // is how a namespace gets forked in production — one seat becomes two and
    // the merge history of record silently splits. `script_name` is what makes
    // this a reference rather than a second owner.
    const fs = await import('node:fs');
    const toml = fs.readFileSync(new URL('../wrangler.deploy.toml', import.meta.url), 'utf8');
    expect(toml).toContain('{ name = "STEWARD", class_name = "StewardDO", script_name = "pd-steward" }');
    expect(toml).not.toMatch(/new_(sqlite_)?classes\s*=\s*\[[^\]]*StewardDO/);
  });

  it('leaves STEWARD out of the latest (staging) environment', async () => {
    // Staging shares this repo's real webhook. A STEWARD binding there would
    // point staging traffic at the production merge authority.
    const fs = await import('node:fs');
    const toml = fs.readFileSync(new URL('../wrangler.deploy.toml', import.meta.url), 'utf8');
    const latest = toml.slice(toml.indexOf('[env.latest.durable_objects]'));
    const block = latest.slice(0, latest.indexOf(']'));
    expect(block).not.toContain('STEWARD');
  });
});
