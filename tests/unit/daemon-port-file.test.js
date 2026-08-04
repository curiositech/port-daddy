import { afterEach, describe, expect, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { publishDaemonEndpoint } from '../../lib/daemon-port-file.js';

const scratchRoot = join(homedir(), 'coding', 'tmp');
const scratchDirs = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('daemon port publication', () => {
  test('atomically replaces the published port without leaving a partial file', () => {
    mkdirSync(scratchRoot, { recursive: true });
    const dir = mkdtempSync(join(scratchRoot, 'pd-daemon-port-file-'));
    scratchDirs.push(dir);
    const portFile = join(dir, 'daemon.port');

    const env = {};
    publishDaemonEndpoint(portFile, 4319, env);
    expect(readFileSync(portFile, 'utf8')).toBe('4319');
    expect(env).toEqual({
      PORT_DADDY_PORT: '4319',
      PORT_DADDY_URL: 'http://127.0.0.1:4319',
    });
    publishDaemonEndpoint(portFile, 4320, env);

    expect(existsSync(portFile)).toBe(true);
    expect(readFileSync(portFile, 'utf8')).toBe('4320');
    expect(env.PORT_DADDY_URL).toBe('http://127.0.0.1:4320');
    expect(readdirSync(dir)).toEqual(['daemon.port']);
  });

  test('refuses invalid values before touching the filesystem', () => {
    expect(() => publishDaemonEndpoint('/definitely/not/written', 0)).toThrow(/invalid daemon port/);
  });
});
