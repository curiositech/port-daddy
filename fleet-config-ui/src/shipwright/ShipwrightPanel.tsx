import { useCallback, useMemo, useState } from 'react';
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
import { FleetControlView } from './FleetControlView';
import { FocusView } from './FocusView';
import { HarborView } from './HarborView';
import { SimulationView } from './SimulationView';
import {
  labelForSubview,
  normalizeShipwrightSubview,
  shipwrightSubviews,
  type ShipwrightSubview,
} from './helpers';
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

function readInitialSubview(): ShipwrightSubview {
  if (typeof window === 'undefined') return 'harbor';
  return normalizeShipwrightSubview(new URLSearchParams(window.location.search).get('shipwright'));
}

function persistSubview(view: ShipwrightSubview): void {
  if (typeof window === 'undefined') return;
  const next = new URL(window.location.href);
  next.searchParams.set('surface', 'shipwright');
  next.searchParams.set('shipwright', view);
  window.history.replaceState({}, '', next);
}

/**
 * ShipwrightPanel - Fleet Control Center shell for Shipwright subviews.
 *
 * WHY IT EXISTS: Shipwright now has multiple operator modes. Keeping data load
 * and URL state here lets Harbor, Focus, Simulation, and FleetControl stay
 * small and visually disciplined while still sharing one typed fixture/API
 * contract.
 *
 * DESIGN NOTES: each subview uses hard-card primitives from the component
 * brief, while this shell owns the compact tab strip and refresh controls.
 *
 * @example
 *   <ShipwrightPanel
 *     projectDir="/Users/erichowens/coding/port-daddy"
 *     projectName="port-daddy"
 *   />
 */
export default function ShipwrightPanel({ projectDir }: ShipwrightPanelProps) {
  const [state, setState] = useState<ShipwrightPanelState>(() => initialState(projectDir));
  const [activeSubview, setActiveSubview] = useState<ShipwrightSubview>(() => readInitialSubview());
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

  const showSubview = useCallback((view: ShipwrightSubview) => {
    setActiveSubview(view);
    persistSubview(view);
  }, []);

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
            className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
            disabled={refreshing}
            onClick={() => void refresh()}
            style={{
              backgroundColor: 'var(--pd-bg)',
              border: '1px solid var(--pd-border)',
              borderRadius: 0,
              color: 'var(--pd-text)',
              opacity: refreshing ? 0.62 : 1,
            }}
            type="button"
          >
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </header>

        <nav aria-label="Shipwright views" className="flex flex-wrap gap-2">
          {shipwrightSubviews.map((view) => (
            <button
              className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]"
              key={view}
              onClick={() => showSubview(view)}
              style={{
                backgroundColor: activeSubview === view ? 'var(--pd-accent-surface)' : 'var(--pd-bg)',
                border: `1px solid ${activeSubview === view ? 'var(--pd-accent-border)' : 'var(--pd-border)'}`,
                borderRadius: 0,
                color: activeSubview === view ? 'var(--pd-accent)' : 'var(--pd-muted)',
              }}
              type="button"
            >
              {labelForSubview(view)}
            </button>
          ))}
        </nav>

        {refreshError && (
          <div
            className="px-3 py-2 text-sm"
            style={{ backgroundColor: 'var(--pd-danger-surface)', border: '1px solid var(--pd-danger-border)', borderRadius: 0, color: 'var(--pd-danger)' }}
          >
            {refreshError}
          </div>
        )}

        {activeSubview === 'harbor' && (
          <HarborView
            surveys={state.surveys}
            onFocusProject={() => {
              showSubview('focus');
            }}
          />
        )}
        {activeSubview === 'focus' && (
          <FocusView proposal={state.proposal} survey={selectedSurvey} />
        )}
        {activeSubview === 'simulation' && (
          <SimulationView proposal={state.proposal} simulation={state.simulation} />
        )}
        {activeSubview === 'control' && (
          <FleetControlView proposal={state.proposal} simulation={state.simulation} />
        )}

        <section
          className="p-4"
          style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)', borderRadius: 0 }}
        >
          <div className="text-[10px] font-semibold tracking-wider opacity-45">SHIPWRIGHT CHAT</div>
          <div className="mt-3 grid gap-3">
            {state.messages.data.map((message) => (
              <div
                className="px-3 py-2 text-sm"
                key={message.id}
                style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)', borderRadius: 0 }}
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
