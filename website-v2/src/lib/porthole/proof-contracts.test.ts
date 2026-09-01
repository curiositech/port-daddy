import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  INTEGRATION_CONTRACTS,
  PORTHOLE_CAST_CORPUS,
  SERVICE_DISCOVERY_PROOF,
  findCollisionRefusalFailures,
  findJoinOnlyCastClaims,
  findPortholeCastCorpusFailures,
  findServiceDiscoveryFailures,
  findThreePartyParleyFailures,
  findVisibilityTimelineFailures,
} from '../../../scripts/porthole-proof-contracts.mjs'

describe('Porthole proof integration boundary', () => {
  it('keeps the evidence-layer product contract future-honest and pre-persistence private', () => {
    const product = readFileSync(
      new URL('../../../../demos/porthole/PRODUCT.md', import.meta.url),
      'utf8',
    )

    expect(product).toContain('privacy-safe evidence, continuity, and debugging for autonomous work')
    expect(product).toContain('Proposed Porthole engineering')
    expect(product).toContain('Classify and minimize before the first durable write')
    expect(product).toContain('verified T5')
    expect(product).not.toMatch(/\bpd rec\b|scrub before share|rolling ring buffer|porthole enable-flight/)
  })

  it('rejects every join-only contract if it becomes visible in a recorded frame', () => {
    const visibleFrame = [
      'SugarParleySettlementReceipt',
      'BufferedOutputRef',
      'ContextEnvelope',
      'CompactionPacket',
      'WorkReceipt',
    ].join('\n')

    const failures = findJoinOnlyCastClaims(new Map([['future-contract.cast', visibleFrame]]))

    expect(failures).toHaveLength(INTEGRATION_CONTRACTS.length)
    for (const contract of INTEGRATION_CONTRACTS) {
      expect(failures.join('\n')).toContain(`${contract.contract} is join-only`)
    }
  })

  it('allows current hook evidence without promoting a future envelope contract', () => {
    const currentEvidence = 'HARNESSED CONTEXT\nUserPromptSubmit.additionalContext\nagent model context — not shell stdout'

    expect(findJoinOnlyCastClaims(new Map([['harness-next-turn.cast', currentEvidence]]))).toEqual([])
  })

  it('requires configured project, registration, and discovery to agree after readiness', () => {
    const { project, semanticId, servicePort } = SERVICE_DISCOVERY_PROOF
    const evidence = [
      `Configured project: ${project}`,
      `api  local  → ${semanticId}`,
      '{"status":"ok","service":"atlas-api"}',
      `pd find '${semanticId}'`,
      `${semanticId}  ${servicePort}  assigned`,
      `${semanticId}: healthy`,
    ].join('\n')

    expect(findServiceDiscoveryFailures(evidence)).toEqual([])
  })

  it('rejects a ready recording when Port Daddy cannot discover the registered identity', () => {
    const { project, semanticId } = SERVICE_DISCOVERY_PROOF
    const evidence = [
      `Configured project: ${project}`,
      `api  local  → ${semanticId}`,
      '{"status":"ok","service":"atlas-api"}',
      `pd find '${semanticId}'`,
      'No services found',
    ].join('\n')

    expect(findServiceDiscoveryFailures(evidence)).toContain(
      'ports.cast: readiness succeeded but Port Daddy could not discover the recorded semantic identity',
    )
  })

  it('keeps the raw Parley source inside the eight-file corpus but outside primary scenes', () => {
    const files = [...PORTHOLE_CAST_CORPUS.primary, PORTHOLE_CAST_CORPUS.rawProtocol]

    expect(files).toHaveLength(8)
    expect(PORTHOLE_CAST_CORPUS.primary).not.toContain(PORTHOLE_CAST_CORPUS.rawProtocol)
    expect(findPortholeCastCorpusFailures(files)).toEqual([])
  })

  it('requires three real Parley sessions, a read-only witness, and three compact receipts', () => {
    const source = [
      'NORA◆ agent-settle-checkout-ownership-aaaaaaaa',
      'MILO◇ agent-challenge-checkout-ownership-bbbbbbbb',
      'AYA● agent-bind-checkout-retry-safety-cccccccc',
      'PORT DADDY WITNESS · READ ONLY',
      'public rationale as committed · no read receipt · no private chain of thought',
      '◆ NORA  OPENING POSITION',
      '◇ MILO  RISK EXPOSED',
      '● AYA  CONSTRAINT ADDED',
      '◆ NORA  PLAN CHANGED',
      'CAUGHT UP · 6 durable turns',
      'state CONVENED · settlement none',
    ].join('\n')
    const receipt = [
      'DECISION RECEIPT · AUTHOR',
      'DECISION RECEIPT · REVIEWER',
      'DECISION RECEIPT · SAFETY-OWNER',
      'DECISION PATH (6)',
      'nora · caught up',
      'milo · caught up',
      'aya · caught up',
    ].join('\n')

    expect(findThreePartyParleyFailures(source, receipt)).toEqual([])
    expect(findThreePartyParleyFailures(source.replace('PORT DADDY WITNESS · READ ONLY', 'silent helper'), receipt))
      .toContain('parley-source.cast: missing read-only witness pane')
  })

  it('publishes only the shared-read frontier of the real three-party Parley', () => {
    const evidence = JSON.parse(readFileSync(
      new URL('../../data/evidence/parley-979f6940.json', import.meta.url),
      'utf8',
    )) as {
      status: string
      outcome: unknown
      sourceTurnCount: number
      displayedTurnCount: number
      withheldTurnCount: number
      commonReadThrough: number
      participants: unknown[]
      turns: Array<{ sequence: number; at: number }>
      receipts: Array<{ unseenTurns: number }>
    }

    expect(evidence.status).toBe('CONVENED')
    expect(evidence.outcome).toBeNull()
    expect(evidence.participants).toHaveLength(3)
    expect(evidence.turns.map((turn) => turn.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(evidence.turns.every((turn) => turn.at <= evidence.commonReadThrough)).toBe(true)
    expect(evidence.turns).toHaveLength(evidence.displayedTurnCount)
    expect(evidence.sourceTurnCount - evidence.displayedTurnCount).toBe(evidence.withheldTurnCount)
    expect(evidence.receipts.map((receipt) => receipt.unseenTurns)).toEqual([0, 1, 1])
  })

  it('rejects an unclassified cast rather than silently changing the public corpus', () => {
    const files = [...PORTHOLE_CAST_CORPUS.primary, PORTHOLE_CAST_CORPUS.rawProtocol, 'staged-join-only.cast']

    expect(findPortholeCastCorpusFailures(files).join('\n')).toContain('unclassified staged-join-only.cast')
  })

  it('requires both real contested refusals instead of fabricated durable marker files', () => {
    const transcript = [
      'MILO◇ ❯ pd session files add db/schema.sql',
      '■  File conflicts detected',
      ' REFUSED · command exited 1 ',
      "Lock 'refunds-schema' is held by nora-migration",
      ' REFUSED · command exited 1 ',
    ].join('\n')

    expect(findCollisionRefusalFailures(transcript, true)).toEqual([])
    expect(findCollisionRefusalFailures(transcript.replace('File conflicts detected', 'claim passed'), true))
      .toContain('collision.cast: contested file claim did not show its real conflict')
  })

  it('requires a substantial real quiet interval before declaring a broken axis', () => {
    expect(findVisibilityTimelineFailures({
      sourceDuration: 90,
      jumpCuts: [{ sourceFrom: 0, sourceTo: 79.9 }],
    })).toContain('visibility.cast: expected a genuine 80-second timestamp discontinuity and broken-axis jump cut')

    expect(findVisibilityTimelineFailures({
      sourceDuration: 90,
      jumpCuts: [{ sourceFrom: 0, sourceTo: 80 }],
    })).toEqual([])
  })
})
