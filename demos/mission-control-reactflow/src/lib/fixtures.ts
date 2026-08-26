import type { Edge, Node } from '@xyflow/react';
import type { Evidence, MissionEvent, MissionNodeData, NodeKind, NodeStatus, Provenance } from '../types';

const labels = [
  'Parse today’s request', 'Map objective constraints', 'Research visual language', 'Decompose AST intent',
  'Score suggestibility', 'Select interaction skills', 'Shape transport contract', 'Plan evidence graph',
  'Launch interface shipwright', 'Run graph performance probe', 'Verify stream recovery', 'Inspect operator controls',
  'Resolve provenance conundrum', 'Execute visual regression', 'Collect signed receipts', 'Assemble PR artifacts',
  'Evaluate mission outcome', 'Terminal handoff',
];

const kinds: NodeKind[] = ['objective', 'prompt', 'skill', 'tool', 'agent', 'test', 'decision', 'artifact'];
const provenance: Provenance[] = ['live', 'recorded', 'fixture', 'unknown'];
const statuses: NodeStatus[] = ['success', 'success', 'running', 'queued', 'blocked', 'queued'];

function hash(value: number) {
  let x = value + 0x6d2b79f5;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

function evidenceFor(index: number, source: Provenance): Evidence[] {
  const verified = source === 'live' || source === 'recorded';
  return [
    {
      id: `ev-${index}-receipt`,
      label: verified ? 'Execution receipt' : 'Receipt unavailable',
      kind: 'receipt',
      provenance: source,
      detail: verified
        ? `Receipt rcpt_${String(index + 41).padStart(4, '0')} preserves admission, actor, and terminal linkage.`
        : 'No independently verifiable receipt accompanies this fixture projection.',
      locator: verified ? `receipt://mission-control/${index + 41}` : 'unknown://receipt',
      verified,
    },
    {
      id: `ev-${index}-trace`,
      label: 'Verbatim event slice',
      kind: 'trace',
      provenance: source,
      detail: `seq=${2100 + index} node=node-${index} event=tool.result payload_sha=sha256:${(index + 17).toString(16).padStart(8, '0')}`,
      locator: `trace://mission-control/seq/${2100 + index}`,
      verified,
    },
  ];
}

export function createMissionFixture(count = 18) {
  const waveCount = count <= 18 ? 6 : count <= 50 ? 9 : count <= 100 ? 13 : 18;
  const nodes: Node<MissionNodeData>[] = Array.from({ length: count }, (_, index) => {
    const wave = Math.min(waveCount - 1, Math.floor(index * waveCount / count));
    const source = index < 18 ? provenance[index % provenance.length] : provenance[Math.floor(hash(index) * provenance.length)];
    const critical = index === 0 || index === count - 1 || index % Math.max(3, Math.floor(count / waveCount)) === 0;
    const label = index < labels.length ? labels[index] : `${kinds[index % kinds.length]} shard ${String(index + 1).padStart(3, '0')}`;
    return {
      id: `node-${index}`,
      type: 'mission',
      position: { x: 0, y: 0 },
      data: {
        id: `node-${index}`,
        label,
        eyebrow: `${kinds[index % kinds.length]} · wave ${wave + 1}`,
        kind: kinds[index % kinds.length],
        provenance: source,
        wave,
        critical,
        summary: critical ? 'Critical-path contract with operator-visible stop conditions.' : 'Parallel-wave work packet with isolated inputs and bounded outputs.',
        prompt: index % 4 === 0 ? 'Preserve ground truth and expose the shortest path to intervention.' : 'Transform declared inputs without inheriting unrelated context.',
        skills: ['dag-runtime', index % 2 ? 'reactflow-expert' : 'legibility-for-agentic-systems'],
        dependencies: index === 0 ? [] : [`node-${Math.max(0, index - Math.max(1, Math.floor(hash(index) * 3 + 1)))}`],
        agent: index % 3 === 0 ? 'Shipwright · Codex' : index % 3 === 1 ? 'Verifier · local' : 'Arbiter · recorded',
        session: `mc-${String(407 + index).padStart(4, '0')}`,
        tests: [`contract:${index % 5}`, `visual:${index % 3}`],
        receipts: source === 'unknown' ? [] : [`rcpt_${String(index + 41).padStart(4, '0')}`],
        cost: Number((0.03 + hash(index) * 0.42).toFixed(2)),
        artifacts: [`artifact://${index}/result.json`, `artifact://${index}/trace.ndjson`],
        evaluation: critical ? 'Must preserve provenance and satisfy the terminal invariant.' : 'Passes when declared output is present and independently inspectable.',
        conundrum: source === 'unknown' ? 'The state is visible, but its source cannot be authenticated.' : 'A summary is useful, but only the underlying artifact can justify action.',
        evidence: evidenceFor(index, source),
        durationMs: 420 + Math.floor(hash(index + 3) * 6200),
      },
    };
  });

  const edges: Edge[] = [];
  for (let index = 1; index < count; index += 1) {
    const target = nodes[index];
    const previousWaveNodes = nodes.filter((node) => node.data.wave < target.data.wave);
    const source = previousWaveNodes.at(-1) ?? nodes[index - 1];
    edges.push({
      id: `edge-${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      type: 'smoothstep',
      animated: target.data.critical,
      className: target.data.critical ? 'critical-edge' : 'parallel-edge',
    });
    if (index > 4 && index % 7 === 0) {
      const branchSource = nodes[Math.max(0, index - 4)];
      edges.push({ id: `edge-${branchSource.id}-${target.id}-branch`, source: branchSource.id, target: target.id, type: 'smoothstep', className: 'parallel-edge' });
    }
  }
  return { nodes, edges, statuses };
}

export function createMissionEvents(nodes: Node<MissionNodeData>[], count = 48): MissionEvent[] {
  const types: MissionEvent['type'][] = ['thinking.delta', 'tool.start', 'tool.result', 'node.status', 'receipt'];
  return Array.from({ length: count }, (_, index) => {
    const node = nodes[index % nodes.length];
    const sequence = 2101 + index;
    const type = types[index % types.length];
    return {
      version: 1,
      id: `evt-${sequence}`,
      sequence,
      cursor: `seq:${sequence}`,
      idempotencyKey: `mission-demo:${sequence}`,
      nodeId: node.id,
      type,
      provenance: node.data.provenance,
      timestamp: new Date(Date.UTC(2026, 7, 26, 19, 44, index)).toISOString(),
      payload: type === 'node.status'
        ? { status: index % 3 === 0 ? 'success' : 'running', progress: (index * 13) % 100 }
        : { text: `${type} preserved as an SSE-shaped fixture event`, durationMs: 17 + index * 3 },
    };
  });
}
