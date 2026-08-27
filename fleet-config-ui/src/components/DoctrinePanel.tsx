/**
 * DoctrinePanel — the operator-facing projection of empirically earned
 * doctrine. It intentionally does not turn an advisory into a merge button:
 * the panel makes the evidence chain inspectable and records whether a
 * decision-maker retrieved, followed, adapted, rejected, and later verified
 * the advisory.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileText,
  FlaskConical,
  History,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import {
  admitDoctrineCandidate,
  contestDoctrine,
  fetchDoctrineCandidates,
  fetchDoctrineDetail,
  fetchDoctrineStatus,
  recordDoctrineApplication,
  recordDoctrineOutcome,
  retrieveDoctrineOrder,
} from '../api';
import type {
  DoctrineApplicationResponse,
  DoctrineCandidate,
  DoctrineDetail,
  DoctrineOutcomeVerdict,
  DoctrinePacket,
  DoctrineStatusSummary,
} from '../types';

const OPERATOR_ACTOR_ID = 'fleetbar-operator';

type AdmissionReadiness = {
  ready: boolean;
  label: string;
  detail: string;
};

/**
 * The admission gate stays local and legible. The server enforces the same
 * condition, but exposing it here prevents a deceptively actionable button
 * when the experiment has not met its factual-control obligation.
 */
export function admissionReadiness(detail: DoctrineDetail | null): AdmissionReadiness {
  if (!detail?.experiment) {
    return {
      ready: false,
      label: 'Experiment required',
      detail: 'A candidate needs a preregistered experiment before it can be admitted.',
    };
  }
  const hasMatchedControl = detail.experiment.runs.some(
    (run) => run.arm === 'control' && run.fidelity === 'matched',
  );
  const hasMatchedTreatment = detail.experiment.runs.some(
    (run) => run.arm === 'treatment' && run.fidelity === 'matched',
  );
  if (!hasMatchedControl || !hasMatchedTreatment) {
    const missing = [
      !hasMatchedControl ? 'matched factual control' : null,
      !hasMatchedTreatment ? 'matched treatment' : null,
    ].filter(Boolean).join(' and ');
    return {
      ready: false,
      label: 'Evidence incomplete',
      detail: `Admission remains disabled until ${missing} run${missing.includes(' and ') ? 's are' : ' is'} recorded.`,
    };
  }
  return {
    ready: true,
    label: 'Factual gate met',
    detail: 'Matched factual control and treatment runs are present. Admission remains advisory and provisional by default.',
  };
}

function humanizeStatus(status: DoctrineCandidate['status']): string {
  return status.replace(/(^|_)([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}

function statusPalette(status: DoctrineCandidate['status']): { surface: string; text: string; border: string } {
  switch (status) {
    case 'provisional':
      return { surface: 'var(--pd-warning-surface)', text: 'var(--pd-warning)', border: 'var(--pd-warning-border)' };
    case 'established':
      return { surface: 'var(--pd-success-surface)', text: 'var(--pd-success)', border: 'var(--pd-success-border)' };
    case 'contested':
    case 'deprecated':
      return { surface: 'var(--pd-accent-surface)', text: 'var(--pd-accent)', border: 'var(--pd-accent-border)' };
    default:
      return { surface: 'var(--pd-bg)', text: 'var(--pd-muted)', border: 'var(--pd-border)' };
  }
}

function relativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function uniqueCitations(...groups: Array<string[] | null | undefined>): string[] {
  return [...new Set(groups.flat().filter((citation): citation is string => typeof citation === 'string' && citation.trim().length > 0))];
}

function candidateCitations(candidate: DoctrineCandidate, detail: DoctrineDetail | null): string[] {
  return uniqueCitations(candidate.admissionCitations, detail?.experiment?.citations, candidate.citations);
}

function StatusBadge({ status }: { status: DoctrineCandidate['status'] }) {
  const palette = statusPalette(status);
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ backgroundColor: palette.surface, borderColor: palette.border, color: palette.text }}
    >
      {humanizeStatus(status)}
    </span>
  );
}

