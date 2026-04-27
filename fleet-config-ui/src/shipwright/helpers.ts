import type { ProjectSurvey, ProposedAgent, ShipwrightView } from './types';

/**
 * Shipwright view helpers.
 *
 * WHY IT EXISTS: components need stable URL labels and deterministic ship
 * identities, but Fast Refresh requires non-component exports to live outside
 * React component files.
 *
 * @example
 *   const view = normalizeShipwrightSubview('simulation');
 */

export type ShipwrightSubview = Exclude<ShipwrightView, 'ship-debug'>;

export const shipwrightSubviews: ShipwrightSubview[] = ['harbor', 'focus', 'simulation', 'control'];

export function normalizeShipwrightSubview(value: string | null | undefined): ShipwrightSubview {
  if (value === 'focus' || value === 'simulation' || value === 'control') return value;
  return 'harbor';
}

export function labelForSubview(view: ShipwrightSubview): string {
  if (view === 'focus') return 'Focus';
  if (view === 'simulation') return 'Simulation';
  if (view === 'control') return 'FleetControl';
  return 'Harbor';
}

export function slugForFleetIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'project';
}

export function shipIdentityForSurvey(survey: ProjectSurvey): string {
  return `${slugForFleetIdentity(survey.project)}:fleet:harbor`;
}

export function shipIdentityForAgent(projectName: string, agent: ProposedAgent): string {
  return `${slugForFleetIdentity(projectName)}:fleet:${slugForFleetIdentity(agent.id)}`;
}

export function sourceLabel(result: { fixture: boolean; source: string }): string {
  return result.fixture ? 'Fixture data' : 'Daemon data';
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}
