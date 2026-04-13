/**
 * CLI Messaging Commands
 *
 * Handles: pub, sub, wait, channels commands for agent coordination
 */

import http from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { highlightChannel, formatRadioMessage, ANSI } from '../../lib/maritime.js';
import type { RadioMessage, SignalType } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL, resolveTarget } from '../utils/fetch.js';
import type { ConnectionTarget, PdFetchResponse } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { separator, tableHeader, relativeTime } from '../utils/output.js';
import { canPrompt, promptText } from '../utils/prompt.js';
import * as ui from '../utils/ui.js';

interface ChannelResolution {
  requestedChannel: string;
  physicalChannel: string;
  resolved: boolean;
}

function readOption(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function parseAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

async function resolveMessagingChannel(channel: string, options: CLIOptions): Promise<ChannelResolution> {
  if (options['raw-channel']) {
    return {
      requestedChannel: channel,
      physicalChannel: channel,
      resolved: false,
    };
  }

  const params = new URLSearchParams();
  params.set('projectDir', resolveTargetDir(options));

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/channels/resolve/${encodeURIComponent(channel)}?${params.toString()}`);
  const data = await res.json();

  if (res.ok && typeof data.channel?.physicalName === 'string' && data.channel.physicalName.trim()) {
    return {
      requestedChannel: channel,
      physicalChannel: data.channel.physicalName,
      resolved: data.channel.physicalName !== channel,
    };
  }

  if (res.status === 404) {
    return {
      requestedChannel: channel,
      physicalChannel: channel,
      resolved: false,
    };
  }

  throw new Error((data.error as string) || `Failed to resolve channel ${channel}`);
}

function formatResolvedChannel({ requestedChannel, physicalChannel, resolved }: ChannelResolution): string {
  if (!resolved) return highlightChannel(physicalChannel);
  return `${highlightChannel(requestedChannel)} -> ${highlightChannel(physicalChannel)}`;
}

/**
 * Handle `pd pub <channel> <message>` command
 */
export async function handlePub(channel: string | undefined, message: string | undefined, options: CLIOptions): Promise<void> {
  if (!channel) {
    console.error('Usage: port-daddy pub <channel> <message> [--message "text"] [-m "text"] [--signal mayday|pan-pan|roger|...]');
    process.exit(1);
  }

  // Flag alternative: --message "text" or -m "text"
  message = message || (options.message as string) || undefined;

  if (!message && canPrompt()) {
    message = await promptText({ label: 'Message payload (JSON or text):', required: true }) || undefined;
    if (!message) {
      console.error('Message is required');
      process.exit(1);
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(message || '{}');
  } catch {
    payload = message || '';
  }

  let resolvedChannel: ChannelResolution;
  try {
    resolvedChannel = await resolveMessagingChannel(channel, options);
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/msg/${encodeURIComponent(resolvedChannel.physicalChannel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      payload, 
      sender: options.sender || 'CLI',
      signal: options.signal || 'report'
    })
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to publish');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    ui.success(`Published to ${formatResolvedChannel(resolvedChannel)} (id: ${data.id})`);
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

  let resolvedChannel: ChannelResolution;
  try {
    resolvedChannel = await resolveMessagingChannel(channel, options);
  } catch (error) {
    ui.error((error as Error).message);
    process.exit(1);
  }

  ui.info(`Subscribing to ${formatResolvedChannel(resolvedChannel)}... (Ctrl+C to exit)`);

  // SSE requires raw streaming — can't use pdFetch which buffers the full response
  const target: ConnectionTarget = resolveTarget();
  const path: string = `/msg/${encodeURIComponent(resolvedChannel.physicalChannel)}/subscribe`;

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
              const msg = JSON.parse(data) as any;
              if (msg.payload && msg.createdAt) {
                const radioMsg: RadioMessage = {
                  callsign: msg.sender || 'UNKNOWN',
                  signal: (msg.signal as SignalType) || 'report',
                  message: typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload),
                  timestamp: msg.createdAt
                };
                console.log(formatRadioMessage(radioMsg));
              } else {
                console.log(`[${new Date(msg.createdAt).toISOString()}] ${JSON.stringify(msg.payload)}`);
              }
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
      ui.error((data.error as string) || 'Wait failed');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`${ANSI.fgGreen}\u2713${ANSI.reset} ${serviceIds[0]} is healthy (${data.latency}ms)`);
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
      ui.error((data.error as string) || 'Wait failed');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const svcList = data.services as Array<{ serviceId: string; healthy: boolean; latency?: number; error?: string }>;
      for (const svc of svcList) {
        const icon: string = svc.healthy ? `${ANSI.fgGreen}\u2713${ANSI.reset}` : `${ANSI.fgRed}\u2717${ANSI.reset}`;
        console.log(`${icon} ${svc.serviceId} ${svc.healthy ? `(${svc.latency}ms)` : svc.error || 'unhealthy'}`);
      }
      console.log(`\nAll services healthy: ${data.allHealthy ? ANSI.fgGreen + 'YES' : ANSI.fgRed + 'NO'}${ANSI.reset}`);
    }
  }
}

/**
 * Handle `pd channels [subcommand]` command
 */
export async function handleChannels(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (subcommand === 'discover') {
    const query = args.join(' ') || readOption(options, 'query', 'q');
    const projectDir = resolveTargetDir(options);
    const params = new URLSearchParams();
    params.set('projectDir', projectDir);
    if (query) params.set('q', query);
    if (options.observed || options.all) params.set('observed', 'true');

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/channels/discover?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to discover channels');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const channels = (data.channels as Array<{
      logicalName: string;
      physicalName: string;
      scope: string;
      activeCount: number;
      lastMessage: number | null;
      source: string;
    }>) || [];

    if (channels.length === 0) {
      ui.info('No declared channels found for this repo/worktree context');
      return;
    }

    console.log('');
    console.log(tableHeader(['LOGICAL', 26], ['SCOPE', 12], ['SOURCE', 12], ['ACTIVE', 10], ['PHYSICAL', 36]));
    separator(96);
    for (const channel of channels) {
      const logical = channel.logicalName.padEnd(26);
      const scope = String(channel.scope || '-').padEnd(12);
      const source = String(channel.source || '-').padEnd(12);
      const active = String(channel.activeCount ?? 0).padEnd(10);
      console.log(`${logical}${scope}${source}${active}${channel.physicalName}`);
    }
    console.log('');
    return;
  }

  if (subcommand === 'ensure') {
    const name = args[0] || readOption(options, 'name');
    if (!name) {
      console.error('Usage: port-daddy channels ensure <name> [--scope branch|worktree|repo|global] [--description "..."] [--aliases a,b]');
      process.exit(1);
    }

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/channels/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        scope: readOption(options, 'scope'),
        description: readOption(options, 'description'),
        aliases: parseAliases(options.aliases),
        projectDir: resolveTargetDir(options),
      })
    });
    const data = await res.json();
    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to ensure channel');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const channel = data.channel as {
      logicalName: string;
      physicalName: string;
      scope: string;
      worktreeId: string | null;
      branch: string | null;
      created: boolean;
    };

    ui.success(`${data.created ? 'Declared' : 'Updated'} ${highlightChannel(channel.logicalName)}`);
    console.log(`  scope: ${channel.scope}`);
    console.log(`  physical: ${highlightChannel(channel.physicalName)}`);
    if (channel.worktreeId) console.log(`  worktree: ${channel.worktreeId}`);
    if (channel.branch) console.log(`  branch: ${channel.branch}`);
    return;
  }

  if (subcommand === 'describe' || subcommand === 'resolve') {
    const name = args[0];
    if (!name) {
      console.error('Usage: port-daddy channels describe <name>');
      process.exit(1);
    }

    const params = new URLSearchParams();
    params.set('projectDir', resolveTargetDir(options));

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/channels/resolve/${encodeURIComponent(name)}?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to resolve channel');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const channel = data.channel as {
      logicalName: string;
      physicalName: string;
      scope: string;
      source: string;
      aliases: string[];
      activeCount: number;
      branch: string | null;
      worktreeId: string | null;
      description: string | null;
    };

    console.log('');
    console.log(`logical:  ${highlightChannel(channel.logicalName)}`);
    console.log(`physical: ${highlightChannel(channel.physicalName)}`);
    console.log(`scope:    ${channel.scope}`);
    console.log(`source:   ${channel.source}`);
    console.log(`active:   ${channel.activeCount}`);
    console.log(`worktree: ${channel.worktreeId || '-'}`);
    console.log(`branch:   ${channel.branch || '-'}`);
    console.log(`aliases:  ${channel.aliases?.length ? channel.aliases.join(', ') : '-'}`);
    console.log(`desc:     ${channel.description || '-'}`);
    console.log('');
    return;
  }

  if (subcommand === 'clear') {
    const channel = args[0];
    if (!channel) {
      console.error('Usage: port-daddy channels clear <channel>');
      process.exit(1);
    }
    let resolvedChannel: ChannelResolution;
    try {
      resolvedChannel = await resolveMessagingChannel(channel, options);
    } catch (error) {
      ui.error((error as Error).message);
      process.exit(1);
    }

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/msg/${encodeURIComponent(resolvedChannel.physicalChannel)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to clear channel');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      ui.success(`Cleared channel: ${formatResolvedChannel(resolvedChannel)}`);
    }
    return;
  }

  // Default: list channels
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/channels`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to list channels');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // API returns: { channel: string, count: number, lastMessage: number }
  const channels = data.channels as Array<{ channel: string; count: number; lastMessage: number }>;
  if (!channels || channels.length === 0) {
    ui.info('No active channels');
    return;
  }

  console.log('');
  console.log(tableHeader(['CHANNEL', 40], ['MESSAGES', 12], ['LAST ACTIVITY', 20]));
  separator(72);

  for (const ch of channels) {
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

function resolveTargetDir(options: CLIOptions): string {
  return readOption(options, 'dir', 'project-dir', 'projectDir') || process.cwd();
}
