#!/usr/bin/env npx tsx
/**
 * Port Daddy migration guard.
 *
 * Demonstrates using the SDK `withLock()` helper so only one agent can run a
 * critical migration section at a time.
 *
 * Run:
 *   npx tsx examples/locks/migration-guard.ts
 */

import { PortDaddy } from '../../lib/client.js';

type MigrationStep = {
  name: string;
  ms: number;
};

const steps: MigrationStep[] = [
  { name: 'create users table', ms: 200 },
  { name: 'add unique index on email', ms: 150 },
  { name: 'backfill account flags', ms: 150 },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMigration(agentName: string): Promise<string> {
  const pd = new PortDaddy({ agentId: agentName, timeout: 10000 });
  const begin = await pd.begin('Run example migrations', {
    identity: `examples:migrations:${agentName.split(':').pop()}`,
    metadata: { example: 'migration-guard' },
  });

  try {
    await pd.withLock('examples:db-migrations', async () => {
      await pd.note(`${agentName} acquired examples:db-migrations`, {
        agentId: agentName,
        sessionId: begin.sessionId,
        type: 'example',
      });

      for (const step of steps) {
        console.log(`[${agentName}] ${step.name}`);
        await sleep(step.ms);
      }
    }, {
      owner: agentName,
      ttl: 60000,
      metadata: { example: 'migration-guard' },
    });

    return `${agentName}: ran migrations`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${agentName}: skipped (${message})`;
  } finally {
    await pd.done(`${agentName} finished migration guard example`, {
      agentId: agentName,
      sessionId: begin.sessionId,
    }).catch(() => undefined);
    pd.destroyIpc();
  }
}

async function main(): Promise<void> {
  console.log('Migration guard');
  console.log('---------------');
  console.log('Two agents attempt the same critical section.');
  console.log('');

  const results = await Promise.all([
    runMigration('examples:migrator:alpha'),
    runMigration('examples:migrator:beta'),
  ]);

  console.log('');
  for (const result of results) {
    console.log(result);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
