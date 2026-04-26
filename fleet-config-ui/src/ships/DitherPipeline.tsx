import type { DitherPipelineProps } from './types';

const DEFAULT_DITHER_PALETTE = ['#f2eee6', '#121212', '#bf2f2f', '#0055ff', '#dfff00'] as const;

/**
 * DitherPipeline - named boundary for bloom-then-Bayer postprocessing.
 *
 * WHY IT EXISTS: the R3F implementation needs an explicit place for the
 * EffectComposer stack. This wrapper keeps the contract visible today while
 * staying dependency-free until the renderer package decision is made.
 *
 * DESIGN NOTES: enabled=false is a legal no-op for reduced-motion, snapshot,
 * and server-rendered views. The palette is exposed as data for inspection.
 *
 * @example
 *   <DitherPipeline enabled>
 *     <FleetStage />
 *   </DitherPipeline>
 */
export function DitherPipeline({
  children,
  palette = DEFAULT_DITHER_PALETTE,
  enabled = true,
  className,
}: DitherPipelineProps) {
  return (
    <div
      className={className}
      data-dither-enabled={enabled ? 'true' : 'false'}
      data-dither-palette={palette.join(',')}
    >
      {children}
    </div>
  );
}
