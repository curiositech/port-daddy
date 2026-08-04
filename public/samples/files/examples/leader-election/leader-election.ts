#!/usr/bin/env npx tsx
import { resolveExampleDaemonUrl } from '../_daemon-url.js';

const DAEMON_URL = resolveExampleDaemonUrl();

type LockResponse = {
  success?: boolean;
  error?: string;
  holder?: string;
  owner?: string;
  expiresAt?: number;
};

function argNumber(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(name: string, owner: string, ttlMs: number): Promise<LockResponse> {
  const res = await fetch(`${DAEMON_URL}/locks/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, ttl: ttlMs }),
  });

  const body = (await res.json()) as LockResponse;

  if (!res.ok && res.status !== 409) {
    throw new Error(`lock acquire failed for ${owner}: HTTP ${res.status}`);
  }

  return body;
}

async function releaseLock(name: string, owner: string) {
  const res = await fetch(`${DAEMON_URL}/locks/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner }),
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`lock release failed for ${owner}: HTTP ${res.status}`);
  }
}

async function runWorker(index: number, holdMs: number, ttlMs: number) {
  const worker = `worker-${String(index + 1).padStart(2, '0')}`;
  await sleep(index * 35);

  console.log(`[${worker}] attempting to acquire swarm:leader`);
  const lock = await acquireLock('swarm:leader', worker, ttlMs);

  if (!lock.success) {
    const holder = lock.holder ?? lock.owner ?? 'another worker';
    console.log(`[${worker}] follower mode; leader is ${holder}`);
    return { worker, role: 'follower' as const };
  }

  console.log(`[${worker}] leader elected; holding lock for ${holdMs}ms`);
  try {
    await sleep(holdMs);
    console.log(`[${worker}] leader work complete`);
    return { worker, role: 'leader' as const };
  } finally {
    await releaseLock('swarm:leader', worker);
    console.log(`[${worker}] released swarm:leader`);
  }
}

async function main() {
  const workers = argNumber('--workers', 5);
  const holdMs = argNumber('--hold-ms', 1500);
  const ttlMs = argNumber('--ttl-ms', 10000);

  console.log(`[leader-election] daemon=${DAEMON_URL}`);
  console.log(`[leader-election] workers=${workers} lock=swarm:leader ttl=${ttlMs}ms`);

  const results = await Promise.all(
    Array.from({ length: workers }, (_, index) => runWorker(index, holdMs, ttlMs)),
  );

  const leader = results.find((result) => result.role === 'leader');
  console.log('');
  console.log(`[leader-election] elected=${leader?.worker ?? 'none'} followers=${results.length - (leader ? 1 : 0)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
