import type { RoadmapProgress } from '../types';

export function summarizeRoadmapProgress(progress: RoadmapProgress | null): string {
  if (!progress) return 'No roadmap projection loaded.';
  return `${progress.nextCuts.length} next cuts, ${progress.ideasNow.length} now, ${progress.dogfoodFeedback.length} feedback`;
}
