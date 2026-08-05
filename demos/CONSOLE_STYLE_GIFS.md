# Console-style demo GIFs — the new look, and the plan to convert the rest

The multiplex demo introduced a console style the team wants everywhere: instead
of recording raw `pd ...` shell output, a demo narrates a **semantically-colored
agent conversation** — actors speak (`▶`), the bus/router answers (`◀`),
refusals are red, successes green — grouped into titled acts. It reads as a
story, not a terminal dump.

| old style | new style |
|-----------|-----------|
| `Type "pd pub ..."` → plain output | actors converse over channels, color-coded by intent |
| one font, monochrome scroll | titled acts, cyan/green/red/yellow/magenta roles |
| "what command did I type" | "what the agents are *doing* to each other" |

## The reusable recipe

`demos/lib/console-conversation.ts` is the shared renderer. A demo is a tiny
`scenario.ts` that imports `makeConsole()` and prints a sequence; a VHS tape
records `bun demos/<name>/scenario.ts`. See:

- `demos/pub-sub-watch/scenario.ts` + `.tape` (this PR) — converted exemplar.
- `demos/tube-router-multiplex/scenario.ts` (landed in #276) — the origin of the style.

```ts
import { makeConsole, green, dim } from '../lib/console-conversation.ts';
const c = makeConsole({ beat: 260 });
await c.title('Port Daddy — <topic>', '<subtitle>');
await c.act('①', 'phase', 'what this phase shows');
await c.say('actorA', 'some:channel', 'human-readable intent', `'{"json":"on the wire"}'`);
await c.ok('some:channel', 'stored', dim('msg #18'));
await c.refuse('router', 'why it was refused (loud)');
await c.done('closing line.', 'tail aside.');
```

Tape rules (every tape): `Set Theme "Catppuccin Mocha"`, **`Set FontSize 18`**
(never below 16 — readable-font rule), `Set Width 1080`, `PlaybackSpeed 1.0`.

## Conversion plan (own follow-up PRs, batched by area)

Roughly 30 GIFs exist. Convert the ones where a *conversation* is the point
first; leave pure single-command quickstarts as-is (a conversation frame would
be noise there).

**Batch 1 — coordination/messaging (highest payoff, most conversational):**
- `demos/pub-sub-watch/` ✅ (this PR — new top-level dir, converted with scenario.ts)
- `demos/blog/`: `file-claims`, `distributed-lock`,
  `begin-done-speedrun`, `tuples-tutorial`, `spark-spider-loop`, `spider-syllogisms`
  (these still use the old tape-only style; each gets a `scenario.ts` in its own follow-up PR).

**Batch 2 — fleet:** `fleet-up`, `fleet-live`, `fleet-showcase`,
`website-v2/public/demo-fleet.gif`, `demo-agents.gif`.

**Batch 3 — mechanism demos:** only recordings driven by live commands and
read-back evidence. The former canned auction, mayday, and salvage stories were
retired because scripted output is not product proof.

**Leave as-is (single-command, non-conversational):** `quickstart`, `ports`,
`port-conflict` (these are about one CLI behavior, not an agent dialogue).

Each batch: write `scenario.ts` per demo using the shared renderer, add a tape at
FontSize 18, re-record, visually audit the final frame (no label overlap, colors
legible on Catppuccin Mocha), and swap the GIF in place. Update any
`website-v2`/blog references that point at the regenerated files.

## Why batched, not one mega-PR

There are ~30 assets across `demos/` and `website-v2/public/`. Doing them in one
commit would be unreviewable and would entangle blog-copy/image references. One
batch per PR keeps each diff auditable and lets the look be tuned between
batches.
