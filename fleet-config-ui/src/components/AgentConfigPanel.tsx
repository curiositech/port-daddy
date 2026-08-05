import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { stringify, parse as parseYaml } from 'yaml';
import type { FleetAgent, BackendInfo, ActivityEntry, FleetEvent, StoryNote } from '../types';
import { agentColor } from '../types';
import { fetchModels, saveFleetConfig, fetchFleetConfig } from '../api';
import { activityTouchedFiles, isMeaningfulActivityEntry, isMeaningfulStory, summarizeActivityEntry } from '../activityFeed';
import { extractMentionedPaths } from '../fileMentions';
import FileActionLinks from './FileActionLinks';

type InspectorTab = 'details' | 'settings';

interface AgentTimelineItem {
  id: string;
  timestamp: number;
  kind: 'fleet' | 'activity' | 'story';
  title: string;
  body: string;
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function agentMatches(value: string | null | undefined, agentName: string): boolean {
  if (!value) return false;
  return value.toLowerCase().includes(agentName.toLowerCase());
}

function activityMatchesAgent(entry: ActivityEntry, agentName: string): boolean {
  const metadataAgentId = typeof entry.metadata?.agentId === 'string' ? entry.metadata.agentId : null;
  const metadataTargetId = typeof entry.metadata?.targetId === 'string' ? entry.metadata.targetId : null;
  return agentMatches(entry.agentId, agentName)
    || agentMatches(metadataAgentId, agentName)
    || agentMatches(entry.targetId, agentName)
    || agentMatches(metadataTargetId, agentName)
    || agentMatches(entry.details, agentName);
}

export function formToYamlObj(form: FleetAgent): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (form.schedule) obj.schedule = form.schedule;
  if (form.trigger) obj.trigger = form.trigger;
  obj.backend = form.backend;
  if (form.model) obj.model = form.model;
  if (form.prompt) obj.prompt = form.prompt;
  if (form.worktree) obj.worktree = true;
  if (form.singleton) obj.singleton = true;
  if (form.respawn) obj.respawn = true;
  if (form.maxRespawns !== undefined && form.maxRespawns !== 3) obj.max_respawns = form.maxRespawns;
  if (form.onSuccess) obj.on_success = form.onSuccess;
  if (form.onFailure) obj.on_failure = form.onFailure;
  if (form.identity) obj.identity = form.identity;
  if (form.deadlineMs !== undefined) obj.deadline_ms = form.deadlineMs;
  if (form.allowedTools) obj.allowedTools = form.allowedTools;
  return obj;
}

function isBackendReady(backend: BackendInfo): boolean {
  return backend.launchable ?? backend.readinessStatus === 'ready';
}

