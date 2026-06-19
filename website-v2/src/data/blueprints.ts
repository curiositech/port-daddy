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
    id: 'starter-fleet',
    title: 'Starter Fleet',
    description: 'A small pd-fleet.yml starter for everyday repo work: health checks, QA, docs drift, simplification, and idea hygiene.',
    hero: 'swarm',
    templatePath: 'templates/pd-fleet-starter.yml',
    tags: ['Fleet YAML', 'QA', 'Docs']
  },
  {
    id: 'always-on-fleet',
    title: 'Always-On Fleet',
    description: 'A recurring fleet posture with singleton and cooldown controls for repos that are ready for lightweight background agents.',
    hero: 'ops',
    templatePath: 'templates/pd-fleet-always-on.yml',
    tags: ['Always-on', 'Cooldown', 'Budgets']
  },
  {
    id: 'reactive-ci-pipeline',
    title: 'Reactive CI Pipeline',
    description: 'A code-change pipeline that turns linter and test failures into recoverable debugger launches with validation notes.',
    hero: 'pipeline',
    templatePath: 'templates/ai-ci-pipeline',
    tags: ['CI', 'Tests', 'Repair']
  },
  {
    id: 'always-on-dispatcher',
    title: 'Always-On Dispatcher',
    description: 'A long-lived kernel-agent pattern for routing build, security, and performance events with an audit trail.',
    hero: 'ops',
    templatePath: 'templates/always-on-dispatcher',
    tags: ['Dispatcher', 'SSE', 'Audit']
  },
  {
    id: 'event-driven-ops',
    title: 'Event-Driven Ops',
    description: 'An incident-response swarm pattern with intake events, investigation, operator approval, and locks around risky actions.',
    hero: 'remote',
    templatePath: 'templates/event-driven-ops',
    tags: ['Ops', 'Locks', 'Incidents']
  },
  {
    id: 'multiplayer-dev-env',
    title: 'Multiplayer Dev Environment',
    description: 'A shared development topology using harbors, tunnels, and DNS-style discovery across multiple machines.',
    hero: 'remote',
    templatePath: 'templates/multiplayer-dev-env',
    tags: ['Harbors', 'Tunnels', 'DNS']
  },
  {
    id: 'swarm-researcher',
    title: 'Swarm Researcher',
    description: 'A search, scrape, and synthesis triad using channels, locks, and notes for claim-backed research work.',
    hero: 'research',
    templatePath: 'templates/swarm-researcher',
    tags: ['Research', 'Locks', 'Synthesis']
  },
  {
    id: 'encrypted-messenger',
    title: 'Encrypted Messenger',
    description: 'A TypeScript primitive for secure local agent-to-agent message exchange when plain channel traffic is not enough.',
    hero: 'multiplayer',
    templatePath: 'templates/encrypted-messenger/messenger.ts',
    tags: ['Messaging', 'Crypto', 'TypeScript']
  }
];
