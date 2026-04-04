import { useState, useEffect } from 'react';
import { Zap, Clock, ChevronDown, ChevronRight, ArrowRight, Sun, Moon } from 'lucide-react';
import AgentRadioCard, { type AgentData, agentColors } from './components/AgentRadioCard';
import ChannelFlowGraph from './components/ChannelFlowGraph';

// ─── port-daddy fleet ────────────────────────────────────────────────────────
const PD_AGENTS: AgentData[] = [
  {
    agentName: 'gardener',
    description: 'Watches for uncommitted changes, auto-commits with AI-generated messages every 10 min.',
    trigger: { type: 'schedule', value: '10 min' },
    eventHistory: [
      { time: '8 min ago',  outcome: 'clean',    storyLine: 'No source changes detected — working tree clean' },
      { time: '18 min ago', outcome: 'clean',    storyLine: 'Committed f38dc6b — fix(security): decryptSecret returns null' },
      { time: '28 min ago', outcome: 'clean',    storyLine: 'Committed 29e0ed6 — feat: FleetBar macOS menu bar app' },
    ],
    listening: [], broadcasting: ['git:status', 'git:committed'],
    artifacts: [], consequences: ['git:committed triggers qa, test-hunter, documentarian, simplifier, cartographer'],
    status: 'idle',
  },
  {
    agentName: 'qa',
    description: 'Adversarial code review — tries to break every commit before users do.',
    trigger: { type: 'event', value: 'git:committed' },
    eventHistory: [
      { time: '2 min ago', outcome: 'clean',    storyLine: 'No issues in f38dc6b — fix(security): decryptSecret returns null' },
      { time: '1 hr ago',  outcome: 'findings', storyLine: 'Found null dereference in lib/fleet-engine.ts:142 — SEVERITY: crash' },
      { time: '3 hr ago',  outcome: 'clean',    storyLine: 'No issues in 2cf5acb — docs: homepage redesign brief' },
    ],
    listening: ['git:committed'], broadcasting: ['qa:clean', 'qa:findings'],
    artifacts: [], consequences: ['qa:findings triggers notify-findings watcher'],
    status: 'active',
  },
  {
    agentName: 'test-hunter',
    description: 'Runs test suite, finds modules below 50% coverage, writes meaningful tests.',
    trigger: { type: 'event', value: 'git:committed' },
    eventHistory: [
      { time: '2 min ago', outcome: 'findings', storyLine: 'Found 2 uncovered branches in lib/fleet-daemon.ts' },
      { time: '1 hr ago',  outcome: 'clean',    storyLine: 'All tracked modules above 50% threshold' },
      { time: '3 hr ago',  outcome: 'findings', storyLine: 'Generated 3 test stubs for lib/note-encryption.ts' },
    ],
    listening: ['git:committed'], broadcasting: [],
    artifacts: ['tests/unit/fleet-daemon.test.js'], consequences: [],
    status: 'active',
  },
  {
    agentName: 'documentarian',
    description: 'Keeps all docs in sync — CLAUDE.md, README, SKILL.md, website pages.',
    trigger: { type: 'event', value: 'git:committed' },
    eventHistory: [
      { time: '2 min ago', outcome: 'clean', storyLine: 'CLAUDE.md fleet daemon section updated — 3 new routes documented' },
      { time: '1 hr ago',  outcome: 'clean', storyLine: 'SKILL.md updated — spawn/watch commands added' },
      { time: '3 hr ago',  outcome: 'clean', storyLine: 'Changelog entry added for FleetBar enhancements' },
    ],
    listening: ['git:committed'], broadcasting: [],
    artifacts: ['CLAUDE.md', 'skills/port-daddy-cli/SKILL.md'], consequences: [],
    status: 'idle',
  },
  {
    agentName: 'simplifier',
    description: 'Reviews recent changes for unnecessary complexity. Simplifies without breaking.',
    trigger: { type: 'event', value: 'git:committed' },
    eventHistory: [
      { time: '2 min ago', outcome: 'clean',    storyLine: 'No simplifications found — code is sufficiently direct' },
      { time: '2 hr ago',  outcome: 'findings', storyLine: 'Removed 14 lines of dead code from lib/agents.ts' },
      { time: '1 day ago', outcome: 'clean',    storyLine: 'No unnecessary complexity found in route changes' },
    ],
    listening: ['git:committed'], broadcasting: [],
    artifacts: [], consequences: [],
    status: 'idle',
  },
  {
    agentName: 'cartographer',
    description: 'Maintains the V4 roadmap — moves items NEXT → COMPLETE as commits land.',
    trigger: { type: 'event', value: 'git:committed' },
    eventHistory: [
      { time: '2 min ago', outcome: 'clean', storyLine: 'Fleet daemon: 3 items moved to COMPLETE' },
      { time: '1 hr ago',  outcome: 'clean', storyLine: 'Velocity: 4.2 commits/day · Phase 0 is 94% complete' },
      { time: '1 day ago', outcome: 'clean', storyLine: 'Flagged pd mcp install as blocked — no commits in 8 days' },
    ],
    listening: ['git:committed'], broadcasting: [],
    artifacts: ['docs/V4-UNIFIED-ROADMAP.md', '.cartographer/status.md'], consequences: [],
    status: 'idle',
  },
  {
    agentName: 'spark',
    description: 'Generates one concrete feature idea per run from codebase context.',
    trigger: { type: 'schedule', value: '30 min' },
    eventHistory: [
      { time: '12 min ago', outcome: 'findings', storyLine: 'spider-trie-pubsub-routing.md — pheromone trails × Arbiter staleness' },
      { time: '42 min ago', outcome: 'findings', storyLine: 'fleet-yaml-live-reload.md — SIGHUP reloads pd-fleet.yml' },
      { time: '1 hr ago',   outcome: 'clean',    storyLine: 'No new patterns detected this cycle' },
    ],
    listening: [], broadcasting: ['spark:idea'],
    artifacts: ['.spark/ideas/2026-04-01-pheromone-arbiter.md'],
    consequences: ['spark:idea triggers spider'],
    status: 'idle',
  },
  {
    agentName: 'spider',
    description: 'Finds combinatorial connections between features. Outputs syllogisms.',
    trigger: { type: 'event', value: 'spark:idea' },
    eventHistory: [
      { time: '10 min ago', outcome: 'findings', storyLine: '7 syllogisms: trie+pubsub, pheromone+Arbiter, symbol-claims+merge…' },
      { time: '1 hr ago',   outcome: 'findings', storyLine: '5 syllogisms: harbor-tokens+resurrection, dns+health-checks…' },
      { time: '3 hr ago',   outcome: 'clean',    storyLine: 'No surprising connections found — skipping' },
    ],
    listening: ['spark:idea'], broadcasting: ['spider:connections'],
    artifacts: ['.spider/connections/2026-04-01-session.md'], consequences: [],
    status: 'active',
  },
];

