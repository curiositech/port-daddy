# Multiplayer Spatial Input for the PD Swarm

**Status:** research / design proposal — does not modify code.
**Audience:** Erich, and whichever fleet agent picks up "swarm-input" as a project.
**Question:** how do humans drop spatial / contextual signals into an AI agent
swarm from the surfaces they're already in (localhost preview, markdown docs,
screenshots, dashboard, file tree) so multiple humans can vibe-code alongside
the swarm without going through structured chat?

Author bias up front: PD already has the substrate (pheromones with decay,
tuple space with pattern subscribe, harbors with auth, feedback as a typed
tuple). The work isn't inventing primitives — it's binding *human surfaces*
into those primitives without inventing a sixteenth coordination mechanism.

---

## 1. Prior art — annotate-the-thing UX

One-line each, with the *primitive* I'm stealing in italics.

- **Loom timestamped comments** — viewers click on the playhead and drop a
  reaction; comment is anchored to the millisecond. *Anchor = scalar coordinate
  on a 1-D substrate.* https://www.atlassian.com/software/loom
- **Figma frame-anchored comments + cursor chat** — comment pins live in
  canvas space; if you select inside a top-level frame the pin reflows with
  the frame. Cursor chat is ephemeral and dies on blur. *Pin = (frame, x, y);
  cursor chat = ephemeral presence, no persistence.*
  https://help.figma.com/hc/en-us/articles/360039825314 ·
  https://help.figma.com/hc/en-us/articles/4403130802199 ·
  https://mskelton.dev/blog/building-figma-multiplayer-cursors
- **Linear inline comments and threaded comments (2023-12)** — anchored to the
  exact passage highlighted; replies stay attached. *Anchor = text range,
  threads on one parent.* https://linear.app/changelog/2023-12-06-editor-improvements
- **GitHub PR review comments** — anchored to `(path, position)` in the diff;
  re-anchor / mark outdated when the diff moves. *Anchor = file + line, with
  staleness signal.* https://github.com/orgs/community/discussions/144938
- **Storybook + Chromatic visual review** — per-story approve / reject in a
  dashboard; rejected baselines block merge. *Decision primitive: accept |
  deny per atomic unit.* https://www.chromatic.com/storybook
- **LogRocket / Sentry session replay** — annotations live on a session
  timeline beside DOM events, errors, console. *Annotation co-located with a
  reproducible event stream.* https://docs.logrocket.com/docs/session-replay
- **Cursor `@file` / `@symbol` / `@folder` mentions** — type `@` to inject a
  resolved chunk of code into the prompt before the LLM sees it. *Anchor = a
  symbol the toolchain understands; resolved at send time, not at run time.*
  https://docs.cursor.com/context/@-symbols/@-files
- **Aider `/voice`** — push-to-talk, transcribed, fed in as if typed.
  *Voice = ordinary text input with a different keyboard.*
  https://aider.chat/docs/usage/voice.html
- **Crit** — feedback-loop layer that sits between human reviewer and Claude
  Code / Cursor / Codex / Aider / Cline / Windsurf. Worth watching as a
  competitor / collaborator. https://crit.md/
- **BugHerd / Marker.io** — point at a region on a live web page; the tool
  captures CSS selector + XPath + text snippet + screenshot + browser /
  resolution metadata, and falls back through selectors in order if the page
  has changed. Annotation rect stored as percentages of the anchor's bounding
  box, not pixels, so it survives reflow. *Lesson: redundant anchors > one
  brittle anchor.* https://bugherd.com/website-annotation-tool ·
  https://marker.io/
- **click-to-component / LocatorJS / vite-plugin-react-click-to-component** —
  Option+Click on a DOM element, opens the source file at the right line in
  your editor. Uses React fiber's `_debugSource` (Babel `@babel/plugin-transform-react-jsx-source`)
  + Vite launch-editor middleware. *This is the entire dev-only DOM-to-source
  resolver we'd otherwise need to write.* https://github.com/ericclemmons/click-to-component ·
  https://www.locatorjs.com/
- **Excalidraw / Miro / Whimsical multiplayer cursors** — cursor and selection
  are *ephemeral* (presence-channel, not in the document CRDT). Document
  edits go through CRDT. *Lesson: separate presence from persistence.*
  https://miro.com/compare/miro-vs-excalidraw/
