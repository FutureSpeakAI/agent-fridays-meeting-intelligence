/**
 * meeting-intelligence — Basic Usage Example
 *
 * Shows how to wire storage, summarizer, and attendee intelligence
 * into the meeting lifecycle engine.
 *
 * Run: npx ts-node examples/basic-usage.ts
 */

import {
  MeetingIntelligenceEngine,
  JsonFileStorage,
  SummarizerFn,
  AttendeeIntelProvider,
} from '../src';

// ── 1. Create storage ─────────────────────────────────────────────────
// JsonFileStorage is built-in. You can also implement StorageProvider
// for SQLite, IndexedDB, cloud, etc.

const storage = new JsonFileStorage('./data/meetings.json');

// ── 2. Optional: LLM summarizer ──────────────────────────────────────
// Hook up to your preferred LLM for post-meeting summarization.

const summarizer: SummarizerFn = async (content: string) => {
  // Replace with your actual LLM call (OpenAI, Anthropic, OpenRouter, etc.)
  console.log('[Summarizer] Would summarize:', content.slice(0, 100) + '...');
  return {
    text: 'This is a placeholder summary. Integrate your LLM here.',
    actionItems: ['Follow up on the project timeline', 'Schedule next review'],
    decisions: ['Approved the Q1 budget'],
  };
};

// ── 3. Optional: attendee intelligence ────────────────────────────────
// Hook up to a trust graph, CRM, or contact database.

const attendeeIntel: AttendeeIntelProvider = (name: string) => {
  // Replace with your actual person lookup
  return {
    name,
    trustScore: 0.8,
    domains: ['engineering', 'product'],
    memories: [`${name} mentioned they're working on the new API`],
  };
};

// ── 4. Create the engine ──────────────────────────────────────────────

async function main() {
  const engine = new MeetingIntelligenceEngine(
    {
      storage,
      summarizer,
      attendeeIntelProvider: attendeeIntel,
      memoryStore: async (fact, category) => {
        console.log(`[Memory] Storing: [${category}] ${fact}`);
      },
    },
    {
      maxMeetings: 100,
      autoSummarize: true,
      retentionDays: 60,
    },
  );

  await engine.initialize();
  console.log('Engine initialized. Stats:', engine.getStats());

  // ── Create a meeting ────────────────────────────────────────────
  const meeting = engine.createMeeting({
    name: 'Sprint Planning',
    description: 'Plan the next two-week sprint',
    attendees: ['alice@example.com', 'bob@example.com', 'carol@example.com'],
    scheduledStart: new Date(Date.now() + 3600000).toISOString(),
    tags: ['sprint', 'planning'],
    projectName: 'Project Nova',
  });
  console.log(`\nCreated meeting: ${meeting.name} (${meeting.id})`);
  console.log(`Attendee intel:`, meeting.attendeeIntel.map(a => `${a.name} (trust: ${a.trustScore})`));

  // ── Start the meeting ───────────────────────────────────────────
  await engine.startMeeting(meeting.id);
  console.log(`\nMeeting started. Status: ${engine.getMeeting(meeting.id)?.status}`);

  // ── Take notes during the meeting ───────────────────────────────
  engine.addNote(meeting.id, {
    content: 'Team agreed to focus on authentication this sprint',
    type: 'decision',
  });

  engine.addNote(meeting.id, {
    content: 'Bob to prepare the API spec by Friday',
    type: 'action-item',
  });

  engine.addNoteToActive('Discussed the timeline for the new dashboard');

  console.log(`\nNotes added: ${engine.getMeeting(meeting.id)?.notes.length}`);

  // ── End the meeting ─────────────────────────────────────────────
  await engine.endMeeting(meeting.id, {
    transcript: 'Alice: Let\'s discuss the sprint goals...\nBob: I think we should focus on...',
  });

  // Wait for async post-processing
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const completed = engine.getMeeting(meeting.id);
  console.log(`\nMeeting completed:`);
  console.log(`  Summary: ${completed?.summary}`);
  console.log(`  Action items: ${completed?.actionItems?.join(', ')}`);
  console.log(`  Decisions: ${completed?.keyDecisions?.join(', ')}`);

  // ── System prompt context ───────────────────────────────────────
  console.log(`\nContext for system prompt:\n${engine.getContextString() || '(no active meeting)'}`);

  // ── Search meeting history ──────────────────────────────────────
  const results = engine.searchMeetings('sprint');
  console.log(`\nSearch "sprint": found ${results.length} meetings`);

  // ── Stats ───────────────────────────────────────────────────────
  console.log('\nFinal stats:', engine.getStats());

  // ── Graceful shutdown ───────────────────────────────────────────
  await engine.stop();
  console.log('\nEngine stopped.');
}

main().catch(console.error);
