/**
 * `pd popper` — autonomous roadmap task puller.
 *
 * Subcommands:
 *   pd popper status       — counts + next candidate + pause flag
 *   pd popper next         — show what would pop next (dry-run, no side effects)
 *   pd popper pop          — pop one item now (operator override)
 *   pd popper enable <slug>  — set nightshift_eligible=1 on a roadmap item
 *   pd popper disable <slug> — set nightshift_eligible=0
 *
 * Daemon-side wiring of the dispatchProposer happens in lib/server.ts; here
 * we just shape the CLI surface. The popper itself ships in lib/roadmap-popper.ts.
 */

import type { PortDaddyClient } from '../../lib/client.js';

export interface PopperCommandDeps {
  client: PortDaddyClient;
}

export async function runPopperCommand(
  args: string[],
  deps: PopperCommandDeps,
): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'status': {
      const r = await deps.client.request('/popper/status');
      console.log(`Eligible items   : ${r.eligibleCount}`);
      console.log(`Popped this run  : ${r.poppedCount}`);
      console.log(`Paused           : ${r.pausedByFlag ? 'yes (~/.pd/popper-disabled present)' : 'no'}`);
      if (r.nextCandidate) {
        console.log(`Next candidate   : ${r.nextCandidate.slug} (${r.nextCandidate.id})`);
        console.log(`  summary        : ${r.nextCandidate.summary_md.slice(0, 80)}…`);
      } else {
        console.log('Next candidate   : (none eligible)');
      }
      return;
    }
    case 'next': {
      const r = await deps.client.request('/popper/next');
      if (!r.candidate) {
        console.log('No eligible candidates. Tag items with `pd popper enable <slug>`.');
        return;
      }
      console.log(`Next would pop : ${r.candidate.slug} (${r.candidate.id})`);
      console.log(`  summary      : ${r.candidate.summary_md}`);
      console.log(`  last touched : ${new Date(r.candidate.last_touched_at).toISOString()}`);
      console.log(`  harbor       : ${r.candidate.harbor}`);
      console.log('Dry-run only. Use `pd popper pop` to actually fire a dispatch.');
      return;
    }
    case 'pop': {
      const r = await deps.client.request('/popper/pop', { method: 'POST' });
      if (!r.popped) {
        console.log('Nothing to pop.');
        return;
      }
      console.log(`Popped: ${r.popped.itemSlug} → dispatch ${r.popped.dispatchId}`);
      console.log(`Watch progress with: pd dispatch show ${r.popped.dispatchId}`);
      return;
    }
    case 'enable':
    case 'disable': {
      const slug = args[1];
      if (!slug) {
        console.error(`Usage: pd popper ${sub} <slug>`);
        process.exit(2);
      }
      const r = await deps.client.request('/popper/eligibility', {
        method: 'POST',
        body: { slug, eligible: sub === 'enable' },
      });
      if (!r.ok) {
        console.error(`Failed: ${r.error}`);
        process.exit(1);
      }
      console.log(`${sub === 'enable' ? 'Enabled' : 'Disabled'} popper eligibility on ${slug}.`);
      return;
    }
    default:
      console.log(
        'Usage: pd popper <status|next|pop|enable|disable> [args]\n' +
          '\n' +
          '  status              counts + next candidate + pause flag\n' +
          '  next                show what would pop next (dry-run)\n' +
          '  pop                 pop one item now (operator override)\n' +
          '  enable <slug>       mark a roadmap item nightshift-eligible\n' +
          '  disable <slug>      remove nightshift-eligible from a roadmap item\n',
      );
      process.exit(sub ? 2 : 0);
  }
}
