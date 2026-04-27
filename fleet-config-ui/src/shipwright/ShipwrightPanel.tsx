import { useCallback, useMemo, useState } from 'react';
import { AgentCardThumbnail } from '../ships';
import {
  fixtureMessages,
  fixtureProposal,
  fixtureSimulation,
  fixtureSurveys,
} from './fixtures';
import {
  loadShipwrightChat,
  loadShipwrightProposal,
  loadShipwrightSurveys,
  startShipwrightSimulation,
} from './api';
import type {
  ProjectSurvey,
  ShipwrightDataResult,
  ShipwrightMessage,
  ShipwrightProposal,
  SimulationState,
} from './types';

interface ShipwrightPanelProps {
  projectDir?: string;
  projectName?: string | null;
}

interface ShipwrightPanelState {
  surveys: ShipwrightDataResult<ProjectSurvey[]>;
  proposal: ShipwrightDataResult<ShipwrightProposal>;
  simulation: ShipwrightDataResult<SimulationState>;
  messages: ShipwrightDataResult<ShipwrightMessage[]>;
}

function initialState(projectDir?: string): ShipwrightPanelState {
  const surveys = projectDir
    ? fixtureSurveys.filter((survey) => survey.root === projectDir || survey.project === projectDir)
    : fixtureSurveys;
  return {
    surveys: { data: surveys.length > 0 ? surveys : fixtureSurveys, fixture: true, source: 'fixture' },
    proposal: { data: { ...fixtureProposal, projectDir: projectDir ?? fixtureProposal.projectDir }, fixture: true, source: 'fixture' },
    simulation: { data: { ...fixtureSimulation, projectDir: projectDir ?? fixtureSimulation.projectDir }, fixture: true, source: 'fixture' },
    messages: { data: fixtureMessages.map((message) => ({ ...message, projectDir: projectDir ?? message.projectDir })), fixture: true, source: 'fixture' },
  };
}

function slugForFleetIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'project';
}

function sourceLabel(result: { fixture: boolean; source: string }): string {
  return result.fixture ? 'Fixture data' : 'Daemon data';
}

/**
 * ShipwrightPanel - first visible Fleet Control Center surface for Shipwright.
 *
 * WHY IT EXISTS: Track 3 needed to leave docs-only territory without waiting on
 * daemon `/shipwright/*` routes. This panel renders the real typed contract with
 * obvious fixture labels, so designers and backend work can converge on one UI
 * shape instead of separate mockups.
 *
 * DESIGN NOTES: it stays inside the existing Fleet UI shell, uses current
 * `--pd-*` tokens, and relies on SVG ship thumbnails until the R3F renderer
 * lands.
 *
 * @example
 *   <ShipwrightPanel
 *     projectDir="/Users/erichowens/coding/port-daddy"
 *     projectName="port-daddy"
 *   />
 */
