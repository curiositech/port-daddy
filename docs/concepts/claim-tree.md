# The Claim Tree

> A reader's guide to Port Daddy's multi-granularity coordination structure.
> The formal specification lives at [ADR-0038](../adr/0038-claim-tree.md);
> this is the explanation.

The **claim tree** is the data structure Port Daddy uses to answer questions
like:

- *"Anything claimed under `lib/auth/` right now?"*
- *"Does this commit touch a symbol another agent is editing?"*
- *"Two of us want to edit `auth.ts` — are we on different functions or the same one?"*
- *"Show me where the swarm is concentrating in this repo."*

These are inherently **hierarchical** questions. Directories nest. Files
contain regions. Regions contain symbols. Symbols import other symbols.
The claim tree mirrors that hierarchy and attaches per-session claims to
each node, so a single SQL join can answer them all.

---

## The mental model

Picture your repo as two overlapping trees:

```
  ┌─ Filesystem tree ─────────────────────┐    ┌─ AST tree (per file) ──────────────┐
  │                                       │    │                                    │
  │  port-daddy/                          │    │  lib/auth.ts                       │
  │  ├── lib/                             │    │  ├── ClassDeclaration AuthService  │
  │  │   ├── auth.ts ─────────────────────┼────┼─→  │   ├── Method signToken         │
  │  │   ├── tuples.ts                    │    │  │   ├── Method refreshToken       │
  │  │   └── pheromone.ts                 │    │  │   └── Method validateToken      │
  │  ├── routes/                          │    │  ├── FunctionDeclaration hashPepper│
  │  └── tests/                           │    │  └── ConstantDeclaration MAX_AGE   │
  └───────────────────────────────────────┘    └────────────────────────────────────┘
```

The claim tree **joins them at the file**: every file node has children
from its AST, and those children can themselves have claims attached.

You don't need to think about AST when you `pd add lib/auth.ts` — the
tree degrades gracefully to file-level. But when symbol-index data is
available, the tree exposes a much sharper coordination granularity:
*"you can claim the `signToken` function specifically, leaving `refreshToken`
free for someone else."*

---

## Node kinds

Every node in the tree has a kind that determines what it represents:

| Kind | Example identifier | What it represents |
|---|---|---|
| `repo` | `repo:port-daddy` | The root of a single repository |
| `dir` | `dir:lib/auth/` | A directory; descendants are its files and subdirs |
| `file` | `file:lib/auth.ts` | One file; descendants are its symbols, blocks, fences |
| `symbol` | `symbol:lib/auth.ts:AuthService.signToken` | A named function / class / method |
| `block` | `block:lib/auth.ts:AuthService.signToken.body.if[0]` | An unnamed AST block inside a symbol |
| `fenced` | `fenced:lib/auth.ts:auth-validation` | A region marked with `// PD-CLAIM-BEGIN auth-validation` ... `// PD-CLAIM-END` |
| `region` | `region:lib/auth.ts:120-180` | **Fallback** for languages without AST support — line-range only |

The first three are stable by path; rename a dir and the daemon migrates
the claims via the file-move event. `symbol` is stable across line
shifts and reformatting (tree-sitter tracks symbol rename / removal).
`block` is stable when the AST path is short and unique. `fenced` is as
stable as the operator's markers stay in place. `region` is the
degraded path and is expected to soft-expire on file edits.

**Why not just line ranges?** Line numbers are the wrong frame of
reference for code. Add an import at the top of a file and every line
shifts. Two agents that *should* be coordinating end up with overlapping
line ranges that no longer touch the same code. The AST-anchored model
treats `AuthService.signToken` as the stable identity; whether it lives
on lines 120-180 today or 130-190 tomorrow, claims still point at the
same thing.

---

## Claim modes (MGL)

When a session claims a node, it picks a mode that signals what it
intends to do. Modes mirror **multi-granularity locking** from database
systems (Gray, 1976):