// ─── bosun fleet ──────────────────────────────────────────────────────────────
const BOSUN_AGENTS: AgentData[] = [
  {
    agentName: 'gardener',
    description: 'Auto-commits Bosun changes with AI messages every 15 min.',
    trigger: { type: 'schedule', value: '15 min' },
    eventHistory: [
      { time: '7 min ago',  outcome: 'clean', storyLine: 'No changes in working tree' },
      { time: '22 min ago', outcome: 'clean', storyLine: 'Committed — feat: LLM routing via Ollama' },
    ],
    listening: [], broadcasting: ['git:committed'],
    artifacts: [], consequences: [], status: 'idle',
  },
  {
    agentName: 'qa',
    description: 'Reviews each Bosun commit for logic errors and LLM interaction bugs.',
    trigger: { type: 'event', value: 'git:committed' },
    eventHistory: [
      { time: '8 hr ago', outcome: 'clean', storyLine: 'No issues — SQLCipher migration clean' },
    ],
    listening: ['git:committed'], broadcasting: ['qa:clean', 'qa:findings'],
    artifacts: [], consequences: [], status: 'idle',
  },
  {
    agentName: 'spark',
    description: 'Generates Bosun feature ideas — local LLM integrations, UX patterns.',
    trigger: { type: 'schedule', value: '1 hr' },
    eventHistory: [
      { time: '45 min ago', outcome: 'findings', storyLine: 'voice-memo-transcription.md — whisper.cpp + context injection' },
    ],
    listening: [], broadcasting: ['spark:idea'],
    artifacts: ['.spark/ideas/2026-04-01-voice.md'], consequences: [], status: 'idle',
  },
];