interface Props {
  agent: FleetAgent;
  project: string;
  defaultTab: InspectorTab;
  fleetEvents: FleetEvent[];
  activity: ActivityEntry[];
  stories: StoryNote[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function AgentConfigPanel({ agent, project, defaultTab, fleetEvents, activity, stories, open, onClose, onSaved }: Props) {
  const [form, setForm] = useState({ ...agent });
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yamlPreview, setYamlPreview] = useState('');
  const [activeTab, setActiveTab] = useState<InspectorTab>(defaultTab);

  useEffect(() => {
    fetchModels().then(setBackends).catch(() => {});
  }, []);

  useEffect(() => {
    setForm({ ...agent });
  }, [agent]);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab, agent.name]);

  // Update YAML preview when form changes
  useEffect(() => {
    setYamlPreview(stringify({ [form.name]: formToYamlObj(form) }));
  }, [form]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const backend = backends.find((candidate) => candidate.id === form.backend);
      if (!backend || !isBackendReady(backend)) {
        setError('Choose a ready backend before saving this agent.');
        return;
      }
      // Fetch current YAML, mutate this agent, save back
      const config = await fetchFleetConfig(project);
      const parsed = parseYaml(config.yaml);
      const fleet = parsed.fleet || parsed;
      if (!fleet.agents) fleet.agents = {};

      // Remove old name if renamed
      if (agent.name !== form.name && fleet.agents[agent.name]) {
        delete fleet.agents[agent.name];
      }

      fleet.agents[form.name] = formToYamlObj(form);
      const newYaml = stringify(parsed);
      const result = await saveFleetConfig(project, newYaml);

      if (!result.success) {
        setError('Save failed');
      } else {
        onSaved();
        onClose();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete agent "${agent.name}"? This modifies pd-fleet.yml.`)) return;
    setSaving(true);
    try {
      const config = await fetchFleetConfig(project);
      const parsed = parseYaml(config.yaml);
      const fleet = parsed.fleet || parsed;
      if (fleet.agents?.[agent.name]) {
        delete fleet.agents[agent.name];
      }
      const newYaml = stringify(parsed);
      await saveFleetConfig(project, newYaml);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const selectedBackend = backends.find(b => b.id === form.backend);
  const readyBackends = backends.filter(isBackendReady);
  const selectedBackendReady = selectedBackend ? isBackendReady(selectedBackend) : false;
  const color = agentColor(form.name);
  const timeline = useMemo<AgentTimelineItem[]>(() => {
    const agentFleetEvents: AgentTimelineItem[] = fleetEvents
      .filter((event) => event.agent === agent.name)
      .map((event, index) => ({
        id: `fleet-${event.timestamp}-${index}`,
        timestamp: event.timestamp,
        kind: 'fleet' as const,
        title: event.type.replace(/_/g, ' '),
        body: typeof event.details?.error === 'string'
          ? event.details.error
          : typeof event.details?.status === 'string'
            ? `status: ${event.details.status}`
            : event.project ?? 'fleet event',
      }));

    const agentActivity: AgentTimelineItem[] = activity
      .filter((entry) => isMeaningfulActivityEntry(entry))
      .filter((entry) => activityMatchesAgent(entry, agent.name))
      .map((entry) => ({
        id: `activity-${entry.id}`,
        timestamp: entry.timestamp,
        kind: 'activity' as const,
        title: entry.type,
        body: summarizeActivityEntry(entry),
      }));

    const agentStories: AgentTimelineItem[] = stories
      .filter(isMeaningfulStory)
      .filter((story) => story.agentId === agent.name
        || agentMatches(story.content, agent.name)
        || agentMatches(story.sessionPurpose, agent.name)
        || agentMatches(story.sessionId, agent.name))
      .map((story) => ({
        id: `story-${story.id}`,
        timestamp: story.createdAt,
        kind: 'story' as const,
        title: story.type,
        body: story.content.trim(),
      }));

    return [...agentFleetEvents, ...agentActivity, ...agentStories]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12);
  }, [activity, agent.name, fleetEvents, stories]);

  const touchedFiles = useMemo(
    () => [
      ...new Set([
        ...activity
          .filter((entry) => activityMatchesAgent(entry, agent.name))
          .flatMap((entry) => activityTouchedFiles(entry)),
        ...timeline.flatMap((item) => extractMentionedPaths(`${item.title} ${item.body}`)),
      ]),
    ].slice(0, 10),
    [activity, agent.name, timeline],
  );

  const inputStyle = {
    backgroundColor: 'var(--pd-bg)',
    color: 'var(--pd-text)',
    border: '1px solid var(--pd-border)',
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed top-0 right-0 h-full w-[420px] overflow-y-auto z-50"
          style={{ backgroundColor: 'var(--pd-surface)', borderLeft: '1px solid var(--pd-border)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--pd-border)' }}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="font-mono font-bold" style={{ color }}>{agent.name}</span>
            </div>
            <button onClick={onClose} className="opacity-40 hover:opacity-80"><X size={16} style={{ color: 'var(--pd-text)' }} /></button>
          </div>

          <div className="p-5 flex flex-col gap-4">
            {error && (
              <div className="text-[11px] px-3 py-2 rounded" style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
                {error}
              </div>
            )}

            <div className="flex gap-2 rounded-xl p-1" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
              {(['details', 'settings'] as InspectorTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
                  style={{
                    backgroundColor: activeTab === tab ? 'var(--pd-accent-surface)' : 'transparent',
                    color: activeTab === tab ? 'var(--pd-accent)' : 'var(--pd-muted)',
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'details' && (
              <div className="flex flex-col gap-4">
                <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
                  <div className="text-[10px] font-semibold tracking-wider opacity-50 mb-2" style={{ color: 'var(--pd-text)' }}>
                    AGENT SUMMARY
                  </div>
                  <div className="text-sm font-semibold" style={{ color }}>
                    {agent.name}
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                    {agent.prompt}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-[10px] px-2 py-1 rounded-md font-mono" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
                      {agent.backend}{agent.model ? ` · ${agent.model}` : ''}
                    </span>
                    {agent.schedule ? (
                      <span className="text-[10px] px-2 py-1 rounded-md font-mono" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}>
                        scheduled: {agent.schedule}
                      </span>
                    ) : agent.trigger ? (
                      <span className="text-[10px] px-2 py-1 rounded-md font-mono" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-warning)', border: '1px solid var(--pd-warning-border)' }}>
                        trigger: {agent.trigger}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
                  <div className="text-[10px] font-semibold tracking-wider opacity-50 mb-2" style={{ color: 'var(--pd-text)' }}>
                    RECENT MUTATIONS
                  </div>
                  {touchedFiles.length === 0 ? (
                    <div className="text-[12px]" style={{ color: 'var(--pd-muted)' }}>
                      No concrete file mutations surfaced yet.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {touchedFiles.map((filePath) => (
                        <FileActionLinks
                          key={filePath}
                          filePath={filePath}
                          projectDir={project}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                    <div className="text-[10px] font-semibold tracking-wider opacity-50" style={{ color: 'var(--pd-text)' }}>
                      WHAT THIS AGENT HAS BEEN DOING
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--pd-muted)' }}>
                      {timeline.length} items
                    </div>
                  </div>
                  <div className="max-h-[45vh] overflow-y-auto">
                    {timeline.length === 0 ? (
                      <div className="px-4 py-8 text-[12px]" style={{ color: 'var(--pd-muted)' }}>
                        No non-empty activity or notes for this agent yet.
                      </div>
                    ) : (
                      timeline.map((item) => (
                        <div key={item.id} className="px-4 py-3" style={{ borderBottom: '1px solid var(--pd-border)' }}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: item.kind === 'story' ? 'var(--pd-accent)' : 'var(--pd-text)' }}>
                              {item.kind} · {item.title}
                            </div>
                            <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                              {relativeTime(item.timestamp)}
                            </div>
                          </div>
                          <div className="mt-2 text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--pd-muted)' }}>
                            {item.body}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>

            {/* Name */}
            <Field label="Name">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded px-2 py-1.5 text-sm font-mono" style={inputStyle} />
            </Field>

            {/* Backend + Model */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Backend">
                <select value={form.backend} onChange={e => setForm(f => ({ ...f, backend: e.target.value, model: undefined }))}
                  className="w-full rounded px-2 py-1.5 text-sm" style={inputStyle}>
                  {readyBackends.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  {selectedBackend && !selectedBackendReady && <option value={form.backend} disabled>{selectedBackend.name} (not ready)</option>}
                  {!selectedBackend && form.backend && <option value={form.backend} disabled>{form.backend} (not ready)</option>}
                </select>
              </Field>
              <Field label="Model">
                <select value={form.model || ''} onChange={e => setForm(f => ({ ...f, model: e.target.value || undefined }))}
                  className="w-full rounded px-2 py-1.5 text-sm" style={inputStyle}>
                  <option value="">default</option>
                  {selectedBackend?.models.map(m => <option key={m} value={m}>{m}</option>)}
                  {form.model && !selectedBackend?.models.includes(form.model) && <option value={form.model}>{form.model}</option>}
                </select>
              </Field>
            </div>
            {selectedBackend && selectedBackend.readinessStatus !== 'ready' && (
              <div
                className="text-[10px] px-3 py-2 rounded"
                style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
              >
                <div className="font-semibold uppercase tracking-wider opacity-60 mb-1">
                  {selectedBackend.readinessStatus === 'needs_setup' ? 'Needs Setup' : 'Manual Check'}
                </div>
                <div className="opacity-80">{selectedBackend.readinessSummary}</div>
                {selectedBackend.readinessNextStep && (
                  <div className="opacity-60 mt-1">Next: {selectedBackend.readinessNextStep}</div>
                )}
              </div>
            )}

            {/* Trigger type */}
            <Field label="Trigger">
              <div className="flex gap-3 mb-2">
                <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--pd-text)' }}>
                  <input type="radio" checked={!!form.schedule} onChange={() => setForm(f => ({ ...f, schedule: f.schedule || '*/10 * * * *', trigger: undefined }))} />
                  Schedule
                </label>
                <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--pd-text)' }}>
                  <input type="radio" checked={!!form.trigger} onChange={() => setForm(f => ({ ...f, trigger: f.trigger || 'git:committed', schedule: undefined }))} />
                  Event
                </label>
              </div>
              {form.schedule
                ? <input value={form.schedule} onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))}
                    placeholder="*/10 * * * *" className="w-full rounded px-2 py-1.5 text-sm font-mono" style={inputStyle} />
                : <input value={form.trigger || ''} onChange={e => setForm(f => ({ ...f, trigger: e.target.value }))}
                    placeholder="channel:name" className="w-full rounded px-2 py-1.5 text-sm font-mono" style={inputStyle} />
              }
            </Field>

            {/* Prompt */}
            <Field label="Prompt">
              <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                rows={8} className="w-full rounded px-2 py-1.5 text-xs font-mono leading-relaxed resize-y" style={inputStyle} />
            </Field>

            {/* Allowed tools */}
            <Field label="Allowed Tools">
              <input value={form.allowedTools || ''} onChange={e => setForm(f => ({ ...f, allowedTools: e.target.value || undefined }))}
                placeholder="Read,Grep,Glob,Bash(npm test*)" className="w-full rounded px-2 py-1.5 text-sm font-mono" style={inputStyle} />
            </Field>

            {/* Channels */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="On Success">
                <input value={form.onSuccess || ''} onChange={e => setForm(f => ({ ...f, onSuccess: e.target.value || undefined }))}
                  placeholder="publish qa:clean" className="w-full rounded px-2 py-1.5 text-xs font-mono" style={inputStyle} />
              </Field>
              <Field label="On Failure">
                <input value={form.onFailure || ''} onChange={e => setForm(f => ({ ...f, onFailure: e.target.value || undefined }))}
                  placeholder="publish qa:findings" className="w-full rounded px-2 py-1.5 text-xs font-mono" style={inputStyle} />
              </Field>
            </div>

            {/* Options */}
            <Field label="Options">
              <div className="flex flex-wrap gap-4">
                <Toggle label="Worktree" checked={!!form.worktree} onChange={v => setForm(f => ({ ...f, worktree: v }))} />
                <Toggle label="Singleton" checked={!!form.singleton} onChange={v => setForm(f => ({ ...f, singleton: v }))} />
                <Toggle label="Respawn" checked={!!form.respawn} onChange={v => setForm(f => ({ ...f, respawn: v }))} />
              </div>
              {form.respawn && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] opacity-60" style={{ color: 'var(--pd-text)' }}>Max respawns:</span>
                  <input type="number" value={form.maxRespawns ?? 3} onChange={e => setForm(f => ({ ...f, maxRespawns: parseInt(e.target.value) || 3 }))}
                    className="w-16 rounded px-2 py-0.5 text-xs font-mono" style={inputStyle} />
                </div>
              )}
            </Field>

            {/* Optional caller-owned task deadline. Admission and liveness are separate. */}
            <Field label="Task deadline (minutes, optional)">
              <input
                type="number"
                min="1"
                value={form.deadlineMs ? Math.ceil(form.deadlineMs / 60_000) : ''}
                onChange={e => {
                  const minutes = Number.parseInt(e.target.value, 10);
                  setForm(f => ({ ...f, deadlineMs: Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : undefined }));
                }}
                placeholder="no deadline"
                className="w-32 rounded px-2 py-1.5 text-sm font-mono"
                style={inputStyle}
              />
              <div className="mt-1 text-[10px]" style={{ color: 'var(--pd-dim)' }}>
                Blank means no task wall deadline. Admission, heartbeats, cancellation, and collection remain independent.
              </div>
            </Field>

            {/* YAML Preview */}
            <Field label="YAML Preview">
              <pre className="text-[10px] font-mono leading-relaxed p-3 rounded overflow-x-auto"
                style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)', whiteSpace: 'pre-wrap' }}>
                {yamlPreview}
              </pre>
            </Field>

            <div className="text-[10px] opacity-40 italic" style={{ color: 'var(--pd-text)' }}>
              Commit access is prompt-governed — no formal gate exists.
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--pd-border)' }}>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 rounded px-3 py-2 text-sm font-semibold transition-colors"
                style={{ backgroundColor: 'var(--pd-accent)', color: 'var(--pd-bg)', opacity: saving ? 0.5 : 1 }}>
                {saving ? 'Saving...' : 'Save & Reload'}
              </button>
              <button onClick={handleDelete}
                className="rounded px-3 py-2 text-sm transition-colors"
                style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
                Delete
              </button>
            </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-wider opacity-40 mb-1" style={{ color: 'var(--pd-text)' }}>{label.toUpperCase()}</div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: 'var(--pd-text)' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="pd-checkbox w-3 h-3" />
      {label}
    </label>
  );
}
