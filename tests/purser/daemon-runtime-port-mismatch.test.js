const { facts, assessRuntimeIdentity } = require('../../lib/daemon-runtime.test');
const { DEFAULT_DAEMON_PORT } = require('../../shared/daemon-discovery.js');

describe('Adversarial: Port Mismatch Scenarios', () => {
  test('Different endpoint port than health port', () => {
    const result = assessRuntimeIdentity(facts({
      endpointPort: DEFAULT_DAEMON_PORT + 1,
      healthPort: DEFAULT_DAEMON_PORT
    }));
    expect(result.state).toBe('diverged');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining(`endpoint used port ${DEFAULT_DAEMON_PORT + 1}`),
      expect.stringContaining(`daemon advertised port ${DEFAULT_DAEMON_PORT}`)
    ]));
  });

  test('Port file differs from endpoint and health ports', () => {
    const result = assessRuntimeIdentity(facts({
      endpointPort: DEFAULT_DAEMON_PORT + 2,
      healthPort: DEFAULT_DAEMON_PORT + 3,
      portFilePort: DEFAULT_DAEMON_PORT
    }));
    expect(result.state).toBe('diverged');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining(`endpoint used port ${DEFAULT_DAEMON_PORT + 2}`),
      expect.stringContaining(`daemon advertised port ${DEFAULT_DAEMON_PORT + 3}`),
      expect.stringContaining(`daemon.port contains ${DEFAULT_DAEMON_PORT}, expected ${DEFAULT_DAEMON_PORT + 2}`)
    ]));
  });
});