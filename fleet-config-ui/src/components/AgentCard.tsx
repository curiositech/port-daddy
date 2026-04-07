import { motion } from 'framer-motion';
import { Clock, Eye, Zap, Settings2 } from 'lucide-react';
import type { FleetAgent, FleetLimits } from '../types';
import { agentColor } from '../types';
import FileActionLinks from './FileActionLinks';

interface Props {
  agent: FleetAgent;
  runtimeStatus?: string;  // from daemon: 'running' | 'idle' | etc
  limits?: FleetLimits;
  highlighted: boolean;
  dimmed: boolean;
  latestWork?: string | null;
  latestWorkLabel?: string | null;
  touchedFiles?: string[];
  projectDir?: string;
  onSelect: (name: string) => void;
  onConfigure: (name: string) => void;
}

export default function AgentCard({
  agent,
  runtimeStatus,
  limits,
  highlighted,
  dimmed,
  latestWork,
  latestWorkLabel,
  touchedFiles = [],
  projectDir,
  onSelect,
  onConfigure,
}: Props) {
  const color = agentColor(agent.name);
  const isRunning = runtimeStatus === 'running' || runtimeStatus === 'scheduled';
  const statusDot = isRunning ? 'var(--pd-success)' : 'var(--pd-border)';
  const roleLabel = agent.schedule ? 'scheduled task' : 'agent';

  return (
    <motion.div
      layout
      layoutId={`agent-card-${agent.name}`}
      className="rounded-lg border relative overflow-hidden cursor-pointer"
      style={{
        backgroundColor: highlighted ? 'var(--pd-surface-hover, #1E1B18)' : 'var(--pd-surface)',
        borderColor: highlighted ? color : 'var(--pd-border)',
        borderWidth: highlighted ? 2 : 1,
        boxShadow: highlighted ? `0 0 24px ${color}30` : undefined,
        gridColumn: isRunning ? 'span 2' : 'span 1',
        opacity: dimmed ? 0.3 : 1,
        transition: 'opacity 0.25s, border-color 0.25s, box-shadow 0.25s',
      }}
      onClick={() => onSelect(agent.name)}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      {/* Color bar */}
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color, opacity: 0.6 }} />

      <div className="p-3 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: statusDot }} />
            <span className="font-mono font-semibold text-sm" style={{ color }}>{agent.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {isRunning && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)' }}>
                {runtimeStatus?.toUpperCase()}
              </span>
            )}
            <button
              onClick={e => { e.stopPropagation(); onSelect(agent.name); }}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold"
              style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
            >
              <Eye size={11} />
              <span>Inspect</span>
            </button>
            <button
              onClick={e => { e.stopPropagation(); onConfigure(agent.name); }}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-semibold"
              style={{ color: 'var(--pd-muted)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
            >
              <Settings2 size={11} />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* Trigger */}
        <div className="flex items-center gap-1.5 mb-2">
          {agent.schedule
            ? <><Clock size={9} color="var(--pd-dim)" /><span className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>scheduled job · {agent.schedule}</span></>
            : <><Zap size={9} color="var(--pd-warning)" /><span className="text-[10px] font-mono" style={{ color: 'var(--pd-warning)' }}>when: {agent.trigger}</span></>
          }
        </div>

        {/* Backend + model */}
        <div className="text-[10px] mb-2 flex items-center justify-between gap-2" style={{ color: 'var(--pd-muted)' }}>
          <span>
            {agent.backend}{agent.model ? ` · ${agent.model}` : ''}
          </span>
          <span className="text-[9px] uppercase tracking-[0.16em]" style={{ color: 'var(--pd-dim)' }}>
            {roleLabel}
          </span>
        </div>

        {/* Recent work */}
        <div className="rounded-md px-2.5 py-2 mb-2" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[8px] font-semibold tracking-[0.16em]" style={{ color: 'var(--pd-dim)' }}>
              RECENT WORK
            </span>
            {latestWorkLabel ? (
              <span className="text-[8px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--pd-accent)' }}>
                {latestWorkLabel}
              </span>
            ) : null}
          </div>
          <p
            className="text-[11px] leading-relaxed"
            style={{
              color: latestWork ? 'var(--pd-text)' : 'var(--pd-muted)',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {latestWork || agent.prompt}
          </p>
        </div>

        {touchedFiles.length > 0 && (
          <div className="mb-2">
            <div className="text-[8px] font-semibold tracking-[0.16em] mb-1" style={{ color: 'var(--pd-dim)' }}>
              MUTATIONS
            </div>
            <div className="flex flex-wrap gap-1">
              {touchedFiles.slice(0, 3).map((filePath) => (
                <FileActionLinks
                  key={filePath}
                  filePath={filePath}
                  projectDir={projectDir}
                  compact
                />
              ))}
            </div>
          </div>
        )}

        {/* Channels */}
        <div className="flex gap-3 mb-1">
          {agent.trigger && (
            <div>
              <div className="text-[8px] font-semibold tracking-wider opacity-30 mb-0.5" style={{ color: 'var(--pd-text)' }}>LISTENING</div>
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}>{agent.trigger}</span>
            </div>
          )}
          {agent.onSuccess && (
            <div>
              <div className="text-[8px] font-semibold tracking-wider opacity-30 mb-0.5" style={{ color: 'var(--pd-text)' }}>PUBLISHES</div>
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
                {agent.onSuccess.replace('publish ', '')}
              </span>
            </div>
          )}
        </div>

        {/* Limits */}
        {limits && (
          <div className="flex flex-wrap gap-1 mt-2">
            {limits.budgetUsdPerDay !== undefined && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                ${limits.budgetUsdPerDay}/day
              </span>
            )}
            {limits.maxConcurrentSpawns !== undefined && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                max {limits.maxConcurrentSpawns} concurrent
              </span>
            )}
            {limits.maxSpawnsPerHour !== undefined && (
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                {limits.maxSpawnsPerHour}/hr
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
