# ADR-0142: Review-evidence media moves to R2, content-addressed, with the manifest derived from the tree

- **Status:** Proposed — the code in this PR is complete and tested against an
  in-memory bucket; no Cloudflare resource has been created. Provisioning the
  bucket, the custom domain and the CI secrets is a separate, explicitly
  approved step. See §11 for the exact list.
- **Date:** 2026-09-14
- **Measured, not assumed:** the numbers below were taken on
  `origin/main` at `c92efaa5c`. Every claim in this ADR that has a number
  attached was produced by a command, and the command is named beside it.
- **Builds on:** ADR-0115 (database distribution and sync — already puts
  encrypted snapshots in R2, so the account and the S3 idiom are not new here),
  ADR-0123 (cloud vault — establishes that portdaddy.dev routes ciphertext and
  what the relay may hold), ADR-0130 (derived JSON must be generated and
  hash-gated, never hand-merged — this ADR is a second instance of exactly that
  rule), ADR-0045 (loud-fail invariants and honest attestation).
- **Existing practice it follows:** `whitepaper/corpus.json` +
  `scripts/check-whitepaper-corpus.mjs` (a manifest whose checker discovers the
  on-disk truth and fails on anything undeclared),
  `scripts/harbor-research/check_plate_provenance.py` (a checker that resolves
  the real references rather than trusting a list), and
  `scripts/adr-number-collision-guard.mjs --write-registry` (the
  regenerate-and-diff pattern).

## 1. Context

### 1.1 What the repository weighs

```
$ git ls-files | (measure each tracked file present on disk)
tracked total: 900.1 MiB
media total:   765.9 MiB (85.1%)

  .png   384.8 MiB  1387 files
  .gif   124.4 MiB   215 files
  .jpg   121.3 MiB   614 files
  .webm   59.7 MiB    64 files
  .webp   27.4 MiB   241 files
  .pdf    26.5 MiB    55 files
  .mp4    12.9 MiB    23 files
  .mov     7.1 MiB    12 files
```

A further 139.9 MiB across 410 files sits behind git-lfs pointers
(`whitepaper-foundlings/**`, `skill_candidates/**` per `.gitattributes`). That
is worth stating plainly because the premise going in was that *most* of the
media is in LFS: it is not. LFS holds 140 MiB; ordinary git blobs hold 766 MiB.
Every clone, every CI checkout, every worktree pays for the 766 MiB whether or
not LFS is installed — and on this machine `git lfs` is not installed at all,
which is why the foundlings are 131-byte pointers and the rest is not.

So the problem is not "LFS is slow". The problem is that three quarters of this
repository is images that only a human clicking a link in a PR ever opens.

### 1.2 Who actually reads this media

Splitting the media by root, and then checking with a reference scan which of
those roots any build step reads:

| root | media | files | read by a build? |
| --- | ---: | ---: | --- |
| `website-v2/public/` | 190.1 MiB | 893 | **yes** — vite copies it into `dist` |
| `docs/artifacts/` | 107.6 MiB | 184 | no |
| `website-v2/docs/` | 83.3 MiB | 122 | no |
| `docs/reports/` | 62.4 MiB | 153 | no (scripts *write* here) |
| `docs/pr-assets/` | 57.8 MiB | 77 | no |
| `website-v2/screenshots/` | 50.1 MiB | 125 | no |
| `core/pd-console/` | 42.0 MiB | 116 | yes — test fixtures |
| `docs/pr-media/` | 31.1 MiB | 53 | no |
| `fleet-config-ui/docs/` | 8.3 MiB | 71 | no |

The "read by a build" column is the whole design. A file the build reads cannot
move to an object store without making the build depend on that object store
being up. A file nothing reads can.

## 2. Decision

**One mechanical rule, no per-file judgement.** A file is offloaded to R2 when,
and only when, all three hold:

1. git tracks it, **and**
2. its extension is in `MEDIA_EXTENSIONS` (`.png .jpg .jpeg .gif .webp .mp4
   .mov .webm .pdf .tiff`), **and**
3. its path starts with one of `OFFLOAD_ROOTS`.

