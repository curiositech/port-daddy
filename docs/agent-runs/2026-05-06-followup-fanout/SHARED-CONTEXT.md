# Shared context for the six follow-on PR agents

You are one of six agents running in parallel against the same repo
(`curiositech/port-daddy`). The whitepaper PR (#42) just merged and
established two things:

1. **Erich's writing voice** is now documented and must be applied to
   every site rewrite. The full profile lives in your memory at
   `~/.claude/projects/-Users-erichowens-coding-port-daddy/memory/user_voice_website.md`.
   READ IT FIRST. The seven tells: high-low collisions, cathedral
   build then punchline, em-dash asides, wild analogies,
   lists-with-personality, word-as-affection, self-deprecation as
   ballast. **Slightly more cleaned-up and technical than personal
   prose, but always recognizably him.**
2. **A full site audit** ran via the `ideal-web-app-builder` skill.
   Findings are saved at `docs/audits/website-v2-2026-05-06.md` and
   `docs/audits/website-v2-2026-05-06.json`. The arbitrary-tailwind
   "errors" are mostly false positives (the auditor doesn't recognize
   our `[length:var(--token)]` token-consumption pattern); track
   `raw-color` and `primitive-bypass` instead.

## Hard rules — these cost you the run if you violate them

- **Use a fresh worktree off `origin/main`.** Never edit on a shared
  branch. Create yours with:
  `git fetch origin main && git worktree add -b <your-branch-name> <path> origin/main`
  Recommended path: `~/coding/port-daddy/.claude/worktrees/<your-branch-name>`.
- **Begin a Port Daddy session BEFORE any edit.** Run
  `pd begin --identity port-daddy:<your-task> --purpose "<one line>"`
  inside the worktree. Claim files before staging:
  `pd session files add <paths>`. Run `pd guard check --staged` before
  every commit; if it fails, fix the gap (usually a missing file claim).
- **Stay in your lane.** Your assigned files are listed below. If you
  *must* touch a shared file (a token CSS file, a primitive, a top-level
  layout), stop, write a `pd note` describing the conflict, and wait
  for the orchestrator. Do not silently edit.
- **Never `git reset --hard` without `PD_SHIM_OFF=1`.** PD's coordination
  guard intentionally blocks destructive ops. The bypass is documented;
  use it consciously, not reflexively.
- **No `/tmp` writes.** Anything you need to persist (commit messages,
  patches, audit deltas) goes in your worktree under `.scratch/`.
- **No team-implying framing.** Author bylines never say "Port Daddy
  Engineering Team." Use `Curiositech LLC` (legal), `Erich Owens`
  (personal), or `Curiositech` (brand). See `user_entities.md` in
  memory.
- **Follow the design system.** No raw hex/RGB/HSL outside
  `src/styles/tokens.*.css`. No new arbitrary Tailwind values that
  aren't `[length:var(--token)]` / `[color:var(--token)]`. Reuse
  primitives from `src/components/site/primitives.tsx`. Match the
  patterns established on the whitepaper pages (PaperDetailPage,
  RoundsPage) — those are the canonical examples now.

## Voice pass — what good looks like

When you rewrite copy, the BAD version is corporate-even prose with
bullet-as-spec lists. The GOOD version has:

- One genuinely interesting opening sentence (the cathedral build —
  paint a picture from the world before you mention the product).
- A wild analogy at least once. Pull from physics, anthropology,
  kitchen chemistry, comics, history — wherever lands cleaner than
  another paragraph of explanation.
- One fancy word and one homely word in the same paragraph if they
  earn their keep.
- Em-dashes. Parentheticals that contain the wit. Sentence fragments
  if they punch.
- Lists where each item is a tiny short story, not a feature spec.

**Compare:**

> Generic: *"Provides cryptographic identity for local processes via
> signed capability tokens."*
>
> Erich: *"Your laptop is — at this exact moment — running about
> twenty programs you did not consciously start. The Anchor Protocol
> is a small bit of plumbing that hands each one a guest pass instead
> of your house keys."*

## Design pass — what good looks like

Match the patterns the whitepaper pages now follow:

- **Surface alternation between sections.** Don't run sandstone-on-
  sandstone-on-sandstone. Alternate `var(--surface-base)`,
  `var(--surface-strong)`, `var(--brand-primary)` (full bleed),
  `var(--brand-accent)` (full bleed), or `var(--text-primary)` (dark,
  cream type).
- **Cards on contrasting surfaces.** A card on `surface-base` should
  use `surface-raised`. A card on `surface-strong` should use
  `surface-base`.
- **Section padding ≤ `space-7` desktop / `space-6` mobile.** The
  whitepaper rewrites use `py-[var(--space-6)] lg:py-[var(--space-7)]`.
  Don't go larger.
- **2px sharp borders.** `border-2 border-[var(--border-strong)]`.
  No `rounded-*`, no `shadow-card`. The Swiss-modern frame is the
  visual.
- **Display font for titles, sans for body, mono for numbers/meta.**
  `font-display`, `font-sans`, `font-mono` are the only three. If you
  feel like reaching for a fourth treatment, use the existing
  primitives in `src/components/site/primitives.tsx` instead.

## Commit + ship pattern

Match the established pattern (see commit `637cecce` on main):

1. Build clean: `npm --prefix website-v2 run build` (must succeed)
2. Lint clean: `npm --prefix website-v2 run lint` (must succeed)
3. Stage with explicit paths (not `git add -A`)
4. Write the commit message to `.scratch/commit-msg.txt` (NEVER /tmp)
5. `git commit -F .scratch/commit-msg.txt`
6. `git push -u origin <your-branch>:<your-branch>`
7. `gh pr create --title "..." --body-file .scratch/pr-body.md --base main --head <your-branch>`
8. `pd note "Result: opened PR #N. Validation: <evidence>. Remaining: <risk>."`
9. End your session with `pd done "<one-line outcome>"`

## When you're done, signal cleanly

Final action: write a single-line note to `pd note` of the form
`PR-AGENT-DONE: branch=<branch> pr=<#> status=<merged|open|blocked>`
so the orchestrator can sweep your worktree.

If you get stuck, write `PR-AGENT-BLOCKED: <one-line reason>` and stop.
The orchestrator will read that and either unblock you or take it.

## Final note from the orchestrator

The site is the storefront. Erich's voice is the most differentiated
thing this project ships; smoothing it out makes it indistinguishable
from any other agent-tools site. Keep it. Take the time to get one
section right rather than rushing through ten that read the same.
