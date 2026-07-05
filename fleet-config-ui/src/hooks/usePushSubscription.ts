/**
 * usePushSubscription — register THIS device for fleet approval pushes.
 *
 * mobile-push-notification-expert gates:
 *   - Permission is requested only when the operator clicks "Notify me"
 *     in the approvals panel (contextual), never on load.
 *   - The subscription is re-posted to the daemon whenever it already
 *     exists (refresh-safe: the daemon upserts by endpoint).
 *   - Unsupported contexts (no service worker / no PushManager — e.g.
 *     iOS Safari outside a home-screen PWA) report `supported: false`
 *     with a reason instead of a dead button.
 */

import { useCallback, useEffect, useState } from 'react';
import { getDaemonUrl } from '../api';

export interface PushSubscriptionState {
  supported: boolean;
  reason: string | null;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  busy: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function daemon(path: string): string {
  return `${getDaemonUrl().replace(/\/$/, '')}${path}`;
}

export function usePushSubscription(): PushSubscriptionState {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  const reason = supported
    ? null
    : 'Push is unavailable here. On iPhone: add fleet-ui to the Home Screen (iOS 16.4+), then enable from the installed app.';
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Detect an existing subscription (and refresh the daemon's copy of it).
  useEffect(() => {
    if (!supported) return;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = await registration?.pushManager.getSubscription();
        if (existing) {
          setSubscribed(true);
          await fetch(daemon('/fleet/push/subscriptions'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscription: existing.toJSON() }),
          });
        }
      } catch {
        // Detection is best-effort.
      }
    })();
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.register('/fleet-ui/sw.js', { scope: '/fleet-ui/' });
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') return;

      const keyRes = await fetch(daemon('/fleet/push/vapid-public-key'));
      const { publicKey } = (await keyRes.json()) as { publicKey: string };
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch(daemon('/fleet/push/subscriptions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      setSubscribed(res.ok);
    } finally {
      setBusy(false);
    }
  }, [supported, busy]);

  const unsubscribe = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const existing = await registration?.pushManager.getSubscription();
      if (existing) {
        await fetch(daemon('/fleet/push/subscriptions'), {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, [supported, busy]);

  return { supported, reason, permission, subscribed, busy, subscribe, unsubscribe };
}
