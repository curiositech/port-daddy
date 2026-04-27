import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Copy, FileCog, Play, Radio, Wrench } from 'lucide-react';

interface ProjectInfo {
  id: string;
  name: string;
  logicalId?: string;
  fleetPath: string;
  projectDir: string;
  running?: boolean;
  agents: Array<{ agentName: string; status: string }>;
  configuredAgentCount?: number;
  configuredWatcherCount?: number;
  signals?: string[];
  sources?: string[];
  operatorState?: 'running' | 'ready' | 'blocked' | 'service_only' | 'context_only' | 'missing';
  operatorSummary?: string;
  operatorNextAction?: string;
  fleetConfigStatus?: 'ready' | 'missing_budget' | 'invalid' | 'missing';
  budgetUsdPerDay?: number | null;
  configError?: string | null;
  configWarnings?: string[];
  remediation?: {
    action: 'start_fleet' | 'set_budget' | 'fix_yaml' | 'create_fleet' | 'run_scan';
    title: string;
    detail: string;
    command?: string;
    suggestedBudgetUsdPerDay?: number;
  } | null;
}

interface Props {
  projects: ProjectInfo[];
  selected: string | null;
  onSelect: (id: string) => void;
  onStartProject?: (project: ProjectInfo) => void;
  onSetBudget?: (project: ProjectInfo, usdPerDay: number) => void;
  onOpenYaml?: (project: ProjectInfo) => void;
}

interface AllProjectsProps {
  projects: ProjectInfo[];
  onSelect: (id: string) => void;
  onStartProject?: (project: ProjectInfo) => void;
  onSetBudget?: (project: ProjectInfo, usdPerDay: number) => void;
  onOpenYaml?: (project: ProjectInfo) => void;
}

const ADD_PROJECT_COMMANDS = [
  {
    title: 'Full onboarding',
    caption: 'Scaffold service config, starter fleet, hooks, and editor integration.',
    command: 'cd <project-dir>\npd init',
  },
  {
    title: 'Starter fleet',
    caption: 'Write pd-fleet.yml plus the post-commit trigger for a repo that already exists.',
    command: 'cd <project-dir>\npd fleet init',
  },
  {
    title: 'Service stack',
    caption: 'Use the older .portdaddyrc service config path for pd up / pd down.',
    command: 'cd <project-dir>\npd scan\npd up',
  },
  {
    title: 'Make fleet live',
    caption: 'Start a budgeted project fleet on the current daemon.',
    command: 'cd <project-dir>\npd fleet up',
  },
];

function deployedCount(project: ProjectInfo): number {
  return project.agents.filter((agent) => agent.status !== 'paused').length;
}

function configuredCount(project: ProjectInfo): number {
  return project.configuredAgentCount ?? project.agents.length;
}

function formatBudget(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? `$${value.toFixed(2)}/day` : 'no budget';
}

function projectState(project: ProjectInfo): NonNullable<ProjectInfo['operatorState']> {
  if (project.operatorState) return project.operatorState;
  if (project.running) return 'running';
  if (project.fleetConfigStatus === 'ready') return 'ready';
  if (project.fleetConfigStatus === 'missing_budget' || project.fleetConfigStatus === 'invalid') return 'blocked';
  if (project.signals?.includes('config')) return 'service_only';
  return 'missing';
}

function stateLabel(project: ProjectInfo): string {
  switch (projectState(project)) {
    case 'running':
      return 'running';
    case 'ready':
      return 'ready';
    case 'blocked':
      return project.fleetConfigStatus === 'missing_budget' ? 'needs budget' : 'blocked';
    case 'service_only':
      return 'pd up config';
    case 'context_only':
      return 'context only';
    case 'missing':
      return 'needs setup';
  }
}

