/**
 * Tests for lib/daemon-takeover.ts — the half-alive-zombie guard added after
 * the 2026-07-04 incident (brew upgrade left a daemon answering on the unix
 * socket with a dead TCP listener; 345 KeepAlive respawns exited 0 against it).
 */
import { describe, expect, test } from '@jest/globals';
import { decideDuplicateAction, healthBodyIsOk, probeTcpHealth, terminateStalePid } from '../../lib/daemon-takeover.js';

describe('healthBodyIsOk', () => {
  test('compact and pretty-printed ok bodies both count as healthy', () => {
    expect(healthBodyIsOk('{"status":"ok","version":"x"}')).toBe(true);
    expect(healthBodyIsOk('{\n  "status": "ok",\n  "version": "x"\n}')).toBe(true);
    expect(healthBodyIsOk('{"version":"x","status":"ok"}')).toBe(true);
  });

  test('degraded / non-ok status is not healthy', () => {
    expect(healthBodyIsOk('{"status":"degraded"}')).toBe(false);
    expect(healthBodyIsOk('{"status":"error"}')).toBe(false);
    expect(healthBodyIsOk('{}')).toBe(false);
  });

  test('unparseable body falls back to the exact substring', () => {
    expect(healthBodyIsOk('garbage prefix {"status":"ok"')).toBe(true);
    expect(healthBodyIsOk('not json at all')).toBe(false);
  });
});

describe('decideDuplicateAction', () => {
  test('dead socket → clean-start (stale files, boot normally)', () => {
    expect(decideDuplicateAction({ sockAlive: false, tcpAlive: false, tcpDisabled: false })).toBe('clean-start');
    expect(decideDuplicateAction({ sockAlive: false, tcpAlive: true, tcpDisabled: false })).toBe('clean-start');
  });

  test('both surfaces healthy → defer to the running daemon', () => {
    expect(decideDuplicateAction({ sockAlive: true, tcpAlive: true, tcpDisabled: false })).toBe('defer');
  });

  test('socket ok + TCP dead → takeover (the 2026-07-04 zombie signature)', () => {
    expect(decideDuplicateAction({ sockAlive: true, tcpAlive: false, tcpDisabled: false })).toBe('takeover');
  });

  test('TCP-disabled daemons treat a live socket as authoritative', () => {
    expect(decideDuplicateAction({ sockAlive: true, tcpAlive: false, tcpDisabled: true })).toBe('defer');
  });
});

describe('probeTcpHealth', () => {
  const okResponse = { ok: true, text: async () => '{"status":"ok","version":"x"}' };
  const sadResponse = { ok: true, text: async () => '{"status":"degraded"}' };

  test('healthy first try → true, one fetch', async () => {
    const calls = [];
    const fetchImpl = async (url) => { calls.push(url); return okResponse; };
    await expect(probeTcpHealth(9876, { fetchImpl, retryDelayMs: 1 })).resolves.toBe(true);
    expect(calls).toEqual(['http://127.0.0.1:9876/health']);
  });

  test('connection refused every attempt → false after N attempts', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new Error('ECONNREFUSED'); };
    await expect(probeTcpHealth(9876, { fetchImpl, attempts: 3, retryDelayMs: 1 })).resolves.toBe(false);
    expect(calls).toBe(3);
  });

  test('slow daemon that answers on the second attempt is NOT shot', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket hang up');
      return okResponse;
    };
    await expect(probeTcpHealth(9876, { fetchImpl, attempts: 3, retryDelayMs: 1 })).resolves.toBe(true);
    expect(calls).toBe(2);
  });

  test('non-ok health body does not count as alive', async () => {
    const fetchImpl = async () => sadResponse;
    await expect(probeTcpHealth(9876, { fetchImpl, attempts: 2, retryDelayMs: 1 })).resolves.toBe(false);
  });
});

describe('terminateStalePid', () => {
  function makeKillFake({ diesOnTerm }) {
    const state = { alive: true, signals: [] };
    const killImpl = (pid, signal) => {
      if (signal === 0) {
        if (!state.alive) throw new Error('ESRCH');
        return;
      }
      state.signals.push(signal);
      if (signal === 'SIGTERM' && diesOnTerm) state.alive = false;
      if (signal === 'SIGKILL') state.alive = false;
    };
    return { state, killImpl };
  }

  test('refuses self, pid<=1, and NaN', async () => {
    await expect(terminateStalePid(NaN)).resolves.toBe('no-op');
    await expect(terminateStalePid(0)).resolves.toBe('no-op');
    await expect(terminateStalePid(1)).resolves.toBe('no-op');
    await expect(terminateStalePid(process.pid)).resolves.toBe('no-op');
  });

  test('already-dead pid → no-op, no signals sent', async () => {
    const { state, killImpl } = makeKillFake({ diesOnTerm: true });
    state.alive = false;
    await expect(terminateStalePid(4242, { killImpl, graceMs: 50, pollMs: 5 })).resolves.toBe('no-op');
    expect(state.signals).toEqual([]);
  });

  test('cooperative zombie dies on SIGTERM', async () => {
    const { state, killImpl } = makeKillFake({ diesOnTerm: true });
    await expect(terminateStalePid(4242, { killImpl, graceMs: 200, pollMs: 5 })).resolves.toBe('term');
    expect(state.signals).toEqual(['SIGTERM']);
    expect(state.alive).toBe(false);
  });

  test('stubborn zombie gets escalated to SIGKILL after the grace window', async () => {
    const { state, killImpl } = makeKillFake({ diesOnTerm: false });
    await expect(terminateStalePid(4242, { killImpl, graceMs: 60, pollMs: 5 })).resolves.toBe('kill');
    expect(state.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(state.alive).toBe(false);
  });
});
