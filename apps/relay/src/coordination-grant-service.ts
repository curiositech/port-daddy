/** Service-binding-only capability issuer for Fleet coordination peers. */

import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  mintFleetCoordinationGrant,
  type FleetCoordinationGrant,
  type FleetCoordinationGrantRequest,
} from './coordination-grants.js';
import type { Env } from './types.js';

export class CoordinationGrantService extends WorkerEntrypoint<Env> {
  /** RPC is the only supported surface; HTTP callers get no grant endpoint. */
  override fetch(): Response {
    return Response.json({ error: 'not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  async mintCoordinationGrant(
    input: FleetCoordinationGrantRequest,
  ): Promise<FleetCoordinationGrant> {
    return mintFleetCoordinationGrant(this.env, input);
  }
}
