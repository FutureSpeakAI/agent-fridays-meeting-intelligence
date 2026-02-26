/**
 * meeting-intelligence — Full meeting lifecycle management for AI agents.
 *
 * State machine:  upcoming → active → processing → completed | cancelled
 *
 * Features:
 *  - Meeting lifecycle with timestamps and crash recovery
 *  - Agent-meeting binding (custom AI instructions per meeting)
 *  - Live note-taking during active meetings
 *  - Post-meeting summarization via pluggable LLM
 *  - Attendee intelligence via pluggable provider
 *  - Meeting history with full-text search
 *  - Context injection into system prompt
 *  - Calendar event bridging
 *
 * Framework-agnostic: no Electron, no specific LLM SDK.
 * Bring your own storage, summarizer, and attendee intelligence.
 *
 * @module meeting-intelligence
 * @see https://github.com/FutureSpeakAI/meeting-intelligence
 */

import crypto from 'crypto';

import type {
  Meeting,
  MeetingStatus,
  MeetingNote,
  MeetingIntelConfig,
  MeetingProviders,
  AttendeeIntel,
  CalendarEvent,
  MeetingStats,
  MeetingAgent,
} from './types';

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: MeetingIntelConfig = {
  maxMeetings: 200,
  autoSummarize: true,
  autoExtractActions: true,
  retentionDays: 90,
};

// ── Meeting Intelligence Engine ─────────────────────────────────────

export class MeetingIntelligenceEngine {
  private meetings: Meeting[] = [];
  private config: MeetingIntelConfig;
  private providers: MeetingProviders;
  private saveQueue: Promise<void> = Promise.resolve();
  private activeMeetingId: string | null = null;

