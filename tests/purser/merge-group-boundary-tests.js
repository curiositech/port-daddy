const { describe, it, mock, assert } = require('test-utils');
const { executeMergeGroupGate } = require('../../apps/fleet-executor/src/execute');
const { fetchMergeGroupMembers } = require('../../apps/fleet-executor/src/github');

mock(fetchMergeGroupMembers, 'fetchMergeGroupMembers');

describe('merge group boundary cases', () => {
  it('should handle empty response', async () => {
    fetchMergeGroupMembers.mock.resolves([]);

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

  it('should handle large number of members', async () => {
    const members = Array(100).fill().map((_, i) => ({ id: i, headSha: `sha${i}` }));
    fetchMergeGroupMembers.mock.resolves(members);

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

  it('should handle invalid head sha', async () => {
    fetchMergeGroupMembers.mock.rejects(new Error('Invalid SHA'));

    const result = await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: '', base_ref: 'main' }
      }
    }, {});

    assert.calledOnce(fetchMergeGroupMembers);
    assert.equal(result, undefined);
  });
});