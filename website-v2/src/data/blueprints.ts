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
    id: 'langchain-lighthouse',
    title: 'LangChain Lighthouse',
    description: 'A multi-tool LangChain swarm that uses Port Daddy for universal discovery and state persistence.',
    hero: 'swarm',
    templatePath: 'templates/langchain-lighthouse',
    tags: ['LangChain', 'Discovery', 'Always-On']
  },
  {
    id: 'crewai-harbor',
    title: 'CrewAI Secure Harbor',
    description: 'A hierarchical CrewAI team with cryptographically scoped permissions for each crew member.',
    hero: 'remote',
    templatePath: 'templates/crewai-harbor',
    tags: ['CrewAI', 'Security', 'Harbors']
  },
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
