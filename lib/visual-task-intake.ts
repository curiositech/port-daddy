import type { BlobStat, BlobStore } from './blob.js';
import type { Dispatch, DispatchQueue } from './dispatch/queue.js';
import type { DispatchWorker } from './dispatch/worker.js';
import type { WorkIntentService } from './agent-harbor/work-intent-service.js';

export type VisualTaskKind = 'fix' | 'bug' | 'nit' | 'feedback' | 'question';
export type VisualTaskSource = 'chrome-extension' | 'fleet-ui' | 'api';
export type VisualTaskAssigneeKind = 'local-agent' | 'cloud-fleet' | 'review-queue';

export interface VisualTaskRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: 'image' | 'viewport';
}

export interface VisualTaskImageInput {
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  dataUrl?: string | null;
  blobId?: string | null;
  blobUrl?: string | null;
}

export interface VisualTaskDomElement {
  selector: string;
  xpath?: string | null;
  tagName?: string | null;
  role?: string | null;
  text?: string | null;
  bounds?: VisualTaskRegion | null;
  source?: {
    fileName?: string | null;
    lineNumber?: number | null;
    columnNumber?: number | null;
    componentName?: string | null;
  } | null;
}

export interface VisualTaskDomContext {
  url?: string | null;
  title?: string | null;
  capturedAt?: string | null;
  selectors?: string[];
  elementsInRegion?: VisualTaskDomElement[];
}

export interface VisualTaskSubmission {
  schemaVersion?: number;
  type?: 'visual-task';
  id?: string;
  source?: VisualTaskSource;
  project?: string | null;
  projectDir?: string | null;
  targetAgent?: string | null;
  kind?: VisualTaskKind;
  title?: string;
  description?: string;
  pageUrl?: string | null;
  captureMode?: string | null;
  image?: VisualTaskImageInput | null;
  region?: VisualTaskRegion | null;
  domContext?: VisualTaskDomContext | null;
  viewport?: {
    width?: number | null;
    height?: number | null;
    devicePixelRatio?: number | null;
  } | null;
  routing?: {
    assignee?: VisualTaskAssigneeKind;
    targetAgent?: string | null;
    openIssue?: boolean;
    startAgent?: boolean;
  } | null;
  createdAt?: string;
}

export interface VisualTaskIssue {
  id: string;
  kind: 'port-daddy-work-item' | 'visual-feedback-only';
  title: string;
  status: 'opened' | 'recorded';
  workItemId?: string;
  workItemSlug?: string;
}

export interface VisualTaskIntakeResult {
  success: true;
  task: VisualTaskSubmission;
  issue: VisualTaskIssue;
  channel?: {
    name: string;
    messageId?: number;
  };
  inbox?: {
    targetAgent: string;
    messageId?: number;
    delivered: boolean;
    woke: boolean;
    error?: string;
  };
  screenshot?: {
    blob: BlobStat;
    url: string;
  };
  workItem?: Dispatch;
  agentStart?: {
    requested: boolean;
    launchedThisTick?: number;
    error?: string;
  };
}

interface MessagingLike {
  ensureChannel?(name: string, opts: {
    aliases?: string[];
    description?: string | null;
    scope?: string | null;
    projectDir?: string | null;
    metadata?: Record<string, unknown> | null;
  }): { success?: boolean; channel?: { physicalName?: string; physical_name?: string }; error?: string };
  publish(channel: string, payload: unknown, opts: { sender?: string; expires?: unknown }): { success?: boolean; id?: number; error?: string };
}

interface AgentInboxLike {
  send(agentId: string, content: unknown, opts?: {
    from?: string;
    type?: string;
    contentType?: 'text' | 'json' | 'binary';
  }): { success?: boolean; messageId?: number; error?: string; code?: string };
}

