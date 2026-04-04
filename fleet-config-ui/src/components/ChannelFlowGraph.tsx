import { useState, useRef, useEffect, useCallback } from 'react';
import { agentColors, ColoredToken, type AgentData } from './AgentRadioCard';

interface Rect { x: number; y: number; w: number; h: number; }
interface Dims {
  agents: Rect[];
  channels: Rect[];
  schedules: Rect[];
  containerH: number;
}

interface ChannelFlowGraphProps {
  agents: AgentData[];
  highlightedAgent: string | null;
  onAgentHover: (agent: string | null) => void;
}

const ChannelFlowGraph: React.FC<ChannelFlowGraphProps> = ({ agents, highlightedAgent, onAgentHover }) => {
  const [highlightedChannel, setHighlightedChannel] = useState<string | null>(null);
  const [highlightedSchedule, setHighlightedSchedule] = useState<string | null>(null);
  const [dims, setDims] = useState<Dims>({ agents: [], channels: [], schedules: [], containerH: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const agentRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const channelRowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scheduleRowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const channels = new Set<string>();
  const channelToAgents = new Map<string, string[]>();
  const schedules = new Set<string>();
  const scheduleToAgents = new Map<string, string[]>();

  agents.forEach(agent => {
    agent.broadcasting?.forEach(ch => channels.add(ch));
    agent.listening?.forEach(ch => {
      channels.add(ch);
      if (!channelToAgents.has(ch)) channelToAgents.set(ch, []);
      channelToAgents.get(ch)!.push(agent.agentName);
    });
    if (agent.trigger?.type === 'schedule') {
      const key = agent.trigger.value;
      schedules.add(key);
      if (!scheduleToAgents.has(key)) scheduleToAgents.set(key, []);
      scheduleToAgents.get(key)!.push(agent.agentName);
    }
  });

  const channelArray = Array.from(channels);
  const scheduleArray = Array.from(schedules);

  const measure = useCallback(() => {
    if (!containerRef.current) return;
    const cr = containerRef.current.getBoundingClientRect();
    const toRect = (el: HTMLDivElement | null): Rect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
    };
    setDims({
      agents: agentRowRefs.current.map(toRect).filter((r): r is Rect => r !== null),
      channels: channelRowRefs.current.map(toRect).filter((r): r is Rect => r !== null),
      schedules: scheduleRowRefs.current.map(toRect).filter((r): r is Rect => r !== null),
      containerH: containerRef.current.offsetHeight,
    });
  }, []);

  useEffect(() => {
    measure();
    const obs = new ResizeObserver(measure);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [measure, agents.length]);

  const mid = (r: Rect) => r.y + r.h / 2;

  // Symmetric bezier — control points at horizontal midpoint
  const bez = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1},${mx},${y2},${x2},${y2}`;
  };

  return (
    <div className="mb-8 p-6 rounded-lg border relative overflow-hidden" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: 'linear-gradient(var(--pd-text) 1px,transparent 1px),linear-gradient(90deg,var(--pd-text) 1px,transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <div className="relative">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--pd-text)' }}>Channel Flow Graph</h2>
            <p className="text-xs opacity-50" style={{ color: 'var(--pd-text)' }}>
              Hover agents, channels, or schedules to trace causal chains
            </p>
          </div>
          <div className="flex items-center gap-5 text-xs opacity-50" style={{ color: 'var(--pd-text)' }}>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-px inline-block" style={{ borderTop: '1px dashed #CC3D2E' }} /> publishes →
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-px inline-block bg-[#F1A661]" /> ← triggers
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-px inline-block bg-[#8B7355]" /> scheduled
            </span>
          </div>
        </div>

        {/* Columns container — SVG absolutely overlays this */}
        <div ref={containerRef} className="relative flex gap-6 items-start overflow-x-auto"
          style={{ minHeight: dims.containerH || undefined }}>

          {/* SVG overlay — drawn over the full container */}
          <svg
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: dims.containerH || '100%',
              overflow: 'visible', pointerEvents: 'none', zIndex: 0,
            }}
          >
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              {/* Arrow pointing right (for publish) */}
              <marker id="arrowPublish" markerWidth="8" markerHeight="8" refX="7" refY="3"
                orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L8,3 z" fill="#CC3D2E" />
              </marker>
              {/* Arrow pointing left (for trigger — path ends at agent right edge) */}
              <marker id="arrowTrigger" markerWidth="8" markerHeight="8" refX="1" refY="3"
                orient="auto" markerUnits="strokeWidth">
                <path d="M8,0 L8,6 L0,3 z" fill="#F1A661" />
              </marker>
              {/* Arrow pointing right (for schedule) */}
              <marker id="arrowSchedule" markerWidth="8" markerHeight="8" refX="7" refY="3"
                orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L8,3 z" fill="#8B7355" />
              </marker>
            </defs>

            {/* Schedule → Agent */}
            {scheduleArray.map((sched, si) => {
              const sr = dims.schedules[si];
              if (!sr) return null;
              return scheduleToAgents.get(sched)?.map((agentName) => {
                const ai = agents.findIndex(a => a.agentName === agentName);
                const ar = dims.agents[ai];
                if (!ar) return null;
                const x1 = sr.x + sr.w, y1 = mid(sr);
                const x2 = ar.x, y2 = mid(ar);
                const isHi = highlightedAgent === agentName || highlightedSchedule === sched;
                const d = bez(x1, y1, x2, y2);
                return (
                  <g key={`s${si}-${agentName}`}>
                    <path d={d} fill="none"
                      stroke={isHi ? '#8B7355' : '#3A3530'}
                      strokeWidth={isHi ? 2 : 1.5}
                      opacity={highlightedSchedule && !isHi ? 0.1 : isHi ? 0.9 : 0.35}
                      style={{ transition: 'all 0.3s' }}
                      filter={isHi ? 'url(#glow)' : undefined}
                      markerEnd={isHi ? 'url(#arrowSchedule)' : undefined}
                    />
                    {isHi && <circle r="3" fill="#8B7355"><animateMotion dur="2s" repeatCount="indefinite" path={d} /></circle>}
                  </g>
                );
              });
            })}

            {/* Agent → Channel (publish, L→R, dashed) */}
            {agents.map((agent, ai) => {
              const ar = dims.agents[ai];
              if (!ar) return null;
              return agent.broadcasting?.map((ch) => {
                const ci = channelArray.indexOf(ch);
                const cr2 = dims.channels[ci];
                if (!cr2) return null;
                const x1 = ar.x + ar.w, y1 = mid(ar);
                const x2 = cr2.x, y2 = mid(cr2);
                const isHi = highlightedAgent === agent.agentName || highlightedChannel === ch;
                const d = bez(x1, y1, x2, y2);
                return (
                  <g key={`pub-${ai}-${ch}`}>
                    <path d={d} fill="none"
                      stroke={isHi ? '#CC3D2E' : '#3A3530'}
                      strokeWidth={isHi ? 2 : 1.5}
                      strokeDasharray="5,4"
                      opacity={highlightedAgent && !isHi ? 0.1 : isHi ? 0.9 : 0.3}
                      style={{ transition: 'all 0.3s' }}
                      filter={isHi ? 'url(#glow)' : undefined}
                      markerEnd={isHi ? 'url(#arrowPublish)' : undefined}
                    />
                    {isHi && <circle r="3" fill="#CC3D2E"><animateMotion dur="2s" repeatCount="indefinite" path={d} /></circle>}
                  </g>
                );
              });
            })}

            {/* Channel → Agent (trigger, R→L, solid) — path goes from channel LEFT edge back to agent RIGHT edge */}
            {channelArray.map((ch, ci) => {
              const cr2 = dims.channels[ci];
              if (!cr2) return null;
              return channelToAgents.get(ch)?.map((agentName) => {
                const ai = agents.findIndex(a => a.agentName === agentName);
                const ar = dims.agents[ai];
                if (!ar) return null;
                // Start at left edge of channel, end at right edge of agent
                const x1 = cr2.x, y1 = mid(cr2);
                const x2 = ar.x + ar.w, y2 = mid(ar);
                const isHi = highlightedAgent === agentName || highlightedChannel === ch;
                const d = bez(x1, y1, x2, y2);
                return (
                  <g key={`trig-${ci}-${agentName}`}>
                    <path d={d} fill="none"
                      stroke={isHi ? '#F1A661' : '#3A3530'}
                      strokeWidth={isHi ? 2 : 1.5}
                      opacity={highlightedAgent && !isHi ? 0.1 : isHi ? 0.9 : 0.3}
                      style={{ transition: 'all 0.3s' }}
                      filter={isHi ? 'url(#glow)' : undefined}
                      markerEnd={isHi ? 'url(#arrowTrigger)' : undefined}
                    />
                    {isHi && <circle r="3" fill="#F1A661"><animateMotion dur="2.5s" repeatCount="indefinite" path={d} /></circle>}
                  </g>
                );
              });
            })}
          </svg>

          {/* Schedules column */}
          {scheduleArray.length > 0 && (
            <div className="flex flex-col gap-2.5 min-w-[110px]" style={{ position: 'relative', zIndex: 1 }}>
              <div className="text-xs font-semibold opacity-40 mb-2 tracking-wider" style={{ color: 'var(--pd-text)' }}>SCHEDULES</div>
              {scheduleArray.map((sched, idx) => (
                <div key={idx}
                  ref={el => { scheduleRowRefs.current[idx] = el; }}
                  className="px-3 py-1.5 rounded font-mono text-xs cursor-pointer transition-all duration-200"
                  style={{
                    backgroundColor: highlightedSchedule === sched ? '#2A2520' : '#1E1B18',
                    color: '#8B7355',
                    border: `1px solid ${highlightedSchedule === sched ? '#8B7355' : '#3A3530'}`,
                    opacity: highlightedSchedule && highlightedSchedule !== sched ? 0.4 : 1,
                    boxShadow: highlightedSchedule === sched ? '0 0 20px rgba(139,115,85,0.3)' : 'none',
                  }}
                  onMouseEnter={() => setHighlightedSchedule(sched)}
                  onMouseLeave={() => setHighlightedSchedule(null)}
                >
                  {sched}
                </div>
              ))}
            </div>
          )}

          {/* Agents column */}
          <div className="flex flex-col gap-3 min-w-[140px]" style={{ position: 'relative', zIndex: 1 }}>
            <div className="text-xs font-semibold opacity-40 mb-2 tracking-wider" style={{ color: 'var(--pd-text)' }}>AGENTS</div>
            {agents.map((agent, idx) => (
              <div key={idx}
                ref={el => { agentRowRefs.current[idx] = el; }}
                className="px-3 py-2 rounded font-mono text-sm cursor-pointer transition-all duration-200"
                style={{
                  backgroundColor: highlightedAgent === agent.agentName ? '#2A2520' : '#1E1B18',
                  color: agentColors[agent.agentName] || '#D4C5A9',
                  border: `1px solid ${highlightedAgent === agent.agentName ? (agentColors[agent.agentName] || '#CC3D2E') : '#3A3530'}`,
                  opacity: highlightedAgent && highlightedAgent !== agent.agentName ? 0.4 : 1,
                  boxShadow: highlightedAgent === agent.agentName ? `0 0 20px ${agentColors[agent.agentName] || '#CC3D2E'}40` : 'none',
                }}
                onMouseEnter={() => onAgentHover(agent.agentName)}
                onMouseLeave={() => onAgentHover(null)}
              >
                {agent.agentName}
              </div>
            ))}
          </div>

          {/* Flex spacer so channels sit on the far right */}
          <div className="flex-1" style={{ minWidth: 120 }} />

          {/* Channels column */}
          <div className="flex flex-col gap-2.5 min-w-[170px]" style={{ position: 'relative', zIndex: 1 }}>
            <div className="text-xs font-semibold opacity-40 mb-2 tracking-wider" style={{ color: 'var(--pd-text)' }}>CHANNELS</div>
            {channelArray.map((ch, idx) => {
              const count = channelToAgents.get(ch)?.length || 0;
              const isHi = highlightedChannel === ch;
              return (
                <div key={idx}
                  ref={el => { channelRowRefs.current[idx] = el; }}
                  className="px-3 py-1.5 rounded font-mono text-xs cursor-pointer transition-all duration-200"
                  style={{
                    backgroundColor: isHi ? '#2A2520' : '#1E1B18',
                    border: `1px solid ${isHi ? '#CC3D2E' : '#3A3530'}`,
                    opacity: highlightedChannel && !isHi ? 0.4 : 1,
                    boxShadow: isHi ? '0 0 20px rgba(204,61,46,0.3)' : 'none',
                  }}
                  onMouseEnter={() => setHighlightedChannel(ch)}
                  onMouseLeave={() => setHighlightedChannel(null)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span><ColoredToken text={ch} /></span>
                    {count > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                        style={{ backgroundColor: '#CC3D2E', color: '#D4C5A9', opacity: 0.8 }}>
                        {count}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChannelFlowGraph;
