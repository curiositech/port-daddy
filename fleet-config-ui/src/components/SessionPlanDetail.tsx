import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Circle, ExternalLink, ListChecks, RefreshCw } from 'lucide-react';
import { fetchSessionDetail } from '../api';
import { latestSessionPlan, orderSessionNotes, safeEvidenceHref, sessionDetailHref, type SessionDetail } from '../sessionPlan';

const panelStyle = { backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' };
const buttonStyle = { color: 'var(--pd-text)', backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' };
const controlClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pd-accent)]';

/** Render minimal inline links as React text; never interpret HTML or media. */
function EvidenceText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const links = /(?<!!)\[([^\]\n]+)\]\(([^\s)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(links)) {
    const offset = match.index!;
    parts.push(text.slice(cursor, offset));
    const href = safeEvidenceHref(match[2]);
    parts.push(href
      ? <a key={offset} href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: 'var(--pd-accent)' }}>{match[1]}<ExternalLink aria-hidden="true" size={12} className="inline ml-1" /></a>
      : match[0]);
    cursor = offset + match[0].length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** Render the full note, with read-only checklist marks rather than fake inputs. */
export function SessionNoteContent({ content }: { content: string }) {
  return <div className="text-sm leading-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere]" style={{ color: 'var(--pd-text)' }}>
    {content.split('\n').map((line, index) => {
      const task = /^\s*[-*] \[([ xX])\] (.*)$/.exec(line);
      if (!task) return <div key={index} className="min-h-6"><EvidenceText text={line} /></div>;
      const done = task[1].toLowerCase() === 'x';
      return <div key={index} className="flex items-start gap-2 py-1">
        {done ? <Check aria-hidden="true" size={17} className="mt-1 shrink-0" style={{ color: 'var(--pd-success)' }} /> : <Circle aria-hidden="true" size={15} className="mt-1 shrink-0" style={{ color: 'var(--pd-muted)' }} />}
        <span className="sr-only">{done ? 'Complete: ' : 'Open: '}</span>
        <span><EvidenceText text={task[2]} /></span>
      </div>;
    })}
  </div>;
}

/** Extract only labelled public provenance, never arbitrary metadata/credentials. */
function sessionProvenance(detail: SessionDetail): Array<[string, string]> {
  const session = detail.session;
  const metadata = session.metadata ?? {};
  const worktree = metadata.worktree as Record<string, unknown> | undefined;
  const identity = metadata.identity as Record<string, unknown> | undefined;
  return [
    ['Session', session.id],
    ['Agent alias', session.agentId || 'Not recorded'],
    ['Verified actor', identity?.verified === true && typeof identity.actorId === 'string' ? identity.actorId : 'Not verified in this session'],
    ['Identity', typeof metadata.identityString === 'string' ? metadata.identityString : 'Not recorded'],
    ['Repository / worktree', typeof worktree?.root === 'string' ? worktree.root : 'Not recorded'],
    ['Worktree ID', session.worktreeId || 'Not recorded'],
    ['Roadmap', typeof metadata.roadmapLink === 'string' ? metadata.roadmapLink : 'Not present in session metadata'],
  ];
}

interface Props {
  sessionId: string;
  daemonKey: string;
  onBack: () => void;
}

/**
 * Read-only exact-session projection. Design: request generations and render
 * keys both prevent an old response from appearing under a new selector.
 * Retained notes are the source; this view creates no new planning authority.
 */