export default function ShipwrightPanel({ projectDir, projectName }: ShipwrightPanelProps) {
  const [state, setState] = useState<ShipwrightPanelState>(() => initialState(projectDir));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const targetProject = projectDir ?? fixtureProposal.projectDir;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const [surveys, proposal, simulation, messages] = await Promise.all([
        loadShipwrightSurveys(projectDir),
        loadShipwrightProposal(targetProject),
        startShipwrightSimulation({ projectDir: targetProject, seed: 42 }),
        loadShipwrightChat(targetProject),
      ]);
      setState({ surveys, proposal, simulation, messages });
    } catch (error) {
      console.error('Failed to refresh Shipwright panel', error);
      setRefreshError(error instanceof Error ? error.message : 'Shipwright refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [projectDir]);

  const selectedSurvey = useMemo(() => {
    if (projectDir) {
      return state.surveys.data.find((survey) => survey.root === projectDir || survey.project === projectDir)
        ?? state.surveys.data[0];
    }
    return state.surveys.data[0];
  }, [projectDir, state.surveys.data]);

  const proposal = state.proposal.data;
  const simulation = state.simulation.data;
  const fleetSlug = slugForFleetIdentity(projectName ?? proposal.fleet.project);
  const shipIdentities = proposal.fleet.agents.map((agent) => `${fleetSlug}:fleet:${slugForFleetIdentity(agent.id)}`);
  const totalBond = proposal.fleet.agents.reduce((sum, agent) => sum + agent.bondUsd, 0);
  const totalAgentBudget = proposal.fleet.agents.reduce((sum, agent) => sum + agent.budgetUsdPerDay, 0);

  return (
    <div className="h-full overflow-y-auto p-5" style={{ color: 'var(--pd-text)' }}>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="text-[10px] font-semibold tracking-wider opacity-35">SHIPWRIGHT</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Fleet architect workbench</h1>
            <p className="mt-1 text-sm opacity-70">
              Survey, propose, simulate, and apply a bounded fleet from the same control plane FleetBar opens.
            </p>
          </div>
          <button
            className="rounded-md px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
            disabled={refreshing}
            onClick={() => void refresh()}
            style={{
              backgroundColor: 'var(--pd-bg)',
              border: '1px solid var(--pd-border)',
              color: 'var(--pd-text)',
              opacity: refreshing ? 0.62 : 1,
            }}
            type="button"
          >
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </header>
        {refreshError && (
          <div
            className="rounded-md px-3 py-2 text-sm"
            style={{ backgroundColor: 'var(--pd-danger-surface)', border: '1px solid var(--pd-danger-border)', color: 'var(--pd-danger)' }}
          >
            {refreshError}
          </div>
        )}

        <section className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold tracking-wider opacity-45">HARBOR SURVEY</div>
                <h2 className="mt-1 text-xl font-semibold">{selectedSurvey?.project ?? 'No project surveyed'}</h2>
              </div>
              <span
                className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{ backgroundColor: 'var(--pd-warning-surface)', border: '1px solid var(--pd-warning-border)', color: 'var(--pd-warning)' }}
              >
                {sourceLabel(state.surveys)}
              </span>
            </div>

            {selectedSurvey ? (
              <>
                <p className="mt-3 text-sm leading-relaxed opacity-80">{selectedSurvey.intent}</p>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <Metric label="Activity" value={selectedSurvey.status.activity} />
                  <Metric label="Commits" value={String(selectedSurvey.status.commitsLast30d)} />
                  <Metric label="Fleet" value={`${selectedSurvey.status.fleetSizeAgents} agents`} />
                  <Metric label="Confidence" value={`${Math.round(selectedSurvey.confidence * 100)}%`} />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <ListBlock title="Risks" items={selectedSurvey.risks} tone="warning" />
                  <ListBlock title="Opportunities" items={selectedSurvey.opportunities} tone="success" />
                </div>
              </>
            ) : (
              <div className="mt-6 text-sm opacity-60">No Shipwright survey is available yet.</div>
            )}
          </div>

          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold tracking-wider opacity-45">PROPOSAL</div>
                <h2 className="mt-1 text-xl font-semibold">{proposal.fleet.agents.length} agent fleet</h2>
              </div>
              <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)', color: 'var(--pd-muted)' }}>
                {sourceLabel(state.proposal)}
              </span>
            </div>
            <AgentCardThumbnail className="mt-4" identities={shipIdentities} />
            <p className="mt-4 text-sm leading-relaxed opacity-80">{proposal.rationale}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Metric label="Daily cap" value={`$${proposal.fleet.limits.budgetUsdPerDay.toFixed(2)}`} />
              <Metric label="Agent budgets" value={`$${totalAgentBudget.toFixed(2)}`} />
              <Metric label="Escrow" value={`$${totalBond.toFixed(2)}`} />
            </div>
          </div>
        </section>

        <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold tracking-wider opacity-45">PROPOSED AGENTS</div>
                <h2 className="mt-1 text-lg font-semibold">Bounded search result</h2>
              </div>
              <span className="text-[10px] font-mono opacity-60">{proposal.exemplarId ?? 'no exemplar'}</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {proposal.fleet.agents.map((agent) => (
                <article
                  className="rounded-lg p-3"
                  key={agent.id}
                  style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}
                >
                  <div className="text-sm font-semibold">{agent.id}</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-muted)' }}>
                    {agent.archetype} · {agent.backend} · {agent.model}
                  </div>
                  <p className="mt-3 text-[12px] leading-relaxed opacity-75">{agent.rationale}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {agent.skills.slice(0, 3).map((skill) => (
                      <span className="rounded-full px-2 py-1 text-[10px]" key={skill} style={{ backgroundColor: 'var(--pd-surface-3)', border: '1px solid var(--pd-border)', color: 'var(--pd-muted)' }}>
                        {skill}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
          >
            <div className="text-[10px] font-semibold tracking-wider opacity-45">SIMULATION</div>
            <h2 className="mt-1 text-lg font-semibold">{simulation.hours}h dry-run at {simulation.speed}x</h2>
            <div className="mt-4 space-y-3">
              {simulation.events.map((event) => (
                <div className="border-l-2 pl-3" key={event.id} style={{ borderColor: 'var(--pd-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold">{event.type}</span>
                    <span className="text-[10px] font-mono opacity-55">{Math.round(event.atMs / 1000)}s</span>
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed opacity-75">{event.message ?? event.path ?? event.agentId ?? 'event'}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          className="rounded-xl p-4"
          style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}
        >
          <div className="text-[10px] font-semibold tracking-wider opacity-45">SHIPWRIGHT CHAT</div>
          <div className="mt-3 grid gap-3">
            {state.messages.data.map((message) => (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                key={message.id}
                style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}
              >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-muted)' }}>
                  {message.role}
                </div>
                {message.content}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-muted)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone: 'success' | 'warning' }) {
  const color = tone === 'success' ? 'var(--pd-success)' : 'var(--pd-warning)';
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color }}>{title}</div>
      <ul className="mt-2 space-y-2 text-[12px] leading-relaxed opacity-75">
        {items.slice(0, 3).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
