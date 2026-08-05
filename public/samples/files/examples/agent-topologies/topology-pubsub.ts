#!/usr/bin/env bun

import { resolveDaemonUrl } from '../lib/daemon-url.js';

const DAEMON_URL = resolveDaemonUrl();

type TopologyEvent = {
  topology: 'star' | 'ring' | 'arbiter';
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  at: string;
};

async function publish(channel: string, event: TopologyEvent) {
  const res = await fetch(`${DAEMON_URL}/msg/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: event.actor, payload: event }),
  });

  if (!res.ok) {
    throw new Error(`publish ${channel} failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as { id?: number };
  console.log(`[${channel}] #${data.id ?? '?'} ${event.actor} ${event.action}`);
}

function event(
  topology: TopologyEvent['topology'],
  actor: string,
  action: string,
  payload: Record<string, unknown>,
): TopologyEvent {
  return { topology, actor, action, payload, at: new Date().toISOString() };
}

async function starTopology() {
  await publish('topology:star', event('star', 'coordinator', 'assign', { worker: 'worker-a', task: 'scan routes' }));
  await publish('topology:star', event('star', 'coordinator', 'assign', { worker: 'worker-b', task: 'scan tests' }));
  await publish('topology:star', event('star', 'worker-a', 'complete', { files: ['routes/index.ts'] }));
  await publish('topology:star', event('star', 'worker-b', 'complete', { files: ['tests/unit/routes.test.js'] }));
  await publish('topology:star', event('star', 'coordinator', 'summarize', { status: 'ready for review' }));
}

async function ringTopology() {
  await publish('topology:ring', event('ring', 'phase-1', 'handoff', { next: 'phase-2', artifact: 'inventory.json' }));
  await publish('topology:ring', event('ring', 'phase-2', 'handoff', { next: 'phase-3', artifact: 'patch.diff' }));
  await publish('topology:ring', event('ring', 'phase-3', 'handoff', { next: 'done', artifact: 'validation.txt' }));
}

async function arbiterTopology() {
  await publish('topology:arbiter', event('arbiter', 'worker', 'submit', { change: 'lock guard patch' }));
  await publish('topology:arbiter', event('arbiter', 'arbiter', 'review', { checks: ['tests', 'diff-check'] }));
  await publish('topology:arbiter', event('arbiter', 'arbiter', 'accept', { releaseLock: 'feature:lock-guard' }));
}

async function main() {
  console.log(`[agent-topologies] daemon=${DAEMON_URL}`);
  await starTopology();
  await ringTopology();
  await arbiterTopology();
  console.log('[agent-topologies] inspect with: pd channels');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
