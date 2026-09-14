#!/usr/bin/env node
/**
 * Harbor Clearance is an offline, non-actuating projection over a frozen repo
 * and PR snapshot. It deliberately uses only exact structured declarations:
 * natural-language retrieval and semantic judgment remain outside this slice.
 */

import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import {
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath as urlToPath } from 'node:url'

export const RELATION_KINDS = Object.freeze([
  'duplicate',
  'supersedes',
  'current-vs-target',
  'implementation-vs-plan',
  'direct-contradiction',
  'unresolved-fork',
  'stranded-unique-idea',
])

export const DISPOSITIONS = Object.freeze([
  'LAND',
  'REFIT',
  'SALVAGE',
  'FOLD',
  'HELD',
  'SCUTTLE',
  'ARCHIVE',
])

export const DESTRUCTIVE_DISPOSITIONS = Object.freeze(['FOLD', 'SCUTTLE', 'ARCHIVE'])

export const SAFETY_CONTRACT = Object.freeze({
  mode: 'offline-non-actuating',
  imports: ['node:crypto', 'node:fs', 'node:path', 'node:url'],
  network: false,
  subprocesses: false,
  daemon: false,
  githubWrites: false,
  externalModels: false,
  canonicalWrites: false,
  reportWriteRoot: '.cache/harbor-clearance',
})

const CURRENT_MODALITIES = new Set(['current', 'implementation'])
const FUTURE_MODALITIES = new Set(['target', 'plan'])
const CLAIM_MODALITIES = new Set([...CURRENT_MODALITIES, ...FUTURE_MODALITIES])
const CLAIM_WARRANTS = new Set(['source', 'observation', 'inference', 'missing'])
const CLAIM_STATUSES = new Set(['candidate', 'verified'])
const POLARITIES = new Set(['affirm', 'deny'])
const PR_STATES = new Set(['open', 'closed', 'merged'])
const CHECK_STATES = new Set(['pass', 'fail', 'unknown'])
const REVIEW_STATES = new Set(['complete', 'incomplete', 'unknown'])
const MERGE_STATES = new Set(['clean', 'conflicting', 'unknown'])
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.tex', '.html', '.yaml', '.yml'])

/** Return true only for ordinary JSON-style records. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Fail closed when a required structured value is absent. */
function requireValue(condition, path, message = 'is invalid') {
  if (!condition) throw new TypeError(`${path} ${message}`)
}

/** Validate a non-blank string without interpreting its prose. */
function requireString(value, path) {
  requireValue(typeof value === 'string' && /\S/u.test(value), path, 'must be a non-blank string')
}

/** Validate an array and return it for compact call sites. */
function requireArray(value, path) {
  requireValue(Array.isArray(value), path, 'must be an array')
  return value
}

/** Reject undeclared keys so misspelled safety fields do not disappear. */
function requireKeys(value, required, optional, path) {
  requireValue(isRecord(value), path, 'must be an object')
  for (const key of required) requireValue(Object.hasOwn(value, key), `${path}.${key}`, 'is required')
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) requireValue(allowed.has(key), `${path}.${key}`, 'is not allowed')
}

/** Produce a canonical string for exact, provider-free comparison. */
export function normalizeTerm(value) {
  requireString(value, 'term')
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

/** JSON serialization with recursively sorted object keys. */
export function stableStringify(value) {
  const visit = (item) => {
    if (Array.isArray(item)) return item.map(visit)
    if (!isRecord(item)) return item
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, visit(item[key])]))
  }
  return JSON.stringify(visit(value))
}

