# ADR-0129: ADR Identity Should Be a Content-Anchored Token, Not a Sequential Number

- **Status:** Proposed — a recommendation is given below; which option to take,
  and whether it widens to existing ADRs, is the operator's call
- **Date:** 2026-08-26
- **Discovered by:** ADR-0121 through ADR-0124 double-claimed by two
  independently branched PRs. #7279 (opened 2026-08-18, merged 2026-08-24)
  renumbered the durable-agent-roster ADR from 0119 into the 0121 slot and
  landed the harbor-authority chain at 0121–0126. #9417 (opened 2026-08-22,
  still open at time of writing, `mergeable_state: dirty`) independently
  claims ADR-0121 through ADR-0124 for an unrelated program — a canonical
  model registry, cross-backend failover, and the Helmsman charter. Neither
  branch could see the other's claim at authoring time; #9417 branched from a
  `main` that still had 0119 unresolved and #7279 not yet merged.
- **Builds on:** `scripts/adr-number-collision-guard.mjs` (the fail-closed
  gate that already exists) and `docs/adr/adr-numbering-registry.json` (the
  2026-07-15 collision resolution, which renumbered twelve prior collisions
  into the 0102+ block with forwarding stubs)
- **Siblings:** ADR-0130 (generated-and-hash-gated derived JSON) — same root
  cause (coordination-free identity/staleness for artifacts multiple
  concurrently-branched agents write), different implementation surface.
  Read together; decided separately.

## Context

`docs/adr/` numbers ADRs sequentially. Nothing at authoring time asks "does
this number already belong to another ADR, including one that exists only on
a branch I cannot see?" — because that question is unanswerable from inside
one branch. Two branches opened before either merges will independently
compute the same "next number," because "next number" is `1 + max(existing)`
evaluated against a snapshot of `main` that goes stale the moment a sibling
branch is opened.

This is not hypothetical; it already happened twice in the same number range
within one week. It also is not the first time: the 2026-07-15 collision
resolution (recorded in `docs/adr/README.md` and the `resolvedCollisions`
block of `adr-numbering-registry.json`) found **twelve** prior collisions —
0028, 0037, 0039, 0040, 0047, 0051, 0056, 0057, 0086 (twice), 0087, 0088,
0090 — each two or three ADRs deep, each resolved the same way: keep the
number on the earliest-accepted file, renumber the rest into the next free
block, leave a forwarding stub. That pass is why `adr-number-collision-guard.mjs`
exists at all — its own header comment says so: *"`docs/adr/` accreted TWELVE
number collisions ... because nothing at commit time asked '[is this number
free]'."*

The 0121–0124 collision shows the guard closing the twelve-collision hole and
opening the same hole one branch-width to the left. It is a real fix for
"two files with the same number land in the same working tree" — commit-time
and CI-time, fail-closed, verified below. It has no view of a number claimed
on a branch that has not yet been fetched, and by design cannot: the guard
reads `docs/adr/` on disk (`readdirSync(ADR_DIR)`, `adr-number-collision-guard.mjs:76`),
which is exactly the branch-local snapshot that is the problem, not a fix for
it.

### What the guard already does, precisely

Reading `scripts/adr-number-collision-guard.mjs` end to end:

- It walks `docs/adr/*.md`, groups files by their `NNNN-` prefix, and treats
  any number mapping to more than one **live** file (no
  `<!-- ADR-RENUMBERED-TO: NNNN -->` marker) as a collision — exit code 1,
  fail-closed.
- It regenerates `adr-numbering-registry.json` as a pure projection of the
  directory (`buildRegistry()`) and fails if the committed copy does not
  byte-match the freshly built one (`registryStale`).
- `--staged` mode cheap-exits unless a staged path is under `docs/adr/`, so it
  runs on every commit without cost to unrelated work.
- The only bypass is `PD_ADR_GUARD_OK=1`, logged to stderr, documented as
  "one-time bulk-renumber PR only."

