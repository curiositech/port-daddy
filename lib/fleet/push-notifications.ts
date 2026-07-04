/**
 * Fleet push notifications — Web Push (VAPID) delivery for trust-gate
 * approval requests, so a pending human gate reaches the operator's phone
 * or desktop even when no dashboard tab is open.
 *
 * Why Web Push and not FCM/APNs: Port Daddy has no app-store app and the
 * daemon must not depend on a third-party push account. Web Push is
 * standards-based, self-contained (VAPID keypair generated and persisted
 * locally), and reaches iPhones via the fleet-ui home-screen PWA (iOS
 * 16.4+) as well as any desktop browser.
 *
 * mobile-push-notification-expert gates honored:
 *   - Permission is requested CONTEXTUALLY (the fleet-ui approvals panel
 *     has an explicit "Notify me" affordance) — never on first load.
 *   - Subscription lifecycle: refresh-safe upsert by endpoint; dead
 *     endpoints (HTTP 404/410 from the push service) are pruned on send —
 *     the "token cleanup for uninstalled apps" item.
 *   - Grouping: every approval push carries the same `tag`
 *     (fleet-approvals) so ten pending gates collapse instead of spamming.
 *   - Deep link: the payload carries the approvals-panel URL; the service
 *     worker's notificationclick opens/focuses it.
 *   - Data minimization rides along from the trust gate: the push body is
 *     agent/trigger/tier only — never event content.
 *
 * Files (0600, operator-local):
 *   ~/.port-daddy/push-vapid.json          — VAPID keypair
 *   ~/.port-daddy/push-subscriptions.json  — subscription list
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FleetApprovalStream, PendingApproval } from './approval-stream.js';

const VAPID_PATH = join(homedir(), '.port-daddy', 'push-vapid.json');
const SUBSCRIPTIONS_PATH = join(homedir(), '.port-daddy', 'push-subscriptions.json');

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  addedAt: number;
  userAgent?: string;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The subset of the `web-push` module we use — injectable for tests. */
export interface WebPushLike {
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { TTL?: number; urgency?: string; topic?: string },
  ): Promise<unknown>;
}

export interface PushNotifierOptions {
  webpush?: WebPushLike;
  vapidPath?: string;
  subscriptionsPath?: string;
  /** Best-effort local banner alongside the push (macOS notify sink). */
  localNotify?: (title: string, body: string) => Promise<void>;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonPrivate(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on non-POSIX
  }
}

export class FleetPushNotifier {
  private readonly vapidPath: string;
  private readonly subscriptionsPath: string;
  private readonly localNotify?: PushNotifierOptions['localNotify'];
  private webpushImpl: WebPushLike | null;
  private vapid: VapidKeys | null = null;
  private vapidApplied = false;

  constructor(opts: PushNotifierOptions = {}) {
    this.webpushImpl = opts.webpush ?? null;
    this.vapidPath = opts.vapidPath ?? VAPID_PATH;
    this.subscriptionsPath = opts.subscriptionsPath ?? SUBSCRIPTIONS_PATH;
    this.localNotify = opts.localNotify;
  }

  private async webpush(): Promise<WebPushLike> {
    if (!this.webpushImpl) {
      this.webpushImpl = (await import('web-push')).default as unknown as WebPushLike;
    }
    return this.webpushImpl;
  }

  /** Load-or-generate the VAPID keypair (persisted, 0600). */
  async ensureVapid(): Promise<VapidKeys> {
    if (this.vapid) return this.vapid;
    const existing = readJson<VapidKeys>(this.vapidPath);
    if (existing?.publicKey && existing?.privateKey) {
      this.vapid = existing;
    } else {
      const wp = await this.webpush();
      const pair = wp.generateVAPIDKeys();
      this.vapid = {
        ...pair,
        subject: process.env.PD_PUSH_VAPID_SUBJECT || 'mailto:fleet@portdaddy.dev',
      };
      writeJsonPrivate(this.vapidPath, this.vapid);
    }
    return this.vapid;
  }

  async publicKey(): Promise<string> {
    return (await this.ensureVapid()).publicKey;
  }

  listSubscriptions(): PushSubscriptionRecord[] {
    return readJson<PushSubscriptionRecord[]>(this.subscriptionsPath) ?? [];
  }

  /** Upsert by endpoint — browsers rotate subscriptions; the newest keys win
   *  (the "handle token refresh" gate). */
  addSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): void {
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      throw new Error('malformed push subscription (endpoint + keys.p256dh + keys.auth required)');
    }
    const all = this.listSubscriptions().filter((s) => s.endpoint !== sub.endpoint);
    all.push({ endpoint: sub.endpoint, keys: sub.keys, addedAt: Date.now(), userAgent });
    writeJsonPrivate(this.subscriptionsPath, all);
  }

  removeSubscription(endpoint: string): boolean {
    const all = this.listSubscriptions();
    const kept = all.filter((s) => s.endpoint !== endpoint);
    if (kept.length === all.length) return false;
    writeJsonPrivate(this.subscriptionsPath, kept);
    return true;
  }

  /**
   * Send a payload to every subscription. Dead endpoints (404/410) are
   * pruned; other failures are logged and kept (transient push-service
   * errors must not unsubscribe a live device).
   */
  async sendToAll(payload: {
    title: string;
    body: string;
    tag: string;
    deepLink: string;
    data?: Record<string, unknown>;
  }): Promise<{ sent: number; pruned: number; failed: number }> {
    const subscriptions = this.listSubscriptions();
    if (subscriptions.length === 0) return { sent: 0, pruned: 0, failed: 0 };

    const wp = await this.webpush();
    const vapid = await this.ensureVapid();
    if (!this.vapidApplied) {
      wp.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      this.vapidApplied = true;
    }

    const body = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;
    const dead: string[] = [];
    for (const sub of subscriptions) {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          body,
          // topic collapses undelivered duplicates at the push service; the
          // service worker's `tag` collapses delivered ones on the device.
          { TTL: 24 * 60 * 60, urgency: 'high', topic: payload.tag.slice(0, 32) },
        );
        sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          dead.push(sub.endpoint);
        } else {
          failed += 1;
          console.error(
            '[fleet.push] send failed:',
            statusCode ?? (err instanceof Error ? err.message : String(err)),
          );
        }
      }
    }
    for (const endpoint of dead) this.removeSubscription(endpoint);
    return { sent, pruned: dead.length, failed };
  }

  /** Wire approval gates → notifications. Waiting gates push (grouped);
   *  resolutions do not (a resolution is closure, not a demand). */
  bindApprovalStream(stream: FleetApprovalStream): () => void {
    return stream.subscribe((event) => {
      if (event.type !== 'human_gate_waiting') return;
      const p: PendingApproval = event.proposal;
      const title = 'Fleet approval needed';
      const body = `${p.agent} ← ${p.trigger} (${p.tier}, ${p.project})`;
      void this.sendToAll({
        title,
        body,
        tag: 'fleet-approvals',
        deepLink: '/fleet-ui/#approvals',
        data: { id: p.id, project: p.project },
      }).catch((err: Error) => console.error('[fleet.push] approval push failed:', err.message));
      if (this.localNotify) {
        // Best-effort local banner; consent-gate denial is quiet by design.
        void this.localNotify(title, body).catch(() => {});
      }
    });
  }
}

let shared: FleetPushNotifier | null = null;
export function getSharedPushNotifier(): FleetPushNotifier {
  if (!shared) shared = new FleetPushNotifier();
  return shared;
}
export function setSharedPushNotifier(notifier: FleetPushNotifier | null): void {
  shared = notifier;
}