| Mode | Long name | Meaning | Compatible with |
|---|---|---|---|
| `S` | shared | "I'll read this; others may read too" | S, IS |
| `X` | exclusive | "I'm writing this; nobody else should" | (nothing) |
| `IS` | intention-shared | "I have S somewhere below me" | IS, IX, S |
| `IX` | intention-exclusive | "I have X somewhere below me" | IS, IX |
| `SIX` | shared + intention-exclusive | "I read this whole node + write some descendants" | IS |

For most PD work, the pattern is **IX on the directory → IX on the file
→ X on the symbol**. That way:

- *"Anything claimed under `lib/`?"* — query bubbles up; finds the IX
  on `lib/` immediately. O(1).
- *"Can I exclusively claim `lib/utils.ts`?"* — query checks IX on
  `lib/` (compatible with another IX, fine), looks for X on
  `lib/utils.ts` (none, fine), proceeds.
- *"Can I also exclusively claim `signToken`?"* — query bubbles up from
  `signToken`, finds existing X already there → conflict.

The agent never sees the modes unless they're debugging. `pd add
lib/auth.ts:signToken` sets the right intention modes automatically.

---

## The two query directions

The tree's value is that one structure supports both directions of
question:

### Push-down: "what's claimed under here?"

```
                                 ?
                                  
                                lib/                   ← start here
                                / | \
                           auth   tuples   pheromone
                          /  |  \
                  signToken  refresh  validate
                       ▲        ▲
                       │        └── claimed by session-Y (X)
                       └── claimed by session-X (X)
```

Walk the subtree from a starting node; collect every active claim at any
descendant. Returns "two sessions are active under `lib/auth/`".

### Bubble-up: "is this thing claimed anywhere?"

```
                                /
                             lib/  ← walk up
                              │
                       auth.ts   ← walk up
                              │
                       signToken ← start here
                          ▲
                          └── claim found at ancestor `lib/` (IX)
                              → narrow to specific descendant claims
```

Walk from a leaf upward; the first ancestor with a non-IS/IX claim is
the most specific match. Returns the most-specific session holding a
claim on or above the target.

Both directions are O(depth × claims), single SQL query with an index
on `parent_id`.

## Claim-tree trouble contract

`lib/claim-tree-trouble.ts` exports the ordered trouble ladder as plain data:
`VERIFY → RESCUE → COORDINATE → INSPECT → RECONCILE → WATCH → PROCEED`.

That module renders the Mermaid state diagram from the same table and
validates the graph against it. The result is one source of truth for the
agent-facing nudge, the documentation diagram, and the test snapshot.

---

## Visualization gallery

The same claim-tree data renders many ways depending on what you want to
see. Below: ten distinct visualizations on a small running example.

### Running example

The repo has been busy. Three sessions are active:

```
session-12abc (gardener)  — refactoring AuthService.signToken
session-56def (you)       — adding AuthService.refreshToken
session-78ghi (qa)        — writing tests under tests/unit/auth/
```

The claim tree state:

```
repo:port-daddy
├── dir:lib/                                        [IX × 2]
│   ├── file:auth.ts                                [IX × 2]
│   │   ├── symbol:AuthService.signToken            [X by session-12abc]
│   │   └── symbol:AuthService.refreshToken         [X by session-56def]
│   └── file:tuples.ts                              [S by session-12abc]
└── dir:tests/
    └── dir:unit/
        └── dir:auth/                               [IX]
            ├── file:signToken.test.ts              [X by session-78ghi]
            └── file:refreshToken.test.ts           [X by session-78ghi]
```

### Mode A — ASCII tree (CLI default: `pd claims tree`)

The terminal-native view. Glyphs encode kind; ANSI color encodes
conflict severity.

```
$ pd claims tree

