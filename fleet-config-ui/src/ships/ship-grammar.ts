/**
 * ship-grammar.ts - deterministic Shipwright ship plans.
 *
 * WHY IT EXISTS: Shipwright needs one visual grammar that works in rich
 * WebGL scenes, SVG fallbacks, snapshot workers, and tests. Keeping the
 * grammar as plain data prevents the future R3F renderer from becoming the
 * only source of truth, and it lets FleetBar use the same identity-to-ship
 * mapping without opening a WebGL context.
 *
 * @example
 *   const plan = buildShip('port-daddy:fleet:spark');
 *   const svg = renderShipSvgFragment(plan, { scale: 3 });
 */

export const SHIP_PALETTE = [
  '#bf2f2f',
  '#0055ff',
  '#dfff00',
  '#121212',
] as const;

export const HULL_NEUTRAL = '#cfc9bb';

export const SHIP_SIGILS = [
  'chevron',
  'bar',
  'cross',
  'ring',
  'dotPair',
  'triangle',
  'slash',
  'doubleStripe',
] as const;

export type ShipSigil = (typeof SHIP_SIGILS)[number];

export interface ShipBlock {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface ShipPlan {
  identity: string;
  fleet: string;
  agent: string;
  metrics: {
    L_a: number;
    V_a: number;
    C_a: number;
    H_f: number;
    colorPrimary: string;
    colorAccent: string;
    colorTrim: string;
    scaleDrift: number;
    sigil: ShipSigil;
  };
  mainframe: ShipBlock;
  prow: ShipBlock;
  core: ShipBlock;
  clusters: ShipBlock[];
  towers: ShipBlock[];
  nacelles: ShipBlock[];
  trimStripe: ShipBlock;
  sigil: ShipSigil;
}

export interface ParsedShipIdentity {
  fleet: string;
  agent: string;
}

export interface ShipSvgOptions {
  scale?: number;
  ghost?: boolean;
}

export function parseShipIdentity(identity: string): ParsedShipIdentity {
  const match = identity.match(/^([a-z0-9-]{2,64}):fleet:([a-z-]{2,32})$/);
  if (!match) {
    throw new Error(
      `ship-grammar: invalid identity "${identity}". Expected <fleet>:fleet:<agent>.`,
    );
  }
  return { fleet: match[1], agent: match[2] };
}

export function countShipVowels(agentName: string): number {
  const compact = agentName.replace(/-/g, '').toLowerCase();
  let count = 0;
  for (let index = 0; index < compact.length; index += 1) {
    const char = compact[index];
    const previous = compact[index - 1];
    if ('aeiou'.includes(char)) {
      count += 1;
    } else if (char === 'y' && previous !== undefined && !'aeiou'.includes(previous)) {
      count += 1;
    }
  }
  return count;
}

export function hashShipFleet(fleetName: string): number {
  let hash = 0;
  for (let index = 0; index < fleetName.length; index += 1) {
    hash += fleetName.charCodeAt(index);
  }
  return hash;
}

export function buildShip(identity: string): ShipPlan {
  const { fleet, agent } = parseShipIdentity(identity);
  const compactAgent = agent.replace(/-/g, '');
  const L_a = compactAgent.length;
  const V_a = countShipVowels(agent);
  const C_a = L_a - V_a;

  const H_f = hashShipFleet(fleet);
  const primaryIndex = H_f % SHIP_PALETTE.length;
  const colorPrimary = SHIP_PALETTE[primaryIndex];

  let accentIndex = (H_f + L_a) % SHIP_PALETTE.length;
  if (accentIndex === primaryIndex) {
    accentIndex = (accentIndex + 1) % SHIP_PALETTE.length;
  }
  const colorAccent = SHIP_PALETTE[accentIndex];

  let trimIndex = (H_f * 13 + L_a * 7) % SHIP_PALETTE.length;
  if (trimIndex === primaryIndex) {
    trimIndex = (trimIndex + 1) % SHIP_PALETTE.length;
  }
  const colorTrim = SHIP_PALETTE[trimIndex];

  const scaleDrift = (H_f % 3) + 1;
  const sigil = SHIP_SIGILS[(H_f * 37) % SHIP_SIGILS.length];
  const mainW = (L_a % 3) * 2 + 3;
  const mainD = L_a * 4;
  const prowD = V_a * 3;
  const coreH = scaleDrift * 2;

  const mainframe: ShipBlock = {
    w: mainW,
    h: 2,
    d: mainD,
    x: 0,
    y: 0,
    z: 0,
    color: HULL_NEUTRAL,
  };

  const prow: ShipBlock = {
    w: mainW - 2,
    h: 2,
    d: prowD,
    x: 0,
    y: 0,
    z: mainD / 2 + prowD / 2,
    color: HULL_NEUTRAL,
  };

  const core: ShipBlock = {
    w: mainW - 2,
    h: coreH,
    d: 4,
    x: 0,
    y: 1 + coreH / 2,
    z: 0,
    color: colorPrimary,
  };

  const clusters: ShipBlock[] = [];
  const clusterCount = (L_a % 3) + 1;
  for (let index = 0; index < clusterCount; index += 1) {
    clusters.push({
      w: 2,
      h: 2,
      d: 2,
      x: 0,
      y: 2,
      z: 4 + index * 3,
      color: colorAccent,
    });
  }

  const towers: ShipBlock[] = [];
  const towerH = C_a + scaleDrift;
  for (let index = 0; index < C_a; index += 1) {
    const row = Math.floor(index / 2);
    const column = index % 2;
    towers.push({
      w: 1,
      h: towerH,
      d: 1,
      x: column === 0 ? -0.75 : 0.75,
      y: 1 + towerH / 2,
      z: -(3 + row * 1.5),
      color: SHIP_PALETTE[3],
    });
  }

  const nacelles: ShipBlock[] = [];
  const nacelleLength = L_a + 2;
  const nacellesPerSide = Math.min(V_a, 3);
  for (const side of [-1, 1] as const) {
    for (let index = 0; index < nacellesPerSide; index += 1) {
      nacelles.push({
        w: 1,
        h: 1,
        d: nacelleLength,
        x: side * (mainW / 2 + 0.5),
        y: 0.5 + index * 1.25,
        z: -mainD / 2 + nacelleLength / 2,
        color: colorPrimary,
      });
    }
  }

  const trimStripe: ShipBlock = {
    w: mainW - 0.25,
    h: 0.5,
    d: mainD + prowD,
    x: 0,
    y: 1.25,
    z: prowD / 2,
    color: colorTrim,
  };

  return {
    identity,
    fleet,
    agent,
    metrics: {
      L_a,
      V_a,
      C_a,
      H_f,
      colorPrimary,
      colorAccent,
      colorTrim,
      scaleDrift,
      sigil,
    },
    mainframe,
    prow,
    core,
    clusters,
    towers,
    nacelles,
    trimStripe,
    sigil,
  };
}

export function shipSvgViewBox(plan: ShipPlan, scale = 3): string {
  const width = (plan.mainframe.d + plan.prow.d + 8) * scale;
  const tallestTower = Math.max(0, ...plan.towers.map((tower) => tower.h));
  const minY = -(plan.mainframe.h + plan.core.h + tallestTower + 8) * scale;
  const height = Math.abs(minY) + 18 * scale;
  return `${-4 * scale} ${minY} ${width} ${height}`;
}

export function renderShipSvgFragment(plan: ShipPlan, opts: ShipSvgOptions = {}): string {
  const scale = opts.scale ?? 3;
  const ghost = opts.ghost ?? false;
  const stroke = ghost ? '#67645d' : '#121212';
  const dashAttr = ghost ? ' stroke-dasharray="2 2"' : '';
  const hullLength = plan.mainframe.d * scale;
  const prowLength = plan.prow.d * scale;
  const hullHeight = plan.mainframe.h * scale;
  const coreHeight = plan.core.h * scale;
  const coreDepth = plan.core.d * scale;
  const towerHeight = (plan.towers[0]?.h ?? 0) * scale;
  const baselineY = 0;
  const hullTopY = baselineY - hullHeight;
  const coreTopY = hullTopY - coreHeight;
  const hullCenterX = hullLength / 2;
  const fillOrNone = (color: string) => (ghost ? 'none' : color);

  let output = '';
  const nacellesPerSide = plan.nacelles.length / 2;
  for (let index = 0; index < nacellesPerSide; index += 1) {
    const y = baselineY + 2 + index * 3;
    output += `<rect x="0" y="${y}" width="${(plan.metrics.L_a + 2) * scale}" height="2.5" fill="${fillOrNone(plan.core.color)}" stroke="${stroke}" stroke-width="0.5"${dashAttr}/>`;
  }

  output += `<rect x="0" y="${hullTopY}" width="${hullLength}" height="${hullHeight}" fill="${fillOrNone(plan.mainframe.color)}" stroke="${stroke}" stroke-width="1"${dashAttr}/>`;
  output += `<polygon points="${hullLength},${hullTopY} ${hullLength},${baselineY} ${hullLength + prowLength},${hullTopY + hullHeight * 0.75}" fill="${fillOrNone(plan.prow.color)}" stroke="${stroke}" stroke-width="1"${dashAttr}/>`;

  if (!ghost) {
    output += `<line x1="0" y1="${hullTopY + 1.2}" x2="${hullLength + prowLength * 0.7}" y2="${hullTopY + 1.2}" stroke="${plan.metrics.colorTrim}" stroke-width="1.5"/>`;
  }

  for (let index = 0; index < plan.towers.length; index += 1) {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const tx = hullCenterX - coreDepth / 2 - 2 - row * 2.2 - column * 0.8;
    const ty = hullTopY - towerHeight;
    output += `<rect x="${tx}" y="${ty}" width="1.5" height="${towerHeight}" fill="${fillOrNone(plan.towers[index].color)}" stroke="${stroke}" stroke-width="0.3"${dashAttr}/>`;
  }

  const coreX = hullCenterX - coreDepth / 2;
  output += `<rect x="${coreX}" y="${coreTopY}" width="${coreDepth}" height="${coreHeight}" fill="${fillOrNone(plan.core.color)}" stroke="${stroke}" stroke-width="1"${dashAttr}/>`;

  if (!ghost) {
    output += renderShipSigilSvg(
      plan.sigil,
      coreX + coreDepth - 3,
      coreTopY + coreHeight / 2,
      Math.min(3, coreHeight / 4),
      plan.metrics.colorAccent,
    );
  }

  for (let index = 0; index < plan.clusters.length; index += 1) {
    const cx = hullCenterX + coreDepth / 2 + 2 + index * 5;
    const cy = hullTopY - 5;
    output += `<rect x="${cx}" y="${cy}" width="5" height="5" fill="${fillOrNone(plan.clusters[index].color)}" stroke="${stroke}" stroke-width="0.5"${dashAttr}/>`;
  }

  return output;
}

function renderShipSigilSvg(sigil: ShipSigil, cx: number, cy: number, size: number, color: string): string {
  const strokeWidth = Math.max(1, size / 3);
  const stroke = `stroke="${color}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="square"`;
  switch (sigil) {
    case 'chevron':
      return `<polyline points="${cx - size},${cy + size * 0.6} ${cx},${cy - size * 0.6} ${cx + size},${cy + size * 0.6}" ${stroke}/>`;
    case 'bar':
      return `<line x1="${cx - size}" y1="${cy}" x2="${cx + size}" y2="${cy}" ${stroke}/>`;
    case 'cross':
      return `<line x1="${cx - size}" y1="${cy}" x2="${cx + size}" y2="${cy}" ${stroke}/><line x1="${cx}" y1="${cy - size}" x2="${cx}" y2="${cy + size}" ${stroke}/>`;
    case 'ring':
      return `<circle cx="${cx}" cy="${cy}" r="${size}" ${stroke}/>`;
    case 'dotPair':
      return `<circle cx="${cx - size * 0.6}" cy="${cy}" r="${strokeWidth}" fill="${color}"/><circle cx="${cx + size * 0.6}" cy="${cy}" r="${strokeWidth}" fill="${color}"/>`;
    case 'triangle':
      return `<polygon points="${cx},${cy - size} ${cx + size},${cy + size * 0.8} ${cx - size},${cy + size * 0.8}" fill="${color}"/>`;
    case 'slash':
      return `<line x1="${cx - size}" y1="${cy + size}" x2="${cx + size}" y2="${cy - size}" ${stroke}/>`;
    case 'doubleStripe':
      return `<line x1="${cx - size}" y1="${cy - size * 0.4}" x2="${cx + size}" y2="${cy - size * 0.4}" ${stroke}/><line x1="${cx - size}" y1="${cy + size * 0.4}" x2="${cx + size}" y2="${cy + size * 0.4}" ${stroke}/>`;
  }
}