function Metric({ label, value, tone = 'muted' }: { label: string; value: string | number; tone?: 'muted' | 'warning' | 'healthy' | 'accent' }) {
  const colors = {
    muted: 'var(--pd-muted)',
    warning: 'var(--pd-warning)',
    healthy: 'var(--pd-success)',
    accent: 'var(--pd-accent)',
  } as const;
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-65" style={{ color: 'var(--pd-text)' }}>{label}</div>
      <div className="mt-0.5 text-lg font-semibold" style={{ color: colors[tone] }}>{value}</div>
    </div>
  );
}

interface DoctrinePanelProps {
  projectDir?: string;
  projectName?: string;
}

export default function DoctrinePanel({ projectDir, projectName }: DoctrinePanelProps) {
  const [status, setStatus] = useState<DoctrineStatusSummary | null>(null);
  const [candidates, setCandidates] = useState<DoctrineCandidate[]>([]);
  const [selectedDoctrineId, setSelectedDoctrineId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DoctrineDetail | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contestReason, setContestReason] = useState('');
  const [decisionId, setDecisionId] = useState('');
  const [decisionClass, setDecisionClass] = useState('');
  const [packet, setPacket] = useState<DoctrinePacket | null>(null);
  const [applicationDrafts, setApplicationDrafts] = useState<Record<string, {
    response: DoctrineApplicationResponse;
    decision: string;
    note: string;
  }>>({});
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, {
    verdict: DoctrineOutcomeVerdict;
    summary: string;
    verifiedBy: string;
  }>>({});

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.doctrineId === selectedDoctrineId) ?? null,
    [candidates, selectedDoctrineId],
  );

  const refresh = useCallback(async (preferredDoctrineId?: string | null) => {
    setIsRefreshing(true);
    setError(null);
    try {
      const [nextStatus, nextCandidates] = await Promise.all([
        fetchDoctrineStatus(),
        fetchDoctrineCandidates(projectDir ? { projectDir } : {}),
      ]);
      setStatus(nextStatus);
      setCandidates(nextCandidates);
      const desired = preferredDoctrineId
        ?? selectedDoctrineId
        ?? nextCandidates.find((candidate) => candidate.doctrineId)?.doctrineId
        ?? null;
      setSelectedDoctrineId(desired);
      if (desired && nextCandidates.some((candidate) => candidate.doctrineId === desired)) {
        setIsDetailLoading(true);
        try {
          setDetail(await fetchDoctrineDetail(desired));
        } finally {
          setIsDetailLoading(false);
        }
      } else {
        setDetail(null);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setIsRefreshing(false);
    }
  }, [projectDir, selectedDoctrineId]);

  const selectCandidate = useCallback(async (doctrineId: string | null) => {
    setSelectedDoctrineId(doctrineId);
    setDetail(null);
    setPacket(null);
    setNotice(null);
    setError(null);
    if (!doctrineId) return;
    setIsDetailLoading(true);
    try {
      const nextDetail = await fetchDoctrineDetail(doctrineId);
      setDetail(nextDetail);
      setDecisionClass((current) => current || nextDetail.doctrine.decisionClass);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (detail?.doctrine.decisionClass && !decisionClass) {
      setDecisionClass(detail.doctrine.decisionClass);
    }
  }, [decisionClass, detail?.doctrine.decisionClass]);

  const readiness = admissionReadiness(detail);
  const scopedProjectDir = selectedCandidate?.projectDir ?? projectDir ?? '';
  const selectedCitations = selectedCandidate ? candidateCitations(selectedCandidate, detail) : [];
  const canRecord = Boolean(scopedProjectDir && selectedCitations.length > 0);

  const handleAdmit = async () => {
    if (!selectedCandidate || !detail?.experiment || !readiness.ready) return;
    setBusy('admit');
    setError(null);
    try {
      const result = await admitDoctrineCandidate({
        candidateId: selectedCandidate.id,
        experimentId: detail.experiment.id,
        projectDir: selectedCandidate.projectDir,
        actorId: OPERATOR_ACTOR_ID,
        citations: selectedCitations,
        reviewerId: OPERATOR_ACTOR_ID,
        status: 'provisional',
      });
      setNotice(`Admitted as a provisional advisory: ${result.doctrineId}. It still cannot authorize a merge or another irreversible action.`);
      await refresh(result.doctrineId);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleContest = async () => {
    if (!selectedCandidate?.doctrineId || contestReason.trim().length < 3 || !canRecord) return;
    setBusy('contest');
    setError(null);
    try {
      await contestDoctrine({
        doctrineId: selectedCandidate.doctrineId,
        projectDir: scopedProjectDir,
        actorId: OPERATOR_ACTOR_ID,
        citations: selectedCitations,
        reason: contestReason.trim(),
      });
      setContestReason('');
      setNotice('Contradiction recorded. The advisory is now visibly contested until evidence supports a revision.');
      await refresh(selectedCandidate.doctrineId);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRetrieve = async () => {
    const trimmedDecisionId = decisionId.trim();
    const trimmedClass = decisionClass.trim();
    if (!canRecord || !trimmedDecisionId || !trimmedClass) return;
    setBusy('retrieve');
    setError(null);
    try {
      const nextPacket = await retrieveDoctrineOrder({
        projectDir: scopedProjectDir,
        actorId: OPERATOR_ACTOR_ID,
        citations: selectedCitations,
        decisionId: trimmedDecisionId,
        decisionClass: trimmedClass,
      });
      setPacket(nextPacket);
      setNotice(
        nextPacket.doctrines.length > 0
          ? `Retrieval receipt ${nextPacket.receipt.id} recorded. The packet is advisory, not an approval.`
          : `Retrieval receipt ${nextPacket.receipt.id} recorded with no matching admitted doctrine.`,
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleApplication = async (doctrine: DoctrineCandidate) => {
    const draft = applicationDrafts[doctrine.doctrineId ?? doctrine.id] ?? { response: 'follow' as const, decision: '', note: '' };
    if (!packet || !doctrine.doctrineId || !draft.decision.trim()) return;
    setBusy(`application:${doctrine.doctrineId}`);
    setError(null);
    try {
      const application = await recordDoctrineApplication({
        retrievalId: packet.receipt.id,
        doctrineId: doctrine.doctrineId,
        projectDir: scopedProjectDir,
        actorId: OPERATOR_ACTOR_ID,
        citations: uniqueCitations(packet.receipt.citations, doctrine.admissionCitations, doctrine.citations),
        response: draft.response,
        decision: draft.decision.trim(),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      });
      setNotice(`Application receipt ${application.id} recorded. Verification is still pending.`);
      await refresh(doctrine.doctrineId);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleOutcome = async (applicationId: string) => {
    const draft = outcomeDrafts[applicationId] ?? { verdict: 'inconclusive' as const, summary: '', verifiedBy: OPERATOR_ACTOR_ID };
    if (!draft.summary.trim() || !draft.verifiedBy.trim() || !selectedCandidate?.doctrineId) return;
    setBusy(`outcome:${applicationId}`);
    setError(null);
    try {
      const outcome = await recordDoctrineOutcome({
        applicationId,
        projectDir: scopedProjectDir,
        actorId: OPERATOR_ACTOR_ID,
        citations: selectedCitations,
        verdict: draft.verdict,
        summary: draft.summary.trim(),
        verifiedBy: draft.verifiedBy.trim(),
      });
      setNotice(`Verified outcome ${outcome.id} recorded as ${outcome.verdict}.`);
      await refresh(selectedCandidate.doctrineId);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6" style={{ color: 'var(--pd-text)' }}>
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--pd-accent)' }}>
                <FileText size={16} /> EMPIRICALLY EARNED DOCTRINE
              </div>
              <h1 className="mt-2 text-2xl font-semibold">Advisory orders with a visible evidence wake</h1>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--pd-muted)' }}>
                A doctrine is not an agent personality or an automatic rule. It is a tested, revisable advisory tied to its episode, experimental controls, decision-time retrieval, agent response, and verified outcome.
                {projectName ? ` This view is scoped to ${projectName}.` : ''}
              </p>
            </div>
            <button
              onClick={() => void refresh()}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
            >
              <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Refreshing' : 'Refresh evidence'}
            </button>
          </div>
          <div className="mt-4 rounded-xl border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--pd-warning-surface)', borderColor: 'var(--pd-warning-border)', color: 'var(--pd-warning)' }}>
            Advisory only. An admitted doctrine can inform a decision; it cannot authorize a merge, spend, deployment, or other irreversible action.
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Metric label="Episodes" value={status?.counts.episodes ?? '—'} />
            <Metric label="Candidates" value={status?.counts.candidates ?? '—'} />
            <Metric label="Provisional" value={status?.counts.provisional ?? '—'} tone="warning" />
            <Metric label="Established" value={status?.counts.established ?? '—'} tone="healthy" />
            <Metric label="Contested" value={status?.counts.contested ?? '—'} tone={(status?.counts.contested ?? 0) > 0 ? 'accent' : 'muted'} />
          </div>
        </header>

        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--pd-accent-surface)', borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}>
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-3 rounded-xl border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--pd-success-surface)', borderColor: 'var(--pd-success-border)', color: 'var(--pd-success)' }}>
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.6fr)]">
          <section className="rounded-2xl border p-4" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Doctrine candidates</h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>Candidates remain hypotheses until a factual-control gate is met.</p>
              </div>
              <span className="text-sm font-mono opacity-60">{candidates.length}</span>
            </div>
            {candidates.length === 0 ? (
              <div className="rounded-xl border border-dashed p-5 text-sm" style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-muted)' }}>
                No doctrine evidence has been recorded for this scope. The empty state is intentional: this surface never invents lessons from silence.
              </div>
            ) : (
              <div className="space-y-2">
                {candidates.map((candidate) => {
                  const selected = candidate.doctrineId === selectedDoctrineId;
                  return (
                    <button
                      key={candidate.id}
                      onClick={() => void selectCandidate(candidate.doctrineId)}
                      className="w-full rounded-xl border p-3 text-left transition-colors"
                      style={{
                        backgroundColor: selected ? 'var(--pd-accent-surface)' : 'var(--pd-bg)',
                        borderColor: selected ? 'var(--pd-accent-border)' : 'var(--pd-border)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold leading-5">{candidate.title}</div>
                          <div className="mt-1 truncate text-xs font-mono" style={{ color: 'var(--pd-muted)' }}>{candidate.decisionClass}</div>
                        </div>
                        <StatusBadge status={candidate.status} />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--pd-muted)' }}>
                        <span>{relativeTime(candidate.occurredAt)}</span>
                        <ChevronRight size={15} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}>
            {!selectedCandidate ? (
              <div className="flex min-h-72 flex-col items-center justify-center text-center">
                <FileText size={32} style={{ color: 'var(--pd-muted)' }} />
                <h2 className="mt-3 text-lg font-semibold">Choose an evidence trail</h2>
                <p className="mt-1 max-w-md text-sm" style={{ color: 'var(--pd-muted)' }}>Select a candidate to inspect what was observed, what was preregistered, and whether it has earned advisory status.</p>
              </div>
            ) : isDetailLoading ? (
              <div className="flex min-h-72 items-center justify-center gap-2 text-sm" style={{ color: 'var(--pd-muted)' }}>
                <RefreshCw size={16} className="animate-spin" /> Loading evidence ledger…
              </div>
            ) : detail ? (
              <DoctrineDetailView
                candidate={selectedCandidate}
                detail={detail}
                readiness={readiness}
                contestReason={contestReason}
                onContestReasonChange={setContestReason}
                onAdmit={() => void handleAdmit()}
                onContest={() => void handleContest()}
                isBusy={busy}
                canRecord={canRecord}
                decisionId={decisionId}
                decisionClass={decisionClass}
                onDecisionIdChange={setDecisionId}
                onDecisionClassChange={setDecisionClass}
                onRetrieve={() => void handleRetrieve()}
                packet={packet}
                applicationDrafts={applicationDrafts}
                onApplicationDraftChange={(doctrineId, draft) => setApplicationDrafts((current) => ({ ...current, [doctrineId]: draft }))}
                onApplication={(doctrine) => void handleApplication(doctrine)}
                outcomeDrafts={outcomeDrafts}
                onOutcomeDraftChange={(applicationId, draft) => setOutcomeDrafts((current) => ({ ...current, [applicationId]: draft }))}
                onOutcome={(applicationId) => void handleOutcome(applicationId)}
              />
            ) : (
              <div className="min-h-72 text-sm" style={{ color: 'var(--pd-muted)' }}>The selected doctrine record could not be reconstructed from the ledger.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function DoctrineDetailView({
  candidate,
  detail,
  readiness,
  contestReason,
  onContestReasonChange,
  onAdmit,
  onContest,
  isBusy,
  canRecord,
  decisionId,
  decisionClass,
  onDecisionIdChange,
  onDecisionClassChange,
  onRetrieve,
  packet,
  applicationDrafts,
  onApplicationDraftChange,
  onApplication,
  outcomeDrafts,
  onOutcomeDraftChange,
  onOutcome,
}: {
  candidate: DoctrineCandidate;
  detail: DoctrineDetail;
  readiness: AdmissionReadiness;
  contestReason: string;
  onContestReasonChange: (value: string) => void;
  onAdmit: () => void;
  onContest: () => void;
  isBusy: string | null;
  canRecord: boolean;
  decisionId: string;
  decisionClass: string;
  onDecisionIdChange: (value: string) => void;
  onDecisionClassChange: (value: string) => void;
  onRetrieve: () => void;
  packet: DoctrinePacket | null;
  applicationDrafts: Record<string, { response: DoctrineApplicationResponse; decision: string; note: string }>;
  onApplicationDraftChange: (doctrineId: string, draft: { response: DoctrineApplicationResponse; decision: string; note: string }) => void;
  onApplication: (doctrine: DoctrineCandidate) => void;
  outcomeDrafts: Record<string, { verdict: DoctrineOutcomeVerdict; summary: string; verifiedBy: string }>;
  onOutcomeDraftChange: (applicationId: string, draft: { verdict: DoctrineOutcomeVerdict; summary: string; verifiedBy: string }) => void;
  onOutcome: (applicationId: string) => void;
}) {
  const citations = candidateCitations(candidate, detail);
  const canRetrieve = canRecord && decisionId.trim().length > 0 && decisionClass.trim().length > 0;
  const fidelityRuns = detail.experiment?.runs ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{candidate.title}</h2>
            <StatusBadge status={candidate.status} />
          </div>
          <p className="mt-1 text-sm font-mono" style={{ color: 'var(--pd-muted)' }}>{candidate.doctrineId ?? candidate.id}</p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs font-semibold" style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-muted)' }}>
          {candidate.school ?? 'No school assigned'}
        </span>
      </div>

      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
        <EvidenceField label="When" value={candidate.when} />
        <EvidenceField label="Prefer" value={candidate.prefer} />
        <EvidenceField label="Over" value={candidate.over} />
        <EvidenceField label="Because" value={candidate.because} />
        <EvidenceField label="Unless" value={candidate.unless.length ? candidate.unless.join(' · ') : 'No exception recorded'} />
        <EvidenceField label="Skills" value={candidate.skillRefs.length ? candidate.skillRefs.join(' · ') : 'No skill projection recorded'} />
      </div>

      <section className="rounded-xl border p-4" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
        <div className="flex items-start gap-3">
          <History size={18} className="mt-0.5" style={{ color: 'var(--pd-accent)' }} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Observed episode</h3>
            {detail.episode ? (
              <>
                <p className="mt-1 text-sm leading-6" style={{ color: 'var(--pd-muted)' }}>{detail.episode.summary}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--pd-muted)' }}>
                  <span>Historical action: {detail.episode.historicalAction}</span>
                  <span>•</span>
                  <span>Transcript fidelity: {detail.episode.fidelity}</span>
                  {detail.episode.provenance.model && <><span>•</span><span>Model: {detail.episode.provenance.model}</span></>}
                </div>
              </>
            ) : <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>Episode evidence is unavailable in this projection.</p>}
          </div>
        </div>
      </section>

      <section className="rounded-xl border p-4" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
        <div className="flex items-start gap-3">
          <FlaskConical size={18} className="mt-0.5" style={{ color: 'var(--pd-warning)' }} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Preregistered experiment and fidelity</h3>
              <span className="text-xs font-semibold" style={{ color: readiness.ready ? 'var(--pd-success)' : 'var(--pd-warning)' }}>{readiness.label}</span>
            </div>
            {detail.experiment ? (
              <>
                <p className="mt-1 text-sm leading-6" style={{ color: 'var(--pd-muted)' }}>{detail.experiment.hypothesis}</p>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <EvidenceField label="Primary outcome" value={detail.experiment.primaryOutcome} />
                  <EvidenceField label="Sham" value={detail.experiment.sham ?? 'No sham arm preregistered'} />
                  <EvidenceField label="Control" value={detail.experiment.control} />
                  <EvidenceField label="Treatment" value={detail.experiment.treatment} />
                </dl>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {(['control', 'treatment', 'sham'] as const).map((arm) => {
                    const run = fidelityRuns.find((item) => item.arm === arm);
                    return (
                      <div key={arm} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--pd-border)' }}>
                        <div className="font-semibold capitalize">{arm}</div>
                        <div className="mt-1" style={{ color: run?.fidelity === 'matched' ? 'var(--pd-success)' : 'var(--pd-warning)' }}>
                          {run ? `${run.fidelity} fidelity` : 'not recorded'}
                        </div>
                        {run && <div className="mt-1 text-xs" style={{ color: 'var(--pd-muted)' }}>{run.outcome}</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>No preregistered experiment is attached to this candidate.</p>}
            <p className="mt-3 text-xs leading-5" style={{ color: readiness.ready ? 'var(--pd-success)' : 'var(--pd-warning)' }}>{readiness.detail}</p>
          </div>
        </div>
      </section>

      {candidate.status === 'candidate' ? (
        <section className="rounded-xl border p-4" style={{ borderColor: readiness.ready ? 'var(--pd-success-border)' : 'var(--pd-warning-border)', backgroundColor: readiness.ready ? 'var(--pd-success-surface)' : 'var(--pd-warning-surface)' }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Provisional admission</h3>
              <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>Admission only publishes an advisory packet. It is not an operational authorization.</p>
            </div>
            <button
              onClick={onAdmit}
              disabled={!readiness.ready || !canRecord || isBusy === 'admit'}
              title={readiness.ready ? 'Admit as a provisional advisory' : readiness.detail}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: 'var(--pd-success)' }}
            >
              <CheckCircle2 size={16} />
              {isBusy === 'admit' ? 'Admitting…' : 'Admit provisionally'}
            </button>
          </div>
          {!readiness.ready && <p className="mt-3 text-xs" style={{ color: 'var(--pd-warning)' }}>Disabled: {readiness.detail}</p>}
        </section>
      ) : (
        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
          <div className="flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5" style={{ color: candidate.status === 'contested' ? 'var(--pd-accent)' : 'var(--pd-warning)' }} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">Challenge this advisory</h3>
              <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>A contradiction is a first-class observation, not a hidden deletion. Record why this doctrine should be contested.</p>
              {candidate.contestedReason && <p className="mt-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}>Current contest: {candidate.contestedReason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={contestReason}
                  onChange={(event) => onContestReasonChange(event.target.value)}
                  placeholder="Contradictory evidence or boundary condition"
                  className="min-w-[220px] flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)' }}
                />
                <button
                  onClick={onContest}
                  disabled={!canRecord || contestReason.trim().length < 3 || isBusy === 'contest'}
                  className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}
                >
                  {isBusy === 'contest' ? 'Recording…' : 'Record contradiction'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {(candidate.status === 'provisional' || candidate.status === 'established') && (
        <section className="rounded-xl border p-4" style={{ borderColor: 'var(--pd-accent-border)', backgroundColor: 'var(--pd-accent-surface)' }}>
          <div className="flex items-start gap-3">
            <Send size={18} className="mt-0.5" style={{ color: 'var(--pd-accent)' }} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">Decision-time advisory retrieval</h3>
              <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>Create a receipt only when a real decision is in view. The packet records what was actually shown, even if it contains no matching doctrine.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input value={decisionId} onChange={(event) => onDecisionIdChange(event.target.value)} placeholder="Decision identifier" className="rounded-lg border px-3 py-2 text-sm outline-none" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)' }} />
                <input value={decisionClass} onChange={(event) => onDecisionClassChange(event.target.value)} placeholder="Decision class" className="rounded-lg border px-3 py-2 text-sm outline-none" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)' }} />
              </div>
              <button onClick={onRetrieve} disabled={!canRetrieve || isBusy === 'retrieve'} className="mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style={{ backgroundColor: 'var(--pd-accent)' }}>
                <Send size={15} /> {isBusy === 'retrieve' ? 'Recording receipt…' : 'Retrieve advisory order'}
              </button>
            </div>
          </div>
        </section>
      )}

      {packet && (
        <RetrievalPacket
          packet={packet}
          applicationDrafts={applicationDrafts}
          onApplicationDraftChange={onApplicationDraftChange}
          onApplication={onApplication}
          outcomeDrafts={outcomeDrafts}
          onOutcomeDraftChange={onOutcomeDraftChange}
          onOutcome={onOutcome}
          isBusy={isBusy}
        />
      )}

      <HistoryTrail detail={detail} outcomeDrafts={outcomeDrafts} onOutcomeDraftChange={onOutcomeDraftChange} onOutcome={onOutcome} isBusy={isBusy} />

      <div className="rounded-xl border p-3 text-xs leading-5" style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-muted)' }}>
        {citations.length} immutable receipt{citations.length === 1 ? '' : 's'} attached. Canonical store: Agent Harbor’s append-only doctrine-evidence stream.
      </div>
    </div>
  );
}

function EvidenceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide opacity-60">{label}</dt>
      <dd className="mt-1 text-sm leading-5" style={{ color: 'var(--pd-text)' }}>{value}</dd>
    </div>
  );
}

function RetrievalPacket({
  packet,
  applicationDrafts,
  onApplicationDraftChange,
  onApplication,
  outcomeDrafts,
  onOutcomeDraftChange,
  onOutcome,
  isBusy,
}: {
  packet: DoctrinePacket;
  applicationDrafts: Record<string, { response: DoctrineApplicationResponse; decision: string; note: string }>;
  onApplicationDraftChange: (doctrineId: string, draft: { response: DoctrineApplicationResponse; decision: string; note: string }) => void;
  onApplication: (doctrine: DoctrineCandidate) => void;
  outcomeDrafts: Record<string, { verdict: DoctrineOutcomeVerdict; summary: string; verifiedBy: string }>;
  onOutcomeDraftChange: (applicationId: string, draft: { verdict: DoctrineOutcomeVerdict; summary: string; verifiedBy: string }) => void;
  onOutcome: (applicationId: string) => void;
  isBusy: string | null;
}) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: 'var(--pd-success-border)', backgroundColor: 'var(--pd-success-surface)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Retrieval receipt</h3>
          <p className="mt-1 text-xs font-mono" style={{ color: 'var(--pd-muted)' }}>{packet.receipt.id}</p>
        </div>
        <span className="text-xs font-semibold" style={{ color: 'var(--pd-success)' }}>{packet.retrievalPolicy}</span>
      </div>
      {packet.doctrines.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--pd-muted)' }}>No admitted doctrine matched this decision class. That absence is now part of the evidence trail.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {packet.doctrines.map((doctrine) => {
            const id = doctrine.doctrineId ?? doctrine.id;
            const draft = applicationDrafts[id] ?? { response: 'follow' as const, decision: '', note: '' };
            return (
              <div key={id} className="rounded-lg border p-3" style={{ borderColor: 'var(--pd-success-border)', backgroundColor: 'var(--pd-surface)' }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{doctrine.title}</div>
                  <StatusBadge status={doctrine.status} />
                </div>
                <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>{doctrine.when} Prefer {doctrine.prefer} over {doctrine.over}.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr]">
                  <select value={draft.response} onChange={(event) => onApplicationDraftChange(id, { ...draft, response: event.target.value as DoctrineApplicationResponse })} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)' }}>
                    <option value="follow">Follow</option>
                    <option value="adapt">Adapt</option>
                    <option value="reject">Reject</option>
                  </select>
                  <input value={draft.decision} onChange={(event) => onApplicationDraftChange(id, { ...draft, decision: event.target.value })} placeholder="Actual decision taken" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)' }} />
                </div>
                <input value={draft.note} onChange={(event) => onApplicationDraftChange(id, { ...draft, note: event.target.value })} placeholder="Optional boundary or adaptation note" className="mt-2 w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)' }} />
                <button onClick={() => onApplication(doctrine)} disabled={!draft.decision.trim() || isBusy === `application:${doctrine.doctrineId}`} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: 'var(--pd-success-border)', color: 'var(--pd-success)' }}>
                  {isBusy === `application:${doctrine.doctrineId}` ? 'Recording…' : 'Record agent response'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HistoryTrail({
  detail,
  outcomeDrafts,
  onOutcomeDraftChange,
  onOutcome,
  isBusy,
}: {
  detail: DoctrineDetail;
  outcomeDrafts: Record<string, { verdict: DoctrineOutcomeVerdict; summary: string; verifiedBy: string }>;
  onOutcomeDraftChange: (applicationId: string, draft: { verdict: DoctrineOutcomeVerdict; summary: string; verifiedBy: string }) => void;
  onOutcome: (applicationId: string) => void;
  isBusy: string | null;
}) {
  const outcomesByApplication = new Map(detail.outcomes.map((outcome) => [outcome.applicationId, outcome]));
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
      <div className="flex items-center gap-2">
        <History size={18} style={{ color: 'var(--pd-accent)' }} />
        <h3 className="text-sm font-semibold">Application and outcome history</h3>
      </div>
      {detail.retrievals.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--pd-muted)' }}>No decision-time retrieval receipt has been recorded for this advisory yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {detail.retrievals.map((retrieval) => (
            <div key={retrieval.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--pd-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">Retrieved for {retrieval.decisionId}</span>
                <span className="text-xs" style={{ color: 'var(--pd-muted)' }}>{relativeTime(retrieval.occurredAt)}</span>
              </div>
              <div className="mt-1 text-xs font-mono" style={{ color: 'var(--pd-muted)' }}>{retrieval.decisionClass}</div>
            </div>
          ))}
        </div>
      )}
      {detail.applications.length > 0 && <div className="mt-4 space-y-3">
        {detail.applications.map((application) => {
          const outcome = outcomesByApplication.get(application.id);
          const draft = outcomeDrafts[application.id] ?? { verdict: 'inconclusive' as const, summary: '', verifiedBy: OPERATOR_ACTOR_ID };
          return (
            <div key={application.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--pd-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Agent response: {application.response}</span>
                <span className="text-xs" style={{ color: 'var(--pd-muted)' }}>{relativeTime(application.occurredAt)}</span>
              </div>
              <p className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>{application.decision}</p>
              {application.note && <p className="mt-1 text-xs" style={{ color: 'var(--pd-muted)' }}>Note: {application.note}</p>}
              {outcome ? (
                <div className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: outcome.verdict === 'harmed' ? 'var(--pd-accent-border)' : 'var(--pd-success-border)', backgroundColor: outcome.verdict === 'harmed' ? 'var(--pd-accent-surface)' : 'var(--pd-success-surface)' }}>
                  <div className="font-semibold">Verified outcome: {outcome.verdict}</div>
                  <div className="mt-1" style={{ color: 'var(--pd-muted)' }}>{outcome.summary}</div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--pd-muted)' }}>Verified by {outcome.verifiedBy}</div>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--pd-warning-border)', backgroundColor: 'var(--pd-warning-surface)' }}>
                  <div className="text-sm font-semibold">Verification pending</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[150px_1fr]">
                    <select value={draft.verdict} onChange={(event) => onOutcomeDraftChange(application.id, { ...draft, verdict: event.target.value as DoctrineOutcomeVerdict })} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)' }}>
                      <option value="helped">Helped</option>
                      <option value="harmed">Harmed</option>
                      <option value="inconclusive">Inconclusive</option>
                    </select>
                    <input value={draft.verifiedBy} onChange={(event) => onOutcomeDraftChange(application.id, { ...draft, verifiedBy: event.target.value })} placeholder="Verified by" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)' }} />
                  </div>
                  <input value={draft.summary} onChange={(event) => onOutcomeDraftChange(application.id, { ...draft, summary: event.target.value })} placeholder="Observed result and evidence boundary" className="mt-2 w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)' }} />
                  <button onClick={() => onOutcome(application.id)} disabled={!draft.summary.trim() || !draft.verifiedBy.trim() || isBusy === `outcome:${application.id}`} className="mt-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: 'var(--pd-warning-border)', color: 'var(--pd-warning)' }}>
                    {isBusy === `outcome:${application.id}` ? 'Recording…' : 'Record verified outcome'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>}
    </section>
  );
}
