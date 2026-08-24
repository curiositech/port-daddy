import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Crosshair, ImagePlus, MousePointer2, RefreshCw, Send, Upload } from 'lucide-react';
import {
  ensureChannel,
  fetchAgentInbox,
  fetchAgentInboxStats,
  fetchOperatorActors,
  proposeDispatchGoal,
  publishMessage,
  runDispatchNow,
  sendAgentMessage,
} from '../api';
import type {
  InboxMessage,
  InboxStats,
  ResolvedChannelTarget,
  VisualTaskCaptureMode,
  VisualTaskDomContext,
  VisualTaskDomElement,
  VisualTaskImageAttachment,
  VisualTaskKind,
  VisualTaskRegion,
  VisualTaskSubmission,
} from '../types';
import { describeInboxAgentAvailability, resolveInboxAgentTargets, type InboxAgentTarget } from '../lib/inbox-targeting';

interface Props {
  channels: ResolvedChannelTarget[];
  project?: string | null;
  projectDir?: string | null;
  projectRunning?: boolean;
  configuredAgentCount?: number;
}

const KIND_OPTIONS: Array<{ value: VisualTaskKind; label: string }> = [
  { value: 'fix', label: 'Fix' },
  { value: 'bug', label: 'Bug' },
  { value: 'nit', label: 'Nit' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'question', label: 'Question' },
];

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const VISUAL_CHANNEL = 'visual-feedback';

