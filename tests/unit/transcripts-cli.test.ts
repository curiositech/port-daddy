import { describe, expect, test } from '@jest/globals';

import { resolveTranscriptStreamUrl } from '../../cli/commands/transcripts.js';

describe('transcript stream endpoint discovery', () => {
  test('builds the stream URL only from an explicit HTTP endpoint', () => {
    expect(resolveTranscriptStreamUrl('http://127.0.0.1:4319'))
      .toBe('http://127.0.0.1:4319/transcripts/stream');
  });

  test('rediscovers a strictly published port without guessing the preferred seed', () => {
    expect(resolveTranscriptStreamUrl(undefined, {
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => '4320\n',
    })).toBe('http://127.0.0.1:4320/transcripts/stream');
  });

  test('fails closed when no endpoint is published or TLS is unsupported', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(() => resolveTranscriptStreamUrl(undefined, {
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => { throw missing; },
    })).toThrow(expect.objectContaining({ code: 'ENDPOINT_NOT_PUBLISHED' }));
    expect(() => resolveTranscriptStreamUrl('https://127.0.0.1:4319'))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_DAEMON_URL' }));
  });
});
