/**
 * CLI Actor Commands
 *
 * Handles: actor, actors for durable maritime actor projections.
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';

interface MaritimeActorCliRecord {
  id: string;
  name: string;
  identity: string;
  mission: string;
  body?: {
    state?: string;
    liveAgentId?: string | null;
    liveness?: string | null;
  };
  fleet?: {
    configured?: boolean;
    project?: string | null;
    agent?: string | null;
    status?: string | null;
  };
}

function printActor(actor: MaritimeActorCliRecord): void {
  console.log(`${actor.name} (${actor.id})`);
  console.log(`  identity: ${actor.identity}`);
  console.log(`  mission: ${actor.mission}`);
  console.log(`  body: ${actor.body?.state ?? 'unknown'}${actor.body?.liveAgentId ? ` (${actor.body.liveAgentId})` : ''}`);
  if (actor.fleet?.configured) {
    console.log(`  fleet: ${actor.fleet.project || 'unknown'}:${actor.fleet.agent || actor.id} ${actor.fleet.status || ''}`.trimEnd());
  } else if (actor.fleet?.agent) {
    console.log(`  fleet: compatibility agent ${actor.fleet.agent} not currently configured`);
  }
}

function printActorList(actors: MaritimeActorCliRecord[]): void {
  if (actors.length === 0) {
    ui.info('No maritime actors found.');
    return;
  }

  for (const actor of actors) {
    const body = actor.body?.state ?? 'unknown';
    const fleet = actor.fleet?.configured ? ` fleet:${actor.fleet.status || 'configured'}` : '';
    console.log(`${actor.name.padEnd(13)} ${body.padEnd(8)} ${actor.identity}${fleet}`);
  }
}

export async function handleActors(target: string | undefined, _args: string[], options: CLIOptions): Promise<void> {
  if (target === 'help') {
    console.log('Usage: pd actors [name] [--json]');
    console.log('       pd actor <name> [--json]');
    console.log('');
    console.log('Names: navigator, coxswain, signalman, harbormaster, sounder, lookout, breaker, caulker, quartermaster');
    return;
  }

  const actorId = target && target !== 'list' ? target : null;
  const path = actorId ? `/actors/${encodeURIComponent(actorId)}` : '/actors';
  const response = await pdFetch(`${PORT_DADDY_URL}${path}`);

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    ui.error(body.error || `Request failed with HTTP ${response.status}`);
    process.exit(1);
  }

  const payload = await response.json() as {
    success: boolean;
    actors?: MaritimeActorCliRecord[];
    actor?: MaritimeActorCliRecord;
  };

  if (isJson(options)) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (payload.actor) {
    printActor(payload.actor);
    return;
  }

  if (!isQuiet(options)) {
    ui.info('Maritime actors');
  }
  printActorList(payload.actors ?? []);
}
