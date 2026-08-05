const { describe, it, mock, assert } = require('test-utils');
const { executeMergeGroupGate } = require('../../apps/fleet-executor/src/execute');
const { fetchMergeGroupMembers } = require('../../apps/fleet-executor/src/github');

mock(fetchMergeGroupMembers, 'fetchMergeGroupMembers');

describe('merge group error handling', () => {
  it('should handle 500 errors with retry', async () => {
    fetchMergeGroupMembers.mock.onCall(0).rejects({ status: 500 });
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
    assert.equal(result, undefined);
  });

  it('should not retry on 404 errors', async () => {
    fetchMergeGroupMembers.mock.rejects({ status: 404 });

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

  it('should handle token invalidation', async () => {
    fetchMergeGroupMembers.mock.rejects({ status: 401 });
    fetchMergeGroupMembers.mock.resolves([{ id: 1, headSha: 'abc123' }]);

    const result = await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'abc123', base_ref: 'main' }
      }
    }, {});

    assert.calledTwice(fetchMergeGroupMembers);
    assert.equal(result, undefined);
  });
});