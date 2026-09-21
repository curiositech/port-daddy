# Protocol-only checkpoint — approved source freeze

**Parent approved the bounded A paragraph/list implementation for an immutable
source checkpoint, not global B or full-Book acceptance.** Parent reviewed the
local paragraph delta, exact manifest/receipt, main-open restored page 7 and
Heros restored page 10, and independently reran all ten source tests successfully.

Owned worktree: `/Users/erichowens/coding/tmp/book-protocol-checkpoint-20260920`.
Branch: `codex/book-protocol-checkpoint-20260920`.
Reconciled base: `73d8ce4ec38d1f1125d32401888984a7f5ee1936`.
A fresh fetch and live GitHub read verified #10307 MERGED into main at that SHA
on 2026-09-21T01:24:44Z. Four landed commits / 11 changed paths had zero overlap
with A's 54 owned paths or 14 TeX inputs. A was fast-forwarded with hooks and
automatic maintenance disabled; no stash, reset, merge commit, or canonical edit.

Approved manifest SHA-256:
`5871f08ade4681171d0970d58fe5ccc805125309624e833f5e36850781e5c272`.
After approval, only this handoff, the manifest, and the test's exact base pin
changed. All 14 TeX inputs and 36 evidence files remain byte-identical; no rebuild
was needed or claimed. No rendering logic, helper, style, or asset was changed.

The external steward handoff directory is
`/Users/erichowens/coding/tmp/book-protocol-checkpoint-20260920-handoff/`.
It preserves approved snapshots and will record the resulting exact commit/tree,
final hashes/tests, and credential-free publication materials. The commit receipt
is external to avoid a commit self-reference. No push or PR is claimed here.

## Review entrypoints and exact incremental scope

Start with this handoff and [source/dependency manifest](PROTOCOL-CHECKPOINT-20260920.json).
Parent-reviewed paragraph artifacts, relative to the earlier 6e18c80 base, are under
`.cache/protocol-checkpoint/paragraph-review-6e18c80fc8/`:

- `review-delta.patch`: exactly six files since the parent-reviewed base refresh.
- `A-source.patch`: complete binary-capable 54-path candidate relative to that earlier base.
- `before-*`: preserved pre-change snapshots, including the previous manifest.
- `validation.json`: final source-test output, manifest/patch digests, and read-only
  patch applicability checks. Review aids are local, not proposed source.

The parent-approved six-file paragraph increment was:

1. `website-v2/public/whitepaper/coordination-papers-mega-volume-preamble.tex`:
   dedicated style head separation `0pt`; protocol-local heading termination and
   immediate theorem-entry/heading-renderer restoration; custom wrappers use the same local end.
2. `tests/harbor-research/fixtures/protocol-style-fixture.tex`:
   eight real list-first cases, paragraph-entry and scope checks, nested/after
   ordinary-family controls. A fixture-only `\Needspace` keeps the unrelated
   ordinary-definition control and its deferred amsthm anchor on the same page.
3. `tests/harbor-research/test_protocol_style.py`:
   paragraph/locality negative controls; marker/body and ordinary-heading PDF
   geometry; exact input and validator hashes checked before and after compilation.
4. `changelog.d/draft-book-protocol-frames.md`: describe standalone list-safe headings.
5. This handoff.
6. The JSON manifest.

48 of the 53 source-file entries were unchanged from the earlier base refresh.
Only the preamble and fixture change among the 14 repository TeX inputs.
The manifest excludes itself to avoid a self-hash cycle; it is the 54th candidate
path. Current local evidence comprises 32 positive files and four retained
negative-regression files. Earlier evidence/review patches are preserved but
superseded for this paragraph-heading candidate.

## Implementation and preserved boundaries