repo:port-daddy                              [3 sessions, 6 claims]
├── lib/                                     [2 sessions, IX]
│   ├─● auth.ts                              [2 sessions, MEDIUM]
│   │   ├─◆ AuthService.signToken           [session-12abc gardener, X, 8m]
│   │   └─◆ AuthService.refreshToken        [session-56def you, X, NOW]
│   └─● tuples.ts                            [session-12abc, S]
└── tests/
    └── unit/
        └── auth/                            [session-78ghi, IX]
            ├─● signToken.test.ts            [session-78ghi qa, X, 3m]
            └─● refreshToken.test.ts         [session-78ghi qa, X, 3m]

Glyphs:  ● file   ▪ region   ◆ symbol   ◆▾ block-inside-symbol   ⌗ fenced
Colors:  green = S/IS    amber = IX/SIX    red = X    bold red = conflict
```

`--json` for machines; `--mine` to show only your session's claims;
`--at <path>` to narrow to a subtree.

### Mode B — Annotated file tree (web sidebar)

The web console default. Standard collapsible tree component; each row
shows:

```
┌─ Files ──────────────────────────────────────────────────┐
│ ▾ lib/                              [2 ● 6 ◆]             │ ← claim counts
│   ▾ auth.ts                         [2 sessions ⚠ MED]    │ ← chip + risk
│       ◆ AuthService.signToken       [gardener  8m  X]     │
│       ◆ AuthService.refreshToken    [you       NOW X]     │
│     tuples.ts                       [gardener  S]         │
│   helpers.ts                                              │
│ ▸ routes/                                                 │
│ ▸ tests/                            [1 session  IX]       │
└──────────────────────────────────────────────────────────┘
       │
       │ Click row → detail pane (right side)
       ▼
┌─ lib/auth.ts ────────────────────────────────────────────┐
│ Path:    lib/auth.ts                                     │
│ Status:  2 active claims · MEDIUM overlap                │
│                                                          │
│ Active claims:                                           │
│  • AuthService.signToken                                 │
│    Owner:    session-12abc (gardener)                    │
│    Identity: port-daddy:cartographer                     │
│    Started:  8 min ago    Heartbeat: 30s ago             │
│    Intent:   "Refactor signing to RS256"                 │
│    [Diff] [Subscribe] [DM] [Open in editor]              │
│                                                          │
│  • AuthService.refreshToken                              │
│    Owner:    session-56def (you)                         │
│    [Release] [Edit intent] [Convert to fenced region]    │
│                                                          │
│ Overlap risk: MEDIUM (transitive: both touch              │
│ AuthService class shape).                                │
└──────────────────────────────────────────────────────────┘
```

### Mode C — Squarified treemap (whole-repo at a glance)

When you want to see "where is the swarm right now?" in one screen. Each
file is a rectangle; rectangle area is proportional to LOC; color
encodes ownership:

```
┌────────────────────────────────────────────────────────────────┐
│ lib/                                          tests/           │
│ ┌──────────────────────┐ ┌────────┐ ┌───────┐ ┌──────────────┐ │
│ │       auth.ts        │ │tuples  │ │pherom │ │ unit/auth/   │ │
│ │  ┌────────┬────────┐ │ │  .ts   │ │  .ts  │ │ ┌──────────┐ │ │
│ │  │signTok │refreshT│ │ │ ░░░░░░ │ │       │ │ │signTest  │ │ │
│ │  │ ▓▓▓▓▓▓ │ ███████│ │ │ shared │ │       │ │ │ ████████ │ │ │
│ │  │ gard X │ you X  │ │ │  gard  │ │       │ │ └──────────┘ │ │
│ │  └────────┴────────┘ │ │        │ │       │ │ ┌──────────┐ │ │
│ │                      │ │        │ │       │ │ │refrTest  │ │ │
│ └──────────────────────┘ └────────┘ └───────┘ │ │ ████████ │ │ │
│ ┌──────────────────────────────────────┐      │ └──────────┘ │ │
│ │       helpers.ts (unclaimed)         │      │  qa X        │ │
│ └──────────────────────────────────────┘      └──────────────┘ │
│ routes/                                                        │
│ ┌──────────┬──────────────────┬────────┐                       │
│ │  api.ts  │      whois.ts    │ home.ts│                       │
│ └──────────┴──────────────────┴────────┘                       │
└────────────────────────────────────────────────────────────────┘

   Legend:  ░░ shared/S    ▓▓ session-12abc    ██ session-56def
            ██ session-78ghi (qa)  ░░ unclaimed
