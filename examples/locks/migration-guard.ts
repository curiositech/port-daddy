/**
 * Port Daddy — Migration Guard with Distributed Locks
 *
 * Demonstrates using locks to ensure only one agent
 * runs database migrations at a time.
 *
 * Run: npx tsx examples/locks/migration-guard.ts
 */

const BASE = 'http://localhost:9876';

interface Lock {
  name: string;
  owner: string;
  ttl: number;
  acquired: boolean;
  held?: boolean;
}

async function acquireLock(name: string, owner: string, ttl = 300000): Promise<Lock> {
  const res = await fetch(`${BASE}/locks/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, ttl }),
  });
  return res.json();
}

async function releaseLock(name: string, owner: string): Promise<void> {
  await fetch(`${BASE}/locks/${name}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner }),
  });
}

async function runMigration(agentName: string): Promise<void> {
  const lockName = 'db-migrations';
  console.log(`[${agentName}] Attempting to acquire migration lock...`);

  const lock = await acquireLock(lockName, agentName, 60000);

  if (!lock.acquired) {
    console.log(`[${agentName}] Lock held by another agent. Skipping migrations.`);
    return;
  }

  console.log(`[${agentName}] Lock acquired! Running migrations...`);

  try {
    // Simulate migration work
    console.log(`[${agentName}]   Creating users table...`);
    await new Promise(r => setTimeout(r, 500));
    console.log(`[${agentName}]   Adding index on email...`);
    await new Promise(r => setTimeout(r, 300));
    console.log(`[${agentName}]   Migrations complete!`);
  } finally {
    await releaseLock(lockName, agentName);
    console.log(`[${agentName}] Lock released.`);
  }
}

async function main() {
  console.log('=== Migration Guard Demo ===\n');

  // Simulate two agents trying to run migrations concurrently
  console.log('Two agents attempt migrations simultaneously:\n');

  await Promise.all([
    runMigration('agent-alpha'),
    runMigration('agent-beta'),
  ]);

  console.log('\nOnly one agent ran migrations. The other was safely skipped.');
}

main().catch(console.error);
