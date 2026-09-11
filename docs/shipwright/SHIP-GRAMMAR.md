# SHIP GRAMMAR

> *"Same ship, different parts" — the philosopher Theseus and his crew spent a
> whole voyage arguing about this. Our grammar settles it: what stays is the
> silhouette (the agent), what drifts is the livery (the fleet).*

**Status:** Spec + reference impl — 2026-04-19
**Consumes:** `<fleet_prefix>:fleet:<agent_name>` identity strings
**Produces:** a `ShipPlan` (plain data) → rendered in-browser by R3F
**Teaches:** deterministic procedural geometry, fleet signature via hashing

---

## 1. Why a grammar (not a fixed icon set)

Port Daddy fleets are open-ended. Any project may define any agent name. A
hand-drawn icon per archetype would either cap creativity or ship an
icon-bloat library. A grammar gives us:

- **Recognition across projects.** A `spark` in `port-daddy` looks like a
  `spark` in `expungement-guide` — same silhouette. Learn once, recognize
  anywhere.
- **Fleet identity.** Two sparks are not identical — the fleet prefix
  drifts color and scale so "my fleet" has a visual signature.
- **Zero server round-trip.** Pure function of the identity string. Every
  client computes the same bytes deterministically.
- **Free mutation.** State (selected, throttled, slashed, ghost) is a
  material swap, not a new asset.

---

## 2. Identity format

```
<fleet_prefix>:fleet:<agent_name>
```

Constraints (enforced by `parseIdentity`):

- `fleet_prefix` — lower-kebab-case, `[a-z0-9-]+`, 2–64 chars.
- literal segment `:fleet:` — distinguishes agent ships from other
  identity-bearing objects we might render later.
- `agent_name` — lower-kebab-case codename, `[a-z-]+`, 2–32 chars. Prefer
  single-word codenames (`spark`, `spider`, `scout`, `hawk`, `sentry`,
  `scribe`, `sweeper`, `gardener`). Multi-segment names are allowed
  (`test-gap-hunter`) and the whole thing counts toward the metrics.

Examples:

```
port-daddy:fleet:spark
expungement-guide:fleet:spark        # same silhouette, different livery
port-daddy:fleet:hawk
jury_rig:fleet:cartographer
```

---

## 3. Variables

### 3.1 Agent variables (commonality — the silhouette)

Computed from `A = agent_name` with hyphens stripped.

| Symbol | Meaning | Formula |
|---|---|---|
| `L_a` | character length | length of A with hyphens stripped |
| `V_a` | vowel count | count of `[aeiou]` + `y` *following a consonant* |
| `C_a` | consonant count | `L_a - V_a` |

**Why `y` is context-sensitive:** in English, `y` acts as a vowel only
when it follows a consonant (`sentry` has 2 vowels: `e`, `y`; `yak` has
1: `a`). Keeps vowel counts intuitive for the codenames we expect.

### 3.2 Fleet variables (drift — the livery)