/** Stable short identifier derived only from frozen input. */
function stableId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16)}`
}

/** Validate the complete local snapshot declaration without mutating it. */
export function validateSnapshot(snapshot) {
  requireKeys(snapshot, ['schemaVersion', 'snapshot', 'topics', 'corpus', 'claims', 'pullRequests'], [], 'snapshot')
  requireValue(snapshot.schemaVersion === 1, 'snapshot.schemaVersion', 'must equal 1')

  requireKeys(
    snapshot.snapshot,
    ['id', 'capturedAt', 'repository', 'sourceHead', 'completeness', 'operatorHalt', 'source', 'limitations'],
    [],
    'snapshot.snapshot',
  )
  for (const key of ['id', 'capturedAt', 'repository', 'sourceHead', 'source']) {
    requireString(snapshot.snapshot[key], `snapshot.snapshot.${key}`)
  }
  requireValue(['complete', 'partial'].includes(snapshot.snapshot.completeness), 'snapshot.snapshot.completeness')
  requireValue(typeof snapshot.snapshot.operatorHalt === 'boolean', 'snapshot.snapshot.operatorHalt')
  for (const [index, limitation] of requireArray(snapshot.snapshot.limitations, 'snapshot.snapshot.limitations').entries()) {
    requireString(limitation, `snapshot.snapshot.limitations[${index}]`)
  }

  const topicIds = new Set()
  for (const [index, topic] of requireArray(snapshot.topics, 'snapshot.topics').entries()) {
    const path = `snapshot.topics[${index}]`
    requireKeys(topic, ['id', 'label'], [], path)
    requireString(topic.id, `${path}.id`)
    requireString(topic.label, `${path}.label`)
    requireValue(!topicIds.has(topic.id), `${path}.id`, 'must be unique')
    topicIds.add(topic.id)
  }

  for (const [index, entry] of requireArray(snapshot.corpus, 'snapshot.corpus').entries()) {
    const path = `snapshot.corpus[${index}]`
    requireKeys(entry, ['path', 'kind'], ['extensions'], path)
    requireString(entry.path, `${path}.path`)
    requireString(entry.kind, `${path}.kind`)
    requireValue(!isAbsolute(entry.path) && !entry.path.split(/[\\/]/u).includes('..'), `${path}.path`, 'must stay inside the repository')
    if (entry.extensions !== undefined) {
      for (const [extensionIndex, extension] of requireArray(entry.extensions, `${path}.extensions`).entries()) {
        requireValue(typeof extension === 'string' && /^\.[a-z0-9]+$/u.test(extension), `${path}.extensions[${extensionIndex}]`)
      }
    }
  }

  const claimIds = new Set()
  for (const [index, claim] of requireArray(snapshot.claims, 'snapshot.claims').entries()) {
    const path = `snapshot.claims[${index}]`
    requireKeys(
      claim,
      ['id', 'scope', 'decisionKey', 'subject', 'predicate', 'value', 'polarity', 'modality', 'status', 'warrant', 'exclusive', 'requiresDecision', 'topicIds', 'source', 'links', 'salvage'],
      [],
      path,
    )
    for (const key of ['id', 'scope', 'decisionKey', 'subject', 'predicate', 'value']) requireString(claim[key], `${path}.${key}`)
    requireValue(!claimIds.has(claim.id), `${path}.id`, 'must be unique')
    claimIds.add(claim.id)
    requireValue(POLARITIES.has(claim.polarity), `${path}.polarity`)
    requireValue(CLAIM_MODALITIES.has(claim.modality), `${path}.modality`)
    requireValue(CLAIM_STATUSES.has(claim.status), `${path}.status`)
    requireValue(CLAIM_WARRANTS.has(claim.warrant), `${path}.warrant`)
    requireValue(typeof claim.exclusive === 'boolean', `${path}.exclusive`)
    requireValue(typeof claim.requiresDecision === 'boolean', `${path}.requiresDecision`)
    for (const topicId of requireArray(claim.topicIds, `${path}.topicIds`)) {
      requireValue(topicIds.has(topicId), `${path}.topicIds`, `references unknown topic ${topicId}`)
    }
    requireKeys(claim.source, ['kind', 'ref', 'excerpt'], ['lineStart', 'lineEnd', 'prNumber'], `${path}.source`)
    requireValue(['artifact', 'pr'].includes(claim.source.kind), `${path}.source.kind`)
    requireString(claim.source.ref, `${path}.source.ref`)
    requireString(claim.source.excerpt, `${path}.source.excerpt`)
    if (claim.source.kind === 'pr') requireValue(Number.isSafeInteger(claim.source.prNumber) && claim.source.prNumber > 0, `${path}.source.prNumber`)
    for (const lineKey of ['lineStart', 'lineEnd']) {
      if (claim.source[lineKey] !== undefined) requireValue(Number.isSafeInteger(claim.source[lineKey]) && claim.source[lineKey] > 0, `${path}.source.${lineKey}`)
    }
    requireKeys(claim.links, ['duplicates', 'supersedes', 'implements'], [], `${path}.links`)
    for (const linkKind of ['duplicates', 'supersedes', 'implements']) {
      for (const linkedId of requireArray(claim.links[linkKind], `${path}.links.${linkKind}`)) requireString(linkedId, `${path}.links.${linkKind}`)
    }
    requireKeys(claim.salvage, ['unique', 'destination'], [], `${path}.salvage`)
    requireValue(typeof claim.salvage.unique === 'boolean', `${path}.salvage.unique`)
    requireValue(claim.salvage.destination === null || (typeof claim.salvage.destination === 'string' && /\S/u.test(claim.salvage.destination)), `${path}.salvage.destination`)
  }

  for (const [index, claim] of snapshot.claims.entries()) {
    for (const kind of ['duplicates', 'supersedes', 'implements']) {
      for (const target of claim.links[kind]) {
        requireValue(claimIds.has(target), `snapshot.claims[${index}].links.${kind}`, `references unknown claim ${target}`)
        requireValue(target !== claim.id, `snapshot.claims[${index}].links.${kind}`, 'cannot self-reference')
      }
    }
  }

  const prNumbers = new Set()
  for (const [index, pr] of requireArray(snapshot.pullRequests, 'snapshot.pullRequests').entries()) {
    const path = `snapshot.pullRequests[${index}]`
    requireKeys(pr, ['number', 'title', 'state', 'draft', 'metadataCompleteness', 'topicIds', 'claimIds', 'foldInto', 'signals'], [], path)
    requireValue(Number.isSafeInteger(pr.number) && pr.number > 0, `${path}.number`)
    requireValue(!prNumbers.has(pr.number), `${path}.number`, 'must be unique')
    prNumbers.add(pr.number)
    requireString(pr.title, `${path}.title`)
    requireValue(PR_STATES.has(pr.state), `${path}.state`)
    requireValue(typeof pr.draft === 'boolean', `${path}.draft`)
    requireValue(['full', 'partial', 'number-only'].includes(pr.metadataCompleteness), `${path}.metadataCompleteness`)
    for (const topicId of requireArray(pr.topicIds, `${path}.topicIds`)) requireValue(topicIds.has(topicId), `${path}.topicIds`, `references unknown topic ${topicId}`)
    for (const claimId of requireArray(pr.claimIds, `${path}.claimIds`)) requireValue(claimIds.has(claimId), `${path}.claimIds`, `references unknown claim ${claimId}`)
    requireValue(pr.foldInto === null || (Number.isSafeInteger(pr.foldInto) && pr.foldInto > 0), `${path}.foldInto`)
    requireKeys(pr.signals, ['checks', 'review', 'mergeability', 'recovered', 'stale', 'historicalOnly', 'noUniqueClaimsVerified', 'suggestedDisposition'], [], `${path}.signals`)
    requireValue(CHECK_STATES.has(pr.signals.checks), `${path}.signals.checks`)
    requireValue(REVIEW_STATES.has(pr.signals.review), `${path}.signals.review`)
    requireValue(MERGE_STATES.has(pr.signals.mergeability), `${path}.signals.mergeability`)
    for (const key of ['recovered', 'stale', 'historicalOnly', 'noUniqueClaimsVerified']) requireValue(typeof pr.signals[key] === 'boolean', `${path}.signals.${key}`)
    requireValue(pr.signals.suggestedDisposition === null || DISPOSITIONS.includes(pr.signals.suggestedDisposition), `${path}.signals.suggestedDisposition`)
  }
  for (const [index, pr] of snapshot.pullRequests.entries()) {
    if (pr.foldInto !== null) {
      requireValue(prNumbers.has(pr.foldInto), `snapshot.pullRequests[${index}].foldInto`, `references unknown PR ${pr.foldInto}`)
      requireValue(pr.foldInto !== pr.number, `snapshot.pullRequests[${index}].foldInto`, 'cannot reference itself')
    }
  }
  for (const [index, claim] of snapshot.claims.entries()) {
    if (claim.source.kind === 'pr') {
      requireValue(prNumbers.has(claim.source.prNumber), `snapshot.claims[${index}].source.prNumber`, `references unknown PR ${claim.source.prNumber}`)
    }
  }

  return snapshot
}

/** Normalize a typed claim while retaining its exact provenance and excerpt. */
export function normalizeClaim(claim) {
  return {
    ...claim,
    topicIds: [...claim.topicIds].sort(),
    links: {
      duplicates: [...claim.links.duplicates].sort(),
      supersedes: [...claim.links.supersedes].sort(),
      implements: [...claim.links.implements].sort(),
    },
    normalized: {
      scope: normalizeTerm(claim.scope),
      decisionKey: normalizeTerm(claim.decisionKey),
      subject: normalizeTerm(claim.subject),
      predicate: normalizeTerm(claim.predicate),
      value: normalizeTerm(claim.value),
      polarity: claim.polarity,
      modality: claim.modality,
      method: 'exact-structured-v1',
    },
  }
}

/** Confirm that a resolved path remains at or below its declared root. */
function isInside(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Extract explicit Markdown status declarations as candidates, never as truth. */
export function extractStructuredStatusClaims(artifact, content) {
  if (extname(artifact.path).toLowerCase() !== '.md') return []
  const lines = content.split(/\r?\n/u)
  const found = []
  for (let index = 0; index < lines.length; index += 1) {
    let value = null
    const inline = lines[index].match(/^\s*(?:\*\*)?Status(?:\*\*)?\s*:\s*(\S.*?)\s*$/iu)
    if (inline) value = inline[1].replace(/\s{2,}$/u, '')
    if (/^\s*#{1,6}\s+Status\s*$/iu.test(lines[index])) {
      for (let next = index + 1; next < Math.min(lines.length, index + 5); next += 1) {
        if (/\S/u.test(lines[next])) {
          value = lines[next].trim()
          index = next
          break
        }
      }
    }
    if (value === null) continue
    found.push({
      id: stableId('status', [artifact.path, index + 1, value]),
      subject: artifact.path,
      predicate: 'declares status',
      value,
      status: 'candidate',
      warrant: 'source',
      normalizationMethod: 'structured-status-v1',
      normalized: {
        subject: normalizeTerm(artifact.path),
        predicate: 'declares status',
        value: normalizeTerm(value),
        method: 'exact-structured-v1',
      },
      source: {
        kind: 'artifact',
        ref: `${artifact.path}:${index + 1}`,
        lineStart: index + 1,
        lineEnd: index + 1,
        excerpt: lines[index],
        sha256: artifact.sha256,
      },
    })
  }
  return found
}

/** Inventory declared text roots without following symlinks or leaving the repo. */
export function inventoryArtifacts(repoRoot, corpus) {
  const root = resolve(repoRoot)
  const artifacts = []
  const skipped = []

  const addFile = (absolutePath, entry) => {
    const repoPath = relative(root, absolutePath).split(sep).join('/')
    const extension = extname(repoPath).toLowerCase()
    const allowed = new Set(entry.extensions ?? TEXT_EXTENSIONS)
    if (!allowed.has(extension)) return
    const bytes = readFileSync(absolutePath)
    const artifact = {
      path: repoPath,
      kind: entry.kind,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
    artifacts.push({
      ...artifact,
      structuredStatusClaims: extractStructuredStatusClaims(artifact, bytes.toString('utf8')),
    })
  }

  const walk = (absolutePath, entry) => {
    requireValue(isInside(root, absolutePath), entry.path, 'resolved outside the repository')
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) {
      skipped.push({ path: relative(root, absolutePath).split(sep).join('/'), reason: 'symlink-not-followed' })
      return
    }
    if (stat.isFile()) {
      addFile(absolutePath, entry)
      return
    }
    requireValue(stat.isDirectory(), entry.path, 'must be a file or directory')
    for (const child of readdirSync(absolutePath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      walk(resolve(absolutePath, child.name), entry)
    }
  }

  for (const entry of [...corpus].sort((a, b) => a.path.localeCompare(b.path))) {
    walk(resolve(root, entry.path), entry)
  }

  artifacts.sort((a, b) => a.path.localeCompare(b.path))
  skipped.sort((a, b) => a.path.localeCompare(b.path))
  const countsByKind = {}
  for (const artifact of artifacts) countsByKind[artifact.kind] = (countsByKind[artifact.kind] ?? 0) + 1
  return {
    total: artifacts.length,
    countsByKind: Object.fromEntries(Object.entries(countsByKind).sort(([a], [b]) => a.localeCompare(b))),
    artifacts,
    skipped,
  }
}

/** Classify only exact or explicitly linked claim relations. */
export function classifyRelations(inputClaims) {
  const claims = inputClaims.map(normalizeClaim).sort((a, b) => a.id.localeCompare(b.id))
  const relations = []
  const relationKeys = new Set()
  const linkedPairs = new Set()

  const add = (kind, from, to, reason) => {
    requireValue(RELATION_KINDS.includes(kind), 'relation.kind')
    const symmetric = new Set(['duplicate', 'current-vs-target', 'implementation-vs-plan', 'direct-contradiction', 'unresolved-fork'])
    const endpoints = symmetric.has(kind) ? [from, to].sort() : [from, to]
    const key = `${kind}:${endpoints.join(':')}`
    if (relationKeys.has(key)) return
    relationKeys.add(key)
    relations.push({ id: stableId('relation', key), kind, from: endpoints[0], to: endpoints[1] ?? null, reason, basis: 'exact-structured-v1' })
  }

  for (const claim of claims) {
    for (const target of claim.links.duplicates) {
      add('duplicate', claim.id, target, 'Snapshot declares an exact duplicate link.')
      linkedPairs.add([claim.id, target].sort().join(':'))
    }
    for (const target of claim.links.supersedes) {
      add('supersedes', claim.id, target, 'Snapshot declares a directed supersession link.')
      linkedPairs.add([claim.id, target].sort().join(':'))
    }
    for (const target of claim.links.implements) {
      add('implementation-vs-plan', claim.id, target, 'Snapshot links an implementation claim to its plan.')
      linkedPairs.add([claim.id, target].sort().join(':'))
    }
  }

  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const left = claims[leftIndex]
      const right = claims[rightIndex]
      const pairKey = [left.id, right.id].sort().join(':')
      if (linkedPairs.has(pairKey)) continue
      const sameScope = left.normalized.scope === right.normalized.scope
      const sameDecision = left.normalized.decisionKey === right.normalized.decisionKey
      const sameProposition = sameScope && sameDecision
        && left.normalized.subject === right.normalized.subject
        && left.normalized.predicate === right.normalized.predicate
        && left.normalized.value === right.normalized.value
        && left.polarity === right.polarity
      const mixedTime = (CURRENT_MODALITIES.has(left.modality) && FUTURE_MODALITIES.has(right.modality))
        || (FUTURE_MODALITIES.has(left.modality) && CURRENT_MODALITIES.has(right.modality))

      if (sameProposition) {
        if (mixedTime && (left.modality === 'implementation' || right.modality === 'implementation')) {
          add('implementation-vs-plan', left.id, right.id, 'The same exact proposition appears as implementation and plan/target.')
        } else {
          add('duplicate', left.id, right.id, 'The same exact scoped proposition appears more than once.')
        }
        continue
      }
      if (!sameScope || !sameDecision) continue

      const opposed = left.normalized.value === right.normalized.value && left.polarity !== right.polarity
      const exclusiveAlternatives = left.exclusive && right.exclusive && left.normalized.value !== right.normalized.value
      if (!opposed && !exclusiveAlternatives) continue
      if (mixedTime) {
        add('current-vs-target', left.id, right.id, 'Exact decision key differs between current/implementation and plan/target modalities.')
      } else if (FUTURE_MODALITIES.has(left.modality) && FUTURE_MODALITIES.has(right.modality) && (left.requiresDecision || right.requiresDecision)) {
        add('unresolved-fork', left.id, right.id, 'Exclusive future alternatives share a decision key and require a decision.')
      } else {
        add('direct-contradiction', left.id, right.id, 'Claims assert incompatible values in the same exact scope and modality plane.')
      }
    }
  }

  for (const claim of claims) {
    if (!claim.salvage.unique) continue
    const accounted = relations.some((relation) => relation.kind === 'duplicate' && [relation.from, relation.to].includes(claim.id))
      || relations.some((relation) => relation.kind === 'supersedes' && relation.to === claim.id)
    if (!accounted) add('stranded-unique-idea', claim.id, null, 'The snapshot marks this idea unique and no exact duplicate or superseding claim accounts for it.')
  }

  return relations.sort((a, b) => a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from) || String(a.to).localeCompare(String(b.to)))
}

/** Group structured claims into exact declared narrative threads. */
export function clusterNarrativeThreads(snapshot, claims) {
  const labels = new Map(snapshot.topics.map((topic) => [topic.id, topic.label]))
  return [...snapshot.topics].sort((a, b) => a.id.localeCompare(b.id)).map((topic) => {
    const members = claims.filter((claim) => claim.topicIds.includes(topic.id)).map((claim) => claim.id).sort()
    const prs = [...new Set(claims
      .filter((claim) => members.includes(claim.id) && claim.source.kind === 'pr')
      .map((claim) => claim.source.prNumber))].sort((a, b) => a - b)
    return { id: topic.id, label: labels.get(topic.id), claimIds: members, pullRequests: prs }
  }).filter((thread) => thread.claimIds.length > 0)
}

/** Group PRs into connected components using only declared topic identifiers. */
export function clusterPrFamilies(snapshot) {
  const prs = [...snapshot.pullRequests].sort((a, b) => a.number - b.number)
  const parent = new Map(prs.map((pr) => [pr.number, pr.number]))
  const find = (number) => {
    let cursor = number
    while (parent.get(cursor) !== cursor) cursor = parent.get(cursor)
    let compress = number
    while (parent.get(compress) !== cursor) {
      const next = parent.get(compress)
      parent.set(compress, cursor)
      compress = next
    }
    return cursor
  }
  const union = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(Math.max(leftRoot, rightRoot), Math.min(leftRoot, rightRoot))
  }
  const topicsFor = (pr) => new Set([
    ...pr.topicIds,
    ...snapshot.claims.filter((claim) => pr.claimIds.includes(claim.id)).flatMap((claim) => claim.topicIds),
  ])
  for (let left = 0; left < prs.length; left += 1) {
    const leftTopics = topicsFor(prs[left])
    for (let right = left + 1; right < prs.length; right += 1) {
      if ([...topicsFor(prs[right])].some((topic) => leftTopics.has(topic))) union(prs[left].number, prs[right].number)
    }
  }
  const groups = new Map()
  for (const pr of prs) {
    const root = find(pr.number)
    const group = groups.get(root) ?? []
    group.push(pr)
    groups.set(root, group)
  }
  const labels = new Map(snapshot.topics.map((topic) => [topic.id, topic.label]))
  return [...groups.values()].map((group) => {
    const numbers = group.map((pr) => pr.number).sort((a, b) => a - b)
    const topicIds = [...new Set(group.flatMap((pr) => [...topicsFor(pr)]))].sort()
    return {
      id: stableId('family', numbers),
      label: topicIds.length > 0 ? topicIds.map((topic) => labels.get(topic) ?? topic).join(' / ') : `Unclassified PR #${numbers[0]}`,
      topicIds,
      pullRequests: numbers,
    }
  }).sort((a, b) => a.pullRequests[0] - b.pullRequests[0])
}

