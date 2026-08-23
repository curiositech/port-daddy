import {
  configuredDaemonUrl,
  configuredDaemonUnavailableMessage,
  hasExplicitDaemonEndpoint,
  isLoopbackDaemonUrl,
  shouldAutoStartLocalDaemon,
} from '../../cli/utils/remote-daemon.js';

describe('remote daemon recovery boundary', () => {
  test('only the implicit loopback daemon may auto-start', () => {
    expect(shouldAutoStartLocalDaemon('', {})).toBe(true);
    expect(shouldAutoStartLocalDaemon('http://127.0.0.1:9876', {})).toBe(true);
    expect(shouldAutoStartLocalDaemon('http://localhost:9876', {})).toBe(true);
    expect(shouldAutoStartLocalDaemon('https://relay.example', {})).toBe(false);
    expect(shouldAutoStartLocalDaemon('http://127.0.0.1:9877', {
      PORT_DADDY_URL: 'http://127.0.0.1:9877',
    })).toBe(false);
    expect(shouldAutoStartLocalDaemon('http://127.0.0.1:9877', {
      PORT_DADDY_PROFILE: 'cloud-peer',
    })).toBe(false);
  });

  test('explicit endpoint detection ignores freshness-only controls', () => {
    expect(hasExplicitDaemonEndpoint({ PD_URL: 'https://pd.example' })).toBe(true);
    expect(hasExplicitDaemonEndpoint({ PORT_DADDY_URL: 'https://pd.example' })).toBe(true);
    expect(hasExplicitDaemonEndpoint({ PORT_DADDY_PROFILE: 'cloud' })).toBe(true);
    expect(hasExplicitDaemonEndpoint({ PORT_DADDY_SKIP_FRESHNESS_CHECK: '1' })).toBe(false);
  });

  test('PD_URL is the transport alias of record and wins over PORT_DADDY_URL', () => {
    expect(configuredDaemonUrl({ PD_URL: ' https://peer.example ', PORT_DADDY_URL: 'http://local.invalid' }))
      .toBe('https://peer.example');
    expect(configuredDaemonUrl({ PORT_DADDY_URL: ' http://127.0.0.1:9877 ' }))
      .toBe('http://127.0.0.1:9877');
    expect(configuredDaemonUrl({ PD_URL: '   ' })).toBeUndefined();
  });

  test('loopback recognition is strict and unavailable copy promises no local replacement', () => {
    expect(isLoopbackDaemonUrl('http://[::1]:9876')).toBe(true);
    expect(isLoopbackDaemonUrl('https://127.0.0.1.example')).toBe(false);
    expect(isLoopbackDaemonUrl('not a url')).toBe(false);
    expect(configuredDaemonUnavailableMessage('https://pd.example/health')).toBe(
      'Configured Port Daddy peer at https://pd.example is unavailable; no local daemon was started.',
    );
  });
});
