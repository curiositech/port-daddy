/**
 * buildShip.js · JS port of lib/ship-grammar.ts for the preview page.
 *
 * WHY THIS FILE EXISTS
 *   The preview page needs to compute ships in the browser so the SVG
 *   thumbnails and the Three.js live demo read from the same grammar.
 *   Isomorphic to the TS implementation — same names, same math, same
 *   invariants. If the preview drifts from lib/ship-grammar.ts, the
 *   user sees lies.
 *
 * HOW TO USE
 *   import { buildShip, renderShipSVG, parseIdentity } from './buildShip.js';
 *   const plan = buildShip('port-daddy:fleet:spark');
 *   const svg  = renderShipSVG(plan, { scale: 3 });
 *   // insert svg into a <g> or wrap with <svg>...</svg> for rendering.
 */

// ---------- Palette, constants ------------------------------------------
export const PALETTE = Object.freeze([
  '#bf2f2f', // 0  Signal Red
  '#0055ff', // 1  Cobalt Blue
  '#dfff00', // 2  Cyber Yellow / acid lime
  '#121212', // 3  Obsidian Black
]);
export const HULL_NEUTRAL = '#cfc9bb';
export const SIGILS = Object.freeze([
  'chevron', 'bar', 'cross', 'ring',
  'dotPair', 'triangle', 'slash', 'doubleStripe',
]);

// ---------- Identity / hashing ------------------------------------------
/**
 * Parse `<fleet>:fleet:<agent>` into its two parts. Anchored on the
 * literal `:fleet:` segment so agent names with hyphens (like
 * `test-gap-hunter`) never mis-split.
 */
export function parseIdentity(identity) {
  const m = identity.match(/^([a-z0-9-]{2,64}):fleet:([a-z-]{2,32})$/);
  if (!m) {
    throw new Error(
      `ship-grammar: invalid identity "${identity}". ` +
      `Expected <fleet>:fleet:<agent>, e.g. port-daddy:fleet:spark.`
    );
  }
  return { fleet: m[1], agent: m[2] };
}

/** Count vowels. Y counts only when it follows a consonant. */
export function vowels(a) {
  const s = a.replace(/-/g, '').toLowerCase();
  let v = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], prev = s[i - 1];
    if ('aeiou'.includes(c)) v++;
    else if (c === 'y' && prev !== undefined && !'aeiou'.includes(prev)) v++;
  }
  return v;
}

/** Sum of ASCII char codes. Sufficient spread for a 4-bucket palette. */
export function hashFleet(f) {
  let h = 0;
  for (let i = 0; i < f.length; i++) h += f.charCodeAt(i);
  return h;
}

// ---------- Ship plan builder -------------------------------------------
/**
 * Build a ship plan from a canonical identity. Pure function.
 * Same input → identical output, every time, everywhere.
 */
