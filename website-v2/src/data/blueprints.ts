export interface Blueprint {
  id: string;
  title: string;
  description: string;
  hero: 'pipeline' | 'research' | 'multiplayer' | 'ops' | 'swarm' | 'remote';
  templatePath: string;
  tags: string[];
}

export const BLUEPRINTS: Blueprint[] = [
  {
    id: 'ai-ci-pipeline',
    title: 'Self-Healing CI/CD',
    description: 'A build pipeline that automatically spawns Debugger agents to fix broken tests in background harbors.',
    hero: 'pipeline',
    templatePath: 'templates/ai-ci-pipeline',
    tags: ['SRE', 'Automation', 'Salvage']
  },
  {
    id: 'swarm-researcher',
    title: 'Research Triad',
    description: 'Coordinated web scraping, synthesis, and reporting agents using distributed locks and shared memory.',
    hero: 'research',
    templatePath: 'templates/swarm-researcher',
    tags: ['Research', 'Locks', 'Memory']
  },
  {
    id: 'monorepo-dev-server',
    title: 'Monorepo Dev Server',
    description: 'Multi-service local development with automatic port assignment, DNS resolution, and orchestrated startup across all workspace packages.',
    hero: 'ops',
    templatePath: 'templates/monorepo-dev-server',
    tags: ['Monorepo', 'Orchestration', 'DNS']
  },
  {
    id: 'agent-swarm-starter',
    title: 'Agent Swarm Starter',
    description: 'Multi-agent coordination template with sessions, pub/sub messaging, file claims, and automatic salvage for crashed agents.',
    hero: 'swarm',
    templatePath: 'templates/agent-swarm-starter',
    tags: ['Agents', 'Sessions', 'Salvage']
  },
  {
    id: 'webhook-relay',
    title: 'Webhook Relay',
    description: 'Tunnel plus webhook forwarding setup that exposes local services and relays external events to pub/sub channels for agent consumption.',
    hero: 'remote',
    templatePath: 'templates/webhook-relay',
    tags: ['Webhooks', 'Tunnels', 'Events']
  }
];