- **CleanShot X / Snagit screen-region capture + annotate** — drag-rect → in-place
  annotate → ship to URL/clipboard. CleanShot does OCR on the region. *Lesson:
  capture and annotate live in one modal flow, then *exit* — the user is not
  trying to stay in the tool.* https://cleanshot.com/features
- **Discord screen-share annotation arrows** — ephemeral, drawn on top of the
  shared stream, fade. *Lesson: "draw at the thing" without committing to
  persistent state is a real mode.*
- **BrowserStack live screenshot annotation** — region rect + comment on a
  rendered page across browsers. *Lesson: works because the page is
  reproducible, not just live.*
- **Birdwatcher / Pesticide** — CSS overlay debug tools that paint outlines on
  every element. Not annotation tools per se; useful as a model for
  *injecting* an interactive overlay without polluting the rendered DOM.
  https://pesticide.io/
- **Storybook + addon-controls / addon-a11y / Chromatic addon panel** —
  approve / reject from inside Storybook itself, not a separate dashboard.
  *Lesson: the review surface should be the thing being reviewed.*
- **Yjs as CRDT substrate for AI agents-as-peers** — recent argument that
  agents are just additional CRDT peers; humans and bots share one merge
  model. *Adjacent to PD's pheromone+tuple model — relevant if we ever want
  full live-collab editing rather than fire-and-forget signals.*
  https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs

Themes that recur:

1. **Redundant anchors.** Selector + XPath + text snippet + screenshot bbox —
   one of them survives reflow. Single-anchor systems rot.
2. **Persistence vs presence.** Cursors / cursor-chat are ephemeral; pinned
   comments are durable. Conflating them is how Slack and Notion both end up
   feeling sticky.
3. **Approve/deny per atomic unit.** Chromatic-style "accept this story" is
   the cleanest UX for "this output is good." We want that for swarm output.
4. **The review surface IS the work surface.** Storybook addons, Linear
   inline comments, Figma pins — nobody opens a second tool to comment.

---

## 2. Modality → PD primitive map

PD primitives in scope, with one-line semantics each:

- **`tuples.out(fields, {harbor, ttlMs, writtenBy})`** — durable, queryable,
  pattern-subscribable typed event. The bus.
- **`pheromones.spray(table, id, key, strength)`** — graded signal on an
  existing PD entity (project, session, file claim row, agent), evaporates
  over time. Good for *gradient pressure*.
- **`feedback.drop({slug, summary, surface, severity, source: 'human', ...})`**
  — already exists, already typed, already harvestable by Cartographer.
  Source field exists explicitly for humans.
- **`episodic_memory`** — durable promoted story beat. Search-indexed via
  graph edges + semantic aliases.
- **`agent_inbox`** — explicit directed message to a named agent.
- **`channels` (messaging)** — broadcast pub/sub for working groups.

Now the map. Defended writes per modality.

