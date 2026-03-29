export interface Feature {
  id: string;
  title: string;
  description: string;
  category: 'ports' | 'coordination' | 'security' | 'observability' | 'agents' | 'intelligence';
  cli: string;
  status: 'core' | 'new' | 'preview';
}

export const PRODUCT_FEATURES = [
  {
    id: 'atomic-ports',
    title: 'Atomic Port Assignment',
    description: 'Deterministic hashing ensures semantic identities like myapp:api always map to the same port across restarts and swarms.',
    category: 'ports',
    cli: 'pd claim <identity>',
    status: 'core'
  },
  {
    id: 'swarm-radio',
    title: 'Swarm Radio (Pub/Sub)',
    description: 'Low-latency SSE messaging for real-time inter-agent signaling. Speak to your swarm via named radio channels.',
    category: 'coordination',
    cli: 'pd pub <channel> <msg>',
    status: 'core'
  },
  {
    id: 'agent-spawning',
    title: 'Agent Spawning',
    description: 'Launch agents with built-in coordination. Supports Claude, Ollama, Aider, and custom backends. Sessions, heartbeats, and salvage auto-wired.',
    category: 'agents',
    cli: 'pd spawn --backend claude',
    status: 'new'
  },
  {
    id: 'harbors',
    title: 'Harbors (Advisory)',
    description: 'Named permission namespaces with HMAC-signed capability tokens (JWT). Advisory enforcement in the current version.',
    category: 'security',
    cli: 'pd harbor create <name>',
    status: 'new'
  },
  {
    id: 'briefing-system',
    title: 'Briefing Intelligence',
    description: 'Automatically generate high-fidelity project briefings for agents. Summarize session history, file claims, and decisions.',
    category: 'intelligence',
    cli: 'pd briefing',
    status: 'new'
  },
  {
    id: 'reactive-watchers',
    title: 'Reactive Watchers',
    description: 'Subscribe to pub/sub channels and execute commands when messages arrive. No polling -- pure SSE event-driven.',
    category: 'coordination',
    cli: 'pd watch <channel>',
    status: 'new'
  },
  {
    id: 'tunnels',
    title: 'Tunnels',
    description: 'Expose local services via ngrok, cloudflared, or localtunnel. Port Daddy manages the tunnel lifecycle alongside port claims.',
    category: 'ports',
    cli: 'pd tunnel start <svc> ngrok',
    status: 'new'
  },
  {
    id: 'activity-log',
    title: 'Activity Log',
    description: 'Append-only timeline that interleaves infrastructure events with agent notes and radio traffic. Immutable audit trail.',
    category: 'observability',
    cli: 'pd log',
    status: 'core'
  },
  {
    id: 'self-healing',
    title: 'Session Salvage',
    description: 'When agents crash, their session notes and file claims are preserved. New agents can claim dead agents\' work and continue.',
    category: 'observability',
    cli: 'pd salvage',
    status: 'core'
  }
] satisfies Feature[];
