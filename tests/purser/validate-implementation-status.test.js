const fs = require('fs');
const path = require('path');

const STATUS_REGISTRY_PATH = path.join(__dirname, '../../docs/implementation-status-registry');

describe('Implementation Status Validation', () => {
  it('should verify status designations match technical reality', () => {
    const registryContent = fs.readFileSync(STATUS_REGISTRY_PATH, 'utf-8');

    // Check checkpoint status
    expect(registryContent).to.match(/checkpoint: \BuiltWeak/);
    expect(registryContent).to.match(/notes not execution state/);

    // Check witnessed-outcome ledger status
    expect(registryContent).to.match(/witnessed-outcome ledger: \BuiltWeak/);
    expect(registryContent).to.match(/durable commitments, oracle-bound closure/);

    // Check non-forgeable identity status
    expect(registryContent).to.match(/non-forgeable identity: \BuiltWeak/);
    expect(registryContent).to.match(/bounded gate ships/);
  });
});