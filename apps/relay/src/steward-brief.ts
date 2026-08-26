/**
 * apps/relay/src/steward-brief.ts — turn one deck-log entry's `detail` blob
 * into the answers an operator actually came for.
 *
 * WHY THIS MODULE EXISTS. The first cut of `/account/steward` rendered the two
 * ledgers faithfully and was, in the operator's words, inscrutable: it proved
 * the seat had a pulse and told you nothing about whether it was doing
 * anything useful. Three failures, all of them the same failure:
 *
 * 1. **It answered in the seat's vocabulary, not the reader's.** "wake ×1",
 *    "tier 3", "requested by tick" are internal terms. A reader wants to know
 *    what the Steward is working on and what it needs from them.
 * 2. **It threw away the best data it had.** Every wake writes a `detail` JSON
 *    blob containing the seat's full ranked docket — on this repo, 45 PRs with
 *    a reason each. The page never touched it. The queue is the single most
 *    informative thing the seat produces and it was invisible.
 * 3. **It could not say the most important thing.** Right now this seat cannot
 *    merge anything at all, because no landing token is provisioned. That fact
 *    determines whether the whole page means "working" or "watching
 *    helplessly", and it appeared nowhere.
 *
 * The remedy is not more rows. It is deriving a *brief* — what is it working
 * on, what is the queue, what is blocked, what does it need from you — and
 * leading with that. The ledgers stay underneath as evidence, which is what
 * ledgers are for.
 *
 * PARSING POSTURE: `detail` is written by the seat and read here, one version
 * skew apart at all times (two Workers, two deploys). So every field is
 * optional, every shape is checked, and a blob this cannot understand yields
 * an empty brief rather than an exception — the ledger rows below still
 * render, and the page degrades to what it used to be instead of to a 500.
 */

/** What the seat's landing arm did, as recorded in a deck-log entry. */
export interface BriefLanding {
  attempted: boolean;
  landed: boolean;
  reason: string;
}

/** One PR on the seat's ranked docket, parsed back out of the printed form. */
export interface DocketItem {
  /** PR number. */
  pr: number;
  /** The seat's own rationale, e.g. `tier 3: red required checks…`. */
  rationale: string;
  /** Short grouping key — `tier 3`, `tier 5`, or `other`. */
  tier: string;
  /** True for the one PR the tick actually worked this wake. */
  current: boolean;
}

/** The derived answer to "what is this seat doing?" */
export interface SeatBrief {
  /** The docket, ranked as the seat ranked it. Empty when unparseable. */
  docket: DocketItem[];
  /** Counts per tier, most-blocking first, for the one-line queue summary. */
  tiers: Array<{ tier: string; count: number; rationale: string }>;
  /** What the landing arm did, when the entry recorded it. */
  landing: BriefLanding | null;
  /** How many wake stimuli this entry drained. */
  events: number;
}

/** The docket's own text for "there was nothing to rank". */
const DOCKET_EMPTY = 'docket empty';

/**
 * Parse the printed docket back into structured items.
 *
 * WHY PARSE A RENDERED STRING rather than change the seat to store JSON: the
 * deck log is append-only and permanent, so every entry already written is in
 * this format and always will be. A reader that only understands a future
 * shape would show nothing for the entire history — including the entries that
 * matter most, the ones from the incident being investigated. Parsing what
 * exists is the only option that can read the past.
 *
 * The format is fixed by `renderDocket` in `apps/steward/src/priority.ts`:
 * `→ #6419 tier 3: reason` for the current item, two leading spaces for the
 * rest. Anything that does not match is skipped rather than guessed at.
 *
 * @param text - The `docket` field of a deck-log entry's detail blob.
 * @returns Ranked items; empty when absent, empty-docket, or unparseable.
 */
export function parseDocket(text: unknown): DocketItem[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  if (text.startsWith(DOCKET_EMPTY)) return [];
  const out: DocketItem[] = [];
  for (const line of text.split('\n')) {
    const m = /^(\s*[→>]?\s*)#(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const rationale = (m[3] ?? '').trim();
    const tier = /^(tier\s+\d+)/i.exec(rationale)?.[1]?.toLowerCase();
    out.push({
      pr: Number(m[2]),
      rationale,
      tier: tier ?? 'other',
      current: (m[1] ?? '').includes('→'),
    });
  }
  return out;
}