```

Color is **discrete ownership** (one hue per session, gray for
unclaimed). Border thickness is conflict severity. Hover for tooltip;
click to zoom into a subtree.

### Mode C-alt — Sunburst / icicle

A radial alternative when the tree is deep. Center is the repo root;
each ring outward is one level deeper. Slice angle proportional to LOC.

```
                          ╭─────────────────────────╮
                       ╭──┤      lib/auth.ts         ├──╮
                    ╭──┤  ╰───┬────────────┬───────╯  ├──╮
                 ╭──┤  signToken  │  refresh    │  ...│   ├──╮
              ╭──┤  │   gard X    │   you X    │       │    ├──╮
           ┌──┤   │   (8m)        │  (NOW)     │       │      ├──┐
           │   │   │               │             │       │       │  │
           │   │   ╰────────────╯╰─────────────╯ ╰──────╯       │  │
           │   │              repo:port-daddy                    │  │
           │   ╰──┐                                          ┌──╯   │
           ╰──┐   ╰──┐  lib/  ╱    ╲  tests/             ┌──╯   ╭──╯
              ╰──┐   ╰──────╯      ╰──────────────────╮ ╱   ╭──╯
                 ╰──┐                                  ╲ ╲ ╭──╯
                    ╰──╮      routes/      docs/      ╰──╮╱
                       ╰─────────────────────────────────╯
```

Sunbursts are compact for deep trees but less intuitive than treemaps
for code. Useful when you have 20-level directory nesting.

### Mode D — Force-directed graph (with imports)

Shows the import graph in addition to hierarchy. Nodes are files /
symbols; tree edges are parent-child; extra edges are imports. Color
halo around each node encodes claim ownership.

```
                  signToken     ←─── imports ───
                 (gardener X)                   ╲
                       │                         ╲
                       │ in                       refreshToken
                       │                          (you X)
                  AuthService                    /
                       │                        /
                       │ in                  imports
                       ▼                      /
                   auth.ts ◀─────────────────╯
                       │
                       │ imports
                       ▼
                 hashPepper                     signToken.test.ts
                  (unclaimed)         ─── imports ───▶  (qa X)
                                                          │
                                                          │ imports
                                                          ▼
                                                    auth.ts (read-only)
```

Spotlights coupling. Useful for asking *"who imports the thing I'm about
to change?"* without diving into static-analysis tools.

### Mode E — Per-session Gantt ribbon (retrospective)

Time on the X axis; one row per session. Horizontal bars show which
claims were active during each session's lifetime. Hover for the
specific node ids.

```
            now → →
       │   ─2h──────────────────── ─1h──────────────────── now
─ ─ ── ┼ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
session-12abc                    ████████ AuthService.signToken
(gardener)                                       ░░░░░░░░░░░░░░ tuples.ts (S)
────────────────────────────────────────────────────────────
session-56def                                  ███████████████ refreshToken (X)
(you)
────────────────────────────────────────────────────────────
session-78ghi              ██ signToken.test.ts ████ refreshToken.test.ts
(qa)                       (X)                       (X)
────────────────────────────────────────────────────────────

       Bars touching the right edge are active NOW.
       Overlapping bars at the same x-position = simultaneous claims.
