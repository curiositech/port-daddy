/**
 * `pd popper` — autonomous roadmap task puller.
 *
 * Subcommands:
 *   pd popper status         — counts + next candidate + pause flag
 *   pd popper next           — show what would pop next (dry-run, no side effects)
 *   pd popper pop            — pop one item now (operator override)
 *   pd popper enable <slug>  — set nightshift_eligible=1 on a roadmap item
 *   pd popper disable <slug> — set nightshift_eligible=0
 *
 * Daemon-side wiring of the dispatchProposer happens in lib/server.ts; here
 * we just shape the CLI surface. The popper itself ships in lib/roadmap-popper.ts.
 *
 * The HTTP surface (routes/popper.ts) mirrors these actions so FleetBar's
 * Nightshift banner can show "next pop in 2h 14m" and "pop one now" without
 * shelling out.
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import * as ui from '../utils/ui.js';

interface PopperCandidate {
  id: string;
  slug: string;
  summary_md: string;
  last_touched_at: number;
  harbor: string;
}

function harborQuery(options: CLIOptions): string {
  const harbor = (options as Record<string, unknown>).harbor;
  return typeof harbor === 'string' && harbor ? `?harbor=${encodeURIComponent(harbor)}` : '';
}

export async function handlePopper(positional: string[], options: CLIOptions): Promise<void> {
  const sub = positional[0];
  const qs = harborQuery(options);

  switch (sub) {
    case 'status': {
      const res = await pdFetch(`${PORT_DADDY_URL}/popper/status${qs}`);
      const r = (await res.json()) as Record<string, unknown> & { nextCandidate?: PopperCandidate };
      if (!res.ok) {
        ui.error((r.error as string) || 'Failed to fetch popper status');
        process.exit(1);
      }
      if (isJson(options)) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      console.log(`Eligible items   : ${r.eligibleCount ?? 0}`);
      console.log(`Popped this run  : ${r.poppedCount ?? 0}`);
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
      const res = await pdFetch(`${PORT_DADDY_URL}/popper/next${qs}`);
      const r = (await res.json()) as { ok?: boolean; candidate?: PopperCandidate; error?: string };
      if (!res.ok) {
        ui.error(r.error || 'Failed to fetch next popper candidate');
        process.exit(1);
      }
      if (isJson(options)) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
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
      const res = await pdFetch(`${PORT_DADDY_URL}/popper/pop${qs}`, { method: 'POST' });
      const r = (await res.json()) as {
        ok?: boolean;
        popped?: { itemSlug: string; dispatchId: string };
        error?: string;
      };
      if (!res.ok || r.ok === false) {
        ui.error(r.error || 'Failed to pop');
        process.exit(1);
      }
      if (isJson(options)) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
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
      const slug = positional[1];
      if (!slug) {
        ui.error(`Usage: pd popper ${sub} <slug>`);
        process.exit(2);
      }
      const harbor = (options as Record<string, unknown>).harbor;
      const res = await pdFetch(`${PORT_DADDY_URL}/popper/eligibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          eligible: sub === 'enable',
          ...(typeof harbor === 'string' && harbor ? { harbor } : {}),
        }),
      });
      const r = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || r.ok === false) {
        ui.error(r.error || `Failed to ${sub} eligibility for ${slug}`);
        process.exit(1);
      }
      if (isJson(options)) {
        console.log(JSON.stringify(r, null, 2));
        return;
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
