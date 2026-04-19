import { highlightChannel } from '../../lib/maritime.js';
import { CLIOptions } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from './fetch.js';
import type { PdFetchResponse } from './fetch.js';

export interface ChannelResolution {
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

export function resolveTargetDir(options: CLIOptions): string {
  return readOption(options, 'dir', 'project-dir', 'projectDir') || process.cwd();
}

export async function resolveDeclaredChannel(
  channel: string,
  options: CLIOptions,
): Promise<ChannelResolution> {
  if (options['raw-channel']) {
    return {
      requestedChannel: channel,
      physicalChannel: channel,
      resolved: false,
    };
  }

  const params = new URLSearchParams();
  params.set('projectDir', resolveTargetDir(options));

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/channels/resolve/${encodeURIComponent(channel)}?${params.toString()}`
  );
  const data = await res.json() as {
    error?: string;
    channel?: {
      physicalName?: string;
    };
  };

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

  throw new Error(data.error || `Failed to resolve channel ${channel}`);
}

export function formatResolvedChannel({
  requestedChannel,
  physicalChannel,
  resolved,
}: ChannelResolution): string {
  if (!resolved) return highlightChannel(physicalChannel);
  return `${highlightChannel(requestedChannel)} -> ${highlightChannel(physicalChannel)}`;
}
