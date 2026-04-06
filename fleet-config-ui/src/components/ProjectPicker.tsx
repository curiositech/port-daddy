import { motion, AnimatePresence } from 'framer-motion';

interface ProjectInfo {
  id: string;
  name: string;
  fleetPath: string;
  agents: Array<{ agentName: string; status: string }>;
}

interface Props {
  projects: ProjectInfo[];
  selected: string | null;
  onSelect: (id: string) => void;
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
              {active.agents.filter(a => a.status === 'running').length > 0 ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)' }}>
                  {active.agents.filter(a => a.status === 'running').length} running
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

export function AllProjectsList({ projects, onSelect }: AllProjectsProps) {
  const totalAgents = projects.reduce((n, p) => n + p.agents.length, 0);
  const totalActive = projects.reduce((n, p) => n + p.agents.filter(a => a.status === 'running').length, 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} className="max-w-2xl mx-auto px-8 py-10">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--pd-text)' }}>All Projects</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--pd-muted)' }}>
        {totalActive} active · {totalAgents} agents across {projects.length} projects
      </p>
      <div className="flex flex-col gap-3">
        {projects.map((p, i) => {
          const activeCount = p.agents.filter(a => a.status === 'running').length;
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
                      {activeCount} active
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
    </motion.div>
  );
}
