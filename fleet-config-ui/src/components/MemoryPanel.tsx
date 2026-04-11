import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileStack, Network, ScrollText } from 'lucide-react';
import {
  fetchEpisodes,
  fetchGraphEdges,
  fetchGraphStats,
  fetchMemoryStats,
  fetchTupleEntries,
  openFileInEditor,
  revealFileInFinder,
} from '../api';
import { extractMentionedPaths } from '../fileMentions';
import type { Episode, GraphEdge, GraphStats, MemoryStats, TupleEntry } from '../types';

function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'never';
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function likelyPaths(fields: string[], projectDir?: string): string[] {
  return [...new Set(fields.filter(Boolean).filter((value) => {
    if (value.startsWith('/')) return true;
    if (value.startsWith('./') || value.startsWith('../')) return true;
    if (projectDir && !value.includes('\n') && value.includes('/') && !value.includes('://')) return true;
    return false;
  }))];
}

function fileActionButtons(paths: string[], projectDir?: string) {
  if (paths.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {paths.slice(0, 4).map((path) => (
        <div key={path} className="flex items-center gap-1">
          <button
            onClick={() => void openFileInEditor(path, projectDir)}
            className="text-[10px] px-2 py-1 rounded border"
            style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-text)', backgroundColor: 'var(--pd-bg)' }}
          >
            EDITOR
          </button>
          <button
            onClick={() => void revealFileInFinder(path, projectDir)}
            className="text-[10px] px-2 py-1 rounded border"
            style={{ borderColor: 'var(--pd-border)', color: 'var(--pd-text)', backgroundColor: 'var(--pd-bg)' }}
          >
            FINDER
          </button>
        </div>
      ))}
    </div>
  );
}

