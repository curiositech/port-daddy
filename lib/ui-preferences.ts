import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { UI_PREFS_FILE } from '../shared/paths.js';

export interface UiPreferences {
  launchFleetBarOnDaemonStart: boolean;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  launchFleetBarOnDaemonStart: true,
};

function sanitizeUiPreferences(raw: unknown): UiPreferences {
  const prefs = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};

  return {
    launchFleetBarOnDaemonStart: typeof prefs.launchFleetBarOnDaemonStart === 'boolean'
      ? prefs.launchFleetBarOnDaemonStart
      : DEFAULT_UI_PREFERENCES.launchFleetBarOnDaemonStart,
  };
}

export function loadUiPreferences(): UiPreferences {
  if (!existsSync(UI_PREFS_FILE)) return DEFAULT_UI_PREFERENCES;

  try {
    const raw = JSON.parse(readFileSync(UI_PREFS_FILE, 'utf8')) as unknown;
    return sanitizeUiPreferences(raw);
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

export function saveUiPreferences(nextPrefs: Partial<UiPreferences>): UiPreferences {
  const current = loadUiPreferences();
  const merged = sanitizeUiPreferences({ ...current, ...nextPrefs });

  mkdirSync(dirname(UI_PREFS_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(UI_PREFS_FILE, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });

  return merged;
}
