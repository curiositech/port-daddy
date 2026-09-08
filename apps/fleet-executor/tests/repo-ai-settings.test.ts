/**
 * Tests for apps/shared/repo-ai-settings.ts — the shared Workers AI
 * call-deadline constants, validator, and D1-reading resolver used by both
 * apps/relay (writer, /account/repos) and apps/fleet-executor (reader, at
 * run start).
 *
 * Coverage requested by pd-qa on #9800 (MEDIUM: "new shared module added
 * without any corresponding unit test file"). Fail-closed behavior is the
 * load-bearing property here: this value gates every Workers AI call
 * fleet-wide, so every branch that could otherwise throw or misparse must
 * be pinned to fall back to the default rather than break a run.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AI_CALL_DEADLINE_MS,
  MIN_AI_CALL_DEADLINE_MS,
  MAX_AI_CALL_DEADLINE_MS,
  parseAiCallDeadlineMs,
  aiCallDeadlineMsFromSettingsJson,
  resolveAiCallDeadlineMs,
  type AiSettingsDb,
} from '../../shared/repo-ai-settings.js';

describe('parseAiCallDeadlineMs', () => {
  it('accepts a value inside the bounds unchanged', () => {
    expect(parseAiCallDeadlineMs(120_000)).toBe(120_000);
  });

  it('accepts a numeric string', () => {
    expect(parseAiCallDeadlineMs('90000')).toBe(90_000);
  });

  it('clamps below the floor up to MIN, above the ceiling down to MAX', () => {
    expect(parseAiCallDeadlineMs(1)).toBe(MIN_AI_CALL_DEADLINE_MS);
    expect(parseAiCallDeadlineMs(999_999_999)).toBe(MAX_AI_CALL_DEADLINE_MS);
  });

  it('rounds a fractional value to the nearest integer millisecond', () => {
    expect(parseAiCallDeadlineMs(120_000.6)).toBe(120_001);
  });

  it('rejects anything that cannot possibly be a duration', () => {
    for (const bad of [0, -5, NaN, Infinity, -Infinity, 'not-a-number', null, undefined, {}, []]) {
      expect(parseAiCallDeadlineMs(bad)).toBeNull();
    }
  });
});

describe('aiCallDeadlineMsFromSettingsJson', () => {
  it('reads a valid aiCallDeadlineMs key', () => {
    expect(aiCallDeadlineMsFromSettingsJson('{"aiCallDeadlineMs":90000}')).toBe(90_000);
  });

  it('falls back to the default when the key is absent', () => {
    expect(aiCallDeadlineMsFromSettingsJson('{}')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
  });

  it('falls back to the default for null/undefined/empty input', () => {
    expect(aiCallDeadlineMsFromSettingsJson(null)).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
    expect(aiCallDeadlineMsFromSettingsJson(undefined)).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
    expect(aiCallDeadlineMsFromSettingsJson('')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
  });

  it('falls back to the default on malformed JSON rather than throwing', () => {
    expect(aiCallDeadlineMsFromSettingsJson('{not valid json')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
  });

  it('falls back to the default when the stored value is out of bounds shape', () => {
    expect(aiCallDeadlineMsFromSettingsJson('{"aiCallDeadlineMs":"garbage"}')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
    expect(aiCallDeadlineMsFromSettingsJson('{"aiCallDeadlineMs":-1}')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
  });
});

describe('resolveAiCallDeadlineMs', () => {
  function dbWith(row: { settings_json: string } | null): AiSettingsDb {
    return {
      prepare: () => ({
        bind: () => ({
          async first() {
            return row as never;
          },
        }),
      }),
    };
  }

  it('falls back to the default without a DB binding', async () => {
    expect(await resolveAiCallDeadlineMs(undefined, 'acme/widgets')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
    expect(await resolveAiCallDeadlineMs(null, 'acme/widgets')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
  });

  it('reads the configured deadline from the most-recently-updated row', async () => {
    const db = dbWith({ settings_json: '{"aiCallDeadlineMs":180000}' });
    expect(await resolveAiCallDeadlineMs(db, 'acme/widgets')).toBe(180_000);
  });

  it('falls back to the default when no row exists for the repo', async () => {
    const db = dbWith(null);
    expect(await resolveAiCallDeadlineMs(db, 'acme/widgets')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
  });

  it('fails closed to the default when the D1 read throws (never blocks a run)', async () => {
    const explodingDb: AiSettingsDb = {
      prepare: () => ({
        bind: () => ({
          async first() {
            throw new Error('D1 unavailable');
          },
        }),
      }),
    };
    expect(await resolveAiCallDeadlineMs(explodingDb, 'acme/widgets')).toBe(DEFAULT_AI_CALL_DEADLINE_MS);
  });
});
