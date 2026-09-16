/** Worker-local YAML decoding; the document projection and defaults are shared
 * with the signed-in relay inventory. Why: each Worker installs its own npm
 * dependencies, so shared modules must not import a sibling's YAML package.
 */
import { parse as parseYaml } from 'yaml';
import {
  fleetSquidEventsFromDocument, fleetXoFromDocument,
  fleetMediatorFromDocument, fleetShipsFromDocument,
} from '../../shared/fleet-config.js';
export * from '../../shared/fleet-config.js';

/** Why local decoding: isolate Worker dependencies and preserve invalid-input defaults.
 * @param yaml Trusted default-branch fleet definition.
 * @returns Parsed document or null.
 */
function document(yaml: string): unknown {
  try { return parseYaml(yaml); } catch { return null; }
}

/** Why explicit consent: publication must never be ambient.
 * @param yaml Trusted fleet definition. @returns Explicit event-publication consent. */
export function parseFleetSquidEvents(yaml: string): boolean {
  return fleetSquidEventsFromDocument(document(yaml));
}
/** Why explicit consent: optional XO inference spends tenant resources.
 * @param yaml Trusted fleet definition. @returns Explicit XO consent. */
export function parseFleetXo(yaml: string): boolean {
  return fleetXoFromDocument(document(yaml));
}
/** Why fail closed: malformed configuration cannot authorize a new scan.
 * @param yaml Trusted fleet definition. @returns Mediator configuration, disabled on malformed input. */
export function parseFleetMediator(yaml: string) {
  return fleetMediatorFromDocument(document(yaml));
}
/** Why shared projection: the account inventory must describe executor choices.
 * @param yaml Trusted fleet definition. @param trigger Requested event, or '*' for inventory.
 * @returns Matching ships, or null for the executor's existing default roster.
 */
export function parseFleetShips(yaml: string, trigger: string) {
  return fleetShipsFromDocument(document(yaml), trigger);
}