`protocol` and `heprotocol` retain their independent amsthm counters and
optional-title APIs. Their dedicated `pdprotocol` style now uses `0pt` head
separation. `\AtBeginEnvironment` installs a **group-local**, one-heading append
to the active `\@begintheorem` wrapper. It preserves nameref's title wrapper,
flushes the deferred heading with `\leavevmode`, then executes
`\par\nobreak\smallskip\@afterindentfalse\@afterheading`. It immediately restores
the saved theorem entry and heading renderer **before the body**, not merely when the environment
ends. Failure to attach the hook raises a package error.

There is no global theorem/proof patch and no change to unrelated styles.
`lsprotocol` keeps its required-title argument; `stpprotocol` keeps its optional
argument. Their custom heading still ends its paragraph inside its local
ragged-right/font group, then applies the same protocol-specific termination
helper. All four counters, section resets, anchors, and title forms remain.

Both shared-helper mirrors remain byte-identical to frozen SHA-256
`a34ac91f4a56cf54694e0677a4f57e143ea09a65a300de0d64875f21bb0452a8`.
No helper delta was needed. All nine official Lucide SVG/PDF pairs in both
mirrors, notices, and the portable vendor recipe are unchanged. Upstream SVGs
and full license were previously verified against Lucide commit
`951813ce76a859d4d8b145366972cbb237147a4e`; frozen PDFs were not regenerated.

The complete A slice also retains the explicit tcolorbox skins/breakable load,
helper load, breakable protocol frames, and narrow `whitepaper/.gitignore`
exception for Lucide PDFs. No dirty pedagogy, scientific chapter prose,
margin allocator, citation generator, B global headings/colors, private fonts,
or published Book PDF was copied. Only the Book preamble activates the shared
protocol presentation; its helper source twin is retained in the other mirror.

## Validation and visual evidence

Ten focused source tests pass: protocol contracts/negative controls, helper
freeze, icons/licenses/mirrors, ignored-PDF protection, portable inputs,
manifest hashes, and prose/list geometry controls.

Fresh offline Tectonic 0.17.0 builds ran three passes each:

| Profile | Pages | PDF SHA-256 |
| --- | --- | --- |
| `main-open` (Pagella) | 8 | `3d65fb87153978a367857b828e34241b2b03da5d19e1486bf59254288fc9d84c` |
| `heros-open` (Heros) | 10 | `e5f005425b6b4ed133f21b44cf4e5d25467432d1730e9379a77381b20bf03e23` |

Each profile passes:

- 18 body-entry checks: vertical mode, no pending deferred heading, original
  theorem entry and heading renderer already restored.
- 10 prose-heading and eight list-first geometry checks. All list markers and
  first body words lie below the entire heading, including the wrapped required
  title. Marker/body baselines align within 0.5 pt; markers remain left of text.
  Minimum measured heading-to-marker clearance: **4.583185 pt** (Pagella),
  **8.275667 pt** (Heros).
- 17 scope-restoration checks, including theorem entry/heading renderer, proof/optional-proof
  implementations, plain/definition styles, font, color, paragraph alignment,
  leading, and club/widow penalties.
- 23 expected labels/counter values and actual PDF destinations; four independent
  counters reset by section and reach 3.2 after the paired list cases.
- Three ordinary-family geometry controls: following theorem, optional-title
  proof, and a remark nested inside a protocol remain run-in.
  Exactly 18 glyph calls additionally reject a protocol glyph leaking into the
  nested remark. Visual inspection caught that renderer leak during completion;
  the local hook now restores the renderer before the body, with a source negative
  control and body-entry assertion covering it.
- Long-frame continuation from pages 2–6 / 2–8, retaining first/middle/last borders.

The old `\newline` implementation is a real red regression: retained PDF
`newline-list-negative/protocol-style.pdf` places the generic marker/body at
y=131.066080 pt while the heading bottom is y=141.359479 pt. The current geometry
validator rejects it. Its PDF, log, page-7 image, and `negative-result.json` are
bound in the manifest. This is retained output rechecked with the current
validator, **not** a claim that its entire intermediate source snapshot was frozen.