Run against this worktree today (`node scripts/adr-number-collision-guard.mjs
--json`), it reports `"clean": true` — 0001 through 0128 are each mapped to
exactly one file, and the registry is fresh. That is correct and is not the
bug. #9417's ADR-0121–0124 do not exist in this tree; they exist on a
different branch that has not merged. The guard's soundness is scoped to
"the ADRs currently checked out," and a repo where dozens of agent-authored
branches are open at once routinely has ADRs that are not currently checked
out anywhere the guard runs. Confirmed by hand for this ADR: a GitHub code
search for `filename:0129 path:docs/adr` and `filename:0130` both return zero
results at time of writing — which is reassuring for *this* PR, but is also
exactly the manual, best-effort check a human (or an agent) has to run today
because no tool runs it automatically, and GitHub's code index is not
guaranteed to reflect an unpushed or very recently pushed branch.

### Why detecting the collision earlier does not fix it

A tighter gate — one that queries open PRs before minting, say — narrows the
race window but does not close it: two agents can still mint within the same
poll interval, and a check against "open PRs I can currently see" is subject
to the identical staleness problem one layer up (an open PR just pushed a
minute ago may not be indexed yet; see the code-search caveat above). The
structural issue is that **the number is the identity**, and identity is
being minted by two parties who cannot see each other, over a resource
(the integer line) that has exactly one next free slot. Any fix that keeps
the number as identity is racing the same clock, just with a shorter lap.

## What the operator asked for

Erich's framing, verbatim:

> ADR numbering is arbitrary and I don't care. I think you should change ADR
> numbers to be a unique string token as a function of repo and harbor —
> "portdaddy-adr-00119-chainhashing" or something — and only ever use that
> token instead of the number. That way there is no ambiguity about ADRs in
> the future and it becomes very easy to grep and replace.

### The refinement this ADR builds the recommendation around

A token shaped like `portdaddy-adr-00119-chainhashing` only solves the
problem if the **numeric segment stops being the thing that grants
identity** — otherwise two branches can still both mint `00119` and the
collision has just moved into a longer string that is harder to grep for by
eye. The number has to become a cosmetic chronological hint. The *slug* (a
short, content-derived topic name) — or a content hash, costed as Option B
below — has to carry the actual uniqueness guarantee.

Under that design, two genuine proposals can only produce an identical token
if they are actually about the same topic. That is not a false collision to
work around; it is a legitimate duplicate-effort signal, and the repo already
has doctrine for exactly this case: the PR template's "Docs / Plan changes"
section requires an author to "check for extant PRs, worktrees, feature
branches, or docs proposing the same idea" and merge rather than duplicate
before adding more paper. A slug collision would be that check enforced by
the tooling instead of relying on the author to remember to run it.

## The options

### Option A — human slug carries uniqueness (recommended)

Token shape: `portdaddy-adr-<slug>`, e.g. `portdaddy-adr-adr-identity-token`.
The number is dropped from the identity-bearing string entirely, or kept
purely as a sortable, non-authoritative display prefix
(`portdaddy-adr-0129-adr-identity-token`) — see the "cosmetic number" note
below either way. Uniqueness is enforced the same way a git branch name or an
npm package name is: the slug must not already exist in the registry, checked
at mint time.

