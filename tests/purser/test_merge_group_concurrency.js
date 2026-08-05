import { describe, it, expect, vi } from 'vitest';
import { handleGithubWebhook } from '../../src/github-webhook.js';
import { makeEnv } from './mocks.js';

const SECRET = 'super-secret-webhook-key';

describe('merge_group concurrency and idempotency', () => {
  it('handles concurrent events', async () => {
    const cap = { events: [], audits: [] };
    const published = [];
    const env = makeEnv(cap, published, SECRET);
    
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

    const promises = Array(10).fill(0).map(() =>
      handleGithubWebhook(
        { body, headers: { 'x-github-event': 'merge_group' }, env },
        env
      )
    );

    await Promise.all(promises);

    expect(cap.events).toHaveLength(10);
  });

  it('is idempotent for duplicate events', async () => {
    const cap = { events: [], audits: [] };
    const published = [];
    const env = makeEnv(cap, published, SECRET);
    
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

    await handleGithubWebhook(
      { body, headers: { 'x-github-event': 'merge_group' }, env },
      env
    );

    expect(cap.events).toHaveLength(1);
  });
});