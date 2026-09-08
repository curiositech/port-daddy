/**
 * The Steward brief — deriving "what is it doing?" from a deck-log entry.
 *
 * WHAT THESE PIN, AND WHY. The page these feed was shipped once already and
 * came back judged inscrutable: it rendered both ledgers faithfully and told a
 * reader nothing about whether the seat was doing anything worth having. The
 * data was never the problem — every wake writes a `detail` blob holding the
 * seat's full ranked docket, 45 pull requests on this repo, and the page threw
 * it away. So these tests are about *whether the useful thing survives the
 * trip*: the docket parses, the queue summarizes, a held landing is loud, and
 * a blob from a differently-versioned Worker degrades to empty instead of
 * taking the page down with it.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDocket,
  summarizeTiers,
  briefFromDetail,
  landingSentence,
} from '../src/steward-brief.js';

/**
 * Verbatim shape of a real production entry (deck-log id 1,
 * `curiositech/port-daddy`, 2026-08-26 05:54:31Z), trimmed in length only.
 * Using the real bytes is the point: the first version of this page was
 * "correct" against invented fixtures and useless against this.
 */
const REAL_DETAIL = JSON.stringify({
  charterVersion: 1,
  events: [{ kind: 'operator', deliveryId: 'first-beat-1787723666', prNumber: null }],
  docket:
    '→ #6419 tier 3: red required checks on a fleet-owned PR\n' +
    '  #5757 tier 3: red required checks on a fleet-owned PR\n' +
    '  #7540 tier 3: red required checks on a fleet-owned PR\n' +
    '  #6085 tier 5: staleness queue\n' +
    '  #7698 tier 5: staleness queue',
  verdict: {
    repo: 'curiositech/port-daddy',
    prNumber: 6419,
    verdict: 'NEEDS-WORK',
    evidence: 'required checks red on head (tier 3: red required checks on a fleet-owned PR)',
    requestedBy: 'tick',
    createdAt: 1787723671,
  },
  landing: null,
});

describe('parseDocket — the queue must survive the round trip', () => {
  it('recovers every PR, its rationale, and which one is current', () => {
    // The seat prints its docket as text and the deck log is append-only, so
    // every entry ever written is in this format. A reader that only spoke a
    // future JSON shape would show nothing for the entire history — including
    // the entries from whatever incident is being investigated.
    const d = parseDocket(JSON.parse(REAL_DETAIL).docket);
    expect(d).toHaveLength(5);
    expect(d[0]).toMatchObject({ pr: 6419, tier: 'tier 3', current: true });
    expect(d[1]).toMatchObject({ pr: 5757, current: false });
    expect(d[4]).toMatchObject({ pr: 7698, tier: 'tier 5' });
  });

  it('marks exactly one item current', () => {
    // The arrow is the tick's statement of what it actually worked this wake.
    // Two arrows, or none, would make the "Right now" headline a guess.
    expect(parseDocket(JSON.parse(REAL_DETAIL).docket).filter(d => d.current)).toHaveLength(1);
  });

  it('reads the seat\'s own empty-docket sentence as empty, not as one item', () => {
    // renderDocket emits prose, not a list, when there is nothing to rank.
    // Parsing that prose into a fake PR would invent work the seat never had.
    expect(parseDocket('docket empty: no open non-draft PRs')).toEqual([]);
  });

  it('skips lines it cannot read instead of guessing', () => {
    const d = parseDocket('  #12 tier 1: real\nthis is not a docket line\n  #13 tier 1: also real');
    expect(d.map(x => x.pr)).toEqual([12, 13]);
  });

  it('survives a non-string, which is what a version skew looks like', () => {
    expect(parseDocket(undefined)).toEqual([]);
    expect(parseDocket({ items: [] })).toEqual([]);
  });
});

describe('summarizeTiers — a 45-line list is not a summary', () => {
  it('counts per tier in the seat\'s own priority order', () => {
    // Order is by ranking, not by size: the tier being worked belongs first
    // even when it is the smaller group, because that is the reading order of
    // "what is happening" followed by "what is behind it".
    const t = summarizeTiers(parseDocket(JSON.parse(REAL_DETAIL).docket));
    expect(t.map(x => [x.tier, x.count])).toEqual([['tier 3', 3], ['tier 5', 2]]);
  });

  it('keeps the rationale so the summary needs no new vocabulary', () => {
    const t = summarizeTiers(parseDocket(JSON.parse(REAL_DETAIL).docket));
    expect(t[0].rationale).toContain('red required checks');
  });
});

describe('briefFromDetail — total, because a page must not 500 on a blob', () => {
  it('derives the whole brief from a real production entry', () => {
    const b = briefFromDetail(REAL_DETAIL);
    expect(b.docket).toHaveLength(5);
    expect(b.tiers).toHaveLength(2);
    expect(b.events).toBe(1);
    expect(b.landing).toBeNull();
  });

  it('returns an empty brief rather than throwing on garbage', () => {
    // This blob is written by a different Worker at a possibly different
    // version. A parse failure must cost the brief, never the page — the
    // ledger rows underneath are the fallback and are exactly what the page
    // showed before the brief existed.
    for (const bad of ['', 'not json', '[]', 'null', undefined, 42]) {
      const b = briefFromDetail(bad);
      expect(b.docket).toEqual([]);
      expect(b.landing).toBeNull();
    }
  });

  it('reads a landing record when the entry carries one', () => {
    const b = briefFromDetail(
      JSON.stringify({ landing: { attempted: false, landed: false, reason: 'seat holds no landing capability' } }),
    );
    expect(b.landing).toEqual({
      attempted: false,
      landed: false,
      reason: 'seat holds no landing capability',
    });
  });

  it('coerces a half-written landing record instead of trusting it', () => {
    // Missing booleans must read as false, never as truthy-by-absence: the
    // page shows a loud banner for a landing that did NOT complete, and the
    // dangerous direction is claiming a merge happened when it did not.
    const b = briefFromDetail(JSON.stringify({ landing: { reason: 'x' } }));
    expect(b.landing).toEqual({ attempted: false, landed: false, reason: 'x' });
  });
});

describe('landingSentence — the most important fact on the page', () => {
  it('treats a held landing as blocked', () => {
    // A seat that renders correct verdicts and can execute none of them is
    // watching, not working — and the ledgers cannot show the difference,
    // because a NEEDS-WORK row looks identical either way.
    const s = landingSentence({ attempted: false, landed: false, reason: 'no landing capability' });
    expect(s.blocked).toBe(true);
    expect(s.text).toContain('no landing capability');
  });

  it('treats a completed landing as not blocked', () => {
    expect(landingSentence({ attempted: true, landed: true, reason: 'enqueued at position 1' }).blocked)
      .toBe(false);
  });

  it('says "not attempted" rather than guessing the optimistic reading', () => {
    // "No LAND verdict has come up yet" is genuinely different from "landing
    // is armed", and guessing the happy answer would be a lie in the exact
    // direction that costs most.
    const s = landingSentence(null);
    expect(s.blocked).toBe(false);
    expect(s.text).toContain('No landing attempted');
  });
});
