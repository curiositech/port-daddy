/**
 * CLI Webhook Commands
 *
 * Handles: webhook command for webhook management
 */

import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { separator, tableHeader } from '../utils/output.js';
import type { PdFetchResponse } from '../utils/fetch.js';

/**
 * Handle `pd webhook <subcommand>` command
 */
export async function handleWebhook(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (!subcommand || subcommand === 'list') {
    // List all webhooks
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/webhooks`);
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to list webhooks'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const hooks = data.webhooks as Array<{ id: string; url: string; events: string[]; active: boolean }>;
    if (!hooks || hooks.length === 0) {
      console.log('No webhooks registered');
      return;
    }
    console.log('');
    console.log(tableHeader(['ID', 20], ['URL', 40], ['EVENTS', 20], ['ACTIVE', 8]));
    separator(88);
    for (const h of hooks) {
      console.log(
        (h.id || '-').slice(0, 19).padEnd(20) +
        (h.url || '-').slice(0, 39).padEnd(40) +
        (h.events?.join(',') || '*').slice(0, 19).padEnd(20) +
        (h.active ? 'yes' : 'no').padEnd(8)
      );
    }
    console.log('');
    return;
  }

  if (subcommand === 'events') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/webhooks/events`);
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to list webhook events'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const events = data.events as string[];
      console.log('Available webhook events:');
      for (const e of events) {
        console.log(`  ${e}`);
      }
    }
    return;
  }

  if (subcommand === 'test') {
    const id = args[0];
    if (!id) {
      console.error('Usage: port-daddy webhook test <id>');
      process.exit(1);
    }
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/webhooks/${encodeURIComponent(id)}/test`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to test webhook'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`Test delivery sent to webhook ${id}`);
      if (data.delivery) {
        const d = data.delivery as { status: number; success: boolean };
        console.log(`  Status: ${d.status} (${d.success ? 'success' : 'failed'})`);
      }
    }
    return;
  }

  if (subcommand === 'update') {
    const id = args[0];
    if (!id) {
      console.error('Usage: port-daddy webhook update <id> [--url <url>] [--events <e1,e2>] [--active]');
      process.exit(1);
    }
    const body: Record<string, unknown> = {};
    if (options.url) body.url = options.url;
    if (options.events) body.events = (options.events as string).split(',');
    if (options.active !== undefined) body.active = options.active === true || String(options.active) === 'true';

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/webhooks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to update webhook'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(`Updated webhook: ${id}`);
    }
    return;
  }

  if (subcommand === 'rm' || subcommand === 'remove' || subcommand === 'delete') {
    const id = args[0];
    if (!id) {
      console.error('Usage: port-daddy webhook rm <id>');
      process.exit(1);
    }
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to delete webhook'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(`Deleted webhook: ${id}`);
    }
    return;
  }

  if (subcommand === 'deliveries') {
    const id = args[0];
    if (!id) {
      console.error('Usage: port-daddy webhook deliveries <id>');
      process.exit(1);
    }
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/webhooks/${encodeURIComponent(id)}/deliveries`);
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to get deliveries'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const deliveries = data.deliveries as Array<{ id: string; timestamp: number; status: number; success: boolean; event: string }>;
    if (!deliveries || deliveries.length === 0) {
      console.log('No deliveries found');
      return;
    }
    console.log('');
    console.log(tableHeader(['TIME', 22], ['EVENT', 20], ['STATUS', 10], ['OK', 6]));
    separator(58);
    for (const d of deliveries) {
      const time = new Date(d.timestamp).toISOString().replace('T', ' ').slice(0, 19);
      console.log(
        time.padEnd(22) +
        (d.event || '-').slice(0, 19).padEnd(20) +
        String(d.status).padEnd(10) +
        (d.success ? 'yes' : 'no').padEnd(6)
      );
    }
    console.log('');
    return;
  }

  // If subcommand looks like an ID, show that webhook
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/webhooks/${encodeURIComponent(subcommand)}`);
  const data = await res.json();
  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || `Webhook '${subcommand}' not found`));
    console.error('Subcommands: list, events, test <id>, update <id>, rm <id>, deliveries <id>');
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}
