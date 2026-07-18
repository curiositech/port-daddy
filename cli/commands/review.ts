/**
 * pd review -- the operator-facing accept/reject contract for dispatches.
 *
 * Per ADR-0035: after a dispatch reaches `produced` (PR open) the worker
 * transitions it to `review_pending`. The operator runs:
 *
 *   pd review <id> --accept              -> dispatch.state = 'accepted'
 *                                          (operator will merge by hand for
 *                                           merge_policy='review'; a dispatch
 *                                           with merge_policy='auto' merges
 *                                           itself via lib/dispatch/auto-merge.ts
 *                                           once ready and does not need this
 *                                           accept step at all)
 *
 *   pd review <id> --reject "<reason>"   -> dispatch.state = 'rejected'
 *                                          (PR should be closed by the
 *                                           operator or follow-up tooling;
 *                                           dispatch lands in 'salvage')
 *
 *   pd review <id> --retry "<note>"      -> NOT YET IMPLEMENTED. The ADR
 *                                          lists this as a future verb that
 *                                          re-queues the work with operator
 *                                          notes for a second attempt.
 *                                          Current behavior: explicit error
 *                                          message pointing at the ADR.
 *
 *   pd review <id>                       -> show the dispatch and exit (no
 *                                           state change), so the operator
 *                                           can read the PR / branch / cost
 *                                           before deciding.
 *
 * The `pd nightshift review` and `pd dispatch review` subcommands are
 * aliases for this verb (cli/commands/dispatch.ts:handleDispatch routes
 * `review` here).
 */

import { initDatabase } from '../../lib/db.js';
import { createDispatchQueue, type Dispatch } from '../../lib/dispatch/queue.js';
import { describeState, stateGlyph } from '../../lib/dispatch/state-machine.js';

import type { CLIOptions } from '../types.js';
import { isJson, isQuiet } from '../types.js';
import * as ui from '../utils/ui.js';

function usage(): never {
  console.error('Usage: pd review <dispatch-id> [--accept | --reject "<reason>" | --retry "<note>"]');
  console.error('');
  console.error('Options:');
  console.error('  --accept             Accept the produced work; transition to "accepted"');
  console.error('  --reject "<reason>"  Reject the work; transition to "rejected" (reason required)');
  console.error('  --retry "<note>"     NOT YET IMPLEMENTED -- see ADR-0035');
  console.error('  -j, --json           JSON output');
  console.error('');
  console.error('Without --accept/--reject the dispatch is printed (no state change).');
  process.exit(1);
}

function printDispatchSummary(d: Dispatch): void {
  console.log(`Dispatch ${d.id.slice(0, 8)} (${d.slug})`);
  console.log(`  state:           ${stateGlyph(d.state)} ${d.state} (${describeState(d.state)})`);
  console.log(`  goal:            ${d.goal}`);
  console.log(`  base_branch:     ${d.baseBranch}`);
  console.log(`  branch:          ${d.branch ?? '(none)'}`);
  console.log(`  merge_policy:    ${d.mergePolicy}`);
  if (d.resultArtifact) console.log(`  artifact:        ${d.resultArtifact}`);
  if (d.costUsd != null) console.log(`  cost:            $${d.costUsd.toFixed(2)}`);
  if (d.durationMs != null) console.log(`  duration:        ${Math.round(d.durationMs / 1000)}s`);
  if (d.rejectReason) console.log(`  reject_reason:   ${d.rejectReason}`);
  if (d.errorMessage) console.log(`  error/note:      ${d.errorMessage}`);
}

