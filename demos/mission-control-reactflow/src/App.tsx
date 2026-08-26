import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Ban, Boxes, CircleStop, Command, Gauge, Moon, Play, Radio, RotateCcw, Route, ShieldAlert, Sun, Zap } from 'lucide-react';
import { GraphCanvas } from './components/GraphCanvas';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { createMissionEvents, createMissionFixture } from './lib/fixtures';
import { BoundedEventBuffer, chunkFrame, encodeSSE, MAX_PENDING_EVENTS, SSEFrameParser } from './lib/stream';
import { useMissionStore } from './store';

const fixtureOptions = [18, 50, 100, 200];

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [fixtureCount, setFixtureCount] = useState(18);
  const [playing, setPlaying] = useState(true);
  const [decision, setDecision] = useState<'open' | 'resolved'>('open');
  const eventIndex = useRef(0);
  const parser = useRef(new SSEFrameParser());
  const replay = useRef(new BoundedEventBuffer());
  const events = useMemo(() => createMissionEvents(createMissionFixture(fixtureCount).nodes, 64), [fixtureCount]);
  const applyEvent = useMissionStore((state) => state.applyEvent);
  const setEvents = useMissionStore((state) => state.setEvents);
  const setPlayhead = useMissionStore((state) => state.setPlayhead);
  const setTransport = useMissionStore((state) => state.setTransport);
  const setTerminal = useMissionStore((state) => state.setTerminal);
  const setReplayDropped = useMissionStore((state) => state.setReplayDropped);
  const setPendingFrames = useMissionStore((state) => state.setPendingFrames);
  const reprioritize = useMissionStore((state) => state.reprioritize);
  const selectNode = useMissionStore((state) => state.selectNode);
  const selectedNodeId = useMissionStore((state) => state.selectedNodeId);
  const layoutMetrics = useMissionStore((state) => state.layoutMetrics);
  const graphRenderCount = useMissionStore((state) => state.graphRenderCount);
  const terminalState = useMissionStore((state) => state.terminalState);
  const pendingFrames = useMissionStore((state) => state.pendingFrames);
  const replayDropped = useMissionStore((state) => state.replayDropped);

  useEffect(() => {
    replay.current = new BoundedEventBuffer();
    parser.current.reset();
    eventIndex.current = 0;
    setEvents(events);
  }, [events, setEvents]);

  useEffect(() => {
    if (!playing || terminalState) return undefined;
    const timer = window.setInterval(() => {
      const event = events[eventIndex.current % events.length];
      eventIndex.current += 1;
      const chunks = chunkFrame(encodeSSE(event), event.sequence);
      setPendingFrames(Math.min(MAX_PENDING_EVENTS, chunks.length));
      for (const chunk of chunks) {
        for (const parsed of parser.current.push(chunk)) {
          if (replay.current.append(parsed)) applyEvent(parsed);
          setPlayhead(events.findIndex((candidate) => candidate.sequence === parsed.sequence));
        }
      }
      setReplayDropped(replay.current.dropped);
      setPendingFrames(0);
    }, 1050);
    return () => window.clearInterval(timer);
  }, [applyEvent, events, playing, setPendingFrames, setPlayhead, setReplayDropped, terminalState]);

  const reconnect = () => {
    setTransport('reconnecting');
    setPlaying(false);
    window.setTimeout(() => {
      const lastSequence = Number(replay.current.latestCursor().split(':')[1] ?? 0);
      const missed = events.filter((event) => event.sequence > lastSequence).slice(0, 8);
      missed.forEach((event) => { if (replay.current.append(event)) applyEvent(event); });
      setTransport('connected');
      setPlaying(true);
    }, 650);
  };

  const launchOrResume = () => {
    setTerminal(null);
    setTransport('connected');
    setPlaying(true);
  };

  return (
    <main className="app" data-theme={theme}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Route size={19} /></div>
          <div><span>PORT DADDY / INTERACTION LAB</span><h1>Mission Control</h1></div>
        </div>
        <div className="mission-health">
          <span className="live-dot" />
          <div><b>MISSION MC-042</b><small>SSE fixture · cursor-resumable</small></div>
        </div>
        <div className="top-actions">
          <button className="ghost-button" onClick={reprioritize}><Zap size={14} /> Reprioritize</button>
          <button className="ghost-button" onClick={reconnect}><RotateCcw size={14} /> Reconnect</button>
          <button className="primary-button" onClick={launchOrResume}><Play size={14} /> {terminalState ? 'Resume' : 'Launch'}</button>
          <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" data-testid="theme-toggle">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>

      <section className="objective-strip">
        <div className="objective-copy">
          <span><Command size={12} /> TODAY’S REQUEST</span>
          <p>Build a legible Mission Control where an operator can see the objective, inspect every decision, interrupt execution, and reach evidence without losing the graph.</p>
        </div>
        <div className="objective-metrics">
          <div><b>6</b><span>parallel waves</span></div>
          <div><b>4</b><span>provenance modes</span></div>
          <div><b>$3.82</b><span>fixture cost</span></div>
          <div><b>72%</b><span>evaluated</span></div>
        </div>
        <div className="decision-card">
          <span><ShieldAlert size={13} /> OPERATOR DECISION</span>
          <b>{decision === 'open' ? 'Unknown provenance on node-12' : 'Resolved: hold for receipt'}</b>
          <button onClick={() => setDecision(decision === 'open' ? 'resolved' : 'open')}>{decision === 'open' ? 'Resolve decision' : 'Reopen'}</button>
        </div>
      </section>

      <section className={`workspace ${selectedNodeId ? 'inspector-open' : 'inspector-closed'}`}>
        <nav className="rail" aria-label="Mission views">
          <button className="active" aria-label="Objective graph"><Boxes size={17} /></button>
          <button aria-label="Live activity"><Activity size={17} /></button>
          <button aria-label="Transport"><Radio size={17} /></button>
          <button aria-label="Performance"><Gauge size={17} /></button>
          <div className="rail-rule" />
          <button onClick={() => { setPlaying(false); setTransport('paused'); }} aria-label="Interrupt"><CircleStop size={17} /></button>
          <button onClick={() => { setPlaying(false); setTerminal('cancelled'); }} className="danger" aria-label="Cancel mission"><Ban size={17} /></button>
        </nav>

        <div className="canvas-column">
          <div className="canvas-toolbar">
            <div className="fixture-switcher" aria-label="Deterministic fixture size">
              {fixtureOptions.map((count) => {
                const mode = count === 18 ? 'hero' : count === 50 ? 'scale' : count === 100 ? 'stress' : 'limit';
                return (
                  <button
                    key={count}
                    className={fixtureCount === count ? 'active' : ''}
                    onClick={() => { selectNode(''); setFixtureCount(count); }}
                    aria-label={`Load ${count} node ${mode} fixture`}
                  >
                    <b>{count === 18 ? 'LAB' : count}</b><small>{mode}</small>
                  </button>
                );
              })}
            </div>
            <div className="perf-readout" data-testid="performance-readout">
              <span>LAYOUT <b>{layoutMetrics?.durationMs ?? '—'}ms</b></span>
              <span>SERIALIZE <b>{layoutMetrics ? `${(layoutMetrics.serializedBytes / 1024).toFixed(1)}KB` : '—'}</b></span>
              <span>GRAPH MOUNTS <b>{graphRenderCount}</b></span>
            </div>
            <div className="stream-readout">
              <span>BUFFER {pendingFrames}/{MAX_PENDING_EVENTS}</span>
              <span>DROPPED {replayDropped}</span>
              <span className={playing ? 'streaming' : ''}>{playing ? 'STREAMING' : terminalState?.toUpperCase() ?? 'PAUSED'}</span>
            </div>
          </div>
          <GraphCanvas fixtureCount={fixtureCount} inspectorOpen={Boolean(selectedNodeId)} />
        </div>

        {selectedNodeId && <Inspector fixtureCount={fixtureCount} />}
      </section>

      <Timeline playing={playing} onToggle={() => { setPlaying(!playing); setTransport(playing ? 'paused' : 'connected'); }} onReconnect={reconnect} />
      <div className="scope-banner">FIXTURE LAB · NOT LIVE AUTHORITY · selected {selectedNodeId} · WebSocket intentionally omitted: server→operator updates are one-way</div>
    </main>
  );
}
