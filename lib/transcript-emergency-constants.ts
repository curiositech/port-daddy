export const TRANSCRIPT_EMERGENCY_EVENT = {
  WRITE_FAILED: 'transcript-write-failed',
  WRITE_FAILED_LEGACY: 'transcript_write_failed',
} as const;

export type TranscriptEmergencyEvent = typeof TRANSCRIPT_EMERGENCY_EVENT[keyof typeof TRANSCRIPT_EMERGENCY_EVENT];
export const TRANSCRIPT_EMERGENCY_EVENTS = Object.values(TRANSCRIPT_EMERGENCY_EVENT) as readonly TranscriptEmergencyEvent[];
