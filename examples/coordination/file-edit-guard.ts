#!/usr/bin/env npx tsx
/**
 * File Edit Guard
 *
 * A real, working example of multi-agent file coordination.
 *
 * Before editing a file, run this to:
 * 1. Check if another agent is editing it
 * 2. Claim the file for your edits
 * 3. Notify when you're done
 *
 * Usage:
 *   # Check and claim
 *   ./file-edit-guard.ts claim src/api/users.ts "Adding null check"
 *
 *   # Release when done
 *   ./file-edit-guard.ts release src/api/users.ts
 *
 *   # Watch for edits to a file
 *   ./file-edit-guard.ts watch src/api/users.ts
 */

import { PortDaddy } from '../../lib/client.js';

const client = new PortDaddy();
const agentId = process.env.AGENT_ID ?? `agent-${process.pid}`;

function fileChannel(path: string): string {
  return `file:${path.replace(/\//g, ':')}:edits`;
}

function fileLockName(path: string): string {
  // Lock names must be alphanumeric with dashes, underscores, or colons
  // Replace / with - and . with _
  return `file-edit:${path.replace(/\//g, '-').replace(/\./g, '_')}`;
}

async function claim(filePath: string, intent: string) {
  const channel = fileChannel(filePath);
  const lockName = fileLockName(filePath);

  // Try to acquire lock
  const lockResult = await client.lock(lockName, { ttl: 3600000 }); // 1 hour

  if (!lockResult.success) {
    // Someone else has it - check who
    const locks = await client.listLocks();
    const holder = locks.locks?.find((l: { name: string }) => l.name === lockName);

    if (holder) {
      console.error(`❌ File is being edited by another agent`);
      console.error(`   Holder: ${(holder as { owner: string }).owner}`);
      console.error(`   Since: ${new Date((holder as { acquiredAt: number }).acquiredAt).toISOString()}`);

      // Check recent messages for context
      const messages = await client.getMessages(channel, { limit: 5 });
      if (messages.messages?.length) {
        console.error(`\n   Recent activity:`);
        for (const msg of messages.messages) {
          const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
          console.error(`   - ${payload.message}`);
        }
      }
      process.exit(1);
    }
  }

  // Got the lock - announce our claim
  await client.publish(channel, {
    agent: agentId,
    type: 'claim',
    message: `Editing: ${intent}`,
    data: { file: filePath, intent },
    ts: Date.now(),
  });

  console.log(`✅ Claimed ${filePath}`);
  console.log(`   Intent: ${intent}`);
  console.log(`   Release with: ./file-edit-guard.ts release ${filePath}`);
}

async function release(filePath: string) {
  const channel = fileChannel(filePath);
  const lockName = fileLockName(filePath);

  await client.unlock(lockName);
  await client.publish(channel, {
    agent: agentId,
    type: 'release',
    message: `Finished editing`,
    data: { file: filePath },
    ts: Date.now(),
  });

  // Record in permanent memory
  await client.note(`Edited ${filePath}`, { type: 'file-edit' });

  console.log(`✅ Released ${filePath}`);
}

async function watch(filePath: string) {
  const channel = fileChannel(filePath);

  console.log(`👀 Watching edits to ${filePath}`);
  console.log(`   Channel: ${channel}`);
  console.log(`   Press Ctrl+C to stop\n`);

  // Poll for messages (in a real implementation, use SSE)
  let lastId = 0;
  setInterval(async () => {
    try {
      const messages = await client.getMessages(channel, { since: lastId, limit: 10 });
      for (const msg of messages.messages ?? []) {
        if (msg.id > lastId) {
          lastId = msg.id;
          const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : msg.payload;
          const icon = payload.type === 'claim' ? '🔒' : payload.type === 'release' ? '🔓' : '📝';
          console.log(`${icon} [${payload.agent}] ${payload.message}`);
        }
      }
    } catch {
      // Ignore polling errors
    }
  }, 1000);
}

async function status(filePath: string) {
  const lockName = fileLockName(filePath);
  const locks = await client.listLocks();
  const holder = locks.locks?.find((l: { name: string }) => l.name === lockName);

  if (holder) {
    console.log(`🔒 ${filePath} is being edited`);
    console.log(`   By: ${(holder as { owner: string }).owner}`);
    console.log(`   Since: ${new Date((holder as { acquiredAt: number }).acquiredAt).toISOString()}`);
  } else {
    console.log(`✅ ${filePath} is available`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const [, , command, filePath, ...rest] = process.argv;

if (!command || !filePath) {
  console.log(`
File Edit Guard - Multi-agent file coordination

Usage:
  ./file-edit-guard.ts claim <file> <intent>   Claim a file before editing
  ./file-edit-guard.ts release <file>          Release when done editing
  ./file-edit-guard.ts status <file>           Check if file is being edited
  ./file-edit-guard.ts watch <file>            Watch for edits to a file

Environment:
  AGENT_ID    Your agent identifier (default: agent-<pid>)

Examples:
  AGENT_ID=claude-1 ./file-edit-guard.ts claim src/api/users.ts "Adding auth check"
  AGENT_ID=claude-1 ./file-edit-guard.ts release src/api/users.ts
`);
  process.exit(1);
}

switch (command) {
  case 'claim':
    claim(filePath, rest.join(' ') || 'editing').catch(console.error);
    break;
  case 'release':
    release(filePath).catch(console.error);
    break;
  case 'status':
    status(filePath).catch(console.error);
    break;
  case 'watch':
    watch(filePath).catch(console.error);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
