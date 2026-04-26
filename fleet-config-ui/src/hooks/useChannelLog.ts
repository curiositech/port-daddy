import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchChannelMessages } from '../api';
import type { ChannelMessage, ResolvedChannelTarget } from '../types';

export function useChannelLog(daemonUrl: string, channels: ResolvedChannelTarget[]) {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);

  const normalizedChannels = useMemo(
    () => {
      const deduped = new Map<string, ResolvedChannelTarget>();
      channels.forEach((channel) => {
        const logical = channel.logical.trim();
        const physical = channel.physical.trim();
        if (!logical || !physical) return;
        deduped.set(physical, { logical, physical });
      });
      return Array.from(deduped.values()).sort((a, b) => a.logical.localeCompare(b.logical));
    },
    [channels]
  );
  const refresh = useCallback(async () => {
    if (normalizedChannels.length === 0) {
      setMessages([]);
      return;
    }

    try {
      const all = await Promise.all(
        normalizedChannels.map(async (channel) => {
          const messages = await fetchChannelMessages(channel.physical, 18);
          return messages.map((message) => ({
            ...message,
            channel: channel.logical,
            physicalChannel: channel.physical,
          }));
        })
      );

      setMessages(
        all
          .flat()
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 180)
      );
    } catch (err) {
      console.error('Failed to refresh channel log', err);
    }
  }, [normalizedChannels]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setMessages([]);
      void refresh();
    });

    const poll = window.setInterval(refresh, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [daemonUrl, refresh]);

  return { messages, refresh };
}