  constructor(providers: MeetingProviders, config?: Partial<MeetingIntelConfig>) {
    this.providers = providers;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the engine — loads meetings from storage, applies
   * crash recovery, prunes old meetings.
   */
  async initialize(): Promise<void> {
    try {
      const data = await this.providers.storage.load();
      this.meetings = data.meetings || [];
      if (data.config) {
        this.config = { ...DEFAULT_CONFIG, ...data.config };
      }
    } catch {
      this.meetings = [];
    }

    // Prune old completed meetings beyond retention
    this.pruneOldMeetings();

    // Crash recovery: recover meetings stuck in 'active' or 'processing'
    for (const m of this.meetings) {
      if (m.status === 'active' && m.startedAt) {
        const hoursActive = (Date.now() - m.startedAt) / (60 * 60 * 1000);
        if (hoursActive > 8) {
          m.status = 'completed';
          m.endedAt = m.startedAt + 60 * 60 * 1000;
        }
      }
      if (m.status === 'processing') {
        m.status = 'completed';
      }
    }

    await this.save();
  }

  // ── CRUD Operations ─────────────────────────────────────────────

  /**
   * Create a new meeting.
   */
  createMeeting(opts: {
    name: string;
    description?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    attendees?: string[];
    meetingUrl?: string;
    platform?: Meeting['platform'];
    calendarEventId?: string;
    agent?: MeetingAgent;
    tags?: string[];
    projectName?: string;
  }): Meeting {
    const id = crypto.randomUUID().slice(0, 12);

    // Build attendee intelligence if provider is available
    const attendeeIntel: AttendeeIntel[] = [];
    for (const attendee of (opts.attendees || []).slice(0, 15)) {
      attendeeIntel.push(this.buildAttendeeIntel(attendee));
    }

    const meeting: Meeting = {
      id,
      name: opts.name,
      description: opts.description || '',
      status: 'upcoming',
      calendarEventId: opts.calendarEventId,
      agent: opts.agent,
      attendees: opts.attendees || [],
      attendeeIntel,
      createdAt: Date.now(),
      scheduledStart: opts.scheduledStart,
      scheduledEnd: opts.scheduledEnd,
      meetingUrl: opts.meetingUrl,
      platform: opts.platform || this.detectPlatform(opts.meetingUrl),
      notes: [],
      tags: opts.tags || [],
      projectName: opts.projectName,
    };

    this.meetings.unshift(meeting);

    // Enforce max meetings
    if (this.meetings.length > this.config.maxMeetings) {
      this.meetings = this.meetings.slice(0, this.config.maxMeetings);
    }

    this.save();
    return meeting;
  }

  /**
   * Get a meeting by ID.
   */
  getMeeting(id: string): Meeting | null {
    return this.meetings.find((m) => m.id === id) || null;
  }

  /**
   * Get the currently active meeting.
   */
  getActiveMeeting(): Meeting | null {
    if (!this.activeMeetingId) return null;
    return this.getMeeting(this.activeMeetingId);
  }

  /**
   * List meetings with optional filters.
   */
  listMeetings(opts?: {
    status?: MeetingStatus;
    limit?: number;
    search?: string;
  }): Meeting[] {
    let results = [...this.meetings];

    if (opts?.status) {
      results = results.filter((m) => m.status === opts.status);
    }

    if (opts?.search) {
      const q = opts.search.toLowerCase();
      results = results.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.summary?.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)) ||
          m.attendees.some((a) => a.toLowerCase().includes(q)),
      );
    }

    return results.slice(0, opts?.limit || 50);
  }

  // ── Lifecycle State Machine ─────────────────────────────────────

  /**
   * Transition: upcoming → active
   */
  async startMeeting(meetingId: string): Promise<Meeting | null> {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;
    if (meeting.status !== 'upcoming') return meeting;

    meeting.status = 'active';
    meeting.startedAt = Date.now();
    this.activeMeetingId = meetingId;

    // Generate pre-meeting briefing if provider is available
    if (this.providers.briefingGenerator) {
      try {
        const briefing = await this.providers.briefingGenerator(meeting);
        if (briefing) {
          meeting.briefingText = briefing;
        }
      } catch {
        // Briefing generation non-critical
      }
    }

    // Auto-add a start note
    meeting.notes.push({
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      author: 'auto',
      content: `Meeting started at ${new Date().toLocaleTimeString()}`,
      type: 'note',
    });

    await this.save();
    return meeting;
  }

  /**
   * Transition: active → processing → completed
   */
  async endMeeting(meetingId: string, opts?: {
    transcript?: string;
    recording?: string;
  }): Promise<Meeting | null> {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;
    if (meeting.status !== 'active') return meeting;

    meeting.status = 'processing';
    meeting.endedAt = Date.now();

    if (opts?.transcript) meeting.transcript = opts.transcript;
    if (opts?.recording) meeting.recording = opts.recording;

    // Auto-add an end note
    const durationMins = meeting.startedAt
      ? Math.round((Date.now() - meeting.startedAt) / 60000)
      : 0;
    meeting.notes.push({
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      author: 'auto',
      content: `Meeting ended after ${durationMins} minutes`,
      type: 'note',
    });

    // Clear active meeting
    if (this.activeMeetingId === meetingId) {
      this.activeMeetingId = null;
    }

    await this.save();

    // Run post-meeting processing asynchronously
    this.postMeetingProcessing(meeting).catch(() => {});

    return meeting;
  }

  /**
   * Transition: upcoming → cancelled
   */
  cancelMeeting(meetingId: string): Meeting | null {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;
    if (meeting.status !== 'upcoming') return meeting;

    meeting.status = 'cancelled';
    if (this.activeMeetingId === meetingId) {
      this.activeMeetingId = null;
    }

    this.save();
    return meeting;
  }

  // ── Notes & Live Capture ────────────────────────────────────────

  /**
   * Add a note to a meeting.
   */
  addNote(meetingId: string, note: {
    content: string;
    type?: MeetingNote['type'];
    author?: MeetingNote['author'];
  }): MeetingNote | null {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;

    const entry: MeetingNote = {
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      author: note.author || 'agent',
      content: note.content,
      type: note.type || 'note',
    };

    meeting.notes.push(entry);
    this.save();
    return entry;
  }

  /**
   * Add a note to the currently active meeting.
   */
  addNoteToActive(content: string, type?: MeetingNote['type']): MeetingNote | null {
    if (!this.activeMeetingId) return null;
    return this.addNote(this.activeMeetingId, { content, type, author: 'agent' });
  }

  // ── Post-Meeting Processing ─────────────────────────────────────

  private async postMeetingProcessing(meeting: Meeting): Promise<void> {
    const hasContent =
      meeting.transcript ||
      meeting.notes.length > 1 ||
      meeting.briefingText;

    if (!hasContent) {
      meeting.status = 'completed';
      await this.save();
      return;
    }

    // Build content block for summarization
    const contentParts: string[] = [];
    contentParts.push(`Meeting: ${meeting.name}`);
    if (meeting.description) contentParts.push(`Description: ${meeting.description}`);
    contentParts.push(`Attendees: ${meeting.attendees.join(', ') || 'unknown'}`);

    if (meeting.startedAt && meeting.endedAt) {
      const durationMins = Math.round((meeting.endedAt - meeting.startedAt) / 60000);
      contentParts.push(`Duration: ${durationMins} minutes`);
    }

    const humanNotes = meeting.notes.filter((n) => n.author !== 'auto');
    if (humanNotes.length > 0) {
      contentParts.push('\n--- Notes ---');
      for (const note of humanNotes) {
        const prefix = note.type !== 'note' ? `[${note.type.toUpperCase()}] ` : '';
        contentParts.push(`${prefix}${note.content}`);
      }
    }

    if (meeting.transcript) {
      const snippet = meeting.transcript.slice(0, 3000);
      contentParts.push(`\n--- Transcript (partial) ---\n${snippet}`);
    }

    const contentBlock = contentParts.join('\n');

    // Summarize via pluggable summarizer
    if (this.config.autoSummarize && this.providers.summarizer) {
      try {
        const summary = await this.providers.summarizer(contentBlock);
        if (summary) {
          meeting.summary = summary.text;
          meeting.actionItems = summary.actionItems;
          meeting.keyDecisions = summary.decisions;
        }
      } catch {
        // Summary generation non-critical
      }
    }

    // Store key facts in long-term memory
    if (this.providers.memoryStore) {
      try {
        if (meeting.summary) {
          const fact = `Meeting "${meeting.name}" on ${new Date(meeting.startedAt || meeting.createdAt).toLocaleDateString()}: ${meeting.summary.slice(0, 200)}`;
          await this.providers.memoryStore(fact, 'professional');
        }
        if (meeting.actionItems && meeting.actionItems.length > 0) {
          const actionFact = `Action items from "${meeting.name}": ${meeting.actionItems.slice(0, 5).join('; ')}`;
          await this.providers.memoryStore(actionFact, 'professional');
        }
      } catch {
        // Memory storage non-critical
      }
    }

    meeting.status = 'completed';
    await this.save();
  }

  // ── Attendee Intelligence ───────────────────────────────────────

  private buildAttendeeIntel(attendee: string): AttendeeIntel {
    const name = attendee.includes('@')
      ? attendee.split('@')[0].replace(/[._]/g, ' ')
      : attendee;
    const isEmail = attendee.includes('@');
    const intel: AttendeeIntel = { name, email: isEmail ? attendee : undefined };

    if (this.providers.attendeeIntelProvider) {
      try {
        const enriched = this.providers.attendeeIntelProvider(name);
        Object.assign(intel, enriched);
      } catch {
        // Intel provider non-critical
      }
    }

    return intel;
  }

  /**
   * Refresh attendee intelligence for a meeting.
   */
  refreshAttendeeIntel(meetingId: string): Meeting | null {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;
    meeting.attendeeIntel = meeting.attendees.map((a) => this.buildAttendeeIntel(a));
    this.save();
    return meeting;
  }

  // ── Platform Detection ──────────────────────────────────────────

  private detectPlatform(url?: string): Meeting['platform'] {
    if (!url) return undefined;
    const lower = url.toLowerCase();
    if (lower.includes('meet.google.com')) return 'google-meet';
    if (lower.includes('zoom.us') || lower.includes('zoom.com')) return 'zoom';
    if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com')) return 'teams';
    return 'other';
  }

  // ── Calendar Sync ───────────────────────────────────────────────

  /**
   * Create a meeting from a calendar event.
   */
  createFromCalendarEvent(event: CalendarEvent): Meeting {
    const existing = this.meetings.find((m) => m.calendarEventId === event.id);
    if (existing) return existing;

    return this.createMeeting({
      name: event.summary,
      description: event.description,
      scheduledStart: event.start,
      scheduledEnd: event.end,
      attendees: event.attendees,
      meetingUrl: event.hangoutLink,
      calendarEventId: event.id,
    });
  }

  // ── Quick Start ─────────────────────────────────────────────────

  /**
   * Quick-start a meeting from a URL (e.g., when joining a call).
   */
  quickStartFromCall(meetingUrl: string, name?: string): Meeting {
    const existing = this.meetings.find(
      (m) => m.meetingUrl === meetingUrl && m.status === 'upcoming',
    );
    if (existing) {
      this.startMeeting(existing.id);
      return existing;
    }

    const meeting = this.createMeeting({
      name: name || `Meeting at ${new Date().toLocaleTimeString()}`,
      meetingUrl,
      platform: this.detectPlatform(meetingUrl),
    });
    this.startMeeting(meeting.id);
    return meeting;
  }

  /**
   * End the currently active meeting.
   */
  async endActiveMeeting(transcript?: string): Promise<Meeting | null> {
    if (!this.activeMeetingId) return null;
    return this.endMeeting(this.activeMeetingId, { transcript });
  }

  // ── Context for System Prompt ───────────────────────────────────

  /**
   * Returns a context string for injection into an AI system prompt.
   * Includes active meeting info, notes, attendee intel.
   */
  getContextString(): string {
    const active = this.getActiveMeeting();
    if (!active) return '';

    const parts: string[] = ['## Active Meeting Intelligence'];
    parts.push(`Meeting: ${active.name}`);

    if (active.startedAt) {
      const minsActive = Math.round((Date.now() - active.startedAt) / 60000);
      parts.push(`Duration: ${minsActive} minutes`);
    }

    if (active.attendees.length > 0) {
      parts.push(`Attendees: ${active.attendees.slice(0, 5).join(', ')}`);
    }

    if (active.agent) {
      parts.push(`Meeting Agent: ${active.agent.name}`);
      parts.push(`Instructions: ${active.agent.instructions}`);
    }

    const recentNotes = active.notes
      .filter((n) => n.author !== 'auto')
      .slice(-5);
    if (recentNotes.length > 0) {
      parts.push('\nRecent notes:');
      for (const note of recentNotes) {
        const prefix = note.type !== 'note' ? `[${note.type}] ` : '';
        parts.push(`  - ${prefix}${note.content}`);
      }
    }

    const topIntel = active.attendeeIntel.filter((a) => a.trustProfile).slice(0, 3);
    if (topIntel.length > 0) {
      parts.push('\nAttendee intel:');
      for (const intel of topIntel) {
        parts.push(`  ${intel.name}: trust ${((intel.trustScore || 0.5) * 100).toFixed(0)}%`);
        if (intel.domains && intel.domains.length > 0) {
          parts.push(`    Expertise: ${intel.domains.join(', ')}`);
        }
      }
    }

    if (active.briefingText) {
      parts.push(`\nBriefing: ${active.briefingText.slice(0, 300)}`);
    }

    return parts.join('\n');
  }

  // ── Update Operations ───────────────────────────────────────────

  updateMeeting(meetingId: string, updates: Partial<Pick<
    Meeting, 'name' | 'description' | 'tags' | 'agent' | 'projectName'
  >>): Meeting | null {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;

    if (updates.name !== undefined) meeting.name = updates.name;
    if (updates.description !== undefined) meeting.description = updates.description;
    if (updates.tags !== undefined) meeting.tags = updates.tags;
    if (updates.agent !== undefined) meeting.agent = updates.agent;
    if (updates.projectName !== undefined) meeting.projectName = updates.projectName;

    this.save();
    return meeting;
  }

  setTranscript(meetingId: string, transcript: string): Meeting | null {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;
    meeting.transcript = transcript;
    this.save();
    return meeting;
  }

  setSummary(meetingId: string, summary: string): Meeting | null {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;
    meeting.summary = summary;
    this.save();
    return meeting;
  }

  // ── Stats & Search ──────────────────────────────────────────────

  getStats(): MeetingStats {
    const completed = this.meetings.filter((m) => m.status === 'completed');
    const durations = completed
      .filter((m) => m.startedAt && m.endedAt)
      .map((m) => (m.endedAt! - m.startedAt!) / 60000);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    return {
      total: this.meetings.length,
      upcoming: this.meetings.filter((m) => m.status === 'upcoming').length,
      active: this.meetings.filter((m) => m.status === 'active').length,
      completed: completed.length,
      cancelled: this.meetings.filter((m) => m.status === 'cancelled').length,
      totalNotes: this.meetings.reduce((sum, m) => sum + m.notes.length, 0),
      avgDurationMins: avgDuration,
    };
  }

  searchMeetings(query: string, limit = 10): Meeting[] {
    const q = query.toLowerCase();
    return this.meetings
      .filter((m) => {
        const searchable = [
          m.name,
          m.description,
          m.summary || '',
          m.transcript || '',
          ...m.tags,
          ...m.attendees,
          ...m.notes.map((n) => n.content),
          ...(m.actionItems || []),
          ...(m.keyDecisions || []),
        ].join(' ').toLowerCase();
        return searchable.includes(q);
      })
      .slice(0, limit);
  }

  getRecentSummaries(count = 5): Array<{
    id: string;
    name: string;
    date: string;
    status: MeetingStatus;
    summary: string;
    actionItems: string[];
    attendeeCount: number;
  }> {
    return this.meetings
      .filter((m) => m.status === 'completed' || m.status === 'active')
      .slice(0, count)
      .map((m) => ({
        id: m.id,
        name: m.name,
        date: new Date(m.startedAt || m.createdAt).toLocaleDateString(),
        status: m.status,
        summary: m.summary || 'No summary available',
        actionItems: m.actionItems || [],
        attendeeCount: m.attendees.length,
      }));
  }

  getAllMeetings(): Meeting[] {
    return [...this.meetings];
  }

  // ── Maintenance ─────────────────────────────────────────────────

  private pruneOldMeetings(): void {
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    this.meetings = this.meetings.filter((m) => {
      if (m.status === 'upcoming' || m.status === 'active') return true;
      return m.createdAt > cutoff;
    });
  }

  // ── Persistence ─────────────────────────────────────────────────

  private async save(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await this.providers.storage.save(this.meetings, this.config);
      } catch {
        // Save failure non-critical
      }
    });
    await this.saveQueue;
  }

  /**
   * Graceful shutdown — ends active meeting, performs final save.
   */
  async stop(): Promise<void> {
    if (this.activeMeetingId) {
      const meeting = this.getMeeting(this.activeMeetingId);
      if (meeting && meeting.status === 'active') {
        meeting.endedAt = Date.now();
        meeting.status = 'completed';
        meeting.notes.push({
          id: crypto.randomUUID().slice(0, 8),
          timestamp: Date.now(),
          author: 'auto',
          content: 'Meeting ended (app closing)',
          type: 'note',
        });
      }
      this.activeMeetingId = null;
    }
    await this.providers.storage.save(this.meetings, this.config);
  }
}