/** Account for every claim before proposing a destructive trajectory disposition. */
export function buildLossAudit(pr, claims, relations) {
  const prClaims = claims.filter((claim) => pr.claimIds.includes(claim.id))
  const entries = prClaims.map((claim) => {
    const duplicate = relations.find((relation) => relation.kind === 'duplicate'
      && [relation.from, relation.to].includes(claim.id)
      && [relation.from, relation.to].some((id) => {
        const peer = claims.find((candidate) => candidate.id === id)
        return peer?.source.kind === 'pr' && peer.source.prNumber !== pr.number
      }))
    if (duplicate) return { claimId: claim.id, status: 'duplicate-accounted', destination: duplicate.id }
    const superseded = relations.find((relation) => relation.kind === 'supersedes' && relation.to === claim.id)
    if (superseded) return { claimId: claim.id, status: 'superseded-accounted', destination: superseded.from }
    if (claim.salvage.destination !== null) return { claimId: claim.id, status: 'preserved', destination: claim.salvage.destination }
    return { claimId: claim.id, status: 'unaccounted', destination: null }
  })
  const noClaimsVerified = prClaims.length === 0 && pr.signals.noUniqueClaimsVerified
  const complete = (prClaims.length > 0 && entries.every((entry) => entry.status !== 'unaccounted')) || noClaimsVerified
  return {
    required: true,
    complete,
    noClaimsVerified,
    entries,
    unaccountedClaimIds: entries.filter((entry) => entry.status === 'unaccounted').map((entry) => entry.claimId),
    warning: complete ? null : 'Destructive disposition is blocked until every claim has a destination or explicit accountable fate.',
  }
}

