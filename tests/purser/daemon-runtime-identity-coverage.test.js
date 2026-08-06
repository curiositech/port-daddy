const { facts, assessRuntimeIdentity } = require('../../lib/daemon-runtime.test');
const { DEFAULT_DAEMON_PORT } = require('../../shared/daemon-discovery.js');

describe('Adversarial: Coverage Verification', () => {
  test('Tests missing expectedPort handling', () => {
    const result = assessRuntimeIdentity(facts({ expectedPort: null }));
    expect(result.state).toBe('incomplete');
    expect(result.missing).toContain('published port (daemon.port)');
  });

  test('Tests port drift detection', () => {
    const result = assessRuntimeIdentity(facts({
      endpointPort: DEFAULT_DAEMON_PORT + 1,
      healthPort: DEFAULT_DAEMON_PORT,
      portFilePort: DEFAULT_DAEMON_PORT
    }));
    expect(result.state).toBe('diverged');
    expect(result.issues).toContain(`endpoint used port ${DEFAULT_DAEMON_PORT + 1}`);
  });

  test('Tests supervisor ownership assertions', () => {
    const result = assessRuntimeIdentity(facts({
      supervisor: { label: 'test', pid: 9999, loaded: true, running: true }
    }));
    expect(result.state).toBe('converged');
    expect(result.summary).toContain('PID 4242');
  });
});