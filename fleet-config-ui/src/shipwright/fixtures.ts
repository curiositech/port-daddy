import type {
  ProjectSurvey,
  ShipwrightMessage,
  ShipwrightProposal,
  SimulationState,
} from './types';

const PORT_DADDY_ROOT = '/Users/erichowens/coding/port-daddy';
const FIXTURE_TIME = '2026-04-26T12:00:00.000Z';

export const fixtureSurveys: ProjectSurvey[] = [
  {
    project: 'port-daddy',
    root: PORT_DADDY_ROOT,
    surveyedAt: FIXTURE_TIME,
    fixture: true,
    classification: {
      kind: 'server-daemon',
      languages: ['typescript', 'rust', 'swift'],
      frameworks: ['fastify', 'react', 'vite'],
      deliveryMedium: 'Homebrew daemon + launchd supervision + native FleetBar',
      uiSurfaces: ['Fleet Control Center', 'FleetBar', 'CLI'],
    },
    intent: 'Authoritative local daemon for ports, sessions, coordination, fleet agents, and operator control.',
    purpose: 'Make multi-agent development observable, bounded, recoverable, and cheap enough to use by default.',
    status: {
      activity: 'hot',
      commitsLast30d: 120,
      openPRs: 0,
      testSuites: 139,
      testsPassing: true,
      ciRed: false,
      docFreshness: 'current',
      hasFleet: true,
      fleetSizeAgents: 8,
      sentryConfigured: false,
    },
    hotFiles: ['server.ts', 'lib/fleet-engine.ts', 'fleet-config-ui/src/App.tsx'],
    risks: [
      'Shipwright routes are still planned, so UI must flag fixture data.',
      'Simulation canvas should not poll once the SSE route exists.',
      'R3F dependencies should wait until SVG fallback surfaces are useful.',
    ],
    opportunities: [
      'Reuse existing wallets, bonds, and panic routes for FleetControl.',
      'Render deterministic ship thumbnails from identity before WebGL.',
      'Make proposal application go through a human-visible diff.',
    ],
    costHintUsdPerDay: 4.2,
    confidence: 0.86,
  },
];

export const fixtureProposal: ShipwrightProposal = {
  projectDir: PORT_DADDY_ROOT,
  fixture: true,
  confidence: 0.79,
  exemplarId: 'fixture:port-daddy:hot-daemon',
  rationale: 'Port Daddy is a hot daemon/control-plane repo. Start with QA, docs drift, cost control, and browser canary agents before expensive strategy agents.',
  fleet: {
    version: 2,
    project: 'port-daddy',
    projectDir: PORT_DADDY_ROOT,
    proposedBy: 'shipwright',
    proposedAt: FIXTURE_TIME,
    fixture: true,
    limits: {
      maxConcurrentSpawns: 2,
      maxSpawnsPerHour: 12,
      budgetUsdPerDay: 5,
      bondCeilingUsd: 1,
    },
    agents: [
      {
        id: 'qa-sentinel',
        archetype: 'qa-sentinel',
        backend: 'claude-cli',
        model: 'sonnet',
        bondUsd: 0.25,
        budgetUsdPerDay: 1,
        trigger: { kind: 'git-pr' },
        skills: ['vitest-testing-patterns', 'high-quality-vibe-coding'],
        prompt: 'Run the focused test matrix for the changed surface, summarize failures, and leave file-scoped notes.',
        rationale: 'The repo treats green tests skeptically; a sentinel should catch behavioral regressions, not just compile errors.',
      },
      {
        id: 'documentarian',
        archetype: 'documentarian',
        backend: 'claude-cli',
        model: 'haiku',
        bondUsd: 0.1,
        budgetUsdPerDay: 0.35,
        trigger: { kind: 'file-watch', paths: ['README.md', 'docs/**/*.md', 'skills/**/*.md'] },
        skills: ['design-system-documenter', 'output-contract-enforcer'],
        prompt: 'Compare public/operator docs against changed manifests and routes. Propose the smallest doc repair.',
        rationale: 'Port Daddy has many release surfaces; drift is cheaper to catch close to the edit.',
      },
      {
        id: 'browser-canary',
        archetype: 'browser-canary',
        backend: 'codex',
        model: 'gpt-5.3-codex',
        bondUsd: 0.25,
        budgetUsdPerDay: 0.75,
        trigger: { kind: 'deploy-webhook' },
        skills: ['playwright-e2e-tester', 'playwright-screenshot-inspector'],
        prompt: 'Open Fleet Control Center, verify the selected surface renders settled content, and capture a screenshot artifact.',
        rationale: 'The operator UI has had loading-state false positives; a browser canary should verify settled pixels.',
      },
    ],
  },
};

export const fixtureSimulation: SimulationState = {
  id: 'fixture-sim-port-daddy-001',
  projectDir: PORT_DADDY_ROOT,
  startedAt: FIXTURE_TIME,
  hours: 1,
  speed: 60,
  seed: 42,
  fixture: true,
  events: [
    {
      id: 'fixture-event-001',
      simulationId: 'fixture-sim-port-daddy-001',
      type: 'bond.escrow',
      atMs: 0,
      agentId: 'qa-sentinel',
      usd: 0.25,
      message: 'Escrowed QA Sentinel bond.',
    },
    {
      id: 'fixture-event-002',
      simulationId: 'fixture-sim-port-daddy-001',
      type: 'agent.spawn',
      atMs: 500,
      agentId: 'qa-sentinel',
      message: 'QA Sentinel wakes on PR signal.',
    },
    {
      id: 'fixture-event-003',
      simulationId: 'fixture-sim-port-daddy-001',
      type: 'file.write',
      atMs: 12_000,
      agentId: 'documentarian',
      path: 'docs/shipwright/INTEGRATION-PLAN.md',
      message: 'Documents route and state contract for Shipwright UI.',
    },
    {
      id: 'fixture-event-004',
      simulationId: 'fixture-sim-port-daddy-001',
      type: 'simulation.done',
      atMs: 60_000,
      message: 'Simulation completes under daily budget.',
      metadata: { totalUsd: 0.43 },
    },
  ],
};

export const fixtureMessages: ShipwrightMessage[] = [
  {
    id: 'fixture-message-001',
    projectDir: PORT_DADDY_ROOT,
    role: 'shipwright',
    content: 'I would start with three agents: QA Sentinel, Documentarian, and Browser Canary. The repo is hot enough that smaller bounded agents beat one large strategy pass.',
    createdAt: FIXTURE_TIME,
    fixture: true,
  },
];

export function fixtureSurveyForProject(projectDir?: string): ProjectSurvey[] {
  if (!projectDir) return fixtureSurveys;
  return fixtureSurveys.filter((survey) => survey.root === projectDir || survey.project === projectDir);
}