`OFFLOAD_ROOTS` is `.github/assets/`, `docs/artifacts/`, `docs/pr-assets/`,
`docs/pr-media/`, `docs/reports/`, `fleet-config-ui/docs/`, `website-v2/docs/`,
`website-v2/screenshots/`.

Both lists live in `scripts/r2-media-manifest.mjs` and nowhere else.

**There is deliberately no size threshold.** A threshold sounds like an
optimisation and is actually a per-file argument in disguise: every borderline
file becomes a conversation, and a conversation becomes an exception, and an
exception becomes a list somebody maintains by hand. The rule has to be
answerable by looking at a path. The measured cost of having no threshold is
small anyway — at a 1 MiB threshold the evidence roots yield 253.9 MiB; with no
threshold they yield 400.6 MiB, so the threshold would *lose* 147 MiB to buy an
argument.

**What this rule captures, measured** (`node scripts/r2-media-manifest.mjs --write`):

```
wrote media/r2-manifest.json: 818 assets, 782 distinct objects,
411.4 MiB (408.7 MiB after de-duplication).
```

411.4 MiB, 46% of the repository, moved by a rule you can evaluate in your head.

### 2.1 What stays in git, and why each one

- **`website-v2/public/`** — vite copies this directory into `dist` during
  `npm run build`. An unreachable R2 would break the *build*, not merely a
  stale link, and a broken build is a strictly worse failure than a broken
  image. Build inputs stay in git. (This is also where the Book PDF lives; see
  §9.)
- **`website-v2/public/whitepaper/plates/`** — the same reason, louder.
  `\includegraphics` resolves these during `pdflatex`, and
  `check_plate_provenance.py` exists precisely because a missing plate fails
  about twenty minutes into a LaTeX run.
- **`core/pd-console/`** — test fixtures. A test that cannot run offline is not
  a test.
- **`.svg`** — text. It diffs, it is reviewable in a PR, and all 99 tracked SVGs
  together are 0.4 MiB.
- **Anything outside an offload root** — including `demos/`, `docs/design/`,
  `docs/research/`, `docs/harbor-research/`. Not because they are precious, but
  because each is a separate argument about who reads them, and this ADR makes
  one argument at a time. Adding a root later is an ADR amendment with its own
  reference scan, not a line edit.

## 3. Bucket layout and key scheme

One bucket, `port-daddy-media`. One prefix:

```
sha256/<first two hex chars>/<full 64-hex sha256><ext>
```

e.g. `sha256/3f/3fa1…9c2.png`.

The two-character fan-out is there so a human listing the bucket, or a tool
paginating it, does not face 782 siblings in one pseudo-directory. The extension
is kept so R2 and the browser agree on a `Content-Type` and a direct link
downloads with a sensible name.

**No environment prefix. No branch prefix. No `main/` and `preview/`.** That is
the point of content addressing, and §5 explains why it removes a whole class of
deployment machinery rather than hiding it.

## 4. Content addressing makes a redeploy a no-op

The key *is* the hash of the bytes. Three consequences, all of them tested:

1. **Same bytes ⇒ same key.** Re-running the sync after a rebuild that produced
   byte-identical files issues N `HEAD`s and zero `PUT`s. The tool asks "does
   this key exist"; a 200 means those exact bytes are already stored.
2. **Different bytes ⇒ different key.** A re-rendered screenshot gets a new
   address; the old one keeps working for every PR body that already links it.
   Nothing is ever overwritten, so there is no cache to bust and no propagation
   delay to wait out.
3. **Duplicate bytes across paths collapse.** 818 assets are 782 objects in this
   repository — 36 files are byte-identical copies of another, and each pair
   costs one upload and one object, not two.

The `PUT` carries `If-None-Match: *` (R2 supports S3 conditional headers on
`PutObject`), so even two CI runs racing on the same new asset cannot clobber
each other: the loser gets 412, which the tool counts as "already present"
rather than as a failure.

## 5. Custom domain, not `r2.dev`; and cache headers

