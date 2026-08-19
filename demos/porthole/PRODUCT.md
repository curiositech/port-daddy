# Porthole as a product — capture · test · share · embed

*Brainstorm, 2026-08-19. Companion to PLAN.md (pipeline) and AUDIT-2026-08-18.md (why).
Thesis: the thing we built to fix our own demos is a standalone developer product AND a
portdaddy.dev growth loop. Same engine, four faces.*

## 0. What it is in one sentence each

- **Capture**: one command records any terminal session (colors, timing, TUIs) to an open
  format (asciicast) — `pd rec`.
- **Test**: recorded sessions become golden-transcript CI tests — demos that *cannot rot*
  because they ARE the tests — `pd rec test`.
- **Share**: one command turns a recording into a hosted, scrubbable, copyable link —
  `pd rec share` → `portdaddy.dev/p/<id>`.
- **Embed**: a zero-dependency web component / React component renders any cast as real,
  selectable DOM text — `<porthole-player src="…">`.

## 1. What capture actually covers (the operator's TUI question, answered)

A PTY recorder captures **every byte the program emits** — plain output, colors, spinners,
progress bars, vim, htop, tmux, fzf, lazygit, all of it. Capture is never the problem.
**Replay** is where programs differ, so Porthole has two replay modes, auto-detected:

| Mode | Trigger | Behavior | Wrap? |
|---|---|---|---|
| **Transcript** | linear output (no alt-screen) | append-only scrollback, full history, per-line copy | wrappable (mobile auto-wrap) |
| **Screen** | `ESC[?1049h` (alt-screen: vim/htop/fzf/tmux full-UI) | faithful fixed `cols×rows` grid, cursor-true, frame-stepped | **never** — wrapping a TUI is nonsense; scale font or pan instead |

A session that does both (shell → opens vim → quits → shell) renders as transcript blocks
with an embedded screen block — Warp-style segmentation via OSC 133 marks where available,
alt-screen enter/exit otherwise. tmux is just a program painting a grid: it replays fine in
screen mode; we don't try to understand its panes, we just show what it drew.

## 2. The CLI surface (sugar first)

```
pd rec                        # record this shell until ctrl-d; prints local file + preview URL
pd rec -c "pd status"         # record one command, auto-stop
pd rec --last                 # re-run & record the previous shell command (shell hook)
pd rec play demo.cast         # replay in-terminal
pd rec open demo.cast         # local player in browser (daemon serves it — no internet)
pd rec share demo.cast        # upload → portdaddy.dev/p/<id> (see §4) — copies URL to clipboard
pd rec gif demo.cast          # escape hatch: agg-rendered GIF for places that need pixels
pd rec test [--update]        # run porthole.yml scenarios, diff transcripts (see §3)
```

Defaults that make it bulletproof:
- pinned `--window-size` (default 100×28) so no resize events ever corrupt replay;
- **secret scrub before share**: regex + entropy scan of the reconstructed transcript
  (`$HOME`, tokens, emails, IPs) → interactive redact list, `--yes-i-checked` to force;
  input events are NEVER captured (no `-I`);
- idle clamp 1.5s (honest `dtRaw` kept in the file);
- non-TTY safe: `pd rec -c` works headless in CI;
- degrades gracefully: if `asciinema` binary exists use it, else built-in PTY recorder —
  zero required dependencies.

## 3. Testing: demos that cannot rot

`porthole.yml` at repo root:

```yaml
scenarios:
  quickstart:
    fixture: pd demo seed quickstart      # deterministic seeded harbor
    run: [pd status, pd claim demo:api:main, pd release demo:api:main]
    mask:
      - /pid \d+/                          # normalize volatile output
      - /up \d+[smh]/
      - /:\d{4,5}/
    require: ["DAEMON CONFIRMED", "released demo:api:main"]
    forbid:  ["Unknown command", "✗", "ERROR", "/Users/"]
```

`pd rec test` records each scenario in a PTY, reconstructs the **plain-text transcript**
through the VT (so `\r`-spinners settle to their final frame — you diff what a human saw,
not escape bytes), applies masks, and diffs against the committed golden. Failure emits a
side-by-side HTML diff artifact. `--update` re-records goldens deliberately.