function stateStyle(project: ProjectInfo): { backgroundColor: string; color: string; border: string } {
  switch (projectState(project)) {
    case 'running':
      return { backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' };
    case 'ready':
      return { backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' };
    case 'blocked':
      return { backgroundColor: 'var(--pd-danger-surface)', color: 'var(--pd-danger)', border: '1px solid var(--pd-danger-border)' };
    case 'service_only':
      return { backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' };
    default:
      return { backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' };
  }
}

function StateIcon({ project }: { project: ProjectInfo }) {
  switch (projectState(project)) {
    case 'running':
      return <Radio size={12} />;
    case 'ready':
      return <CheckCircle2 size={12} />;
    case 'blocked':
      return <AlertTriangle size={12} />;
    case 'service_only':
      return <FileCog size={12} />;
    default:
      return <Wrench size={12} />;
  }
}

async function copyCommand(command: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    window.prompt('Copy this Port Daddy command', command);
    return;
  }
  await navigator.clipboard.writeText(command);
}

function ProjectActionButton({
  project,
  onStartProject,
  onSetBudget,
  onOpenYaml,
}: {
  project: ProjectInfo;
  onStartProject?: (project: ProjectInfo) => void;
  onSetBudget?: (project: ProjectInfo, usdPerDay: number) => void;
  onOpenYaml?: (project: ProjectInfo) => void;
}) {
  const remediation = project.remediation;

  if (remediation?.action === 'set_budget') {
    const budget = remediation.suggestedBudgetUsdPerDay ?? 5;
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSetBudget?.(project, budget);
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' }}
      >
        <CircleDollarSign size={13} />
        Set ${budget}/day
      </button>
    );
  }

  if (remediation?.action === 'start_fleet' || projectState(project) === 'ready') {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onStartProject?.(project);
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
      >
        <Play size={13} />
        Start
      </button>
    );
  }

  if (remediation?.action === 'fix_yaml') {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenYaml?.(project);
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}
      >
        <FileCog size={13} />
        Open YAML
      </button>
    );
  }

  if (remediation?.command) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void copyCommand(remediation.command ?? '');
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold"
        style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
      >
        <Copy size={13} />
        Copy steps
      </button>
    );
  }

  return null;
}

