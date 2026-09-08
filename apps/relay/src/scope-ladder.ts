/**
 * The scope ladder (ADR-0101 tenancy-boundary appendix) — declared ONCE, in
 * order, as the single source every role and consent check derives from. Do not
 * re-encode this ordering ad hoc anywhere else.
 *
 *   private → repo → team → public
 *
 *   private : on this machine, this OS user (daemon SQLite, Keychain)
 *   repo    : everyone with read access to a GitHub repo (fleet reviews, run pages)
 *   team    : the operator's cloud infrastructure (relay D1: users, fleet_runs)
 *   public  : anyone (committed roadmap snapshot, portdaddy.dev, published receipts)
 */

export const SCOPE_TIERS = ['private', 'repo', 'team', 'public'] as const;
export type ScopeTier = (typeof SCOPE_TIERS)[number];

/** Ordinal position of a tier (private=0 … public=3). */
export function tierRank(tier: ScopeTier): number {
  return SCOPE_TIERS.indexOf(tier);
}

/**
 * True when moving `from` → `to` crosses toward a wider tier (i.e. data leaves a
 * narrower scope). A crossing that widens scope is the point at which an
 * explicit data-boundary consent must already have been obtained.
 */
export function widensScope(from: ScopeTier, to: ScopeTier): boolean {
  return tierRank(to) > tierRank(from);
}
