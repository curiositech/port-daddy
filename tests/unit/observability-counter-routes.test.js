/**
 * Counter-history resolution contract at the HTTP boundary.
 */

import Fastify from 'fastify';
import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createCounters } from '../../lib/counters.js';
import { observabilityPlugin } from '../../routes/observability.js';

describe('observability counter history resolution', () => {
  let app;
  let counters;
  let db;
  let dateNow;

  const currentTime = Date.parse('2026-09-05T12:30:00.000Z');

  beforeEach(async () => {
    dateNow = jest.spyOn(Date, 'now').mockReturnValue(currentTime);
    db = createTestDb();
    counters = createCounters(db, {
      now: () => currentTime,
      maintenanceIntervalMs: 0,
      maintenanceBatchRows: 100,
    });
    app = Fastify();
    await app.register(observabilityPlugin, {
      deps: {
        counters,
        // The counter routes do not invoke the cost tracker.
        costTracker: {},
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    counters.shutdown();
    db.close();
    dateNow.mockRestore();
  });

  function insertCounter(key, bucketMinute, value) {
    const hourMs = 3_600_000;
    db.prepare(`
      INSERT INTO metric_counters
        (key, dims_json, bucket_minute, bucket_hour, value, updated_at)
      VALUES (?, '{}', ?, ?, ?, ?)
    `).run(
      key,
      bucketMinute,
      Math.floor(bucketMinute / hourMs) * hourMs,
      value,
      bucketMinute,
    );
  }

  test('default summary and default recent-minute grouping remain available', async () => {
    counters.bump('recent', {}, 3);
    counters.flush();

    const summary = await app.inject({ method: 'GET', url: '/metrics/counters' });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().counters).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'recent', total: 3 }),
    ]));

    const minute = await app.inject({
      method: 'GET',
      url: '/metrics/counters?key=recent',
    });
    expect(minute.statusCode).toBe(200);
    expect(minute.json()).toMatchObject({ key: 'recent', groupBy: 'minute' });
    expect(minute.json().results[0].value).toBe(3);
  });

  test('aligned historical hours succeed and partial hours return a structured 400', async () => {
    const hourMs = 3_600_000;
    const oldHour = Math.floor((currentTime - 48 * hourMs) / hourMs) * hourMs;
    insertCounter('historical', oldHour + 15 * 60_000, 3);
    insertCounter('historical', oldHour + 45 * 60_000, 4);
    counters.flush();

    const alignedSinceSecs = (currentTime - oldHour) / 1_000;
    const aligned = await app.inject({
      method: 'GET',
      url: `/metrics/counters?key=historical&groupBy=hour&since=${alignedSinceSecs}`,
    });
    expect(aligned.statusCode).toBe(200);
    expect(aligned.json().results).toEqual([expect.objectContaining({
      bucket: oldHour,
      value: 7,
    })]);

    const partial = await app.inject({
      method: 'GET',
      url: '/metrics/counters?key=historical&groupBy=hour&since=172800',
    });
    expect(partial.statusCode).toBe(400);
    expect(partial.json()).toEqual({
      error: expect.stringMatching(/partial-hour since boundary/),
      code: 'COUNTER_HISTORY_RESOLUTION_UNSUPPORTED',
      historicalResolution: 'hour',
      resolutionMs: 3_600_000,
      supportedBoundaries: {
        since: 'hour-start',
        until: 'hour-final-minute-inclusive',
      },
    });

    const topPartial = await app.inject({
      method: 'GET',
      url: '/metrics/counters/top?key=historical&dim=backend&since=172800',
    });
    expect(topPartial.statusCode).toBe(400);
    expect(topPartial.json().code).toBe('COUNTER_HISTORY_RESOLUTION_UNSUPPORTED');
  });
});
