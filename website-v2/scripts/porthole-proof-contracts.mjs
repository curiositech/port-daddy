/**
 * Defines the evidence boundary for contracts that will eventually join the
 * Porthole gallery.
 *
 * Motivation: the gallery is a public proof surface, so a friendly label must
 * never silently become a product claim. The owning hypertree branch must
 * supply its typed contract and focused validation before a join-only card can
 * graduate into a rendered terminal witness.
 */
export const SERVICE_DISCOVERY_PROOF = Object.freeze({
  project: 'porthole-service-proof',
  semanticId: 'porthole-service-proof:app:main',
  servicePort: 19876,
});

/** The published replay corpus has seven presentation scenes and one retained
 * raw Parley source transcript. The source is deliberately part of the
 * on-disk corpus while remaining outside the primary Sugar-first experience. */
export const PORTHOLE_CAST_CORPUS = Object.freeze({
  primary: Object.freeze([
    'quickstart.cast',
    'harness-next-turn.cast',
    'collision.cast',
    'visibility.cast',
    'recovery.cast',
    'ports.cast',
    'parley.cast',
  ]),
  rawProtocol: 'parley-source.cast',
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Verifies the three linked identities in the service proof: the configured
 * project, pd up's registered semantic ID, and pd find's discovery result.
 * A passing HTTP probe alone is deliberately insufficient evidence.
 */
export function findServiceDiscoveryFailures(evidence, file = 'ports.cast') {
  const { project, semanticId, servicePort } = SERVICE_DISCOVERY_PROOF;
  const escapedIdentity = escapeRegExp(semanticId);
  const failures = [];
  const hasReadiness = /"status"\s*:\s*"ok"/.test(evidence);
  const hasConfiguredProject = new RegExp(`Configured project:\\s*${escapeRegExp(project)}`).test(evidence);
  const hasRegistration = new RegExp(`api\\s+local\\s+→\\s+${escapedIdentity}`).test(evidence);
  const hasExactQuery = new RegExp(`pd find ['"]?${escapedIdentity}['"]?`).test(evidence);
  const hasDiscoveryResult = new RegExp(`${escapedIdentity}\\s+${servicePort}\\s+assigned`).test(evidence);
  const hasHealthResult = new RegExp(`${escapedIdentity}: healthy`).test(evidence);
  if (!hasReadiness) failures.push(`${file}: missing HTTP readiness evidence for ${semanticId}`);
  if (!hasConfiguredProject) failures.push(`${file}: config did not visibly declare project ${project}`);
  if (!hasRegistration) failures.push(`${file}: pd up did not register ${semanticId} from configured project ${project}`);
  if (!hasExactQuery) failures.push(`${file}: readiness may succeed, but the recorder never queries the configured semantic identity ${semanticId}`);
  if (!hasDiscoveryResult) failures.push(`${file}: pd find did not return the registered semantic identity ${semanticId}`);
  if (!hasHealthResult) failures.push(`${file}: pd health did not confirm the discovered semantic identity ${semanticId}`);
  if (/No services found/.test(evidence)) {
    failures.push(`${file}: readiness succeeded but Port Daddy could not discover the recorded semantic identity`);
  }
  return failures;
}

/**
 * Checks the named proof corpus without treating a raw supporting transcript
 * as both a primary scene and an excluded file. An explicit role split is the
 * only honest way to keep the natural primary experience and its audit trail
 * together in the same committed artifact set.
 *
 * @param {readonly string[]} files cast basenames supplied by the replay gate.
 * @returns {string[]} contract failures suitable for CI output.
 */
export function findPortholeCastCorpusFailures(files) {
  const expected = [...PORTHOLE_CAST_CORPUS.primary, PORTHOLE_CAST_CORPUS.rawProtocol];
  const actual = new Set(files);
  const failures = [];
  if (PORTHOLE_CAST_CORPUS.primary.includes(PORTHOLE_CAST_CORPUS.rawProtocol)) {
    failures.push('Porthole corpus contract makes the raw Parley source a primary scene');
  }
  for (const file of expected) {
    if (!actual.has(file)) failures.push(`Porthole corpus is missing required ${file}`);
  }
  for (const file of actual) {
    if (!expected.includes(file)) failures.push(`Porthole corpus includes an unclassified ${file}`);
  }
  if (actual.size !== files.length) failures.push('Porthole corpus contains duplicate cast entries');
  if (actual.size !== expected.length) {
    failures.push(`Porthole corpus has ${actual.size} cast file(s); expected ${expected.length} named artifacts`);
  }
  return failures;
}

/**
 * Validates the two intentionally contested collision operations from their
 * real replay bytes. Required-command markers live only in the recorder's
 * ephemeral run directory so unexpected failures abort capture; they are not
 * fabricated files to ship beside the public casts.
 *
 * @param {string} transcript settled collision transcript reconstructed by VT.
 * @param {boolean} hasRedRefusal whether captured ANSI bytes contain an
 *   unmistakable red refusal treatment.
 * @returns {string[]} evidence failures for the visible expected refusals.
 */
export function findCollisionRefusalFailures(transcript, hasRedRefusal) {
  const failures = [];
  if (!/MILO◇\s+❯\s+pd session files add db\/schema\.sql/.test(transcript)) {
    failures.push('collision.cast: missing the contested file-claim command');
  }
  if (!/File conflicts detected/.test(transcript)) {
    failures.push('collision.cast: contested file claim did not show its real conflict');
  }
  if (!/Lock 'refunds-schema' is held by nora-migration/.test(transcript)) {
    failures.push('collision.cast: missing the real contested-lock refusal');
  }
  const refusalStatuses = [...transcript.matchAll(/REFUSED · command exited ([1-9]\d*)/g)];
  if (refusalStatuses.length < 2) {
    failures.push('collision.cast: expected both contested operations to retain visible non-zero exits');
  }
  if (!hasRedRefusal) {
    failures.push('collision.cast: expected refusals lack unmistakable red ANSI treatment');
  }
  return failures;
}

/**
 * Requires the visibility proof to earn its broken axis from a real gap in
 * the recording clock. A merely long recording is insufficient: the cast
 * must retain at least eighty seconds of quiet elapsed time as a distinct
 * jump-cut interval.
 *
 * @param {{ sourceDuration: number, jumpCuts: readonly { sourceFrom: number, sourceTo: number }[] }} cast parsed visibility cast metadata.
 * @param {string} file evidence filename used in human-readable failures.
 * @returns {string[]} timeline-proof failures suitable for the replay gate.
 */
export function findVisibilityTimelineFailures(cast, file = 'visibility.cast') {
  const hasGenuineEightySecondCut = cast.jumpCuts.some((cut) => cut.sourceTo - cut.sourceFrom >= 80);
  if (cast.sourceDuration >= 90 && hasGenuineEightySecondCut) return [];
  return [`${file}: expected a genuine 80-second timestamp discontinuity and broken-axis jump cut`];
}

export const INTEGRATION_CONTRACTS = Object.freeze([
  {
    contract: 'Sugar Parley',
    shape: 'SugarParleySettlementReceipt',
    state: 'join-only',
    boundary: 'Awaiting a verified public contract and focused source tests; primary proof keeps debug Parley plumbing out of view.',
    castClaimPatterns: [/\bSugar Parley\b/i, /\bSugarParley(?:Settlement)?Receipt\b/i],
  },
  {
    contract: 'BufferedOutputRef',
    shape: 'bounded output reference',
    state: 'join-only',
    boundary: 'No overflow behavior is depicted until the owning branch supplies an authorization, replay, and expiry contract.',
    castClaimPatterns: [/\bBufferedOutputRef\b/i, /\boutput overflow\b/i, /\boutput spill\b/i],
  },
  {
    contract: 'ContextEnvelope',
    shape: 'next-turn context envelope',
    state: 'join-only',
    boundary: 'The existing hook cast proves its current bytes only; future envelope fields require upstream contract evidence.',
    castClaimPatterns: [/\bContextEnvelope\b/i],
  },
  {
    contract: 'CompactionPacket',
    shape: 'pressure and continuation packet',
    state: 'join-only',
    boundary: 'No interactive compaction is visualized until the source branch exposes its verified lifecycle and receipts.',
    castClaimPatterns: [/\bCompactionPacket\b/i, /\binteractive compaction\b/i],
  },
  {
    contract: 'WorkReceipt',
    shape: 'normalized work evidence',
    state: 'join-only',
    boundary: 'The gallery reserves a receipt attachment point but does not upgrade casts into a normalized work receipt on its own.',
    castClaimPatterns: [/\bWorkReceipt\b/i, /\bnormalized work receipt\b/i],
  },
]);

/**
 * Returns every cast line that would incorrectly promote a join-only contract.
 *
 * @param {Map<string, string>} decodedByFile decoded, frame-observed text by cast file
 * @returns {string[]} human-readable verification failures for the cast gate
 */
export function findJoinOnlyCastClaims(decodedByFile) {
  const failures = [];
  for (const contract of INTEGRATION_CONTRACTS) {
    if (contract.state !== 'join-only') continue;
    for (const [file, transcript] of decodedByFile) {
      for (const pattern of contract.castClaimPatterns) {
        const match = transcript.match(pattern);
        if (match) {
          failures.push(`${file}: ${contract.contract} is join-only, but the decoded recording claims ${JSON.stringify(match[0])}`);
        }
      }
    }
  }
  return failures;
}