interface FleetDaemonLike {
  hailAgent?(agentId: string, context?: {
    project?: string;
    source?: 'inbox' | 'manual' | 'trigger' | 'schedule';
    from?: string | null;
    message?: unknown;
    messageContent?: string;
  }): Promise<{ success: boolean; error?: string; project?: string; agent?: string }>;
}

export interface VisualTaskIntakeDeps {
  messaging?: MessagingLike;
  agentInbox?: AgentInboxLike;
  dispatchQueue?: DispatchQueue;
  dispatchWorker?: DispatchWorker;
  workIntentService?: WorkIntentService;
  blobs?: BlobStore;
  fleetDaemon?: FleetDaemonLike;
  now?: () => number;
}

const VISUAL_CHANNEL = 'visual-feedback';

/** Client sent something invalid — maps to HTTP 400. */
export class VisualTaskInputError extends Error {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
}

/**
 * The daemon is missing a dependency the request needs (e.g. no blob store
 * wired while the client submitted screenshot evidence). Maps to HTTP 503:
 * the request was fine, the deployment is not. Evidence loss must be
 * impossible, so this fails closed instead of silently dropping the image.
 */
export class VisualTaskDependencyError extends Error {
  readonly statusCode = 503;
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** A wired dependency failed at runtime (blob write, publish, dispatch) — HTTP 500. */
export class VisualTaskInternalError extends Error {
  readonly statusCode = 500;
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

function agentSteeringChannel(agentId: string): string {
  return `agent:${agentId}`;
}

function makeTaskId(now: number): string {
  return `visual-task-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeKind(value: unknown): VisualTaskKind {
  return value === 'bug' || value === 'nit' || value === 'feedback' || value === 'question'
    ? value
    : 'fix';
}

function shortTitle(value: string): string {
  const firstLine = value.trim().split(/\n+/)[0]?.trim() ?? '';
  if (!firstLine) return 'Visual task';
  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine;
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new VisualTaskInputError('image.dataUrl must be a data URL');
  const mimeType = match[1] || 'application/octet-stream';
  const raw = match[3] ?? '';
  let buffer: Buffer;
  try {
    buffer = match[2]
      ? Buffer.from(raw, 'base64')
      : Buffer.from(decodeURIComponent(raw), 'utf8');
  } catch {
    throw new VisualTaskInputError('image.dataUrl contains malformed URL encoding');
  }
  return { mimeType, buffer };
}

function sanitizeImage(image: VisualTaskImageInput | null | undefined): VisualTaskImageInput | null {
  if (!image) return null;
  const { dataUrl: _dataUrl, ...rest } = image;
  return rest;
}

function normalizeTask(input: VisualTaskSubmission, now: number): VisualTaskSubmission {
  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description.trim()
    : typeof input.title === 'string' && input.title.trim()
      ? input.title.trim()
      : '';
  const title = typeof input.title === 'string' && input.title.trim()
    ? shortTitle(input.title)
    : shortTitle(description);

  return {
    schemaVersion: 1,
    type: 'visual-task',
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : makeTaskId(now),
    source: input.source === 'fleet-ui' || input.source === 'api' ? input.source : 'chrome-extension',
    project: typeof input.project === 'string' ? input.project : null,
    projectDir: typeof input.projectDir === 'string' && input.projectDir.trim() ? input.projectDir.trim() : null,
    targetAgent: typeof input.targetAgent === 'string' && input.targetAgent.trim() ? input.targetAgent.trim() : null,
    kind: normalizeKind(input.kind),
    title,
    description,
    pageUrl: typeof input.pageUrl === 'string' && input.pageUrl.trim() ? input.pageUrl.trim() : input.domContext?.url ?? null,
    captureMode: typeof input.captureMode === 'string' && input.captureMode.trim() ? input.captureMode.trim() : 'browser-tab',
    image: input.image ?? null,
    region: input.region ?? null,
    domContext: input.domContext ?? null,
    viewport: input.viewport ?? null,
    routing: input.routing ?? null,
    createdAt: typeof input.createdAt === 'string' && input.createdAt.trim()
      ? input.createdAt
      : new Date(now).toISOString(),
  };
}

function validateTask(task: VisualTaskSubmission): void {
  const hasDescription = typeof task.description === 'string' && task.description.trim().length > 0;
  const hasImage = !!task.image?.dataUrl || !!task.image?.blobId || !!task.image?.blobUrl;
  const hasDom = Array.isArray(task.domContext?.elementsInRegion) && task.domContext.elementsInRegion.length > 0;
  if (!hasDescription && !hasImage && !hasDom) {
    throw new VisualTaskInputError('visual task requires a brief, screenshot, or DOM context');
  }
}

function summarizeTask(task: VisualTaskSubmission, channel: string, messageId?: number): string {
  return [
    `[visual-task:${task.kind}] ${task.title}`,
    task.description || task.title,
    `Issue payload: ${channel}${messageId ? ` #${messageId}` : ''}`,
    task.pageUrl ? `URL: ${task.pageUrl}` : null,
    task.region ? `Region: ${task.region.coordinateSpace} ${task.region.x},${task.region.y} ${task.region.width}x${task.region.height}` : null,
    task.domContext?.selectors?.length ? `DOM selectors: ${task.domContext.selectors.slice(0, 4).join(' | ')}` : null,
  ].filter(Boolean).join('\n');
}

function laneVisualTaskPayload(
  task: VisualTaskSubmission,
  issue: VisualTaskIssue,
  channel: string,
  messageId?: number,
) {
  return {
    kind: 'visual-task',
    taskId: task.id,
    title: task.title,
    description: task.description,
    source: task.source,
    taskKind: task.kind,
    pageUrl: task.pageUrl,
    createdAt: task.createdAt,
    region: task.region ?? null,
    viewport: task.viewport ?? null,
    domContext: task.domContext ?? null,
    image: task.image ?? null,
    issue,
    channel: {
      name: channel,
      ...(messageId ? { messageId } : {}),
    },
  };
}

function describeDomElement(element: VisualTaskDomElement): string {
  const parts = [
    element.selector || element.xpath || element.tagName || 'element',
    element.tagName ? `<${element.tagName}>` : null,
    element.role ? `role=${element.role}` : null,
    element.bounds ? `bounds=${element.bounds.x},${element.bounds.y} ${element.bounds.width}x${element.bounds.height}` : null,
    element.source?.fileName
      ? `source=${element.source.fileName}:${element.source.lineNumber ?? 1}:${element.source.columnNumber ?? 1}`
      : null,
    element.text ? `text="${element.text.replace(/\s+/g, ' ').slice(0, 96)}"` : null,
  ];
  return parts.filter(Boolean).join(' | ');
}

function workItemGoal(task: VisualTaskSubmission, channel: string, messageId?: number, screenshotUrl?: string): string {
  const sourceElements = task.domContext?.elementsInRegion
    ?.map((element) => element.source)
    .filter((source): source is NonNullable<VisualTaskDomElement['source']> => !!source?.fileName)
    .slice(0, 6)
    .map((source) => `${source.fileName}:${source.lineNumber ?? 1}:${source.columnNumber ?? 1}`);
  const domDecomposition = task.domContext?.elementsInRegion
    ?.slice(0, 8)
    .map((element) => `- ${describeDomElement(element)}`);

  return [
    `Visual issue from ${task.source}: ${task.kind} - ${task.title}`,
    '',
    task.description || task.title,
    '',
    `Project: ${task.projectDir ?? task.project ?? 'unknown'}`,
    `Payload channel: ${channel}${messageId ? ` message #${messageId}` : ''}`,
    `Task id: ${task.id}`,
    task.pageUrl ? `Page: ${task.pageUrl}` : null,
    screenshotUrl ? `Screenshot: ${screenshotUrl}` : null,
    task.region ? `Selected region: ${task.region.coordinateSpace} ${task.region.x},${task.region.y} ${task.region.width}x${task.region.height}` : null,
    task.domContext?.selectors?.length ? `DOM selectors: ${task.domContext.selectors.slice(0, 6).join(' | ')}` : null,
    domDecomposition?.length ? `DOM decomposition:\n${domDecomposition.join('\n')}` : null,
    sourceElements?.length ? `Likely source: ${sourceElements.join(' | ')}` : null,
    '',
    'Use the visual payload for reproduction context. If this is a project web app, inspect the DOM/source hints and add or update a focused regression test.',
  ].filter(Boolean).join('\n');
}

export function createVisualTaskIntake(deps: VisualTaskIntakeDeps) {
  const now = deps.now ?? Date.now;

  async function submit(input: VisualTaskSubmission): Promise<VisualTaskIntakeResult> {
    const task = normalizeTask(input, now());
    validateTask(task);
    const shouldOpenIssue = task.routing?.openIssue !== false;
    if (shouldOpenIssue && deps.dispatchQueue && !deps.workIntentService) {
      throw new VisualTaskDependencyError(
        'WorkIntent dispatch intake is unavailable; refusing visual-task work item side effect',
        'WORK_INTENT_UNAVAILABLE',
      );
    }

    let screenshot: VisualTaskIntakeResult['screenshot'];
    if (task.image?.dataUrl && !deps.blobs) {
      throw new VisualTaskDependencyError(
        'visual task screenshot storage unavailable: this daemon has no blob store wired, so the submitted screenshot cannot be persisted. Configure deps.blobs (default filesystem store lives at ~/.port-daddy/blobs) and retry — evidence is never dropped silently.',
        'BLOB_STORE_UNCONFIGURED',
      );
    }

    if (task.image?.dataUrl && deps.blobs) {
      const parsed = parseDataUrl(task.image.dataUrl);
      let blob: BlobStat;
      try {
        blob = deps.blobs.put(parsed.buffer, { contentType: task.image.mimeType || parsed.mimeType });
      } catch (err) {
        throw new VisualTaskInternalError(
          `could not persist screenshot evidence: ${err instanceof Error ? err.message : String(err)}`,
          'BLOB_WRITE_FAILED',
        );
      }
      screenshot = { blob, url: `/blob/${blob.id}` };
      task.image = {
        ...sanitizeImage(task.image),
        mimeType: task.image.mimeType || parsed.mimeType,
        size: task.image.size ?? blob.size,
        blobId: blob.id,
        blobUrl: screenshot.url,
      };
    } else {
      task.image = sanitizeImage(task.image);
    }

    const assignee = task.routing?.assignee ?? (task.targetAgent ? 'local-agent' : 'review-queue');
    const targetAgent = task.routing?.targetAgent || task.targetAgent || null;
    task.targetAgent = targetAgent;

    let channelName = VISUAL_CHANNEL;
    let channelMessageId: number | undefined;
    if (deps.messaging) {
      const ensured = deps.messaging.ensureChannel?.(VISUAL_CHANNEL, {
        aliases: ['viewport-feedback', 'browser-visual-feedback'],
        description: 'Visual issue intake payloads from FleetBar and browser capture surfaces.',
        scope: task.projectDir ? 'repo' : 'global',
        projectDir: task.projectDir ?? null,
        metadata: { type: 'visual-task' },
      });
      channelName = ensured?.channel?.physicalName || ensured?.channel?.physical_name || VISUAL_CHANNEL;
      const published = deps.messaging.publish(channelName, task, {
        sender: `${task.source ?? 'visual-task'}-visual`,
        expires: null,
      });
      if (published.success === false) {
        throw new VisualTaskInternalError(
          published.error || 'could not publish visual task',
          'MESSAGING_PUBLISH_FAILED',
        );
      }
      channelMessageId = typeof published.id === 'number' ? published.id : undefined;
    }

    let inbox: VisualTaskIntakeResult['inbox'];
    if (targetAgent && deps.agentInbox) {
      const sent = deps.agentInbox.send(targetAgent, task, {
        from: `${task.source ?? 'visual-task'}-visual`,
        type: 'visual-task',
        contentType: 'json',
      });
      if (sent.success === false) {
        inbox = {
          targetAgent,
          delivered: false,
          woke: false,
          error: sent.error || 'inbox delivery failed',
        };
      } else {
        let woke = false;
        let error: string | undefined;
        if (deps.fleetDaemon?.hailAgent) {
          const wake = await deps.fleetDaemon.hailAgent(targetAgent, {
            project: task.projectDir ?? task.project ?? undefined,
            source: 'inbox',
            from: `${task.source ?? 'visual-task'}-visual`,
            message: task,
            messageContent: summarizeTask(task, channelName, channelMessageId),
          });
          woke = wake.success;
          error = wake.success ? undefined : wake.error;
        }
        inbox = {
          targetAgent,
          messageId: sent.messageId,
          delivered: true,
          woke,
          ...(error ? { error } : {}),
        };
      }
    }

    let workItem: Dispatch | undefined;
    let agentStart: VisualTaskIntakeResult['agentStart'];
    if (shouldOpenIssue && deps.dispatchQueue) {
      const dispatchTarget = assignee === 'local-agent' ? targetAgent : assignee === 'cloud-fleet' ? 'cloud-fleet' : null;
      try {
        const captured = deps.workIntentService!.captureDispatch({
          goal: workItemGoal(task, channelName, channelMessageId, screenshot?.url),
          requestedBy: `${task.source ?? 'visual-task'}-visual`,
          mergePolicy: 'review',
          baseBranch: 'main',
          projectDir: task.projectDir ?? task.project ?? undefined,
          targetActorId: dispatchTarget ?? undefined,
          idempotencyKey: `visual-task:${task.id}:dispatch`,
        }, deps.dispatchQueue);
        workItem = captured.dispatch;
      } catch (err) {
        throw new VisualTaskInternalError(
          `could not open work item for visual task: ${err instanceof Error ? err.message : String(err)}`,
          'DISPATCH_QUEUE_FAILED',
        );
      }
      if (task.routing?.startAgent === true) {
        if (!deps.dispatchWorker) {
          agentStart = { requested: true, error: 'spawn unavailable: no daemon spawn runner is wired' };
        } else {
          try {
            agentStart = { requested: true, launchedThisTick: await deps.dispatchWorker.poll() };
          } catch (err) {
            agentStart = {
              requested: true,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }
    }

    const issue: VisualTaskIssue = workItem
      ? {
          id: workItem.id,
          kind: 'port-daddy-work-item',
          title: task.title ?? 'Visual task',
          status: 'opened',
          workItemId: workItem.id,
          workItemSlug: workItem.slug,
        }
      : {
          id: task.id ?? makeTaskId(now()),
          kind: 'visual-feedback-only',
          title: task.title ?? 'Visual task',
          status: 'recorded',
        };

    if (targetAgent && deps.messaging) {
      const lane = deps.messaging.publish(
        agentSteeringChannel(targetAgent),
        laneVisualTaskPayload(task, issue, channelName, channelMessageId),
        {
          sender: `${task.source ?? 'visual-task'}-visual`,
          expires: null,
        },
      );
      if (lane.success === false) {
        throw new VisualTaskInternalError(
          lane.error || 'could not publish visual task to target lane',
          'MESSAGING_PUBLISH_FAILED',
        );
      }
    }

    return {
      success: true,
      task,
      issue,
      ...(deps.messaging ? { channel: { name: channelName, messageId: channelMessageId } } : {}),
      ...(inbox ? { inbox } : {}),
      ...(screenshot ? { screenshot } : {}),
      ...(workItem ? { workItem } : {}),
      ...(agentStart ? { agentStart } : {}),
    };
  }

  return { submit };
}