// ─── projects ─────────────────────────────────────────────────────────────────
interface ProjectData {
  name: string;
  dirPath: string;
  fleetFile: string;
  agents: AgentData[];
}

const PROJECTS: ProjectData[] = [
  { name: 'port-daddy', dirPath: '~/coding/port-daddy',  fleetFile: 'pd-fleet.yml', agents: PD_AGENTS },
  { name: 'bosun',      dirPath: '~/coding/bosun',       fleetFile: 'pd-fleet.yml', agents: BOSUN_AGENTS },
];

const STARTER_YAML = `fleet:
  agents:
    - name: gardener
      trigger:
        type: schedule
        value: "10 min"
      prompt: |
        Check for uncommitted changes. If any exist,
        write a clear commit message and commit them.
      broadcasting:
        - git:committed

    - name: qa
      trigger:
        type: event
        value: git:committed
      prompt: |
        Review the latest commit adversarially.
        Find bugs, edge cases, and security issues.
      listening:
        - git:committed
      broadcasting:
        - qa:clean
        - qa:findings`;

// ─── types ────────────────────────────────────────────────────────────────────
type View = 'mini' | 'full';
type Tab  = 'agents' | 'flow' | 'config';
interface EditState { agent: AgentData; prompt: string; dirty: boolean; saved: string; }

