function countClaims(claims, status) {
  return claims.filter((claim) => claim.status === status).length;
}

export function checkPortholeMutationReceipt(receipt) {
  const errors = [];
  if (receipt.issuer.signingKeyId !== receipt.signature.keyId) {
    errors.push('mutation receipt signature key must match issuer signing key');
  }
  const startedAt = Date.parse(receipt.execution.startedAt);
  const completedAt = Date.parse(receipt.execution.completedAt);
  const issuedAt = Date.parse(receipt.issuedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || !Number.isFinite(issuedAt)) {
    errors.push('mutation receipt timestamps must be valid dates');
  }
  if (completedAt < startedAt) {
    errors.push('mutation execution cannot complete before it starts');
  }
  if (issuedAt < completedAt) {
    errors.push('mutation receipt cannot be issued before execution completes');
  }
  const outcomes = [receipt.execution.baseline.outcome, receipt.execution.mutated.outcome];
  const expectedOutcomes = {
    killed: ['accepted', 'rejected'],
    survived: ['accepted', 'accepted'],
    'not-run': ['not-run', 'not-run'],
  }[receipt.disposition];
  if (expectedOutcomes && outcomes.some((outcome, index) => outcome !== expectedOutcomes[index])) {
    errors.push(`mutation receipt ${receipt.disposition} disposition has incompatible execution outcomes`);
  }
  const evidenceRefs = new Set(receipt.evidence.artifactRefs);
  for (const run of [receipt.execution.baseline, receipt.execution.mutated]) {
    if (run.outputRef !== null && !evidenceRefs.has(run.outputRef)) {
      errors.push(`mutation evidence omits output artifact ${run.outputRef}`);
    }
  }
  return errors;
}

export function checkPortholeRejectionCoverage(coverage, receipts) {
  const errors = [];
  const receiptById = new Map(receipts.map((receipt) => [receipt.receiptId, receipt]));
  const invariantIds = new Set();

  for (const claim of coverage.claims) {
    if (invariantIds.has(claim.invariantId)) {
      errors.push(`duplicate rejection-coverage invariant ${claim.invariantId}`);
    }
    invariantIds.add(claim.invariantId);

    for (const receiptRef of claim.mutationReceiptRefs) {
      const receipt = receiptById.get(receiptRef);
      if (!receipt) {
        errors.push(`rejection coverage references missing mutation receipt ${receiptRef}`);
        continue;
      }
      if (receipt.subsystemId !== coverage.subsystemId) {
        errors.push(`mutation receipt ${receiptRef} belongs to another subsystem`);
      }
      if (receipt.invariantId !== claim.invariantId) {
        errors.push(`mutation receipt ${receiptRef} belongs to another invariant`);
      }
      if (receipt.subject.sourceDigest !== coverage.subjectDigest) {
        errors.push(`mutation receipt ${receiptRef} belongs to another subject digest`);
      }
      if (receipt.subject.validatorArtifactDigest !== coverage.validatorArtifactDigest) {
        errors.push(`mutation receipt ${receiptRef} belongs to another validator artifact digest`);
      }
      if (receipt.subject.testBundleDigest !== coverage.testBundleDigest) {
        errors.push(`mutation receipt ${receiptRef} belongs to another test bundle digest`);
      }
      if (receipt.subject.contractRef !== coverage.contractRef) {
        errors.push(`mutation receipt ${receiptRef} belongs to another contract`);
      }
      if (claim.status === 'demonstrated' && receipt.disposition !== 'killed') {
        errors.push(`demonstrated claim ${claim.invariantId} cites a non-killed mutation`);
      }
      if (claim.status === 'survived' && !['killed', 'survived'].includes(receipt.disposition)) {
        errors.push(`survived claim ${claim.invariantId} cites an unusable mutation disposition`);
      }
      if (claim.status === 'inconclusive' && !['inconclusive', 'not-run'].includes(receipt.disposition)) {
        errors.push(`inconclusive claim ${claim.invariantId} cites a conclusive mutation`);
      }
    }

    const applicableReceipts = receipts.filter((receipt) =>
      receipt.subsystemId === coverage.subsystemId
      && receipt.invariantId === claim.invariantId
      && receipt.subject.sourceDigest === coverage.subjectDigest
      && receipt.subject.validatorArtifactDigest === coverage.validatorArtifactDigest
      && receipt.subject.testBundleDigest === coverage.testBundleDigest
      && receipt.subject.contractRef === coverage.contractRef);
    const referenced = new Set(claim.mutationReceiptRefs);
    const missingApplicable = applicableReceipts.filter((receipt) => !referenced.has(receipt.receiptId));
    if (missingApplicable.length > 0) {
      errors.push(`rejection coverage claim ${claim.invariantId} omits applicable mutation receipt(s): ${missingApplicable.map((receipt) => receipt.receiptId).join(', ')}`);
    }
    if (claim.status === 'inconclusive' && (claim.mutationReceiptRefs.length === 0 || typeof claim.gapReason !== 'string' || claim.gapReason.length < 8)) {
      errors.push(`inconclusive claim ${claim.invariantId} must name evidence and a gap reason`);
    }
  }

  const referencedReceiptIds = new Set(coverage.claims.flatMap((claim) => claim.mutationReceiptRefs));
  for (const receipt of receipts) {
    if (receipt.disposition === 'killed' && receipt.subsystemId === coverage.subsystemId
      && receipt.subject.sourceDigest === coverage.subjectDigest
      && receipt.subject.validatorArtifactDigest === coverage.validatorArtifactDigest
      && receipt.subject.testBundleDigest === coverage.testBundleDigest
      && receipt.subject.contractRef === coverage.contractRef
      && !referencedReceiptIds.has(receipt.receiptId)) {
      errors.push(`killed mutation receipt ${receipt.receiptId} is orphaned from rejection coverage`);
    }
  }

  const importantClaimCount = coverage.claims.filter((claim) => claim.criticality === 'important').length;
  if (coverage.summary.importantClaimCount !== importantClaimCount) {
    errors.push('rejection coverage important-claim summary does not match named rows');
  }
  if (coverage.summary.demonstratedCount !== countClaims(coverage.claims, 'demonstrated')) {
    errors.push('rejection coverage demonstrated summary does not match named rows');
  }
  if (coverage.summary.survivedCount !== countClaims(coverage.claims, 'survived')) {
    errors.push('rejection coverage survived summary does not match named rows');
  }
  if (coverage.summary.notDemonstratedCount !== countClaims(coverage.claims, 'not-demonstrated')) {
    errors.push('rejection coverage not-demonstrated summary does not match named rows');
  }
  if (coverage.summary.inconclusiveCount !== countClaims(coverage.claims, 'inconclusive')) {
    errors.push('rejection coverage inconclusive summary does not match named rows');
  }
  return errors;
}
