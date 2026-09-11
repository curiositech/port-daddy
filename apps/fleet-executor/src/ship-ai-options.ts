/** Metadata-only cloud observability. Never include prompts, paths, or tokens. */
export interface ShipCallContext { runId: string; attempt: number; repoFullName?: string; }

/** Preserve routing/affinity while correlating existing gateway requests.
 * @param gatewayId Existing optional gateway; this never provisions one.
 * @param ship Exact ship name, independent of the selected model/provider.
 * @param context Run identity when available; absent values are not invented.
 * @returns Binding options with raw log payload collection disabled.
 */
export function shipAiOptions(gatewayId: string | undefined, ship: string, context?: ShipCallContext | null) {
  const metadata: Record<string, string | number> = { ship };
  if (context) {
    metadata.run = context.runId;
    metadata.attempt = context.attempt;
    if (context.repoFullName) metadata.repo = context.repoFullName;
  }
  return {
    extraHeaders: {
      'x-session-affinity': `pd-fleet-${ship}`,
      'cf-aig-collect-log-payload': 'false',
    },
    ...(gatewayId ? { gateway: { id: gatewayId, metadata } } : {}),
  };
}
