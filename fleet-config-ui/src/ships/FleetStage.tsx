import type { FleetStageProps } from './types';

/**
 * FleetStage - contract shell for the eventual water-plane scene.
 *
 * WHY IT EXISTS: Shipwright needs a stable outer frame before R3F lands so
 * Harbor, Focus, and Simulation views can agree on scene sizing and reduced
 * motion behavior. The actual shader plane remains a Track 3c implementation
 * detail behind this boundary.
 *
 * DESIGN NOTES: no gradients, no rounded frame, and no decorative wrapper.
 * Children occupy a fixed stage with hard ink borders.
 *
 * @example
 *   <FleetStage reducedMotion>
 *     <AgentShip identity="port-daddy:fleet:spark" />
 *   </FleetStage>
 */
export function FleetStage({ children, reducedMotion = false, className, style }: FleetStageProps) {
  return (
    <section
      className={className}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-ship-stage="contract"
      style={{
        alignItems: 'center',
        backgroundColor: 'var(--pd-surface)',
        border: '2px solid var(--pd-border)',
        boxShadow: '5px 5px 0 var(--pd-border)',
        display: 'grid',
        minHeight: '18rem',
        overflow: 'hidden',
        placeItems: 'center',
        position: 'relative',
        ...style,
      }}
    >
      {children}
    </section>
  );
}
