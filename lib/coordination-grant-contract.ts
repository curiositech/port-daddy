/** Shared RPC contract for short-lived ADR-0092 Fleet peer grants. */

export interface FleetCoordinationGrantRequest {
  project: string;
  actorId: string;
  ttlSeconds?: number;
}

export interface FleetCoordinationGrant {
  macaroon: string;
  project: string;
  actorId: string;
  verb: 'coordination-sync';
  expiresAt: number;
}

export interface CoordinationGrantServiceContract {
  mintCoordinationGrant(
    input: FleetCoordinationGrantRequest,
  ): Promise<FleetCoordinationGrant>;
}