**Serve from `media.portdaddy.dev`, a custom domain bound to the bucket.** Not
the managed `r2.dev` subdomain. Cloudflare's own documentation is unambiguous
about why: public access through `r2.dev` "is rate-limited and should only be
used for development purposes", and WAF rules, cache rules, access controls and
Bot Management are unavailable on it — "to use features like … caching … you
must configure your bucket behind a custom domain." A CNAME *to* `r2.dev` is
explicitly called an unsupported access path with no reliability guarantee. A
rate-limited origin for the images in every PR body is not a production posture.

**`Cache-Control: public, max-age=31536000, immutable`**, set per object at
upload time. `immutable` is a promise that the bytes at this URL will never
change, and content addressing is what makes that promise true rather than
hopeful: changing the bytes changes the key. A year of `max-age` with no
revalidation is therefore exactly right, and it is the cheapest possible
configuration — Cloudflare's cache absorbs the reads and R2 charges no egress
regardless.

## 6. How a PR preview gets its assets

**It does nothing.** This is the part worth reading twice.

Because the key is the hash and the bucket is one shared immutable store, a
branch's assets are at the same URLs as `main`'s for every byte the two share,
and at their own URLs for bytes the branch introduced. The sync job runs on
branch pushes exactly as it does on `main`, uploading whatever is new. There is:

- no per-environment bucket,
- no copy-from-preview-to-production promotion step,
- no "the preview points at stale assets" failure,
- and no cleanup problem when a branch is deleted, because nothing was ever
  namespaced to that branch.

A merge of the branch changes nothing about the objects: they are already there,
already at their final addresses. The manifest that lands on `main` names the
same keys the branch named.

The cost of this is that the bucket accumulates objects from branches that were
never merged. At the observed rate that is a rounding error against R2's storage
price, and §8 explains why deleting them is not worth the risk.

## 7. How an asset gets uploaded, and who holds the credentials

`scripts/sync-r2-media.mjs`, runnable identically on a laptop and in CI:

```bash
node scripts/r2-media-manifest.mjs --write     # regenerate from the tree
node scripts/sync-r2-media.mjs --dry-run       # what would upload
node scripts/sync-r2-media.mjs                 # upload it
```

It is Node stdlib only — SigV4 is about fifty lines of `node:crypto` — so there
is no install step, no lockfile to resolve on a CI runner, and no supply-chain
surface added for the sake of an S3 client.

**Credentials.** Four environment variables, all required, none optional:
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. In CI
they come from GitHub Actions repository secrets. The token is an R2 **Object
Read & Write** API token **scoped to the single `port-daddy-media` bucket** —
not Admin Read & Write, which could create and delete buckets, and not an
account-wide object token. R2 derives the S3 credentials from the token (access
key id = the token id, secret = SHA-256 of the token value), so revocation is
deleting the token in the dashboard; there is nothing to rotate in the repo.

**A credential value is never printed.** The config object holds the secret on a
non-enumerable property and has a `toJSON` that renders `[redacted]`, so
`console.log(config)` and `JSON.stringify(config)` cannot leak it; error paths
report status codes and object keys; `redactUrl()` strips any query string
before a URL reaches the console, so a later move to presigned URLs cannot turn
a log line into a permanent disclosure in a public repo's CI log. Tests assert
all of this rather than trusting the comment.

**It fails closed.** Every outcome that is not "the manifest is fully uploaded"
exits non-zero: a missing or blank credential exits 2 *before any network call*;
a manifest that disagrees with the tree exits 2 *before any upload*; an asset in
the manifest but not on disk, bytes whose hash is not the manifest's hash, an
unexpected `HEAD` status, and any non-2xx `PUT` all exit 1. There is no
"warn and continue" path and no flag that adds one, because a sync that
half-worked and exited 0 publishes a page whose images 404.

The hash re-verification before upload deserves its own sentence: uploading
bytes whose hash disagrees with the key would place an object at an address that
does not describe it, and no later check could ever detect that — the key would
look correct forever. So the tool re-hashes every file and refuses the whole run
on any mismatch.

## 8. Rollback

**The bucket is append-only.** Nothing in any automated path deletes or
overwrites an object; `If-None-Match: *` makes overwriting impossible even by
accident.