```

Useful in retrospectives: "during the auth refactor, which sessions
were contending?"

### Mode F — Topographic contour map ("claim density")

Each node's claim count is its "elevation". Contour lines drawn at
constant elevations. Looks like a USGS topo map of where coordination
is concentrated.

```
                         ╱──── 3 sessions ────╲
                       ╱        ╱╲              ╲
                     ╱        ╱    ╲              ╲
                   ╱        ╱        ╲              ╲
                 ╱       ╱  lib/auth/  ╲              ╲
                ╱       │   (HOT)        │              ╲
               │       │                  │              │
               │       │                  │              │
                ╲       ╲   tests/unit/  ╱              ╱
                 ╲        ╲             ╱              ╱
                   ╲        ╲         ╱              ╱
                     ╲        ╲     ╱              ╱
                       ╲────── 1 session ──────╱
                          (gentle slope = thin claims)
```

Operator scan: "where are the peaks?" → those are coordination
hotspots. Counter-question: "where are the valleys?" → unclaimed
territory.

### Mode G — Calendar heatmap (per-day claim activity)

GitHub-contributions-style grid: rows are days of the week, columns are
weeks. Cell darkness is total claim activity that day. Hover for the
top-claimed nodes.

```
       Apr ──────────────────────── May ──────────────
  Mon  ░ ▒ ▓ ▓ ░ ░ ▓ ▒ ░ ░ ▓ ▒ ▒ ▒ ░ ░ ▓ ▒ ▒ ░ ░ ░ ▓ ▒
  Tue  ░ ▒ ▓ ▒ ░ ░ ▓ ▒ ░ ░ ▓ ▒ ▓ ▒ ░ ░ ▓ ▒ ▒ ░ ░ ░ ▓ ▒
  Wed  ░ ▓ ▓ ▒ ▒ ░ ▓ ▓ ░ ░ ▒ ▓ ▓ ▒ ░ ░ ▒ ▓ ▒ ░ ░ ░ ▒ ▓
  Thu  ░ ▒ ▓ ▒ ▒ ░ ▒ ▓ ░ ░ ▓ ▒ ▓ ▒ ░ ░ ▓ ▒ ▓ ░ ░ ░ ▓ █  ← today
  Fri  ░ ░ ▒ ▒ ░ ░ ▒ ▒ ░ ░ ▒ ░ ░ ░ ░ ░ ▒ ░ ░ ░ ░ ░ ░ ░
  Sat  ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░
  Sun  ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░ ░

  ░ 0     ▒ 1-5    ▓ 6-15    █ 16+   claims active that day
```

Reveals the project's rhythm. Saturday/Sunday valleys, mid-week peaks,
spike on a Thursday when an outage happened.

### Mode H — Sankey flow (claim lifecycle)

Where claims come from and go. Left axis: claim creation source.
Right axis: claim resolution. Bands proportional to count.

```
   Sources                                 Destinations
                                                                
   pd add ──────────────────────────────┬─→ pd done (released)
                                        │
   pd feature ────────────────┬─────────┼─→ Reverted before commit
                              │         │
   Auto-IX (escalation) ──────┤         │
                              │         ├─→ Contested (auto-pruned)
   Sortie spawn ──────────────┤         │
                              │         │
                              ╰─────────╯
                              
   Saturation by:  pd add (62%)  pd feature (24%)  auto (14%)
   Resolution by:  pd done (78%)  Reverted (12%)  Pruned (10%)
```

For monthly reports: how do claims arise and resolve? Which sources
produce the most short-lived claims? Which produce zombies?

### Mode I — Streamgraph (claim depth over time)

Stacked area chart showing how many claims are active at each
granularity over time:

```
   claims                                                
   active                                                 
     │     repo                                            
     │     ╭────╮  ╭────╮          ╭────╮                  
   8 │   ╱     ╲╱      ╲    dir  ╱     ╲                   
     │  ╱    file (light) ╲    ╱  file  ╲                  
   6 │ ╱   ░░░░░░░░░░░     ╲  ╱ ░░░░░░░░░╲ symbol          
     │╱  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  ╲╱▒▒▒▒▒▒▒▒▒▒▒  ╲ (heavy)       
   4 │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ╲                
     │ ████████████████████████████████████████             
   2 │█████████████████████████████████████████             
     │                                                      
     └───────────────────────────────────────────  time
       9 AM      noon      3 PM      6 PM      9 PM
       
       Bands (bottom to top):
         repo (rare) · dir · file · symbol · region · block · fenced
