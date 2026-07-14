const COVERAGE_BONUS_POINTS = 4;

/**
 * Reward distinct query-token coverage without allowing repeated field matches
 * to inflate the score beyond complete coverage.
 */
export function applyDistinctTokenCoverageBonus(
  score: number,
  matchedTokenCount: number,
  totalTokenCount: number,
): number {
  if (matchedTokenCount <= 0 || totalTokenCount <= 1) return score;

  const distinctMatches = Math.min(matchedTokenCount, totalTokenCount);
  const coverageBonus = Math.round(
    (distinctMatches / totalTokenCount) * COVERAGE_BONUS_POINTS,
  );
  const completeQueryBonus = distinctMatches === totalTokenCount
    ? totalTokenCount * COVERAGE_BONUS_POINTS
    : 0;

  return score + coverageBonus + completeQueryBonus;
}
