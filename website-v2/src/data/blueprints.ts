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
  }
];
