#!/usr/bin/env npx tsx
/**
 * Tiny Port Daddy operator workbench.
 *
 * This is intentionally small: it shows how little code is needed to build a
 * useful dev tool on top of Port Daddy's service, agent, session, tunnel,
 * channel, lock, and tuple APIs.
 *
 * Run:
 *   npx tsx examples/devtools/agent-workbench.ts
 *   npx tsx examples/devtools/agent-workbench.ts --json
 */

import { PortDaddy } from '../../lib/client.js';

type SectionRow = Record<string, unknown>;

function wantsJson(): boolean {
  return process.argv.includes('--json');
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function printSection(title: string, rows: SectionRow[], columns: string[]): void {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));

  if (!rows.length) {
    console.log('none');
    return;
  }

  const widths = columns.map((column) => {
    const maxValue = Math.max(...rows.map((row) => text(row[column]).length), column.length);
    return Math.min(Math.max(maxValue, 10), 40);
  });

  console.log(columns.map((column, index) => column.padEnd(widths[index])).join('  '));
  console.log(columns.map((_, index) => '-'.repeat(widths[index])).join('  '));

  for (const row of rows) {
    console.log(columns.map((column, index) => {
      const value = text(row[column]);
      return value.length > widths[index]
        ? `${value.slice(0, widths[index] - 1)}.`
        : value.padEnd(widths[index]);
    }).join('  '));
  }
}

async function main(): Promise<void> {
  const pd = new PortDaddy({ agentId: `examples:workbench:${process.pid}`, timeout: 10000 });

  try {
    const [
      services,
      agents,
      sessions,
      locks,
      tunnels,
      channels,
      tuples,
    ] = await Promise.all([
      pd.listServices(),
      pd.listAgents({ activeOnly: true }),
      pd.sessions({ status: 'active', limit: 12 }),
      pd.listLocks(),
      pd.tunnelList(),
      pd.discoverChannels({ includeObserved: true }),
      pd.tupleScan('examples').catch(() => ({ tuples: [], count: 0 })),
    ]);

    const snapshot = {
      services: services.services.map((service) => ({
        id: service.id,
        port: service.port,
        status: service.status,
        tunnel: service.tunnelUrl,
      })),
      agents: agents.agents.map((agent) => ({
        id: agent.id,
        active: agent.isActive,
        type: agent.type,
      })),
      sessions: sessions.sessions.map((session) => {
        const visibleState = 'phase' in session && typeof session.phase === 'string'
          ? session.phase
          : session.status;
        return {
          id: session.id,
          purpose: session.purpose,
          agent: session.agentId,
          state: visibleState,
        };
      }),
      locks: locks.locks.map((lock) => ({
        name: lock.name,
        owner: lock.owner,
        expires: lock.expiresAt ? new Date(lock.expiresAt).toISOString() : null,
      })),
      tunnels: tunnels.tunnels.map((tunnel) => ({
        service: tunnel.serviceId,
        provider: tunnel.provider,
        status: tunnel.status,
        url: tunnel.url,
      })),
      channels: channels.channels.slice(0, 12).map((channel) => ({
        logical: channel.logicalName,
        scope: channel.scope,
        source: channel.source,
        active: channel.activeCount,
      })),
      tuples: tuples.tuples.slice(0, 12).map((tuple) => ({
        id: tuple.id,
        by: tuple.writtenBy,
        fields: tuple.fields,
      })),
    };

    if (wantsJson()) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    console.log('Port Daddy operator workbench');
    console.log(`Generated: ${new Date().toISOString()}`);

    printSection('Services', snapshot.services, ['id', 'port', 'status', 'tunnel']);
    printSection('Agents', snapshot.agents, ['id', 'type', 'active']);
    printSection('Sessions', snapshot.sessions, ['id', 'state', 'agent', 'purpose']);
    printSection('Locks', snapshot.locks, ['name', 'owner', 'expires']);
    printSection('Tunnels', snapshot.tunnels, ['service', 'provider', 'status', 'url']);
    printSection('Channels', snapshot.channels, ['logical', 'scope', 'source', 'active']);
    printSection('Example Tuples', snapshot.tuples, ['id', 'by', 'fields']);
  } finally {
    pd.destroyIpc();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