export default function ProjectPicker({ projects, selected, onSelect, onStartProject, onSetBudget, onOpenYaml }: Props) {
  const active = projects.find(p => p.id === selected);
  const rest = projects.filter(p => p.id !== selected);

  return (
    <div className="flex flex-col gap-2 pt-1">
      {active && (
        <motion.div layoutId={`project-${active.id}`} onClick={() => onSelect(active.id)}
          className="relative cursor-pointer rounded-lg border px-4 py-3"
          style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-accent)', borderWidth: 1.5 }}
          whileHover={{ scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono font-bold text-sm" style={{ color: 'var(--pd-accent)' }}>{active.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={stateStyle(active)}>
              <StateIcon project={active} />
              {stateLabel(active)}
            </span>
          </div>
          <div className="text-[10px] mt-0.5 font-mono truncate" style={{ color: 'var(--pd-muted)' }}>{active.fleetPath}</div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--pd-muted)' }}>
            <span>{configuredCount(active)} configured · {deployedCount(active)} deployed</span>
            <span>{formatBudget(active.budgetUsdPerDay)}</span>
          </div>
          <div className="mt-2">
            <ProjectActionButton project={active} onStartProject={onStartProject} onSetBudget={onSetBudget} onOpenYaml={onOpenYaml} />
          </div>
        </motion.div>
      )}

      <div className="relative" style={{ height: rest.length * 40 + 8 }}>
        <AnimatePresence>
          {rest.map((p, i) => (
            <motion.div key={p.id} layoutId={`project-${p.id}`} onClick={() => onSelect(p.id)}
              className="absolute w-full cursor-pointer rounded-lg border px-4 py-2"
              style={{ backgroundColor: 'var(--pd-surface-2)', borderColor: 'var(--pd-border)', top: i * 40, zIndex: rest.length - i }}
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1 - i * 0.12, y: 0, scale: 1 - i * 0.015 }}
              exit={{ opacity: 0, y: -8 }}
              whileHover={{ borderColor: 'var(--pd-muted)', scale: 1.01 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30, delay: i * 0.04 }}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-sm" style={{ color: 'var(--pd-muted)' }}>{p.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={stateStyle(p)}>
                  <StateIcon project={p} />
                  {stateLabel(p)}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function AllProjectsList({ projects, onSelect, onStartProject, onSetBudget, onOpenYaml }: AllProjectsProps) {
  const totalAgents = projects.reduce((n, p) => n + configuredCount(p), 0);
  const totalActive = projects.reduce((n, p) => n + deployedCount(p), 0);
  const blocked = projects.filter(p => projectState(p) === 'blocked').length;
  const ready = projects.filter(p => projectState(p) === 'ready').length;
  const serviceOnly = projects.filter(p => projectState(p) === 'service_only').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} className="max-w-5xl mx-auto px-8 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--pd-text)' }}>All Projects</h1>
          <p className="text-sm" style={{ color: 'var(--pd-muted)' }}>
            {totalActive} active · {totalAgents} agents · {blocked} blocked · {ready} ready · {serviceOnly} service configs
          </p>
        </div>
        <div className="max-w-xl text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
          Fleet automation is driven by <span style={{ color: 'var(--pd-text)' }}>pd-fleet.yml</span>. Service orchestration from <span style={{ color: 'var(--pd-text)' }}>.portdaddyrc</span> is still shown, but marked separately.
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {projects.map((p, i) => {
          const activeCount = deployedCount(p);
          const warningCount = p.configWarnings?.length ?? 0;
          return (
            <motion.div key={p.id} layoutId={`project-${p.id}`} onClick={() => onSelect(p.id)}
              className="rounded-lg border px-5 py-4 cursor-pointer"
              style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 28 }}
              whileHover={{ borderColor: 'var(--pd-accent)', scale: 1.005 }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono font-bold" style={{ color: 'var(--pd-text)' }}>{p.name}</span>
                    <span className="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-bold" style={stateStyle(p)}>
                      <StateIcon project={p} />
                      {stateLabel(p)}
                    </span>
                    {warningCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}>
                        <AlertTriangle size={11} />
                        {warningCount} warning{warningCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-[11px] font-mono truncate" style={{ color: 'var(--pd-muted)' }}>{p.fleetPath}</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-xs" style={{ color: 'var(--pd-muted)' }}>
                    {configuredCount(p)} configured · {activeCount} deployed · {formatBudget(p.budgetUsdPerDay)}
                  </span>
                  <ProjectActionButton project={p} onStartProject={onStartProject} onSetBudget={onSetBudget} onOpenYaml={onOpenYaml} />
                </div>
              </div>

              <div className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--pd-text)' }}>
                {p.operatorSummary ?? 'No operator summary available.'}
              </div>
              <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                {p.operatorNextAction ?? 'Select this project to inspect it.'}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {(p.signals ?? []).map((signal) => (
                  <span
                    key={`${p.id}-${signal}`}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}
                  >
                    {signal}
                  </span>
                ))}
                {(p.sources ?? []).map((source) => (
                  <span
                    key={`${p.id}-${source}`}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
                  >
                    {source}
                  </span>
                ))}
              </div>

              {p.remediation?.command && projectState(p) !== 'ready' && (
                <pre
                  className="mt-3 overflow-x-auto rounded-md px-3 py-2 text-[11px] leading-relaxed"
                  style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-dim)', whiteSpace: 'pre-wrap' }}
                >
                  {p.remediation.command}
                </pre>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-8 rounded-lg border p-5" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-muted)' }}>
              Add project
            </div>
            <h2 className="mt-2 text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>
              Bring another repo into the control plane
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
              Repos become visible through durable markers: <span style={{ color: 'var(--pd-text)' }}>pd-fleet.yml</span>, <span style={{ color: 'var(--pd-text)' }}>.portdaddyrc</span>, or a real <span style={{ color: 'var(--pd-text)' }}>.portdaddy/</span> state directory.
            </p>
          </div>
          <div className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)' }}>
            Click to copy
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {ADD_PROJECT_COMMANDS.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border p-4"
              style={{ backgroundColor: 'var(--pd-surface-2)', borderColor: 'var(--pd-border)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold" style={{ color: 'var(--pd-text)' }}>{item.title}</div>
                  <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--pd-muted)' }}>{item.caption}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copyCommand(item.command)}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold"
                  style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
                >
                  <Copy size={12} />
                  Copy
                </button>
              </div>
              <pre
                className="mt-3 overflow-x-auto rounded-md px-3 py-3 text-[11px] leading-relaxed"
                style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-dim)', whiteSpace: 'pre-wrap' }}
              >
                {item.command}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
