import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchChannelMessages } from '../api';
import type { ChannelMessage } from '../types';

export function useChannelLog(daemonUrl: string, channels: string[]) {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);

  const normalizedChannels = useMemo(
    () => [...new Set(channels)].sort(),
    [channels]
  );
  const channelKey = normalizedChannels.join('|');

  const refresh = useCallback(async () => {
    if (normalizedChannels.length === 0) {
      setMessages([]);
      return;
    }

    try {
      const all = await Promise.all(
        normalizedChannels.map((channel) => fetchChannelMessages(channel, 18))
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
  }, [daemonUrl, channelKey, normalizedChannels]);

  useEffect(() => {
    setMessages([]);
    refresh();

    const poll = window.setInterval(refresh, 10000);
    return () => window.clearInterval(poll);
  }, [refresh]);

  return { messages, refresh };
}