/** Produce a proposed, never-executed PR disposition plan. */
export function proposeClearancePlan(snapshot, claims, relations) {
  return [...snapshot.pullRequests].sort((a, b) => a.number - b.number).map((pr) => {
    const prRelations = relations.filter((relation) => pr.claimIds.includes(relation.from) || pr.claimIds.includes(relation.to))
    const blocking = prRelations.some((relation) => ['direct-contradiction', 'unresolved-fork'].includes(relation.kind))
    const hasUnique = prRelations.some((relation) => relation.kind === 'stranded-unique-idea')
    const allSubsumed = pr.claimIds.length > 0 && pr.claimIds.every((claimId) => prRelations.some((relation) => (
      relation.kind === 'duplicate' && [relation.from, relation.to].includes(claimId)
    ) || (relation.kind === 'supersedes' && relation.to === claimId)))

    let candidateDisposition = null
    let reason
    if (blocking) {
      candidateDisposition = 'HELD'
      reason = 'A direct contradiction or unresolved fork requires accountable review.'
    } else if (pr.signals.suggestedDisposition !== null) {
      candidateDisposition = pr.signals.suggestedDisposition
      reason = 'The frozen snapshot supplies an explicit candidate disposition.'
    } else if (pr.signals.historicalOnly) {
      candidateDisposition = 'ARCHIVE'
      reason = 'The frozen snapshot marks this trajectory historical-only.'
    } else if (allSubsumed && pr.foldInto !== null) {
      candidateDisposition = 'FOLD'
      reason = `Every inventoried claim is duplicated or superseded; fold target is PR #${pr.foldInto}.`
    } else if (pr.signals.recovered || pr.signals.stale) {
      candidateDisposition = 'SALVAGE'
      reason = hasUnique
        ? 'Recovered/stale work contains a declared stranded unique idea.'
        : 'Recovered/stale work needs claim inventory before any destructive choice.'
    } else if (pr.signals.checks === 'fail' || pr.signals.review === 'incomplete' || pr.signals.mergeability === 'conflicting') {
      candidateDisposition = 'REFIT'
      reason = 'The frozen metadata records failed checks, incomplete review, or a merge conflict.'
    } else if (!pr.draft && pr.metadataCompleteness === 'full' && pr.signals.checks === 'pass'
      && pr.signals.review === 'complete' && pr.signals.mergeability === 'clean') {
      candidateDisposition = 'LAND'
      reason = 'The complete frozen metadata records a clean, reviewed, passing candidate.'
    } else {
      candidateDisposition = 'HELD'
      reason = 'Metadata or decision evidence is incomplete; the tool cannot safely recommend movement.'
    }

    let proposedDisposition = candidateDisposition
    let lossAudit = { required: false, complete: true, entries: [], unaccountedClaimIds: [], warning: null }
    if (DESTRUCTIVE_DISPOSITIONS.includes(candidateDisposition)) {
      lossAudit = buildLossAudit(pr, claims, relations)
      if (!lossAudit.complete) {
        proposedDisposition = 'HELD'
        reason = `${reason} Loss audit is incomplete, so the destructive candidate is held.`
      }
    }
    return {
      pullRequest: pr.number,
      title: pr.title,
      proposedDisposition,
      candidateDisposition: proposedDisposition === candidateDisposition ? null : candidateDisposition,
      reason,
      relationIds: prRelations.map((relation) => relation.id).sort(),
      humanApprovalRequired: true,
      lossAudit,
    }
  })
}