export default function MemoryPanel({
  projectDir,
  projectName,
  harbor,
}: {
  projectDir?: string;
  projectName?: string | null;
  harbor?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tuples, setTuples] = useState<TupleEntry[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchTupleEntries({ harbor: harbor || undefined, query, limit: 50 }),
      fetchGraphEdges({ projectDir, query, limit: 120 }),
      fetchEpisodes({ projectDir, project: projectName || undefined, harbor: harbor || undefined, query, limit: 80 }),
      fetchGraphStats(projectDir),
      fetchMemoryStats(projectDir, projectName || undefined),
    ])
      .then(([tupleData, edgeData, episodeData, graphStatsData, memoryStatsData]) => {
        if (cancelled) return;
        setTuples(tupleData);
        setEdges(edgeData);
        setEpisodes(episodeData);
        setGraphStats(graphStatsData);
        setMemoryStats(memoryStatsData);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [harbor, projectDir, projectName, query]);

  const tuplePaths = useMemo(() => tuples.map((tuple) => {
    const extracted = extractMentionedPaths(JSON.stringify(tuple.fields), 6);
    return [tuple.id, likelyPaths(extracted, projectDir)] as const;
  }), [projectDir, tuples]);

  return (
    <div className="h-full overflow-y-auto p-5" style={{ color: 'var(--pd-text)' }}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold tracking-wider opacity-35">MEMORY</div>
            <div className="mt-1 text-xl font-semibold">Live tuples, durable graph edges, and episodic memory</div>
            <div className="mt-1 text-sm opacity-70">
              Blackboard coordination stays short-term. Graph edges capture durable structure. Episodes keep the meaningful story.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tuples, graph edges, and episodes"
              className="w-[320px] max-w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: 'var(--pd-surface)',
                border: '1px solid var(--pd-border)',
                color: 'var(--pd-text)',
              }}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider opacity-50"><FileStack size={14} /> TUPLES</div>
            <div className="mt-2 text-2xl font-semibold">{tuples.length}</div>
            <div className="mt-1 text-sm opacity-70">Visible short-term coordination tuples{harbor ? ` in ${harbor}` : ''}.</div>
          </div>
          <div className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider opacity-50"><Network size={14} /> GRAPH</div>
            <div className="mt-2 text-2xl font-semibold">{graphStats?.total ?? 0}</div>
            <div className="mt-1 text-sm opacity-70">
              {graphStats?.sources ?? 0} sources, {graphStats?.targets ?? 0} targets, {graphStats?.scopes ?? 0} scopes.
            </div>
          </div>
          <div className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider opacity-50"><ScrollText size={14} /> EPISODES</div>
            <div className="mt-2 text-2xl font-semibold">{memoryStats?.total ?? 0}</div>
            <div className="mt-1 text-sm opacity-70">
              {memoryStats?.episodeTypes ?? 0} episode types promoted from sessions and missions.
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl p-10 text-center opacity-60" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
            Loading semantic memory surfaces...
          </div>
        ) : error ? (
          <div className="rounded-2xl p-4 text-sm" style={{ border: '1px solid var(--pd-accent-border)', backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)' }}>
            {error}
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1.05fr_1.2fr_1.05fr]">
            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--pd-border)' }}>
                <div className="text-[10px] font-semibold tracking-wider opacity-35">TUPLE SPACE</div>
                <div className="mt-1 text-sm font-semibold">Short-term coordination tuples</div>
              </div>
              <div className="max-h-[720px] overflow-y-auto p-4 space-y-3">
                {tuples.length === 0 ? <div className="text-sm opacity-50">No tuples matched this scope yet.</div> : tuples.map((tuple) => {
                  const paths = tuplePaths.find(([id]) => id === tuple.id)?.[1] ?? [];
                  return (
                    <div key={tuple.id} className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="font-semibold">{tuple.harbor || 'unscoped tuple'}</div>
                        <div className="opacity-50">{relativeTime(tuple.createdAt)}</div>
                      </div>
                      <div className="mt-2 text-[11px] opacity-55">written by {tuple.writtenBy || 'unknown'}{tuple.expiresAt ? ` • expires ${relativeTime(tuple.expiresAt)}` : ''}</div>
                      <pre className="mt-3 whitespace-pre-wrap break-words text-[12px] leading-5" style={{ color: 'var(--pd-text)' }}>
                        {JSON.stringify(tuple.fields, null, 2)}
                      </pre>
                      {fileActionButtons(paths, projectDir)}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--pd-border)' }}>
                <div className="text-[10px] font-semibold tracking-wider opacity-35">GRAPH EDGES</div>
                <div className="mt-1 text-sm font-semibold">Durable semantic and causal structure</div>
              </div>
              <div className="max-h-[720px] overflow-y-auto p-4 space-y-3">
                {edges.length === 0 ? <div className="text-sm opacity-50">No durable edges have been written for this project yet.</div> : edges.map((edge) => {
                  const paths = likelyPaths(
                    extractMentionedPaths(`${edge.sourceId}\n${edge.targetId}\n${JSON.stringify(edge.metadata ?? {})}`, 8),
                    projectDir,
                  );
                  return (
                    <div key={edge.id} className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-semibold tracking-wider opacity-45">{edge.scope}</div>
                        <div className="text-xs opacity-50">{relativeTime(edge.updatedAt)}</div>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-sm flex-wrap">
                        <span className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>{edge.sourceType}</span>
                        <span className="font-mono text-xs break-all">{edge.sourceId}</span>
                        <ArrowRight size={14} className="opacity-35" />
                        <span className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: 'var(--pd-success-surface)', border: '1px solid var(--pd-success-border)', color: 'var(--pd-success)' }}>{edge.edgeType}</span>
                        <ArrowRight size={14} className="opacity-35" />
                        <span className="rounded-full px-2 py-1 text-[11px]" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>{edge.targetType}</span>
                        <span className="font-mono text-xs break-all">{edge.targetId}</span>
                      </div>
                      {edge.metadata ? (
                        <pre className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-5 opacity-80">
                          {JSON.stringify(edge.metadata, null, 2)}
                        </pre>
                      ) : null}
                      {fileActionButtons(paths, projectDir)}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--pd-border)' }}>
                <div className="text-[10px] font-semibold tracking-wider opacity-35">EPISODIC MEMORY</div>
                <div className="mt-1 text-sm font-semibold">Promoted notes, outcomes, and mission moments</div>
              </div>
              <div className="max-h-[720px] overflow-y-auto p-4 space-y-3">
                {episodes.length === 0 ? <div className="text-sm opacity-50">No episodes have been promoted for this project yet.</div> : episodes.map((episode) => {
                  const paths = likelyPaths(
                    extractMentionedPaths(`${episode.title}\n${episode.summary}\n${JSON.stringify(episode.metadata ?? {})}`, 8),
                    projectDir,
                  );
                  return (
                    <div key={episode.id} className="rounded-2xl p-4" style={{ border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{episode.title}</div>
                        <div className="text-xs opacity-50">{relativeTime(episode.updatedAt)}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-accent-surface)', border: '1px solid var(--pd-accent-border)', color: 'var(--pd-accent)' }}>{episode.episodeType}</span>
                        {episode.agentId ? <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>{episode.agentId}</span> : null}
                        {episode.harbor ? <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--pd-surface)', border: '1px solid var(--pd-border)' }}>{episode.harbor}</span> : null}
                      </div>
                      <div className="mt-3 text-sm whitespace-pre-wrap break-words">{episode.summary}</div>
                      <div className="mt-3 text-[11px] opacity-55">source: {episode.sourceType} / {episode.sourceId}</div>
                      {fileActionButtons(paths, projectDir)}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
