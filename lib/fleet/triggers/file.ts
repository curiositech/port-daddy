/**
 * File-watch trigger source — emits an event when a file or directory
 * changes on disk.
 *
 * Unlike the other personal-agent sources, this one is fully wired (no
 * stubs). Node's built-in `fs.watch` is enough to power most personal-
 * agent use cases: "when I save a markdown file in ~/Documents/notes/,
 * extract its commitments into my todo list."
 *
 * Spec syntax:
 *   file:changed(~/Documents/notes/)        — directory, recursive
 *   file:changed(~/Documents/notes/today.md)— single file
 *   file:created(~/Downloads/)              — only new files
 *   file:deleted(~/Downloads/)              — only deletions
 *
 * Notes:
 *   - Paths beginning with `~` are expanded to `os.homedir()`.
 *   - Directory watchers debounce rapid-fire events (most editors emit
 *     a flurry on save). Default debounce is 200ms.
 *   - On macOS we use `fs.watch` recursive mode. On Linux/Windows we
 *     fall back to per-directory watchers; recursive support there is
 *     out of scope until an operator asks.
 */

import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import type {
  FleetTriggerEvent,
  TriggerAvailability,
  TriggerHandle,
  TriggerSource,
  TriggerSpec,
} from '../types.js';

interface FileChangeEventPayload {
  /** Absolute path of the file or directory that changed. */
  path: string;
  /** Type of change as reported by fs.watch. */
  eventType: 'rename' | 'change';
  /** True if the path is a directory. */
  isDirectory: boolean;
  /** Best-effort file size after the change (or null if unreadable). */
  size: number | null;
}

export interface FileTriggerOptions {
  debounceMs?: number;
}

export class FileTriggerSource implements TriggerSource {
  readonly kind = 'file' as const;

  constructor(private readonly opts: FileTriggerOptions = {}) {}

  async available(): Promise<TriggerAvailability> {
    return { ready: true };
  }

  async start(spec: TriggerSpec, emit: (event: FleetTriggerEvent) => void): Promise<TriggerHandle> {
    const rawPath = spec.arg ?? spec.filters.path ?? null;
    if (!rawPath) {
      throw new Error('file trigger requires a path: file:changed(~/path/to/watch)');
    }
    const absolute = expandHome(rawPath);
    const debounceMs = this.opts.debounceMs ?? 200;

    let isDir = false;
    try {
      const s = await stat(absolute);
      isDir = s.isDirectory();
    } catch {
      throw new Error(`file trigger path does not exist: ${absolute}`);
    }

    const pending = new Map<string, NodeJS.Timeout>();

    const fire = async (entryPath: string, eventType: 'rename' | 'change') => {
      // Match the spec.type to the actual fs operation observed. fs.watch
      // gives us 'rename' (created or deleted) and 'change' (modified).
      const wantsCreated = spec.type === 'created';
      const wantsDeleted = spec.type === 'deleted';
      const wantsChanged = spec.type === 'changed' || spec.type === '';

      let size: number | null = null;
      let exists = true;
      try {
        const s = await stat(entryPath);
        size = s.size;
      } catch {
        exists = false;
      }

      if (wantsCreated && !exists) return;
      if (wantsDeleted && exists) return;
      if (!wantsCreated && !wantsDeleted && !wantsChanged) return;

      const event: FleetTriggerEvent<FileChangeEventPayload> = {
        source: 'file',
        type: spec.type || 'changed',
        timestamp: Date.now(),
        payload: {
          path: entryPath,
          eventType,
          isDirectory: false, // We never report directory itself; only contents.
          size,
        },
        metadata: {
          correlation_id: entryPath,
          sender: 'fs.watch',
          subject: entryPath.split('/').pop(),
          consent_verified: true, // Local filesystem under operator's control.
        },
      };
      emit(event);
    };

    let watcher: FSWatcher;
    try {
      watcher = watch(absolute, { recursive: isDir && process.platform === 'darwin' }, (eventType, filename) => {
        const child = filename ? join(absolute, filename) : absolute;
        // Debounce per-path. Editors fire 4+ events on save.
        const prior = pending.get(child);
        if (prior) clearTimeout(prior);
        pending.set(child, setTimeout(() => {
          pending.delete(child);
          void fire(child, (eventType as 'rename' | 'change') ?? 'change');
        }, debounceMs));
      });
    } catch (err) {
      throw new Error(`fs.watch failed for ${absolute}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      async stop() {
        watcher.close();
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
      },
    };
  }
}

function expandHome(input: string): string {
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2));
  if (input === '~') return homedir();
  return resolve(input);
}
