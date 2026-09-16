# 0144. The Book is mirrored to R2 on every publish, through one deliberate mutable pointer

## Status

Accepted.

## Context

CI already builds `coordination-papers-mega-volume.pdf` ("the Book") on every
push, PR, and `workflow_dispatch` (`.github/workflows/whitepaper-build.yml`).
Two gaps this repository was carrying:

1. **No R2 copy existed.** `docs/adr/0142-r2-media-offload.md` moved review
   evidence (screenshots, recordings, PR assets) to R2, but explicitly kept
   `website-v2/public/` — including the Book — in git, because `vite` reads it
   at build time and an unreachable R2 must never break a build (§2.1). That
   reasoning is still correct for the git-committed copy the site *builds*
   from. It says nothing about whether a *second*, R2-hosted copy should also
   exist for readers who just want the current PDF, and none did.
2. **The Book's own freshness is manual.** The workflow deliberately restores
   the git-committed Book after every ordinary run and only lets a
   `workflow_dispatch(refresh_book=true)` keep a fresh render, because
   committing it on every PR reintroduces the exact binary-merge-conflict
   problem `whitepaper-build.yml`'s own comments describe at length (23 of 23
   open whitepaper PRs touching the same ~9 MiB file, measured 2026-09-14).
   That avoidance is correct, but its side effect is that main's Book can lag
   its own chapter sources indefinitely unless a human remembers to dispatch a
   refresh — there is no schedule; a code comment claiming a "weekly schedule"
   refers to one that was never implemented.

## Decision

**Every successful Book build that runs with repository credentials
(`push`, `workflow_dispatch` — not `pull_request`, where fork PRs hold none)
publishes the just-rendered PDF to R2**, via `scripts/publish-book-to-r2.mjs`,
as three objects in the existing `port-daddy-media` bucket:

| Key | Mutability | Purpose |
|---|---|---|
| `book/archive/sha256/<hash>.pdf` | Immutable (ADR-0142's existing rule) | Every Book ever published, addressable forever |
| `book/current.pdf` | **Mutable — overwritten every publish** | The bytes a reader gets from `https://media.portdaddy.dev/book/current.pdf` |
| `book/current.json` | **Mutable — overwritten every publish** | `{sha256, bytes, pages, sourceCommit, publishedAt, archiveUrl, currentUrl}` — enough to know what `current.pdf` is without downloading 9+ MiB |

**`book/current.pdf` and `book/current.json` are the one deliberate exception
to ADR-0142's "no mutable keys" rule (§13, rejected as an alternative for the
general bucket).** That rule is correct for versioned review evidence, where
an old PR body must keep resolving to the same bytes forever. It is wrong for
"download the Book": a reader following a fixed link wants the *current*
Book, the same way a package registry's `latest` tag or a `HEAD` ref is
deliberately mutable beside an otherwise immutable object store. Scoping the
exception to exactly two keys, both named `current` and both under `book/`,
keeps it from becoming a precedent for anything else in the bucket — the rest
of the bucket's content-addressing guarantee is untouched.

**This runs independently of whether the git tree keeps the render.** The
publish step sits before "Keep the Book out of the diff" in the workflow, so
it uploads the PDF this run actually built, whether or not that render then
gets restored to its last-committed state. Consequences:

- A same-repo branch push or PR-head push updates `book/current.pdf` the
  moment its chapter edits compile cleanly — no `refresh_book` dispatch
  needed for the R2 copy specifically, and no reintroduction of the git
  binary-conflict problem, because R2 has no merge to conflict over.
- The git-committed copy under `website-v2/public/whitepaper/` keeps its
  existing refresh discipline (dispatch-gated) for exactly the reason ADR
  #10172/#10197/#10208's era already established. This ADR does not change
  when the *site build's own bundled copy* refreshes — only when the
  *R2 mirror* does.
- `book/current.pdf` can therefore be ahead of the site-bundled
  `/whitepaper/coordination-papers-mega-volume.pdf` between refreshes. That is
  the accepted, visible seam: the R2 URL is documented (§ below) as "the
  current Book," and the site-bundled path is what the embedded viewer and the
  Book's own internal links use. A future decision to point the site's
  primary download link at the R2 URL instead of the git-bundled copy would
  close that seam entirely; this ADR does not make that change and does not
  need to, because both already update automatically today (the git-bundled
  copy via the existing `refresh_book`/PR path, the R2 copy via this one).

**Order of the three PUTs matters and is enforced by `publishBook()`, not by
convention**: the immutable archive copy first, `current.pdf` second,
`current.json` last. A failure between steps can leave `current.pdf` briefly
ahead of `current.json` (corrected by the very next successful run) but can
never leave `current.json` describing bytes `current.pdf` does not hold.

**A publish failure fails the whole `build` job.** Per the standing
zero-tolerance rule for this pipeline, a Book that compiled cleanly but did
not reach R2 is not a completed run — it is a silent gap between "CI is
green" and "the current Book is actually current," which is exactly the kind
of drift this repository has repeatedly had to discover the hard way (see
ADR-0142 §10's own worked example, the pruned-Book-from-Pages incident).

## What this deliberately does not do

- **Does not move the git-committed copy to R2.** `website-v2/public/` stays a
  build input per ADR-0142 §2.1's reasoning, unchanged.
- **Does not change the site's primary download link.** `COLLECTED_VOLUME`
  in `website-v2/src/data/whitePapers.ts` still names the GitHub-raw URL and
  the Pages-bundled `pdfPath`. `book/current.pdf`'s URL is additive — the site
  can adopt it as a mirror/fallback link without this ADR forcing a choice
  between the two.
- **Does not add a scheduled `workflow_dispatch`.** The R2 mirror already
  refreshes on every qualifying push; a schedule would only matter for the
  git-committed copy's own cadence, which is out of scope here.
- **Does not provision new Cloudflare resources.** `book/` is a new prefix in
  the bucket ADR-0142 already provisioned (`port-daddy-media`, bound to
  `media.portdaddy.dev`) and reuses the same four secrets
  (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`, or
  `CLOUDFLARE_API_TOKEN`) `r2-media.yml`'s `sync` job already uses.

## Consequences

- A reader (or another tool) can always fetch the current Book from
  `https://media.portdaddy.dev/book/current.pdf` and its manifest from
  `https://media.portdaddy.dev/book/current.json`, independent of whether the
  Pages deploy or the git-committed copy has caught up.
- `scripts/publish-book-to-r2.mjs` is the one place in this codebase that
  intentionally overwrites an R2 object (`putObjectOverwrite`); every other
  write to this bucket goes through `sync-r2-media.mjs`'s `putObject`, which
  refuses to overwrite anything.
- A future chapter-figure or Book-generator regression that used to be
  discoverable only by opening the built PDF by hand is now also visible as a
  failed, required CI step (`Publish the Book to R2`), with the underlying
  `pdfinfo`/build error surfaced above it in the same job log.

## References

- ADR-0142 — R2 media offload (the bucket, the domain, the credentials, the
  immutability rule this ADR carves one exception into)
- ADR-0143 — the Book is the only published whitepaper edition
- `.github/workflows/whitepaper-build.yml` — where the publish step runs
- `scripts/publish-book-to-r2.mjs` — the implementation
- `tests/unit/publish-book-to-r2.test.js` — no-network coverage via an
  injectable `fetchImpl`, same pattern as `tests/unit/r2-media-sync.test.js`
