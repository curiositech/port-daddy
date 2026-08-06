const { handleCanonicalSupervisedAction } = require('../../cli/commands/daemon');
const { readFileSync } = require('fs');
const { join } = require('path');

jest.mock('../../shared/daemon-discovery.js', () => ({
  getDaemonTcpUrl: jest.fn(() => 'http://127.0.0.1:9876'),
  readDaemonPort: jest.fn(() => 9876)
}));

describe('Daemon port verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Uses runtime expectedPort instead of hardcoded value', () => {
    const ready = { facts: { expectedPort: 8080 } };
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    handleCanonicalSupervisedAction({ ready });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(':8080'));
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining(':9876'));
  });

  test('Fails if expectedPort is not set', () => {
    const ready = { facts: {} };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    handleCanonicalSupervisedAction({ ready });
    expect(errorSpy).toHaveBeenCalledWith('Runtime port not available');
  });
});