| Modality | Trigger | PD write | Why this and not that |
|---|---|---|---|
| DOM lasso on localhost preview | mouse box → comment | `feedback.drop({surface:'web:<file>:<L1-L2>', source:'human', ...})` + tuple `['ui:annotation', annId, {selector, xpath, text, screenshot_blob_id, file, lines, comment, droppedBy, harbor}]` | feedback gives Cartographer hooks for free; tuple gives raw spatial detail for agents that want it. Don't use pheromones — DOM annotations are *facts*, not gradients. |
| Markdown highlight in docs (cmd-K) | text select + key | `feedback.drop({surface:'doc:<path>:<L1-L2>', source:'human'})` + tuple `['doc:annotation', annId, {path, lines, quoted_text, comment}]` | Symmetric with DOM. The quoted text is a redundant anchor like Marker.io's text snippet — robust to small line drift. |
| Screenshot+region from FleetBar | screen capture | tuple `['screen:annotation', annId, {bbox, image_blob_id, ocr_text, comment, app:'<process>', window_title, droppedBy, harbor}]` + (optional) `feedback.drop` if the user typed text | The screen capture often points at *no file* (e.g., a Slack DM, a paper PDF, a terminal). Don't try to resolve to file/line; just preserve image + OCR + comment. Agents can reason from the image. |
| File-tree node click in dashboard | click + annotate | `pheromones.spray('projects', <project>, 'attention:<file>', strength)` + tuple `['file:annotation', ...]` if a comment was attached | Pheromone is *exactly right* here — "I'd like the swarm to look at this file more" is graded interest, not a fact. Decay handles "I changed my mind in 15 minutes." |
| Voice memo on a session | mic | tuple `['voice:memo', memoId, {transcript, audio_blob_id, duration, session_id, harbor}]` + episodic_memory entry if length > N seconds | Tuple gives subscribe-ability to active agents; episodic preserves the long ones. Don't use feedback — voice notes are too noisy to send to Cartographer unfiltered. The user can promote one. |
| "Apply this to all front-end agents" broadcast | chooser → message | channel publish on `harbor:<h>:role:frontend` + agent_inbox to each currently-active matching agent | Channels for the standing group; inbox for guaranteed delivery to current members. Don't tuple-broadcast — pattern subscribers are best-effort and TTL out. |
| Cursor / mouse position (presence) | mousemove | **nothing persistent.** Live websocket fanout on a `presence:<harbor>:<surface>` channel, no DB write | Figma / Miro lesson: presence is not a fact. Persisting it is how you DDoS your own tuple table. |
| Emoji-react on an agent's output | click | tuple `['react', targetTupleId, {emoji, by, at}]` with short TTL (24h) | Light, fades. Don't promote to feedback unless 3+ humans react negatively → that's a Cartographer rule, not a primitive. |
| "I'm working in this file" claim (human) | open file in editor | the existing `session_files` claim with `claimed_by: 'human:erich'` | Reuse, don't invent. Humans should claim files exactly like agents do, so the swarm respects them. |

Notable decisions and why:

- **Two writes per annotation is fine and good.** `feedback.drop()` for the
  Cartographer pipeline, `tuples.out(['ui:annotation', ...])` for raw spatial
  fidelity. They're cheap. The alternative (extend `feedback` schema with
  optional `selector`/`bbox`/`blob_id` columns) couples Cartographer to UI
  details forever. Two writes, one fact.
- **Pheromones only for graded interest.** "Look here more" / "this file is
  hot." Not for "I said X about Y" — that's a fact with a comment.
- **TTL aggressively.** A human annotation that didn't get harvested or
  harvested-and-resolved in 30 days is signal rot. PD's feedback module
  already defaults to a 30-day TTL — keep it.
- **`harbor` is the unit of multi-tenant isolation,** matching the rest of PD.

---

## 3. Multi-player concerns

What the prior-art tools actually do, and what we should adapt for code.

### 3a. Two humans annotate the same region

- **Figma:** both pins exist side by side. No merge. The visual cluster makes
  it obvious there's a discussion in that region. Threads happen *under* a
  pin, not across pins.
- **Linear inline comments:** overlapping highlights coexist; the UI shows the
  ribbon with multiple authors.
- **GitHub PR comments:** multiple comments on the same line are stacked
  threads.

**Adapt:** **don't merge.** Two `ui:annotation` tuples on overlapping regions
is normal, not a bug. The dashboard renders them as a cluster. If the *same
human* annotates the same region twice within N seconds, treat as edit and
update the same tuple (use `take` + `out` since tuples are immutable).

### 3b. Human signal vs agent signal — same namespace or different?

Figma doesn't distinguish — designers, devs, and PMs all comment with the
same primitive, distinguished by avatar. GitHub differentiates only by
reviewer-vs-author UI affordance.