Computed from `F = fleet_prefix`, hyphens **included** (ASCII 45 adds
spread so `port-daddy` and `portdaddy` don't collide in the palette).

| Symbol | Meaning | Formula |
|---|---|---|
| `H_f` | hash | sum of ASCII codes of chars in `F` |
| `color_primary` | core + nacelle | `PALETTE[H_f % 4]` |
| `color_accent`  | cluster         | `PALETTE[(H_f + L_a) % 4]`, rotated `+1` if it collides with `color_primary` |
| `color_trim`    | hull waterline stripe | `PALETTE[(H_f*13 + L_a*7) % 4]`, rotated `+1` if it collides with `color_primary` |
| `scale_drift`   | height multiplier | `(H_f % 3) + 1` → one of {1,2,3} |
| `sigil`         | DaemonCore front face mark | `SIGILS[(H_f * 37) % 8]` — `37` is coprime to both `4` and `3`, so sigil varies independently of color and drift |

**Sigils** (8 marks, always `color_accent` on the `color_primary` core face):
`chevron` `bar` `cross` `ring` `dot-pair` `triangle` `slash` `double-stripe`.
These are geometric and tight so they read at thumbnail scale. No
emojis, no letters, no custom icons — just 8 primitive marks, same
discipline as maritime signal flags.

**Signature space.** 4 primary × ~3 accent (collision-dodged) × ~3 trim
× 8 sigils × 3 drifts = **864 distinguishable fleet signatures**.
Legible, discrete, Swiss palette preserved.

**Why `sum of char codes`, not a real hash?** We need *visible* spread,
not cryptographic uniformity. ASCII-character variety already gives our
4-bucket palette even distribution across realistic fleet names. If that
ever fails we swap for FNV-1a — public API stays the same.

### 3.3 Palette

Four colors, drawn directly from `website-v2/src/styles/tokens.css`.

```
PALETTE = [
  '#bf2f2f',  // 0 · Signal Red       (--status-error)
  '#0055ff',  // 1 · Cobalt Blue      (--brand-primary)
  '#dfff00',  // 2 · Cyber Yellow     (--brand-accent)
  '#121212',  // 3 · Obsidian Black   (--border-strong)
]
HULL_NEUTRAL = '#cfc9bb'  // warm off-white; reads on paper and in dark
```

**Why four?** Swiss-modern's "Accent Sprawl" failure mode warns against
rainbow dashboards. Four is enough to recognize a fleet at a glance.

---

## 4. Component grammar

A ship is six block groups. Axis convention: `+Z` forward, `+Y` up,
`+X` starboard.

```
AgentShip = Mainframe + Prow + DaemonCore + ComputeClusters
          + CoolingTowers + EngineNacelles
```

| Rule | Dimensions (W,H,D) | Color | Placement |
|---|---|---|---|
| **Mainframe** | `(L_a%3)*2+3, 2, L_a*4` | `HULL_NEUTRAL` | origin, bottom |
| **Prow** | `W_main-2, 2, V_a*3` | `HULL_NEUTRAL` | forward of Mainframe on `+Z` |
| **DaemonCore** | `W_main-2, scale_drift*2, 4` | `color_primary` | centered on top of Mainframe |
| **ComputeClusters** | `count = (L_a%3)+1`, each `2,2,2` | `color_accent` | arrayed forward of Core on centerline |
| **CoolingTowers** | `count = C_a`, each `1, C_a+scale_drift, 1` | obsidian | 2-wide grid aft of Core |
| **EngineNacelles** | `count = min(V_a,3)*2` (symmetric, cap 6 total), each `1,1,L_a+2` | `color_primary` | flush against rear Mainframe sides |
| **TrimStripe** | `1 × 0.5 × mainD+prowD` single stripe | `color_trim` | horizontal line at top of Mainframe, running full length into the Prow |
| **Sigil** | geometric mark on Core front face | `color_accent` | +Z face of the DaemonCore, small |

**Base hull is always neutral** so drift colors read as livery, not
camouflage — same reason Navy ships are gray.

---

## 5. State visuals (non-grammar, applied at render)

Pure grammar gives the shape. Runtime state gives the feel.

| State | Visual change | Implementation |
|---|---|---|
| `running` | full color, bobbing on water | `useFrame` sine-wave Y + cosine roll |
| `idle` | rides 0.2u lower, reduced bob | lerp `position.y` |
| `throttled` | amber rim on DaemonCore, slow pulse | `emissive` lerp to `#a66f00`, 1s period |
| `selected` | emissive = `color_primary`, bloom → dither halo | `emissiveIntensity` lerp to 2.0 |
| `unselected` (sibling focused) | color lerps to `#444`, sinks 0.1u | ~200ms lerp |
| `ghost` (proposed) | wireframe material, 35% alpha | separate material, no lighting |
| `slashed` | red stripe along core edge, animation frozen | overlay box, freeze `useFrame` |
| `mayday` | all lights → red emissive, 2 Hz pulse | material swap + useFrame flash |

All transitions honor `prefers-reduced-motion`: snap instead of lerp.

---

## 6. Rendering stack (R3F + postprocessing)

```
scene
 FleetStage              subdivided planeGeometry, low-freq water shader
 AgentShip * N           position assigned by archetype family
 ambient + directional lights (low-key, high-contrast)
 EffectComposer
   BloomPass             picks up emissive on selected ships
   DitherEffect          8x8 Bayer, quantizes to paper/ink/blue/lime/red
```

The dither palette is a *superset* of the accent palette — paper
background + ink outlines must also survive quantization. So dither's
five colors are `['#f2eee6','#121212','#bf2f2f','#0055ff','#dfff00']`,
and the Bloom pass that precedes dither is what makes selected ships
crunch outward into a halo of bright pixels.

---

## 7. Reference implementation (Node-safe, no Three imports)

The renderer (R3F) consumes this module's output but this module has no
Three dependency — keeps it runnable in tests and on the edge snapshot
worker.

```ts
// lib/ship-grammar.ts
//
// Ship Grammar: identity string -> ShipPlan (plain data).
//
// Every agent in Port Daddy has a canonical identity:
//     <fleet_prefix>:fleet:<agent_name>     e.g.  port-daddy:fleet:spark
//
// This module converts that string into a ShipPlan. Rendering is someone
// else's job. Pure function. Same input, identical output, everywhere.
//
// The two-axis idea:
//   Commonality -> silhouette (driven by agent_name).
//       spark always has L_a / V_a / C_a = 5 / 1 / 4.
//   Drift       -> livery (driven by fleet_prefix).
//       port-daddy's sparks wear red; expungement-guide's wear obsidian.
//
// See docs/shipwright/SHIP-GRAMMAR.md for the formal spec.

/** Four-color palette, tokenized from website-v2/src/styles/tokens.css. */
export const PALETTE = [
  '#bf2f2f', // 0  Signal Red
  '#0055ff', // 1  Cobalt Blue
  '#dfff00', // 2  Cyber Yellow
  '#121212', // 3  Obsidian Black
] as const;

/** Neutral off-white. Drift colors must stand out against the hull. */
export const HULL_NEUTRAL = '#cfc9bb';

/** One block in the plan. Axis: +Z forward, +Y up, +X starboard. */
export interface Block {
  /** Local dimensions in grammar units (R3F scales them at render). */
  w: number; h: number; d: number;
  /** World position, block-center origin. */
  x: number; y: number; z: number;
  /** Hex color. */
  color: string;
}

/** 8 sigils stamped on the DaemonCore front face. */
export type SigilKind =
  | 'chevron' | 'bar' | 'cross' | 'ring'
  | 'dotPair' | 'triangle' | 'slash' | 'doubleStripe';
export const SIGILS: readonly SigilKind[] = [
  'chevron', 'bar', 'cross', 'ring',
  'dotPair', 'triangle', 'slash', 'doubleStripe',
] as const;

/** Full geometry for one agent ship. */
export interface ShipPlan {
  identity: string;
  fleet: string;
  agent: string;
  metrics: {
    L_a: number; V_a: number; C_a: number;
    H_f: number;
    colorPrimary: string;
    colorAccent: string;
    colorTrim: string;
    scaleDrift: number;
    sigil: SigilKind;
  };
  mainframe: Block;
  prow: Block;
  core: Block;
  clusters: Block[];
  towers: Block[];
  nacelles: Block[];
  /** Thin stripe along the top edge of Mainframe + Prow. Rendered as a
   *  single long narrow block in R3F; in SVG side-view as a 1px line. */
  trimStripe: Block;
  /** Which of 8 sigils to stamp on the DaemonCore front face. The
   *  renderer draws this as geometry (never a texture). */
  sigil: SigilKind;
}

/**
 * Parse an identity into its two parts.
 *
 * We anchor on the literal `:fleet:` segment so agent names containing
 * hyphens (test-gap-hunter) never get mis-split. Cheap, unambiguous.
 *
 * @param identity - string of form `<fleet>:fleet:<agent>`
 * @returns `{ fleet, agent }`
 * @throws if malformed
 * @example
 *   parseIdentity('port-daddy:fleet:spark')
 *   // -> { fleet: 'port-daddy', agent: 'spark' }
 *
 *   parseIdentity('expungement-guide:fleet:test-gap-hunter')
 *   // -> { fleet: 'expungement-guide', agent: 'test-gap-hunter' }
 */
export function parseIdentity(identity: string): { fleet: string; agent: string } {
  const m = /^([a-z0-9-]{2,64}):fleet:([a-z-]{2,32})$/.exec(identity);
  if (!m) {
    throw new Error(
      `ship-grammar: invalid identity "${identity}". ` +
      `Expected <fleet>:fleet:<agent>, e.g. port-daddy:fleet:spark.`
    );
  }
  return { fleet: m[1], agent: m[2] };
}

/**
 * Count vowels in an agent name. Y is a vowel only when it follows a
 * consonant — matches native-English intuition.
 *
 * @example
 *   vowels('spark')   // 1  (a)
 *   vowels('sentry')  // 2  (e, y -- y follows t)
 *   vowels('yak')     // 1  (a; leading y is a consonant here)
 *   vowels('ai')      // 2  (a, i)
 */
export function vowels(a: string): number {
  const s = a.replace(/-/g, '').toLowerCase();
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = s[i - 1];
    if ('aeiou'.includes(c)) v++;
    else if (c === 'y' && prev !== undefined && !'aeiou'.includes(prev)) v++;
  }
  return v;
}

/**
 * Sum of ASCII char codes. Good-enough spread for a 4-bucket palette
 * across realistic fleet names.
 *
 * @example
 *   hashFleet('port-daddy')         // 1016
 *   hashFleet('expungement-guide')  // 1771
 */
export function hashFleet(f: string): number {
  let h = 0;
  for (let i = 0; i < f.length; i++) h += f.charCodeAt(i);
  return h;
}

/**
 * Build a ship plan from a canonical identity. Pure function — same
 * input, identical output, every time, everywhere.
 *
 * @param identity - `<fleet>:fleet:<agent>`
 * @returns ShipPlan (plain data)
 * @throws if identity is malformed (via parseIdentity)
 *
 * @example
 *   const a = buildShip('port-daddy:fleet:spark');
 *   a.core.color          // '#bf2f2f'  Red  (port-daddy's primary)
 *   a.clusters.length     // 3          (L_a % 3) + 1 for L_a=5
 *   a.towers.length       // 4          C_a for 'spark' (s,p,r,k)
 *   a.nacelles.length     // 2          V_a * 2 for V_a=1
 *
 *   const b = buildShip('expungement-guide:fleet:spark');
 *   b.core.color          // '#121212'  Obsidian (drifted)
 *   b.clusters.length     // 3          silhouette preserved
 *   b.core.h              // 4          scale_drift=2 -> h=4
 *
 *   // Invariant: same agent -> identical silhouette counts/dims,
 *   //            different fleet -> at least one color differs.
 */
export function buildShip(identity: string): ShipPlan {
  const { fleet, agent } = parseIdentity(identity);

  // Agent axis
  const A = agent.replace(/-/g, '');
  const L_a = A.length;
  const V_a = vowels(agent);
  const C_a = L_a - V_a;

  // Fleet axis
  const H_f = hashFleet(fleet);
  const primaryIdx = H_f % 4;
  const colorPrimary = PALETTE[primaryIdx];
  // Collision dodge: if accent == primary, rotate +1. Clusters otherwise
  // vanish into the core; dodge preserves per-agent accent drift.
  let accentIdx = (H_f + L_a) % 4;
  if (accentIdx === primaryIdx) accentIdx = (accentIdx + 1) % 4;
  const colorAccent  = PALETTE[accentIdx];
  // Trim stripe: a third independent color bucket. Multipliers 13 and 7
  // are coprime to 4 so trim shifts independently of primary and accent.
  let trimIdx = (H_f * 13 + L_a * 7) % 4;
  if (trimIdx === primaryIdx) trimIdx = (trimIdx + 1) % 4;
  const colorTrim    = PALETTE[trimIdx];
  const scaleDrift   = (H_f % 3) + 1;
  // Sigil on the DaemonCore front face. 37 is coprime to 4 and 3, so
  // sigil varies independently of primary color and scale_drift.
  const sigil: SigilKind = SIGILS[(H_f * 37) % 8];

  // Core hull
  const mainW = (L_a % 3) * 2 + 3;
  const mainD = L_a * 4;
  const mainframe: Block = {
    w: mainW, h: 2, d: mainD,
    x: 0, y: 0, z: 0,
    color: HULL_NEUTRAL,
  };

  // Prow tapers forward. Length scales with vowels -- vowels are the
  // "open" sounds of a name, so prow "breathes" on vowel-rich names.
  const prowD = V_a * 3;
  const prow: Block = {
    w: mainW - 2, h: 2, d: prowD,
    x: 0, y: 0, z: mainD / 2 + prowD / 2,
    color: HULL_NEUTRAL,
  };

  // DaemonCore: fleet's gravity shows here. Drift-3 fleets look
  // top-heavy vs drift-1 fleets even with the same agent name.
  const coreH = scaleDrift * 2;
  const core: Block = {
    w: mainW - 2, h: coreH, d: 4,
    x: 0, y: 2 / 2 + coreH / 2, z: 0,
    color: colorPrimary,
  };

  // ComputeClusters: dense racks forward of the core.
  const clusterCount = (L_a % 3) + 1;
  const clusters: Block[] = [];
  for (let i = 0; i < clusterCount; i++) {
    clusters.push({
      w: 2, h: 2, d: 2,
      x: 0,
      y: 2 / 2 + 1,
      z: 4 / 2 + 2 + i * 3,
      color: colorAccent,
    });
  }

  // CoolingTowers: obsidian stacks aft. Count = C_a, because consonants
  // are the "hard" sounds — hard-sounding names get more towers.
  const towers: Block[] = [];
  const towerH = C_a + scaleDrift;
  for (let i = 0; i < C_a; i++) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    towers.push({
      w: 1, h: towerH, d: 1,
      x: col === 0 ? -0.75 : 0.75,
      y: 2 / 2 + towerH / 2,
      z: -(4 / 2 + 1 + row * 1.5),
      color: PALETTE[3],
    });
  }

  // EngineNacelles: sleek pods hugging rear exterior, V_a per side,
  // capped at 3 per side. Past 3 the ship looks like a porcupine — Tufte
  // rule: every mark earns its ink. Cartographer (V_a=4) caps at 6 total
  // instead of 8; nobody notices the missing two and everybody notices
  // the cleaner silhouette.
  const nacelles: Block[] = [];
  const nacL = L_a + 2;
  const nacPerSide = Math.min(V_a, 3);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < nacPerSide; i++) {
      nacelles.push({
        w: 1, h: 1, d: nacL,
        x: side * (mainW / 2 + 0.5),
        y: 0.5 + i * 1.25,
        z: -mainD / 2 + nacL / 2,
        color: colorPrimary,
      });
    }
  }

  // TrimStripe: a thin band along the top of Mainframe + Prow. Renders
  // as one long narrow block in R3F, as a horizontal line in 2D SVG.
  const trimStripe: Block = {
    w: mainW - 0.25, h: 0.5, d: mainD + prowD,
    x: 0,
    y: 2 / 2 + 0.25,
    z: prowD / 2,
    color: colorTrim,
  };

  return {
    identity, fleet, agent,
    metrics: {
      L_a, V_a, C_a, H_f,
      colorPrimary, colorAccent, colorTrim,
      scaleDrift, sigil,
    },
    mainframe, prow, core, clusters, towers, nacelles, trimStripe, sigil,
  };
}
```

### 7.1 Tests (colocated, vitest)

```ts
// tests/unit/ship-grammar.test.ts
//
// Grammar invariants. If these fail it is not a refactor — it is a
// visual regression the user will see as "my sparks stopped looking
// like sparks".
import { describe, it, expect } from 'vitest';
import { buildShip } from '../../lib/ship-grammar';

describe('ship-grammar invariants', () => {
  it('same agent across fleets keeps silhouette counts', () => {
    const a = buildShip('port-daddy:fleet:spark');
    const b = buildShip('expungement-guide:fleet:spark');
    expect(a.clusters.length).toBe(b.clusters.length);
    expect(a.towers.length).toBe(b.towers.length);
    expect(a.nacelles.length).toBe(b.nacelles.length);
    expect(a.mainframe.d).toBe(b.mainframe.d);
  });

  it('same agent across fleets drifts livery', () => {
    const a = buildShip('port-daddy:fleet:spark');
    const b = buildShip('expungement-guide:fleet:spark');
    const differs =
      a.core.color !== b.core.color ||
      a.clusters[0].color !== b.clusters[0].color ||
      a.metrics.scaleDrift !== b.metrics.scaleDrift;
    expect(differs).toBe(true);
  });

  it('pure — same input produces deep-equal output', () => {
    expect(buildShip('port-daddy:fleet:spark'))
      .toEqual(buildShip('port-daddy:fleet:spark'));
  });

  it('rejects malformed identities', () => {
    expect(() => buildShip('not-an-identity')).toThrow();
    expect(() => buildShip('proj:agent')).toThrow();
    expect(() => buildShip('proj:fleet:')).toThrow();
  });
});
```

---

## 8. Worked examples

### 8.1 `port-daddy:fleet:spark` vs `expungement-guide:fleet:spark`

| Variable | port-daddy | expungement-guide |
|---|---|---|
| `H_f` | 1016 | 1771 |
| `color_primary` | `#bf2f2f` (Red) | `#121212` (Obsidian) |
| `color_accent` | `#0055ff` (Blue) | `#bf2f2f` (Red) |
| `scale_drift` | 3 | 2 |

Both: `L_a = 5`, `V_a = 1`, `C_a = 4` → same mainframe (7×2×20), same
prow (5×2×3), 3 clusters, 4 towers, 2 nacelles. Squint and it is a spark.

- **port-daddy's spark** wears a tall red core (h=6), blue clusters on
  the deck, red nacelles flanking the hull. Reads fast, aggressive.
- **expungement-guide's spark** wears a medium obsidian core (h=4), red
  clusters on the deck, obsidian nacelles. Reads quiet, stealthy.

Same role. Different house. See `mocks/06-spark-drift.svg`.

### 8.2 Other codenames (port-daddy fleet)

| codename | L_a | V_a | C_a | mainW × mainD | towers | nacelles | feel |
|---|---|---|---|---|---|---|---|
| spark        | 5 | 1 | 4 | 7 × 20 | 4 | 2 | lean, torpedo |
| hawk         | 4 | 1 | 3 | 5 × 16 | 3 | 2 | small, sharp |
| scribe       | 6 | 2 | 4 | 3 × 24 | 4 | 4 | long, stilted |
| sentry       | 6 | 2 | 4 | 3 × 24 | 4 | 4 | cousin of scribe (intentional) |
| sentinel     | 8 | 3 | 5 | 7 × 32 | 5 | 6 | battleship |
| cartographer | 12 | 4 | 8 | 3 × 48 | 8 | 8 | destroyer-long |
| nomad        | 5 | 2 | 3 | 7 × 20 | 3 | 4 | stocky, wide |
| scout        | 5 | 2 | 3 | 7 × 20 | 3 | 4 | cousin of nomad |

Cousins-by-coincidence is fine but when two popular codenames collide we
prefer a rename during archetype naming (e.g. `wanderer` instead of a
second cousin of `scout`).

---

## 9. Snapshot worker — animated and still

For surfaces that cannot run WebGL (FleetBar macOS compact, email, OG
images, Slack unfurls) we expose an edge worker:

```
POST /shipwright/snapshot
  {
    identity: "port-daddy:fleet:spark",
    state:    "running" | "idle" | "selected" | "throttled" | "slashed" | "ghost",
    size:     "120x60"  | "256x128" | "512x256",
    mode:     "png"     | "gif"     | "apng" | "webp"
  }
  → image/*
```

### 9.1 Still frames (PNG)

Thin Node service loads `buildShip`, spins up a headless three-renderer
(Playwright over a prebuilt page works and gives us dither parity with
the live UI). Cache key = `sha1(identity+state+size+mode+grammarVer)`.

### 9.2 Animated GIF / APNG (FleetBar, README, Slack)

The user specifically wants to see bobbing ships and rolling water in
the macOS menu bar. FleetBar is SwiftUI; `NSImage` loads GIF, APNG, and
WebP. Strategy:

- Record 30 frames at 12 fps → **2.5s loop** (matches the sine-wave bob
  period + one water cycle so the loop has no visible seam).
- At our 5-color palette, GIF is almost lossless and compresses to
  ~10–20 KB per ship at 120×60. APNG at ~25 KB for smoother output.
- Worker uses `gifsicle` (pipe PNG frames → GIF with palette preset to
  our 5 colors) or Sharp's `webp` / `apng` encoders. No frame tweening,
  no extra smoothing — the dither crunch is the point.
- Cache the animated assets separately from stills (different blob
  storage path), same cache-key structure.

### 9.3 Long-term: native FleetBar rendering

Port the grammar + wave math to Swift and drive a `CALayer` tree
directly. No GIF round-trip, no cache, buttery on Apple Silicon. Shared
DTO: daemon's HTTP `/shipwright/plan/<identity>` returns the `ShipPlan`
JSON, Swift consumes it. That's a v2 item; GIFs unblock v1 today.

### 9.4 Cache invalidation

Grammar version bump (`SHIP_GRAMMAR_VERSION`) in `lib/ship-grammar.ts` <!-- cite-exempt -->
invalidates all keys. Daily TTL for animated assets (12-frame jitter is
fine; identity never changes within a day). Manual purge via
`pd shipwright snapshot --purge <identity>`.

---

## 10. What this grammar is not

- Not a physics sim. Bobbing is a sine wave.
- Not a general 3D style system. It is a narrow, opinionated voxel
  language scoped to agent vessels.
- Not themed by swapping palette entries. Palette stays; the dither
  output palette swaps for dark mode.
- Not something the user edits directly. Ship shape is a **consequence**
  of identity. If a shape does not feel right, rename the agent or the
  fleet — don't fork the grammar.

---

## 11. Open questions

1. **Collision-aware placement** across fleets — two agents with similar
   silhouettes sitting next to each other can confuse the eye. Possible
   fix: a subtle nameplate under the waterline.
2. **Damage states.** Should `slashed` permanently mar the silhouette
   (a tower goes missing for the session) or just paint a red stripe? V2.
3. **Non-ASCII names.** Rejected via regex for now. Transliterate later.
4. **Snapshot cache eviction.** TBD when we build it.

---

*End of SHIP-GRAMMAR.md. See `mocks/02-focus-mode.svg` for rendered
archetype examples and `mocks/06-spark-drift.svg` for the cross-fleet
spark comparison.*
