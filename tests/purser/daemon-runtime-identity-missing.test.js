const { facts, assessRuntimeIdentity } = require('../../lib/daemon-runtime.test');

describe('Adversarial: Missing Identity Facts', () => {
  test('Marks as incomplete when endpointPort is missing', () => {
    const result = assessRuntimeIdentity(facts({ endpointPort: null }));
    expect(result.state).toBe('incomplete');
    expect(result.missing).toContain('published port (daemon.port)');
  });

  test('Handles missing healthPort and portFilePort together', () => {
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

  test('Rejects when supervisor is missing in production', () => {
    const result = assessRuntimeIdentity(facts({ supervisor: null }));
    expect(result.state).toBe('incomplete');
    expect(result.issues).toContain('launchd is not loaded');
  });
});