import { getDaemonUrl } from '../api';
import {
  fixtureMessages,
  fixtureProposal,
  fixtureSimulation,
  fixtureSurveyForProject,
} from './fixtures';
import type {
  ProjectSurvey,
  ShipwrightDataResult,
  ShipwrightMessage,
  ShipwrightProposal,
  SimulationState,
} from './types';

interface SurveyEnvelope {
  surveys?: ProjectSurvey[];
  survey?: ProjectSurvey;
}

interface ProposalEnvelope {
  proposal?: ShipwrightProposal;
}

interface SimulationEnvelope {
  simulation?: SimulationState;
}

interface ChatEnvelope {
  messages?: ShipwrightMessage[];
  message?: ShipwrightMessage;
}

function shipwrightEndpoint(path: string): string {
  return `${getDaemonUrl()}${path}`;
}

async function shipwrightRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(shipwrightEndpoint(path), {
    method,
    ...(body !== undefined
      ? {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }
      : {}),
  });

  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function fixtureResult<T>(data: T): ShipwrightDataResult<T> {
  return { data, fixture: true, source: 'fixture' };
}

function daemonResult<T>(data: T): ShipwrightDataResult<T> {
  return { data, fixture: false, source: 'daemon' };
}

function surveysFromEnvelope(envelope: SurveyEnvelope): ProjectSurvey[] {
  if (Array.isArray(envelope.surveys)) return envelope.surveys;
  return envelope.survey ? [envelope.survey] : [];
}

/**
 * Load Shipwright survey rows, falling back to explicit fixture data while the
 * daemon route lands.
 *
 * @example
 *   const surveys = await loadShipwrightSurveys('/Users/me/port-daddy');
 */
export async function loadShipwrightSurveys(projectDir?: string): Promise<ShipwrightDataResult<ProjectSurvey[]>> {
  const params = new URLSearchParams();
  if (projectDir) params.set('projectDir', projectDir);
  const path = `/shipwright/survey${params.toString() ? `?${params}` : ''}`;

  try {
    const envelope = await shipwrightRequest<SurveyEnvelope>('GET', path);
    return daemonResult(surveysFromEnvelope(envelope));
  } catch {
    return fixtureResult(fixtureSurveyForProject(projectDir));
  }
}

/**
 * Load the current proposal for one project.
 *
 * @example
 *   const proposal = await loadShipwrightProposal('/Users/me/port-daddy');
 */
export async function loadShipwrightProposal(projectDir: string): Promise<ShipwrightDataResult<ShipwrightProposal>> {
  const params = new URLSearchParams({ projectDir });

  try {
    const envelope = await shipwrightRequest<ProposalEnvelope>('GET', `/shipwright/proposal?${params}`);
    if (!envelope.proposal) throw new Error('proposal missing');
    return daemonResult(envelope.proposal);
  } catch {
    return fixtureResult({ ...fixtureProposal, projectDir });
  }
}

/**
 * Request a fresh proposal from the daemon. Fixture fallback intentionally
 * mirrors `loadShipwrightProposal` so UI controls can be built before the route.
 *
 * @example
 *   await proposeShipwrightFleet({ projectDir, model: 'sonnet', budgetUsdPerDay: 5 });
 */
export async function proposeShipwrightFleet(opts: {
  projectDir: string;
  model?: 'haiku' | 'sonnet' | 'opus';
  budgetUsdPerDay?: number;
  bondCeilingUsd?: number;
}): Promise<ShipwrightDataResult<ShipwrightProposal>> {
  try {
    const envelope = await shipwrightRequest<ProposalEnvelope>('POST', '/shipwright/propose', opts);
    if (!envelope.proposal) throw new Error('proposal missing');
    return daemonResult(envelope.proposal);
  } catch {
    return fixtureResult({ ...fixtureProposal, projectDir: opts.projectDir });
  }
}

/**
 * Start or load a simulation for one project.
 *
 * @example
 *   const sim = await startShipwrightSimulation({ projectDir, seed: 42 });
 */
export async function startShipwrightSimulation(opts: {
  projectDir: string;
  hours?: number;
  speed?: number;
  seed?: number;
}): Promise<ShipwrightDataResult<SimulationState>> {
  try {
    const envelope = await shipwrightRequest<SimulationEnvelope>('POST', '/shipwright/simulate', opts);
    if (!envelope.simulation) throw new Error('simulation missing');
    return daemonResult(envelope.simulation);
  } catch {
    return fixtureResult({
      ...fixtureSimulation,
      projectDir: opts.projectDir,
      hours: opts.hours ?? fixtureSimulation.hours,
      speed: opts.speed ?? fixtureSimulation.speed,
      seed: opts.seed ?? fixtureSimulation.seed,
    });
  }
}

/**
 * Load Shipwright chat turns for a project.
 *
 * @example
 *   const chat = await loadShipwrightChat(projectDir);
 */
export async function loadShipwrightChat(projectDir: string): Promise<ShipwrightDataResult<ShipwrightMessage[]>> {
  const params = new URLSearchParams({ projectDir });

  try {
    const envelope = await shipwrightRequest<ChatEnvelope>('GET', `/shipwright/chat?${params}`);
    return daemonResult(envelope.messages ?? []);
  } catch {
    return fixtureResult(fixtureMessages.map((message) => ({ ...message, projectDir })));
  }
}

/**
 * Send one chat message to Shipwright.
 *
 * @example
 *   await sendShipwrightChatMessage(projectDir, 'Lower the browser canary budget.');
 */
export async function sendShipwrightChatMessage(
  projectDir: string,
  content: string,
): Promise<ShipwrightDataResult<ShipwrightMessage>> {
  try {
    const envelope = await shipwrightRequest<ChatEnvelope>('POST', '/shipwright/chat', { projectDir, content });
    if (!envelope.message) throw new Error('message missing');
    return daemonResult(envelope.message);
  } catch {
    return fixtureResult({
      id: `fixture-message-${Date.now()}`,
      projectDir,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      fixture: true,
    });
  }
}