Consequences:
- The committed goldens are **reviewable in PR diffs** — a demo change is a text diff.
- The site's embeds are built from the same casts the tests just validated → **marketing
  that auto-updates from test runs and fails CI instead of lying**. This retires every
  failure mode in AUDIT-2026-08-18.md structurally, not procedurally.
- It's also just… a great snapshot-testing tool for ANY CLI. That's the wedge (§5).

## 4. Share: the growth loop

`pd rec share` uploads the cast; portdaddy.dev renders it in the Porthole player on a
capability URL (reuse ADR-0101 run-page infra — same pattern, new payload type).

- **Anonymous / no account**: first **30 seconds** play free, scrubbable; player then shows
  "⚓ full 3m12s recording — free account" gate. 7-day retention, 512KB cast cap.
- **Free account**: 5-minute casts, 50 stored, permanent links, unlisted/public, theme picker,
  **README embed kit** (GitHub strips JS, so: auto-generated SVG poster of the payoff frame +
  link — the poster is still real text in the SVG, and it links to the live player).
- **Team (paid)**: private casts, org namespace, custom domain, retention controls, the CI
  test runner reporting into PRs, and "living docs" — a named cast slot (`/p/acme/quickstart`)
  that CI overwrites on every release so embedded docs are always current.

Every shared porthole is a Port Daddy ad with a "recorded with pd rec" chrome line — the
same loop VHS runs for Charm, but the artifact is *interactive and copyable*, which GIFs
and even asciinema.org embeds aren't (no scrollback there).

## 5. Packaging / go-to-market

- `@portdaddy/porthole` (npm): the player as a **web component** (`<porthole-player>`) +
  React wrapper; zero runtime deps; ~15KB gz target. MIT. The format stays asciicast —
  we win on player + pipeline, not lock-in.
- `porthole` brew formula = the recorder/test-runner (thin shim over `pd rec` so the tool
  is usable without adopting the daemon — the daemon upsell comes from share/fixtures).
- Launch narrative: **"Your CLI demos are lying to you"** — the audit is the blog post
  (anonymized): fabricated terminals, 18-line amputations, errors on camera. Then: record →
  test → share in 90 seconds, itself shown as a porthole. HN-shaped.

## 6. Edge cases we anticipate (bullet-proofing checklist)

wide chars/emoji (Unicode 11 widths, skip width-0 trailing cells) · OSC 8 links (render as
real `<a>` — a thing GIFs literally cannot do) · huge outputs (cap lines with an honest
"── 4,000 lines elided ──" marker; never silent) · `NO_COLOR`/plain runs (player themes
still legible) · v2/v3 casts (both parsed) · reduced-motion (jump to final transcript) ·
copy fidelity (trimRight, join soft-wrapped lines on copy) · CRLF/`\r` spinners (settle via
VT) · seeking (idempotent line-snapshot replay) · self-host (single static HTML export —
`pd rec export --html` produces exactly the file this prototype is).

## 7. Open questions for the operator

1. Name check: `pd rec` vs `pd porthole` as the command (sugar says `rec`; brand says porthole).
2. Free-tier knobs (30s/5min/50 casts) — gut-check the numbers.
3. Does share ship inside pd 3.29 as an experiment, or wait for the standalone `porthole` brew tap?
4. Screen-mode (alt-screen TUI) player: v1 requirement or fast-follow? (Transcript mode
   covers all current site demos; screen mode unlocks "record vim/tmux" virality.)

## 8. Theming & distribution norms (reskinning as a first-class feature)

People WILL reskin this for their own sites; design for it with the headless + tokens + slots
architecture the ecosystem converged on:

1. **Headless engine** (Radix/TanStack norm): `@portdaddy/porthole-core` = VT + transcript +
   playback clock, framework-free; `usePorthole(cast)` hook exposes state (lines, time,
   playing, wrapped) + actions (play, seek, setSpeed). Full-custom players build on the hook.