```

Tells the story: "we started broad with file-level claims; by mid-day
the symbol-level claims dominated as we got into specific work."

### Mode J — Aggregated dependency wheel

Circular arc layout (à la d3 chord diagram) showing which files'
claims correlate with which other files' claims, based on co-occurrence
within sessions.

```
              ╭─────────────────────╮
            ╱  auth.ts       login.ts  ╲
          ╱       │       \  /    │      ╲
        ╱       │         ╳        │       ╲
      ╱       │          ╱ ╲        │        ╲
    │       │        ╱     ╲        │         │
    │ session.ts  ─╯         ╰─  cookies.ts   │
    │   ╲      ╱                    ╱     │
    │     ╲    ╱                  ╱      │
      ╲     ╲ ╱                  ╱      ╱
        ╲    ╳                  ╳     ╱
          ╲   ╲              ╱  ╱
            ╲  jwt.ts  user.ts  ╱
              ╲────────────────╱
              
   Arc thickness = number of sessions that claimed both files
```

Reveals the "this commit changes auth → these other files always need
to change too" coupling without static analysis.

---

## Worked examples

### Example 1: Two agents racing the same file

```
T+0:00  session-A: pd add lib/auth.ts:signToken --intent "refactor signing"
        → claim X on symbol:lib/auth.ts:signToken (auto-IX on file, dir, repo)

T+0:30  session-B: pd add lib/auth.ts:refreshToken --intent "new method"
        → claim X on symbol:lib/auth.ts:refreshToken
        → existing IX on lib/auth.ts is compatible with new IX ✓
        → no conflict at symbol level (different symbols)
        → ambient broker injects warning to session-B:
           "session-A is editing signToken (8m). Risk: LOW (different
            symbols). Diff: pd diff session-A --paths lib/auth.ts"
        → session-B proceeds

T+15:00 session-A: pd done
        → release X on signToken; IX on file/dir/repo refcount-decremented
        → session-B keeps its claim (still IX on file via its own
          refreshToken claim)
```

The tree's modes let two agents work in the same file without blocking,
while still surfacing the existence of the other to both.

### Example 2: Risk escalation when overlap is real

```
T+0:00  session-A: pd add lib/auth.ts:signToken
        → X on signToken

