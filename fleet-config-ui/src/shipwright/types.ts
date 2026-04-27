/**
 * Shipwright UI data contracts.
 *
 * WHY IT EXISTS: the daemon routes are still landing in phases, but the UI
 * needs one typed contract for fixtures, API helpers, Harbor cards, Focus mode,
 * and Simulation replay. Keeping these types here avoids leaking Fleet UI
 * component concerns into the daemon docs.
 *
 * @example
 *   const survey: ProjectSurvey = {
 *     project: 'port-daddy',
 *     root: '/Users/erichowens/coding/port-daddy',
 *     surveyedAt: new Date().toISOString(),
 *     fixture: true,
 *     classification: { kind: 'server-daemon', languages: ['typescript'], frameworks: ['fastify'] },
 *     intent: 'Authoritative port manager.',
 *     purpose: 'Coordinate local multi-agent work.',
 *     status: { activity: 'hot', commitsLast30d: 120, testsPassing: true, hasFleet: true, fleetSizeAgents: 8 },
 *     hotFiles: ['server.ts'],
 *     risks: [],
 *     opportunities: [],
 *     confidence: 0.8,
 *   };
 */

export type ProjectKind = 'server-daemon' | 'web-app' | 'mobile' | 'lib' | 'cli' | 'site';
export type ActivityHeat = 'hot' | 'warm' | 'cool' | 'cold';
export type ModelTier = 'haiku' | 'sonnet' | 'opus';
export type ShipwrightView = 'harbor' | 'focus' | 'simulation' | 'control' | 'ship-debug';
export type ShipwrightTriggerKind =
  | 'cron'
  | 'git-push'
  | 'git-pr'
  | 'file-watch'
  | 'sentry-webhook'
  | 'deploy-webhook'
  | 'ci-duration'
  | 'service-claim'
  | 'tuple-pattern'
  | 'manual';

export interface ProjectClassification {
  kind: ProjectKind;
  languages: string[];
  frameworks: string[];
  deliveryMedium?: string;
  uiSurfaces?: string[];
}

export interface ProjectSurveyStatus {
  activity: ActivityHeat;
  commitsLast30d: number;
  openPRs?: number;
  testSuites?: number;
  testsPassing?: boolean;
  ciRed?: boolean;
  docFreshness?: 'current' | 'stale' | 'missing';
  hasFleet: boolean;
  fleetSizeAgents: number;
  sentryConfigured?: boolean;
}

export interface ProjectSurvey {
  project: string;
  root: string;
  surveyedAt: string;
  fixture?: boolean;
  classification: ProjectClassification;
  intent: string;
  purpose: string;
  status: ProjectSurveyStatus;
  hotFiles: string[];
  risks: string[];
  opportunities: string[];
  costHintUsdPerDay?: number;
  confidence: number;
}

export interface ProposedTrigger {
  kind: ShipwrightTriggerKind;
  cron?: string;
  paths?: string[];
  webhook?: string;
  tuple?: string[];
}

export interface ProposedAgent {
  id: string;
  archetype: string;
  backend: string;
  model: string;
  bondUsd: number;
  budgetUsdPerDay: number;
  trigger: ProposedTrigger;
  skills: string[];
  prompt: string;
  rationale: string;
}

export interface ProposedFleetLimits {
  maxConcurrentSpawns: number;
  maxSpawnsPerHour: number;
  budgetUsdPerDay: number;
  bondCeilingUsd: number;
}

export interface ProposedFleet {
  version: 2;
  project: string;
  projectDir: string;
  proposedBy: 'shipwright';
  proposedAt: string;
  fixture?: boolean;
  limits: ProposedFleetLimits;
  agents: ProposedAgent[];
}

export interface ShipwrightProposal {
  projectDir: string;
  fleet: ProposedFleet;
  rationale: string;
  exemplarId?: string;
  confidence: number;
  fixture?: boolean;
}

export type SimEventType =
  | 'agent.spawn'
  | 'agent.thinking'
  | 'agent.tool'
  | 'agent.note'
  | 'file.write'
  | 'cost.charge'
  | 'bond.escrow'
  | 'bond.slash'
  | 'arbiter.violation'
  | 'simulation.done';

export interface SimEvent {
  id: string;
  simulationId: string;
  type: SimEventType;
  atMs: number;
  agentId?: string;
  path?: string;
  usd?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface SimulationState {
  id: string;
  projectDir: string;
  startedAt: string;
  hours: number;
  speed: number;
  seed: number;
  fixture?: boolean;
  events: SimEvent[];
}

export interface ShipwrightMessage {
  id: string;
  projectDir: string;
  role: 'user' | 'shipwright' | 'tool';
  content: string;
  createdAt: string;
  fixture?: boolean;
}

export interface ShipwrightDataResult<T> {
  data: T;
  fixture: boolean;
  source: 'daemon' | 'fixture';
}