**Adapt:** same primitive, distinguished by `source` field + `droppedBy`.
PD's `feedback` already has `source: 'agent' | 'human' | 'mcp' | 'cli' |
'unknown'`. Keep using it. Both kinds of pheromone *can* spray on the same
key — that's fine, that's how the gradient gets reinforced. If you want to
distinguish gradient kinds, use namespaced keys: `attention:human:<file>` vs
`attention:agent:<file>`, then aggregate at sniff-time.

### 3c. Privacy across harbors

Harbors are PD's multi-tenant unit. An annotation written with
`harbor: 'port-daddy:fleet'` is invisible to a different harbor's
subscribers, *as long as the route guard enforces it.* PD already has
`coordination-route-guard.ts` and `coordination-acl.ts` — those need to
cover the new annotation routes.

**Adapt:**

- Every annotation tuple MUST carry a harbor field. Default to the caller's
  active harbor; reject if absent.
- Screenshot blobs are the leak risk. Bind the blob_id ACL to the same
  harbor. Treat blob storage as a separately-ACL'd resource (it kind of is,
  via `lib/blob.ts`).
- For genuinely private machines (one operator, no shared daemon) the harbor
  is effectively the operator's identity and nothing to leak. For shared
  Curiositech-style daemons, the harbor split is doing real work.

### 3d. Audit trail for human-originated signals

Figma stamps every comment with author + timestamp. Linear too. GitHub PR
review is the gold standard (every line comment is reviewer + commit SHA at
time of comment).

**Adapt:** `droppedBy` already exists on `feedback`. For the tuple form,
make it required, not optional. Format: `human:<identity>` (matching the
existing `human:<name>` convention used in session ownership). Optional
secondary metadata: `device`, `surface`, `git_sha_at_annotation`. The last
one is high-leverage — it lets an agent that reads the annotation 3h later
diff "what the human was looking at" vs "what HEAD is now," which is exactly
the GitHub PR staleness signal.

---

## 4. Concrete proposal: FleetBar / dashboard "swarm-input" mode

Walking the flow. Three viable entry points, ranked by build cost.

### Entry point A: FleetBar screen-region capture (cheapest, no browser)

```
                                        ┌────────────────────────────┐
                                        │   ▾ FleetBar menu          │
                                        │                            │
                                        │   ★ Spray feedback…  ⌘⇧F   │
                                        │   ✎ Annotate region…  ⌘⇧A  │ ← new
                                        │   ▶ Active sortie: ...     │
                                        │   …                        │
                                        └────────────────────────────┘
                                                 │
                            ⌘⇧A  ────────────────┘
                            cursor → crosshair
   ┌────────────────────────────────────────────────────────────────┐
   │                                                                │
   │   ╔═══════════════════════╗     ← drag selection rect          │
   │   ║                       ║                                    │
   │   ║  (anything on screen) ║                                    │
   │   ║                       ║                                    │
   │   ╚═══════════════════════╝                                    │
   │   ┌──────────────────────────────┐  ← inline annotate popover  │
   │   │ to: front-end agents   ▾     │     (CleanShot-style)       │
   │   │ ┌──────────────────────────┐ │                              │
   │   │ │ this gradient is muddy,  │ │                              │
   │   │ │ contrast fails on the    │ │                              │
   │   │ │ tab labels               │ │                              │
   │   │ └──────────────────────────┘ │                              │
   │   │ severity: ◯ low  ● med  ◯ hi │                              │
   │   │  [ Send to swarm ]   [ Esc ] │                              │
   │   └──────────────────────────────┘                              │
   └────────────────────────────────────────────────────────────────┘