T+5:00  session-B: pd add lib/auth.ts:signToken
        → query bubbles up from signToken; finds existing X by session-A
        → OVERLAP risk: HIGH (same symbol)
        → ambient broker top-of-context for B:
           "session-A holds X on signToken since 5m. To proceed:
            (a) pd inbox send session-A 'please release'
            (b) pd unlock --force --reason '...' (auto-stashes A's WIP)
            (c) wait for A to finish"
        → session-B is NOT hard-refused; the shim warns and proceeds
          if the agent presses on (configurable per repo)
```

### Example 3: Lock escalation under heavy claim density

```
T+0:00  session-A claims lib/auth.ts, lib/jwt.ts, lib/session.ts,
        lib/cookies.ts, lib/user.ts (5 sibling files in lib/)
        Each is X on the file.
        
        After the 5th claim, the daemon emits:
        
        [PD claim-tree — escalation suggestion]
        You hold X on 5 files under lib/. Consider escalating to a
        single SIX on lib/:
        
          pd add lib/ --mode SIX --intent "auth subsystem refactor"
        
        This declares your scope at directory granularity; ancestor
        queries find one record instead of five.
```

The session can accept (one parent SIX replaces the 5 child Xs) or
ignore (keep the 5 child claims; they're still all valid).

### Example 4: Contest pressure → faster GC

```
T+0:00  session-A: pd add lib/auth.ts:signToken (X)
        Then session-A walks away. Goes to lunch. Doesn't come back.

T+2h    session-B: pd add lib/auth.ts:signToken → HIGH overlap warning
        Decides to wait. session-A still nominally holding the claim.
        
T+3h    session-C: pd add lib/auth.ts:signToken → HIGH overlap warning
        Also decides to wait.
        
T+6h    session-D: same. Now contest-pressure on the claim = 3.
        
The GC half-life calculation:
   contest=3 → effective_idle_threshold = 30d * exp(-0.3 * 3) ≈ 12d
   
But there's no heartbeat from session-A. The session itself dies after
the standard spawned-run timeout (or stays alive if operator session).

Top-of-context to session-A:
   "Your claim on signToken is being contested by 3 other sessions.
    If you're done, run: pd release claim-<id>"
```

Idle high-contest claims compress their lifetimes — they don't squat
for the full 30 days.

### Example 5: Distributed move (CRDT semantics)

(Future-state, when PD distributes across machines.)

```
Daemon-A at lamport_clock=100:
   move file:lib/auth.ts → file:lib/auth/index.ts
   (refactor: split the file into a directory)

Daemon-B at lamport_clock=100:
   move file:lib/auth.ts → file:src/auth.ts
   (rearrange: move file to src/)

Both daemons get both ops. Lamport ties broken by daemon-id (A > B).

Resolution:
   - At lamport=100, daemon-A's move "wins" (higher daemon-id tiebreak)
   - Daemon-B's move is undone via tombstone op
   - Final state: file is at lib/auth/index.ts
   
Claims on file:lib/auth.ts migrate via the move op; claims on the
descendants (signToken etc.) migrate transitively. Operators on both
machines see the same final tree.
```

---

## When the tree is the right model

The claim tree is overkill if:

- You only ever want file-level claims (no symbols, no regions)
- You have one agent per project and no concurrent work
- You don't care about retrospective analytics

The tree pays off when:

- Multiple agents work in the same repo simultaneously
- Refactors touch the same file but different functions
- Operators want to ask "where is the swarm?" questions
- You want to attribute cost / risk / coupling at function granularity
- You eventually want PD to distribute across machines (the CRDT shape
  is ready)

For PD's actual usage pattern — fleets of agents on a single operator's
machine — it's the right model. The audit on 2026-05-19 showed 0 of
1,637 production claims used line ranges or symbols. The tree changes
that from "schema is ready, data isn't" to "data flows in naturally
because the verb makes it easy."

---

## Reading further

- **[ADR-0038 — Claim Tree](../adr/0038-claim-tree.md)** — the formal
  specification: data structure, API, storage schema, migration phasing
- **[ADR-0037 — Git Access Control](../adr/0037-git-access-control-and-pd-feature-verbs.md)**
  — the verb layer that produces claim-tree writes (`pd feature`,
  `pd add`, etc.)
- **[ROADMAP § 8 — Substrate Activation](../ROADMAP.md#8-substrate-activation--the-ambient-context-broker-2026-05-19)**
  — the broader architecture this fits inside
- **[`docs/design/pheromone-vocabulary-v1.md`](../design/pheromone-vocabulary-v1.md)**
  — the pheromone overlay (Mode A in the visualization gallery)

External:

- **Gray, "Granularity of Locks and Degrees of Consistency" (1976)** —
  the foundational paper on multi-granularity locking. Defines IS / IX /
  SIX modes and the compatibility matrix.
- **Kleppmann, "A highly-available move operation for replicated trees"
  (2021)** — the CRDT semantics PD's op log conforms to.
- **CodeScene / CodeCharta / Sourcegraph** — production tools that
  visualize code health on a hierarchical spine; influences for
  Modes B and C.
