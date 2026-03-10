/**
 * Port Daddy — Terminal UI Dashboard
 *
 * Run via: pd dashboard
 * Built with Ink (React for terminals)
 *
 * Navigation: [1-5] tabs, [←→] arrow keys, [q] quit
 * Channels: [↑↓] select, [Enter] drill in, [Esc] back
 */

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';

const BASE_URL = process.env.PORT_DADDY_URL ?? 'http://localhost:9876';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Service {
  id: string;
  port?: number;
  pid?: number;
  status?: string;
  cmd?: string | null;
  cwd?: string | null;
  last_seen?: string;
  lastSeen?: string;
}

interface Agent {
  id: string;
  name?: string;
  identity?: string;
  purpose?: string;
  lastHeartbeat?: string | number;
  status?: string;
  liveness?: string;
}

interface Session {
  id: string;
  agentId?: string;
  status: string;
  purpose?: string;
  phase?: string;
  createdAt?: number;
  completedAt?: number;
}

interface Lock {
  name: string;
  owner?: string;
  acquiredAt?: number;
  expiresAt?: number;
}

interface Channel {
  channel: string;
  count: number;
  lastMessage?: number;
}

interface Message {
  id: number;
  payload: string;
  sender?: string | null;
  createdAt: number;
}

interface Health {
  status: string;
  version: string;
  pid: number;
  uptime: number;
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function apiFetch<T,>(path: string): Promise<T | null> {
  try {
    const res = await fetch(BASE_URL + path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function usePolling<T,>(fetcher: () => Promise<T | null>, interval = 2500): T | null {
  const [data, setData] = useState<T | null>(null);
  const stable = useCallback(fetcher, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const d = await stable();
      if (alive) setData(d);
    };
    void tick();
    const id = setInterval(() => void tick(), interval);
    return () => { alive = false; clearInterval(id); };
  }, [stable, interval]);
  return data;
}

function useOnDemand<T,>(fetcher: () => Promise<T | null>): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const stable = useCallback(fetcher, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => {
    void stable().then(d => setData(d));
  }, [stable]);
  return [data, refresh];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: string | number | undefined): string {
  if (!ts) return '--';
  const ms = Date.now() - (typeof ts === 'string' ? new Date(ts).getTime() : ts);
  if (ms < 0) return 'soon';
  if (ms < 5000) return 'just now';
  if (ms < 60000) return Math.floor(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
  return Math.floor(ms / 3600000) + 'h ago';
}

function pad(s: string | number, w: number): string {
  return String(s ?? '').padEnd(w).slice(0, w);
}

function shortPath(p: string | null | undefined): string {
  if (!p) return '';
  // Replace home dir with ~
  const home = process.env.HOME ?? '';
  if (home && p.startsWith(home)) p = '~' + p.slice(home.length);
  // Truncate long paths from the left
  if (p.length > 30) return '…' + p.slice(p.length - 29);
  return p;
}

// ─── TokenId ─────────────────────────────────────────────────────────────────

const TOKEN_COLORS = ['cyan', '#E5A000', '#6DD998'] as const;

function TokenId({ id, dim = false }: { id?: string; dim?: boolean }): React.ReactElement {
  if (!id || id === '--') return <Text dimColor>{'--'}</Text>;
  const parts = id.split(':');
  if (parts.length === 1) return <Text color="cyan" dimColor={dim}>{id}</Text>;
  return (
    <>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Text dimColor>{':'}</Text>}
          <Text color={TOKEN_COLORS[Math.min(i, 2)]} dimColor={dim}>{p}</Text>
        </React.Fragment>
      ))}
    </>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, count, color }: { label: string; count: number; color: string }): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" paddingX={2}
      borderStyle="single" borderColor="gray">
      <Text bold color={color}>{count}</Text>
      <Text dimColor>{label}</Text>
    </Box>
  );
}

// ─── Panels ──────────────────────────────────────────────────────────────────

const COL: { bold: true; color: 'cyan' } = { bold: true, color: 'cyan' };

