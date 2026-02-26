/**
 * meeting-intelligence — Full meeting lifecycle management for AI agents.
 *
 * State machine: upcoming → active → processing → completed | cancelled
 *
 * @module meeting-intelligence
 * @see https://github.com/FutureSpeakAI/meeting-intelligence
 */

export { MeetingIntelligenceEngine } from './meeting-intelligence';
export { JsonFileStorage } from './json-storage';

export type {
  Meeting,
  MeetingStatus,
  MeetingAgent,
  MeetingNote,
  NoteType,
  NoteAuthor,
  AttendeeIntel,
  MeetingPlatform,
  MeetingIntelConfig,
  MeetingProviders,
  StorageProvider,
  SummarizerFn,
  AttendeeIntelProvider,
  MemoryStoreFn,
  BriefingGeneratorFn,
  CalendarEvent,
  MeetingSummaryResult,
  MeetingStats,
} from './types';
