/**
 * meeting-intelligence — Type definitions
 *
 * @module meeting-intelligence
 * @see https://github.com/FutureSpeakAI/meeting-intelligence
 */

// ── Meeting Status ───────────────────────────────────────────────────

export type MeetingStatus = 'upcoming' | 'active' | 'processing' | 'completed' | 'cancelled';

// ── Meeting Agent ────────────────────────────────────────────────────

export interface MeetingAgent {
  /** Agent persona name for this meeting */
  name: string;
  /** Custom behavioral instructions for this meeting */
  instructions: string;
}

// ── Notes ────────────────────────────────────────────────────────────

export type NoteType = 'note' | 'action-item' | 'decision' | 'question' | 'insight';
export type NoteAuthor = 'user' | 'agent' | 'auto';

export interface MeetingNote {
  id: string;
  timestamp: number;
  author: NoteAuthor;
  content: string;
  type: NoteType;
}

// ── Attendee Intelligence ────────────────────────────────────────────

export interface AttendeeIntel {
  name: string;
  email?: string;
  trustScore?: number;
  trustProfile?: string;
  domains?: string[];
  recentTopics?: string[];
  memories?: string[];
}

// ── Meeting Platform ─────────────────────────────────────────────────

export type MeetingPlatform = 'google-meet' | 'zoom' | 'teams' | 'other';

// ── Core Meeting Type ────────────────────────────────────────────────

export interface Meeting {
  id: string;
  name: string;
  description: string;
  status: MeetingStatus;
  calendarEventId?: string;

  /** Agent binding — custom AI persona for this meeting */
  agent?: MeetingAgent;

  /** Attendee names/emails */
  attendees: string[];
  /** Enriched attendee intelligence */
  attendeeIntel: AttendeeIntel[];

  /** Lifecycle timestamps */
  createdAt: number;
  scheduledStart?: string;
  scheduledEnd?: string;
  startedAt?: number;
  endedAt?: number;

  /** Meeting link */
  meetingUrl?: string;
  platform?: MeetingPlatform;

  /** Content */
  notes: MeetingNote[];
  transcript?: string;
  transcriptUrl?: string;
  recording?: string;
  summary?: string;
  actionItems?: string[];
  keyDecisions?: string[];

  /** Pre-meeting briefing text */
  briefingText?: string;

  /** Tags & metadata */
  tags: string[];
  projectName?: string;
}

// ── Configuration ────────────────────────────────────────────────────

export interface MeetingIntelConfig {
  /** Max stored meetings. Default: 200 */
  maxMeetings: number;
  /** Auto-summarize when meeting ends. Default: true */
  autoSummarize: boolean;
  /** Auto-extract action items. Default: true */
  autoExtractActions: boolean;
  /** How long to keep old meetings (days). Default: 90 */
  retentionDays: number;
}

// ── Storage Provider ─────────────────────────────────────────────────

/**
 * You implement this to persist meetings to your storage layer.
 * Could be a JSON file, SQLite, IndexedDB, cloud, etc.
 */
export interface StorageProvider {
  load(): Promise<{ meetings: Meeting[]; config?: Partial<MeetingIntelConfig> }>;
  save(meetings: Meeting[], config: MeetingIntelConfig): Promise<void>;
}

// ── Summarizer ───────────────────────────────────────────────────────

/**
 * You implement this to connect to your LLM for post-meeting summarization.
 * The engine passes a content block and expects a summary + action items back.
 */
export type SummarizerFn = (content: string) => Promise<{
  text: string;
  actionItems: string[];
  decisions: string[];
} | null>;

// ── Attendee Intel Provider ──────────────────────────────────────────

/**
 * Optional: provide enriched intelligence about meeting attendees.
 * Hook this up to a trust graph, CRM, or contact database.
 */
export type AttendeeIntelProvider = (name: string) => AttendeeIntel;

// ── Memory Store ─────────────────────────────────────────────────────

/**
 * Optional: store key facts from meetings in long-term memory.
 */
export type MemoryStoreFn = (fact: string, category?: string) => Promise<void>;

// ── Briefing Generator ───────────────────────────────────────────────

/**
 * Optional: generate pre-meeting briefings.
 * Hook this up to your calendar/meeting prep system.
 */
export type BriefingGeneratorFn = (meeting: Meeting) => Promise<string | null>;

// ── Providers Bundle ─────────────────────────────────────────────────

/**
 * All optional providers for enriching meeting intelligence.
 * At minimum you need a StorageProvider. Everything else is optional.
 */
export interface MeetingProviders {
  /** Required: how to persist meetings */
  storage: StorageProvider;
  /** Optional: LLM summarization */
  summarizer?: SummarizerFn;
  /** Optional: attendee intelligence (trust graph, CRM, etc.) */
  attendeeIntelProvider?: AttendeeIntelProvider;
  /** Optional: store facts in long-term memory */
  memoryStore?: MemoryStoreFn;
  /** Optional: generate pre-meeting briefings */
  briefingGenerator?: BriefingGeneratorFn;
}

// ── Calendar Event (bridge type) ─────────────────────────────────────

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: string[];
  hangoutLink?: string;
}

// ── Meeting Summary Result ───────────────────────────────────────────

export interface MeetingSummaryResult {
  text: string;
  actionItems: string[];
  decisions: string[];
}

// ── Stats ────────────────────────────────────────────────────────────

export interface MeetingStats {
  total: number;
  upcoming: number;
  active: number;
  completed: number;
  cancelled: number;
  totalNotes: number;
  avgDurationMins: number;
}
