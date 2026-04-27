import type { ShipwrightDataResult, ShipwrightProposal, SimulationState } from './types';
import { formatUsd } from './helpers';
import { HardCard, Metric, SourceBadge } from './primitives';

/**
 * FleetControlView - budget and bond cockpit for a proposed fleet.
 *
 * WHY IT EXISTS: Shipwright cannot be a launch button with a boat costume.
 * Operators need the proposed budget envelope, bond exposure, and dry-run
 * evidence adjacent to the proposal before any future apply route can be safe.
 *
 * @example
 *   <FleetControlView proposal={proposalResult} simulation={simulationResult} />
 */
export function FleetControlView({
  proposal,
  simulation,
}: {
  proposal: ShipwrightDataResult<ShipwrightProposal>;
  simulation: ShipwrightDataResult<SimulationState>;
}) {
  const fleet = proposal.data.fleet;
  const totalBond = fleet.agents.reduce((sum, agent) => sum + agent.bondUsd, 0);
  const totalBudget = fleet.agents.reduce((sum, agent) => sum + agent.budgetUsdPerDay, 0);
  const violations = simulation.data.events.filter((event) => event.type === 'arbiter.violation' || event.type === 'bond.slash');

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <HardCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45">FLEETCONTROL</div>
            <h2 className="mt-1 text-xl font-semibold">Envelope</h2>
          </div>
          <SourceBadge result={proposal} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Metric label="Daily cap" value={formatUsd(fleet.limits.budgetUsdPerDay)} />
          <Metric label="Agent budgets" value={formatUsd(totalBudget)} />
          <Metric label="Bond ceiling" value={formatUsd(fleet.limits.bondCeilingUsd)} />
          <Metric label="Escrow total" value={formatUsd(totalBond)} />
          <Metric label="Concurrent" value={String(fleet.limits.maxConcurrentSpawns)} />
          <Metric label="Spawns/hr" value={String(fleet.limits.maxSpawnsPerHour)} />
        </div>
      </HardCard>

      <HardCard>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45">DRY-RUN VERDICT</div>
        <h2 className="mt-1 text-xl font-semibold">{violations.length === 0 ? 'Clean rehearsal' : `${violations.length} intervention events`}</h2>
        <div className="mt-4 space-y-3">
          {fleet.agents.map((agent) => (
            <div className="grid gap-2 p-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem]" key={agent.id} style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)', borderRadius: 0 }}>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{agent.id}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--pd-muted)' }}>
                  {agent.trigger.kind}
                </div>
              </div>
              <div className="font-mono text-sm">{formatUsd(agent.budgetUsdPerDay)}</div>
              <div className="font-mono text-sm">{formatUsd(agent.bondUsd)}</div>
            </div>
          ))}
        </div>
      </HardCard>
    </section>
  );
}
