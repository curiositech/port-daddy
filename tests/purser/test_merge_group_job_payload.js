import { describe, it, expect, vi } from 'vitest';
import { handleGithubWebhook } from '../../src/github-webhook.js';
import { makeEnv } from './mocks.js';

const SECRET = 'super-secret-webhook-key';

describe('merge_group FleetRunJob payload', () => {
  it('includes merge_group data in payloadMinimal', async () => {
    const cap = { events: [], audits: [] };
    const published = [];
    const enqueued = [];
    const env = makeEnv(cap, published, SECRET, enqueued);
    
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      merge_group: {
        head_sha: 'MERGEGROUPSHA',
        head_ref: 'refs/heads/gh-readonly-queue/main/pr-5062-base',
      },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 }
    });

    await handleGithubWebhook(
      { body, headers: { 'x-github-event': 'merge_group' }, env },
      env
    );

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].payloadMinimal.merge_group).toBeDefined();
    expect(enqueued[0].payloadMinimal.merge_group.head_sha).toBe('MERGEGROUPSHA');
  });

  it('handles missing merge_group data', async () => {
    const cap = { events: [], audits: [] };
    const published = [];
    const enqueued = [];
    const env = makeEnv(cap, published, SECRET, enqueued);
    
    const body = JSON.stringify({
      action: 'checks_requested',
      installation: { id: 42 },
      repository: { full_name: 'curiositech/port-daddy', id: 42 },
      sender: { login: 'github-merge-queue[bot]', id: 1 }
    });

    await handleGithubWebhook(
      { body, headers: { 'x-github-event': 'merge_group' }, env },
      env
    );

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].payloadMinimal.merge_group).toBeUndefined();
  });
});