2. **CSS custom properties are the public theming API**: every themable value is a documented
   `--ph-*` token (`--ph-0..15`, `--ph-fg/bg`, `--ph-chrome`, `--ph-font`, `--ph-radius`)
   scoped to the root; our dark/light palettes are just the default token sets. `theme` prop
   takes a preset name, a token object, or `"faithful"` (the palette recorded in the cast
   header — an honesty feature competitors can't copy). Prototype already proves this: the
   ◐ toggle is a token swap, and a host page stamping `data-theme` drives every embed.
3. **State as data attributes, structure as parts**: `data-playing/wrapped/theme/following`
   on the root; `::part(titlebar|line|controls)` on the web component; `classNames` slot
   object on the React wrapper. Internal class names stay private; tokens + data-attrs +
   parts are the semver-stable styling contract.
4. **Zero styling runtime**: one plain CSS file, skippable (`unstyled`); no CSS-in-JS, no
   Tailwind requirement; ESM; SSR renders the final transcript as static markup (SEO +
   no-JS fallback) and hydrates into the player; `<video>`-shaped imperative ref.
5. **shadcn-model option**: publish the default skin as copy-paste registry source so teams
   own their chrome while the engine stays an npm dependency that keeps updating.

Opinionated default skin is fine — the sin is opinion without exits.

## 9. Flight recorder — retrospective bug replay (operator question, answered: yes)

CLI apps can absolutely use this for retrospective bug reporting, and it may be the
single most viral capability:

- **Shell-level**: `porthole enable-flight` installs a shell-init hook that keeps a
  rolling ring buffer (default: last 15 min or 2MB of PTY bytes + timestamps, in a
  0600 local file, never uploaded). After something breaks: `porthole save-last 10m`
  materializes the buffer as a cast; secret-scrub runs before any `share`.
- **App-level SDK**: a CLI author embeds the recorder in-process (it is just bytes +
  monotonic timestamps — trivial overhead). On crash/panic the app prints:
  "replay of the last 5 minutes saved to ./crash-1234.cast — attach it with
  `porthole share --issue`". Sentry Session Replay, but for terminals, and the
  artifact is an open text format the maintainer can grep.
- **Why replay beats logs for bugs**: the maintainer sees *order and timing* — the
  flag the reporter actually typed, the spinner that hung for 40s, the error that
  flashed and scrolled away. Scrub at 2×, pause on the failure frame, copy the exact
  command. "Steps to reproduce" becomes a link.
- **Trust boundaries**: local-first by default; ring buffer never leaves the machine
  without an explicit share; input keystrokes are never captured; scrub is mandatory
  interactive on first share to a public target.

## 10. Positioning (competitive cartography, 2026-08-19)

Full research in PR discussion. Load-bearing corrections and rulings:
- **Do not lead with "selectable text"** — asciinema's player is DOM text and advertises
  copy-paste. The empty positions on the map are: (1) **scrollback in a shared replay**
  (zero products), (2) **retroactive flight-recorder capture** (zero terminal-native
  products; Sentry proved the demand shape), (3) **promoting a real session into a CI
  assertion** (VHS golden-tests scripts, never captures), (4) hosted+embeddable+tested
  in one artifact, (5) line-level deep links, (6) hosted redaction.
- **Frame: "the terminal's flight recorder."** Taglines: "Rewind your terminal." /
  "Demos that can't rot." / "The whole session. Every line. One link."
- **Sequencing:** scrollback+search+share first (demoable wedge) → flight recorder
  (moat) → golden-transcript CI (monetization). Do NOT enter via agent-JSONL replay —
  three entrants in six months (claude-replay 815★, AgentReplay, AGR); our PTY-level
  capture out-scopes them but arguing there wastes the launch.
- **Tiers (evidence-fitted):** Free = unlimited local + 7-day anonymous shares
  (asciinema's own archival precedent) + 3 permalinks signed-in; Pro ~$9/mo = permanent/
  private links, search, deep-links, custom domains; Team ~$10/seat = org library, SSO,
  CI runner. CI is the paid wedge; storage is the COGS trap (LogRocket lesson). Don't
  gate privacy hostilely (CodeSandbox/Excalidraw norm).
- **VHS relationship:** complement, not enemy — VHS scripts demos; Porthole records
  sessions; "record once, assert forever" flanks it where tapes drift from reality.
- **⚠ Naming risk:** github.com/subh05sus/porthole is an existing terminal *port-management*
  tool (kill switch/service viewer TUI) — "porthole under Port Daddy" may read as another
  port utility, fighting the flight-recorder frame. Operator decision needed before brand
  equity accrues to portholed.com.
