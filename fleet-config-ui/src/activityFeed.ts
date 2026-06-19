import type { ActivityEntry, StoryNote } from './types';

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringifyList(values: string[], label: string): string {
  if (values.length === 0) return '';
  const preview = values.slice(0, 3).join(', ');
  const suffix = values.length > 3 ? ` +${values.length - 3} more` : '';
  return `${label}: ${preview}${suffix}`;
}

function metadataFiles(entry: ActivityEntry): string[] {
  const files = entry.metadata?.files;
  if (!Array.isArray(files)) return [];
  return files.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function metadataReleasedFiles(entry: ActivityEntry): string[] {
  const files = entry.metadata?.releasedFiles;
  if (!Array.isArray(files)) return [];
  return files.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export function isMeaningfulStory(story: StoryNote): boolean {
  return cleanText(story.content).length > 0;
}

export function summarizeActivityEntry(entry: ActivityEntry): string {
  const details = cleanText(entry.details);
  const files = metadataFiles(entry);
  const releasedFiles = metadataReleasedFiles(entry);
  const sessionId = cleanText(entry.metadata?.sessionId);

  switch (entry.type) {
    case 'agent.heartbeat':
      return '';
    case 'session.start':
      return details;
    case 'session.end':
      if (details.length > 0) return details;
      if (releasedFiles.length > 0) return stringifyList(releasedFiles, 'Released');
      return '';
    case 'session.note':
      return '';
    case 'sugar_begin':
      return details;
    case 'message.publish':
      return details.length > 4 ? details : '';
    case 'file.claim':
      return stringifyList(files, 'Claimed');
    case 'file.release':
      return stringifyList(files.length > 0 ? files : releasedFiles, 'Released');
    default:
      if (details.length > 0) return details;
      if (files.length > 0) return stringifyList(files, 'Files');
      if (releasedFiles.length > 0) return stringifyList(releasedFiles, 'Released');
      if (sessionId) return sessionId;
      return '';
  }
}

export function isMeaningfulActivityEntry(entry: ActivityEntry): boolean {
  return summarizeActivityEntry(entry).length > 0;
}

export function activityTouchedFiles(entry: ActivityEntry): string[] {
  return [...new Set([...metadataFiles(entry), ...metadataReleasedFiles(entry)])];
}
