/**
 * Port Daddy internal trigger source — emits events from the daemon's
 * own coordination surface (notes, claims, sessions, channels).
 *
 * This is what `pd:note-added`, `pd:claim-released`, `pd:session-ended`,
 * etc. resolve to. The daemon already publishes these on internal
 * channels; we just adapt them to the uniform TriggerSource contract so
 * personal-agent ships can read PD signals the same way dev-repo ships
 * read `git:committed`.
 */

import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

export interface PdTriggerSourceDeps {
  /**
   * Same subscribe primitive used by `triggers/git.ts`. The daemon
   * already publishes pd:* channels; we just route them through the
   * uniform shape.
   */
  subscribe: (channel: string, callback: (message: unknown) => void) => (() => void) | null;
}

export class PdTriggerSource implements TriggerSource {
  readonly kind = 'pd' as const;

  constructor(private readonly deps: PdTriggerSourceDeps) {}

  async available(): Promise<TriggerAvailability> {
    return { ready: true };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    const channel = `pd:${spec.type}`;
    const unsubscribe = this.deps.subscribe(channel, (raw) => {
      const event: FleetTriggerEvent = {
        source: 'pd',
        type: spec.type,
        timestamp: Date.now(),
        payload: raw,
        metadata: {
          correlation_id: typeof raw === 'object' && raw !== null
            ? (raw as Record<string, unknown>).id as string | undefined
            : undefined,
          sender: 'port-daddy',
          consent_verified: true,
        },
      };
      emit(event);
    });

    return {
      async stop() {
        if (typeof unsubscribe === 'function') unsubscribe();
      },
    };
  }
}
