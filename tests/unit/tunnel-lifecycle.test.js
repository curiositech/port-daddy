/**
 * Tunnel Module — Lifecycle Tests
 *
 * Covers the uncovered paths in tunnel.ts:
 * - start() happy path with mocked spawn (URL extraction per provider)
 * - start() with already-active tunnel (cached URL, starting state)
 * - start() timeout when URL never arrives
 * - Process exit handler (auto-cleanup)
 * - stop() with live tunnel process (kill + cleanup)
 * - status() for running vs starting tunnels
 * - list() with active tunnels
 * - stopAll() with multiple active tunnels
 *
 * Uses jest.unstable_mockModule to mock child_process.spawn in ESM.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { createTestDb } from '../setup-unit.js';

// ---------------------------------------------------------------------------
// Mock child_process.spawn
// ---------------------------------------------------------------------------

let mockProc;

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn(() => {
    proc.emit('exit', 0);
  });
  proc.pid = 99999;
  return proc;
}

jest.unstable_mockModule('child_process', () => ({
  spawn: jest.fn(() => {
    mockProc = createMockProcess();
    return mockProc;
  }),
}));

const { spawn: cpSpawn } = await import('child_process');
const { createTunnel } = await import('../../lib/tunnel.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertService(db, id, port = 3100) {
  db.prepare(`
    INSERT INTO services (id, port, status, created_at, last_seen)
    VALUES (?, ?, 'assigned', ?, ?)
  `).run(id, port, Date.now(), Date.now());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tunnel Lifecycle (mocked spawn)', () => {
  let db;
  let tunnel;

  beforeEach(() => {
    db = createTestDb();
    tunnel = createTunnel(db);
    cpSpawn.mockClear();
    mockProc = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ====================================================================
  // start() — happy path: ngrok URL extraction
  // ====================================================================
  describe('start() — ngrok happy path', () => {
    it('should spawn ngrok and extract URL from stdout', async () => {
      insertService(db, 'ngrok-svc', 4000);

      // checkProvider will also use spawn (for `which ngrok`)
      // First call: `which ngrok` → exit 0
      // Second call: `ngrok http 4000 ...` → the tunnel process
      let callCount = 0;
      cpSpawn.mockImplementation((cmd, args) => {
        callCount++;
        const proc = createMockProcess();
        if (cmd === 'which') {
          // Simulate provider found
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        // ngrok tunnel process
        mockProc = proc;
        // Simulate URL output after small delay
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from('t=2024 lvl=info msg="started tunnel" url=https://abc123.ngrok.io\n'));
        });
        return proc;
      });

      const result = await tunnel.start('ngrok-svc', 'ngrok');

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://abc123.ngrok.io');

      // Verify ngrok was spawned with correct args
      const tunnelCall = cpSpawn.mock.calls.find(c => c[0] === 'ngrok');
      expect(tunnelCall).toBeDefined();
      expect(tunnelCall[1]).toContain('4000');

      // Verify DB was updated
      const row = db.prepare('SELECT tunnel_provider, tunnel_url FROM services WHERE id = ?').get('ngrok-svc');
      expect(row.tunnel_provider).toBe('ngrok');
      expect(row.tunnel_url).toBe('https://abc123.ngrok.io');
    });

    it('should return cached URL for already-running tunnel', async () => {
      insertService(db, 'cached-svc', 4001);

      let callCount = 0;
      cpSpawn.mockImplementation((cmd) => {
        callCount++;
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from('url=https://cached.ngrok.io\n'));
        });
        return proc;
      });

      const first = await tunnel.start('cached-svc', 'ngrok');
      expect(first.success).toBe(true);

      // Second call should return cached URL without spawning again
      const second = await tunnel.start('cached-svc', 'ngrok');
      expect(second.success).toBe(true);
      expect(second.url).toBe('https://cached.ngrok.io');
    });

    it('clears the startup timeout once the URL is resolved', async () => {
      insertService(db, 'timer-cleanup-svc', 4003);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      try {
        cpSpawn.mockImplementation((cmd) => {
          const proc = createMockProcess();
          if (cmd === 'which') {
            process.nextTick(() => proc.emit('close', 0));
            return proc;
          }
          mockProc = proc;
          process.nextTick(() => {
            proc.stdout.emit('data', Buffer.from('url=https://timer-cleanup.ngrok.io\n'));
          });
          return proc;
        });

        const result = await tunnel.start('timer-cleanup-svc', 'ngrok');

        expect(result.success).toBe(true);
        expect(result.url).toBe('https://timer-cleanup.ngrok.io');

        const timeoutCallIndex = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === 30000);
        expect(timeoutCallIndex).toBeGreaterThanOrEqual(0);

        const timeoutHandle = setTimeoutSpy.mock.results[timeoutCallIndex]?.value;
        expect(clearTimeoutSpy.mock.calls.some(([handle]) => handle === timeoutHandle)).toBe(true);
      } finally {
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      }
    });

    it('should return error when tunnel is still starting (no URL yet)', async () => {
      insertService(db, 'starting-svc', 4002);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        // Never emit URL — simulate slow startup
        // But we need the start() call to not block forever, so we set a short timeout
        return proc;
      });

      // Start the tunnel but don't await — it will hang waiting for URL
      const startPromise = tunnel.start('starting-svc', 'ngrok');

      // Give time for the tunnel to be registered as activeTunnels
      await new Promise(r => setTimeout(r, 50));

      // Second call while first is still starting
      const second = await tunnel.start('starting-svc', 'ngrok');
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/starting.*wait/i);

      // Clean up: emit URL so the first promise resolves
      if (mockProc) {
        mockProc.stdout.emit('data', Buffer.from('url=https://finally.ngrok.io\n'));
      }
      await startPromise;
    });
  });

  // ====================================================================
  // start() — cloudflared URL extraction
  // ====================================================================
  describe('start() — cloudflared happy path', () => {
    it('should extract trycloudflare.com URL from stderr', async () => {
      insertService(db, 'cf-svc', 4100);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        process.nextTick(() => {
          proc.stderr.emit('data', Buffer.from('INF |  https://wild-meadow-1234.trycloudflare.com\n'));
        });
        return proc;
      });

      const result = await tunnel.start('cf-svc', 'cloudflared');
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://wild-meadow-1234.trycloudflare.com');
    });
  });

  // ====================================================================
  // start() — localtunnel URL extraction
  // ====================================================================
  describe('start() — localtunnel happy path', () => {
    it('should extract loca.lt URL from stdout', async () => {
      insertService(db, 'lt-svc', 4200);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from('your url is: https://wild-fox.loca.lt\n'));
        });
        return proc;
      });

      const result = await tunnel.start('lt-svc', 'localtunnel');
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://wild-fox.loca.lt');
    });
  });

  // ====================================================================
  // start() — timeout
  // ====================================================================
  describe('start() — timeout', () => {
    it('should fail and kill process when URL is not received in time', async () => {
      insertService(db, 'timeout-svc', 4300);

      let tunnelProc;
      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        tunnelProc = proc;
        // Never emit URL — timeout will fire
        return proc;
      });

      const result = await tunnel.start('timeout-svc', 'ngrok');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout/i);
      expect(tunnelProc.kill).toHaveBeenCalled();
    }, 35000);
  });

  // ====================================================================
  // start() — spawn errors
  // ====================================================================
  describe('start() — spawn errors', () => {
    it('should handle ngrok stderr errors', async () => {
      insertService(db, 'err-svc', 4400);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        process.nextTick(() => {
          proc.stderr.emit('data', Buffer.from('ERR_NGROK_108: auth token invalid'));
        });
        return proc;
      });

      const result = await tunnel.start('err-svc', 'ngrok');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ERR_NGROK_108');
    });

    it('should handle ngrok exit with non-zero code', async () => {
      insertService(db, 'exit-svc', 4401);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        // Override kill so exit doesn't auto-fire from our helper
        proc.kill = jest.fn();
        process.nextTick(() => {
          proc.emit('exit', 1);
        });
        return proc;
      });

      const result = await tunnel.start('exit-svc', 'ngrok');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ngrok exited with code 1');
    });

    it('should handle cloudflared exit with non-zero code', async () => {
      insertService(db, 'cf-exit-svc', 4402);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        proc.kill = jest.fn();
        process.nextTick(() => {
          proc.emit('exit', 2);
        });
        return proc;
      });

      const result = await tunnel.start('cf-exit-svc', 'cloudflared');
      expect(result.success).toBe(false);
      expect(result.error).toContain('cloudflared exited with code 2');
    });

    it('should handle localtunnel stderr error', async () => {
      insertService(db, 'lt-err-svc', 4403);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        process.nextTick(() => {
          proc.stderr.emit('data', Buffer.from('error: connection refused'));
        });
        return proc;
      });

      const result = await tunnel.start('lt-err-svc', 'localtunnel');
      expect(result.success).toBe(false);
      expect(result.error).toContain('connection refused');
    });

    it('should handle spawn error event', async () => {
      insertService(db, 'spawn-err-svc', 4404);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        mockProc = proc;
        proc.kill = jest.fn();
        process.nextTick(() => {
          proc.emit('error', new Error('ENOENT'));
        });
        return proc;
      });

      const result = await tunnel.start('spawn-err-svc', 'ngrok');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });
  });

  // ====================================================================
  // Process exit handler — auto cleanup
  // ====================================================================
  describe('process exit handler', () => {
    it('should remove tunnel from activeTunnels when process exits unexpectedly', async () => {
      insertService(db, 'exit-cleanup-svc', 4500);

      let tunnelProc;
      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        tunnelProc = proc;
        proc.kill = jest.fn(); // don't auto-fire exit from our helper
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from('url=https://exit-test.ngrok.io\n'));
        });
        return proc;
      });

      const result = await tunnel.start('exit-cleanup-svc', 'ngrok');
      expect(result.success).toBe(true);

      // Tunnel is active
      expect(tunnel.list()).toHaveLength(1);
      expect(tunnel.status('exit-cleanup-svc').status).toBe('running');

      // Simulate process exit
      tunnelProc.emit('exit', 0);

      // Tunnel should be cleaned up
      expect(tunnel.list()).toHaveLength(0);
      expect(tunnel.status('exit-cleanup-svc').status).toBe('stopped');

      // DB tunnel columns should be cleared
      const row = db.prepare('SELECT tunnel_provider, tunnel_url FROM services WHERE id = ?').get('exit-cleanup-svc');
      expect(row.tunnel_provider).toBeNull();
      expect(row.tunnel_url).toBeNull();
    });
  });

  // ====================================================================
  // stop() with active process
  // ====================================================================
  describe('stop() with active tunnel', () => {
    it('should kill the process and clean up DB', async () => {
      insertService(db, 'stop-active', 4600);

      let tunnelProc;
      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        tunnelProc = proc;
        proc.kill = jest.fn(); // Don't auto-emit exit
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from('url=https://stop-me.ngrok.io\n'));
        });
        return proc;
      });

      await tunnel.start('stop-active', 'ngrok');
      expect(tunnel.list()).toHaveLength(1);

      const result = tunnel.stop('stop-active');
      expect(result.success).toBe(true);
      expect(tunnelProc.kill).toHaveBeenCalled();
      expect(tunnel.list()).toHaveLength(0);
    });
  });

  // ====================================================================
  // status() for active tunnels
  // ====================================================================
  describe('status() for active tunnels', () => {
    it('should return running status with URL and PID', async () => {
      insertService(db, 'status-run', 4700);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        proc.kill = jest.fn();
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from('url=https://status.ngrok.io\n'));
        });
        return proc;
      });

      await tunnel.start('status-run', 'ngrok');

      const s = tunnel.status('status-run');
      expect(s.status).toBe('running');
      expect(s.url).toBe('https://status.ngrok.io');
      expect(s.provider).toBe('ngrok');
      expect(s.port).toBe(4700);
      expect(s.pid).toBe(99999);
      expect(typeof s.startedAt).toBe('number');
    });

    it('should return starting status when URL not yet received', async () => {
      insertService(db, 'status-start', 4701);

      let tunnelProc;
      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        tunnelProc = proc;
        proc.kill = jest.fn();
        // Don't emit URL — starting state
        return proc;
      });

      // Don't await — it will block waiting for URL
      const startPromise = tunnel.start('status-start', 'ngrok');
      await new Promise(r => setTimeout(r, 50));

      const s = tunnel.status('status-start');
      expect(s.status).toBe('starting');
      expect(s.url).toBeNull();

      // Clean up
      tunnelProc.stdout.emit('data', Buffer.from('url=https://done.ngrok.io\n'));
      await startPromise;
    });
  });

  // ====================================================================
  // list() with active tunnels
  // ====================================================================
  describe('list() with active tunnels', () => {
    it('should return all active tunnels with correct fields', async () => {
      insertService(db, 'list-a', 4800);
      insertService(db, 'list-b', 4801);

      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        proc.kill = jest.fn();
        const port = cmd === 'ngrok' ? '4800' : '4801';
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(`url=https://list-${port}.ngrok.io\n`));
        });
        return proc;
      });

      await tunnel.start('list-a', 'ngrok');
      await tunnel.start('list-b', 'ngrok');

      const tunnels = tunnel.list();
      expect(tunnels).toHaveLength(2);

      const ids = tunnels.map(t => t.serviceId).sort();
      expect(ids).toEqual(['list-a', 'list-b']);

      for (const t of tunnels) {
        expect(t.status).toBe('running');
        expect(t.provider).toBe('ngrok');
        expect(t.url).toBeTruthy();
        expect(typeof t.pid).toBe('number');
        expect(typeof t.startedAt).toBe('number');
      }
    });
  });

  // ====================================================================
  // stopAll() with active tunnels
  // ====================================================================
  describe('stopAll() with active tunnels', () => {
    it('should kill all processes and return count', async () => {
      insertService(db, 'all-a', 4900);
      insertService(db, 'all-b', 4901);

      const procs = [];
      cpSpawn.mockImplementation((cmd) => {
        const proc = createMockProcess();
        if (cmd === 'which') {
          process.nextTick(() => proc.emit('close', 0));
          return proc;
        }
        proc.kill = jest.fn();
        procs.push(proc);
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from('url=https://killme.ngrok.io\n'));
        });
        return proc;
      });

      await tunnel.start('all-a', 'ngrok');
      await tunnel.start('all-b', 'ngrok');

      expect(tunnel.list()).toHaveLength(2);

      const count = tunnel.stopAll();
      expect(count).toBe(2);
      expect(tunnel.list()).toHaveLength(0);

      // All processes should have been killed
      for (const p of procs) {
        expect(p.kill).toHaveBeenCalled();
      }

      // DB should be cleared
      for (const id of ['all-a', 'all-b']) {
        const row = db.prepare('SELECT tunnel_url FROM services WHERE id = ?').get(id);
        expect(row.tunnel_url).toBeNull();
      }
    });
  });
});
