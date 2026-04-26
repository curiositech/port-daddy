import { useMemo } from 'react';
import {
  buildShip,
  renderShipSvgFragment,
  shipSvgViewBox,
} from './ship-grammar';
import type { AgentShipProps } from './types';

/**
 * AgentShip - contract-first ship renderer with an SVG fallback.
 *
 * WHY IT EXISTS: the full Shipwright renderer will be R3F, but FleetBar,
 * tests, and low-power views still need a no-WebGL path. This component
 * makes the future renderer consume the same ShipPlan as the fallback,
 * preventing geometry drift between thumbnail and live-scene surfaces.
 *
 * DESIGN NOTES: SVG uses the five-color Shipwright palette and hard ink
 * strokes. Motion is only advertised through data attributes here; R3F owns
 * bob, roll, bloom, and dither in the implementation pass.
 *
 * @example
 *   <AgentShip identity="port-daddy:fleet:spark" status="running" selected />
 */
export function AgentShip({
  identity,
  status = 'idle',
  selected = false,
  reducedMotion = false,
  scale = 3,
  plan,
  className,
  style,
  ariaLabel,
}: AgentShipProps) {
  const shipPlan = useMemo(() => plan ?? buildShip(identity), [identity, plan]);
  const ghost = status === 'ghost';
  const svgFragment = useMemo(
    () => renderShipSvgFragment(shipPlan, { scale, ghost }),
    [ghost, scale, shipPlan],
  );
  const viewBox = useMemo(() => shipSvgViewBox(shipPlan, scale), [scale, shipPlan]);
  const label = ariaLabel ?? `${shipPlan.fleet} ${shipPlan.agent} ship`;

  return (
    <figure
      aria-label={label}
      className={className}
      data-ship-identity={shipPlan.identity}
      data-ship-renderer="svg-contract"
      data-ship-state={selected ? 'selected' : status}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      role="img"
      style={{
        display: 'inline-block',
        margin: 0,
        minWidth: '5rem',
        ...style,
      }}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={viewBox}
        style={{
          display: 'block',
          height: '100%',
          maxHeight: '7rem',
          overflow: 'visible',
          width: '100%',
        }}
      >
        <g dangerouslySetInnerHTML={{ __html: svgFragment }} />
      </svg>
    </figure>
  );
}
