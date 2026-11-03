# Porthole ideas archaeology: terminal, product, search, testing, sharing, and people

Research notes, 2026-11-03. These preserve proposals and their evolution; they are not a new product plan or an assertion that the described product runs today.

## Research boundary and reproducibility

- Verified linked worktree: `/Users/erichowens/coding/tmp/porthole-ideas-archeology`.
- Verified feature branch: `codex/porthole-ideas-archeology`.
- Pinned source: `94f6f6dca8a4120ef8748fc84e9777b06151f9f5` (all current-tree citations below).
- Linked Git metadata: `/Users/erichowens/coding/port-daddy/.git/worktrees/porthole-ideas-archeology`.
- Historical source: ancestor `f3098054be3b6253fa1d905597dc5dce2dd8a9ab`, which retained the 2026-08-19 PRODUCT/PERSONAS before their 2026-08-29 rewrite. The two blobs are identical to the original feature commit `24c2a54637b97aac9c8afea981e33adbaf785374` (`PRODUCT.md` blob `84bd5a3f3b8ede0d52e24daa6e46c3a5c41d9e1f`; `PERSONAS.md` blob `c02570a0f3e1be31560d58aed965127621ba0939`). Using the ancestor avoids relying only on a surviving side branch.
- Read via `git show`/`git grep`, because sparse checkout intentionally leaves most sources absent on disk. No sparse configuration changed. No recorded command, app, local server, daemon, hook, or Port Daddy runtime executed. No tests run. Historical test/proof claims are labeled as documentation, never refreshed here.
- Offline operating guidance read: relevant halt, evidence, operator-surface, and worktree sections in `AGENTS.md`, `skills/port-daddy-agent-skill/SKILL.md`, and `skills/port-daddy-internal-dev/SKILL.md`. The runtime halt took precedence over all obsolete run/coordination examples.

## 1. The original insight was a four-way reusable artifact

The August 19 brainstorm opens with a standalone developer product **and** Port Daddy growth loop: “Same engine, four faces.” The recording should be simultaneously:

1. A real terminal capture in open asciicast format.
2. A golden-transcript CI test.
3. A hosted, scrubbable, copyable link.
4. A zero-dependency web/React embed made of selectable DOM text.

That is broader than a recorder or a terminal video player. One truthful artifact should travel from an actual development session to an issue, README, docs page, PR, or test gate without creating a separate staged version for each destination.