/** Build the deterministic clearance report from validated snapshot and local inventory. */
export function buildClearanceReport(snapshot, inventory) {
  validateSnapshot(snapshot)
  const claims = snapshot.claims.map(normalizeClaim).sort((a, b) => a.id.localeCompare(b.id))
  const relations = classifyRelations(snapshot.claims)
  const structuredStatusClaims = inventory.artifacts.flatMap((artifact) => artifact.structuredStatusClaims).sort((a, b) => a.id.localeCompare(b.id))
  const report = {
    schemaVersion: 1,
    generatedArtifact: true,
    canonical: false,
    actuation: 'none',
    snapshot: { ...snapshot.snapshot },
    safety: { ...SAFETY_CONTRACT, operatorHaltObserved: snapshot.snapshot.operatorHalt },
    inventory,
    pullRequests: {
      total: snapshot.pullRequests.length,
      source: 'frozen-input',
      items: [...snapshot.pullRequests].sort((a, b) => a.number - b.number).map((pr) => ({
        ...pr,
        topicIds: [...pr.topicIds].sort(),
        claimIds: [...pr.claimIds].sort(),
        signals: { ...pr.signals },
      })),
    },
    claims: {
      normalized: claims,
      structuredStatusCandidates: structuredStatusClaims,
      limitations: [
        'Only supplied typed claims and explicit Markdown Status fields are normalized.',
        'No natural-language similarity, inference, authorization verification, or runtime truth is claimed.',
      ],
    },
    narrativeThreads: clusterNarrativeThreads(snapshot, claims),
    prFamilies: clusterPrFamilies(snapshot),
    relations,
    clearancePlan: proposeClearancePlan(snapshot, claims, relations),
    limitations: [
      ...snapshot.snapshot.limitations,
      'PR metadata is a frozen input and is never refreshed by this tool.',
      'All dispositions are proposals. This report cannot merge, close, comment on, or mutate a PR or document.',
      'Exact structural matching favors false negatives over ungrounded semantic guesses.',
    ],
  }
  return { ...report, reportId: stableId('clearance', report) }
}

