import { describe, expect, it } from 'vitest'
import {
  INTEGRATION_CONTRACTS,
  SERVICE_DISCOVERY_PROOF,
  findJoinOnlyCastClaims,
  findServiceDiscoveryFailures,
} from '../../../scripts/porthole-proof-contracts.mjs'

describe('Porthole proof integration boundary', () => {
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
})
