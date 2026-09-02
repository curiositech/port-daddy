import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from '@jest/globals';
import {
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createBlobStore } from '../../lib/blob.js';
import {
  PortholeError,
  createInMemoryPortholeSecretProvider,
  createKeychainPortholeSecretProvider,
  createPortholeStore,
  computePortholePrivacyReceiptContentHash,
  computePortholePrivacySubjectContentHash,
  computePortholeScheduleCommitment,
  portholeCompletenessReceiptSigningMessage,
  portholePrivacyReceiptSigningMessage,
  validatePortholeCiphertextEnvelope,
  type AppendGapInput,
  type AppendSegmentInput,
  type PortholePerspective,
  type PortholeCompletenessReceipt,
  type PortholePrivacyReceipt,
  type PortholeReceiptSigner,
  type PortholeVerifiedSignatureAuthority,
} from '../../lib/agent-harbor/porthole.js';

const databases: Database.Database[] = [];
const scratchDirs: string[] = [];

const privacyPair = generateKeyPairSync('ed25519');
const devicePair = generateKeyPairSync('ed25519');
const PRIVACY_KEY_ID = 'privacy-pipeline-local-v1';
const DEVICE_KEY_ID = 'device-porthole-local-v1';

function frozenSchema(name: 'porthole-perspective' | 'porthole-completeness-receipt') {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    'schemas',
    'agent-harbor',
    'v0',
    `${name}.schema.json`,
  ), 'utf8')) as {
    required: string[];
    properties: Record<string, { required?: string[]; properties?: Record<string, { required?: string[] }> }>;
  };
}

function expectExactRequiredKeys(value: object, required: string[]) {
  expect(Object.keys(value).sort()).toEqual([...required].sort());
}

function canonicalTestJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalTestJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalTestJson(record[key])}`)
    .join(',')}}`;
}

function trustedParticipantContext(context: {
  harborId: string;
  bodyId: string;
  participantId: string;
  stageId: string;
  perspectiveId: string;
  streamId: string;
  contentHash: string;
}) {
  return context.harborId === 'harbor_local' &&
    context.bodyId === 'body_macos_7712' &&
    context.participantId === 'agent_builder_participant' &&
    context.stageId === 'stage_checkout_repair' &&
    context.streamId === `stream_${context.perspectiveId}` &&
    /^sha256:[a-f0-9]{64}$/.test(context.contentHash);
}

const signatureAuthority: PortholeVerifiedSignatureAuthority = {
  verifyPrivacy: (context, message, signature) => trustedParticipantContext(context) &&
    context.surfaceId === 'surface_native_window_8842' &&
    context.surfaceDescriptorCommitment === `sha256:${'1'.repeat(64)}` &&
    context.receiptId.startsWith('privacy_') &&
    context.policyId === 'porthole-exact-target-v1' &&
    context.pipelineVersion === '1.0.0' &&
    context.targetScope === 'exact-target' &&
    context.backgroundDisposition === 'excluded' &&
    ((context.secretScan === 'passed' && context.redactionDisposition === 'scrubbed') ||
      (context.secretScan === 'quarantined' && context.redactionDisposition === 'quarantined')) &&
    context.claimedKeyId === PRIVACY_KEY_ID &&
    cryptoVerify(null, message, privacyPair.publicKey, signature),
  verifyCompleteness: (context, message, signature) => trustedParticipantContext(context) &&
    context.claimedKeyId === DEVICE_KEY_ID &&
    cryptoVerify(null, message, devicePair.publicKey, signature),
};

const receiptSigner: PortholeReceiptSigner = {
  signingKeyId: DEVICE_KEY_ID,
  sign: (context, message) => trustedParticipantContext(context)
    ? cryptoSign(null, message, devicePair.privateKey)
    : Buffer.alloc(0),
};

function state(
  secret = Buffer.alloc(32, 9),
  authorities: {
    signatureAuthority?: PortholeVerifiedSignatureAuthority;
    receiptSigner?: PortholeReceiptSigner;
  } = {},
) {
  const db = new Database(':memory:');
  databases.push(db);
  const scratchRoot = join(process.cwd(), '.scratch');
  mkdirSync(scratchRoot, { recursive: true });
  const dir = mkdtempSync(join(scratchRoot, 'porthole-unit-'));
  scratchDirs.push(dir);
  const blobs = createBlobStore({ dir });
  const store = createPortholeStore({
    db,
    blobs,
    secrets: createInMemoryPortholeSecretProvider(secret),
    signatureAuthority: authorities.signatureAuthority ?? signatureAuthority,
    receiptSigner: authorities.receiptSigner ?? receiptSigner,
  });
  return { db, blobs, dir, store };
}

function nativeStageInput(perspectiveId = 'pov_native_window_8842', expectedCount = 1) {
  const scheduleWithoutCommitment = {
    scheduleId: `schedule_${perspectiveId}`,
    mode: 'fixed-interval' as const,
    samplingIntervalMs: 1000,
    boundary: {
      kind: 'fixed-duration' as const,
      durationMs: expectedCount * 1000,
      terminalEventKind: null,
    },
    committedAt: '2026-08-30T17:59:59.000Z',
  };
  return {
    perspectiveId,
    stageId: 'stage_checkout_repair',
    streamId: `stream_${perspectiveId}`,
    harborId: 'harbor_local',
    participantId: 'agent_builder_participant',
    actor: {
      kind: 'agent',
      role: 'collaborator',
      personId: null,
    },
    agentNodeId: 'agent_builder',
    bodyId: 'body_macos_7712',
    sessionId: 'session_checkout_repair',
    runId: 'run_checkout_repair',
    surface: {
      surfaceId: 'surface_native_window_8842',
      kind: 'native-app',
      descriptor: {
        state: 'sealed',
        envelopeRef: `sealed-descriptor:${perspectiveId}`,
        commitment: `sha256:${'1'.repeat(64)}`,
      },
    },
    capture: {
      adapter: 'pd-console-macos-window',
      adapterVersion: '0.1.0',
      modalities: ['visual', 'accessibility', 'input', 'control'],
      sourceClock: 'monotonic',
      visibleIndicator: true,
    },
    captureSchedule: {
      ...scheduleWithoutCommitment,
      commitmentHash: computePortholeScheduleCommitment(scheduleWithoutCommitment),
    },
    privacy: {
      scope: 'device-only',
      redaction: 'adapter',
      semanticPayload: 'encrypted',
      hiddenReasoningCaptured: false,
    },
    startedAt: '2026-08-30T18:00:00.000Z',
  } as const;
}

function startNativeStage(store: ReturnType<typeof createPortholeStore>, expectedCount = 1) {
  return store.start(nativeStageInput('pov_native_window_8842', expectedCount));
}

function privacyReceipt(
  manifest: PortholePerspective,
  receiptId: string,
  disposition: 'passed' | 'quarantined',
  subject: Omit<AppendSegmentInput, 'privacyReceipt'>,
): PortholePrivacyReceipt {
  const content = {
    receiptId,
    policyId: 'porthole-exact-target-v1',
    pipelineVersion: '1.0.0',
    targetScope: 'exact-target',
    backgroundDisposition: 'excluded',
    secretScan: disposition,
    redactionDisposition: disposition === 'passed' ? 'scrubbed' : 'quarantined',
    binding: {
      harborId: manifest.harborId,
      bodyId: manifest.bodyId,
      stageId: manifest.stageId,
      perspectiveId: manifest.perspectiveId,
      streamId: manifest.streamId,
      surfaceId: manifest.surface.surfaceId,
      surfaceDescriptorCommitment: manifest.surface.descriptor.commitment,
      captureIndex: subject.captureIndex,
      sanitizedContentHash: computePortholePrivacySubjectContentHash(
        manifest.perspectiveId,
        subject,
      ),
    },
    issuer: {
      participantId: manifest.participantId,
      keyId: PRIVACY_KEY_ID,
    },
  };
  const unsigned: PortholePrivacyReceipt = {
    ...content,
    contentHash: computePortholePrivacyReceiptContentHash(content),
    signature: {
      algorithm: 'ed25519' as const,
      keyId: PRIVACY_KEY_ID,
      value: '',
    },
  };
  const message = portholePrivacyReceiptSigningMessage(unsigned);
  try {
    return {
      ...unsigned,
      signature: {
        ...unsigned.signature,
        value: cryptoSign(null, message, privacyPair.privateKey).toString('base64url'),
      },
    };
  } finally {
    message.fill(0);
  }
}