/** Scan the declared repo roots and construct the complete report. */
export function analyzeSnapshot(repoRoot, snapshot) {
  validateSnapshot(snapshot)
  return buildClearanceReport(snapshot, inventoryArtifacts(repoRoot, snapshot.corpus))
}

/** Render the operator-facing clearance summary without hiding provenance gaps. */
export function renderMarkdown(report) {
  const relationCounts = Object.fromEntries(RELATION_KINDS.map((kind) => [kind, report.relations.filter((relation) => relation.kind === kind).length]))
  const dispositionCounts = Object.fromEntries(DISPOSITIONS.map((kind) => [kind, report.clearancePlan.filter((entry) => entry.proposedDisposition === kind).length]))
  const lines = [
    '# Harbor Clearance Plan (generated, non-canonical)',
    '',
    `Snapshot: \`${report.snapshot.id}\` at \`${report.snapshot.capturedAt}\``,
    `Source head: \`${report.snapshot.sourceHead}\``,
    `Report: \`${report.reportId}\``,
    '',
    '> Read-only proposal. It performed no network call, subprocess, daemon access, model call, GitHub write, merge, close, or document mutation.',
    '',
    '## Inventory',
    '',
    `- ${report.inventory.total} local artifacts across ${Object.keys(report.inventory.countsByKind).length} declared corpus kinds`,
    `- ${report.pullRequests.total} PRs from frozen metadata`,
    `- ${report.claims.normalized.length} supplied typed claims`,
    `- ${report.claims.structuredStatusCandidates.length} explicit document-status candidates`,
    `- ${report.prFamilies.length} PR families from exact declared topic IDs`,
    '',
    '## Relations',
    '',
    ...Object.entries(relationCounts).map(([kind, count]) => `- ${kind}: ${count}`),
    '',
    '## Proposed dispositions',
    '',
    ...Object.entries(dispositionCounts).map(([kind, count]) => `- ${kind}: ${count}`),
    '',
    '| PR | Proposal | Candidate blocked by loss audit | Why |',
    '| ---: | --- | --- | --- |',
    ...report.clearancePlan.map((entry) => `| #${entry.pullRequest} | ${entry.proposedDisposition} | ${entry.candidateDisposition ?? '—'} | ${entry.reason.replace(/\|/gu, '\\|')} |`),
    '',
    '## Loss audit',
    '',
  ]
  const destructive = report.clearancePlan.filter((entry) => entry.lossAudit.required)
  if (destructive.length === 0) lines.push('- No destructive disposition was proposed.')
  for (const entry of destructive) {
    lines.push(`- PR #${entry.pullRequest}: ${entry.lossAudit.complete ? 'complete' : 'BLOCKED'}; ${entry.lossAudit.entries.length} claims examined; ${entry.lossAudit.unaccountedClaimIds.length} unaccounted.`)
  }
  lines.push('', '## Known limits', '', ...report.limitations.map((limitation) => `- ${limitation}`), '')
  return lines.join('\n')
}

