import { WorkerEntrypoint } from 'cloudflare:workers';
import { fleetControlRequest, type FleetControlServiceContract } from './fleet-pause-control.js';
import type { Env } from './types.js';

/** Internal service binding only. Public HTTP cannot admit or resume ships. */
export class FleetControlService extends WorkerEntrypoint<Env> implements FleetControlServiceContract {
  override fetch(): Response { return new Response('Not found', { status: 404 }); }
  async admit(expectedRevision?: number) {
    return fleetControlRequest(this.env.FLEET_CONTROL, '/admit', { expectedRevision });
  }
}