function attestedSegment(
  manifest: PortholePerspective,
  subject: Omit<AppendSegmentInput, 'privacyReceipt'>,
  receiptId = 'privacy_passed_001',
  disposition: 'passed' | 'quarantined' = 'passed',
): AppendSegmentInput {
  return {
    ...subject,
    privacyReceipt: privacyReceipt(manifest, receiptId, disposition, subject),
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Porthole encrypted first-person evidence', () => {
  test('rejects distinct signed burst samples before changing the ledger or blob store', () => {
    const { store, dir } = state();
    const manifest = startNativeStage(store, 3);
    const sample = (captureIndex: number, capturedAt: string) => attestedSegment(manifest, {
      captureIndex, capturedAt, mediaType: 'image/png', bytes: Buffer.from(`frame-${captureIndex}`),
    }, `privacy_burst_${captureIndex}`);
    store.appendSegment(manifest.perspectiveId, sample(0, manifest.startedAt));
    const before = store.events(manifest.perspectiveId);
    const files = readdirSync(dir);
    expect(() => store.appendSegment(manifest.perspectiveId, sample(1, manifest.startedAt)))
      .toThrow(/capture slot/);
    expect(store.events(manifest.perspectiveId)).toEqual(before);
    expect(readdirSync(dir)).toEqual(files);
    store.appendSegment(manifest.perspectiveId, sample(1, '2026-08-30T18:00:01.000Z'));
    store.appendSegment(manifest.perspectiveId, sample(2, '2026-08-30T18:00:02.000Z'));
    expect(store.complete(manifest.perspectiveId, {
      stopReason: 'operator', closedAt: '2026-08-30T18:00:03.000Z',
    })).toMatchObject({ status: 'complete', expectedCaptureCount: 3, verifiedSegmentCount: 3 });
    expect(store.verifyReceipt(manifest.perspectiveId).valid).toBe(true);
    expect(store.verifyEvidence(manifest.perspectiveId).valid).toBe(true);
  });

  test.each([
    ['next slot opening', 1000, null],
    ['later slot', 2000, null],
    ['end crosses slot', 500, 1001],
  ])('rejects %s for slot zero before persistence', (_label, at, end) => {
    const { store, dir } = state();
    const manifest = startNativeStage(store, 3);
    const timestamp = (ms: number) => new Date(Date.parse(manifest.startedAt) + ms).toISOString();
    const subject = { captureIndex: 0, capturedAt: timestamp(at),
      endedAt: end === null ? null : timestamp(end), mediaType: 'image/png', bytes: Buffer.from('slot') };
    const files = readdirSync(dir);
    expect(() => store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, subject)))
      .toThrow(/capture slot/);
    expect(store.events(manifest.perspectiveId)).toHaveLength(1);
    expect(readdirSync(dir)).toEqual(files);
  });

  test.each([500, 2500, 3000])('counts the final partial interval for duration %i', (durationMs) => {
    const { store } = state();
    const input = nativeStageInput();
    input.captureSchedule.boundary.durationMs = durationMs;
    const { commitmentHash: _hash, ...material } = input.captureSchedule;
    input.captureSchedule.commitmentHash = computePortholeScheduleCommitment(material);
    const manifest = store.start(input);
    const count = Math.ceil(durationMs / 1000);
    for (let captureIndex = 0; captureIndex < count; captureIndex += 1) {
      const end = Math.min((captureIndex + 1) * 1000, durationMs);
      store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
        captureIndex,
        capturedAt: new Date(Date.parse(manifest.startedAt) + end - 1).toISOString(),
        endedAt: new Date(Date.parse(manifest.startedAt) + end).toISOString(),
        mediaType: 'image/png', bytes: Buffer.from(`partial-${captureIndex}`),
      }, `privacy_partial_${captureIndex}`));
    }
    expect(store.complete(manifest.perspectiveId, { stopReason: 'operator',
      closedAt: new Date(Date.parse(manifest.startedAt) + durationMs).toISOString(),
    })).toMatchObject({ status: 'complete', expectedCaptureCount: count, missingCaptureCount: 0 });
    expect(store.verifyReceipt(manifest.perspectiveId).valid).toBe(true);
  });

  test('gaps consume exactly one slot and cannot cover another interval', () => {
    const { store } = state();
    const manifest = startNativeStage(store, 3);
    for (const [at, durationMs] of [[0, 1001], [1000, 0], [999, 2]]) {
      expect(() => store.appendGap(manifest.perspectiveId, { captureIndex: 0,
        occurredAt: new Date(Date.parse(manifest.startedAt) + at).toISOString(), durationMs, reason: 'unknown',
      })).toThrow(/capture slot/);
      expect(store.events(manifest.perspectiveId)).toHaveLength(1);
    }
    store.appendGap(manifest.perspectiveId, { captureIndex: 0, occurredAt: manifest.startedAt,
      durationMs: 1000, reason: 'unknown' });
    expect(() => store.appendGap(manifest.perspectiveId, { captureIndex: 1,
      occurredAt: manifest.startedAt, reason: 'unknown' })).toThrow(/capture slot/);
    store.appendGap(manifest.perspectiveId, { captureIndex: 1,
      occurredAt: '2026-08-30T18:00:01.000Z', durationMs: 1000, reason: 'unknown' });
    expect(store.complete(manifest.perspectiveId, { stopReason: 'operator',
      closedAt: '2026-08-30T18:00:03.000Z',
    })).toMatchObject({ status: 'failed', declaredGapCount: 2, missingCaptureCount: 1 });
  });

  test.each(['burst', 'swapped', 'end spill', 'exclusive endpoint'])(
    'revalidates %s stored gaps despite a valid chain and freshly signed receipt', (variant) => {
      const { db, store } = state();
      const manifest = startNativeStage(store, 2);
      for (let captureIndex = 0; captureIndex < 2; captureIndex += 1) {
        store.appendGap(manifest.perspectiveId, { captureIndex,
          occurredAt: new Date(Date.parse(manifest.startedAt) + captureIndex * 1000).toISOString(),
          durationMs: 0, reason: 'unknown' });
      }
      store.complete(manifest.perspectiveId, { stopReason: 'operator', closedAt: '2026-08-30T18:00:02.000Z' });
      expect(store.verifyReceipt(manifest.perspectiveId).valid).toBe(true);
      const stream = store.events(manifest.perspectiveId);
      const gaps = stream.filter((event) => event.kind === 'capture-gap');
      if (variant === 'burst') gaps[1].occurredAt = manifest.startedAt;
      if (variant === 'swapped') [gaps[0].occurredAt, gaps[1].occurredAt] = [gaps[1].occurredAt, gaps[0].occurredAt];
      if (variant === 'end spill') gaps[0].payload.durationMs = 1001;
      if (variant === 'exclusive endpoint') gaps[1].occurredAt = '2026-08-30T18:00:02.000Z';
      for (const gap of gaps) gap.payload.occurredAt = gap.occurredAt;

      // Synthetic database-owner corruption only: production UPDATE/DELETE
      // remains trigger-blocked. Rehash and re-sign to isolate timing checks
      // from hash/signature validation, simulating an invalid legacy writer.
      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'porthole_events'")
        .all() as Array<{ name: string }>;
      for (const { name } of triggers) db.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
      const hash = (value: unknown) => `sha256:${createHash('sha256').update(canonicalTestJson(value)).digest('hex')}`;
      let prior: string | null = null;
      let signedReceipt: PortholeCompletenessReceipt | undefined;
      for (const event of stream) {
        event.prevHash = prior;
        if (event.kind === 'completeness-receipt-issued') {
          const receipt = event.payload as unknown as PortholeCompletenessReceipt;
          receipt.chainHeadHash = prior as string;
          receipt.streamBoundary.terminalEventCommitment = prior as string;
          const { signature: _signature, contentHash: _contentHash, ...unsigned } = receipt;
          receipt.contentHash = hash({ domain: 'pd.porthole.completeness-receipt-content.v1', receipt: unsigned });
          const message = portholeCompletenessReceiptSigningMessage({ ...unsigned, contentHash: receipt.contentHash });
          receipt.signature.value = cryptoSign(null, message, devicePair.privateKey).toString('base64url');
          expect(cryptoVerify(null, message, devicePair.publicKey, Buffer.from(receipt.signature.value, 'base64url'))).toBe(true);
          message.fill(0);
          signedReceipt = receipt;
        }
        const { eventId, perspectiveId, ordinal, kind, occurredAt, payload, prevHash } = event;
        prior = hash({ eventId, perspectiveId, ordinal, kind, occurredAt, payload, prevHash });
        db.prepare('UPDATE porthole_events SET occurred_at = ?, payload_json = ?, prev_hash = ?, content_hash = ? WHERE event_id = ?')
          .run(occurredAt, canonicalTestJson(payload), prevHash, prior, eventId);
      }
      expect(signedReceipt).toBeDefined();
      expect(store.verifyChain(manifest.perspectiveId)).toEqual({ valid: true, checked: 5 });
      expect(store.verifyReceipt(manifest.perspectiveId)).toEqual({ valid: false, error: 'receipt-invalid' });
      expect(store.verifyEvidence(manifest.perspectiveId)).toMatchObject({ valid: false, chronologyValid: false,
        chain: { valid: true }, invalidCiphertextCount: 0 });
      expect(() => store.list()).toThrow(/invalid signed receipt/);
      expect(() => store.complete(manifest.perspectiveId, { stopReason: 'operator' })).toThrow(/different receipt/);
    },
  );

  test('seals arbitrary GUI pixels and semantic anchors before blob persistence', () => {
    const { store, dir } = state();
    const manifest = startNativeStage(store);
    const perspectiveSchema = frozenSchema('porthole-perspective');
    expectExactRequiredKeys(manifest, perspectiveSchema.required);
    expectExactRequiredKeys(manifest.actor, perspectiveSchema.properties.actor.required ?? []);
    expectExactRequiredKeys(manifest.surface, perspectiveSchema.properties.surface.required ?? []);
    expectExactRequiredKeys(
      manifest.surface.descriptor,
      perspectiveSchema.properties.surface.properties?.descriptor.required ?? [],
    );
    expectExactRequiredKeys(manifest.capture, perspectiveSchema.properties.capture.required ?? []);
    expectExactRequiredKeys(
      manifest.captureSchedule,
      perspectiveSchema.properties.captureSchedule.required ?? [],
    );
    expectExactRequiredKeys(
      manifest.captureSchedule.boundary,
      perspectiveSchema.properties.captureSchedule.properties?.boundary.required ?? [],
    );
    expectExactRequiredKeys(manifest.privacy, perspectiveSchema.properties.privacy.required ?? []);
    expectExactRequiredKeys(manifest.encryption, perspectiveSchema.properties.encryption.required ?? []);
    expectExactRequiredKeys(manifest.retention, perspectiveSchema.properties.retention.required ?? []);
    expect(manifest.surface.kind).toBe('native-app');
    expect(manifest.capture.adapter).toBe('pd-console-macos-window');
    expect(manifest.encryption).toMatchObject({
      suite: 'pd-vault-xchacha20-poly1305-v1',
      keyCustody: 'in-memory-test',
    });
    expect(manifest.surface.descriptor).toEqual({
      state: 'sealed',
      envelopeRef: `sealed-descriptor:${manifest.perspectiveId}`,
      commitment: `sha256:${'1'.repeat(64)}`,
    });
    const publicStart = JSON.stringify(store.events(manifest.perspectiveId)[0].payload);
    expect(publicStart).not.toContain('mac-window:8842');
    expect(publicStart).not.toContain('CheckoutPreview');
    expect(publicStart).not.toContain('Checkout');

    const visibleBytes = Buffer.from('PNG_BYTES_WITH_CHECKOUT_BUTTON');
    const firstSubject = {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: visibleBytes,
      semanticOverlay: {
        adapter: 'macos-ax',
        nodes: [{ role: 'AXButton', name: 'Place order', stableId: 'checkout.submit' }],
      },
      viewport: { width: 1280, height: 800, scale: 2 },
      sourceRef: { pid: 7712, windowId: 8842 },
    };
    const first = store.appendSegment(
      manifest.perspectiveId,
      attestedSegment(manifest, firstSubject),
    );
    expect(first.duplicate).toBe(false);

    const blobFiles = readdirSync(dir).filter((name) => /^[0-9a-f]{64}$/.test(name));
    expect(blobFiles).toHaveLength(1);
    const ciphertext = readFileSync(join(dir, blobFiles[0]));
    expect(ciphertext.includes(Buffer.from('CHECKOUT_BUTTON'))).toBe(false);
    expect(ciphertext.includes(Buffer.from('Place order'))).toBe(false);

    const segmentEvent = store.events(manifest.perspectiveId).find(
      (event) => event.kind === 'segment-recorded',
    );
    expect(segmentEvent).toBeDefined();
    expect(segmentEvent?.payload).not.toHaveProperty('plaintextHash');
    expect(segmentEvent?.payload).not.toHaveProperty('mediaBase64');
    expect(segmentEvent?.payload).not.toHaveProperty('semanticOverlay');
    expect(segmentEvent?.payload).not.toHaveProperty('viewport');
    expect(segmentEvent?.payload).not.toHaveProperty('sourceRef');
    expect(segmentEvent?.payload).not.toHaveProperty('mediaType');
    expect(segmentEvent?.payload).not.toHaveProperty('dedupTag');
    expect(segmentEvent?.payload).not.toHaveProperty('privacyReceipt');
    expect(segmentEvent?.payload).not.toHaveProperty('privacyReceiptId');
    expect(segmentEvent?.payload).not.toHaveProperty('privacyPolicyId');
    const publicMetadata = JSON.stringify(segmentEvent?.payload);
    expect(publicMetadata).not.toContain('PNG_BYTES_WITH_CHECKOUT_BUTTON');
    expect(publicMetadata).not.toContain('Place order');
    expect(publicMetadata).not.toContain('checkout.submit');

    expect(store.readSegment(manifest.perspectiveId, 0)).toMatchObject({
      schema: 'pd.porthole.segment.v1',
      captureIndex: 0,
      mediaType: 'image/png',
      mediaBase64: visibleBytes.toString('base64'),
      semanticOverlay: {
        adapter: 'macos-ax',
        nodes: [{ role: 'AXButton', name: 'Place order', stableId: 'checkout.submit' }],
      },
    });
    expect(store.verifyChain(manifest.perspectiveId)).toEqual({ valid: true, checked: 2 });
  });

  test('is idempotent for retry-identical frames and rejects conflicting evidence', () => {
    const { store } = state();
    const manifest = startNativeStage(store, 2);
    const input = attestedSegment(manifest, {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('same-frame'),
    });
    const first = store.appendSegment(manifest.perspectiveId, input);
    expect(first.duplicate).toBe(false);
    const retry = store.appendSegment(manifest.perspectiveId, input);
    expect(retry.duplicate).toBe(true);
    expect(retry.event.eventId).toBe(first.event.eventId);
    expect(retry.event.payload).not.toHaveProperty('dedupTag');
    expect(store.events(manifest.perspectiveId)).toHaveLength(2);
    expect(() => store.appendSegment(manifest.perspectiveId, {
      ...input,
      bytes: Buffer.from('different-frame'),
    })).toThrow(/authority or stream binding/);
    expect(() => store.appendSegment(manifest.perspectiveId, {
      ...input,
      captureIndex: 1,
      capturedAt: '2026-08-30T18:00:01.000Z',
    })).toThrow(/authority or stream binding/);
    expect(() => store.appendSegment(manifest.perspectiveId, {
      ...input,
      capturedAt: '2026-08-30T18:00:00.500Z',
    })).toThrow(/authority or stream binding/);
    expect(() => store.appendSegment(manifest.perspectiveId, {
      ...input,
      endedAt: '2026-08-30T18:00:00.250Z',
    })).toThrow(/authority or stream binding/);
    expect(() => store.appendSegment(manifest.perspectiveId, {
      ...input,
      mediaType: 'image/jpeg',
    })).toThrow(/authority or stream binding/);
    expect(() => store.appendSegment(manifest.perspectiveId, {
      ...input,
      semanticOverlay: {
        adapter: 'macos-ax',
        nodes: [{ role: 'AXButton', name: 'Changed after attestation' }],
      },
    })).toThrow(/authority or stream binding/);
    expect(store.events(manifest.perspectiveId)).toHaveLength(2);
    expect(store.verifyChain(manifest.perspectiveId)).toEqual({ valid: true, checked: 2 });
  });

  test('publishes no equality oracle for identical private evidence', () => {
    const first = state(Buffer.alloc(32, 1));
    const second = state(Buffer.alloc(32, 2));
    const firstManifest = startNativeStage(first.store);
    const secondManifest = startNativeStage(second.store);
    const subject = {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('same-private-frame'),
      semanticOverlay: {
        adapter: 'macos-ax',
        nodes: [{ role: 'AXSecureTextField', name: 'Secret value' }],
      },
    };

    const firstEvent = first.store.appendSegment(
      firstManifest.perspectiveId,
      attestedSegment(firstManifest, subject, 'privacy_equality_first'),
    ).event;
    const secondEvent = second.store.appendSegment(
      secondManifest.perspectiveId,
      attestedSegment(secondManifest, subject, 'privacy_equality_second'),
    ).event;
    expect(firstEvent.payload).not.toHaveProperty('dedupTag');
    expect(secondEvent.payload).not.toHaveProperty('dedupTag');
    expect(firstEvent.payload.ciphertextBlobId).not.toBe(secondEvent.payload.ciphertextBlobId);

    for (const event of [firstEvent, secondEvent]) {
      const publicMetadata = JSON.stringify(event.payload);
      expect(publicMetadata).not.toContain('same-private-frame');
      expect(publicMetadata).not.toContain('Secret value');
      expect(event.payload).not.toHaveProperty('plaintextHash');
      expect(event.payload).not.toHaveProperty('dedupTag');
    }

    first.store.complete(firstManifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    });
    second.store.complete(secondManifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    });
    const forbiddenPublicKeys = [
      'plaintextHash',
      'dedupTag',
      'plaintextByteCount',
      'ciphertextByteCount',
      'mediaBase64',
      'semanticOverlay',
      'viewport',
      'sourceRef',
      'wrappedKey',
      'keyDescriptor',
      'keyMaterial',
      'secret',
    ];
    for (const publicLedger of [
      JSON.stringify(first.store.events(firstManifest.perspectiveId)),
      JSON.stringify(second.store.events(secondManifest.perspectiveId)),
    ]) {
      for (const key of forbiddenPublicKeys) {
        expect(publicLedger).not.toContain(`"${key}"`);
      }
      expect(publicLedger).not.toContain('same-private-frame');
      expect(publicLedger).not.toContain('Secret value');
      expect(publicLedger).not.toContain('CheckoutPreview');
    }
  });

  test('accepts only JSON-safe adapter extensions so serialization cannot invalidate the chain', () => {
    const valid = state();
    const validManifest = valid.store.start({
      ...nativeStageInput('pov_json_safe_capture'),
      capture: {
        ...nativeStageInput().capture,
        clockCalibration: { source: 'mach-continuous-time', skewMs: 0 },
      },
    });
    expect(valid.store.verifyChain(validManifest.perspectiveId)).toEqual({
      valid: true,
      checked: 1,
    });

    class RewritingCaptureValue {
      readonly value = 'canonical-shape';

      toJSON() {
        return { value: 'different-serialized-shape' };
      }
    }

    const invalidValues: unknown[] = [
      new Date('2026-08-30T18:00:00.000Z'),
      new RewritingCaptureValue(),
      {
        value: 'plain-object',
        toJSON: () => ({ value: 'rewritten-plain-object' }),
      },
      Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => 'not-json',
      Object.assign([], { extra: 'discarded' }),
      [1, , 3],
      Object.assign({}, { [Symbol('hidden')]: 'discarded' }),
      Object.defineProperty({}, 'hidden', { value: 'discarded', enumerable: false }),
    ];
    let accessorCalls = 0;
    invalidValues.push(Object.defineProperty({}, 'value', { enumerable: true,
      get() { accessorCalls += 1; return 'must-not-execute'; } }));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    invalidValues.push(cyclic);
    for (const [index, invalidValue] of invalidValues.entries()) {
      const invalid = state();
      expect(() => invalid.store.start({
        ...nativeStageInput(`pov_non_json_capture_${index}`),
        capture: {
          ...nativeStageInput().capture,
          adapterExtension: invalidValue,
        },
      })).toThrow(expect.objectContaining({ code: 'PORTHOLE_VALIDATION' }));
      expect(invalid.db.prepare('SELECT count(*) AS count FROM porthole_events').get()).toEqual({
        count: 0,
      });
    }
    expect(accessorCalls).toBe(0);
  });

  test('fails closed without an exact-target privacy receipt or with background capture', () => {
    const missing = state();
    const missingManifest = startNativeStage(missing.store);
    const inputWithoutReceipt = {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('unattested-frame'),
    } as Parameters<typeof missing.store.appendSegment>[1];
    expect(() => missing.store.appendSegment(
      missingManifest.perspectiveId,
      inputWithoutReceipt,
    )).toThrow(expect.objectContaining({ code: 'PORTHOLE_VALIDATION' }));
    expect(missing.store.events(missingManifest.perspectiveId)).toHaveLength(1);
    expect(missing.store.verifyChain(missingManifest.perspectiveId)).toEqual({
      valid: true,
      checked: 1,
    });

    const background = state();
    const backgroundManifest = startNativeStage(background.store);
    const backgroundSubject = {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('frame-with-background-media'),
    };
    const backgroundIncluded = {
      ...privacyReceipt(
        backgroundManifest,
        'privacy_background_included',
        'passed',
        backgroundSubject,
      ),
      backgroundDisposition: 'included',
    } as unknown as PortholePrivacyReceipt;
    expect(() => background.store.appendSegment(backgroundManifest.perspectiveId, {
      ...backgroundSubject,
      privacyReceipt: backgroundIncluded,
    })).toThrow(expect.objectContaining({ code: 'PORTHOLE_VALIDATION' }));
    expect(background.store.events(backgroundManifest.perspectiveId)).toHaveLength(1);
    expect(background.store.verifyChain(backgroundManifest.perspectiveId)).toEqual({
      valid: true,
      checked: 1,
    });
  });

  test('records quarantined evidence but never attests it complete', () => {
    const { store } = state();
    const manifest = startNativeStage(store);
    store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('quarantined-before-persistence'),
    }, 'privacy_quarantined_001', 'quarantined'));
    expect(store.complete(manifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    }).status).toBe('failed');
    expect(store.verifyEvidence(manifest.perspectiveId)).toEqual({
      valid: false,
      chronologyValid: true,
      chain: { valid: true, checked: 4 },
      checkedSegmentCount: 1,
      missingCiphertextCount: 0,
      invalidCiphertextCount: 0,
      quarantinedSegmentCount: 1,
      issues: [{ captureIndex: 0, code: 'privacy-quarantined' }],
    });
  });

  test('cannot attest complete when referenced ciphertext is missing or unauthentic', () => {
    const missing = state();
    const missingManifest = startNativeStage(missing.store);
    const missingEvent = missing.store.appendSegment(missingManifest.perspectiveId, attestedSegment(
      missingManifest,
      {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('ciphertext-that-will-go-missing'),
      },
      'privacy_missing_ciphertext',
    )).event;
    expect(missing.blobs.delete(String(missingEvent.payload.ciphertextBlobId))).toBe(true);
    expect(missing.store.complete(missingManifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    }).status).toBe('failed');

    const tampered = state();
    const tamperedManifest = startNativeStage(tampered.store);
    const tamperedEvent = tampered.store.appendSegment(tamperedManifest.perspectiveId, attestedSegment(
      tamperedManifest,
      {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('ciphertext-that-will-be-tampered'),
      },
      'privacy_tampered_ciphertext',
    )).event;
    const blobPath = join(tampered.dir, String(tamperedEvent.payload.ciphertextBlobId));
    const tamperedBytes = readFileSync(blobPath);
    tamperedBytes[0] ^= 0xff;
    writeFileSync(blobPath, tamperedBytes);
    expect(tampered.store.complete(tamperedManifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    }).status).toBe('failed');
  });

  test('reports ciphertext loss that occurs after a complete receipt', () => {
    const { blobs, store } = state();
    const manifest = startNativeStage(store);
    const segment = store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('initially-valid-ciphertext'),
    }, 'privacy_post_completion_loss')).event;
    expect(store.complete(manifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    }).status).toBe('complete');
    expect(blobs.delete(String(segment.payload.ciphertextBlobId))).toBe(true);

    expect(store.verifyEvidence(manifest.perspectiveId)).toEqual({
      valid: false,
      chronologyValid: true,
      chain: { valid: true, checked: 4 },
      checkedSegmentCount: 1,
      missingCiphertextCount: 1,
      invalidCiphertextCount: 0,
      quarantinedSegmentCount: 0,
      issues: [{ captureIndex: 0, code: 'ciphertext-missing' }],
    });
  });

  test('derives completeness from the committed schedule and verifies the device signature', () => {
    const { db, blobs, store } = state();
    const manifest = startNativeStage(store);
    store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('signed-completeness-frame'),
    }, 'privacy_signed_receipt'));

    const receipt = store.complete(manifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    });
    const receiptSchema = frozenSchema('porthole-completeness-receipt');
    expectExactRequiredKeys(receipt, receiptSchema.required);
    expectExactRequiredKeys(receipt.schedule, receiptSchema.properties.schedule.required ?? []);
    expectExactRequiredKeys(
      receipt.streamBoundary,
      receiptSchema.properties.streamBoundary.required ?? [],
    );
    expectExactRequiredKeys(receipt.issuer, receiptSchema.properties.issuer.required ?? []);
    expectExactRequiredKeys(receipt.signature, receiptSchema.properties.signature.required ?? []);
    expect(receipt).toMatchObject({
      stageId: manifest.stageId,
      expectedCaptureCount: 1,
      schedule: {
        scheduleId: manifest.captureSchedule.scheduleId,
        commitmentHash: manifest.captureSchedule.commitmentHash,
      },
      streamBoundary: {
        streamId: manifest.streamId,
        channelId: manifest.encryption.channelId,
        firstCaptureIndex: 0,
        lastCaptureIndex: 0,
      },
      issuer: {
        harborId: manifest.harborId,
        bodyId: manifest.bodyId,
        participantId: manifest.participantId,
        signingKeyId: DEVICE_KEY_ID,
      },
      signature: { algorithm: 'ed25519', keyId: DEVICE_KEY_ID },
    });
    expect(receipt.chainHeadHash).toBe(receipt.streamBoundary.terminalEventCommitment);
    expect(store.verifyReceipt(manifest.perspectiveId)).toEqual({ valid: true });
    const { signature, ...signed } = receipt;
    const message = portholeCompletenessReceiptSigningMessage(signed);
    try {
      expect(cryptoVerify(
        null,
        message,
        devicePair.publicKey,
        Buffer.from(signature.value, 'base64url'),
      )).toBe(true);
    } finally {
      message.fill(0);
    }
    const untrustedReader = createPortholeStore({
      db,
      blobs,
      secrets: createInMemoryPortholeSecretProvider(Buffer.alloc(32, 9)),
      signatureAuthority: {
        ...signatureAuthority,
        verifyCompleteness: () => false,
      },
      receiptSigner,
    });
    expect(untrustedReader.verifyReceipt(manifest.perspectiveId)).toEqual({
      valid: false,
      error: 'receipt-invalid',
    });
  });

  test('invalidates a signed receipt when a correctly chained event follows its exact boundary', () => {
    const { db, store } = state();
    const manifest = startNativeStage(store);
    store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('final-boundary-frame'),
    }, 'privacy_final_boundary'));
    const receipt = store.complete(manifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    });
    const receiptEvent = store.events(manifest.perspectiveId).at(-1);
    expect(receiptEvent?.kind).toBe('completeness-receipt-issued');
    const payload = {
      schema: 'pd.porthole.capture-gap.v1',
      perspectiveId: manifest.perspectiveId,
      captureIndex: 1,
      occurredAt: receipt.issuedAt,
      durationMs: null,
      reason: 'unknown',
      detailState: 'none',
    };
    const tail = {
      eventId: `porthole:${manifest.perspectiveId}:forged-tail`,
      perspectiveId: manifest.perspectiveId,
      ordinal: Number(receiptEvent?.ordinal) + 1,
      kind: 'capture-gap',
      occurredAt: receipt.issuedAt,
      payload,
      prevHash: receiptEvent?.contentHash ?? null,
    };
    const tailHash = `sha256:${createHash('sha256')
      .update(canonicalTestJson(tail))
      .digest('hex')}`;
    db.prepare(`
      INSERT INTO porthole_events (
        event_id, perspective_id, ordinal, kind, occurred_at, payload_json, content_hash, prev_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tail.eventId,
      tail.perspectiveId,
      tail.ordinal,
      tail.kind,
      tail.occurredAt,
      canonicalTestJson(payload),
      tailHash,
      tail.prevHash,
    );
    expect(store.verifyChain(manifest.perspectiveId)).toEqual({ valid: true, checked: 5 });
    expect(store.verifyReceipt(manifest.perspectiveId)).toEqual({
      valid: false,
      error: 'receipt-invalid',
    });
    expect(() => store.list()).toThrow(/invalid signed receipt/);
  });

  test('rejects an Ed25519-valid completeness signature for an unauthorized participant', () => {
    const contextCheckedAuthority: PortholeVerifiedSignatureAuthority = {
      verifyPrivacy: (context, message, signature) =>
        context.claimedKeyId === PRIVACY_KEY_ID &&
        cryptoVerify(null, message, privacyPair.publicKey, signature),
      verifyCompleteness: (context, message, signature) =>
        trustedParticipantContext(context) &&
        context.claimedKeyId === DEVICE_KEY_ID &&
        cryptoVerify(null, message, devicePair.publicKey, signature),
    };
    const contextCheckedDevice: PortholeReceiptSigner = {
      signingKeyId: DEVICE_KEY_ID,
      // Simulate key custody returning a mathematically valid signature while
      // the trusted device registry refuses this body/participant context.
      sign: (_context, message) => cryptoSign(null, message, devicePair.privateKey),
    };
    const { store } = state(Buffer.alloc(32, 9), {
      signatureAuthority: contextCheckedAuthority,
      receiptSigner: contextCheckedDevice,
    });
    const manifest = store.start({
      ...nativeStageInput('pov_unauthorized_participant'),
      participantId: 'agent_untrusted_participant',
    });
    store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('valid-signature-wrong-authority-context'),
    }, 'privacy_untrusted_participant'));
    expect(() => store.complete(manifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:02.000Z',
    })).toThrow(/failed local content-hash or Ed25519 verification/);
    expect(store.events(manifest.perspectiveId)).toHaveLength(2);
  });

  test('enforces the committed chronology before persistence and completion', () => {
    const preStart = state();
    const preStartManifest = startNativeStage(preStart.store, 2);
    expect(() => preStart.store.appendSegment(
      preStartManifest.perspectiveId,
      attestedSegment(preStartManifest, {
        captureIndex: 0,
        capturedAt: '2026-08-30T17:59:59.999Z',
        mediaType: 'image/png',
        bytes: Buffer.from('pre-start-frame'),
      }, 'privacy_pre_start'),
    )).toThrow(/precedes the perspective opening/);
    expect(preStart.store.events(preStartManifest.perspectiveId)).toHaveLength(1);

    const postBoundary = state();
    const postBoundaryManifest = startNativeStage(postBoundary.store, 2);
    expect(() => postBoundary.store.appendSegment(
      postBoundaryManifest.perspectiveId,
      attestedSegment(postBoundaryManifest, {
        captureIndex: 0,
        capturedAt: '2026-08-30T18:00:02.001Z',
        mediaType: 'image/png',
        bytes: Buffer.from('post-boundary-frame'),
      }, 'privacy_post_boundary'),
    )).toThrow(/exceeds the committed fixed-duration boundary/);

    const decreasing = state();
    const decreasingManifest = startNativeStage(decreasing.store, 2);
    decreasing.store.appendSegment(decreasingManifest.perspectiveId, attestedSegment(
      decreasingManifest,
      {
        captureIndex: 0,
        capturedAt: '2026-08-30T18:00:00.500Z',
        mediaType: 'image/png',
        bytes: Buffer.from('later-first-frame'),
      },
      'privacy_later_first',
    ));
    expect(() => decreasing.store.appendSegment(
      decreasingManifest.perspectiveId,
      attestedSegment(decreasingManifest, {
        captureIndex: 1,
        capturedAt: '2026-08-30T18:00:00.000Z',
        mediaType: 'image/png',
        bytes: Buffer.from('earlier-second-frame'),
      }, 'privacy_earlier_second'),
    )).toThrow(/timestamps must be monotonic/);
    expect(() => decreasing.store.complete(decreasingManifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:01.000Z',
    })).toThrow(/closed before its committed boundary/);

    const gap = state();
    const gapManifest = startNativeStage(gap.store);
    expect(() => gap.store.appendGap(gapManifest.perspectiveId, {
      captureIndex: 0,
      occurredAt: '2026-08-30T18:00:01.000Z',
      durationMs: 1,
      reason: 'adapter-error',
    })).toThrow(/exceeds the committed fixed-duration boundary/);
  });

  test('rejects impossible RFC 3339 calendar and clock values before signing', () => {
    for (const [suffix, startedAt] of [
      ['impossible_day', '2026-02-31T18:00:00.000Z'],
      ['impossible_hour', '2026-08-30T24:00:00.000Z'],
    ] as const) {
      const { db, store } = state();
      expect(() => store.start({
        ...nativeStageInput(`pov_${suffix}`),
        startedAt,
      })).toThrow(/RFC 3339/);
      expect(db.prepare('SELECT count(*) AS count FROM porthole_events').get()).toEqual({ count: 0 });
    }

    const { store } = state();
    const manifest = startNativeStage(store);
    store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('valid-frame-before-invalid-close'),
    }, 'privacy_invalid_close'));
    expect(() => store.complete(manifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-02-31T18:00:01.000Z',
    })).toThrow(/RFC 3339/);
    expect(store.events(manifest.perspectiveId)).toHaveLength(2);
  });

  test('rejects schedule drift and unsupported capture modes before the first write', () => {
    const tampered = state();
    const tamperedInput = nativeStageInput('pov_schedule_tampered');
    expect(() => tampered.store.start({
      ...tamperedInput,
      captureSchedule: {
        ...tamperedInput.captureSchedule,
        commitmentHash: `sha256:${'0'.repeat(64)}`,
      },
    })).toThrow(/commitmentHash/);
    expect(tampered.store.list()).toEqual([]);

    const eventDriven = state();
    const base = nativeStageInput('pov_event_driven');
    const scheduleWithoutCommitment = {
      scheduleId: 'schedule_event_driven',
      mode: 'event-driven' as const,
      samplingIntervalMs: null,
      boundary: {
        kind: 'event-delimited' as const,
        durationMs: null,
        terminalEventKind: 'checkout-finished',
      },
      committedAt: '2026-08-30T17:59:59.000Z',
    };
    expect(() => eventDriven.store.start({
      ...base,
      captureSchedule: {
        ...scheduleWithoutCommitment,
        commitmentHash: computePortholeScheduleCommitment(
          scheduleWithoutCommitment as unknown as Parameters<typeof computePortholeScheduleCommitment>[0],
        ),
      },
    } as unknown as Parameters<typeof eventDriven.store.start>[0])).toThrow(/only fixed-interval/);
    expect(eventDriven.store.list()).toEqual([]);

    const operatorStop = state();
    const operatorBase = nativeStageInput('pov_operator_stop');
    const operatorSchedule = {
      scheduleId: 'schedule_operator_stop',
      mode: 'fixed-interval' as const,
      samplingIntervalMs: 1000,
      boundary: {
        kind: 'operator-stop' as const,
        durationMs: null,
        terminalEventKind: null,
      },
      committedAt: '2026-08-30T17:59:59.000Z',
    };
    expect(() => operatorStop.store.start({
      ...operatorBase,
      captureSchedule: {
        ...operatorSchedule,
        commitmentHash: computePortholeScheduleCommitment(
          operatorSchedule as unknown as Parameters<typeof computePortholeScheduleCommitment>[0],
        ),
      },
    } as unknown as Parameters<typeof operatorStop.store.start>[0])).toThrow(/only fixed-duration/);
    expect(operatorStop.store.list()).toEqual([]);
  });

  test('rejects a self-asserted privacy signing key outside the trusted pipeline authority', () => {
    const { store } = state();
    const manifest = startNativeStage(store);
    const roguePair = generateKeyPairSync('ed25519');
    const rogueSubject = {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('rogue-privacy-authority'),
    };
    const rogue = privacyReceipt(manifest, 'privacy_rogue_key', 'passed', rogueSubject);
    rogue.issuer.keyId = 'rogue-self-asserted-key';
    rogue.signature.keyId = 'rogue-self-asserted-key';
    const {
      contentHash: _trustedContentHash,
      signature: _trustedSignature,
      ...rogueContent
    } = rogue;
    rogue.contentHash = computePortholePrivacyReceiptContentHash(rogueContent);
    const message = portholePrivacyReceiptSigningMessage(rogue);
    try {
      rogue.signature.value = cryptoSign(null, message, roguePair.privateKey).toString('base64url');
    } finally {
      message.fill(0);
    }
    expect(() => store.appendSegment(manifest.perspectiveId, {
      ...rogueSubject,
      privacyReceipt: rogue,
    })).toThrow(/not authorized/);
    expect(store.events(manifest.perspectiveId)).toHaveLength(1);
  });

  test('requires explicit gaps and emits an honest partial completeness receipt', () => {
    const { db, store } = state();
    const manifest = startNativeStage(store, 3);
    const outOfOrderSubject = {
      captureIndex: 1,
      capturedAt: '2026-08-30T18:00:01.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('out-of-order-frame'),
    };
    expect(() => store.appendSegment(
      manifest.perspectiveId,
      attestedSegment(manifest, outOfOrderSubject, 'privacy_out_of_order'),
    )).toThrow(/Record an explicit capture-gap/);
    expect(() => store.appendGap(manifest.perspectiveId, {
      captureIndex: 0,
      occurredAt: '2026-08-30T18:00:01.000Z',
      reason: 'secret-session-token' as AppendGapInput['reason'],
    })).toThrow(/gap reason is invalid/);
    expect(store.events(manifest.perspectiveId)).toHaveLength(1);

    const gapInput = {
      captureIndex: 0,
      occurredAt: '2026-08-30T18:00:00.000Z',
      durationMs: 1000,
      reason: 'permission-denied' as const,
      detail: 'Screen Recording permission was revoked.',
    };
    const firstGap = store.appendGap(manifest.perspectiveId, gapInput);
    expect(firstGap.event.payload).toMatchObject({ detailState: 'withheld' });
    expect(JSON.stringify(firstGap.event.payload)).not.toContain('permission was revoked');
    expect(store.appendGap(manifest.perspectiveId, gapInput).duplicate).toBe(true);
    expect(() => store.appendGap(manifest.perspectiveId, {
      ...gapInput,
      reason: 'adapter-error',
    })).toThrow(PortholeError);
    store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 1,
      capturedAt: '2026-08-30T18:00:01.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('recovered-frame'),
    }, 'privacy_recovered'));
    const receipt = store.complete(manifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:03.000Z',
    });
    expect(receipt).toMatchObject({
      status: 'partial',
      expectedCaptureCount: 3,
      recordedSegmentCount: 1,
      declaredGapCount: 1,
      missingCaptureCount: 1,
      stopReason: 'operator',
    });
    expect(store.verifyChain(manifest.perspectiveId)).toEqual({ valid: true, checked: 5 });
    expect(store.complete(manifest.perspectiveId, {
      stopReason: 'operator',
      closedAt: '2026-08-30T18:00:03.000Z',
    })).toEqual(receipt);
    expect(() => store.complete(manifest.perspectiveId, {
      stopReason: 'session-ended',
    })).toThrow(PortholeError);
    expect(() => store.appendGap(manifest.perspectiveId, {
      captureIndex: 4,
      reason: 'unknown',
    })).toThrow(/is complete/);
    expect(() => store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 4,
      capturedAt: '2026-08-30T18:00:04.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('late-frame'),
    }, 'privacy_late'))).toThrow(/is complete/);

    const beforeHostileSql = store.events(manifest.perspectiveId);
    const triggers = db.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'porthole_events' ORDER BY name",
    ).all() as Array<{ name: string; sql: string }>;
    expect(triggers).toHaveLength(3);
    expect(triggers.find(({ name }) => name === 'porthole_events_no_update')?.sql)
      .toMatch(/BEFORE UPDATE[\s\S]*RAISE\(ABORT, 'porthole_events is append-only'\)/i);
    expect(triggers.find(({ name }) => name === 'porthole_events_no_delete')?.sql)
      .toMatch(/BEFORE DELETE[\s\S]*RAISE\(ABORT, 'porthole_events is append-only'\)/i);
    expect(triggers.find(({ name }) => name === 'porthole_events_no_replace')?.sql)
      .toMatch(/BEFORE INSERT[\s\S]*RAISE\(ABORT, 'porthole_events is append-only'\)/i);
    expect(() => db.prepare('UPDATE porthole_events SET kind = ? WHERE perspective_id = ?')
      .run('forged', manifest.perspectiveId)).toThrow(/porthole_events is append-only/);
    expect(() => db.prepare('DELETE FROM porthole_events WHERE perspective_id = ?')
      .run(manifest.perspectiveId)).toThrow(/porthole_events is append-only/);
    expect(store.events(manifest.perspectiveId)).toEqual(beforeHostileSql);
  });

  test.each([false, true])('rejects SQL replacement across every ledger identity with recursive triggers %s', (recursive) => {
    const { db, store } = state();
    const manifest = startNativeStage(store);
    db.pragma(`recursive_triggers = ${recursive ? 'ON' : 'OFF'}`);
    const snapshot = db.prepare('SELECT * FROM porthole_events ORDER BY event_seq').all() as Array<Record<string, unknown>>;
    const original = snapshot[0];
    const columns = Object.keys(original);
    const replacements = [
      { event_seq: original.event_seq },
      { event_id: original.event_id },
      { perspective_id: original.perspective_id, ordinal: original.ordinal },
    ];
    for (const collision of replacements) {
      const candidate = {
        ...original,
        event_seq: 10000,
        event_id: 'forged-replacement-event',
        perspective_id: 'forged-replacement-perspective',
        ordinal: 10000,
        kind: 'forged',
        ...collision,
      };
      for (const verb of ['INSERT OR REPLACE', 'REPLACE']) {
        expect(() => db.prepare(`${verb} INTO porthole_events (${columns.join(',')})
          VALUES (${columns.map(() => '?').join(',')})`)
          .run(...columns.map((column) => candidate[column])))
          .toThrow(/porthole_events is append-only/);
        expect(db.prepare('SELECT * FROM porthole_events ORDER BY event_seq').all()).toEqual(snapshot);
      }
    }
    expect(() => db.prepare(`INSERT INTO porthole_events (${columns.join(',')})
      VALUES (${columns.map(() => '?').join(',')})
      ON CONFLICT(event_id) DO UPDATE SET kind = 'forged'`)
      .run(...columns.map((column) => original[column])))
      .toThrow(/porthole_events is append-only/);
    expect(db.prepare('SELECT * FROM porthole_events ORDER BY event_seq').all()).toEqual(snapshot);
    expect(store.verifyChain(manifest.perspectiveId)).toEqual({ valid: true, checked: snapshot.length });
  });

  test('rolls back an entire hostile replacement statement while preserving its surrounding transaction', () => {
    const { db, store } = state();
    startNativeStage(store);
    db.pragma('recursive_triggers = OFF');
    const snapshot = db.prepare('SELECT * FROM porthole_events ORDER BY event_seq').all() as Array<Record<string, unknown>>;
    const original = snapshot[0];
    const columns = Object.keys(original);
    const fresh = {
      ...original,
      event_seq: 10000,
      event_id: 'would-be-new-event',
      perspective_id: 'would-be-new-perspective',
      ordinal: 0,
    };
    db.exec('CREATE TABLE transaction_probe (value TEXT NOT NULL)');
    db.transaction(() => {
      db.prepare('INSERT INTO transaction_probe VALUES (?)').run('before-abort');
      const values = `(${columns.map(() => '?').join(',')})`;
      expect(() => db.prepare(`INSERT OR REPLACE INTO porthole_events (${columns.join(',')})
        VALUES ${values}, ${values}`)
        .run(...columns.map((column) => fresh[column]), ...columns.map((column) => original[column])))
        .toThrow(/porthole_events is append-only/);
      expect(db.inTransaction).toBe(true);
      expect(db.prepare('SELECT * FROM porthole_events ORDER BY event_seq').all()).toEqual(snapshot);
      db.prepare('INSERT INTO transaction_probe VALUES (?)').run('after-abort');
    })();
    expect(db.prepare('SELECT value FROM transaction_probe ORDER BY rowid').all()).toEqual([
      { value: 'before-abort' }, { value: 'after-abort' },
    ]);
  });

  test('validates a strict pd-vault SealAad envelope before blob ingestion', () => {
    const expected = {
      perspectiveId: 'pov_pre_ingestion',
      captureIndex: 7,
      harborId: 'harbor_local',
      channelId: 'porthole:pov_pre_ingestion',
      epoch: 1,
    };
    const envelope = {
      schema: 'pd.porthole.ciphertext-envelope.v1' as const,
      perspectiveId: expected.perspectiveId,
      captureIndex: expected.captureIndex,
      encryptionSuite: 'pd-vault-xchacha20-poly1305-v1' as const,
      aad: {
        harborId: expected.harborId,
        channelId: expected.channelId,
        epoch: expected.epoch,
        seq: expected.captureIndex,
      },
      nonceBase64url: Buffer.alloc(24, 1).toString('base64url'),
      ciphertextBase64: Buffer.alloc(17, 2).toString('base64'),
    };
    expect(validatePortholeCiphertextEnvelope(envelope, expected)).toBe(envelope);

    for (const invalid of [
      { ...envelope, unexpected: 'plaintext-title' },
      { ...envelope, aad: { ...envelope.aad, stageId: 'stage_unbound' } },
      { ...envelope, aad: { ...envelope.aad, harborId: 'harbor_other' } },
      { ...envelope, aad: { ...envelope.aad, channelId: 'porthole:pov_other' } },
      { ...envelope, aad: { ...envelope.aad, epoch: 2 } },
      { ...envelope, aad: { ...envelope.aad, seq: 8 } },
      { ...envelope, nonceBase64url: Buffer.alloc(23, 1).toString('base64url') },
      { ...envelope, nonceBase64url: ` ${envelope.nonceBase64url} ` },
      { ...envelope, nonceBase64url: `${envelope.nonceBase64url}=` },
      { ...envelope, ciphertextBase64: Buffer.alloc(16, 2).toString('base64') },
      { ...envelope, ciphertextBase64: ` ${envelope.ciphertextBase64}\n` },
      { ...envelope, ciphertextBase64: envelope.ciphertextBase64.replace(/=+$/, '') },
      { ...envelope, encryptionSuite: 'aes-gcm' },
      { ...envelope, schema: 'unknown' },
      { ...envelope, captureIndex: '7' },
      { ...envelope, captureIndex: -1 },
      { ...envelope, aad: { ...envelope.aad, epoch: 1.5 } },
      { ...envelope, toJSON: () => envelope },
    ]) {
      expect(() => validatePortholeCiphertextEnvelope(invalid, expected))
        .toThrow(expect.objectContaining({ code: 'PORTHOLE_VALIDATION' }));
    }

    // Equality to caller-supplied routing is not evidence of correct types.
    // Keep malformed matching pairs from validating each other.
    for (const invalid of ['', ' ', 7, null]) {
      for (const field of ['harborId', 'channelId'] as const) {
        expect(() => validatePortholeCiphertextEnvelope(
          { ...envelope, aad: { ...envelope.aad, [field]: invalid } },
          { ...expected, [field]: invalid } as typeof expected,
        )).toThrow(expect.objectContaining({ code: 'PORTHOLE_VALIDATION' }));
      }
      expect(() => validatePortholeCiphertextEnvelope(
        { ...envelope, perspectiveId: invalid },
        { ...expected, perspectiveId: invalid } as typeof expected,
      )).toThrow(expect.objectContaining({ code: 'PORTHOLE_VALIDATION' }));
    }
  });

  test('fails closed when a different harbor key attempts to read a segment', () => {
    const { db, blobs, store } = state(Buffer.alloc(32, 1));
    const manifest = startNativeStage(store);
    store.appendSegment(manifest.perspectiveId, attestedSegment(manifest, {
      captureIndex: 0,
      capturedAt: '2026-08-30T18:00:00.000Z',
      mediaType: 'image/png',
      bytes: Buffer.from('confidential-frame'),
    }, 'privacy_wrong_key'));
    const wrongReader = createPortholeStore({
      db,
      blobs,
      secrets: createInMemoryPortholeSecretProvider(Buffer.alloc(32, 2)),
      signatureAuthority,
      receiptSigner,
    });
    expect(() => wrongReader.readSegment(manifest.perspectiveId, 0)).toThrow(
      expect.objectContaining({ code: 'PORTHOLE_DECRYPT_FAILED' }),
    );
  });

  test('rejects frozen-manifest identity and retention fields before any write', () => {
    const invalidFields: Array<[string, unknown]> = [
      ['bodyId', ''],
      ['bodyId', null],
      ['bodyId', undefined],
      ['bodyId', 77],
      ['runId', ''],
      ['parentPerspectiveId', ''],
      ['retentionPolicyId', ''],
    ];
    for (const [field, value] of invalidFields) {
      const { db, store } = state();
      expect(() => store.start({
        ...nativeStageInput(`pov_invalid_${field}_${String(value)}`),
        [field]: value,
      } as Parameters<typeof store.start>[0])).toThrow(PortholeError);
      expect(db.prepare('SELECT count(*) AS count FROM porthole_events').get()).toEqual({ count: 0 });
    }
  });

  test('refuses invisible capture at the contract boundary', () => {
    const { store } = state();
    expect(() => store.start({
      ...nativeStageInput('pov_hidden_capture'),
      capture: {
        adapter: 'hidden-recorder',
        adapterVersion: null,
        modalities: ['visual'],
        sourceClock: 'wall',
        visibleIndicator: false as true,
      },
    })).toThrow(/visible recording indicator/);
  });

  test('never replaces a root key when Keychain read state is ambiguous', () => {
    let createAttempts = 0;
    const provider = createKeychainPortholeSecretProvider({
      available: () => true,
      loadSecretResult: () => ({ status: 'error' }),
      saveSecretIfAbsent: () => {
        createAttempts += 1;
        return true;
      },
    });
    expect(() => provider.getHarborSecret('harbor_local')).toThrow(
      expect.objectContaining({ code: 'PORTHOLE_KEYSTORE_UNAVAILABLE' }),
    );
    expect(createAttempts).toBe(0);
  });

  test('atomically adopts a concurrently created root instead of overwriting it', () => {
    const winningRoot = Buffer.alloc(32, 4).toString('hex');
    let reads = 0;
    let candidate: string | null = null;
    const provider = createKeychainPortholeSecretProvider({
      available: () => true,
      loadSecretResult: () => {
        reads += 1;
        return reads === 1
          ? { status: 'missing' as const }
          : { status: 'found' as const, value: winningRoot };
      },
      saveSecretIfAbsent: (_service, _account, value) => {
        candidate = value;
        return false;
      },
    });
    const result = provider.getHarborSecret('harbor_local');
    expect(candidate).not.toBeNull();
    expect(candidate).not.toBe(winningRoot);
    expect(result.secret.toString('hex')).toBe(winningRoot);
    result.secret.fill(0);
  });

  test.each(['missing', 'error', 'unavailable', 'malformed', 'changed'])(
    'refuses %s root-key creation read-back without retrying a write', (outcome) => {
      let reads = 0;
      let writes = 0;
      const provider = createKeychainPortholeSecretProvider({
        available: () => true,
        loadSecretResult: () => {
          reads += 1;
          if (reads === 1) return { status: 'missing' };
          if (outcome === 'malformed' || outcome === 'changed') {
            return { status: 'found', value: outcome === 'malformed' ? 'not-a-root' : 'ab'.repeat(32) };
          }
          return { status: outcome as 'missing' | 'error' | 'unavailable' };
        },
        saveSecretIfAbsent: () => { writes += 1; return outcome !== 'malformed'; },
      });
      expect(() => provider.getHarborSecret('harbor_synthetic')).toThrow(
        expect.objectContaining({ code: 'PORTHOLE_KEYSTORE_UNAVAILABLE' }),
      );
      expect(reads).toBe(2);
      expect(writes).toBe(1);
    },
  );

  test('confirms successful create-only root and never aliases returned test key buffers', () => {
    let saved: string | undefined;
    const provider = createKeychainPortholeSecretProvider({
      available: () => true,
      loadSecretResult: () => saved === undefined ? { status: 'missing' } : { status: 'found', value: saved },
      saveSecretIfAbsent: (_service, _account, value) => { saved = value; return true; },
    });
    const first = provider.getHarborSecret('harbor_synthetic');
    expect(first.keyCustody).toBe('os-keychain');
    expect(first.secret.toString('hex')).toBe(saved);
    first.secret.fill(0);
    expect(provider.getHarborSecret('harbor_synthetic').secret.toString('hex')).toBe(saved);
    const memory = createInMemoryPortholeSecretProvider(Buffer.alloc(32, 42));
    memory.getHarborSecret('synthetic').secret.fill(0);
    expect(memory.getHarborSecret('synthetic').secret.equals(Buffer.alloc(32, 42))).toBe(true);
    expect(() => createInMemoryPortholeSecretProvider(Buffer.alloc(31))).toThrow(/at least 32/);
  });
});
