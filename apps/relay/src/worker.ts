/**
 * Deployment facade for Relay's public Worker and internal RPC entrypoints.
 *
 * Keeping the WorkerEntrypoint import out of index.ts lets Node-based route
 * tests continue to exercise the public Worker without emulating workerd.
 */

export {
  default,
  CoordinationRoom,
  HarborChannel,
  HarborQuota,
} from './index.js';
export { CoordinationGrantService } from './coordination-grant-service.js';
