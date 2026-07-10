/**
 * Route tests for the booty HTTP surface (routes/booty.ts).
 *
 * GET /booty  — list provenance rows with filters
 * POST /booty — deposit a provenance row for an already-stored blob
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const { initDatabase, closeDatabase } = await import('../../lib/db.js');
const { createBlobStore } = await import('../../lib/blob.js');
const { createBootyStore } = await import('../../lib/booty.js');
const { bootyPlugin } = await import('../../routes/booty.js');

// Scratch lives under ~/coding/tmp (never /tmp — macOS purges it).
const SCRATCH_ROOT = join(homedir(), 'coding', 'tmp');

describe('booty routes', () => {
  let app;
  let dir;
  let db;
  let blobs;
  let booty;

  beforeEach(async () => {
    mkdirSync(SCRATCH_ROOT, { recursive: true });
    dir = mkdtempSync(join(SCRATCH_ROOT, 'pd-booty-routes-'));
    db = initDatabase({ inMemory: true });
    blobs = createBlobStore({ dir });
    booty = createBootyStore(db);
    app = Fastify();
    await app.register(bootyPlugin, { deps: { booty, blobs } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(dir, { recursive: true, force: true });
  });

  function deposit(overrides = {}) {
    const stat = blobs.put(Buffer.from(overrides.__bytes ?? 'artifact bytes'), {
      contentType: 'image/png',
    });
    const body = {
      blob_hash: stat.id,
      media_type: 'image/png',
      original_path: '/repo/designs/hero.png',
      branch: 'claude/feature-x',
      worktree: 'wf_abc',
      session_id: 'session-1',
      agent_identity: 'port-daddy:wave1',
      ...overrides,
    };
    delete body.__bytes;
    return { stat, body };
  }

  it('POST /booty deposits provenance and GET /booty lists it', async () => {
    const { stat, body } = deposit({ roadmap_link: 'state-plane', note: 'workup' });
    const res = await app.inject({ method: 'POST', url: '/booty', payload: body });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.deduped).toBe(false);
    expect(json.booty.blob_hash).toBe(stat.id);
    expect(json.booty.byte_size).toBe(stat.size);
    expect(json.booty.session_id).toBe('session-1');
    expect(json.booty.agent_identity).toBe('port-daddy:wave1');
    expect(json.booty.roadmap_link).toBe('state-plane');

    const list = await app.inject({ method: 'GET', url: '/booty' });
    expect(list.statusCode).toBe(200);
    const listed = list.json();
    expect(listed.success).toBe(true);
    expect(listed.booty).toHaveLength(1);
    expect(listed.booty[0].id).toBe(json.booty.id);
  });

  it('POST /booty is idempotent for the same blob_hash + branch', async () => {
    const { body } = deposit();
    const first = await app.inject({ method: 'POST', url: '/booty', payload: body });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/booty', payload: body });
    expect(second.statusCode).toBe(200);
    expect(second.json().deduped).toBe(true);
    expect(second.json().booty.id).toBe(first.json().booty.id);

    const list = await app.inject({ method: 'GET', url: '/booty' });
    expect(list.json().booty).toHaveLength(1);
  });

  it('POST /booty rejects blobs not present in the store', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/booty',
      payload: {
        blob_hash: 'f'.repeat(64),
        original_path: '/repo/x.png',
        branch: 'main',
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().success).toBe(false);
  });

  it('POST /booty rejects malformed hashes and missing fields', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/booty',
      payload: { blob_hash: 'nope', original_path: '/x', branch: 'main' },
    });
    expect(bad.statusCode).toBe(400);

    const { body } = deposit();
    delete body.original_path;
    const missing = await app.inject({ method: 'POST', url: '/booty', payload: body });
    expect(missing.statusCode).toBe(400);
  });

  it('POST /booty ignores client-supplied byte_size/media_type in favor of blob-store truth', async () => {
    const { stat, body } = deposit({ byte_size: 999999, media_type: 'text/evil' });
    const res = await app.inject({ method: 'POST', url: '/booty', payload: body });
    expect(res.statusCode).toBe(201);
    const row = res.json().booty;
    expect(row.byte_size).toBe(stat.size);
    expect(row.media_type).toBe('image/png'); // the contentType the store recorded at put()
  });

  it('GET /booty respects an explicit limit=0', async () => {
    const { body } = deposit();
    await app.inject({ method: 'POST', url: '/booty', payload: body });
    const res = await app.inject({ method: 'GET', url: '/booty?limit=0' });
    expect(res.statusCode).toBe(200);
    expect(res.json().booty).toHaveLength(0);
  });

  it('GET /booty filters by branch and session', async () => {
    const a = deposit({ __bytes: 'one' });
    await app.inject({ method: 'POST', url: '/booty', payload: a.body });
    const b = deposit({ __bytes: 'two', branch: 'main', session_id: 'session-2' });
    await app.inject({ method: 'POST', url: '/booty', payload: b.body });

    const byBranch = await app.inject({ method: 'GET', url: '/booty?branch=main' });
    expect(byBranch.json().booty).toHaveLength(1);
    expect(byBranch.json().booty[0].blob_hash).toBe(b.stat.id);

    const bySession = await app.inject({ method: 'GET', url: '/booty?session=session-1' });
    expect(bySession.json().booty).toHaveLength(1);
    expect(bySession.json().booty[0].blob_hash).toBe(a.stat.id);

    const limited = await app.inject({ method: 'GET', url: '/booty?limit=1' });
    expect(limited.json().booty).toHaveLength(1);
  });
});