export async function handleReview(args: string[], options: CLIOptions): Promise<void> {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id || id === 'help') usage();

  const wantAccept = !!options.accept;
  const wantReject = !!options.reject || typeof options.reject === 'string';
  const wantRetry = !!options.retry || typeof options.retry === 'string';

  const flagsSet = [wantAccept, wantReject, wantRetry].filter(Boolean).length;
  if (flagsSet > 1) {
    ui.error('pd review: pass at most one of --accept, --reject, --retry');
    process.exit(1);
  }

  const db = initDatabase();
  const queue = createDispatchQueue({ db });

  const dispatch = queue.get(id);
  if (!dispatch) {
    ui.error(`Dispatch ${id} not found`);
    process.exit(1);
  }

  // No verb -- just show the dispatch and exit.
  if (flagsSet === 0) {
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatch }, null, 2));
      return;
    }
    printDispatchSummary(dispatch);
    if (dispatch.state === 'review_pending') {
      console.log('');
      console.log('Actions:');
      console.log(`  pd review ${dispatch.id} --accept`);
      console.log(`  pd review ${dispatch.id} --reject "<reason>"`);
    } else if (dispatch.state === 'produced') {
      console.log('');
      console.log('Dispatch is "produced" but not yet "review_pending".');
      console.log('The worker is still finalizing -- wait for the request-review transition,');
      console.log('or use the daemon API to advance it manually if the worker has stalled.');
    } else {
      console.log('');
      console.log(`State is "${dispatch.state}" -- review is only meaningful in "review_pending".`);
    }
    return;
  }

  // --retry: explicit not-implemented response so the operator gets a clear
  // pointer to the future feature, not a silent no-op.
  if (wantRetry) {
    ui.error(
      'pd review --retry is not yet implemented. See ADR-0035 "Retry contract". ' +
        'For now, --reject the dispatch and propose a refined goal as a new dispatch.',
    );
    process.exit(1);
  }

  // --accept
  if (wantAccept) {
    const note = typeof options.accept === 'string' ? options.accept : undefined;
    let updated: Dispatch;
    try {
      updated = queue.accept({ id: dispatch.id, note });
    } catch (err) {
      ui.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatch: updated }, null, 2));
      return;
    }
    if (!isQuiet(options)) {
      ui.success(`Accepted dispatch ${updated.id.slice(0, 8)}`);
      console.log(`  state:        ${updated.state}`);
      console.log(`  merge_policy: ${updated.mergePolicy}`);
      if (updated.mergePolicy === 'auto') {
        console.log('');
        console.log('  merge_policy=auto: this dispatch merges itself once CI is green,');
        console.log('  mergeable, and 0 unresolved review threads — no accept needed.');
        console.log('  See `pd dispatch merge-sweep` to check/merge now.');
      } else if (updated.resultArtifact) {
        console.log('');
        console.log(`  Merge by hand: ${updated.resultArtifact}`);
      }
    }
    return;
  }

  // --reject
  if (wantReject) {
    const reason = typeof options.reject === 'string' ? options.reject.trim() : '';
    if (!reason) {
      ui.error('pd review --reject requires a reason. Usage: pd review <id> --reject "<reason>"');
      process.exit(1);
    }
    let updated: Dispatch;
    try {
      updated = queue.reject({ id: dispatch.id, reason });
    } catch (err) {
      ui.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
    // After rejecting, transition the dispatch to terminal 'salvage' so it
    // doesn't sit in the open queue. This mirrors ADR-0035 "rejected ->
    // salvage" -- the dispatch row stays addressable for salvage tooling,
    // but state machine reads it as terminal.
    try {
      updated = queue.settle({
        id: updated.id,
        state: 'salvage',
        errorMessage: `rejected: ${reason}`,
      });
    } catch (err) {
      // settle() refusing on already-terminal rows is fine.
      void err;
    }
    if (isJson(options)) {
      console.log(JSON.stringify({ dispatch: updated }, null, 2));
      return;
    }
    if (!isQuiet(options)) {
      ui.success(`Rejected dispatch ${updated.id.slice(0, 8)}`);
      console.log(`  state:         ${updated.state}`);
      console.log(`  reject_reason: ${updated.rejectReason}`);
      if (updated.resultArtifact) {
        console.log('');
        console.log(`  PR to close:   ${updated.resultArtifact}`);
        console.log('  (close via `gh pr close --delete-branch` when ready)');
      }
    }
    return;
  }
}
