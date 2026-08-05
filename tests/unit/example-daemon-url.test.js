import { describe, expect, jest, test } from '@jest/globals';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveDaemonUrl } from '../../examples/lib/daemon-url.js';

describe('public example daemon discovery', () => {
  test('uses an explicitly selected named daemon without reading stable state', () => {
    const readPortFile = jest.fn();

    expect(resolveDaemonUrl({ PORT_DADDY_URL: 'http://127.0.0.1:43121/' }, readPortFile))
      .toBe('http://127.0.0.1:43121');
    expect(readPortFile).not.toHaveBeenCalled();
  });

  test('reads the actual published port instead of guessing a default', () => {
    const readPortFile = jest.fn(() => '43121\n');

    expect(resolveDaemonUrl({
      PORT_DADDY_PORT_FILE: '/profiles/feature/daemon.port',
      PORT_DADDY_HOST: 'localhost',
    }, readPortFile)).toBe('http://localhost:43121');
    expect(readPortFile).toHaveBeenCalledWith('/profiles/feature/daemon.port', 'utf8');
  });

  test('uses the stable publication path when no profile path is selected', () => {
    const readPortFile = jest.fn(() => '43121');

    resolveDaemonUrl({}, readPortFile);

    expect(readPortFile).toHaveBeenCalledWith(join(homedir(), '.port-daddy', 'daemon.port'), 'utf8');
  });

  test.each(['', '0', '65536', 'not-a-port', '43121 trailing']) (
    'rejects invalid publication %p',
    (published) => {
      expect(() => resolveDaemonUrl({}, () => published)).toThrow('Invalid Port Daddy port publication');
    },
  );

  test('fails closed when no endpoint has been selected or published', () => {
    expect(() => resolveDaemonUrl({}, () => { throw new Error('missing'); }))
      .toThrow('No Port Daddy endpoint is published');
  });
});
