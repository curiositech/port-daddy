import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NeedsYouHero from './NeedsYouHero';
import { isForceZoomGated } from '../lib/needsYouGate';
import type { NeedsYouItem, FleetSignal } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dispatchReview: NeedsYouItem = {
  code: 'dispatch_review',
  label: 'Dispatch awaiting review',
  action: 'pd review',
  priority: 0,
  meta: { dispatchId: 'd-42', agent: 'gardener' },
};

const guardViolation: NeedsYouItem = {
  code: 'guard_violation',
  label: 'Coordination guard violation',
  action: 'pd guard check --staged',
  priority: 1,
  meta: { violations: 2 },
};

const budgetCeiling: NeedsYouItem = {
  code: 'budget_ceiling',
  label: 'Budget ceiling near',
  action: 'pd cost summary --project port-daddy',
  priority: 2,
  meta: { percentUsed: 94 },
};

const roadmapNow: NeedsYouItem = {
  code: 'roadmap_now',
  label: 'Roadmap item at now',
  action: 'pd roadmap list --status now',
  priority: 5,
  meta: { count: 3 },
};

const salvage: NeedsYouItem = {
  code: 'salvage',
  label: 'Salvage queue non-empty',
  action: 'pd salvage',
  priority: 3,
};

const signal: FleetSignal = { code: 'F', state: 'awaiting-human', meaning: 'Disabled, communicate' };

/** Find the row container for a given needsYou code. */
function row(code: NeedsYouItem['code']): HTMLElement {
  const el = document.querySelector(`[data-needsyou-code="${code}"]`);
  if (!el) throw new Error(`row for code ${code} not found`);
  return el as HTMLElement;
}

function dismissButton(code: NeedsYouItem['code']): HTMLButtonElement {
  return within(row(code)).getByRole('button', { name: /dismiss/i }) as HTMLButtonElement;
}

// ── Predicate ───────────────────────────────────────────────────────────────

describe('isForceZoomGated', () => {
  it('gates P0 rows regardless of code', () => {
    expect(isForceZoomGated({ priority: 0, code: 'salvage' })).toBe(true);
    expect(isForceZoomGated({ priority: 0, code: 'inbox' })).toBe(true);
  });

  it('gates irreversible-class codes at any priority', () => {
    expect(isForceZoomGated({ priority: 1, code: 'guard_violation' })).toBe(true);
    expect(isForceZoomGated({ priority: 2, code: 'budget_ceiling' })).toBe(true);
    expect(isForceZoomGated({ priority: 0, code: 'dispatch_review' })).toBe(true);
  });

  it('does NOT gate lower-priority, reversible rows', () => {
    expect(isForceZoomGated({ priority: 3, code: 'salvage' })).toBe(false);
    expect(isForceZoomGated({ priority: 4, code: 'stuck_agent' })).toBe(false);
    expect(isForceZoomGated({ priority: 5, code: 'roadmap_now' })).toBe(false);
    expect(isForceZoomGated({ priority: 6, code: 'inbox' })).toBe(false);
  });
});

// ── Force-zoom gate (P0 / irreversible) ───────────────────────────────────────

describe('NeedsYouHero force-zoom gate', () => {
  it('renders a P0 row with a DISABLED dismiss button before any expansion', () => {
    render(<NeedsYouHero items={[dispatchReview]} signal={signal} />);

    const btn = dismissButton('dispatch_review');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('data-dismiss-locked', 'true');
    expect(btn).toHaveTextContent(/expand to dismiss/i);
  });

  it('does NOT dismiss a P0 row when its (disabled) dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<NeedsYouHero items={[dispatchReview]} signal={signal} />);

    // The item is visible before.
    expect(screen.getByText('Dispatch awaiting review')).toBeInTheDocument();

    // Clicking the disabled (locked) dismiss must be a no-op; the row stays.
    await user.click(dismissButton('dispatch_review'));
    expect(screen.getByText('Dispatch awaiting review')).toBeInTheDocument();
    expect(row('dispatch_review')).toBeInTheDocument();
  });

  it('unlocks and dismisses a P0 row only AFTER it has been expanded', async () => {
    const user = userEvent.setup();
    render(<NeedsYouHero items={[dispatchReview]} signal={signal} />);

    // Locked at first.
    expect(dismissButton('dispatch_review')).toBeDisabled();

    // Expand the row — this is the force-zoom: operator now sees action + meta.
    const toggle = within(row('dispatch_review')).getByRole('button', { name: /dispatch awaiting review/i });
    await user.click(toggle);

    // The expanded body shows the action command + the meta JSON.
    expect(within(row('dispatch_review')).getByText('pd review')).toBeInTheDocument();
    expect(within(row('dispatch_review')).getByText(/"dispatchId": "d-42"/)).toBeInTheDocument();

    // Now the dismiss button is enabled…
    const btn = dismissButton('dispatch_review');
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute('data-dismiss-locked', 'false');

    // …and clicking it removes the item from the list.
    await user.click(btn);
    expect(screen.queryByText('Dispatch awaiting review')).not.toBeInTheDocument();
    expect(screen.getByText(/no action required/i)).toBeInTheDocument();
  });

  it('stays unlocked after the operator collapses the row again (seen-once)', async () => {
    const user = userEvent.setup();
    render(<NeedsYouHero items={[guardViolation]} signal={signal} />);

    const toggle = within(row('guard_violation')).getByRole('button', { name: /coordination guard violation/i });
    // Expand, then collapse.
    await user.click(toggle);
    await user.click(toggle);

    // Still unlocked — they have already seen it once.
    const btn = dismissButton('guard_violation');
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(screen.queryByText('Coordination guard violation')).not.toBeInTheDocument();
  });

  it('gates every irreversible code (guard_violation, budget_ceiling) even off-P0', () => {
    render(<NeedsYouHero items={[guardViolation, budgetCeiling]} signal={signal} />);
    expect(dismissButton('guard_violation')).toBeDisabled();
    expect(dismissButton('budget_ceiling')).toBeDisabled();
    expect(row('guard_violation')).toHaveAttribute('data-gated', 'true');
    expect(row('budget_ceiling')).toHaveAttribute('data-gated', 'true');
  });
});

// ── Non-gated rows keep quick dismissal ───────────────────────────────────────

describe('NeedsYouHero quick dismissal for non-gated rows', () => {
  it('lets a non-P0, reversible row be dismissed WITHOUT expanding', async () => {
    const user = userEvent.setup();
    render(<NeedsYouHero items={[roadmapNow]} signal={signal} />);

    const btn = dismissButton('roadmap_now');
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute('data-dismiss-locked', 'false');
    expect(btn).toHaveTextContent(/^dismiss$/i);

    await user.click(btn);
    expect(screen.queryByText('Roadmap item at now')).not.toBeInTheDocument();
  });

  it('mixed list: gated row stays, non-gated row quick-dismisses independently', async () => {
    const user = userEvent.setup();
    render(<NeedsYouHero items={[dispatchReview, salvage]} signal={signal} />);

    // salvage (P3) is reversible — quick dismiss works.
    expect(dismissButton('salvage')).toBeEnabled();
    await user.click(dismissButton('salvage'));
    expect(screen.queryByText('Salvage queue non-empty')).not.toBeInTheDocument();

    // dispatch_review (P0) survives, still locked.
    expect(screen.getByText('Dispatch awaiting review')).toBeInTheDocument();
    expect(dismissButton('dispatch_review')).toBeDisabled();
  });
});
