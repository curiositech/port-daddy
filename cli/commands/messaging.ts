/**
 * CLI Messaging Commands
 *
 * Handles: pub, sub, wait, channels commands for agent coordination
 */

import http from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { status as maritimeStatus, highlightChannel } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL, resolveTarget } from '../utils/fetch.js';
import type { ConnectionTarget, PdFetchResponse } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { separator, tableHeader, relativeTime } from '../utils/output.js';

/**
 * Handle `pd pub <channel> <message>` command
 */
export async function handlePub(channel: string | undefined, message: string | undefined, options: CLIOptions): Promise<void> {
  if (!channel) {
    console.error('Usage: port-daddy pub <channel> <message>');
    process.exit(1);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(message || '{}');
  } catch {
    payload = message || '';
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/msg/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, sender: options.sender })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to publish'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    console.log(maritimeStatus('success', `Published to ${highlightChannel(channel)} (id: ${data.id})`));
  }
}

/**
 * Handle `pd sub <channel>` command (SSE subscription)
 */
export async function handleSub(channel: string | undefined, options: CLIOptions): Promise<void> {
  if (!channel) {
    console.error('Usage: port-daddy sub <channel>');
    process.exit(1);
  }

  console.error(maritimeStatus('ready', `Subscribing to ${highlightChannel(channel)}... (Ctrl+C to exit)`));

  // SSE requires raw streaming — can't use pdFetch which buffers the full response
  const target: ConnectionTarget = resolveTarget();
  const path: string = `/msg/${encodeURIComponent(channel)}/subscribe`;

  const reqOpts: http.RequestOptions = {
    method: 'GET',
    path,
    headers: { 'Accept': 'text/event-stream' },
    ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port })
  };

  const req: ClientRequest = http.request(reqOpts, (res: IncomingMessage) => {
    if (res.statusCode !== 200) {
      console.error('Failed to subscribe');
      process.exit(1);
    }

    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      const lines: string[] = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data: string = line.slice(6);
          if (isJson(options)) {
            console.log(data);
          } else {
            try {
              const msg = JSON.parse(data) as { createdAt: number; payload: unknown };
              console.log(`[${new Date(msg.createdAt).toISOString()}] ${JSON.stringify(msg.payload)}`);
            } catch {
              console.log(data);
            }
          }
        }
      }
    });

    res.on('end', () => {
      console.error('Subscription ended');
      process.exit(0);
    });
  });

  req.on('error', (err: Error) => {
    console.error(`Connection error: ${err.message}`);
    process.exit(1);
  });

  req.end();

  // Keep process alive until Ctrl+C
  await new Promise<void>(() => {});
}

/**
 * Handle `pd wait <service> [service2...]` command
 */
export async function handleWait(serviceIds: string[], options: CLIOptions): Promise<void> {
  if (!serviceIds || serviceIds.length === 0) {
    console.error('Usage: port-daddy wait <service> [service2] [...]');
    console.error('       port-daddy wait myapp:api myapp:frontend');
    process.exit(1);
  }

  const timeout: number = options.timeout ? parseInt(options.timeout as string, 10) : 60000;

  console.error(`Waiting for ${serviceIds.length} service(s) to become healthy...`);

  if (serviceIds.length === 1) {
    // Single service wait
    const url: string = `${PORT_DADDY_URL}/wait/${encodeURIComponent(serviceIds[0])}?timeout=${timeout}`;
    const res: PdFetchResponse = await pdFetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Wait failed'));
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`\u2713 ${serviceIds[0]} is healthy (${data.latency}ms)`);
    }
  } else {
    // Multiple services wait
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ services: serviceIds, timeout })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Wait failed'));
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const svcList = data.services as Array<{ serviceId: string; healthy: boolean; latency?: number; error?: string }>;
      for (const svc of svcList) {
        const icon: string = svc.healthy ? '\u2713' : '\u2717';
        console.log(`${icon} ${svc.serviceId} ${svc.healthy ? `(${svc.latency}ms)` : svc.error || 'unhealthy'}`);
      }
      console.log(`\nAll services healthy: ${data.allHealthy}`);
    }
  }
}

/**
 * Handle `pd channels [subcommand]` command
 */
export async function handleChannels(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (subcommand === 'clear') {
    const channel = args[0];
    if (!channel) {
      console.error('Usage: port-daddy channels clear <channel>');
      process.exit(1);
    }
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/msg/${encodeURIComponent(channel)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to clear channel'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(maritimeStatus('success', `Cleared channel: ${highlightChannel(channel)}`));
    }
    return;
  }

  // Default: list channels
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/channels`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list channels'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // API returns: { channel: string, count: number, lastMessage: number }
  const channels = data.channels as Array<{ channel: string; count: number; lastMessage: number }>;
  if (!channels || channels.length === 0) {
    console.log(maritimeStatus('ready', 'No active channels'));
    return;
  }

  console.log('');
  console.log(tableHeader(['CHANNEL', 40], ['MESSAGES', 12], ['LAST ACTIVITY', 20]));
  separator(72);

  for (const ch of channels) {
    // Use highlighted channel name with padding calculation based on raw name length
    const name = ch.channel || '-';
    const highlighted = highlightChannel(name);
    const padding = 40 - name.length;
    const lastActivity = ch.lastMessage ? relativeTime(Date.now() - ch.lastMessage) : '-';
    console.log(
      highlighted + ' '.repeat(Math.max(0, padding)) +
      String(ch.count ?? 0).padEnd(12) +
      lastActivity.padEnd(20)
    );
  }
  console.log('');
}