Final positive evidence directories:
`.cache/protocol-checkpoint/main-open-paragraph-restored/` and
`.cache/protocol-checkpoint/heros-open-paragraph-restored/`.
Each contains PDF, aux/log, fonts, actual destinations, text, dependency record,
three geometry records, and a receipt. Headless 150-dpi images were inspected:
main pages 1, 2, 3, 6, 7, 8; alternate pages 1, 8, 9, 10. Inspection confirms
heading separation, list placement, continuation borders, and unchanged ordinary
controls. The old page-7 image visibly exhibits the rejected run-in markers.

No undefined references, multiply defined labels, missing characters, or overfull
boxes were found. Baseline inputenc/geometry warnings remain. Fonts are open TeX
Gyre faces; no Suisse or Menlo. The LaTeX whitepaper engineering skill informed
the repeated-pass, log, reference, and rendered-page checks; publication steps
were not performed in that implementation step. Publication is now a separate
steward-owned step through the authorized publisher.

## Evidence binding and remaining limits

Each preserved final render resolved manifest base and actual HEAD exactly once before
compilation. It snapshots all 14 repository input hashes and the validator hash
before compile, checks them again afterward, and records them in its receipt.
The current manifest still matches those actual TeX input bytes. Original render
base/HEAD was 6e18c80fc88e94454f3d0ac4514cd1c811efbff5; receipts are preserved as
executed, not relabeled to 73d8ce4. Original validator SHA-256:
`a80c9435f146b1bf8544f675f64f6be88dd5e5591930d8d939bcee819b73c906`.

The external approved validator snapshot retains that exact hash. The current
validator differs only in the source-test base-pin literal, 6e18c80 to 73d8ce4;
its render logic is unchanged. The reconciliation/commit receipt binds the
unchanged input bytes to the refreshed checkpoint without claiming a fresh render.
TeX package versions
and the engine digest are recorded, but cached bundle bytes are not independently
pinned, so cross-toolchain PDF-byte reproducibility is not claimed.

There is **no source-to-full-Book binding**. This is option A, not a reproduction or acceptance of the roughly 700-page
canonical Book. Parent's supplied fourth-PDF hash
`72c70ef9a453164f12c08a84837287ceb8d470a165fdc2475e808053e3e11e83`
was not rebuilt or accepted here.

## Reproduce scoped checks

From the worktree root:

```sh
/usr/bin/python3 -B tests/harbor-research/test_protocol_style.py
/usr/bin/python3 -B tests/harbor-research/test_protocol_style.py --render --engine tectonic --font-profile main-open --output .cache/protocol-review-new
/usr/bin/python3 -B tests/harbor-research/test_protocol_style.py --render --engine tectonic --font-profile heros-open --output .cache/protocol-heros-new
bash scripts/harbor-research/vendor_lucide_book_icons.sh .cache/protocol-icons-new
```

Existing output directories are refused. `--root` selects a checkout and
`--output` selects fresh evidence. `--engine xelatex` is supported but untested
here. Tectonic uses cached packages with shell execution disabled; a new machine
needs its TeX resources provisioned. A working Python 3.9+ standard XML module is
required. This run used /usr/bin/python3 3.9.6; local Homebrew Python 3.14's broken
expat extension was left unchanged.

The vendor script downloads only pinned public SVG/license inputs into a new
comparison directory; it never overwrites source assets. librsvg 2.62.3/Cairo
1.18.4 previously produced comparison PDFs. Converter metadata can change PDF
bytes; the manifest binds the copied frozen PDFs, not arbitrary regeneration.

No large test discovery, model/scientific proof-script run, full-Book build,
local Port Daddy runtime, or auth-secret read was used.

## Base history and #10202 / #10203 dependency answer

