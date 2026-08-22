/**
 * Privacy boundary for routine Giant Squid status.
 *
 * Full paths and retained coordination values are useful only during an
 * explicitly enabled debug capture. Routine status preserves conformance and
 * exact window counts while removing those historical identifiers.
 */

import { basename } from 'node:path';

import type { SquidProviderConformance } from './conformance.js';
import type { MatrixSnapshot } from './identity.js';

export interface RoutineSquidStatusDetails {
  workspace: string;
  providers: SquidProviderConformance[];
  repair: string | null;
  matrix: MatrixSnapshot;
  detailsHidden: boolean;
}

/**
 * Hide absolute paths and retained matrix values unless debug capture is on.
 * The design keeps exact totals and truncation truth visible, so privacy does
 * not turn an old or overloaded matrix into a falsely empty system.
 *
 * @param input - Raw local conformance and matrix details.
 * @param input.workspace - Absolute workspace selected by the caller.
 * @param input.providers - Provider wiring rows containing local config paths.
 * @param input.repair - Optional repair command that may embed the workspace.
 * @param input.matrix - Bounded matrix values and exact per-kind totals.
 * @param input.debugEnabled - Whether the operator explicitly enabled capture.
 * @returns Full debug details or a path-free routine projection.
 */
export function sanitizeRoutineSquidStatusDetails(input: {
  workspace: string;
  providers: SquidProviderConformance[];
  repair: string | null;
  matrix: MatrixSnapshot;
  debugEnabled: boolean;
}): RoutineSquidStatusDetails {
  if (input.debugEnabled) {
    return {
      workspace: input.workspace,
      providers: input.providers,
      repair: input.repair,
      matrix: input.matrix,
      detailsHidden: false,
    };
  }

  const totals = input.matrix.window.totals;
  return {
    workspace: basename(input.workspace) || '.',
    providers: input.providers.map((provider) => ({ ...provider, configPath: '' })),
    repair: input.repair ? 'Open FleetBar, select Giant Squid, and choose Repair.' : null,
    matrix: {
      ...input.matrix,
      path: '',
      alerts: [],
      pheromones: [],
      locks: [],
      window: {
        ...input.matrix.window,
        returned: { alerts: 0, pheromones: 0, locks: 0 },
        truncated: {
          alerts: totals.alerts > 0,
          pheromones: totals.pheromones > 0,
          locks: totals.locks > 0,
          any: totals.alerts > 0 || totals.pheromones > 0 || totals.locks > 0,
        },
        valueCharsTruncated: { alerts: 0, pheromones: 0, locks: 0, any: false },
      },
    },
    detailsHidden: true,
  };
}
