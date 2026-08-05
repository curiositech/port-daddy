const { describe, it, beforeEach, mock, assert } = require('test-utils');
const { executeMergeGroupGate } = require('../../apps/fleet-executor/src/execute');
const { fetchMergeGroupMembers } = require('../../apps/fleet-executor/src/github');

mock(fetchMergeGroupMembers, 'fetchMergeGroupMembers');

describe('merge group retry logic', () => {
  beforeEach(() => {
    fetchMergeGroupMembers.mock.reset();
  });

  it('should retry on transient failure', async () => {
    const transientError = new Error('Transient network error');
    fetchMergeGroupMembers.mock.onCall(0).throws(transientError);
    fetchMergeGroupMembers.mock.onCall(1).resolves([{ id: 1, headSha: 'abc123' }]);

    const result = await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'abc123', base_ref: 'main' }
      }
    }, {});

    assert.calledTwice(fetchMergeGroupMembers);
    assert.calledWith(fetchMergeGroupMembers, 'owner', 'repo', 'main', 'abc123', 'token');
    assert.equal(result, undefined);
  });

  it('should fail after max retries', async () => {
    const error = new Error('Permanent error');
    fetchMergeGroupMembers.mock.throws(error);

    const result = await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'abc123', base_ref: 'main' }
      }
    }, {});

    assert.calledOnce(fetchMergeGroupMembers);
    assert.equal(result, undefined);
  });

  it('should handle exponential backoff', async () => {
    const start = Date.now();
    fetchMergeGroupMembers.mock.onCall(0).throws(new Error('Transient'));
    fetchMergeGroupMembers.mock.onCall(1).throws(new Error('Transient'));
    fetchMergeGroupMembers.mock.onCall(2).resolves([{ id: 1, headSha: 'abc123' }]);

    await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'abc123', base_ref: 'main' }
      }
    }, {});

    const duration = Date.now() - start;
    assert.isAtLeast(duration, 1000); // Minimum 1s between retries
  });

  it('should not alter validation outcome', async () => {
    fetchMergeGroupMembers.mock.resolves([{ id: 1, headSha: 'abc123' }]);
    const result = await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'abc123', base_ref: 'main' }
      }
    }, {});

    assert.equal(result, undefined);
  });
});