import { PauseCircle } from 'lucide-react';
import type { SalvageAgent } from '../types';

export function hasSalvageHold(agent: SalvageAgent | null | undefined): boolean {
  return agent?.status === 'dormant' || agent?.holdReason === 'durable_session_active';
}

export default function SalvageHoldNotice({ agent, id, sessionHref }: {
  agent: SalvageAgent;
  id: string;
  sessionHref?: string;
}) {
  if (!hasSalvageHold(agent)) return null;
  const alreadyAdmitted = agent.replacementAlreadyAdmitted === true || agent.status === 'resurrecting';
  return (
    <aside id={id} aria-label="Salvage on hold" className="mt-4 rounded-lg p-4 text-sm leading-relaxed"
      style={{ color: 'var(--pd-text)', backgroundColor: 'var(--pd-warning-surface)', border: '1px solid var(--pd-warning-border)' }}>
      <div className="flex items-start gap-2 font-semibold" style={{ color: 'var(--pd-warning)' }}>
        <PauseCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
        <h3>{alreadyAdmitted ? 'On hold · earlier replacement attempt admitted' : 'On hold · dormant salvage entry'}</h3>
      </div>
      <p className="mt-2">{agent.holdReason === 'durable_session_active'
        ? 'An active durable session still owns this work. Its notes and claims are preserved.'
        : 'The source reports a dormant entry without a hold reason. Destructive and replacement actions remain unavailable.'}</p>
      <p className="mt-2">{alreadyAdmitted
        ? 'This hold does not cancel the earlier admitted attempt or prove it is running. Execution needs its own current receipt.'
        : 'No replacement is being started from this view. A missed heartbeat does not transfer ownership.'}</p>
      <p className="mt-2">Hold clearance is not implemented. Dismiss, Run now, and Resume are unavailable for this entry. An explicit Stop run remains a separate action when a running attempt is reported.</p>
      {sessionHref && <a href={sessionHref} className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
        style={{ color: 'var(--pd-warning)' }}>Open exact session evidence</a>}
    </aside>
  );
}
