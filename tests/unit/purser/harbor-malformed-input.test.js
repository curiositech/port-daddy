// tests/unit/purser/harbor-malformed-input.test.js
import express from 'express';
import request from 'supertest';
import router from '../../../routes/parley.js';

/**
 * This test suite aggressively probes the harbor parameter handling
 * for both HTTP routes and the underlying validation logic.
 *
 * It injects a variety of control characters, Unicode anomalies,
 * and URL‑encoded payloads that should be rejected as invalid
 * harbors according to the contract for PR #9922.
 *
 * Valid non‑default harbors are also exercised to confirm that
 * proper values continue to flow through the system unchanged.
 */

describe('Harbor parameter malformed input handling', () => {
  // Build a minimal Express app that mounts the Parley router.
  const app = express();
  app.use(express.json());
  app.use('/parley', router);

  // A collection of malformed harbor strings covering control chars,
  // whitespace issues, non‑ASCII, and encoded variants.
  const malformedHarbors = [
    '\u0000harbor',          // NULL byte prefix
    'harbor\u001F',          // Unit Separator suffix
    'harbor\n',              // Newline
    'harbor\r',              // Carriage return
    'harb\u00A0or',          // Non‑breaking space inside
    'härbor',                // Non‑ASCII characters
    'harbor%0A',             // Percent‑encoded newline
    'harbor\u{202E}',        // Right‑to‑Left Override character
    '\u200Bharbor',          // Zero‑width space prefix
    'harbor\u200C',          // Zero‑width non‑joiner suffix
  ];

  /**
   * POST /parley/respond – body‑based harbor validation
   */
  test.each(malformedHarbors)(
    'rejects malformed harbor in POST body: %p',
    async (badHarbor) => {
      const response = await request(app)
        .post('/parley/respond')
        .send({ harbor: badHarbor, message: 'test payload' })
        .set('Accept', 'application/json');

      expect(response.status).toBe(400);
      // The router should surface an error field describing the problem.
      // If the implementation uses a different shape we still assert a 400.
      if (response.body && typeof response.body === 'object') {
        expect(JSON.stringify(response.body)).toMatch(/invalid.*harbor/i);
      }
    },
  );

  /**
   * GET /parley/:id – query‑string harbor validation
   */
  test.each(malformedHarbors)(
    'rejects malformed harbor in query string: %p',
    async (badHarbor) => {
      const response = await request(app)
        .get(`/parley/123?harbor=${encodeURIComponent(badHarbor)}`)
        .set('Accept', 'application/json');

      expect(response.status).toBe(400);
      if (response.body && typeof response.body === 'object') {
        expect(JSON.stringify(response.body)).toMatch(/invalid.*harbor/i);
      }
    },
  );

  /**
   * Positive control – a well‑formed, non‑default harbor must be accepted
   * and propagated back in the response payload (the router echoes it).
   */
  test('accepts a valid non‑default harbor', async () => {
    const validHarbor = 'customHarbor';
    const response = await request(app)
      .post('/parley/respond')
      .send({ harbor: validHarbor, message: 'hello world' })
      .set('Accept', 'application/json');

    // Successful handling should be a 2xx status (commonly 200 or 201).
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);

    // The response should contain the same harbor we sent,
    // proving that the value survived the entire processing pipeline.
    expect(response.body).toHaveProperty('harbor', validHarbor);
  });
});