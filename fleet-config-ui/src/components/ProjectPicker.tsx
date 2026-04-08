import { motion, AnimatePresence } from 'framer-motion';

interface ProjectInfo {
  id: string;
  name: string;
  fleetPath: string;
  running?: boolean;
  agents: Array<{ agentName: string; status: string }>;
}

interface Props {
  projects: ProjectInfo[];
  selected: string | null;
  onSelect: (id: string) => void;
}

function deployedCount(project: ProjectInfo): number {
  return project.agents.filter((agent) => agent.status !== 'paused').length;
}

export default function ProjectPicker({ projects, selected, onSelect }: Props) {
  const active = projects.find(p => p.id === selected);
  const rest = projects.filter(p => p.id !== selected);

  return (
    <div className="flex flex-col gap-2 pt-1">
      {active && (
        <motion.div layoutId={`project-${active.id}`} onClick={() => onSelect(active.id)}
          className="relative cursor-pointer rounded-lg border px-4 py-3"
          style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-accent)', borderWidth: 1.5 }}
          whileHover={{ scale: 1.01 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-sm" style={{ color: 'var(--pd-accent)' }}>{active.name}</span>
            <div className="flex items-center gap-1.5">
              {deployedCount(active) > 0 ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)' }}>
                  {deployedCount(active)} deployed
                </span>
              ) : (
                <span className="text-[9px]" style={{ color: 'var(--pd-muted)' }}>idle</span>
              )}
            </div>
          </div>
          <div className="text-[10px] mt-0.5 font-mono truncate" style={{ color: 'var(--pd-muted)' }}>{active.fleetPath}</div>
        </motion.div>
      )}

      <div className="relative" style={{ height: rest.length * 36 + 8 }}>
        <AnimatePresence>
          {rest.map((p, i) => (
            <motion.div key={p.id} layoutId={`project-${p.id}`} onClick={() => onSelect(p.id)}
              className="absolute w-full cursor-pointer rounded-lg border px-4 py-2"
              style={{ backgroundColor: 'var(--pd-surface-2)', borderColor: 'var(--pd-border)', top: i * 36, zIndex: rest.length - i }}
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1 - i * 0.15, y: 0, scale: 1 - i * 0.02 }}
              exit={{ opacity: 0, y: -8 }}
              whileHover={{ borderColor: 'var(--pd-muted)', scale: 1.01 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30, delay: i * 0.04 }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm" style={{ color: 'var(--pd-muted)' }}>{p.name}</span>
                <span className="text-[10px] opacity-30" style={{ color: 'var(--pd-text)' }}>{p.agents.length} agents</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── All Projects view ────────────────────────────────────────────────────────

interface AllProjectsProps {
  projects: ProjectInfo[];
  onSelect: (id: string) => void;
}

const ADD_PROJECT_COMMANDS = [
  {
    title: 'Full onboarding',
    caption: 'Scaffold Port Daddy, starter fleet, hooks, and MCP in one shot.',
    command: 'cd <project-dir>\npd init',
  },
  {
    title: 'Starter fleet',
    caption: 'Write pd-fleet.yml plus the post-commit trigger for a new repo.',
    command: 'cd <project-dir>\npd fleet init',
  },
  {
    title: 'Make it live here',
    caption: 'Start that project fleet on the current daemon so it shows up in this control plane.',
    command: 'cd <project-dir>\npd fleet up',
  },
  {
    title: 'Editor integration',
    caption: 'Install the MCP bridge and Port Daddy skill into Claude/Cursor/Windsurf.',
    command: 'pd mcp install',
  },
];

async function copyCommand(command: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    window.prompt('Copy this Port Daddy command', command);
    return;
  }
  await navigator.clipboard.writeText(command);
}

export function AllProjectsList({ projects, onSelect }: AllProjectsProps) {
  const totalAgents = projects.reduce((n, p) => n + p.agents.length, 0);
  const totalActive = projects.reduce((n, p) => n + deployedCount(p), 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} className="max-w-2xl mx-auto px-8 py-10">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--pd-text)' }}>All Projects</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--pd-muted)' }}>
        {totalActive} active · {totalAgents} agents across {projects.length} projects
      </p>
      <div className="flex flex-col gap-3">
        {projects.map((p, i) => {
          const activeCount = deployedCount(p);
          return (
            <motion.div key={p.id} layoutId={`project-${p.id}`} onClick={() => onSelect(p.id)}
              className="rounded-lg border px-5 py-4 cursor-pointer"
              style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 28 }}
              whileHover={{ borderColor: 'var(--pd-accent)', scale: 1.005 }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold" style={{ color: 'var(--pd-text)' }}>{p.name}</span>
                  {activeCount > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)' }}>
                      {activeCount} deployed
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--pd-muted)' }}>{p.agents.length} agents</span>
              </div>
              <div className="text-[11px] font-mono" style={{ color: 'var(--pd-muted)' }}>{p.fleetPath}</div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-8 rounded-2xl border p-5" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: 'var(--pd-muted)' }}>
              Add project
            </div>
            <h2 className="mt-2 text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>
              Cold-start Port Daddy in a new repo
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
              A project becomes real here once it has a <span style={{ color: 'var(--pd-text)' }}>pd-fleet.yml</span> and you start that fleet on this daemon. These snippets are meant to be copied, edited, and run from the target repo.
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
              className="rounded-xl border p-4"
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
                  className="rounded-full px-3 py-1 text-[11px] font-semibold"
                  style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
                >
                  Copy
                </button>
              </div>
              <pre
                className="mt-3 overflow-x-auto rounded-xl px-3 py-3 text-[11px] leading-relaxed"
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
