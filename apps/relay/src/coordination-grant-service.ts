/** Service-binding-only capability issuer for Fleet coordination peers. */

import { WorkerEntrypoint } from 'cloudflare:workers';
import type { CoordinationGrantServiceContract } from '../../../lib/coordination-grant-contract.js';
import {
  mintFleetCoordinationGrant,
  mintFleetInterruptionGrant,
  type FleetCoordinationGrant,
  type FleetCoordinationGrantRequest,
  type FleetInterruptionGrant,
  type FleetInterruptionGrantRequest,
} from './coordination-grants.js';
import type { Env } from './types.js';

export class CoordinationGrantService
  extends WorkerEntrypoint<Env>
  implements CoordinationGrantServiceContract {
  /** RPC is the only supported surface; HTTP callers get no grant endpoint. */
  override fetch(): Response {
    return Response.json({ error: 'not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  async mintCoordinationGrant(
    input: FleetCoordinationGrantRequest,
  ): Promise<FleetCoordinationGrant> {
    return mintFleetCoordinationGrant(this.env, input);
  }

  async mintInterruptionGrant(
    input: FleetInterruptionGrantRequest,
  ): Promise<FleetInterruptionGrant> {
    return mintFleetInterruptionGrant(this.env, input);
  }
}
