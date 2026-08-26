# Visual evidence manifest — Jira-grade roadmap items (PR #9641)

Provenance for every artifact in this directory. Read the honesty labels before
you trust a frame: **fixture-backed evidence is fine; evidence that pretends to
be something it is not is a merge blocker.**

## Capture identity

| Field | Value |
| --- | --- |
| Repository | `curiositech/port-daddy` |
| Branch | `claude/roadmap-jira-grade-items` |
| Commit captured from | `7ca26b1fe6fe773c8722466760d77d109a01f83e` |
| Pull request | [#9641](https://github.com/curiositech/port-daddy/pull/9641) |
| Capture script (committed) | [`scripts/capture-roadmap-jira-items.ts`](../../../scripts/capture-roadmap-jira-items.ts) |
| Raw captured bytes | [`capture-session.json`](./capture-session.json) — every block's exact stdout/stderr, ANSI included |
| Capture date | 2026-08-22 |
| Capture host | Linux container, headless only — **no window was opened, no operator focus was taken** (rung 1 of `skills/port-daddy-agent-skill/references/visual-evidence.md`) |

## Reproduce

```bash
npm ci
npx tsx scripts/capture-roadmap-jira-items.ts            # full capture + render
npx tsx scripts/capture-roadmap-jira-items.ts --replay   # re-render from capture-session.json only
```

The script writes into `docs/reports/roadmap-jira-items/` by default
(`--out <dir>` to redirect, `--no-motion` to skip the GIF/WebM).

Prerequisites: a Playwright chromium reachable via `$PLAYWRIGHT_BROWSERS_PATH`
(or a global `playwright` install) and `python3` with Pillow for the GIF. The
WebM is encoded with the ffmpeg that ships inside Playwright's browser bundle —
that build is `--disable-everything` with a WebM-only allowlist and has **no GIF
muxer**, which is why the two motion artifacts use two different encoders.

## Data source — what is REAL and what is FIXTURE

`SEEDED-FIXTURE, REAL CODE PATHS.` Precisely:

**REAL** (exercised, not mocked, not re-implemented):

- `initDatabase()` — the actual schema plus the actual boot migrations, so
  `tags_json` / `actual` / `completed_at` arrive through the real PRAGMA-guarded
  ALTER path this PR adds.
- `lib/roadmap-items.ts`, `lib/graph-edges.ts`, `lib/planner-edges.ts`,
  `lib/durable-agent-roster.ts` — the shipped modules.
- `routes/roadmap.ts` and `routes/durable-agent-roster.ts`, registered on a real
  Fastify instance **listening on a real loopback TCP port**.
- `bin/port-daddy-cli.ts` — the real CLI, run as a separate child process that
  reaches the harness daemon over HTTP exactly like any other client
  (`PORT_DADDY_FORCE_TCP=1`, `PORT_DADDY_URL=http://127.0.0.1:<port>`).
- Every character of terminal text in every image is captured stdout/stderr. No
  line was typed, edited, prettified, or invented.

**FIXTURE** (stood down on purpose, named here so nobody over-reads a frame):

- The database is `:memory:` and seeded fresh by the script. It is **not** the
  operator's live registry, and the artifacts carry no production data.
- The durable-agent roster is constructed with a stub embedding resolver
  (`modelId: 'capture-harness-stub'`) and a stub gitleaks runner, so the harness
  needs no model download and no gitleaks binary. Roster identity, the event
  ledger, `agentNodeId` minting, and assignee validation are otherwise real —
  which is why the owner join shows a genuine `agent_node_…` principal.
- `pd` in the rendered prompt lines is the repo CLI entrypoint
  (`npx tsx bin/port-daddy-cli.ts`), not an installed release binary.
- Blocks with an `HTTP` badge are direct route reads performed by the harness,
  rendered in a different colour precisely so nobody mistakes them for a shell
  command that exists. `GET /roadmap/items/:slug` **is** the detail-card surface
  in this PR; it has no CLI verb yet.
- `owner.status: "paused"` in the card reads is the roster's real status for an
  agent registered through `pd roster create` in this harness — not a redaction.

## Artifacts

| File | Size | Dimensions | Shows | Honesty label |
| --- | --- | --- | --- | --- |
| `roadmap-list-populated.png` | 333 KB | 2400×1298 | `pd roadmap --status all` rendering the planner columns inline (kind · P · est · `@owner` · due · `#tags`), then `--tag reliability` as an exact filter narrowing 5 items → 3 | SEEDED-FIXTURE, real CLI + real route |
| `detail-card.png` | 576 KB | 2400×4264 | `GET /roadmap/items/relay-retry-storms` — the whole card: every stored field, the roster `owner` join, all four typed links, `blocks`/`blockedBy`, `parent`/`children`, `tags`, `plannedVsActual` | SEEDED-FIXTURE, real route |
| `links-surface.png` | 242 KB | 2400×1238 | `pd roadmap link` adding one `--pr`, one `--doc`, one `--file`, one `--media` (with `--mime`/`--caption`), then `pd roadmap links <slug>` listing all four with metadata | SEEDED-FIXTURE, real CLI + real route |
| `null-state-item.png` | 321 KB | 2400×2384 | **NULL STATE.** An item with no owner, no tags, no links, no dependencies: `assigneeId: null`, `owner: null`, `tags: []`, `links: []`, `blocks/blockedBy: []`, `parent: null`, `children: []`, every `plannedVsActual` field null — plus `pd roadmap links` on it showing the `(no links — add one: …)` hint | SEEDED-FIXTURE, real CLI + real route |
| `empty-state-roadmap.png` | 192 KB | 2400×1050 | **EMPTY STATE.** A harbor with zero items, and a `--tag no-such-tag` filter that matches nothing — both render `(no roadmap items at this status)` plus the two backfill hints the operator is meant to act on | SEEDED-FIXTURE, real CLI + real route |
| `error-unknown-assignee.png` | 112 KB | 2400×510 | **ERROR STATE.** `--assignee nobody-here` before any owner exists → the 400 that names `pd roster create <slug> --remit … --instructions …`, `POST /durable-agents`, and `pd roster list`; CLI exits 1 | SEEDED-FIXTURE, real CLI + real route |
| `planned-vs-actual.png` | 925 KB | 2400×6454 | Marking an item `done` with `--actual 4` against `est 3` → `completedAt` stamped, `variance: 1`; then reopening it to `now` → `completedAt` cleared while `actual` survives | SEEDED-FIXTURE, real CLI + real route |
| `roadmap-jira-items-walkthrough.gif` | 285 KB | 1200×700, 8 scenes, ~25 s | The whole sequence: refused unknown owner → `pd roster create` → item with owner+tags+estimate → planner-column list → exact tag filter → four typed links → mark done → the full card | Same captured bytes as the stills, re-composed |
| `roadmap-jira-items-walkthrough.webm` | 468 KB | 1200×700, VP8, 5 fps, 25.2 s | Same eight scenes as the GIF, for reviewers whose client prefers video | Same captured bytes as the stills, re-composed |
| `capture-session.json` | 19 KB | — | The raw captured session: 27 blocks of exact stdout/stderr (ANSI escapes intact) plus the indices each artifact slices | Raw evidence — diff any frame against it |

## How the images are made

1. The harness boots the real stack in-process and listens on a loopback port.
2. It drives a scripted sequence of **real** `pd` invocations (async child
   processes — a synchronous spawn would block the same event loop the harness
   daemon runs on, and every command would have captured a request timeout
   instead of the surface under test) plus a few direct route reads.
3. Each block's raw bytes are stored in `capture-session.json`.
4. The captured ANSI is converted to HTML by a small SGR parser in the script,
   laid out in terminal-window chrome that stamps branch + commit on every
   frame, and screenshotted with **headless** Chromium at 2× device scale.
5. Motion: the same composed frames are re-shot at a fixed 1200×700 and encoded
   to GIF (Pillow, per-scene hold times) and WebM (Playwright's bundled ffmpeg,
   `image2pipe` → `libvpx`).

## Known gaps — stated, not papered over

- **No live-daemon capture.** These are not screenshots of the operator's
  running Port Daddy daemon against their real registry; this container has no
  such daemon and reaching for one would have been fabrication. The code paths
  are identical; the data is seeded.
- **No GUI surface.** This PR changes the CLI, the routes and the SQL layer.
  The planner board / pd-console renders are downstream consumers and are
  unchanged by this diff, so nothing GUI is claimed here.
- **`docs/reports/roadmap-jira-items/detail-card.png` appears as a `media` link
  target inside `links-surface.png`.** That is deliberate — the link demo pins
  this PR's own evidence file — but the path is a link target string, not proof
  that the daemon read the file.