export default function SessionPlanDetail({ sessionId, daemonKey, onBack }: Props) {
  const key = JSON.stringify([daemonKey, sessionId]);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ key: string; detail: SessionDetail | null; error: string | null; fetchedAt: number } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(key);

  useEffect(() => {
    let current = true;
    setLoadingKey(key);
    void fetchSessionDetail(sessionId).then((detail) => {
      if (current) setState({ key, detail, error: null, fetchedAt: Date.now() });
    }).catch((error: unknown) => {
      if (current) setState({ key, detail: null, error: error instanceof Error ? error.message : 'Could not read this session.', fetchedAt: Date.now() });
    }).finally(() => {
      if (current) setLoadingKey(null);
    });
    return () => { current = false; };
  }, [key, sessionId, refresh]);

  const detail = state?.key === key ? state.detail : null;
  const error = state?.key === key ? state.error : null;
  const notes = orderSessionNotes(detail?.notes ?? []);
  const plan = latestSessionPlan(notes);
  const tasks = plan?.content.match(/^\s*[-*] \[[ xX]\] /gm) ?? [];
  const done = tasks.filter((task) => /\[[xX]\]/.test(task)).length;
  const loading = loadingKey === key;

  return <main className="h-full overflow-y-auto p-4 sm:p-6" aria-label="Exact session detail">
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className={controlClass} style={buttonStyle} onClick={onBack}><ArrowLeft aria-hidden="true" size={16} />All agents and sessions</button>
        <div className="flex flex-wrap gap-2">
          <a className={controlClass} style={buttonStyle} href={sessionDetailHref(sessionId, daemonKey)}>Exact session link<ExternalLink aria-hidden="true" size={14} /></a>
          <button className={controlClass} style={buttonStyle} disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw aria-hidden="true" size={15} />{loading ? 'Reading…' : 'Refresh'}</button>
        </div>
      </div>
      {!detail && !error && <p role="status" style={{ color: 'var(--pd-muted)' }}>Reading this exact session…</p>}
      {error && <section role="alert" className="rounded-xl p-5" style={panelStyle}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--pd-text)' }}>Session unavailable</h1>
        <p className="mt-2 text-sm break-words [overflow-wrap:anywhere]" style={{ color: 'var(--pd-muted)' }}>{sessionId || '(empty session ID)'}</p>
        <p className="mt-3 text-sm" style={{ color: 'var(--pd-text)' }}>{error}</p>
        <p className="mt-2 text-sm" style={{ color: 'var(--pd-muted)' }}>No other session was selected. Check the link and access to the selected daemon.</p>
      </section>}
      {detail && <>
        <header className="rounded-xl p-5" style={panelStyle}>
          <p className="text-sm tracking-wider uppercase" style={{ color: 'var(--pd-muted)' }}>Session record · read only</p>
          <h1 className="mt-2 text-2xl font-semibold break-words" style={{ color: 'var(--pd-text)' }}>{detail.session.purpose}</h1>
          <p className="mt-3 text-sm" style={{ color: 'var(--pd-muted)' }}>{detail.session.status} · phase {detail.session.phase} · {notes.length} retained notes</p>
          <p className="mt-2 text-sm break-words [overflow-wrap:anywhere]" style={{ color: 'var(--pd-muted)' }}>Source daemon: {daemonKey}</p>
          <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            {sessionProvenance(detail).map(([label, value]) => <div key={label} className="contents"><dt style={{ color: 'var(--pd-muted)' }}>{label}</dt><dd className="font-mono break-words [overflow-wrap:anywhere]" style={{ color: 'var(--pd-text)' }}>{value}</dd></div>)}
          </dl>
          <p className="mt-4 text-sm" style={{ color: 'var(--pd-muted)' }}>Read from this daemon at {new Date(state!.fetchedAt).toLocaleTimeString()}. This is session history, not a claim of remote roadmap synchronization.</p>
        </header>
        <section className="rounded-xl p-5" style={{ ...panelStyle, borderTop: '3px solid var(--pd-accent)' }} aria-labelledby="session-current-plan">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="session-current-plan" className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--pd-text)' }}><ListChecks aria-hidden="true" size={20} />Current plan</h2>
            {plan && <span className="text-sm" style={{ color: 'var(--pd-muted)' }}>{done} of {tasks.length} checklist items complete</span>}
          </div>
          {plan ? <>
            <p className="mt-2 mb-4 text-sm" style={{ color: 'var(--pd-muted)' }}>Latest plan · note #{plan.id} · {new Date(plan.createdAt).toLocaleString()}</p>
            <SessionNoteContent content={plan.content} />
          </> : <p className="mt-3 text-sm" style={{ color: 'var(--pd-muted)' }}>No typed plan has been recorded. This does not mean the work is complete.</p>}
        </section>
        <section className="rounded-xl p-5" style={panelStyle} aria-labelledby="session-history">
          <h2 id="session-history" className="text-lg font-semibold" style={{ color: 'var(--pd-text)' }}>Complete note history</h2>
          <p className="mt-2 mb-4 text-sm" style={{ color: 'var(--pd-muted)' }}>Newest first. Earlier plans, progress, and published evidence remain available. Expand any note to read it in full.</p>
          {!notes.length && <p className="text-sm" style={{ color: 'var(--pd-muted)' }}>No notes recorded.</p>}
          <div className="space-y-2">{notes.map((note) => <details key={note.id} id={`session-note-${note.id}`} className="rounded-lg p-3" style={{ ...panelStyle, backgroundColor: 'var(--pd-bg)' }}>
            <summary className="min-h-11 cursor-pointer text-sm rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pd-accent)]" style={{ color: 'var(--pd-text)' }}>
              <span className="font-semibold">{note.type === 'todo_list' ? 'Plan revision' : note.type.replaceAll('_', ' ')} · #{note.id}</span>
              <span className="block mt-1" style={{ color: 'var(--pd-muted)' }}>{new Date(note.createdAt).toLocaleString()}{note.id === plan?.id ? ' · current plan' : ''}</span>
            </summary>
            <div className="pt-3"><SessionNoteContent content={note.content} /></div>
          </details>)}</div>
        </section>
      </>}
    </div>
  </main>;
}