function ServicesPanel({ services }: { services: Service[] }): React.ReactElement {
  if (!services.length) return <Text dimColor>{'No services registered. Run: pd claim myapp:api'}</Text>;
  const hasCwd = services.some(s => s.cwd);
  return (
    <Box flexDirection="column">
      <Box gap={2} marginBottom={1}>
        <Box width={32}><Text {...COL}>IDENTITY</Text></Box>
        <Box width={6}><Text {...COL}>PORT</Text></Box>
        <Box width={10}><Text {...COL}>STATUS</Text></Box>
        {hasCwd && <Box width={32}><Text {...COL}>DIR</Text></Box>}
        <Text {...COL}>LAST SEEN</Text>
      </Box>
      {services.slice(0, 28).map(s => (
        <Box key={s.id} gap={2}>
          <Box width={32}><TokenId id={s.id} /></Box>
          <Box width={6}><Text color="green" bold>{pad(s.port ?? '--', 6)}</Text></Box>
          <Box width={10}><Text color={s.status === 'active' ? 'green' : 'gray'}>{pad(s.status ?? 'assigned', 10)}</Text></Box>
          {hasCwd && <Box width={32}><Text dimColor>{shortPath(s.cwd)}</Text></Box>}
          <Text dimColor>{timeAgo(s.lastSeen ?? s.last_seen)}</Text>
        </Box>
      ))}
      {services.length > 28 && <Text dimColor>{'… and ' + (services.length - 28) + ' more'}</Text>}
    </Box>
  );
}

