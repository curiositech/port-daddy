import { AgentShip } from './AgentShip';
import type { AgentCardThumbnailProps } from './types';

/**
 * AgentCardThumbnail - compact multi-ship thumbnail strip.
 *
 * WHY IT EXISTS: cards, FleetBar, and Slack/OG previews need many ships at
 * tiny scale. Rendering one WebGL canvas per card would hit browser context
 * limits, so the contract defaults to SVG and reserves R3F for a single shared
 * canvas implementation later.
 *
 * DESIGN NOTES: stable inline grid, no text labels, and fixed ship slots so
 * selection cannot resize the card.
 *
 * @example
 *   <AgentCardThumbnail
 *     identities={['port-daddy:fleet:spark', 'port-daddy:fleet:hawk']}
 *     selectedIdentity="port-daddy:fleet:hawk"
 *   />
 */
export function AgentCardThumbnail({
  identities,
  selectedIdentity,
  statusByIdentity = {},
  mode = 'svg',
  className,
  ariaLabel = 'agent ship thumbnails',
}: AgentCardThumbnailProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={className}
      data-thumbnail-mode={mode}
      role="img"
      style={{
        alignItems: 'end',
        display: 'grid',
        gap: '0.375rem',
        gridAutoColumns: 'minmax(3.75rem, 1fr)',
        gridAutoFlow: 'column',
        minHeight: '4rem',
      }}
    >
      {identities.map((identity) => (
        <AgentShip
          identity={identity}
          key={identity}
          scale={2}
          selected={identity === selectedIdentity}
          status={statusByIdentity[identity] ?? 'idle'}
          style={{ height: '3.5rem' }}
        />
      ))}
    </div>
  );
}