Source: [historical PRODUCT 1–16](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L1-L16); [current design-draft Record/Test/Share loop 203–224](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/portholed-site.template.html#L203-L224).

The motivation was concrete self-audit, not an invented market: the old landing page called hand-authored typewriter strings real recordings; recordings contained errors, empty payoffs, splicing, stale commands, leaked paths, and truncated output. The audit reports 47 website casts read, 12 with errors/empty/corrupted output, an 18-line output cap, and CSS cropping roughly 13% of terminal images. Those are August 18 audit findings, not a newly measured state of the site.

Source: [AUDIT 3–18](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/AUDIT-2026-08-18.md#L3-L18), [49–75](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/AUDIT-2026-08-18.md#L49-L75).

## 2. Preserve the whole terminal experience, with two honest replay modes

The desired basic experience: pause, seek, restart, quarter/half/normal/double speed; native text selection; per-line copy and full-transcript copy; scroll up without the player dragging the reader down; a visible resume-follow action; bounded viewport with full history; mobile wrapping for prose output; accessible labels and reduced-motion behavior; source/date/geometry/fidelity provenance.

The important distinction is **transcript versus screen**:

- Linear shell output becomes append-only styled scrollback. A 300-line run in a 28-row window still leaves 300 lines to inspect.
- Alternate-screen TUIs such as vim, htop, fzf, lazygit, and tmux are fixed geometry, cursor-true screens. They must not wrap; pan or scale instead.
- A mixed shell → vim → shell session should interleave transcript blocks and an embedded screen block. OSC 133 command boundaries, otherwise alt-screen transitions, provide segmentation.
- The early rule was that tmux is a program painting a grid, not magically understood panes. Later work adds a separate authoritative pane-history archive, described below.

Source: [historical PRODUCT 18–32](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L18-L32); [PLAN 53–73](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PLAN.md#L53-L73).

The early pipeline proposed asciicast v2/v3 compatibility, recorded terminal palette, timestamps and exit-status events, pinned capture geometry, no input-event recording, and retaining raw elapsed time even if idle gaps are clamped. VHS would remain a reproducible driver/DSL and possible ASCII golden source, while the result becomes a cast rather than a GIF. The plan proposed build-time `@xterm/headless` interpretation and tiny runtime line/frame JSON. The actual current player inspected uses its own shared VT interpreter at runtime instead. Preserve this as an implementation change, not proof that the build-time architecture shipped.

Source: [PLAN 37–73](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PLAN.md#L37-L73); [VT implementation rationale 1–30](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/lib/porthole/vt.ts#L1-L30).

Specific original edge cases are easy to lose in a higher-level vision: Unicode width handling; OSC 8 links as real anchors; honest explicit markers for elided output; NO_COLOR/plain legibility; trim-right and soft-wrap joining during copy; CR/CRLF spinners settling into visible state; deterministic backward seeking; and a single static HTML export. These were requirements/proposals in the brainstorm, not all verified features.

Source: [historical PRODUCT 115–123](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L115-L123).

## 3. “Demos that cannot rot”: promote reality into a test

The original `porthole.yml` idea includes named scenarios, deterministic seeded fixtures, a command sequence, normalization masks for volatile IDs/time/ports, required text, and forbidden errors/path leaks. The runner records a PTY, reconstructs what a human would see through the VT, normalizes it, and compares a committed text golden. Failing tests produce a side-by-side HTML diff; updating a golden is deliberate.

The larger loop: **the site embeds the very casts CI validated**. Demo drift becomes a reviewable text diff and build failure. Marketing, tutorials, and regression tests no longer maintain separate stories. The unique early assertion was promoting a real captured session into an assertion, beyond scripting a demonstration from scratch.

Source: [historical PRODUCT 57–84](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L57-L84), [181–202](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L181-L202).

The later product contract generalizes this into **Playwright for terminals**: deterministic keyboard/mouse/resize/signal control; wait for a region or command boundary; require a stable screen interval; assert cells, visible text, exit/process outcome; export an inspectable interactive failure trace. The runner consumes the same sanitized canonical events as review/debugging/handoff. It is one consumer of a common evidence model, not the center of that model. Candidate engine freedom (`tui-test`, `agent-tty`, or in-house) sits below the invariant evidence/privacy/receipt contract.

Source: [PRODUCT 121–139](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L121-L139), [385–393](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L385-L393); [PERSONAS P4 46–56](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PERSONAS.md#L46-L56).

Current source evidence is narrower than the whole proposal: `check-porthole-casts.mjs` replays committed casts through the same VT as the browser, scans reconstructed text (so char-split leaks cannot evade a raw-event regex), checks pane archives, and drives scene lifecycle witnesses. That supports an actual shared-interpreter gate; it does not alone establish the full generic YAML scenario/golden product or a fresh hosted CI verdict.

Source: [cast gate 1–32](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/scripts/check-porthole-casts.mjs#L1-L32), [62–139](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/scripts/check-porthole-casts.mjs#L62-L139).

## 4. The terminal flight recorder: hindsight becomes a bug report

The original shell proposal was `enable-flight`: a rolling local buffer of the last **15 minutes or 2 MB**, bytes plus monotonic timestamps, mode 0600, never automatically uploaded. After failure, `save-last 10m` materializes a cast; `share --issue` attaches it to a report. The replay preserves the flag order, a 40-second hanging spinner, and the error that flashed away. The intended replacement for a fading recollection was “Steps to reproduce becomes a link.”

The companion **app-level SDK** embeds the recorder in a CLI. On crash/panic it saves the preceding minutes and prints a replay attachment suggestion. This was conceived as session replay for terminals in an open grep-able format, not just a Port Daddy daemon feature.

Source: [historical PRODUCT 159–179](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L159-L179); [site draft 247–255](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/portholed-site.template.html#L247-L255).

Boundary change to preserve: the early buffer writes raw PTY locally and scrubs before share. That cannot satisfy the later promise of **no secrets persisted**. The later PRODUCT explicitly requires classifying/minimizing/redacting before the first durable write, including adapter-private stores. The historical buffer is a preserved idea whose privacy architecture needed revision, not permission to restore its raw-write design.

Source: [PRODUCT 117–119](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L117-L119), [297–331](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L297-L331).

## 5. Sharing, living docs, line citations, and independent distribution

The sharing plan was a capability URL that hosts the scrubbable cast. **Line-level deep links** let an incident cite line 482 like a stack frame. Public, unlisted, private/team, and expiring links; org namespaces; custom domains; retention controls; and a searchable library were distinct product ideas.

The particularly useful docs idea: a named slot such as `/p/acme/quickstart` that CI updates on every release, keeping an already-embedded tutorial current. The earlier copy calls this “living docs.” This is a mutable destination pointing at current evidence; it should not be confused with the later immutable historical evidence citations.

Source: [historical PRODUCT 86–102](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L86-L102); [site draft 219–223](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/portholed-site.template.html#L219-L223), [302–311](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/portholed-site.template.html#L302-L311).

For script-stripping destinations such as a GitHub README: generate an **SVG poster of the payoff frame**, still text in the SVG, linked to the live player. For self-hosting: export a single HTML file containing player, cast, and themes, with no dependencies. A GIF escape hatch was also proposed where only pixels work; that is historically present even though the later operator charge says to replace GIF evidence with Porthole.

Source: [historical PRODUCT 34–44](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L34-L44), [93–95](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L93-L95), [115–123](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L115-L123); [site FAQ 327–341](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/portholed-site.template.html#L327-L341).

Packaging proposal: MIT `@portdaddy/porthole` web component plus React wrapper, zero runtime dependencies and about 15 KB gzipped as a target; a standalone Homebrew `porthole` recorder/test runner usable without adopting the daemon. Share and fixtures would introduce Port Daddy rather than installation forcing it. The proposed commands alternate between `pd rec` and standalone `porthole`; the install strings in the design draft are examples, not verified release availability.

Source: [historical PRODUCT 104–113](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L104-L113); [draft installation clearly marked in development 153–160](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/portholed-site.template.html#L153-L160).

## 6. Reskinning was a first-class product contract

The early architecture explicitly anticipated other teams owning their player chrome:

- A framework-free `@portdaddy/porthole-core` provides VT, transcript, and clock; a `usePorthole(cast)` hook exposes state/actions for custom UIs.
- Documented root-scoped `--ph-*` CSS properties form the public theme API, including palette, foreground/background, chrome, font, and radius.
- Themes can be preset names, token objects, or **faithful mode**, which uses the palette recorded in the cast header.
- `data-playing/wrapped/theme/following`, web-component `::part(titlebar|line|controls)`, and React `classNames` slots expose a semver-stable styling contract, while internal classes remain private.
- Plain CSS can be omitted with `unstyled`; no CSS-in-JS runtime or Tailwind requirement; ESM; SSR emits the final transcript as SEO/no-JS fallback, then hydrates; a video-like imperative ref.
- A shadcn-style copy-paste skin registry lets teams own chrome while continuing to update the core dependency.

“Opinionated default skin is fine — the sin is opinion without exits.” This is more specific than a dark/light toggle and should survive product-memory compression.

Source: [historical PRODUCT 133–157](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L133-L157); [site theming proposal 283–298](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/portholed-site.template.html#L283-L298).

## 7. Search was meant to answer causal questions, not merely find strings

Early usefulness: find something in the whole transcript, copy its command, cite its exact line/time, search your library from an imperfect recollection. The August 29 architecture expands this into a **decision-centered searchable evidence graph**.

Its proposed retrieval design:

- Small immutable facts in the canonical ledger; large sanitized, content-addressed encrypted artifacts; disposable search and decision projections.
- Sanitized screen keyframes plus changed-cell runs; grid/style deduplication only within an authorized privacy domain; lineage from bytes to cells independently of DOM representation.
- Output chunks grouped by command/process after privacy handling; explicit omission byte counts/reasons, never a raw secret cold tier.
- Exact process/tool/context filters and causal parent-event links, because timestamps do not establish causality.
- Budgeted cited `TranscriptSearchQuery/Result`; hybrid lexical+dense retrieval with RRF; hits carry event/artifact citations and index freshness.
- Index sanitized visible text with frame/time/cell coordinates: a hit opens the exact screen region, not an approximate raw byte offset.
- Receipt retrieval by stable ID, outcome, tests, files, risk, privacy class, citations, while keeping canonical receipt bodies.

Source: [PRODUCT 177–193](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L177-L193), [333–351](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L333-L351).

Original example questions worth retaining verbatim:

> “Which agents saw the lock refusal before they edited `src/checkout.ts`?”
>
> “Which context packets omitted the warning later named in the incident receipt?”
>
> “Compare the original and repaired successor at command, screen, context, and receipt layers.”

Other examples ask for the screen/context behind the first decision citing a failed test, and nonzero command exits incorrectly projected as validation passes. Search displays evidence; it never authorizes a mutation or decides success.

Source: [PRODUCT 353–359](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L353-L359).

## 8. The strategic expansion: click the failed decision, then explain and test it

The August 29 revision explicitly says the terminal player is the lens and not the defensible center. It proposes a sequence:

1. Open a failed decision bound to identity/session/run/worktree/model/authorization.
2. Reconstruct the exact privacy-preserving screen immediately before it, geometry/cursor/styles/alt-screen intact and redactions visible.
3. Follow screen → command/exit → process/tool → file/diff → external causal event.
4. Open the exact context envelope, compaction packet, survived obligations/risks, and authorized omitted-output references without claiming omitted bytes were in the model context.
5. Verify a work receipt covering intent, scope, risks, commands/tests, rollback, cost, provenance, and artifacts.
6. Demonstrate a transient secret canary was rejected before first persistence and is absent from the declared durable perimeter.
7. From a verified T5 pre-failure checkpoint, create an isolated successor with one declared repair delta; compare its evidence/receipt to the original without editing history.

Source: [PRODUCT 9–52](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L9-L52).

The architecture must remain a projection of Port Daddy authority, not a second identity, transcript, receipt, context, search, or approval system. Engines observe transiently; the capture gateway owns first durable write; canonical `TranscriptEvent` persists facts; screens, joins, search, and T5 checkpoints project them into the decision view. “Not captured,” “redacted,” “omitted from context,” and “withheld from this viewer” are different states.

Source: [PRODUCT 66–119](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L66-L119), [177–214](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L177-L214).

The branch idea is an execution experiment, not playback seeking. It needs a verified snapshot provider and sandbox authority, complete source/dirty-file hashes, runtime/terminal/clock/randomness/network inputs, context and policy refs, budget, parent head, repair delta, and branch receipt. Container/microVM reconstruction may precede live-kernel snapshots; Wasm Linux/microVM snapshots are later acceleration. Each child gets a new identity, credentials, budget, transcript, receipt. Changed outcome alone does not prove causality when uncontrolled inputs changed.

Source: [PRODUCT 361–383](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L361-L383).

## 9. Multiple perspectives and deliberation across time

The product imagines one correlated event graph with different projections for Nora, Milo, the daemon, and the operator. It preserves disagreement and unread turns instead of making everyone look omniscient. The document calls it the “Run, Lola, Run” of a team. Private membership never silently grants access to a peer's perspective. Shared cursors/presence/annotations may use replaceable WebSocket/Durable Object transport; they become durable evidence only if policy allows and a decision/receipt cites them.

Source: [PRODUCT 320–331](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L320-L331), [395–405](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L395-L405).

Parley was supposed to be automatically detected and presented naturally, with protocol as audit drill-down. Overlapping claims, symbols, plans, risks, and decisions should trigger a consultation card and fair participant routing. Across shifts, a dormant worker gets a durable summons, not impersonation. Silence means `NO_QUORUM`; a bounded consent lease permits discuss-only reentry or an explicitly labeled successor, and actions require separate current authority. Porthole records perspective and transition evidence; it does not wake, vote, or act. The proposal also makes salvage limits explicit: returning notes/verified packet is not restoring process state, hidden provider state, claims, or a full checkpoint.

Source: [PRODUCT 216–268](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L216-L268), [270–295](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L270-L295).

Concrete source nuance: a tmux recording shows only the outer grid; erased inner pane history cannot honestly be recovered from it. The current Parley component describes a separate recorder-authored `tmux capture-pane` archive captured before teardown and bound to the cast hash. Four independently focusable panes report their captured line counts and whether history limits were reached. Its prose explicitly says public explanations/receipts are not private chain of thought, and distinct scripted sessions are not proof of independently sampled model minds.

Source: [ParleyTmuxReplay 125–155](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/components/harness/ParleyTmuxReplay.tsx#L125-L155), [210–231](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/components/harness/ParleyTmuxReplay.tsx#L210-L231).

## 10. The people and their original stories changed as the scope expanded

### August 19: the six terminal-product customers

| Person | Trigger and intended outcome | Proposed entry point |
|---|---|---|
| OSS CLI maintainer | Removed flags remain in README GIF; record → README SVG embed → CI golden makes drift fail | Homebrew or GitHub Action |
| DevRel/DX engineer | Forty tutorial pages decay silently; re-record per release and regenerate validated docs | `porthole.yml` plus docs CI |
| Bug reporter | Failure happened minutes ago and memory is fading; save recent buffer and attach a replay | Shell hook or app crash SDK |
| Incident responder | Shift change during an investigation; inspect exact commands/output/timing from team replay | Attach to existing tmux; private team share |
| Educator | Students retype wrong quotes from screenshots/video; slow down, pause, copy; readable on phone | Web/course embed with no student install |
| Fleet operator | PR claims tests passed; receipt links terminal proof including cast exit status/run provenance | Fleet integration and PR work receipt |

Source: [historical PERSONAS 7–90](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PERSONAS.md#L7-L90).

### August 29: the seven evidence/continuity customers

| Person | Essential need |
|---|---|
| Agent developer | Explain a wrong edit from visible screen, process, actual context, omitted-output citation, file state, receipt; test a controlled repair |
| Fleet operator | See distinct causal perspectives and handoffs; bind final receipt to exactly supporting evidence |
| Security/privacy reviewer | Prove minimization before disk/index/cache/archive; visible recording state, selective disclosure, retention/deletion/access audit |
| CLI/TUI maintainer | Deterministic interaction, semantic waits, stable regions, reconstructed cells, CI failure trace through interchangeable engines |
| Incident responder | Continue the investigation through cited evidence and a distinct scoped successor without unrelated private content |
| Cooperative Rust/Swift/web team | Floating cursors, comments, perspective changes, shared decisions, private prompts and credentials kept private |
| Reviewer/auditor/regulator | A narrow capability-scoped immutable evidence bundle; omissions/redaction/expiry stay explicit |

Source: [current PERSONAS 11–105](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PERSONAS.md#L11-L105).

Reading these as replacements would lose the maintainer/DevRel/educator distribution ideas. They are two documented lenses on the product at different dates, not evidence that the earlier users ceased to matter.

## 11. Original positioning and pricing, preserved as historical drafts

The original framing was “the terminal's flight recorder,” with “Rewind your terminal,” “Demos that can't rot,” and “The whole session. Every line. One link.” The brainstorm specifically corrects the initial temptation to lead with selectable text: it recognized asciinema already advertised copy/paste. Its claimed differentiated bundle was whole-session shared scrollback, retrospective capture, real-session-to-CI assertions, share/embed/test in one artifact, line deep links, and hosted redaction.

It proposed scrollback+search+share first, flight recorder second, CI goldens for paid adoption; use the candid self-audit as the launch story and demonstrate record→test→share in 90 seconds using Porthole itself. VHS was to be complemented as a scripting tool. Competitive “zero products” and star-count claims were dated August 19 beliefs in the source, not current verified facts; no new market research was performed here.

Source: [historical PRODUCT 104–113](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L104-L113), [181–206](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L181-L206).

Two draft pricing variants coexist even in the old document:

- Earlier §4: anonymous 30-second preview gate, seven-day retention, 512 KB limit; free accounts with five-minute casts/50 stored/permanent links; paid team libraries/private/custom domain/retention/CI/living docs.
- Later §10 and marketing draft: free unlimited local use, seven-day anonymous shares, three signed-in permanent public links; Pro roughly $9/month for permanent/private/expiring links, search/deep links/custom domains; Team roughly $10/seat for org library/SSO/retention/CI/named slots. The prose warns against hostile privacy gating and treating storage as the paid-value center.

These were unsettled brainstorm numbers, not real prices, entitlements, policy, or customer validation. Naming concern was also recorded: Porthole might be mistaken for a terminal port-management utility.

Source: [historical PRODUCT 86–102](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L86-L102), [125–131](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L125-L131), [196–206](https://github.com/curiositech/port-daddy/blob/f3098054be3b6253fa1d905597dc5dce2dd8a9ab/demos/porthole/PRODUCT.md#L196-L206); [site pricing explicitly draft 302–311](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/portholed-site.template.html#L302-L311).

## 12. Related operator intent corroborates the wider ambition

The repository's operator-charge reconstruction records these original requests: searchable append-only operator/all-agent history, continuous Porthole capture, strong encryption, lexical+semantic indexing and analytics/warehouse paths; move beyond Parley-only framing; arbitrary Rust/Swift GUI windows; embodied ghost cursors, selections, clocks/comments and automatic Playwright generation from interaction; sharing and vague-recollection semantic search; background-media ignorance/blocking; and replacing GIF evidence with Porthole.

These ledger rows are a secondary reconstruction of prior chat, with explicit ambiguity about injected context in message 1; they are not newly read original raw messages or implementation proof. The same ledger later requests a visible selectable program/instance allowlist, clear capture permission identity, coherent compass iconography, reliable background capture, and cursor-motion proof.

Source: [operator ledger part 01, 3–12](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/operator-charge-ledger/part-01-messages-001-027.md#L3-L12), [30–38](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/operator-charge-ledger/part-01-messages-001-027.md#L30-L38); [part 02, 7–11](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/operator-charge-ledger/part-02-messages-028-055.md#L7-L11), [21–25](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/operator-charge-ledger/part-02-messages-028-055.md#L21-L25).

## 13. What is documentary, source-present, or still unproved here

| Layer | Evidence seen in this reading | Honest limit |
|---|---|---|
| Terminal prototype | `porthole.template.html` contains player chrome, cast tabs, VT, seeking/copy/follow/wrap/theme code | Inspected source excerpts; did not run it |
| Website player | Complete `player.ts` and React wrapper read: stable DOM lines, copy/follow, speeds/seek/restart, semantic highlights, broken-axis jump cuts, reduced-motion final transcript, lazy loading, teardown and visible load failure | Source presence only; no browser/runtime check this turn |
| Shared VT/gate | VT rationale/alt-screen code and decoded-cast gate excerpts read; pane archive hash/history checks present | Not the entire generic scenario+golden product and not current hosted CI evidence |
| Historical replay proof | PLAN describes Playwright proof retaining 92 lines in a 28-row viewport; PRODUCT says #9902 proves replay/gallery, real tmux perspectives, time cuts, discovery, receipts presentation and lifecycle | Those are dated documentary claims, not fresh PR/CI/runtime verification |
| Full evidence product | PRODUCT explicitly marks terminal/process observations, pre-persistence DLP, cited evidence search, selective disclosure, deterministic assertions and controlled branching as proposed | A gallery or static screenshot cannot demonstrate those contracts |
| Standalone distribution/pricing | Historical brainstorm and design draft contain CLI, Homebrew/npm/web component/SSR/SDK/share/pricing examples | Examples were not executed or availability checked; no market/customer claims |
| GUI/shared stage/private recall | Cross-referenced as the wider product; other research notes own that detailed corpus | This note is not an exhaustive account of native/stage work |

Source anchors: [PRODUCT capability truth 54–64](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L54-L64); [player controls 175–227](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/lib/porthole/player.ts#L175-L227), [357–405](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/lib/porthole/player.ts#L357-L405), [477–544](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/lib/porthole/player.ts#L477-L544); [React wrapper 18–70](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/components/porthole/PortholeEmbed.tsx#L18-L70).

A subtle present-source limit: the player labels the source as released CLI/live daemon and fidelity as unfiltered PTY bytes by fixed prose. That reflects the intended proof corpus; the label is not a generic cryptographic validation of an arbitrary loaded cast. Likewise, its `semanticSpans` regex highlights anchors/hook/refusal text; it is an inspectable rendering aid, not structured canonical command truth or semantic retrieval. Do not mistake the UI's label/highlight for a receipt.

Source: [player semantic layer 52–89](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/lib/porthole/player.ts#L52-L89), [504–524](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/website-v2/src/lib/porthole/player.ts#L504-L524).

## Corpus actually read

Complete primary/product sources:

- `demos/porthole/PRODUCT.md` at pinned HEAD, all 453 lines.
- `demos/porthole/PLAN.md`, all 115 lines.
- `demos/porthole/PERSONAS.md`, all 105 lines.
- `demos/porthole/AUDIT-2026-08-18.md`, all 75 lines.
- `demos/porthole/portholed-site.template.html`, all 373 lines.
- Historical `demos/porthole/PRODUCT.md`, all 206 lines at original feature commit, blob equality checked against pinned ancestor `f3098054be`.
- Historical `demos/porthole/PERSONAS.md`, all 90 lines at original feature commit, blob equality checked against pinned ancestor `f3098054be`.
- `website-v2/src/lib/porthole/player.ts`, all 545 lines.
- `website-v2/src/components/porthole/PortholeEmbed.tsx`, all 71 lines.
- `website-v2/docs/pr-artifacts/porthole-player/MANIFEST.md`, all 21 lines (historical artifact descriptions only; media not opened).
- `docs/operations/operator-charge-ledger/part-01-messages-001-027.md`, all 40 lines.
- `docs/operations/operator-charge-ledger/part-02-messages-028-055.md`, all 42 lines.

Targeted source/history inspection:

- `demos/porthole/porthole.template.html`: headings/controls/interpreter structure and exact lines 122–171, 434–560; not every VT branch.
- `website-v2/src/lib/porthole/vt.ts`: lines 1–210, including intended shared-interpreter contract and alternate-screen behavior.
- `website-v2/scripts/check-porthole-casts.mjs`: lines 1–250, including cast parsing, archive validation and gallery lifecycle witnesses.
- `website-v2/src/components/harness/ParleyTmuxReplay.tsx`: lines 1–235, including provenance and scrollback limits; remaining closing layout not read.
- `website-v2/src/lib/porthole/player.test.ts`: test names only, not test execution.
- `.github/workflows/ci.yml`: Porthole-reference search only, not full workflow audit.
- `docs/architecture/PORTHOLE-SYSTEM-SPECIFICATION-AND-MILESTONES.md`: heading/topic search only to direct broader research elsewhere; not a full source for this note.
- Git path history for the four demo docs; earlier product brainstorm and theming addition; current source references in CLI/SDK/workflows. No claim that every branch, PR, artifact, or raw session was searched.

## Researcher synthesis, explicitly inference

The documents preserve two complementary promises: **a session that can become a reusable test/share/embed** and **a contested decision that can become a narrow auditable evidence bundle plus an isolated repair experiment**. The August 29 rewrite elevates the latter but leaves several original distribution and usability ideas only in history and marketing templates. The native/cooperative expansion must be read alongside both; reducing the whole project to terminal playback, screen video, or a protocol theater would discard documented intent. This synthesis is an interpretation of the cited repository material, not a new recommendation or claim of shipped scope.