Rollback is therefore `git revert`. The reverted commit's manifest names the
older hashes, those objects are still in the bucket because nothing removed
them, and the older URLs have been serving the whole time. There is no
"restore from backup" step and no window in which a rolled-back deploy points
at objects that no longer exist.

Deleting from R2 is a manual, deliberate act with no script in this repo. That
is the design, not an omission: an automated deleter for content-addressed
objects is one bad manifest away from removing an object that an old PR body
still links, and the storage it would reclaim is not worth that.

## 9. What breaks if R2 is unreachable

Stated plainly, because this is the question the design is organised around.

**Phase 1 — this PR. Nothing breaks.** Files stay in git. The manifest and the
sync tool establish the mirror and prove it correct; no file is deleted from the
repository, so R2 is at this point a write-only destination that nothing reads.
If R2 is down, the only thing that fails is the sync job.

**Phase 2 — the offloaded files are removed from git and referenced by URL.**
This is where the 411 MiB is actually reclaimed, and it is deliberately not in
this PR. Once it happens:

- **Breaks:** images and recordings in PR bodies, in the markdown under
  `docs/reports/`, `docs/artifacts/`, `docs/pr-assets/`, `docs/pr-media/`, and
  in `website-v2/docs/` render as broken links for the duration of the outage.
  Someone reviewing an old PR sees a broken image.
- **Breaks:** the sync job on any push that adds new evidence.
- **Does not break:** `npm run build` for the website. `pdflatex` for the book.
  `npm test`. `npx tsc --noEmit`. The Pages deploy. The daemon. The console.
  The site itself, in production, for a visitor. Not one of them reads an
  offloaded file — that is the entire content of the rule in §2, and the test
  suite asserts it (`no offloaded asset is something a build reads`).

The worst case is "a screenshot in a review does not load until Cloudflare comes
back". That is a real cost and it is the one being accepted. It is not
"the site is down", and it is not "CI is red", and the rule in §2 is what keeps
it from becoming either.

The residual risk to name honestly: R2 becomes a dependency of *reviewing* this
repository's history. A permanent loss of the bucket — not an outage, a loss —
would mean the evidence attached to past PRs is gone, because git no longer has
it. Mitigated by R2's own durability and by the fact that the *decisions* those
screenshots supported live in commit messages, ADRs and changelog fragments,
which are text and stay in git. Accepted knowingly.

## 10. The manifest, and why this check is not the check this repo keeps breaking

The failure mode this repository keeps re-discovering is **two lists that must
agree, with nothing deriving either from the other**. A checker that only asks
"does list A match list B" passes happily while both are wrong together.

The live example is in this same PR. `website-v2/scripts/prune-pages-assets.mjs`
excluded the Book PDF from every Pages deploy on the stated grounds that
Cloudflare rejects assets above 25 MiB. The PDF is 9,740,631 bytes — 9.29 MiB,
37% of that limit. The test asserted that the exclusion list contained the PDF.
It did. The test was green the entire time the file was missing from production,
because the test checked the list against itself and never checked the list's
premise. Meanwhile a 12,641,454-byte JPEG — 30% larger — sat in the same deploy
untouched and served fine.

`media/r2-manifest.json` is not a second list. **It is a projection of the git
tree**, generated by `scripts/r2-media-manifest.mjs --write`, and
`scripts/check-r2-media-manifest.mjs` regenerates it in-process from the tree
and compares. There is exactly one authority — the tree — and the committed file
is a cache of the answer that this job keeps coherent. Nothing is maintained by
hand, so nothing can be forgotten:

- a new screenshot under an offload root ⇒ `on-disk asset not in the manifest`
- a deleted one ⇒ `manifest lists …, which is not a tracked file matching the rule`
- **an edited one** ⇒ `content drift` + `key drift` + `size drift`, because its
  sha256 moved and therefore its address moved

That third case is the one a "does the list contain the path" check structurally
cannot see, and it is the common case: somebody re-renders a screenshot in
place. The manifest catches it because the manifest records the bytes, not the
name.

This is ADR-0130's rule applied to a fourth file, and the same
regenerate-and-diff shape as `adr-number-collision-guard.mjs --write-registry`.

