/**
 * The Steward console page (P1 PR 6).
 *
 * WHAT THESE PIN, AND WHY. The page exists because a vital sign nobody can
 * read is not a vital sign — `steward_deck_log` sat at zero rows through four
 * green PRs and only a terminal with Cloudflare credentials could reveal it.
 * So the tests are about *legibility of failure*, not layout: an empty deck log
 * must read as "never run" rather than "quiet", a stopped seat must be
 * distinguishable from a cold one, and nothing may render for a repo the
 * viewer cannot read on GitHub.
 */

import { describe, it, expect } from 'vitest';
import {
  seatVitals,
  renderStewardPage,
  MAX_REPO_CHECKS,
  type SeatView,
} from '../src/steward-page.js';
import type {
  StewardDeckLogRow,
  StewardMergeLedgerRow,
} from '../../shared/steward-ledgers.js';
import type { UserRow } from '../src/db.js';

const NOW = 1_787_723_700; // epoch seconds, fixed so relative times are stable
const HOUR = 3600;
const USER = { id: 1, github_login: 'operator' } as unknown as UserRow;

function deckRow(over: Partial<StewardDeckLogRow> = {}): StewardDeckLogRow {
  return {
    repo: 'acme/widgets',
    entryKind: 'wake',
    summary: 'Wake: drained 1 event(s) [operator ×1]. Tick: NEEDS-WORK on #6419',
    detail: '{}',
    wakeEvents: 1,
    createdAt: NOW - 60,
    ...over,
  };
}

function verdictRow(over: Partial<StewardMergeLedgerRow> = {}): StewardMergeLedgerRow {
  return {
    repo: 'acme/widgets',
    prNumber: 6419,
    verdict: 'NEEDS-WORK',
    evidence: 'required checks red on head (tier 3)',
    requestedBy: 'tick',
    createdAt: NOW - 60,
    ...over,
  };
}

function seat(over: Partial<SeatView> = {}): SeatView {
  const deck = over.deck ?? [deckRow()];
  return {
    vitals: over.vitals ?? seatVitals('acme/widgets', deck, NOW),
    deck,
    ledger: over.ledger ?? [verdictRow()],
  };
}

describe('seatVitals — three states, because two would hide the incident', () => {
  it('reports a seat with NO entries as dead, not quiet', () => {
    // The P1 failure exactly: deployed, commissioned, zero deck-log rows. If
    // this collapsed into a generic "unhealthy" or, worse, rendered like an
    // idle seat, the page would reproduce the blindness it exists to cure.
    const v = seatVitals('acme/widgets', [], NOW);
    expect(v.state).toBe('dead');
    expect(v.lastEntryAt).toBeNull();
  });

  it('separates a seat that STOPPED from one that never started', () => {
    // Different failures, different fixes: "never woken" is provisioning,
    // "stopped beating" is runtime. One badge for both would send an operator
    // to the wrong place.
    const stopped = seatVitals('acme/widgets', [deckRow({ createdAt: NOW - 13 * HOUR })], NOW);
    expect(stopped.state).toBe('stale');
    expect(stopped.lastEntryAt).not.toBeNull();
  });

  it('counts a beat inside the two-heartbeat window as alive', () => {
    // 6h is one heartbeat; the seat is meant to be quiet between beats, and a
    // page that cried stale at one missed beat would train operators to ignore it.
    expect(seatVitals('acme/widgets', [deckRow({ createdAt: NOW - 7 * HOUR })], NOW).state)
      .toBe('alive');
  });
});

describe('rendering — the failure states must read as sentences', () => {
  it('says an empty deck log means never run, not merely quiet', () => {
    const html = renderStewardPage(USER, [seat({ deck: [], ledger: [] })], {
      truncated: false,
      nowSec: NOW,
    });
    expect(html).toContain('never woken');
    // The distinction stated in prose, because the badge alone is a word and
    // the reader needs the inference made for them.
    expect(html).toContain('has never run');
  });

  it('renders a real verdict with its evidence attached', () => {
    // A verdict without evidence is an assertion; §4 requires the reasoning
    // travel with it, and the page is where a stranger checks that.
    const html = renderStewardPage(USER, [seat()], { truncated: false, nowSec: NOW });
    expect(html).toContain('NEEDS-WORK');
    expect(html).toContain('#6419');
    expect(html).toContain('required checks red on head');
    expect(html).toContain('requested by tick');
  });

  it('escapes hostile text from GitHub-controlled fields', () => {
    // Deck-log summaries embed PR titles and provider error text. This page is
    // script-free by CSP, but defence in depth: the escape is the thing that
    // must not regress, since the CSP is one header edit from being weakened.
    const html = renderStewardPage(
      USER,
      [seat({
        deck: [deckRow({ summary: '<img src=x onerror=alert(1)>' })],
        ledger: [verdictRow({ evidence: '"><script>alert(2)</script>' })],
      })],
      { truncated: false, nowSec: NOW },
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).toContain('&lt;img src=x');
  });

  it('admits when the probe cap hid seats rather than implying completeness', () => {
    // Same honesty rule runs-page.ts follows: a truncated list that looks
    // complete is worse than one that says it is not.
    const html = renderStewardPage(USER, [seat()], { truncated: true, nowSec: NOW });
    expect(html).toContain('not complete');
    expect(html).toContain(String(MAX_REPO_CHECKS));
  });

  it('renders an honest empty state when no seat is visible', () => {
    const html = renderStewardPage(USER, [], { truncated: false, nowSec: NOW });
    expect(html).toContain('No Steward seats are visible');
  });

  it('marks an all-quiet heartbeat differently from a wake', () => {
    // The two entry kinds mean different things — one drained real stimuli,
    // one proved liveness with an empty inbox — and an operator scanning the
    // log needs to tell them apart at a glance.
    const html = renderStewardPage(
      USER,
      [seat({ deck: [deckRow({ entryKind: 'all-quiet', wakeEvents: 0, summary: 'ALL QUIET.' })] })],
      { truncated: false, nowSec: NOW },
    );
    expect(html).toContain('all-quiet');
    expect(html).toContain('ALL QUIET.');
  });
});
