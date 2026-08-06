const { resolveRuntimeIdentityScope } = require('../../lib/daemon-runtime');
const { DEFAULT_DAEMON_PORT } = require('../../shared/daemon-discovery.js');

describe('Adversarial: Runtime Identity Scope', () => {
  test('Production scope strictly follows selected endpoint port', () => {
    const scope = resolveRuntimeIdentityScope({
      plane: 'prod',
      daemon: { port: DEFAULT_DAEMON_PORT + 1, canonical: true },
      runtimePrefix: '/work/isolated',
      canonicalSupervisor: { label: 'test', pid: 1234 }
    });
    expect(scope.expectedPort).toBe(DEFAULT_DAEMON_PORT + 1);
  });

  test('Named instance scope isolates files without production supervisor', () => {
    const scope = resolveRuntimeIdentityScope({
      plane: 'named',
      daemon: { port: DEFAULT_DAEMON_PORT + 2, canonical: false },
      runtimePrefix: '/work/named',
      canonicalSupervisor: null
    });
    expect(scope.expectedPort).toBe(DEFAULT_DAEMON_PORT + 2);
    expect(scope.supervisor).toBeNull();
  });

  test('Rejects invalid port values in scope resolution', () => {
    expect(() => resolveRuntimeIdentityScope({
      plane: 'prod',
      daemon: { port: 'invalid', canonical: true },
      runtimePrefix: '/work/invalid',
      canonicalSupervisor: { label: 'test', pid: 1234 }
    })).toThrowError('Invalid port value');
  });

  test('Ensures production files are strictly isolated', () => {
    const scope = resolveRuntimeIdentityScope({
      plane: 'prod',
      daemon: { port: DEFAULT_DAEMON_PORT, canonical: true },
      runtimePrefix: '/work/invalid',
      canonicalSupervisor: { label: 'test', pid: 1234 }
    });
    expect(scope.pidFile).toMatch(/\/work\/invalid\/daemon\.pid$/);
    expect(scope.portFile).toMatch(/\/work\/invalid\/daemon\.port$/);
  });
});