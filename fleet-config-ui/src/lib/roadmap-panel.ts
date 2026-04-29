import type { RoadmapProgress } from '../types';

export function summarizeRoadmapProgress(progress: RoadmapProgress | null): string {
  if (!progress) return 'No roadmap projection loaded.';
  const liveOpen = progress.feedbackSummary?.open ?? progress.liveFeedback.length;
  return `${progress.nextCuts.length} next cuts, ${progress.ideasNow.length} now, ${liveOpen} live feedback, ${progress.dogfoodFeedback.length} curated`;
}