/** Parse the deliberately small local-only command line. */
export function parseArgs(args, cwd = process.cwd()) {
  const options = { repo: cwd, snapshot: null, outputDir: null, stdout: false, format: 'both' }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--repo' || arg === '--snapshot' || arg === '--output-dir' || arg === '--format') {
      const value = args[index + 1]
      requireString(value, arg)
      options[arg.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value
      index += 1
    } else if (arg === '--stdout') options.stdout = true
    else if (arg === '--help') options.help = true
    else throw new TypeError(`unknown argument: ${arg}`)
  }
  requireValue(options.help || options.snapshot !== null, '--snapshot', 'is required')
  requireValue(['both', 'json', 'markdown'].includes(options.format), '--format', 'must be both, json, or markdown')
  return options
}

/** Resolve and constrain all report writes to the non-canonical cache root. */
export function resolveOutputDir(repoRoot, requested = null) {
  const root = resolve(repoRoot)
  const writeRoot = resolve(root, SAFETY_CONTRACT.reportWriteRoot)
  const output = requested === null ? writeRoot : resolve(root, requested)
  requireValue(isInside(writeRoot, output), '--output-dir', `must stay inside ${SAFETY_CONTRACT.reportWriteRoot}`)
  return output
}

/** Execute the local CLI using injectable streams; return an exit code. */
export function runCli(args, io = {}) {
  const stdout = io.stdout ?? ((text) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text) => process.stderr.write(text))
  try {
    const options = parseArgs(args, io.cwd ?? process.cwd())
    if (options.help) {
      stdout('Usage: node harbor_clearance.mjs --snapshot <local.json> [--repo <path>] [--stdout] [--format both|json|markdown] [--output-dir .cache/harbor-clearance/... ]\n')
      return 0
    }
    requireValue(!/^[a-z][a-z0-9+.-]*:\/\//iu.test(options.snapshot), '--snapshot', 'must be a local path, not a URL')
    const repoRoot = resolve(options.repo)
    const snapshotPath = resolve(io.cwd ?? process.cwd(), options.snapshot)
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    const report = analyzeSnapshot(repoRoot, snapshot)
    const json = `${JSON.stringify(report, null, 2)}\n`
    const markdown = renderMarkdown(report)
    if (options.stdout) {
      stdout(options.format === 'json' ? json : markdown)
      return 0
    }
    const outputDir = resolveOutputDir(repoRoot, options.outputDir)
    mkdirSync(outputDir, { recursive: true })
    if (options.format === 'both' || options.format === 'json') writeFileSync(resolve(outputDir, 'clearance-plan.json'), json)
    if (options.format === 'both' || options.format === 'markdown') writeFileSync(resolve(outputDir, 'clearance-plan.md'), markdown)
    stdout(`Wrote non-canonical report ${relative(repoRoot, outputDir).split(sep).join('/')} (${report.reportId})\n`)
    return 0
  } catch (error) {
    stderr(`harbor-clearance: ${error.message}\n`)
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
const modulePath = resolve(urlToPath(import.meta.url))
if (invokedPath === modulePath) process.exitCode = runCli(process.argv.slice(2))