/**
 * Group a docket into per-tier counts, most-blocking first.
 *
 * PURPOSE — a 45-line list is not a summary. An operator needs "20 blocked on
 * red checks, 25 aging out" before they need the individual numbers, and the
 * tier's own rationale text already says what the tier means, so the summary
 * costs no new vocabulary. Ordering is by the seat's ranking, not by count:
 * the tier it is working now belongs at the top even if it is the smallest.
 *
 * @param docket - Ranked docket items.
 * @returns One entry per distinct tier, in first-appearance (priority) order.
 */
export function summarizeTiers(
  docket: DocketItem[],
): Array<{ tier: string; count: number; rationale: string }> {
  const seen = new Map<string, { tier: string; count: number; rationale: string }>();
  for (const d of docket) {
    const hit = seen.get(d.tier);
    if (hit) hit.count += 1;
    // The first item of a tier carries the rationale the whole tier shares;
    // later ones repeat it, so keeping the first is both cheapest and correct.
    else seen.set(d.tier, { tier: d.tier, count: 1, rationale: d.rationale });
  }
  return [...seen.values()];
}

/**
 * Derive the brief from a deck-log entry's `detail` JSON.
 *
 * DESIGN — TOTAL, NEVER THROWS. This runs inside a page render for a blob
 * written by a different Worker at a possibly different version. A parse error
 * must cost the brief, not the page: the ledger rows underneath are the
 * fallback, and they are exactly what the page showed before this existed.
 *
 * @param detail - The raw `detail` column of a deck-log entry.
 * @returns The derived brief; empty fields where the blob said nothing.
 */
export function briefFromDetail(detail: unknown): SeatBrief {
  const empty: SeatBrief = { docket: [], tiers: [], landing: null, events: 0 };
  if (typeof detail !== 'string' || !detail.trim()) return empty;
  let bag: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    bag = parsed as Record<string, unknown>;
  } catch {
    return empty;
  }
  const docket = parseDocket(bag.docket);
  const rawLanding = bag.landing;
  const landing =
    rawLanding && typeof rawLanding === 'object' && !Array.isArray(rawLanding)
      ? {
          attempted: (rawLanding as Record<string, unknown>).attempted === true,
          landed: (rawLanding as Record<string, unknown>).landed === true,
          reason: String((rawLanding as Record<string, unknown>).reason ?? ''),
        }
      : null;
  return {
    docket,
    tiers: summarizeTiers(docket),
    landing,
    events: Array.isArray(bag.events) ? bag.events.length : 0,
  };
}

/**
 * State the seat's merge capability in one sentence a stranger can act on.
 *
 * WHY THIS IS THE HEADLINE. A seat that renders perfect verdicts and cannot
 * execute any of them is not "working" — it is watching. The distinction is
 * invisible in the ledgers (a NEEDS-WORK verdict looks identical either way)
 * and it is the first thing an operator needs, because the fix is theirs: mint
 * a token. Reading it from the landing record rather than from configuration
 * keeps the relay honest about what it can actually observe.
 *
 * The unknown case is stated as unknown. "No LAND verdict has come up yet" is
 * genuinely different from "landing is armed", and a page that guessed the
 * optimistic reading would be lying in exactly the direction that costs most.
 *
 * @param landing - The landing record from the newest entry, if any.
 * @returns A sentence, and whether it represents a blocked seat.
 */
export function landingSentence(
  landing: BriefLanding | null,
): { text: string; blocked: boolean } {
  if (!landing) {
    return {
      text: 'No landing attempted yet — nothing has reached a LAND verdict since this entry.',
      blocked: false,
    };
  }
  if (landing.landed) return { text: landing.reason, blocked: false };
  if (!landing.attempted) return { text: landing.reason, blocked: true };
  return { text: landing.reason, blocked: true };
}