```

Mechanism (Swift / FleetBar app):

1. Global hotkey ⌘⇧A → enter capture mode (CGEvent tap; AXUIElement to read
   `window_title` of frontmost app for context).
2. Drag-rect → `CGWindowListCreateImage` for the bbox.
3. Run OCR via Vision framework on the captured CGImage (free, on-device, ~50ms).
4. Show small inline popover: comment field, severity, target chooser
   (defaults to "all active agents in current harbor").
5. On submit:
   - Upload image to PD blob store via existing `POST /blob` → get `blob_id`.
   - `tuples.out(['screen:annotation', uuid, {bbox, blob_id, ocr_text, comment, app, window_title, droppedBy:'human:erich', harbor, severity}])`.
   - If comment is non-empty, also `feedback.drop({slug, summary:comment, surface:'screen:'+app, severity, source:'human', droppedBy})`.
6. PD daemon's tuple subscribers fanout to any agent subscribed to
   `['screen:annotation', '*', '*']` in the harbor. Agents see it in their
   next turn's ambient context.

Design choices defended:

- **Why FleetBar first?** Already a menubar app, already in PD's distribution
  story, already has access to native screen capture. Zero browser plumbing.
- **Why OCR?** Most "feedback on a screenshot" is feedback on *text* in the
  shot. OCR gives an agent something to grep on without doing image
  understanding.
- **Why a target chooser?** Without it the user has to type "@front-end" in
  the comment. Worse UX, worse routing, harder to deprecate. With it, future
  routes are a dropdown change.
- **Why ⌘⇧A?** ⌘⇧4 is macOS screenshot, ⌘⇧5 is the system capture HUD. ⌘⇧A
  is free on default macOS and reads as "Annotate."

### Entry point B: browser overlay on localhost preview (highest leverage)

The user's "drawing on DOM" instinct. Bigger build, but compounding payoff.

```
   ┌────────────────────────────────────────────────────────────────┐
   │ http://localhost:3000/  ▾   [PD swarm-input: ON]   alt+S to off│
   ├────────────────────────────────────────────────────────────────┤
   │                                                                │
   │   ┌──────────────┐  ┌──────────────────────┐                   │
   │   │              │  │                      │                   │
   │   │   Sidebar    │  │  ┌────────────────┐  │                   │
   │   │              │  │  │  Card Title    │  │                   │
   │   │              │  │  │  ─────────────│  │                   │
   │   │              │  │  │  body text     │  │   ← hover any     │
   │   │              │  │  │┌──────────────┐│  │     element →     │
   │   │              │  │  ││ button       ││  │     outline       │
   │   │              │  │  │└──────────────┘│  │                   │
   │   │              │  │  └────────────────┘  │                   │
   │   │              │  │                      │                   │
   │   └──────────────┘  └──────────────────────┘                   │
   │                                                                │
   │   ┌─────────────────────────────────────────────────────────┐  │
   │   │  src/components/Card.tsx:42-58                          │  │
   │   │  ┌─────────────────────────────────────────────────────┐│  │
   │   │  │ this padding is too tight, also the focus ring is  ││  │
   │   │  │ getting clipped by the card border                 ││  │
   │   │  └─────────────────────────────────────────────────────┘│  │
   │   │  to: ● working group  ◯ specific agent  ◯ pheromone    │  │
   │   │  severity: ◯ low  ● med  ◯ hi                          │  │
   │   │  [ Send (⌘↵) ]   [ Esc ]                                │  │
   │   └─────────────────────────────────────────────────────────┘  │
   └────────────────────────────────────────────────────────────────┘
```

Mechanism — see §5 for the full dev-tools-overlay sketch. Short version:

1. Bookmarklet or browser extension or vite-plugin injects a small overlay
   script. (Bookmarklet is the zero-install MVP; extension is the durable
   form.)
2. Toggle on via `alt+S`. Hovering paints React DevTools-style outlines.
3. Click selects; drag selects a rect; `cmd+click` selects multiple.
4. Resolve the selected element to `(file, line_start, line_end)` via React
   fiber `_debugSource` (works for any framework using
   `@babel/plugin-transform-react-jsx-source`, which is the default in CRA,
   Next, Vite-React, Remix). Fall back to CSS selector + XPath + text snippet
   à la Marker.io.
5. Inline comment popover.
6. On send → POST to `http://localhost:9876/annotations` (PD daemon):
   - `feedback.drop({surface:'web:<file>:<L1-L2>', source:'human', ...})`
   - `tuples.out(['ui:annotation', uuid, {selector, xpath, text, file, lines, comment, screenshot_blob_id, droppedBy, harbor}])`
   - `pheromones.spray('projects', <project>, 'attention:<file>', 0.6)` —
     bump the file's attention so any swarm decision "what should I work on"
     leans toward it.
7. PD streams the new tuple to subscribers; current agents in that file see
   it on next-turn.

### Entry point C: dashboard file-tree node click (already close to free)

The web dashboard already shows projects and files. Add a context-menu /
right-click → "Annotate this file…" → small modal → drop feedback +
pheromone. Build cost: a few hundred lines of dashboard code, no native /
extension work.

### Recommended sequencing

1. **C first** — dashboard file annotation. Validates the schema, exercises
   the feedback+tuple double-write, no native code.
2. **A second** — FleetBar region capture. Adds screenshot + OCR path, blob
   storage integration, target chooser primitive.
3. **B last** — DOM overlay. Highest leverage but highest build cost. The
   first two will have shaken out the route-guard, harbor scoping, blob ACL,
   and dashboard-renderer story by the time we get here.

