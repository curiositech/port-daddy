const { describe, it, mock, assert, spy } = require('test-utils');
const { executeMergeGroupGate } = require('../../apps/fleet-executor/src/execute');
const { fetchMergeGroupMembers } = require('../../apps/fleet-executor/src/github');
const { emitCloudTelemetry } = require('../../apps/fleet-executor/src/telemetry');

mock(fetchMergeGroupMembers, 'fetchMergeGroupMembers');
mock(emitCloudTelemetry, 'emitCloudTelemetry');

describe('merge group metrics', () => {
  it('should track retry attempts', async () => {
    fetchMergeGroupMembers.mock.onCall(0).throws(new Error('Transient'));
    fetchMergeGroupMembers.mock.onCall(1).resolves([{ id: 1, headSha: 'abc123' }]);

    await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'abc123', base_ref: 'main' }
      }
    }, {});

    assert.calledWith(emitCloudTelemetry, {
      event: 'merge-group-retry',
      retryCount: 1,
      status: 'success'
    });
  });

  it('should track failed retries', async () => {
    fetchMergeGroupMembers.mock.throws(new Error('Permanent'));

    await executeMergeGroupGate({
      action: 'checks_requested',
      repoFullName: 'owner/repo',
      installationId: 123,
      payloadMinimal: {
        merge_group: { head_sha: 'abc123', base_ref: 'main' }
      }
    }, {});

    assert.calledWith(emitCloudTelemetry, {
      event: 'merge-group-retry',
      retryCount: 0,
      status: 'failure'
    });
  });
});