function AgentsPanel({ agents }: { agents: Agent[] }): React.ReactElement {
  if (!agents.length) return <Text dimColor>{'No registered agents. Run: pd begin "purpose"'}</Text>;
  return (
    <Box flexDirection="column">
      <Box gap={2} marginBottom={1}>
        <Box width={28}><Text {...COL}>AGENT ID</Text></Box>
        <Box width={28}><Text {...COL}>IDENTITY</Text></Box>
        <Box width={8}><Text {...COL}>STATUS</Text></Box>
        <Box width={12}><Text {...COL}>HEARTBEAT</Text></Box>
        <Text {...COL}>PURPOSE</Text>
      </Box>
      {agents.map(a => {
        const liveness = a.liveness ?? 'alive';
        const livenessColor = liveness === 'alive' ? 'green' : liveness === 'stale' ? '#E5A000' : 'red';
        return (
          <Box key={a.id} gap={2}>
            <Box width={28}><TokenId id={a.id} dim={liveness === 'dead'} /></Box>
            <Box width={28}><TokenId id={a.identity ?? '--'} dim={liveness === 'dead'} /></Box>
            <Box width={8}><Text color={livenessColor} bold>{pad(liveness, 8)}</Text></Box>
            <Box width={12}><Text dimColor>{timeAgo(a.lastHeartbeat)}</Text></Box>
            <Text dimColor>{(a.purpose ?? '--').slice(0, 40)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function SessionsPanel({ sessions, agentIds }: { sessions: Session[]; agentIds: Set<string> }): React.ReactElement {
  if (!sessions.length) return <Text dimColor>{'No sessions found.'}</Text>;
  const sorted = [
    ...sessions.filter(s => s.status === 'active'),
    ...sessions.filter(s => s.status !== 'active'),
  ];
  return (
    <Box flexDirection="column">
      <Box gap={2} marginBottom={1}>
        <Box width={10}><Text {...COL}>ID</Text></Box>
        <Box width={25}><Text {...COL}>AGENT</Text></Box>
        <Box width={10}><Text {...COL}>STATUS</Text></Box>
        <Box width={12}><Text {...COL}>PHASE</Text></Box>
        <Text {...COL}>PURPOSE</Text>
      </Box>
      {sorted.slice(0, 25).map(s => {
        // Zombie: session is active but agent is not alive
        const agentAlive = !s.agentId || agentIds.has(s.agentId);
        const isZombie = s.status === 'active' && !agentAlive;
        const statusColor = isZombie ? '#E5A000'
          : s.status === 'active' ? 'green'
          : s.status === 'abandoned' ? 'red'
          : 'gray';
        const statusLabel = isZombie ? 'zombie' : s.status;
        return (
          <Box key={s.id} gap={2}>
            <Box width={10}><Text dimColor>{s.id.slice(0, 8)}</Text></Box>
            <Box width={25}><TokenId id={s.agentId ?? '--'} dim={isZombie} /></Box>
            <Box width={10}>
              <Text color={statusColor} bold={isZombie}>{pad(statusLabel, 10)}</Text>
            </Box>
            <Box width={12}><Text dimColor>{pad(s.phase ?? '--', 12)}</Text></Box>
            <Text dimColor>{(s.purpose ?? '--').slice(0, 35)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function LocksPanel({ locks }: { locks: Lock[] }): React.ReactElement {
  if (!locks.length) return <Text dimColor>{'No active locks. Run: pd lock myapp:deploy'}</Text>;
  return (
    <Box flexDirection="column">
      <Box gap={2} marginBottom={1}>
        <Box width={32}><Text {...COL}>LOCK NAME</Text></Box>
        <Box width={28}><Text {...COL}>OWNER</Text></Box>
        <Text {...COL}>EXPIRES</Text>
      </Box>
      {locks.map(l => (
        <Box key={l.name} gap={2}>
          <Box width={32}><Text color="#E5A000" bold>{pad(l.name, 32)}</Text></Box>
          <Box width={28}><TokenId id={l.owner ?? '--'} /></Box>
          <Text dimColor>{l.expiresAt ? timeAgo(l.expiresAt) : '--'}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ─── Channels Panel (with drill-down) ────────────────────────────────────────

function MessagesView({ channel, onBack }: { channel: string; onBack: () => void }): React.ReactElement {
  const [messages, refresh] = useOnDemand<{ messages: Message[]; count: number }>(
    () => apiFetch(`/msg/${encodeURIComponent(channel)}?limit=20`)
  );

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} gap={2}>
        <Text bold color="cyan">{'#'}</Text>
        <TokenId id={channel} />
        <Text dimColor>{'  [Esc] back  [r] refresh'}</Text>
      </Box>
      {!messages && <Text dimColor>{'loading…'}</Text>}
      {messages && messages.messages.length === 0 && (
        <Text dimColor>{'No messages in this channel yet.'}</Text>
      )}
      {messages && messages.messages.slice().reverse().map(m => (
        <Box key={m.id} gap={2}>
          <Box width={10}><Text dimColor>{timeAgo(m.createdAt)}</Text></Box>
          {m.sender && <Box width={18}><TokenId id={m.sender} dim /></Box>}
          <Text>{m.payload.slice(0, 80)}</Text>
        </Box>
      ))}
    </Box>
  );
}

function ChannelsPanel({
  channels,
  selectedIdx,
  drilling,
  onBack,
}: {
  channels: Channel[];
  selectedIdx: number;
  drilling: boolean;
  onBack: () => void;
}): React.ReactElement {
  if (!channels.length) return <Text dimColor>{'No active channels. Run: pd pub mychannel "hello"'}</Text>;

  if (drilling && channels[selectedIdx]) {
    return <MessagesView channel={channels[selectedIdx].channel} onBack={onBack} />;
  }

  return (
    <Box flexDirection="column">
      <Box gap={2} marginBottom={1}>
        <Box width={42}><Text {...COL}>CHANNEL</Text></Box>
        <Box width={8}><Text {...COL}>MSGS</Text></Box>
        <Text {...COL}>LAST MESSAGE</Text>
      </Box>
      {channels.map((c, i) => (
        <Box key={c.channel} gap={2} borderStyle={i === selectedIdx ? 'single' : undefined}
          borderColor={i === selectedIdx ? 'cyan' : undefined}>
          <Box width={42}><TokenId id={c.channel} /></Box>
          <Box width={8}><Text color="green" bold>{c.count}</Text></Box>
          <Text dimColor>{timeAgo(c.lastMessage)}</Text>
          {i === selectedIdx && <Text dimColor>{'  [Enter] read'}</Text>}
        </Box>
      ))}
    </Box>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

const TABS = ['Services', 'Agents', 'Sessions', 'Locks', 'Channels'] as const;
type Tab = (typeof TABS)[number];

// ─── App ─────────────────────────────────────────────────────────────────────

function App(): React.ReactElement {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>('Services');
  const [channelIdx, setChannelIdx] = useState(0);
  const [channelDrilling, setChannelDrilling] = useState(false);

  const health  = usePolling<Health>(() => apiFetch('/health'), 5000);
  const svcData = usePolling<{ services: Service[] }>(() => apiFetch('/services'), 2500);
  const agtData = usePolling<{ agents: Agent[] }>(() => apiFetch('/agents'), 3000);
  const sesData = usePolling<{ sessions: Session[] }>(() => apiFetch('/sessions?limit=30'), 3000);
  const lckData = usePolling<{ locks: Lock[] }>(() => apiFetch('/locks'), 2500);
  const chnData = usePolling<{ channels: Channel[] }>(() => apiFetch('/channels'), 3000);

  const svcs  = svcData?.services ?? [];
  const agts  = agtData?.agents ?? [];
  const sess  = sesData?.sessions ?? [];
  const lcks  = lckData?.locks ?? [];
  const chans = chnData?.channels ?? [];

  // Set of alive agent IDs for zombie detection in sessions panel
  const aliveAgentIds = new Set(agts.filter(a => a.liveness !== 'dead').map(a => a.id));

  const activeSessions = sess.filter(s => s.status === 'active').length;
  const uptimeMin = health ? Math.floor((health.uptime ?? 0) / 60) : 0;

  useInput((input, key) => {
    if (channelDrilling) {
      if (key.escape || input === 'q') { setChannelDrilling(false); return; }
      return;
    }

    if (input === 'q') exit();
    if (input === '1') setTab('Services');
    if (input === '2') setTab('Agents');
    if (input === '3') setTab('Sessions');
    if (input === '4') setTab('Locks');
    if (input === '5') setTab('Channels');
    if (key.leftArrow) {
      const i = TABS.indexOf(tab);
      setTab(TABS[(i - 1 + TABS.length) % TABS.length]);
    }
    if (key.rightArrow) {
      const i = TABS.indexOf(tab);
      setTab(TABS[(i + 1) % TABS.length]);
    }
    if (tab === 'Channels') {
      if (key.upArrow) setChannelIdx(i => Math.max(0, i - 1));
      if (key.downArrow) setChannelIdx(i => Math.min(chans.length - 1, i + 1));
      if (key.return) setChannelDrilling(true);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>

      {/* ── Header ── */}
      <Box marginBottom={1} gap={2}>
        <Text bold color="cyan">{'⚓ Port Daddy'}</Text>
        {health ? (
          <>
            <Text dimColor>{'v' + health.version}</Text>
            <Text color="green">{'● running'}</Text>
            <Text dimColor>{'pid:' + health.pid + '  up:' + uptimeMin + 'm'}</Text>
          </>
        ) : (
          <Text color="red">{'✗ daemon unreachable — ' + BASE_URL}</Text>
        )}
        <Text dimColor>{'  ' + BASE_URL}</Text>
      </Box>

      {/* ── Stat bar ── */}
      <Box marginBottom={1} gap={2}>
        <StatCard label="SERVICES"  count={svcs.length}     color="cyan"    />
        <StatCard label="AGENTS"    count={agts.length}     color="#E5A000" />
        <StatCard label="SESSIONS"  count={activeSessions}  color="green"   />
        <StatCard label="LOCKS"     count={lcks.length}     color="red"     />
        <StatCard label="CHANNELS"  count={chans.length}    color="magenta" />
      </Box>

      {/* ── Tab bar ── */}
      <Box marginBottom={1} gap={1}>
        {TABS.map((t, i) => (
          <Text key={t} bold={tab === t} color={tab === t ? 'cyan' : undefined} dimColor={tab !== t}>
            {'[' + (i + 1) + '] ' + t + '  '}
          </Text>
        ))}
        <Text dimColor>{'[←→] nav  [q] quit'}</Text>
      </Box>

      {/* ── Panel ── */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column" minHeight={18}>
        {tab === 'Services'  && <ServicesPanel  services={svcs}  />}
        {tab === 'Agents'    && <AgentsPanel    agents={agts}    />}
        {tab === 'Sessions'  && <SessionsPanel  sessions={sess}  agentIds={aliveAgentIds} />}
        {tab === 'Locks'     && <LocksPanel     locks={lcks}     />}
        {tab === 'Channels'  && (
          <ChannelsPanel
            channels={chans}
            selectedIdx={channelIdx}
            drilling={channelDrilling}
            onBack={() => setChannelDrilling(false)}
          />
        )}
      </Box>

      {/* ── Footer ── */}
      <Box marginTop={1}>
        {tab === 'Channels' && !channelDrilling
          ? <Text dimColor>{'[↑↓] select channel  [Enter] read messages  ·  auto-refreshes every 3s'}</Text>
          : <Text dimColor>{'pd dashboard --web  opens browser  ·  auto-refreshes every 2.5s'}</Text>
        }
      </Box>

    </Box>
  );
}

render(<App />);
