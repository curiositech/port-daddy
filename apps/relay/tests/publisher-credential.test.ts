import { afterEach, describe, expect, it } from 'vitest';
import {
  getGitHubPublisherCredential,
  replaceGitHubPublisherCredential,
} from '../src/db.js';
import { makeTestD1, type TestD1 } from './support/d1-sqlite.js';

describe('per-account publisher credential generation', () => {
  let testDb: TestD1 | undefined;
  afterEach(() => testDb?.close());

  it('inserts generation one and rejects stale or skipped compare-and-swap writes', async () => {
    testDb = makeTestD1();
    const userId = `u_${'ab'.repeat(16)}`;
    testDb.raw.prepare(
      'INSERT INTO users (id, github_user_id, login, created_at, email_verified) VALUES (?, 42, ?, 1, 0)',
    ).run(userId, 'octocat');

    const write = (generation: number, expectedGeneration: number, marker: string) =>
      replaceGitHubPublisherCredential(testDb!.db, {
        accountUserId: userId,
        generation,
        credential_enc: `enc-${marker}`,
        credential_iv: `iv-${marker}`,
        credential_key_version: 1,
        updated_at: generation,
      }, expectedGeneration);

    expect(await write(1, 0, 'one')).toBe(true);
    expect(await write(2, 0, 'stale')).toBe(false);
    expect(await write(3, 2, 'skipped')).toBe(false);
    expect(await write(2, 1, 'two')).toBe(true);
    expect(await getGitHubPublisherCredential(testDb.db, userId)).toMatchObject({
      generation: 2,
      credential_enc: 'enc-two',
      updated_at: 2,
    });
  });
});
