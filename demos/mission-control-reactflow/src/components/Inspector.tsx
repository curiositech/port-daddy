import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Bot, Braces, CheckCircle2, ChevronRight, CircleDollarSign, FileCode2, GitPullRequest, ListTree, ReceiptText, ShieldCheck, TestTube2, X } from 'lucide-react';
import { createMissionFixture } from '../lib/fixtures';
import { useMissionStore } from '../store';
import type { Evidence, MissionNodeData } from '../types';

interface InspectorProps {
  fixtureCount: number;
}

function DetailRow({ icon: Icon, label, children }: { icon: typeof Bot; label: string; children: React.ReactNode }) {
  return (
    <div className="detail-row">
      <Icon size={14} />
      <div><span>{label}</span><strong>{children}</strong></div>
    </div>
  );
}

export function Inspector({ fixtureCount }: InspectorProps) {
  const selectedNodeId = useMissionStore((state) => state.selectedNodeId);
  const selectNode = useMissionStore((state) => state.selectNode);
  const runtime = useMissionStore((state) => state.runtimeById[selectedNodeId]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const node = useMemo(() => createMissionFixture(fixtureCount).nodes.find((candidate) => candidate.id === selectedNodeId)?.data, [fixtureCount, selectedNodeId]);

  if (!node) return <aside className="inspector empty">Select a node to inspect it.</aside>;

  return (
    <aside className="inspector" aria-label="Node inspector" data-testid="node-inspector">
      <div className="inspector-heading">
        <div>
          <span>NODE INSPECTOR · {node.id}</span>
          <h2>{node.label}</h2>
        </div>
        <span className={`provenance provenance-${node.provenance}`}>{node.provenance}</span>
        <button className="icon-button inspector-close" onClick={() => selectNode('')} aria-label="Close inspector"><X size={15} /></button>
      </div>
      <div className="inspector-status">
        <span className={`status-label status-${runtime?.status}`}><i className="status-pulse" /> {runtime?.status}</span>
        <span>WAVE {node.wave + 1}</span>
        <span>{node.critical ? 'CRITICAL PATH' : 'PARALLEL'}</span>
      </div>

      <section className="summary-card">
        <span>WHY THIS EXISTS</span>
        <p>{node.summary}</p>
      </section>

      <div className="inspector-scroll">
        <section className="inspector-section">
          <h3>Contract</h3>
          <DetailRow icon={Braces} label="Prompt">{node.prompt}</DetailRow>
          <DetailRow icon={ListTree} label="Skills">{node.skills.join(' · ')}</DetailRow>
          <DetailRow icon={ChevronRight} label="Dependencies">{node.dependencies.join(', ') || 'root objective'}</DetailRow>
        </section>

        <section className="inspector-section detail-grid">
          <DetailRow icon={Bot} label="Agent / session">{node.agent} · {node.session}</DetailRow>
          <DetailRow icon={TestTube2} label="Tests">{node.tests.join(' · ')}</DetailRow>
          <DetailRow icon={ReceiptText} label="Receipts">{node.receipts.join(', ') || 'none — unknown'}</DetailRow>
          <DetailRow icon={CircleDollarSign} label="Cost">${node.cost.toFixed(2)} fixture estimate</DetailRow>
          <DetailRow icon={GitPullRequest} label="PR / artifacts">{node.artifacts.length} inspectable artifacts</DetailRow>
        </section>

        <section className="inspector-section judgement">
          <div><CheckCircle2 size={14} /><span><b>Evaluation</b>{node.evaluation}</span></div>
          <div><AlertTriangle size={14} /><span><b>Conundrum</b>{node.conundrum}</span></div>
        </section>

        <section className="inspector-section">
          <div className="section-title"><h3>Evidence</h3><span>one more click</span></div>
          {node.evidence.map((item) => (
            <button className="evidence-row nodrag" key={item.id} onClick={() => setEvidence(item)} data-testid={`evidence-${item.id}`}>
              {item.verified ? <ShieldCheck size={15} /> : <FileCode2 size={15} />}
              <span><strong>{item.label}</strong><small>{item.kind} · {item.provenance}</small></span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </section>
      </div>

      {evidence && (
        <div className="evidence-popover" role="dialog" aria-label="Evidence artifact" data-testid="evidence-dialog">
          <button className="icon-button" onClick={() => setEvidence(null)} aria-label="Close evidence"><X size={15} /></button>
          <span className={`provenance provenance-${evidence.provenance}`}>{evidence.provenance}</span>
          <h3>{evidence.label}</h3>
          <p>{evidence.detail}</p>
          <code>{evidence.locator}</code>
          <div className={evidence.verified ? 'verified' : 'unverified'}>{evidence.verified ? 'Independently verifiable fixture contract' : 'Unknown is never painted green'}</div>
        </div>
      )}
    </aside>
  );
}
