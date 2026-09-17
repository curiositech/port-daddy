function countClaims(claims, status) {
  return claims.filter((claim) => claim.status === status).length;
}

export function checkPortholeMutationReceipt(receipt) {
  const errors = [];
  if (receipt.issuer.signingKeyId !== receipt.signature.keyId) {
    errors.push('mutation receipt signature key must match issuer signing key');
  }
  if (Date.parse(receipt.execution.completedAt) < Date.parse(receipt.execution.startedAt)) {
    errors.push('mutation execution cannot complete before it starts');
  }
  if (Date.parse(receipt.issuedAt) < Date.parse(receipt.execution.completedAt)) {
    errors.push('mutation receipt cannot be issued before execution completes');
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
      if (claim.status === 'demonstrated' && receipt.disposition !== 'killed') {
        errors.push(`demonstrated claim ${claim.invariantId} cites a non-killed mutation`);
      }
    }
  }

  const importantClaimCount = coverage.claims.filter((claim) => claim.criticality === 'important').length;
  if (coverage.summary.importantClaimCount !== importantClaimCount) {
    errors.push('rejection coverage important-claim summary does not match named rows');
  }
  if (coverage.summary.demonstratedCount !== countClaims(coverage.claims, 'demonstrated')) {
    errors.push('rejection coverage demonstrated summary does not match named rows');
  }
  if (coverage.summary.notDemonstratedCount !== countClaims(coverage.claims, 'not-demonstrated')) {
    errors.push('rejection coverage not-demonstrated summary does not match named rows');
  }
  if (coverage.summary.inconclusiveCount !== countClaims(coverage.claims, 'inconclusive')) {
    errors.push('rejection coverage inconclusive summary does not match named rows');
  }
  return errors;
}
