import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('CI gating', () => {
  it('fails build on test failure', () => {
    // This test is designed to fail to demonstrate gating
    assert.fail('This test is intentionally failing to block the build');
  });
});