---

## 5. The "drawing on DOM" angle — MVP scope

### 5a. How dev-tools overlays inject and remove themselves

- **React DevTools / Vue DevTools** run as browser extensions; they
  communicate with a page-injected `__REACT_DEVTOOLS_GLOBAL_HOOK__` that
  React mounts to, when present. They paint highlight rects in a top-level
  injected `<div>` on top of the page (often inside a shadow root to escape
  page CSS). They never modify page state; remove the overlay by unmounting
  the `<div>`.
- **Pesticide / Birdwatcher** are pure CSS — `* { outline: 1px solid; }` —
  injected by extension or bookmarklet. Removed by ripping the
  `<style>` tag back out.
- **click-to-component / LocatorJS** inject an event listener that, on
  Option+click, reads the React fiber from the clicked DOM node, walks up
  until it finds `_debugSource`, and posts a `launch-editor` URL to the
  Vite/CRA dev server (e.g., `http://localhost:3000/__open-in-editor?file=...`).
  https://github.com/ericclemmons/click-to-component ·
  https://github.com/ArnaudBarre/vite-plugin-react-click-to-component

### 5b. How to map DOM → source

The dev-only path (good enough for MVP):

1. From the clicked DOM node, find its React fiber via the
   `__reactFiber$<random>` / `__reactProps$<random>` prop on the DOM node
   (React puts one there in dev builds).
2. Walk up the fiber tree until `fiber._debugSource` is set —
   `{fileName, lineNumber, columnNumber}`. That field is populated by
   `@babel/plugin-transform-react-jsx-source` (default in CRA, Vite,
   Next.js, Remix, Expo).
3. `fileName` is an absolute path on disk in dev; in production builds it
   isn't set at all. **MVP is dev-only.** That's fine — the vibe-coding
   surface IS the dev preview.

For non-React frameworks:

- **Vue**: Vue DevTools exposes a similar `__VUE_DEVTOOLS_GLOBAL_HOOK__`
  with component → source mapping when running `@vue/babel-plugin-jsx` or
  Vue SFC source-map output. Same shape, different hook.
- **Svelte**: `svelte-loader` / `@sveltejs/vite-plugin-svelte` emits
  `data-svelte-h` attrs and source-maps; you'd resolve via the source-map
  rather than a fiber.
- **Plain HTML / vanilla**: source-map only; or fall back to Marker.io-style
  redundant anchors (CSS selector + XPath + text snippet + bbox).

### 5c. OSS scaffolds worth reading before building

