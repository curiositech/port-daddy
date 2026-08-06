const { facts, assessRuntimeIdentity } = require('../../lib/daemon-runtime.test');
const { DEFAULT_DAEMON_PORT } = require('../../shared/daemon-discovery.js');

describe('Adversarial: Runtime Identity Convergence', () => {
  test('Rejects when expectedPort is null despite other identity markers', () => {
    const result = assessRuntimeIdentity(facts({ expectedPort: null }));
    expect(result.state).toBe('incomplete');
    expect(result.missing).toContain('published port (daemon.port)');
  });

  test('Detects port drift between endpoint and actual listening port', () => {
    const result = assessRuntimeIdentity(facts({
      endpointPort: DEFAULT_DAEMON_PORT + 1,
      healthPort: DEFAULT_DAEMON_PORT,
      portFilePort: DEFAULT_DAEMON_PORT
    }));
    expect(result.state).toBe('diverged');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining(`endpoint used port ${DEFAULT_DAEMON_PORT + 1}`),
      expect.stringContaining(`daemon advertised port ${DEFAULT_DAEMON_PORT}`)
    ]));
  });

  test('Fails when supervisor PID mismatches health PID', () => {
    const result = assessRuntimeIdentity(facts({
      supervisor: { ...facts().supervisor, pid: 9999 }
    }));
    expect(result.state).toBe('diverged');
    expect(result.issues).toContain('launchd PID 9999 differs from /health PID 4242');
  });

  test('Handles null/undefined port file content gracefully', () => {
    const result = assessRuntimeIdentity(facts({ portFilePort: null }));
    expect(result.state).toBe('incomplete');
    expect(result.missing).toContain('daemon.port');
  });

  test('Enforces strict port agreement in production configurations', () => {
    const result = assessRuntimeIdentity(facts({
      endpointPort: DEFAULT_DAEMON_PORT + 1,
      portFilePort: DEFAULT_DAEMON_PORT
    }));
    expect(result.state).toBe('diverged');
    expect(result.issues).toContain(`daemon.port contains ${DEFAULT_DAEMON_PORT}, expected ${DEFAULT_DAEMON_PORT + 1}`);
  });

  test('Rejects when any required identity fact is missing', () => {
    const result = assessRuntimeIdentity(facts({
      healthPort: null,
      portFilePort: null
    }));
    expect(result.state).toBe('incomplete');
    expect(result.missing).toEqual(expect.arrayContaining([
      'daemon advertised port',
      'daemon.port'
    ]));
  });
});