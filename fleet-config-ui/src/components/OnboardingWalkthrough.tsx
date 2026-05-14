import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  KeyRound,
  MonitorCheck,
  PlayCircle,
  RefreshCw,
  Route,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  X,
} from 'lucide-react';
import { fetchSetupOverview, runSetupAction } from '../api';
import type { SetupActionId, SetupOverview, SetupRunResult } from '../types';

const STORAGE_KEY = 'pd.fleet-ui.first-run-guide.hidden';

type IconComponent = typeof MonitorCheck;

interface OnboardingWalkthroughProps {
  projectDir: string | null;
  onOpenShipwright?: () => void;
}

interface WalkthroughChapter {
  id: string;
  kicker: string;
  title: string;
  body: string;
  image: string;
  Icon: IconComponent;
}

interface GuidedAction {
  id: SetupActionId;
  title: string;
  body: string;
  detail: string;
  Icon: IconComponent;
  mutates: boolean;
}

const chapters: WalkthroughChapter[] = [
  {
    id: 'control-plane',
    kicker: 'Start Here',
    title: 'Port Daddy gives agent work one shared room.',
    body: 'The daemon keeps the live truth: projects, sessions, notes, file claims, channels, budgets, and salvage. Fleet Control Center is the window into that truth.',
    image: '/img/generated/control-plane-hero.webp',
    Icon: MonitorCheck,
  },
  {
    id: 'runtime',
    kicker: 'Local Runtime',
    title: 'The daemon runs locally, then the GUI rides on top.',
    body: 'FleetBar is the Mac companion. The CLI and daemon are the operating layer. MCPs and skills connect the same coordination habits to the agents and editors you already use.',
    image: '/img/generated/agent-runtime-map.webp',
    Icon: TerminalSquare,
  },
  {
    id: 'readiness',
    kicker: 'Before Launch',
    title: 'Port Daddy checks readiness before it spends.',
    body: 'Backend auth, package dependencies, exact model rates, budgets, and launch telemetry are surfaced before new agent work starts.',
    image: '/img/generated/blog-backend-readiness.webp',
    Icon: KeyRound,
  },
  {
    id: 'guard',
    kicker: 'Coordination',
    title: 'Agents coordinate through durable signals.',
    body: 'Claims, notes, locks, actor inboxes, and guard checks make parallel work recoverable. If a session dies, salvage tells the next agent where to pick up.',
    image: '/img/generated/coordination-guard.webp',
    Icon: ShieldCheck,
  },
  {
    id: 'shipwright',
    kicker: 'Next Fleet',
    title: 'Shipwright helps turn a repo into a runnable plan.',
    body: 'Use it to survey the project, propose roles, rehearse costs, and shape a starter fleet before agents begin changing files.',
    image: '/img/generated/shipwright-proposal.webp',
    Icon: Route,
  },
];

const guidedActions: GuidedAction[] = [
  {
    id: 'status',
    title: 'Check install truth',
    body: 'Read the live daemon mode, stable tree policy, and setup command without changing anything.',
    detail: 'Safe read-only check',
    Icon: ClipboardCheck,
    mutates: false,
  },
  {
    id: 'mcp-skills',
    title: 'Connect agents',
    body: 'Install MCP entries and the Port Daddy skill into detected local AI tools.',
    detail: 'Updates local tool config',
    Icon: KeyRound,
    mutates: true,
  },
  {
    id: 'fleetbar',
    title: 'Install FleetBar',
    body: 'Install or refresh the Mac menu-bar companion that opens this control plane.',
    detail: 'macOS app install',
    Icon: MonitorCheck,
    mutates: true,
  },
  {
    id: 'full',
    title: 'Run guided setup',
    body: 'Run the full local setup path: daemon, MCP, skills, FleetBar, and project initialization when a project is selected.',
    detail: 'Full local setup',
    Icon: PlayCircle,
    mutates: true,
  },
];

function canUseWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readHiddenPreference(): boolean {
  if (!canUseWindow()) return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

function writeHiddenPreference(hidden: boolean): void {
  if (!canUseWindow()) return;
  window.localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0');
}

function modeTone(mode: SetupOverview['daemon']['mode'] | null): 'success' | 'warning' | 'neutral' {
  if (mode === 'binary') return 'success';
  if (mode === 'source') return 'warning';
  return 'neutral';
}

function toneStyle(tone: 'accent' | 'neutral' | 'success' | 'warning') {
  if (tone === 'success') {
    return { backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' };
  }
  if (tone === 'warning') {
    return { backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' };
  }
  if (tone === 'accent') {
    return { backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' };
  }
  return { backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' };
}

function statusLabel(overview: SetupOverview | null): string {
  if (!overview) return 'Checking local install';
  if (overview.daemon.mode === 'binary') return 'Binary daemon detected';
  if (overview.daemon.mode === 'source') return 'Source daemon still installed';
  return 'Daemon install unknown';
}

function resultSummary(result: SetupRunResult | null, error: string | null): string {
  if (error) return error;
  if (!result) return 'Run a setup action to see output here.';
  if (result.success) return `${result.action} finished successfully.`;
  if (result.timedOut) return `${result.action} timed out.`;
  return `${result.action} exited with code ${result.exitCode ?? 'unknown'}.`;
}

function SetupOutput({ result, error }: { result: SetupRunResult | null; error: string | null }) {
  const text = result ? [result.stdout, result.stderr].filter(Boolean).join('\n\n') : '';
  return (
    <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--pd-bg)', borderColor: error || result?.success === false ? 'var(--pd-warning-border)' : 'var(--pd-border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-dim)' }}>
          <TerminalSquare size={13} />
          <span>Setup Output</span>
        </div>
        {result && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={toneStyle(result.success ? 'success' : 'warning')}>
            exit {result.exitCode ?? 'n/a'}
          </span>
        )}
      </div>
      <div className="mt-2 text-xs leading-relaxed" style={{ color: error ? 'var(--pd-warning)' : 'var(--pd-muted)' }}>
        {resultSummary(result, error)}
      </div>
      {(text || error) && (
        <pre
          className="mt-3 max-h-64 overflow-auto rounded-md px-3 py-3 text-[11px] leading-relaxed"
          style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-dim)', whiteSpace: 'pre-wrap' }}
        >
          {error ?? text}
        </pre>
      )}
    </div>
  );
}

export default function OnboardingWalkthrough({ projectDir, onOpenShipwright }: OnboardingWalkthroughProps) {
  const [hidden, setHidden] = useState(readHiddenPreference);
  const [overview, setOverview] = useState<SetupOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [runningAction, setRunningAction] = useState<SetupActionId | null>(null);
  const [result, setResult] = useState<SetupRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const refreshOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const next = await fetchSetupOverview();
      setOverview(next);
    } catch (error) {
      setOverviewError((error as Error).message);
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const installFacts = useMemo(() => {
    const mode = overview?.daemon.mode ?? null;
    return [
      {
        label: 'Daemon',
        value: mode === 'binary' ? 'binary' : mode === 'source' ? 'source/tsx' : 'unknown',
        detail: overview?.daemon.summary ?? 'Waiting for daemon install truth.',
        tone: modeTone(mode),
      },
      {
        label: 'Stable tree',
        value: overview?.stableTree.exists ? 'present' : 'not found',
        detail: overview?.stableTree.cleanupPolicy ?? 'Old stable trees are never removed without a successful migration.',
        tone: overview?.stableTree.exists ? 'warning' : 'success',
      },
      {
        label: 'Binary candidate',
        value: overview?.daemon.binaryCandidateExists ? 'found' : 'missing',
        detail: overview?.daemon.binaryCandidate ?? 'Compiled daemon path will appear here when available.',
        tone: overview?.daemon.binaryCandidateExists ? 'success' : 'neutral',
      },
    ] as const;
  }, [overview]);

  const setGuideHidden = (nextHidden: boolean) => {
    setHidden(nextHidden);
    writeHiddenPreference(nextHidden);
  };

  const runAction = async (action: GuidedAction) => {
    if (action.mutates) {
      const confirmed = window.confirm(`${action.title}\n\n${action.body}\n\nThis will run local Port Daddy setup commands on this machine.`);
      if (!confirmed) return;
    }
    setRunningAction(action.id);
    setRunError(null);
    setResult(null);
    try {
      const next = await runSetupAction({
        action: action.id,
        confirmed: action.mutates,
        projectDir,
      });
      setResult(next);
      await refreshOverview();
    } catch (error) {
      setRunError((error as Error).message);
    } finally {
      setRunningAction(null);
    }
  };

  if (hidden) {
    return (
      <section className="mb-4 rounded-lg border px-4 py-3" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-dim)' }}>Welcome guide</div>
            <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{statusLabel(overview)}</div>
          </div>
          <button
            type="button"
            onClick={() => setGuideHidden(false)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
            style={toneStyle('accent')}
          >
            <Route size={13} />
            Open guide
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 overflow-hidden rounded-lg border" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="grid min-h-[24rem] lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
        <div
          className="relative flex min-h-[24rem] flex-col justify-between overflow-hidden p-5 sm:p-6"
          style={{
            backgroundImage: 'linear-gradient(90deg, color-mix(in srgb, var(--pd-bg) 96%, transparent), color-mix(in srgb, var(--pd-bg) 68%, transparent)), url("/img/generated/control-plane-hero.webp")',
            backgroundPosition: 'center',
            backgroundSize: 'cover',
          }}
        >
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-accent)' }}>
                <MonitorCheck size={14} />
                <span>First Run</span>
              </div>
              <button
                type="button"
                onClick={() => setGuideHidden(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md"
                style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}
                aria-label="Hide welcome guide"
              >
                <X size={14} />
              </button>
            </div>
            <h1 className="mt-8 max-w-xl text-3xl font-semibold leading-tight sm:text-4xl" style={{ color: 'var(--pd-text)' }}>
              Welcome to Port Daddy.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 sm:text-base" style={{ color: 'var(--pd-muted)' }}>
              This is your local operating room for agentic development. Start with one repo, connect your tools, set the budget rails, and let every agent leave durable evidence as it works.
            </p>
          </div>
          <div className="relative z-10 mt-8 grid gap-2 sm:grid-cols-3">
            {installFacts.map((fact) => (
              <div key={fact.label} className="rounded-lg border p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--pd-bg) 84%, transparent)', borderColor: 'var(--pd-border)' }}>
                <div className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: 'var(--pd-dim)' }}>{fact.label}</div>
                <div className="mt-1 text-sm font-semibold" style={{ color: toneStyle(fact.tone).color }}>{fact.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-dim)' }}>Local setup</div>
              <h2 className="mt-1 text-xl font-semibold" style={{ color: 'var(--pd-text)' }}>{statusLabel(overview)}</h2>
              {overviewError ? (
                <p className="mt-2 text-sm" style={{ color: 'var(--pd-warning)' }}>{overviewError}</p>
              ) : (
                <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                  The GUI can run the same setup path as the CLI. Mutating actions ask first, then show exact command output.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void refreshOverview()}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
              style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
            >
              <RefreshCw size={13} className={loadingOverview ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {guidedActions.map((action) => {
              const Icon = action.Icon;
              const busy = runningAction === action.id;
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={runningAction !== null}
                  onClick={() => void runAction(action)}
                  className="rounded-lg border p-3 text-left disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)', opacity: runningAction && !busy ? 0.58 : 1 }}
                >
                  <span className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={toneStyle(action.mutates ? 'accent' : 'success')}>
                      {busy ? <RefreshCw size={15} className="animate-spin" /> : <Icon size={15} />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{action.title}</span>
                        <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={toneStyle(action.mutates ? 'warning' : 'success')}>
                          {action.detail}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>{action.body}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
            <SetupOutput result={result} error={runError} />
            <div className="rounded-lg border p-3" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
              <div className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-dim)' }}>
                <Wrench size={13} />
                <span>Migration posture</span>
              </div>
              <div className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                {overview?.stableTree.cleanupPolicy ?? 'Setup status will report whether the older stable tree exists and whether a binary daemon is installed.'}
              </div>
              {overview?.daemon.programArguments?.length ? (
                <pre className="mt-3 overflow-x-auto rounded-md px-3 py-2 text-[10px] leading-relaxed" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-dim)' }}>
                  {overview.daemon.programArguments.join('\n')}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t p-4 sm:p-5" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-dim)' }}>How to read the room</div>
            <h2 className="mt-1 text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>Five ideas make the whole system easier.</h2>
          </div>
          {onOpenShipwright && (
            <button
              type="button"
              onClick={onOpenShipwright}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
              style={toneStyle('accent')}
            >
              <Route size={13} />
              Open Shipwright
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
          {chapters.map((chapter) => {
            const Icon = chapter.Icon;
            return (
              <motion.article
                key={chapter.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28 }}
                className="overflow-hidden rounded-lg border"
                style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}
              >
                <div className="aspect-[16/9] overflow-hidden">
                  <img src={chapter.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] uppercase" style={{ color: 'var(--pd-dim)' }}>
                    <Icon size={12} />
                    <span>{chapter.kicker}</span>
                  </div>
                  <h3 className="mt-2 min-h-[3rem] text-sm font-semibold leading-snug" style={{ color: 'var(--pd-text)' }}>{chapter.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>{chapter.body}</p>
                </div>
              </motion.article>
            );
          })}
        </div>
        <AnimatePresence>
          {result?.success && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              style={toneStyle('success')}
            >
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 size={16} />
                Setup action completed.
              </span>
              <button type="button" onClick={() => setGuideHidden(true)} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
                Continue to dashboard
                <ArrowRight size={12} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
