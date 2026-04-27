import type { ProjectSurvey, ShipwrightDataResult, ShipwrightProposal } from './types';
import { formatUsd } from './helpers';
import { AgentShipStrip, HardCard, ListBlock, Metric, SourceBadge } from './primitives';

/**
 * FocusView - one project's Shipwright proposal.
 *
 * WHY IT EXISTS: Harbor answers where to look; Focus answers what Shipwright
 * would build. Keeping proposal rationale, risks, opportunities, and bounded
 * agent cards together prevents the operator from mistaking a pretty fleet for
 * an approved fleet.
 *
 * @example
 *   <FocusView survey={survey} proposal={proposalResult} />
 */
export function FocusView({
  survey,
  proposal,
}: {
  survey?: ProjectSurvey;
  proposal: ShipwrightDataResult<ShipwrightProposal>;
}) {
  const fleet = proposal.data.fleet;
  const totalBond = fleet.agents.reduce((sum, agent) => sum + agent.bondUsd, 0);
  const totalAgentBudget = fleet.agents.reduce((sum, agent) => sum + agent.budgetUsdPerDay, 0);

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <HardCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45">FOCUS</div>
            <h2 className="mt-1 text-2xl font-semibold">{survey?.project ?? fleet.project}</h2>
          </div>
          <SourceBadge result={proposal} />
        </div>
        <p className="mt-3 text-sm leading-relaxed opacity-80">{survey?.intent ?? proposal.data.rationale}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Metric label="Activity" value={survey?.status.activity ?? 'n/a'} />
          <Metric label="Commits" value={String(survey?.status.commitsLast30d ?? 0)} />
          <Metric label="Daily cap" value={formatUsd(fleet.limits.budgetUsdPerDay)} />
          <Metric label="Confidence" value={`${Math.round(proposal.data.confidence * 100)}%`} />
        </div>
        {survey && (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ListBlock title="Risks" items={survey.risks} tone="warning" />
            <ListBlock title="Opportunities" items={survey.opportunities} tone="success" />
          </div>
        )}
      </HardCard>

      <HardCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45">PROPOSAL</div>
            <h2 className="mt-1 text-xl font-semibold">{fleet.agents.length} agent fleet</h2>
          </div>
          <span className="text-[10px] font-mono opacity-60">{proposal.data.exemplarId ?? 'no exemplar'}</span>
        </div>
        <AgentShipStrip className="mt-4" projectName={fleet.project} agents={fleet.agents} />
        <p className="mt-4 text-sm leading-relaxed opacity-80">{proposal.data.rationale}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Metric label="Agent budgets" value={formatUsd(totalAgentBudget)} />
          <Metric label="Escrow" value={formatUsd(totalBond)} />
          <Metric label="Max spawns/hr" value={String(fleet.limits.maxSpawnsPerHour)} />
        </div>
      </HardCard>

      <div className="xl:col-span-2">
        <HardCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-45">PROPOSED AGENTS</div>
              <h2 className="mt-1 text-lg font-semibold">Bounded search result</h2>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fleet.agents.map((agent) => (
              <article
                className="p-3"
                key={agent.id}
                style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)', borderRadius: 0 }}
              >
                <div className="text-sm font-semibold">{agent.id}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-muted)' }}>
                  {agent.archetype} / {agent.backend} / {agent.model}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed opacity-75">{agent.rationale}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {agent.skills.slice(0, 3).map((skill) => (
                    <span className="px-2 py-1 text-[10px]" key={skill} style={{ backgroundColor: 'var(--pd-surface-3)', border: '1px solid var(--pd-border)', borderRadius: 0, color: 'var(--pd-muted)' }}>
                      {skill}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </HardCard>
      </div>
    </section>
  );
}
