const { describe, it, mock, assert, wait } = require('test-utils');
const { executeMergeGroupGate } = require('../../apps/fleet-executor/src/execute');
const { fetchMergeGroupMembers } = require('../../apps/fleet-executor/src/github');

mock(fetchMergeGroupMembers, 'fetchMergeGroupMembers');

describe('merge group concurrency', () => {
  it('should handle concurrent requests', async () => {
    fetchMergeGroupMembers.mock.onCall(0).resolves([{ id: 1, headSha: 'abc123' }]);
    fetchMergeGroupMembers.mock.onCall(1).resolves([{ id: 2, headSha: 'def456' }]);

    const promises = [
      executeMergeGroupGate({
        action: 'checks_requested',
        repoFullName: 'owner/repo',
        installationId: 123,
        payloadMinimal: {
          merge_group: { head_sha: 'abc123', base_ref: 'main' }
        }
      }, {}),
      executeMergeGroupGate({
        action: 'checks_requested',
        repoFullName: 'owner/repo',
        installationId: 123,
        payloadMinimal: {
          merge_group: { head_sha: 'def456', base_ref: 'main' }
        }
      }, {})
    ];

    await Promise.all(promises);
    assert.calledTwice(fetchMergeGroupMembers);
  });

  it('should not interfere between separate calls', async () => {
    fetchMergeGroupMembers.mock.onCall(0).resolves([{ id: 1, headSha: 'abc123' }]);
    fetchMergeGroupMembers.mock.onCall(1).resolves([{ id: 2, headSha: 'def456' }]);

    const result1 = await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'abc123', base_ref: 'main' }
      }
    }, {});

    const result2 = await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'def456', base_ref: 'main' }
      }
    }, {});

    assert.equal(result1, undefined);
    assert.equal(result2, undefined);
  });
});