- **Buys:** short, greppable, human-readable tokens; a slug collision *is* a
  duplicate-topic signal worth surfacing, per the refinement above; trivial
  to type and cite in prose (matches the operator's "very easy to grep and
  replace" ask directly).
- **Costs:** two authors can pick genuinely different slugs for
  substantively the same topic (`chain-hash-reconciliation` vs
  `cross-language-hash-fix`) and never collide despite writing the exact
  duplicate this scheme is supposed to catch. The uniqueness guarantee is
  only as good as slug-picking discipline plus whatever near-duplicate check
  the minting tool runs (exact-match is cheap; fuzzy-match is a real
  precision/recall tradeoff, not a solved problem for free).
- **Renaming an ADR mid-life** (a title change after the fact, which has
  already happened in this repo — compare `0086-parley-protocol.md` and
  `0086-operator-console-rendering-stack.md`, two different topics that once
  shared a number, or the plain fact that ADR titles get refined post-merge)
  means the slug — now the identity — either has to stay frozen forever once
  minted (identity survives title drift, at the cost of the file basename
  and the title eventually disagreeing) or a rename is itself a
  registry-tracked event with its own forwarding-stub convention, mirroring
  what `<!-- ADR-RENUMBERED-TO: NNNN -->` already does for numbers.

### Option B — content-hash suffix carries uniqueness

Token shape: `portdaddy-adr-<slug>-<hash6>`, where `<hash6>` is a short
prefix of a hash over some canonical seed — candidates: the initial commit
SHA that introduced the file, the normalized title text, or the first
paragraph of Context. Uniqueness is enforced by the hash space, not by an
author picking a distinct string.

- **Buys:** removes slug-collision as an attack surface entirely; two
  authors who happen to pick the identical slug for identical or different
  topics still get different tokens, because the hash differs by
  construction (different commit, different day, different author).
  Closest to a true collision-resistant identity in the cryptographic sense
  the repo already reaches for elsewhere (ADR-0049's per-publisher Merkle
  chains, ADR-0127's chain-hash construction) — a genuinely different
  standard of "cannot collide" than "an author remembered to check."
- **Costs:** loses exactly the property the operator asked for —
  "very easy to grep and replace" degrades once the token has a random-looking
  suffix a human cannot reconstruct from memory or predict before the file
  exists (compare `portdaddy-adr-chain-hash-reconciliation` to
  `portdaddy-adr-chain-hash-reconciliation-a83f21` — the second is not
  something a person writes into a review comment from memory). It also
  reintroduces a chicken-and-egg problem Option A does not have: a hash over
  "the commit that introduced the file" cannot be known until the file is
  committed, so the token used *inside* the file's own frontmatter, and in
  any cross-reference written in the same PR, has to be provisional or
  computed from something that exists before the commit (title text is the
  more workable seed for exactly this reason).
- Two genuine duplicate proposals on the same topic no longer produce a
  visible collision the way Option A's does — they'd get different hash
  suffixes and coexist silently, which is the opposite of the
  duplicate-effort signal the refinement in "What the operator asked for"
  argues is a feature, not a bug, of slug-based identity.

### Option C — status quo identity, earlier detection only

Keep the sequential number as identity. Instead of (or in addition to) the
commit/CI-time guard, add a pre-mint check that queries GitHub for open PRs
and branches touching `docs/adr/` before handing out a number, narrowing —
not closing — the race window described above.

- **Buys:** zero migration cost; every existing cross-reference (5,040
  occurrences of `ADR-0NNN` / `adr-0NNN` across 806 files in this repo, by
  grep) stays exactly as valid as it is today; smallest possible diff.
- **Costs:** does not fix the structural problem, only shrinks the window —
  see "Why detecting the collision earlier does not fix it" above. Two
  agents minting within the same poll interval still collide, and the
  poll-and-query approach is exactly what this ADR did by hand for 0129/0130
  (a GitHub code search that is best-effort, not authoritative, and subject
  to indexing lag on the very branches most likely to be minting
  concurrently).
- Namely: this is the baseline the other two options are measured against,
  not a strawman. It is a legitimate choice if the operator judges the
  1-in-~130-ADRs collision rate seen so far (2 collision *events* — the
  twelve-way 2026-07-15 one and this one — across 128 numbers minted) as
  cheap enough that a shorter race window is sufficient, and the migration
  cost of A or B is not worth paying.

## Migration: existing 0001–0128 vs. a repo-wide rename

Whichever of A/B/C is chosen for *new* ADRs, a separate question is what
happens to the ~99 live, numbered ADRs that already exist (the registry's
own `counts.live: 99`, plus 14 forwarding stubs and one off-convention file
not shown in that count). Two honest options, not a silent default:

**M1 — old ADRs stay number-primary; only new ADRs (0129+) mint under the
token scheme.** The registry gains a second lookup dimension (token → file,
alongside number → file) but nothing already written is touched. Every one
of the 5,040 existing `ADR-0NNN` references — in code comments, other ADRs'
"Builds on" lines, roadmap slugs like `adr-0048-phase-7-L3-federation-market`,
skill docs, PR bodies already merged — stays exactly as valid as it is
today. Cost: the repo permanently carries two identity regimes, and any tool
that resolves "what does ADR-X mean" has to know which regime `X` is in
(cheap to determine: token-shaped strings and four-digit numbers do not
collide syntactically, so this is a format check, not an ambiguity).

**M2 — one-time repo-wide rename**, applying the token scheme retroactively
to 0001–0128ish, following the exact precedent the 2026-07-15 pass already
set: keep a forwarding stub at every old numeric path
(`<!-- ADR-RENUMBERED-TO: <token> -->`, extending the existing marker
convention rather than inventing a second one), rewrite every cross-reference
this repo can find mechanically, and accept that references living outside
this repo — closed PR bodies, this-session's own earlier prose, an
operator's memory of "ADR-0122" — go stale in a way `grep` cannot fix. Cost:
touches all 806 files the grep above found, mechanically for `docs/adr/`
cross-references (a scripted rewrite is tractable — the existing forwarding
stubs prove the pattern already works for one-to-one renumbers) but requires
human judgment everywhere a number is used as shorthand in prose rather than
as a structured reference (e.g. "the ADR-0122 authority-epoch clock" inside a
sentence, which appears repeatedly in ADR-0126 alone).

This ADR does not pick between M1 and M2. They are genuinely different
costs — M1 is cheap and permanent; M2 is expensive and clean — and the right
choice depends on how much the operator values a single identity regime
across the whole corpus versus not touching 128 files and everything that
already cites them. Recommendation, non-binding: **M1**, on the same logic
as ADR-0128's Option A recommendation — a one-time repo-wide rename buys no
safety that leaving old ADRs alone does not, and 5,040 stale-reference
opportunities is a large amount of unforced risk for a purely cosmetic
uniformity gain.

## `pd adr new <slug>` — what a minting command has to do

No such command exists today. `lib/adr-matrix.ts`'s own header comment says
so in as many words: the ADR ↔ roadmap linkage it implements is deliberately
pure and untested against the daemon because "that wiring is ADR-0043 Phase 1
(the `POST /adr/sync` route + `pd adr` CLI)" — and `routes/` has no `adr.ts`,
`cli/commands/` has no `adr.ts`. Today, minting an ADR means: a human or
agent looks at `docs/adr/`, eyeballs the highest number, writes
`docs/adr/<NNNN>-<slug>.md` by hand, and hopes the commit-time guard catches a
collision if one exists **in the same working tree**. There is no tool in
the loop at all, let alone one that could check anything else.

Whatever number/token scheme is chosen, a `pd adr new <slug>` command should
exist and should own the parts of this that a human currently does by hand
and inconsistently:

1. **Check the local registry** (`adr-numbering-registry.json` today, or its
   token-keyed successor) for an exact or near-match slug/token collision —
   the same check `adr-number-collision-guard.mjs` already does for numbers,
   generalized to whatever the identity-bearing field becomes.
2. **Warn about open PRs it can detect** — a best-effort `gh api
   search/code` or `gh pr list` query scoped to `docs/adr/`, exactly the
   check this ADR ran by hand for 0129/0130 above. It should surface what it
   finds as a warning, not a hard block: the check is inherently incomplete
   (indexing lag, private forks, a PR opened seconds ago), so treating a
   clean result as proof of no collision would be the same false confidence
   the current commit-time-only guard already produces, just moved earlier.
3. **Scaffold the file** from the template in `docs/adr/README.md` (or its
   successor once this ADR's Option A/B choice is decided), with the
   Status/Date/Builds-on frontmatter this repo's recent ADRs (0121–0128) use.
4. **Never require the author to hand-pick the identity-bearing field.**
   Under Option A, the command derives a candidate slug from the title the
   author supplies and only asks the author to break a tie; under Option B,
   it computes the hash itself. Under either, the number (kept as a
   chronological hint per the refinement in "What the operator asked for")
   is assigned by the tool, not typed by the author — removing the exact
   step (`readdirSync` and eyeball the max) that produces the race today.
5. **Regenerate the registry** in the same step, mirroring
   `adr-number-collision-guard.mjs --write-registry`, so the registry is
   never out of sync with what the command just wrote.

## What changes in the collision guard and the registry

Independent of A/B/C, the guard's core invariant — every identity maps to
exactly one live file — does not change; what changes is the key. Concretely,
under Option A: `NUMBERED` (`/^(\d{4})-(.+)\.md$/`, `adr-number-collision-guard.mjs:51`)
widens to accept the token-prefixed filename shape, `liveByNumber` becomes
`liveByToken`, and the registry's `numbers` map gains (or is replaced by) a
`tokens` map. The `--staged` cheap-exit, the `<!--
ADR-RENUMBERED-TO -->` stub convention, and the `PD_ADR_GUARD_OK=1` bypass
all carry over unchanged — none of that machinery is number-specific, it is
identity-map-specific, and the guard was already written generically enough
(`buildRegistry()` operates on whatever the filename regex extracts) that
this is an extension, not a rewrite.

## Non-binding recommendation

**Option A (human slug carries uniqueness), with M1 migration (old ADRs stay
number-primary; only new ADRs mint under the token scheme).**

A is recommended over B because it keeps the property the operator explicitly
asked for — "very easy to grep and replace" — and because a slug collision
surfacing a genuine duplicate-effort case is a feature this repo already has
doctrine for (the PR template's duplicate-work check), not a defect to
engineer away with a hash suffix. B is the right fallback if, in practice,
slug near-misses turn out to be common enough that Option A's collision rate
does not actually beat Option C's — that is an empirical question this ADR
cannot answer without living under Option A for a while, which is why B is
presented as a real option and not a strawman.

M1 is recommended over M2 for the reason given in the Migration section:
5,040 existing references are a lot of unforced risk for a uniformity gain
that buys no new safety property on ADRs that have already survived their
window for collision (they are, by definition, no longer racing anything).

## What is NOT decided here

Whether Option A, B, or C ships. Whether migration follows M1 or M2. Whether
the token's number segment is dropped entirely (Option A's first phrasing)
or kept as a cosmetic sortable prefix (Option A's second phrasing) — both
are consistent with "the number stops being the identity," and this ADR
does not choose between them. Whether `pd adr new`'s open-PR check uses
`gh api search/code`, `gh pr list`, or something else — this ADR specifies
the requirement (best-effort, non-blocking warning), not the exact API call.
The choice is the operator's, because it trades grep-ability (A) against a
stronger collision-resistance guarantee (B), and trades a permanently
bifurcated identity scheme (M1) against a large, mostly-mechanical but
partly-manual one-time rewrite (M2).

## Consequences

- Until this is decided, ADR minting stays exactly as manual and
  collision-prone as it is today — this ADR does not change
  `adr-number-collision-guard.mjs` or `adr-numbering-registry.json`, only
  proposes how they would change under each option.
- The 0121–0124 collision between #7279 and #9417 is not resolved by this
  ADR either; whichever of those two PRs merges second still has to
  renumber by hand under the *current* scheme, the same way the
  2026-07-15 pass did, regardless of what is decided here for future ADRs.
- If Option A or B ships, `docs/adr/README.md`'s "Adding a New ADR" template
  needs a rewrite in the same PR that implements the decision — it currently
  instructs "next available number, kebab-case title" by hand, which is the
  exact instruction this ADR argues is the failure mode.
- Any implementation PR for this ADR should re-run
  `node scripts/adr-number-collision-guard.mjs --json` against the ADRs live
  at merge time, not against the state observed while writing this proposal
  — new ADRs are minted in this repo faster than a single review cycle.

## Cross-references

- `scripts/adr-number-collision-guard.mjs` — the existing fail-closed gate
  this ADR extends rather than replaces.
- `docs/adr/adr-numbering-registry.json` — the existing generated registry;
  see also ADR-0130, which proposes generalizing the regenerate-and-diff
  pattern this file already uses.
- `docs/adr/README.md` — the ADR template and numbering instructions that
  would need to change under Option A or B.
- `docs/adr/0121-durable-agent-roster.md` — carries its own renumber note
  (0119 → 0121) from the 2026-07-15-adjacent cleanup, the same collision
  class this ADR addresses at the mechanism level.
- `docs/adr/0043-adr-implementation-matrix.md` — the still-unbuilt `pd adr`
  CLI / `POST /adr/sync` route this ADR's minting command would extend
  rather than duplicate, if and when both land.
- PR #7279 (merged 2026-08-24) and PR #9417 (open) — the two branches whose
  independent ADR-0121–0124 claims motivated this ADR.
- ADR-0130 — the sibling proposal for generated derived-JSON files, sharing
  this ADR's root-cause diagnosis.
