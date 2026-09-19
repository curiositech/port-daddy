import type { FleetbotAuthorship } from './github-publisher-contract.js';

interface StampInput {
  body: string;
  authorship: FleetbotAuthorship;
  receiptId: string;
  sourceHeadSha?: string | null;
}

export function fleetbotMutationMarker(receiptId: string): string;
export function stampPullRequestBody(input: StampInput): string;
export function stampFleetbotMessage(input: StampInput): string;
