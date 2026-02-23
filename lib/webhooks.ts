/**
 * Webhooks Module
 *
 * Provides webhook subscriptions for Port Daddy events.
 * External systems can register webhooks to be notified when:
 * - Services are claimed/released
 * - Agents register/unregister
 * - Locks are acquired/released
 * - Messages are published to channels
 *
 * Features:
 * - HMAC-SHA256 signed payloads for verification
 * - Retry with exponential backoff
 * - Event filtering by type and pattern
 * - Delivery status tracking
 */

import { createHmac, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_WEBHOOKS = 100;
const MAX_QUEUE_SIZE = 10000;
const MAX_RETRY_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 10000;
const CLEANUP_RETENTION_DAYS = 7;
const RESPONSE_BODY_MAX_LENGTH = 1000;

const PRIVATE_IP_PATTERNS = [
  // IPv4 loopback & private ranges
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  // Shared address space (CGN) — RFC 6598
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
  // IPv6 loopback & private ranges
  /^::1$/,
  /^\[::1\]$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd[0-9a-f]{2}:/i,
  // IPv6 multicast — RFC 4291
  /^ff[0-9a-f]{2}:/i,
  // IPv4-mapped IPv6 loopback/private
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./i,
  /^::ffff:192\.168\./i,
  // Cloud metadata endpoints
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,
  // Local hostname patterns
  /\.local$/i,
  /\.localhost$/i,
  /\.internal$/i,
] as const;

export const WebhookEvent = {
  SERVICE_CLAIM: 'service.claim',
  SERVICE_RELEASE: 'service.release',
  AGENT_REGISTER: 'agent.register',
  AGENT_UNREGISTER: 'agent.unregister',
  AGENT_STALE: 'agent.stale',
  LOCK_ACQUIRE: 'lock.acquire',
  LOCK_RELEASE: 'lock.release',
  MESSAGE_PUBLISH: 'message.publish',
  DAEMON_START: 'daemon.start',
  DAEMON_STOP: 'daemon.stop'
} as const;

interface WebhookRow {
  id: string;
  url: string;
  secret: string | null;
  events: string;
  filter_pattern: string | null;
  active: number;
  created_at: number;
  last_triggered: number | null;
  success_count: number;
  failure_count: number;
  metadata: string | null;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  status: string;
  attempts: number;
  last_attempt: number | null;
  response_status: number | null;
  response_body: string | null;
  created_at: number;
}

interface RegisterOptions {
  events?: string[];
  secret?: string;
  filterPattern?: string;
  metadata?: Record<string, unknown>;
}

interface UpdateOptions {
  url?: string;
  events?: string[];
  filterPattern?: string | null;
  active?: boolean;
  metadata?: Record<string, unknown>;
}

interface ListOptions {
  activeOnly?: boolean;
}

interface TriggerOptions {
  targetId?: string;
}

interface GetDeliveriesOptions {
  limit?: number;
}

interface QueuedDelivery {
  deliveryId: string;
  webhookId: string;
  url: string;
  secret: string | null;
  payload: { event: string; timestamp: number; data: unknown };
}

export function createWebhooks(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT,
      events TEXT NOT NULL,
      filter_pattern TEXT,
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_triggered INTEGER,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_attempt INTEGER,
      response_status INTEGER,
      response_body TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(status);
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO webhooks (id, url, secret, events, filter_pattern, active, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    update: db.prepare(`
      UPDATE webhooks SET url = ?, events = ?, filter_pattern = ?, active = ?, metadata = ?
      WHERE id = ?
    `),
    delete: db.prepare('DELETE FROM webhooks WHERE id = ?'),
    getById: db.prepare('SELECT * FROM webhooks WHERE id = ?'),
    getActive: db.prepare('SELECT * FROM webhooks WHERE active = 1'),
    getByEvent: db.prepare('SELECT * FROM webhooks WHERE active = 1 AND events LIKE ?'),
    getAll: db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC'),
    updateStats: db.prepare(`
      UPDATE webhooks SET last_triggered = ?, success_count = success_count + ?, failure_count = failure_count + ?
      WHERE id = ?
    `),
    insertDelivery: db.prepare(`
      INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateDelivery: db.prepare(`
      UPDATE webhook_deliveries
      SET status = ?, attempts = attempts + 1, last_attempt = ?, response_status = ?, response_body = ?
      WHERE id = ?
    `),
    getDeliveries: db.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?'),
    getPendingDeliveries: db.prepare("SELECT * FROM webhook_deliveries WHERE status IN ('pending', 'retrying') AND attempts < 5"),
    cleanupDeliveries: db.prepare('DELETE FROM webhook_deliveries WHERE created_at < ?')
  };

  const deliveryQueue: QueuedDelivery[] = [];
  let processingQueue = false;

  function isPrivateHost(hostname: string): boolean {
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) return true;
    }
    return false;
  }

  function register(url: string, options: RegisterOptions = {}) {
    const { events = ['*'], secret, filterPattern, metadata } = options;

    const currentCount = stmts.getAll.all().length;
    if (currentCount >= MAX_WEBHOOKS) {
      return { success: false, error: `Maximum webhook limit reached (${MAX_WEBHOOKS})` };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'URL must use http or https protocol' };
      }
    } catch {
      return { success: false, error: 'Invalid URL' };
    }

    if (isPrivateHost(parsed.hostname)) {
      return { success: false, error: 'Webhook URLs cannot target private or internal addresses' };
    }

    const validEvents = Object.values(WebhookEvent) as string[];
    for (const event of events) {
      if (event !== '*' && !validEvents.includes(event)) {
        return { success: false, error: `Invalid event type: ${event}` };
      }
    }

    if (filterPattern) {
      if (filterPattern.length > 100) {
        return { success: false, error: 'Filter pattern too long (max 100 chars)' };
      }
      if (!/^[a-zA-Z0-9:_*-]+$/.test(filterPattern)) {
        return { success: false, error: 'Filter pattern contains invalid characters' };
      }
    }

    const id = randomUUID();
    const now = Date.now();

    stmts.insert.run(id, url, secret || null, JSON.stringify(events), filterPattern || null, 1, now, metadata ? JSON.stringify(metadata) : null);

    return { success: true, id, url, events, message: 'Webhook registered' };
  }

  function update(id: string, updates: UpdateOptions) {
    const existing = stmts.getById.get(id) as WebhookRow | undefined;
    if (!existing) return { success: false, error: 'Webhook not found' };

    const { url, events, filterPattern, active, metadata } = updates;

    stmts.update.run(
      url || existing.url,
      events ? JSON.stringify(events) : existing.events,
      filterPattern !== undefined ? filterPattern : existing.filter_pattern,
      active !== undefined ? (active ? 1 : 0) : existing.active,
      metadata ? JSON.stringify(metadata) : existing.metadata,
      id
    );

    return { success: true, message: 'Webhook updated' };
  }

  function remove(id: string) {
    const result = stmts.delete.run(id);
    return {
      success: result.changes > 0,
      deleted: result.changes > 0,
      error: result.changes === 0 ? 'Webhook not found' : undefined
    };
  }

  function get(id: string) {
    const webhook = stmts.getById.get(id) as WebhookRow | undefined;
    if (!webhook) return { success: false, error: 'Webhook not found' };
    return { success: true, webhook: parseWebhook(webhook) };
  }

  function list(options: ListOptions = {}) {
    const { activeOnly } = options;
    const webhooks = (activeOnly ? stmts.getActive.all() : stmts.getAll.all()) as WebhookRow[];
    return { success: true, webhooks: webhooks.map(parseWebhook), count: webhooks.length };
  }

  function parseWebhook(row: WebhookRow) {
    return {
      id: row.id,
      url: row.url,
      hasSecret: !!row.secret,
      events: JSON.parse(row.events) as string[],
      filterPattern: row.filter_pattern,
      active: !!row.active,
      createdAt: row.created_at,
      lastTriggered: row.last_triggered,
      successCount: row.success_count,
      failureCount: row.failure_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
  }

  function signPayload(payload: unknown, secret: string): string {
    const hmac = createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  function safeGlobMatch(pattern: string, str: string): boolean {
    if (!pattern || !str) return false;
    if (pattern === '*') return true;
    if (!pattern.includes('*')) return pattern === str;

    const segments = pattern.split('*');
    let pos = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment === '') continue;

      const idx = str.indexOf(segment, pos);
      if (idx === -1) return false;
      if (i === 0 && !pattern.startsWith('*') && idx !== 0) return false;

      pos = idx + segment.length;
    }

    if (!pattern.endsWith('*') && segments[segments.length - 1]) {
      return str.endsWith(segments[segments.length - 1]);
    }

    return true;
  }

  function trigger(event: string, data: unknown, options: TriggerOptions = {}) {
    const { targetId } = options;

    if (deliveryQueue.length >= MAX_QUEUE_SIZE) {
      return { triggered: 0, error: 'Delivery queue full, try again later' };
    }

    const webhooks = (stmts.getActive.all() as WebhookRow[]).filter(webhook => {
      let events: string[];
      try {
        events = JSON.parse(webhook.events) as string[];
      } catch {
        return false;
      }
      if (!Array.isArray(events)) return false;
      const eventMatches = events.includes('*') || events.includes(event);
      if (!eventMatches) return false;

      if (webhook.filter_pattern && targetId) {
        if (!safeGlobMatch(webhook.filter_pattern, targetId)) return false;
      }

      return true;
    });

    if (webhooks.length === 0) return { triggered: 0 };

    const payload = { event, timestamp: Date.now(), data };

    let queued = 0;
    for (const webhook of webhooks) {
      if (deliveryQueue.length >= MAX_QUEUE_SIZE) break;

      const deliveryId = randomUUID();
      stmts.insertDelivery.run(deliveryId, webhook.id, event, JSON.stringify(payload), 'pending', Date.now());

      deliveryQueue.push({
        deliveryId,
        webhookId: webhook.id,
        url: webhook.url,
        secret: webhook.secret,
        payload
      });
      queued++;
    }

    processQueue();
    return { triggered: queued };
  }

  async function processQueue(): Promise<void> {
    if (processingQueue || deliveryQueue.length === 0) return;

    processingQueue = true;
    while (deliveryQueue.length > 0) {
      const delivery = deliveryQueue.shift()!;
      await deliverWebhook(delivery);
    }
    processingQueue = false;
  }

  async function deliverWebhook(delivery: QueuedDelivery, attempt = 1): Promise<void> {
    const { deliveryId, webhookId, url, secret, payload } = delivery;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-PortDaddy-Event': payload.event,
        'X-PortDaddy-Delivery': deliveryId,
        'X-PortDaddy-Timestamp': String(payload.timestamp)
      };

      if (secret) {
        headers['X-PortDaddy-Signature'] = `sha256=${signPayload(payload, secret)}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
      });

      const responseBody = await response.text().catch(() => '');

      if (response.ok) {
        stmts.updateDelivery.run('delivered', Date.now(), response.status, responseBody.slice(0, RESPONSE_BODY_MAX_LENGTH), deliveryId);
        stmts.updateStats.run(Date.now(), 1, 0, webhookId);
      } else {
        stmts.updateDelivery.run(
          attempt < MAX_RETRY_ATTEMPTS ? 'retrying' : 'failed',
          Date.now(), response.status, responseBody.slice(0, RESPONSE_BODY_MAX_LENGTH), deliveryId
        );

        if (attempt < MAX_RETRY_ATTEMPTS) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          setTimeout(() => deliverWebhook(delivery, attempt + 1), delay);
        } else {
          stmts.updateStats.run(Date.now(), 0, 1, webhookId);
        }
      }
    } catch (error) {
      stmts.updateDelivery.run(
        attempt < MAX_RETRY_ATTEMPTS ? 'retrying' : 'failed',
        Date.now(), null, (error as Error).message.slice(0, RESPONSE_BODY_MAX_LENGTH), deliveryId
      );

      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        setTimeout(() => deliverWebhook(delivery, attempt + 1), delay);
      } else {
        stmts.updateStats.run(Date.now(), 0, 1, webhookId);
      }
    }
  }

  function getDeliveries(webhookId: string, options: GetDeliveriesOptions = {}) {
    let { limit = 50 } = options;
    if (typeof limit !== 'number' || limit < 1) limit = 50;
    limit = Math.min(limit, 500);

    const deliveries = stmts.getDeliveries.all(webhookId, limit) as DeliveryRow[];

    return {
      success: true,
      deliveries: deliveries.map(d => ({
        id: d.id,
        event: d.event,
        status: d.status,
        attempts: d.attempts,
        lastAttempt: d.last_attempt,
        responseStatus: d.response_status,
        createdAt: d.created_at
      })),
      count: deliveries.length
    };
  }

  function retryPending() {
    const pending = stmts.getPendingDeliveries.all() as DeliveryRow[];

    for (const delivery of pending) {
      const webhook = stmts.getById.get(delivery.webhook_id) as WebhookRow | undefined;
      if (!webhook || !webhook.active) continue;

      deliveryQueue.push({
        deliveryId: delivery.id,
        webhookId: webhook.id,
        url: webhook.url,
        secret: webhook.secret,
        payload: JSON.parse(delivery.payload)
      });
    }

    if (pending.length > 0) processQueue();

    return { retrying: pending.length };
  }

  function cleanup() {
    const cutoff = Date.now() - (CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = stmts.cleanupDeliveries.run(cutoff);
    return { cleaned: result.changes };
  }

  async function test(id: string) {
    const webhook = stmts.getById.get(id) as WebhookRow | undefined;
    if (!webhook) return { success: false, error: 'Webhook not found' };

    const payload = {
      event: 'webhook.test',
      timestamp: Date.now(),
      data: { message: 'This is a test webhook delivery from Port Daddy', webhookId: id }
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-PortDaddy-Event': 'webhook.test',
        'X-PortDaddy-Delivery': `test-${randomUUID()}`,
        'X-PortDaddy-Timestamp': String(payload.timestamp)
      };

      if (webhook.secret) {
        headers['X-PortDaddy-Signature'] = `sha256=${signPayload(payload, webhook.secret)}`;
      }

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
      });

      const responseBody = await response.text().catch(() => '');

      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: responseBody.slice(0, RESPONSE_BODY_MAX_LENGTH)
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  return {
    register,
    update,
    remove,
    get,
    list,
    trigger,
    getDeliveries,
    retryPending,
    cleanup,
    test,
    WebhookEvent
  };
}
