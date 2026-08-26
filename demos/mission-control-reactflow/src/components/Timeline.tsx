import { Pause, Play, RotateCcw, Signal, StepForward } from 'lucide-react';
import { useMissionStore } from '../store';

export function Timeline({ playing, onToggle, onReconnect }: { playing: boolean; onToggle: () => void; onReconnect: () => void }) {
  const events = useMissionStore((state) => state.events);
  const playhead = useMissionStore((state) => state.playhead);
  const setPlayhead = useMissionStore((state) => state.setPlayhead);
  const transport = useMissionStore((state) => state.transport);
  const current = events[playhead];
  const visible = events.slice(Math.max(0, playhead - 4), Math.min(events.length, playhead + 5));

  return (
    <section className="timeline" aria-label="Mission event timeline">
      <div className="timeline-controls">
        <button className="icon-button" onClick={onToggle} aria-label={playing ? 'Pause stream' : 'Resume stream'}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button className="icon-button" onClick={() => setPlayhead(Math.min(events.length - 1, playhead + 1))} aria-label="Step event"><StepForward size={15} /></button>
        <button className="icon-button" onClick={onReconnect} aria-label="Simulate reconnect"><RotateCcw size={15} /></button>
        <span className={`transport transport-${transport}`}><Signal size={12} /> {transport}</span>
      </div>
      <div className="timeline-track">
        <div className="timeline-rule" />
        {visible.map((event) => {
          const active = event.sequence === current?.sequence;
          return (
            <button key={event.id} className={`event-tick ${active ? 'active' : ''}`} onClick={() => setPlayhead(events.indexOf(event))} aria-label={`Sequence ${event.sequence}, ${event.type}`}>
              <i />
              <span>{event.sequence}</span>
              <small>{event.type.replace('.', ' ')}</small>
            </button>
          );
        })}
      </div>
      <div className="event-readout">
        <span>CURSOR <b>{current?.cursor ?? 'seq:0'}</b></span>
        <span>IDEMPOTENCY <b>{current?.idempotencyKey ?? '—'}</b></span>
        <span>FRAME <b>{current?.provenance ?? '—'} / v{current?.version ?? 1}</b></span>
      </div>
    </section>
  );
}