The previous base-only refresh verified all 53 source / 14 input / 24 evidence
entries in the original draft before one fresh fetch, then fast-forwarded A from
`d684f03e7e55e8b6a6b25c67fe7272e47ac8b853` to 6e18c80fc8 with hooks disabled.
Thirteen commits / 456 upstream paths had no overlap with A's source or fixture
inputs. No stash/reset/merge commit or canonical mutation occurred. Its three-file
increment and original manifest remain under
`.cache/protocol-checkpoint/base-refresh-6e18c80fc8/`. Those were reviewed by parent.
The manifest immediately before this paragraph completion had SHA-256
`be8891b00ed67f8c10d8d1c7332339a572af809bf4c45cfa0ba3138f096441b2`.

The initial narrow audit found both old PRs OPEN, at heads
`8f3e4fca882a882dcc662dc61321f8bb4b46fb2c` (#10202) and
`b649ca36b952257849579dec524317f2fcbfcbfc` (#10203). This is historical status,
not a fresh PR-state assertion.

- [#10202](https://github.com/curiositech/port-daddy/pull/10202): body/apparatus
  classifier, opener filtering, tests, lint ratchet. **Not an A compile/style
  dependency.** Its successor body/apparatus policy is now inherited through
  [merged #10307](https://github.com/curiositech/port-daddy/pull/10307), verified
  live during this freeze. The landed changes include explicit chapter-apparatus
  declarations, classifier/tests, and the CI gate. They are inherited main files,
  not A-owned changes. No claim of byte identity with the old PR is made.
  Historical ratchet 17 is not a current-corpus measurement.
- [#10203](https://github.com/curiositech/port-daddy/pull/10203): three raw-ID
  renames plus reference/index updates, two removed CI allows, CLI negative-exit
  tests. **Not an A style dependency; agreed effects are already inherited**
  through [merged #10306](https://github.com/curiositech/port-daddy/pull/10306)
  in A's main ancestry, not copied from the old PR:
  `def:cross-operator-attestation` in `spawn-to-person.tex`,
  `def:cross-operator-attestation-problem` in `harbor-economy.tex`,
  `def:bonded-float-plan` in `agent-transactions-whitepaper.tex`
  (under `website-v2/public/whitepaper/`). These files remain untouched.
  Updated index JSON/Markdown, unsuppressed workflow gate, and CLI tests are
  inherited too. No old 551-page PDFs were imported.

The earlier base-refresh validation passed 16 focused duplicate-check tests and
reported **139 labelled statements / 8 chapters / 0 collisions / 0 allowed
exceptions**. It was not rerun for this styling-only completion. Its recorded log
is retained in the manifest. This checks raw labels only; CA-014 Float Plan
semantic/schema duplication remains unresolved and separate.

## Integration and review boundary

Merge selected protocol hunks into canonical, **not the whole preamble**.
B already owns global heading termination and colors. Resolve overlapping
termination hooks so each protocol heading ends once; preserve the local font
group, counters/title APIs, and original entry/proof definitions. A's frozen
helper requires no change. Re-run the fixture on the integrated source; parent
owns the complete Book proof and acceptance.

A now fulfills paragraph/list-first heading behavior for the four protocol
families. Ordinary theorem/definition/proof presentation deliberately remains
the pinned main baseline; this is not all-block compliance. B full-baseline
isolation remains separately tracked in
`/Users/erichowens/coding/tmp/book-source-checkpoint-audit-20260920/REPORT.md`,
requiring accepted source hashes and ownership review, not a wholesale dirty copy.

Parent granted the scoped local commit after review. Stage only the 53 manifest
source entries plus the manifest itself; keep caches and the external handoff out.
The steward owns review-PR publication under the current GitHub App/Fleetbot
contract, with exact source/base/tree readback. No personal-credential fallback,
local Port Daddy runtime, direct push, or publication dispatch is authorized by
this receipt. Reconcile again if main moves before the steward publishes.
Subsequent readability and scientific prose remain separate slices.