- **click-to-component** (https://github.com/ericclemmons/click-to-component) —
  the React-fiber → source resolver in <300 LOC. Vendor it; do not depend.
- **LocatorJS** (https://www.locatorjs.com/) — chrome extension version, more
  framework adapters, decent shape for a multi-framework MVP.
- **Marker.io self-hosted clone writeup** (https://dev.to/neosianexus/i-built-a-self-hosted-alternative-to-markerio-heres-how-it-works-under-the-hood-2i7k) —
  documents the redundant-anchor + percent-of-bbox strategy. Direct steal.
- **crxjs / chrome-extension-tools** (https://github.com/crxjs/chrome-extension-tools)
  — vite-based extension scaffold with HMR and shadow-DOM-isolated content
  scripts. Best modern starter.
- **excalidraw rough.js multiplayer cursor approach** —
  https://mskelton.dev/blog/building-figma-multiplayer-cursors — if we ever
  want presence cursors (we should, eventually) this is the playbook.

### 5d. Constraints

- **Dev / staging only at MVP.** Source maps + fiber debug source are not in
  prod builds, and you don't want PD writing tuples about a customer's prod
  page anyway. Gate by `NODE_ENV !== 'production'` plus a
  `?pd-swarm-input=1` opt-in. Refuse to inject if the page is not on
  `localhost`, `127.0.0.1`, or `*.local` unless explicitly allowed in
  FleetBar prefs.
- **Framework support priority:** React → Vue → Svelte → vanilla. React
  covers ~80% of Curiositech surfaces. Vanilla via Marker.io-style
  redundant anchors (no source resolution) is still useful — agents can read
  the screenshot.
- **Latency budget.** Annotation → agent's next turn. The agent's poll
  interval is the dominant term (seconds). The PD write itself is <50ms
  (tuple insert + sqlite). So the latency floor is "agent's next loop
  iteration." If we want sub-second, add an `agent_inbox` push so subscribed
  agents wake immediately.

### 5e. MVP scope (suggested)

Minimum thing that proves the loop:

1. Bookmarklet that, when invoked on a `localhost:*` page:
   - Toggles a global hover-outline mode (Pesticide-style + selection rect).
   - On click, resolves the element via React fiber `_debugSource`. Falls
     back to selector+xpath+text+bbox.
   - Pops a comment popover.
   - On send, POSTs to `http://localhost:9876/annotations` with
     `{surface, file, lines, selector, xpath, text, bbox, comment,
     droppedBy, harbor}`.
2. New PD route `POST /annotations` (in `routes/`) that does the
   `feedback.drop` + `tuples.out` + `pheromones.spray` triple-write atomically.
3. New tuple pattern subscription baked into the default agent harness
   prompt-builder: "if there are any unharvested `ui:annotation` tuples for
   files you've claimed, surface them now."
4. Dashboard panel showing the live stream of human annotations, with
   per-row "harvest" and "ignore" actions (Chromatic-style accept/deny).

Explicitly out of scope for MVP:

- Browser extension packaging (bookmarklet is fine to start).
- Multi-framework support (React-only).
- Production builds.
- Presence cursors / cursor chat.
- CRDT-style collaborative edits.

---

## 6. Tradeoffs and open questions for Erich

Decisions I'm pretty sure about, and decisions I want your call on.

### What I'd just build

- **Double-write per annotation** (`feedback.drop` + `tuples.out`). Cheap,
  explicit, future-proof.
- **Source field convention** (`'human'`, `'agent'`, etc. — PD already has this).
- **Pheromone for "attention" only, never for facts.**
- **Harbor as the privacy boundary, blobs ACL-scoped to harbor.**
- **Dev-only DOM overlay, gated by hostname + env flag.**
- **Sequencing: dashboard click → FleetBar region → DOM overlay.**

### What I want your call on

1. **Bookmarklet vs extension for DOM overlay MVP.** Bookmarklet is zero
   install but the user has to drag it to their bookmarks bar once. Extension
   is more invasive to install but persistent and can hold credentials. My
   weak preference is bookmarklet for the proof, extension for the v2.

2. **Should DOM annotations spray a pheromone, or only drop feedback +
   tuple?** Sprayng a pheromone makes "operator was just looking at this
   file" influence agent file selection. That's powerful but risks the
   swarm thrashing toward whatever the human last clicked. I lean *yes,
   with low strength (0.3-0.5),* but you might want *no, only when explicit*.

3. **Should screenshot/OCR live in FleetBar (Swift, Vision framework) or
   in a separate `pd capture` CLI (Tesseract, cross-platform)?** Swift +
   Vision is faster and prettier but Mac-only. CLI is portable but worse UX.
   For Curiositech (Mac-shop) the Swift answer dominates; for "any
   developer," the CLI answer matters more.

4. **Voice memos — episodic, tuple, or both?** Voice is *high-noise.* If
   we promote every memo to episodic, episodic memory becomes a junk drawer.
   If we only tuple them, the long-tail ones evaporate. My weak preference:
   tuple short ones (TTL 24h), episodic only on explicit "save this."

5. **How aggressively should the swarm consume annotations?** Two modes:
   - **Subscriber mode:** agents subscribe to `['ui:annotation', '*', '*']`
     in their harbor and the daemon pushes new tuples to them. Snappy, but
     interrupts mid-turn agents.
   - **Polling mode:** agents read `feedback.list({status:'open'})` at the
     start of each turn. Steady but laggy.
   Likely answer: polling by default; subscriber mode opt-in per agent (so
   you can have one "lookout" actor that wakes the swarm on critical-severity
   annotations).

6. **Do we surface annotations on the dashboard timeline ALONGSIDE agent
   actions, or in a separate "Human Input" panel?** Linear and Figma both
   inline them in the same feed — the visual cue is just the avatar. PD's
   dashboard currently has an Activity feed and a Feedback panel; merging
   them is more honest but might be noisy. My weak preference: merged feed
   with a filter chip "Source: humans only / agents only / both."

7. **`pd whois <query>` (the talent-phonebook idea in your memory) — should
   annotations FEED that?** If `pd whois 'tailwind contrast'` ranks actors,
   it could also surface humans who recently annotated tailwind-contrast
   stuff. Cheap to wire, makes the phonebook polymorphic across humans and
   agents. I think yes, but it's a downstream call.

---

## 7. One-paragraph TL;DR

PD already has the substrate (tuples + pheromones + feedback + harbors).
The work is *binding human surfaces* into those primitives, not inventing
new ones. Build dashboard-click annotations first (smallest), then FleetBar
region capture (medium), then a dev-only DOM overlay using React fiber's
`_debugSource` with Marker.io-style redundant anchors as fallback (biggest
win, biggest cost). Treat each annotation as a *double-write* —
`feedback.drop` for the Cartographer pipeline + `tuples.out` for raw spatial
fidelity. Use pheromones only for graded attention, never for facts.
Presence (cursors, hover) is ephemeral; never persist it. Multi-human
overlapping annotations don't merge — they cluster. Harbors scope privacy;
blobs ACL to harbor. The biggest open call for Erich is how aggressively the
swarm should consume annotations (polling vs push) and whether DOM clicks
should spray attention pheromones or stay purely declarative.

---

## Sources

- Loom — https://www.atlassian.com/software/loom · https://portal.productboard.com/useloom/1-loom-s-product-roadmap/c/37-video-annotations
- Figma comments — https://help.figma.com/hc/en-us/articles/360039825314 · https://help.figma.com/hc/en-us/articles/360041068574
- Figma cursor chat — https://help.figma.com/hc/en-us/articles/4403130802199
- Figma multiplayer cursor build — https://mskelton.dev/blog/building-figma-multiplayer-cursors
- Linear inline / threaded comments — https://linear.app/changelog/2023-12-06-editor-improvements · https://linear.app/changelog/2023-02-09-threaded-comments · https://linear.app/docs/comment-on-issues
- GitHub PR review threads — https://github.com/orgs/community/discussions/144938 · https://github.com/zed-industries/zed/discussions/54663
- Chromatic visual review — https://www.chromatic.com/storybook · https://storybook.js.org/docs/writing-tests/visual-testing
- LogRocket session replay — https://docs.logrocket.com/docs/session-replay · https://docs.logrocket.com/v1.0/docs/using-the-logrocket-timeline
- Cursor @mentions — https://docs.cursor.com/context/@-symbols/@-files-and-folders · https://docs.cursor.com/context/@-symbols/@-files · https://cursor.com/docs/context/mentions
- Aider voice — https://aider.chat/docs/usage/voice.html · https://aider.chat/
- Crit — https://crit.md/
- BugHerd — https://bugherd.com/website-annotation-tool · https://bugherd.com/use-case/markup-tool
- Marker.io — https://marker.io/
- Self-hosted Marker.io clone writeup (redundant-anchor strategy) — https://dev.to/neosianexus/i-built-a-self-hosted-alternative-to-markerio-heres-how-it-works-under-the-hood-2i7k
- click-to-component — https://github.com/ericclemmons/click-to-component
- vite-plugin-react-click-to-component — https://github.com/ArnaudBarre/vite-plugin-react-click-to-component
- vite-plugin-react-inspector — https://github.com/sudongyuer/vite-plugin-react-inspector
- LocatorJS — https://www.locatorjs.com/
- CleanShot X — https://cleanshot.com/features · https://scottwillsey.com/cleanshotx-text-recog/
- Pesticide — https://pesticide.io/
- Yjs CRDT — https://github.com/yjs/yjs · https://docs.yjs.dev/
- AI agents as CRDT peers — https://electric.ax/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs
- Excalidraw vs Miro — https://miro.com/compare/miro-vs-excalidraw/
- Chrome extension content script + Shadow DOM — https://blog.railwaymen.org/chrome-extensions-shadow-dom · https://github.com/crxjs/chrome-extension-tools
- Source maps in React — https://medium.com/@Linda_Ikechukwu/easy-debugging-in-react-with-webpack-source-maps-5dd80a753cab · https://trackjs.com/blog/debugging-with-sourcemaps/