export function buildShip(identity) {
  const { fleet, agent } = parseIdentity(identity);
  const A = agent.replace(/-/g, '');
  const L_a = A.length;
  const V_a = vowels(agent);
  const C_a = L_a - V_a;

  const H_f = hashFleet(fleet);
  const primaryIdx = H_f % 4;
  const colorPrimary = PALETTE[primaryIdx];

  let accentIdx = (H_f + L_a) % 4;
  if (accentIdx === primaryIdx) accentIdx = (accentIdx + 1) % 4;
  const colorAccent = PALETTE[accentIdx];

  let trimIdx = (H_f * 13 + L_a * 7) % 4;
  if (trimIdx === primaryIdx) trimIdx = (trimIdx + 1) % 4;
  const colorTrim = PALETTE[trimIdx];

  const scaleDrift = (H_f % 3) + 1;
  const sigil = SIGILS[(H_f * 37) % 8];

  const mainW = (L_a % 3) * 2 + 3;
  const mainD = L_a * 4;
  const mainframe = { w: mainW, h: 2, d: mainD, x: 0, y: 0, z: 0, color: HULL_NEUTRAL };

  const prowD = V_a * 3;
  const prow = {
    w: mainW - 2, h: 2, d: prowD,
    x: 0, y: 0, z: mainD / 2 + prowD / 2, color: HULL_NEUTRAL,
  };

  const coreH = scaleDrift * 2;
  const core = {
    w: mainW - 2, h: coreH, d: 4,
    x: 0, y: 1 + coreH / 2, z: 0, color: colorPrimary,
  };

  const clusterCount = (L_a % 3) + 1;
  const clusters = [];
  for (let i = 0; i < clusterCount; i++) {
    clusters.push({
      w: 2, h: 2, d: 2,
      x: 0, y: 2, z: 4 / 2 + 2 + i * 3, color: colorAccent,
    });
  }

  const towers = [];
  const towerH = C_a + scaleDrift;
  for (let i = 0; i < C_a; i++) {
    const row = Math.floor(i / 2), col = i % 2;
    towers.push({
      w: 1, h: towerH, d: 1,
      x: col === 0 ? -0.75 : 0.75,
      y: 1 + towerH / 2,
      z: -(4 / 2 + 1 + row * 1.5),
      color: PALETTE[3],
    });
  }

  const nacelles = [];
  const nacL = L_a + 2;
  const nacPerSide = Math.min(V_a, 3);
  for (const side of [-1, 1]) {
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

  const trimStripe = {
    w: mainW - 0.25, h: 0.5, d: mainD + prowD,
    x: 0, y: 2 / 2 + 0.25, z: prowD / 2, color: colorTrim,
  };

  return {
    identity, fleet, agent,
    metrics: { L_a, V_a, C_a, H_f, colorPrimary, colorAccent, colorTrim, scaleDrift, sigil },
    mainframe, prow, core, clusters, towers, nacelles, trimStripe, sigil,
  };
}

// ---------- Side-profile SVG renderer -----------------------------------
/**
 * Render a side-view SVG fragment for a ship plan (no wrapper element).
 * The 3D ship is rendered by Three.js elsewhere; this is the fast
 * thumbnail used in the static showcase.
 */
export function renderShipSVG(plan, opts = {}) {
  const { scale = 3, ghost = false } = opts;
  const { mainframe, prow, core, clusters, towers, nacelles, sigil, metrics } = plan;
  const stroke = ghost ? '#67645d' : '#121212';
  const dashAttr = ghost ? 'stroke-dasharray="2 2"' : '';
  const S = scale;
  const hullLen = mainframe.d * S;
  const prowLen = prow.d * S;
  const hullH = mainframe.h * S;
  const coreH = core.h * S;
  const coreD = core.d * S;
  const towerH = (towers[0]?.h ?? 0) * S;
  const baselineY = 0;
  const hullTopY = baselineY - hullH;
  const coreTopY = hullTopY - coreH;
  const hullCenterX = hullLen / 2;

  let out = '';

  // Nacelles just below hull, aft-aligned
  const nacPerSide = nacelles.length / 2;
  for (let i = 0; i < nacPerSide; i++) {
    const y = baselineY + 2 + i * 3;
    out += `<rect x="0" y="${y}" width="${(metrics.L_a + 2) * S}" height="2.5" ` +
           `fill="${ghost ? 'none' : core.color}" stroke="${stroke}" stroke-width="0.5" ${dashAttr}/>`;
  }

  // Hull body
  out += `<rect x="0" y="${hullTopY}" width="${hullLen}" height="${hullH}" ` +
         `fill="${ghost ? 'none' : mainframe.color}" stroke="${stroke}" stroke-width="1" ${dashAttr}/>`;
  // Prow triangle (right-pointing)
  out += `<polygon points="${hullLen},${hullTopY} ${hullLen},${baselineY} ${hullLen + prowLen},${hullTopY + hullH*0.75}" ` +
         `fill="${ghost ? 'none' : prow.color}" stroke="${stroke}" stroke-width="1" ${dashAttr}/>`;
  // Trim stripe along top of hull
  if (!ghost) {
    out += `<line x1="0" y1="${hullTopY + 1.2}" x2="${hullLen + prowLen * 0.7}" y2="${hullTopY + 1.2}" ` +
           `stroke="${metrics.colorTrim}" stroke-width="1.5"/>`;
  }

  // Towers aft of core
  const towerSpacing = 2.2;
  for (let i = 0; i < towers.length; i++) {
    const row = Math.floor(i / 2), col = i % 2;
    const tx = hullCenterX - coreD / 2 - 2 - row * towerSpacing - col * 0.8;
    const ty = hullTopY - towerH;
    out += `<rect x="${tx}" y="${ty}" width="${1.5}" height="${towerH}" ` +
           `fill="${ghost ? 'none' : towers[i].color}" stroke="${stroke}" stroke-width="0.3" ${dashAttr}/>`;
  }

  // DaemonCore
  const coreX = hullCenterX - coreD / 2;
  out += `<rect x="${coreX}" y="${coreTopY}" width="${coreD}" height="${coreH}" ` +
         `fill="${ghost ? 'none' : core.color}" stroke="${stroke}" stroke-width="1" ${dashAttr}/>`;

  // Sigil on core front face
  if (!ghost) {
    const sigilCX = coreX + coreD - 3;
    const sigilCY = coreTopY + coreH / 2;
    out += renderSigilSVG(sigil, sigilCX, sigilCY, Math.min(3, coreH / 4), metrics.colorAccent);
  }

  // Clusters forward of core
  for (let i = 0; i < clusters.length; i++) {
    const cx = hullCenterX + coreD / 2 + 2 + i * 5;
    const cy = hullTopY - 5;
    out += `<rect x="${cx}" y="${cy}" width="5" height="5" ` +
           `fill="${ghost ? 'none' : clusters[i].color}" stroke="${stroke}" stroke-width="0.5" ${dashAttr}/>`;
  }

  return out;
}

/** 8 sigil glyphs, centered at (cx, cy), extent ~size, in given color. */
export function renderSigilSVG(sigil, cx, cy, size, color) {
  const s = size;
  const sw = Math.max(1, s / 3);
  const st = `stroke="${color}" stroke-width="${sw}" fill="none" stroke-linecap="square"`;
  switch (sigil) {
    case 'chevron':
      return `<polyline points="${cx-s},${cy+s*0.6} ${cx},${cy-s*0.6} ${cx+s},${cy+s*0.6}" ${st}/>`;
    case 'bar':
      return `<line x1="${cx-s}" y1="${cy}" x2="${cx+s}" y2="${cy}" ${st}/>`;
    case 'cross':
      return `<line x1="${cx-s}" y1="${cy}" x2="${cx+s}" y2="${cy}" ${st}/>` +
             `<line x1="${cx}" y1="${cy-s}" x2="${cx}" y2="${cy+s}" ${st}/>`;
    case 'ring':
      return `<circle cx="${cx}" cy="${cy}" r="${s}" ${st}/>`;
    case 'dotPair':
      return `<circle cx="${cx-s*0.6}" cy="${cy}" r="${sw}" fill="${color}"/>` +
             `<circle cx="${cx+s*0.6}" cy="${cy}" r="${sw}" fill="${color}"/>`;
    case 'triangle':
      return `<polygon points="${cx},${cy-s} ${cx+s},${cy+s*0.8} ${cx-s},${cy+s*0.8}" fill="${color}"/>`;
    case 'slash':
      return `<line x1="${cx-s}" y1="${cy+s}" x2="${cx+s}" y2="${cy-s}" ${st}/>`;
    case 'doubleStripe':
      return `<line x1="${cx-s}" y1="${cy-s*0.4}" x2="${cx+s}" y2="${cy-s*0.4}" ${st}/>` +
             `<line x1="${cx-s}" y1="${cy+s*0.4}" x2="${cx+s}" y2="${cy+s*0.4}" ${st}/>`;
    default:
      return '';
  }
}