function canUseDocument(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

function makeTaskId(): string {
  return `visual-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedRect(a: { x: number; y: number }, b: { x: number; y: number }, coordinateSpace: VisualTaskRegion['coordinateSpace']): VisualTaskRegion {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y)),
    coordinateSpace,
  };
}

function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/["\\]/g, '\\$&').replace(/\s+/g, '\\ ');
}

function selectorFor(element: Element): string {
  if (element.id) return `#${cssEscape(element.id)}`;

  const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
  if (testId) return `[data-testid="${cssEscape(testId)}"]`;

  const aria = element.getAttribute('aria-label');
  if (aria) return `${element.tagName.toLowerCase()}[aria-label="${cssEscape(aria)}"]`;

  const classNames = Array.from(element.classList)
    .filter((name) => !name.startsWith('animate-') && !name.startsWith('motion-'))
    .slice(0, 2);
  if (classNames.length > 0) {
    const candidate = `${element.tagName.toLowerCase()}.${classNames.map(cssEscape).join('.')}`;
    if (canUseDocument() && document.querySelectorAll(candidate).length === 1) return candidate;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((node) => node.tagName === current!.tagName)
      : [];
    const index = siblings.indexOf(current);
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index + 1})` : tag);
    current = current.parentElement;
  }
  return parts.join(' > ') || element.tagName.toLowerCase();
}

function xpathFor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(index > 1 ? `${tag}[${index}]` : tag);
    current = current.parentElement;
  }
  return `/${parts.join('/')}`;
}

function elementText(element: Element): string | null {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : null;
}

function elementToVisualDomElement(element: Element): VisualTaskDomElement {
  const bounds = element.getBoundingClientRect();
  return {
    selector: selectorFor(element),
    xpath: xpathFor(element),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    text: elementText(element),
    bounds: {
      x: Math.round(bounds.left),
      y: Math.round(bounds.top),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      coordinateSpace: 'viewport',
    },
  };
}

function sampleElements(region: VisualTaskRegion, overlay: HTMLElement | null): VisualTaskDomContext | null {
  if (!canUseDocument()) return null;

  const previousVisibility = overlay?.style.visibility;
  if (overlay) overlay.style.visibility = 'hidden';

  const points = [
    [0.2, 0.2], [0.5, 0.2], [0.8, 0.2],
    [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
    [0.2, 0.8], [0.5, 0.8], [0.8, 0.8],
  ];
  const seen = new Set<Element>();
  const elements: VisualTaskDomElement[] = [];

  for (const [xRatio, yRatio] of points) {
    const x = clamp(region.x + region.width * xRatio, 0, window.innerWidth - 1);
    const y = clamp(region.y + region.height * yRatio, 0, window.innerHeight - 1);
    for (const element of document.elementsFromPoint(x, y)) {
      if (seen.has(element)) continue;
      if (element === document.documentElement || element === document.body) continue;
      if (element.closest('[data-visual-task-panel="true"]')) continue;
      seen.add(element);
      elements.push(elementToVisualDomElement(element));
      if (elements.length >= 12) break;
    }
    if (elements.length >= 12) break;
  }

  if (overlay) overlay.style.visibility = previousVisibility ?? '';

  return {
    url: window.location.href,
    title: document.title || null,
    capturedAt: new Date().toISOString(),
    selectors: elements.map((element) => element.selector),
    elementsInRegion: elements,
  };
}

function readImage(file: File): Promise<VisualTaskImageAttachment> {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('Choose an image file.'));
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.reject(new Error('Image is over 4 MB. Use a tighter crop for now.'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const image = new Image();
      image.onload = () => {
        resolve({
          name: file.name || 'pasted-image.png',
          mimeType: file.type || 'image/png',
          size: file.size,
          dataUrl,
          width: image.naturalWidth || null,
          height: image.naturalHeight || null,
        });
      };
      image.onerror = () => reject(new Error('Could not decode image.'));
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function dispatchGoal(task: VisualTaskSubmission, channel: string, channelMessageId?: number): string {
  return [
    `Visual task from FleetBar: ${task.kind} - ${task.title}`,
    '',
    task.description,
    '',
    `Project: ${task.projectDir ?? task.project ?? 'unknown'}`,
    `Payload channel: ${channel}${channelMessageId ? ` message #${channelMessageId}` : ''}`,
    `Task id: ${task.id}`,
    task.pageUrl ? `Page: ${task.pageUrl}` : null,
    task.region ? `Selected region: ${task.region.coordinateSpace} ${task.region.x},${task.region.y} ${task.region.width}x${task.region.height}` : null,
    task.domContext?.selectors.length ? `DOM selectors: ${task.domContext.selectors.slice(0, 6).join(' | ')}` : null,
    '',
    'Use the visual payload for reproduction context. Add or update a focused test for the reported bug when possible.',
  ].filter(Boolean).join('\n');
}

function taskTitleFrom(description: string, fallback: string): string {
  const firstLine = description.trim().split(/\n+/)[0]?.trim();
  if (!firstLine) return fallback;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function inboxPreview(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return String(content ?? '');
  const candidate = content as Record<string, unknown>;
  if (candidate.type === 'visual-task' && typeof candidate.title === 'string') {
    return `[visual-task] ${candidate.title}`;
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function shortError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error:\s*/i, '').trim() || 'unknown error';
}

export default function VisualTaskPanel({
  channels,
  project,
  projectDir,
  projectRunning = false,
  configuredAgentCount = 0,
}: Props) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [actorTargets, setActorTargets] = useState<InboxAgentTarget[]>([]);
  const [targetAgent, setTargetAgent] = useState('');
  const [inboxCredential, setInboxCredential] = useState('');
  const [inboxStats, setInboxStats] = useState<InboxStats>({ total: 0, unread: 0 });
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [kind, setKind] = useState<VisualTaskKind>('fix');
  const [captureMode, setCaptureMode] = useState<VisualTaskCaptureMode>('image');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pageUrl, setPageUrl] = useState(canUseDocument() ? window.location.href : '');
  const [image, setImage] = useState<VisualTaskImageAttachment | null>(null);
  const [region, setRegion] = useState<VisualTaskRegion | null>(null);
  const [domContext, setDomContext] = useState<VisualTaskDomContext | null>(null);
  const [imageDragStart, setImageDragStart] = useState<{ x: number; y: number } | null>(null);
  const [pageSelecting, setPageSelecting] = useState(false);
  const [pageDragStart, setPageDragStart] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startDispatch, setStartDispatch] = useState(true);
  const [runDispatch, setRunDispatch] = useState(false);

  const visualTarget = channels.find((entry) => entry.logical === VISUAL_CHANNEL || entry.physical.endsWith(VISUAL_CHANNEL));
  const selectedTarget = actorTargets.find((target) => target.target === targetAgent) ?? null;
  const inboxAvailabilityNote = describeInboxAgentAvailability({
    actorCount: actorTargets.length,
    configuredAgentCount,
    projectRunning,
  });

  useEffect(() => {
    let cancelled = false;
    async function loadActors() {
      if (!projectDir && !project) {
        setActorTargets([]);
        return;
      }
      try {
        const actors = await fetchOperatorActors({
          project: project ?? undefined,
          projectDir: projectDir ?? undefined,
          limit: 80,
        });
        if (cancelled) return;
        const targets = resolveInboxAgentTargets(actors);
        setActorTargets(targets);
        setTargetAgent((current) => current && targets.some((target) => target.target === current)
          ? current
          : targets[0]?.target ?? '');
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    loadActors();
    return () => { cancelled = true; };
  }, [project, projectDir]);

  useEffect(() => {
    setInboxCredential('');
    setInboxStats({ total: 0, unread: 0 });
    setInboxMessages([]);
  }, [targetAgent]);

  useEffect(() => {
    let cancelled = false;
    async function loadInbox() {
      if (!targetAgent || !inboxCredential.trim()) {
        setInboxStats({ total: 0, unread: 0 });
        setInboxMessages([]);
        return;
      }
      try {
        const [stats, messages] = await Promise.all([
          fetchAgentInboxStats(targetAgent, inboxCredential),
          fetchAgentInbox(targetAgent, inboxCredential, { limit: 5 }),
        ]);
        if (!cancelled) {
          setInboxStats(stats);
          setInboxMessages(messages);
        }
      } catch {
        if (!cancelled) {
          setInboxStats({ total: 0, unread: 0 });
          setInboxMessages([]);
        }
      }
    }
    loadInbox();
    return () => { cancelled = true; };
  }, [inboxCredential, targetAgent]);

  const canSubmit = useMemo(() => {
    return !busy && (description.trim().length > 0 || !!image || !!domContext);
  }, [busy, description, domContext, image]);

  const handleFile = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const attachment = await readImage(file);
      setImage(attachment);
      setCaptureMode('image');
      setRegion(null);
      setDomContext(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      void handleFile(file);
    }
  };

  const imagePoint = (event: ReactPointerEvent): { x: number; y: number } | null => {
    const img = imageRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  };

  const handleImagePointerDown = (event: ReactPointerEvent) => {
    const point = imagePoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setImageDragStart(point);
    setRegion({ x: Math.round(point.x), y: Math.round(point.y), width: 0, height: 0, coordinateSpace: 'image' });
  };

  const handleImagePointerMove = (event: ReactPointerEvent) => {
    if (!imageDragStart) return;
    const point = imagePoint(event);
    if (!point) return;
    setRegion(normalizedRect(imageDragStart, point, 'image'));
  };

  const handleImagePointerUp = () => {
    setImageDragStart(null);
  };

  const handlePagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPageDragStart(start);
    setRegion({ x: start.x, y: start.y, width: 0, height: 0, coordinateSpace: 'viewport' });
  };

  const handlePagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pageDragStart) return;
    setRegion(normalizedRect(pageDragStart, { x: event.clientX, y: event.clientY }, 'viewport'));
  };

  const handlePagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pageDragStart) return;
    const nextRegion = normalizedRect(pageDragStart, { x: event.clientX, y: event.clientY }, 'viewport');
    setPageDragStart(null);
    setPageSelecting(false);
    if (nextRegion.width < 8 || nextRegion.height < 8) {
      setError('Region is too small.');
      return;
    }
    const context = sampleElements(nextRegion, overlayRef.current);
    setCaptureMode('current-page');
    setRegion(nextRegion);
    setDomContext(context);
    if (context) setPageUrl(context.url);
    setNotice(`Captured ${context?.elementsInRegion.length ?? 0} DOM element${context?.elementsInRegion.length === 1 ? '' : 's'} in the region.`);
  };

  const clearCapture = () => {
    setImage(null);
    setRegion(null);
    setDomContext(null);
    setNotice(null);
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const taskTitle = title.trim() || taskTitleFrom(description, 'Visual task');
    const task: VisualTaskSubmission = {
      schemaVersion: 1,
      type: 'visual-task',
      id: makeTaskId(),
      source: 'fleet-ui',
      project: project ?? null,
      projectDir: projectDir ?? null,
      targetAgent: targetAgent || null,
      kind,
      title: taskTitle,
      description: description.trim() || taskTitle,
      pageUrl: pageUrl.trim() || domContext?.url || null,
      captureMode,
      image,
      region,
      domContext,
      viewport: {
        width: canUseDocument() ? window.innerWidth : 0,
        height: canUseDocument() ? window.innerHeight : 0,
        devicePixelRatio: canUseDocument() ? window.devicePixelRatio : 1,
      },
      createdAt: new Date().toISOString(),
    };

    try {
      const ensured = await ensureChannel({
        name: VISUAL_CHANNEL,
        aliases: ['viewport-feedback'],
        description: 'Visual task intake payloads from FleetBar and browser capture surfaces.',
        scope: projectDir ? 'repo' : 'global',
        projectDir: projectDir ?? null,
        metadata: { type: 'visual-task' },
      });
      const channel = visualTarget?.physical ?? ensured.channel.physicalName;
      const published = await publishMessage(channel, task, 'fleet-ui-visual');
      const results: string[] = [`payload ${published.id ? `#${published.id}` : 'posted'} to ${channel}`];

      if (targetAgent) {
        const inbox = await sendAgentMessage(targetAgent, {
          content: task,
          contentType: 'json',
        });
        results.push(`delivered to ${selectedTarget?.label ?? targetAgent}${inbox.messageId ? ` as #${inbox.messageId}` : ''}`);
        if (inboxCredential.trim()) {
          const [stats, messages] = await Promise.all([
            fetchAgentInboxStats(targetAgent, inboxCredential),
            fetchAgentInbox(targetAgent, inboxCredential, { limit: 5 }),
          ]);
          setInboxStats(stats);
          setInboxMessages(messages);
        }
      }

      if (startDispatch) {
        try {
          const dispatch = await proposeDispatchGoal({
            goal: dispatchGoal(task, channel, published.id),
            requestedBy: 'fleet-ui-visual',
            mergePolicy: 'review',
            targetActorId: targetAgent || null,
          });
          results.push(`work item ${dispatch.slug ?? dispatch.id} opened`);
          if (runDispatch) {
            try {
              const run = await runDispatchNow(dispatch.id);
              results.push(run.message ?? 'agent start requested');
            } catch (err) {
              results.push(`agent start unavailable: ${shortError(err)}`);
            }
          }
        } catch (err) {
          results.push(`work item not opened: ${shortError(err)}`);
        }
      }

      setNotice(results.join(' · '));
      setDescription('');
      setTitle('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-visual-task-panel="true" className="h-full overflow-y-auto" onPaste={handlePaste}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="pd-kicker">Visual Task</div>
            <h1 className="mt-1 text-xl font-semibold" style={{ color: 'var(--pd-text)' }}>Send annotated context to an agent</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setImage(null);
                setCaptureMode('current-page');
                setPageSelecting(true);
              }}
              title="Captures DOM only from this Fleet Control Center page. Use Image for another app or browser page."
              className="pd-button"
              style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
            >
              <Crosshair size={16} />
              This page DOM
            </button>
            <label className="pd-button cursor-pointer" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', border: '1px solid var(--pd-success-border)' }}>
              <Upload size={16} />
              Image
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void handleFile(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </div>

        {(notice || error) && (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
            style={{
              backgroundColor: error ? 'var(--pd-accent-surface)' : 'var(--pd-success-surface)',
              color: error ? 'var(--pd-accent)' : 'var(--pd-success)',
              border: `1px solid ${error ? 'var(--pd-accent-border)' : 'var(--pd-success-border)'}`,
            }}
          >
            {error ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
            <span>{error ?? notice}</span>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
          <section className="pd-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--pd-border)' }}>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--pd-dim)' }}>Capture</div>
                <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                  {captureMode === 'image' ? 'Image annotation' : 'This page DOM region'}
                </div>
              </div>
              <button
                type="button"
                onClick={clearCapture}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
                style={{ color: 'var(--pd-muted)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
              >
                <RefreshCw size={13} />
                Clear
              </button>
            </div>

            <div className="p-4">
              {image ? (
                <div className="flex flex-col gap-3">
                  <div
                    className="inline-block max-w-full overflow-auto rounded-lg border p-2"
                    style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
                  >
                    <div
                      className="relative inline-block select-none"
                      onPointerDown={handleImagePointerDown}
                      onPointerMove={handleImagePointerMove}
                      onPointerUp={handleImagePointerUp}
                    >
                      <img ref={imageRef} src={image.dataUrl} alt={image.name} className="max-h-[62vh] max-w-full rounded-md object-contain" draggable={false} />
                      {region?.coordinateSpace === 'image' && (
                        <div
                          className="pointer-events-none absolute rounded-md"
                          style={{
                            left: region.x,
                            top: region.y,
                            width: Math.max(1, region.width),
                            height: Math.max(1, region.height),
                            border: '2px solid var(--pd-accent)',
                            backgroundColor: 'color-mix(in srgb, var(--pd-accent) 16%, transparent)',
                            boxShadow: '0 0 0 9999px rgba(0,0,0,0.28)',
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--pd-muted)' }}>
                    <span className="font-mono">{image.name}</span>
                    <span>{image.width ?? '?'} x {image.height ?? '?'}</span>
                    {region?.coordinateSpace === 'image' && <span>region {region.width} x {region.height}</span>}
                  </div>
                </div>
              ) : (
                <div
                  className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center"
                  style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)' }}
                >
                  <ImagePlus size={34} />
                  <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>Paste or upload a screenshot</div>
                  <div className="max-w-md text-sm">Desktop captures, app screenshots, and cropped browser shots can be marked up here before they go to the fleet.</div>
                </div>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="pd-card p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                <label>
                  <span className="pd-label">Target Agent</span>
                  <select
                    value={targetAgent}
                    onChange={(event) => setTargetAgent(event.target.value)}
                    className="pd-select font-mono"
                    disabled={actorTargets.length === 0}
                  >
                    {actorTargets.map((target) => (
                      <option key={target.target} value={target.target}>
                        {target.label} · {target.actorState}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="pd-label">Task Type</span>
                  <select value={kind} onChange={(event) => setKind(event.target.value as VisualTaskKind)} className="pd-select">
                    {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              {actorTargets.length === 0 && (
                <div className="mt-2 text-[12px]" style={{ color: 'var(--pd-warning)' }}>
                  {inboxAvailabilityNote}
                </div>
              )}
              {selectedTarget && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--pd-muted)' }}>
                  <Bot size={14} />
                  <span>{selectedTarget.actorState.replace(/_/g, ' ')} · {selectedTarget.actorStateReason}</span>
                  <span>{inboxCredential.trim() ? `${inboxStats.unread} unread / ${inboxStats.total} total` : 'inbox private'}</span>
                </div>
              )}
              {targetAgent && (
                <label className="mt-3 block">
                  <span className="pd-label">Actor credential for private readback</span>
                  <input
                    type="password"
                    value={inboxCredential}
                    onChange={(event) => setInboxCredential(event.target.value)}
                    autoComplete="off"
                    className="pd-input font-mono"
                    placeholder="Leave empty to deliver without reading"
                  />
                </label>
              )}
            </div>

            <div className="pd-card p-4">
              <label>
                <span className="pd-label">Title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="pd-input" placeholder="Short label for the task" />
              </label>
              <label className="mt-3 block">
                <span className="pd-label">Agent Brief</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="pd-textarea"
                  placeholder="What should the agent fix, verify, or investigate?"
                />
              </label>
              <label className="mt-3 block">
                <span className="pd-label">Page URL</span>
                <input value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} className="pd-input font-mono" placeholder="https://..." />
              </label>
            </div>

            <div className="pd-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="pd-label mb-0">DOM Context</div>
                  <div className="mt-1 text-[12px]" style={{ color: 'var(--pd-muted)' }}>
                    {domContext ? `${domContext.elementsInRegion.length} elements captured` : 'No DOM region captured'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setImage(null);
                    setCaptureMode('current-page');
                    setPageSelecting(true);
                  }}
                  title="Captures DOM only from this Fleet Control Center page. Use Image for another app or browser page."
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold"
                  style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}
                >
                  <MousePointer2 size={13} />
                  This page
                </button>
              </div>
              {domContext?.selectors.length ? (
                <div className="mt-3 flex flex-col gap-2">
                  {domContext.selectors.slice(0, 6).map((selector) => (
                    <div key={selector} className="rounded-md px-2 py-1.5 font-mono text-[11px]" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
                      {selector}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="pd-card p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)' }}>
                  <input type="checkbox" className="pd-checkbox" checked={startDispatch} onChange={(event) => setStartDispatch(event.target.checked)} />
                  <span>Open work item</span>
                </label>
                <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', opacity: startDispatch ? 1 : 0.55 }}>
                  <input type="checkbox" className="pd-checkbox" checked={runDispatch} disabled={!startDispatch} onChange={(event) => setRunDispatch(event.target.checked)} />
                  <span>Start agent now</span>
                </label>
              </div>
              <div className="mt-2 text-sm" style={{ color: 'var(--pd-muted)' }}>
                Work items wait in reviewable queue; starting an agent asks the daemon to pick one up now.
              </div>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submit()}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed"
                style={{
                  backgroundColor: canSubmit ? 'var(--pd-success-surface)' : 'var(--pd-bg)',
                  color: canSubmit ? 'var(--pd-success)' : 'var(--pd-muted)',
                  border: `1px solid ${canSubmit ? 'var(--pd-success-border)' : 'var(--pd-border)'}`,
                }}
              >
                <Send size={16} />
                {busy ? 'Sending' : 'Send to fleet'}
              </button>
            </div>

            {inboxMessages.length > 0 && (
              <div className="pd-card p-4">
                <div className="pd-label">Recent Target Inbox</div>
                <div className="mt-2 flex flex-col gap-2">
                  {inboxMessages.map((message) => (
                    <div key={message.id} className="rounded-md border px-3 py-2" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                        <span>{message.from ?? 'system'}</span>
                        <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      <div className="mt-1 text-[12px]" style={{ color: 'var(--pd-text)' }}>{inboxPreview(message.content)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {pageSelecting && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[9999] cursor-crosshair"
          style={{ backgroundColor: 'rgba(0,0,0,0.22)' }}
          onPointerDown={handlePagePointerDown}
          onPointerMove={handlePagePointerMove}
          onPointerUp={handlePagePointerUp}
        >
          {region?.coordinateSpace === 'viewport' && (
            <div
              className="pointer-events-none fixed rounded-md"
              style={{
                left: region.x,
                top: region.y,
                width: Math.max(1, region.width),
                height: Math.max(1, region.height),
                border: '2px solid var(--pd-success)',
                backgroundColor: 'color-mix(in srgb, var(--pd-success) 16%, transparent)',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.28)',
              }}
            />
          )}
          <div className="fixed left-1/2 top-4 -translate-x-1/2 rounded-full px-3 py-2 text-xs font-semibold" style={{ backgroundColor: 'var(--pd-surface)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }}>
            Drag a region, release to capture DOM
          </div>
        </div>
      )}
    </div>
  );
}
