/**
 * lib/reserved-identity-names.ts — the set of DISPLAY identity names that a
 * self-service caller may never claim at the `/sugar/begin` mint door
 * (#8877 / ADR-0122 / ADR-0040).
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 * `POST /sugar/begin` mints (or verifies) a soul and then stamps the caller's
 * minted `actorId` into a session row keyed on the caller-CHOSEN display
 * `agentId`. That session stamp is exactly what the inbox sender gate
 * (lib/inbox-identity.ts, branch (b)) reads back to decide "may this caller
 * send a message `from` this display name?".
 *
 * The two together are a laundering primitive: register a throwaway newcomer
 * soul (free, `POST /actors/register`), `begin` under `agentId: "system"`, and
 * the daemon itself manufactures a session binding that later authorises an
 * inbox write `from: "system"`. `lib/fleet-engine.ts` renders that `from` into
 * a spawned code-editing agent's prompt as the `- sender:` line, above the
 * message and above "Take one bounded pass in response to this trigger" — a
 * forged AUTHORITY LABEL on an executed instruction.
 *
 * The rule: a self-minted caller cannot bind an authority/system display name.
 * A name is usable as a verified `from` only when the caller's soul actually
 * owns it (a bound alias, or the actorId itself) — never merely because the
 * caller picked it at begin time. Reserved names are refused at the mint door
 * unless the presented credential's own soul already owns that exact name.
 *
 * Threat model (per skills/pd-relay-zero-trust): a lazy / self-interested
 * agent, not a hostile human operator with the daemon's uid. This is therefore
 * an exact-name reservation of the small, fixed vocabulary of authority words
 * and canonical actor role names — the strings that read as authority when
 * rendered as `- sender:`. It is deliberately NOT a fuzzy substring filter.
 *
 * Residual, stated plainly: this matches the FULL canonical name (and the
 * `actor:<name>` mailbox form), not embedded segments. A namespaced handle
 * like "acme:system:node" is not reserved — its rendered sender does not read
 * as the bare authority word. Honest agents namespace their display ids
 * ("proj:node:dev", "pd:cli:worker"), so an exact bare-word reservation costs
 * them nothing while closing the concrete forge.
 */

import { ACTOR_ROSTER } from './actor-roster.js';

/**
 * Authority / system words and standalone durable-actor role names. These are
 * the strings a `- sender:` line must never carry without a credential that
 * owns them. Kept explicit (not derived) so the reservation is auditable.
 */
const SYSTEM_RESERVED: readonly string[] = [
  'system',
  'daemon',
  'operator',
  'admin',
  'administrator',
  'root',
  'superuser',
  'sudo',
  'kernel',
  'port-daddy',
  'portdaddy',
  'harbormaster',
  'harbor',
  'fleet',
  'security',
  // Standalone durable internal actors (ADR internal roster) that are named
  // as authorities in prompts but are not all rows in ACTOR_ROSTER.
  'navigator',
  'lookout',
  'shipwright',
  'purser',
];

/** Canonicalise for comparison: trimmed and lower-cased. */
function canonical(name: string): string {
  return name.trim().toLowerCase();
}

const RESERVED = new Set<string>();
for (const word of SYSTEM_RESERVED) RESERVED.add(canonical(word));
// The canonical actor role ids (coxswain, quartermaster, cartographer, …) —
// the authoritative sender names for the internal roster. Generic aliases
// ("docs", "spend", …) are intentionally NOT reserved: they are ambiguous
// everyday words an honest agent might use, and the harm is the ROLE name.
for (const actor of ACTOR_ROSTER) RESERVED.add(canonical(actor.id));

/**
 * Is `name` a reserved authority/system identity name that a self-service
 * caller may not claim at the mint door?
 *
 * Matches the full canonical string and the `actor:<name>` mailbox form.
 *
 * @param name - The asserted display agentId / identity.
 * @returns true when the name is reserved.
 */
export function isReservedIdentityName(name: string): boolean {
  const c = canonical(name);
  if (!c) return false;
  if (RESERVED.has(c)) return true;
  // The mailbox form `actor:<reserved>` addresses the same authority.
  if (c.startsWith('actor:') && RESERVED.has(c.slice('actor:'.length))) return true;
  return false;
}

/** The reserved set, exposed read-only for tests / diagnostics. */
export function reservedIdentityNames(): string[] {
  return [...RESERVED].sort();
}