// ─── Mini agent row ───────────────────────────────────────────────────────────
function AgentRow({ agent, onOpen }: { agent: AgentData; onOpen: () => void }) {
  const color  = agentColors[agent.agentName] || '#D4C5A9';
  const active = agent.status === 'active';
  const lastEvent = agent.eventHistory[0];
  const outcomeColor = lastEvent?.outcome === 'findings' ? '#F87171'
    : lastEvent?.outcome === 'running' ? '#FBBF24' : '#6EE7B7';

  return (
    <div
      className="flex items-center gap-3 py-1.5 px-3 rounded cursor-pointer transition-all"
      style={{ color: 'var(--pd-text)' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#2A2520')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
      onClick={onOpen}
    >
      {/* Status dot */}
      <div className="relative flex-shrink-0">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        {active && <div className="absolute inset-0 w-2 h-2 rounded-full animate-ping opacity-40" style={{ backgroundColor: color }} />}
      </div>

      {/* Name */}
      <span className="font-mono text-xs font-semibold w-28 flex-shrink-0" style={{ color }}>{agent.agentName}</span>

      {/* Status */}
      <span className="text-[9px] font-bold tracking-wider w-12 flex-shrink-0"
        style={{ color: active ? '#4ade80' : '#6B5D4F' }}>
        {agent.status.toUpperCase()}
      </span>

      {/* Trigger */}
      <span className="flex items-center gap-1 text-[10px] font-mono opacity-50 flex-1 min-w-0 truncate">
        {agent.trigger.type === 'event'
          ? <Zap size={9} style={{ color: '#FBBF24', flexShrink: 0 }} />
          : <Clock size={9} style={{ color: '#34D399', flexShrink: 0 }} />}
        <span className="truncate">{agent.trigger.value}</span>
      </span>

      {/* Last run */}
      {lastEvent && (
        <span className="text-[10px] flex-shrink-0 opacity-60" style={{ color: outcomeColor }}>
          {lastEvent.time}
        </span>
      )}
    </div>
  );
}

// ─── Collapsible project card ─────────────────────────────────────────────────
function ProjectCard({
  project, expanded, onToggle, onOpen, onOpenAgent,
}: {
  project: ProjectData;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onOpenAgent: (agent: AgentData) => void;
}) {
  const activeCount = project.agents.filter(a => a.status === 'active').length;
  const hasFindings = project.agents.some(a => a.eventHistory[0]?.outcome === 'findings');

  return (
    <div className="rounded-lg border overflow-hidden transition-all" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
      {/* Header — always visible */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={onToggle}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#221F1C')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDown size={13} style={{ color: 'var(--pd-muted)' }} />
            : <ChevronRight size={13} style={{ color: 'var(--pd-muted)' }} />}
          <span className="font-mono font-bold text-sm" style={{ color: 'var(--pd-text)' }}>{project.name}</span>
          {activeCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: '#10B981', color: '#0A0908' }}>
              {activeCount} active
            </span>
          )}
          {hasFindings && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: '#EF444420', color: '#F87171', border: '1px solid #EF444440' }}>
              findings
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] opacity-25 font-mono" style={{ color: 'var(--pd-text)' }}>
            {project.agents.length} agents
          </span>
          <button
            onClick={e => { e.stopPropagation(); onOpen(); }}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-all"
            style={{ color: '#CC3D2E', backgroundColor: '#CC3D2E15', border: '1px solid #CC3D2E40' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
          >
            open
            <ArrowRight size={9} />
          </button>
        </div>
      </div>

      {/* dirPath — compact */}
      {!expanded && (
        <div className="px-4 pb-2 text-[10px] font-mono opacity-20" style={{ color: 'var(--pd-text)', marginTop: -4 }}>
          {project.dirPath}/{project.fleetFile}
        </div>
      )}

      {/* Expanded: agent rows */}
      {expanded && (
        <div className="pb-2">
          <div className="px-4 pb-1 text-[10px] font-mono opacity-20 border-b border-[#2A2622] pb-2 mb-1" style={{ color: 'var(--pd-text)' }}>
            {project.dirPath}/{project.fleetFile}
          </div>
          {/* Column headers */}
          <div className="flex items-center gap-3 px-3 pt-1 pb-0.5">
            <div className="w-2 flex-shrink-0" />
            <span className="text-[9px] uppercase tracking-wider opacity-25 w-28 flex-shrink-0" style={{ color: 'var(--pd-text)' }}>agent</span>
            <span className="text-[9px] uppercase tracking-wider opacity-25 w-12 flex-shrink-0" style={{ color: 'var(--pd-text)' }}>status</span>
            <span className="text-[9px] uppercase tracking-wider opacity-25 flex-1" style={{ color: 'var(--pd-text)' }}>trigger</span>
            <span className="text-[9px] uppercase tracking-wider opacity-25 flex-shrink-0" style={{ color: 'var(--pd-text)' }}>last run</span>
          </div>
          {project.agents.map(agent => (
            <AgentRow key={agent.agentName} agent={agent} onOpen={() => onOpenAgent(agent)} />
          ))}
          <div className="px-3 pt-2">
            <button
              onClick={onOpen}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs transition-all"
              style={{ color: '#CC3D2E', backgroundColor: '#CC3D2E10', border: '1px solid #CC3D2E30' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#CC3D2E20'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#CC3D2E10'; }}
            >
              Open full view
              <ArrowRight size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add fleet instructions ───────────────────────────────────────────────────
function AddFleetPanel() {
  const [open,   setOpen]   = useState(false);
  const [copied, setCopied] = useState(false);

  const copyYaml = () => {
    navigator.clipboard.writeText(STARTER_YAML);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border overflow-hidden transition-all"
      style={{ borderColor: open ? 'var(--pd-border)' : 'var(--pd-border-2)', backgroundColor: open ? 'var(--pd-surface)' : 'transparent' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-xs transition-all"
        style={{ color: open ? 'var(--pd-text)' : 'var(--pd-muted)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--pd-text)'; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.color = 'var(--pd-muted)'; }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-semibold">Add a fleet to any project</span>
        <span className="opacity-40 ml-1">— one command</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">

          {/* Primary: pd fleet init */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: '#CC3D2E', color: 'var(--pd-text)' }}>1</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--pd-text)' }}>
                Run this from inside your project
              </span>
            </div>
            <div className="ml-7 rounded p-2.5 font-mono text-sm" style={{ backgroundColor: 'var(--pd-code)', border: '1px solid var(--pd-border-2)' }}>
              <span style={{ color: 'var(--pd-muted)' }}>$ </span>
              <span style={{ color: 'var(--pd-text)', fontWeight: 600 }}>pd fleet init</span>
            </div>
            <div className="ml-7 mt-2 text-[11px] leading-relaxed opacity-60" style={{ color: 'var(--pd-text)' }}>
              Launches an interactive wizard (built with Ink). Picks a template, lets you
              customize agent prompts, and registers with the daemon — all in your terminal.
            </div>
          </div>

          {/* Non-interactive flags */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'var(--pd-border)', color: 'var(--pd-text)' }}>2</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--pd-text)' }}>
                Skip the wizard if you prefer
              </span>
            </div>
            <div className="ml-7 rounded p-2.5 font-mono text-xs space-y-1.5" style={{ backgroundColor: 'var(--pd-code)', border: '1px solid var(--pd-border-2)' }}>
              {[
                ['pd fleet init --yes',              'all defaults (gardener + qa)'],
                ['pd fleet init --template full',    'all 8 agents'],
                ['pd fleet init --from ./fleet.yml', 'use existing config'],
              ].map(([cmd, hint]) => (
                <div key={cmd} className="flex items-center gap-3">
                  <span style={{ color: 'var(--pd-text)' }}>{cmd}</span>
                  <span style={{ color: 'var(--pd-muted)' }}># {hint}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Prompts are universal */}
          <div className="ml-0 rounded p-3 text-xs leading-relaxed"
            style={{ backgroundColor: 'var(--pd-code)', border: '1px solid var(--pd-border-2)', color: 'var(--pd-dim)' }}>
            <div className="font-semibold mb-1" style={{ color: 'var(--pd-text)' }}>Are the default prompts port-daddy-specific?</div>
            <p>No. The default prompts describe universal behaviors — auto-commit uncommitted work, review code
            adversarially, track coverage, keep docs in sync. They work for any project.
            You customize them after init, and edits here sync directly to <code style={{ color: '#CC3D2E' }}>pd-fleet.yml</code>.</p>
          </div>

          {/* Manual fallback: YAML */}
          <details className="group">
            <summary className="text-[10px] cursor-pointer opacity-50 hover:opacity-80 transition-opacity"
              style={{ color: 'var(--pd-text)' }}>
              Or manually create pd-fleet.yml
            </summary>
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] opacity-40" style={{ color: 'var(--pd-text)' }}>starter template</span>
                <button onClick={copyYaml} className="text-[10px] px-2 py-0.5 rounded transition-all"
                  style={{ color: copied ? '#4ade80' : '#CC3D2E', backgroundColor: '#CC3D2E15', border: '1px solid #CC3D2E40' }}>
                  {copied ? 'copied!' : 'copy'}
                </button>
              </div>
              <pre className="text-[10px] rounded p-3 overflow-x-auto leading-relaxed font-mono"
                style={{ backgroundColor: 'var(--pd-code)', color: 'var(--pd-dim)', border: '1px solid var(--pd-border-2)' }}>
                {STARTER_YAML}
              </pre>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [view,      setView]      = useState<View>('mini');
  const [project,   setProject]   = useState<ProjectData>(PROJECTS[0]);
  const [tab,       setTab]       = useState<Tab>('agents');
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set(PROJECTS.map(p => p.name)));
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [daemonOk,  setDaemonOk]  = useState(false);
  const [editing,   setEditing]   = useState<EditState | null>(null);
  const [isLight,   setIsLight]   = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('pd-theme') === 'light'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
    localStorage.setItem('pd-theme', isLight ? 'light' : 'dark');
  }, [isLight]);

  useEffect(() => {
    const check = () =>
      fetch('http://localhost:9876/ping', { signal: AbortSignal.timeout(2000) })
        .then(r => setDaemonOk(r.ok)).catch(() => setDaemonOk(false));
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  const toggleExpanded = (name: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s; });

  const openProject = (p: ProjectData, startTab: Tab = 'agents') => {
    setProject(p);
    setTab(startTab);
    setEditing(null);
    setView('full');
  };

  const openAgentConfig = (p: ProjectData, agent: AgentData) => {
    setProject(p);
    setEditing({ agent, prompt: agent.description, dirty: false, saved: '' });
    setTab('config');
    setView('full');
  };

  const saveConfig = async () => {
    if (!editing) return;
    try {
      const r = await fetch('http://localhost:9876/fleet/edit-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: editing.agent.agentName, prompt: editing.prompt }),
      });
      setEditing(e => e ? { ...e, dirty: false, saved: r.ok ? `Updated ${project.fleetFile}` : 'Saved locally' } : null);
    } catch {
      setEditing(e => e ? { ...e, dirty: false, saved: 'Saved locally (daemon offline)' } : null);
    }
    setTimeout(() => setEditing(e => e ? { ...e, saved: '' } : null), 3500);
  };

  // Tabs for full view — agents is the home tab, flow is expanded from the mini preview
  const tabs: { id: Tab; label: string }[] = [
    { id: 'agents', label: 'Agents' },
    { id: 'flow',   label: 'Channel Flow' },
    { id: 'config', label: editing ? `Configure: ${editing.agent.agentName}` : 'Configure' },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--pd-bg)' }}>

      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-3 border-b border-[#2A2622]"
        style={{ backgroundColor: 'var(--pd-header)' }}>
        <div className="flex items-center gap-3">
          {view === 'full' && (
            <button onClick={() => setView('mini')}
              className="flex items-center gap-1 text-xs opacity-40 hover:opacity-80 transition-opacity mr-1"
              style={{ color: 'var(--pd-text)' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              all projects
            </button>
          )}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#CC3D2E" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 20V12"/><path d="M5 7.5A9 9 0 0 1 19 7.5"/>
            <path d="M2 4.5A14 14 0 0 1 22 4.5"/><path d="M8 10.5a5 5 0 0 1 8 0"/>
            <circle cx="12" cy="12" r="1.5" fill="#CC3D2E" stroke="none"/>
          </svg>
          <span className="font-bold text-sm" style={{ color: 'var(--pd-text)' }}>PortDaddy</span>
          <span className="opacity-20 text-sm" style={{ color: 'var(--pd-text)' }}>:</span>
          {view === 'full'
            ? <span className="font-mono text-sm font-semibold" style={{ color: '#CC3D2E' }}>{project.name}</span>
            : <span className="text-xs tracking-widest uppercase opacity-35" style={{ color: 'var(--pd-text)' }}>Agentic Control Plane</span>
          }
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs" style={{ color: daemonOk ? '#4ade80' : '#f87171' }}>
            <div className="relative w-2 h-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: daemonOk ? '#22c55e' : '#ef4444' }} />
              {daemonOk && <div className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-50" />}
            </div>
            {daemonOk ? 'daemon running' : 'daemon offline'}
          </div>
          {view === 'full' && (
            <span className="text-[10px] opacity-25 font-mono" style={{ color: 'var(--pd-text)' }}>
              {project.dirPath}/{project.fleetFile}
            </span>
          )}
          {/* Light/dark toggle */}
          <button
            onClick={() => setIsLight(l => !l)}
            className="p-1.5 rounded-md transition-all"
            style={{ color: 'var(--pd-muted)', backgroundColor: 'var(--pd-surface-2)', border: '1px solid var(--pd-border)' }}
            title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {isLight ? <Moon size={13} /> : <Sun size={13} />}
          </button>
        </div>
      </header>

      {/* ── Mini view ──────────────────────────────────────────────────────── */}
      {view === 'mini' && (
        <main className="p-5 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-base font-bold mb-0.5" style={{ color: 'var(--pd-text)' }}>All Projects</h1>
              <p className="text-[10px] opacity-35" style={{ color: 'var(--pd-text)' }}>
                {PROJECTS.reduce((n, p) => n + p.agents.length, 0)} agents across {PROJECTS.length} projects
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 mb-3">
            {PROJECTS.map(p => (
              <ProjectCard
                key={p.name}
                project={p}
                expanded={expanded.has(p.name)}
                onToggle={() => toggleExpanded(p.name)}
                onOpen={() => openProject(p)}
                onOpenAgent={agent => openAgentConfig(p, agent)}
              />
            ))}
          </div>

          <AddFleetPanel />
        </main>
      )}

      {/* ── Full view ──────────────────────────────────────────────────────── */}
      {view === 'full' && (
        <>
          <div className="flex border-b border-[#2A2622] px-6" style={{ backgroundColor: 'var(--pd-header)' }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="px-4 py-3 text-xs font-medium transition-colors border-b-2 -mb-px"
                style={{ color: tab === t.id ? '#D4C5A9' : '#6B5D4F', borderBottomColor: tab === t.id ? '#CC3D2E' : 'transparent' }}>
                {t.label}
              </button>
            ))}
          </div>

          <main className="p-6 max-w-7xl mx-auto">

            {/* Agents tab — mini flow preview at top, then cards */}
            {tab === 'agents' && (
              <div>
                {/* Mini channel flow preview — click to expand */}
                <div
                  className="mb-6 rounded-lg border overflow-hidden cursor-pointer relative group"
                  style={{ height: 170, backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}
                  onClick={() => setTab('flow')}
                >
                  {/* Scaled-down flow graph */}
                  <div style={{
                    transform: 'scale(0.38)',
                    transformOrigin: 'top left',
                    width: `${100 / 0.38}%`,
                    pointerEvents: 'none',
                    position: 'absolute', top: 0, left: 0,
                  }}>
                    <ChannelFlowGraph agents={project.agents} highlightedAgent={null} onAgentHover={() => {}} />
                  </div>
                  {/* Gradient fade at bottom */}
                  <div className="absolute inset-x-0 bottom-0 h-12"
                    style={{ background: 'linear-gradient(to top, #1E1B18 0%, transparent 100%)' }} />
                  {/* Label */}
                  <div className="absolute top-2.5 left-3 text-[9px] font-bold tracking-widest uppercase opacity-40"
                    style={{ color: 'var(--pd-text)' }}>Channel Flow</div>
                  {/* Expand hint on hover */}
                  <div className="absolute bottom-2 right-3 flex items-center gap-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: '#CC3D2E' }}>
                    expand
                    <ArrowRight size={10} />
                  </div>
                </div>

                {/* Agents grid */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h1 className="text-base font-bold mb-0.5" style={{ color: 'var(--pd-text)' }}>
                      {project.name} · Fleet
                    </h1>
                    <p className="text-[10px] opacity-35" style={{ color: 'var(--pd-text)' }}>
                      {project.agents.filter(a => a.status === 'active').length} active · {project.agents.length} total
                    </p>
                  </div>
                </div>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
                  {project.agents.map(agent => (
                    <div key={agent.agentName}
                      style={{ opacity: highlighted && highlighted !== agent.agentName ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                      <AgentRadioCard {...agent} onConfigure={() => {
                        setEditing({ agent, prompt: agent.description, dirty: false, saved: '' });
                        setTab('config');
                      }} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full channel flow */}
            {tab === 'flow' && (
              <ChannelFlowGraph agents={project.agents} highlightedAgent={highlighted} onAgentHover={setHighlighted} />
            )}

            {/* Configure */}
            {tab === 'config' && (
              <div className="max-w-2xl">
                {editing ? (
                  <>
                    <div className="mb-6">
                      <h1 className="text-base font-bold mb-0.5" style={{ color: 'var(--pd-text)' }}>
                        Configure: <span style={{ color: '#CC3D2E' }}>{editing.agent.agentName}</span>
                      </h1>
                      <p className="text-[10px] opacity-35 font-mono" style={{ color: 'var(--pd-text)' }}>
                        {project.dirPath}/{project.fleetFile}
                      </p>
                    </div>
                    <div className="mb-4">
                      <label className="block text-[10px] tracking-wider uppercase opacity-40 mb-1.5" style={{ color: 'var(--pd-text)' }}>Trigger</label>
                      <div className="flex gap-2">
                        <select value={editing.agent.trigger.type}
                          onChange={e => setEditing(ed => ed ? { ...ed, dirty: true, agent: { ...ed.agent, trigger: { ...ed.agent.trigger, type: e.target.value as 'event'|'schedule' } } } : null)}
                          className="rounded-md px-3 py-2 text-sm font-mono border border-[#3A3530] focus:outline-none"
                          style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)' }}>
                          <option value="event">fires when (event)</option>
                          <option value="schedule">fires every (schedule)</option>
                        </select>
                        <input value={editing.agent.trigger.value}
                          onChange={e => setEditing(ed => ed ? { ...ed, dirty: true, agent: { ...ed.agent, trigger: { ...ed.agent.trigger, value: e.target.value } } } : null)}
                          className="flex-1 rounded-md px-3 py-2 text-sm font-mono border border-[#3A3530] focus:outline-none"
                          style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)' }} />
                      </div>
                    </div>
                    <div className="mb-4">
                      <label className="block text-[10px] tracking-wider uppercase opacity-40 mb-1.5" style={{ color: 'var(--pd-text)' }}>Prompt</label>
                      <textarea rows={14} value={editing.prompt}
                        onChange={e => setEditing(ed => ed ? { ...ed, prompt: e.target.value, dirty: true } : null)}
                        className="w-full rounded-md px-3 py-2.5 text-xs font-mono border border-[#3A3530] focus:outline-none resize-y"
                        style={{ backgroundColor: 'var(--pd-code)', color: 'var(--pd-text)', lineHeight: 1.7 }} />
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={saveConfig}
                        className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
                        style={{ backgroundColor: '#CC3D2E', color: 'var(--pd-text)' }}
                        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 16px rgba(204,61,46,0.5)')}
                        onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                          <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                        </svg>
                        Save to YAML
                      </button>
                      <button onClick={() => { setEditing(null); setTab('agents'); }}
                        className="text-sm px-3 py-2" style={{ color: 'var(--pd-muted)' }}>Cancel</button>
                      {editing.saved && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: '#4ade80' }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          {editing.saved}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="py-24 text-center text-sm opacity-40" style={{ color: 'var(--pd-text)' }}>
                    Select an agent from the{' '}
                    <button onClick={() => setTab('agents')} style={{ color: '#CC3D2E' }}>Agents tab</button>
                    {' '}and click Config.
                  </div>
                )}
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}