## 11. Cloud resources this needs, none of which have been created

Nothing in this PR touches Cloudflare. The Cloudflare MCP tools were not usable
in this session (the calls were refused by the permission layer), so the account
was not inspected either; what follows is a request, not a report of state.

1. **R2 bucket `port-daddy-media`.** Standard storage class. Location hint
   automatic. Holds 782 objects / 408.7 MiB at the current tree.
2. **A custom domain `media.portdaddy.dev` bound to that bucket** — per §5, not
   `r2.dev`. `portdaddy.dev` is already on Cloudflare (it serves the Pages site
   and the relay), so this is a binding, not a zone onboarding.
3. **An R2 API token, Object Read & Write, scoped to `port-daddy-media` only.**
   Not Admin. Its id and secret land in GitHub Actions repository secrets as
   `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, alongside `R2_ACCOUNT_ID` and
   `R2_BUCKET`.

Public read on the bucket is what the custom domain provides; no
`Allow Access` on the `r2.dev` subdomain should be enabled at all, so the
rate-limited path never exists as an alternative someone can accidentally link.

Until these exist, `node scripts/sync-r2-media.mjs` exits 2 on the missing
credentials, which is the correct behaviour for a tool whose infrastructure has
not been provisioned.

## 12. Consequences

- **411.4 MiB (46%) of the repository becomes eligible to leave git** — at
  Phase 2, not now.
- **A new required check.** `check-r2-media-manifest.mjs` fails any PR that adds,
  removes or edits media under an offload root without regenerating the
  manifest. The fix it prints is one command. Regeneration hashes 411 MiB in
  about two seconds, so this is cheap enough to run in a pre-commit hook.
- **`media/r2-manifest.json` is 274 KB of generated JSON in the repo.** That is
  the price of the cache being committed rather than computed in CI, and it buys
  a checker that needs no network and no credentials.
- **A merge conflict in the manifest is never resolved by hand.** Regenerate.
  ADR-0130 is the authority; the file's own `$comment` says so.
- **Adding an offload root is an ADR amendment.** With its own reference scan
  proving no build reads it. Not a line edit.

## 13. Alternatives considered

- **git-lfs for everything.** Rejected. LFS is already in this repo for 140 MiB
  and has not helped: the pointer files still cost a checkout round-trip, the
  bytes still live in a Git-adjacent store with its own quota and its own
  billing, and a machine without `git lfs` installed silently gets 131-byte
  pointers where it expected images — which is exactly the state this session's
  checkout was in. It also does not solve the thing that actually hurts, which
  is that review evidence is versioned at all.
- **A size threshold instead of a root list.** Rejected in §2: it loses 147 MiB
  and buys a per-file argument.
- **Per-environment prefixes (`main/`, `preview/<branch>/`).** Rejected: §6.
  Content addressing makes environments meaningless, and the prefixes would
  reintroduce a promotion step and a cleanup problem that do not otherwise
  exist.
- **`r2.dev` to avoid a DNS change.** Rejected: §5, on Cloudflare's own
  documented guidance.
- **Mutable keys (`docs/pr-assets/<path>`) with ETag-based sync.** Rejected. It
  makes a redeploy of identical bytes a conditional-request dance instead of a
  no-op, it makes rollback require re-uploading old bytes, and it makes
  `immutable` a lie — so every reader pays a revalidation round-trip forever.
- **A Worker in front of the bucket.** Deferred, not rejected. A custom domain
  on the bucket needs no Worker for plain public reads. A Worker becomes
  worthwhile only if signed or access-controlled reads are ever wanted, which
  ADR-0123's posture might eventually motivate for private harbors.

## 14. Cross-references

- ADR-0115 — database distribution and sync (R2 already in the account)
- ADR-0123 — cloud vault and account KMS (what portdaddy.dev may hold)
- ADR-0130 — derived JSON must be generated and hash-gated (this ADR's parent rule)
- ADR-0045 — loud-fail invariants and honest attestation
- `scripts/check-whitepaper-corpus.mjs` — the discovery-plus-manifest idiom
- `scripts/harbor-research/check_plate_provenance.py` — resolve the real references, do not trust a list
