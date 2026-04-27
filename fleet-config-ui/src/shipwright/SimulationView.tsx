import type { ShipwrightDataResult, ShipwrightProposal, SimulationState } from './types';
import { formatUsd } from './helpers';
import { AgentShipStrip, HardCard, Metric, SourceBadge } from './primitives';

/**
 * SimulationView - deterministic dry-run event review.
 *
 * WHY IT EXISTS: Shipwright proposals should be rehearsed before they mutate
 * the repo. This view keeps time, cost, file writes, and agent activation in a
 * single replay surface until the real SSE canvas lands.
 *
 * @example
 *   <SimulationView simulation={simulationResult} proposal={proposalResult} />
 */
export function SimulationView({
  simulation,
  proposal,
}: {
  simulation: ShipwrightDataResult<SimulationState>;
  proposal: ShipwrightDataResult<ShipwrightProposal>;
}) {
  const totalUsd = simulation.data.events.reduce((sum, event) => sum + (event.usd ?? 0), 0);
  const fileWrites = simulation.data.events.filter((event) => event.type === 'file.write').length;

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <HardCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45">SIMULATION</div>
            <h2 className="mt-1 text-xl font-semibold">{simulation.data.hours}h dry-run at {simulation.data.speed}x</h2>
          </div>
          <SourceBadge result={simulation} />
        </div>
        <AgentShipStrip className="mt-4" projectName={proposal.data.fleet.project} agents={proposal.data.fleet.agents} />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric label="Events" value={String(simulation.data.events.length)} />
          <Metric label="Writes" value={String(fileWrites)} />
          <Metric label="Escrowed" value={formatUsd(totalUsd)} />
        </div>
      </HardCard>

      <HardCard>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45">TIMELINE</div>
        <div className="mt-4 space-y-3">
          {simulation.data.events.map((event) => (
            <div className="border-l-2 pl-3" key={event.id} style={{ borderColor: 'var(--pd-border)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{event.type}</span>
                <span className="text-[10px] font-mono opacity-55">{Math.round(event.atMs / 1000)}s</span>
              </div>
              <div className="mt-1 text-[12px] leading-relaxed opacity-75">{event.message ?? event.path ?? event.agentId ?? 'event'}</div>
              {event.path && (
                <div className="mt-1 text-[10px] font-mono" style={{ color: 'var(--pd-muted)' }}>{event.path}</div>
              )}
            </div>
          ))}
        </div>
      </HardCard>
    </section>
  );
}
