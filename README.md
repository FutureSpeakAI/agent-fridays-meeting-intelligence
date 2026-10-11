> **This project now lives on in [Agent-Friday](https://github.com/FutureSpeakAI/Agent-Friday), archived 2026-10-11.**

# meeting-intelligence

> Full meeting lifecycle management for AI agents — state machine, live notes, post-meeting summarization, attendee intelligence, and context injection.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Meetings are where context is created, decisions are made, and tasks are born — yet most AI agents treat them as afterthoughts. **meeting-intelligence** manages the complete meeting lifecycle: from calendar sync through live note-taking to post-meeting summarization and memory storage.

The engine tracks meetings through a formal state machine (`upcoming → active → processing → completed`), enriches attendees with pluggable intelligence providers, generates AI summaries via your LLM of choice, and injects active meeting context into your agent's system prompt so it always knows what's happening.

**Zero dependencies. Framework-agnostic. Bring your own storage and LLM.**

---

## Origin

Extracted from [Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday) — the world's most trustworthy AI assistant, by **FutureSpeak.AI**. The meeting intelligence system is one of several novel subsystems that give Agent Friday deep situational awareness across the user's professional life. This library packages the core meeting engine as a standalone, framework-agnostic module.

---

## Install

```bash
npm install meeting-intelligence
```

---

## Quick Start

```typescript
import {
  MeetingIntelligenceEngine,
  JsonFileStorage,
} from 'meeting-intelligence';

// 1. Create the engine with storage
const engine = new MeetingIntelligenceEngine({
  storage: new JsonFileStorage('./data/meetings.json'),
  summarizer: async (content) => {
    // Your LLM call here (OpenAI, Anthropic, OpenRouter, etc.)
    return { text: 'Summary...', actionItems: ['...'], decisions: ['...'] };
  },
});

await engine.initialize();

// 2. Create a meeting
const meeting = engine.createMeeting({
  name: 'Sprint Planning',
  attendees: ['alice@co.com', 'bob@co.com'],
  scheduledStart: '2025-03-01T10:00:00Z',
});

// 3. Start when the meeting begins
await engine.startMeeting(meeting.id);

// 4. Take notes during the meeting
engine.addNoteToActive('Team agreed to focus on auth this sprint', 'decision');
engine.addNoteToActive('Bob to prepare API spec by Friday', 'action-item');

// 5. End the meeting — auto-summarization kicks in
await engine.endMeeting(meeting.id, {
  transcript: 'Alice: Let\'s discuss...\nBob: I think...',
});
```

---

## Meeting Lifecycle

```
  ┌───────────┐     startMeeting()     ┌──────────┐
  │  upcoming  │───────────────────────▶│  active   │
  └───────────┘                        └──────────┘
       │                                     │
       │ cancelMeeting()              endMeeting()
       ▼                                     ▼
  ┌───────────┐                        ┌────────────┐
  │ cancelled  │                        │ processing │
  └───────────┘                        └────────────┘
                                             │
                                    auto (summarize, extract)
                                             ▼
                                       ┌───────────┐
                                       │ completed  │
                                       └───────────┘
```

Each transition is timestamped. Crash recovery automatically resolves meetings stuck in `active` (>8 hours) or `processing` states.

---

## Features

| Feature | Description |
|---------|-------------|
| **State machine** | Formal lifecycle with crash recovery |
| **Live notes** | Typed notes: `note`, `action-item`, `decision`, `question`, `insight` |
| **Agent binding** | Custom AI persona/instructions per meeting |
| **Auto-summarization** | Post-meeting LLM summary via pluggable `SummarizerFn` |
| **Action extraction** | Automatic action item and key decision extraction |
| **Attendee intelligence** | Enriched attendee profiles via pluggable provider |
| **Calendar sync** | Create meetings from calendar events |
| **Quick start** | Join a call URL → instant meeting creation |
| **Full-text search** | Search across names, notes, transcripts, summaries |
| **Context injection** | `getContextString()` for system prompt enrichment |
| **Memory storage** | Store key facts via pluggable memory provider |
| **Platform detection** | Auto-detect Google Meet, Zoom, Teams from URLs |
| **Retention** | Configurable auto-pruning of old meetings |

---

## API

### `new MeetingIntelligenceEngine(providers, config?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `providers` | `MeetingProviders` | Storage + optional enrichment providers |
| `config` | `Partial<MeetingIntelConfig>` | Optional overrides |

### Providers

| Provider | Type | Required? | Description |
|----------|------|-----------|-------------|
| `storage` | `StorageProvider` | **Yes** | Persistence layer |
| `summarizer` | `SummarizerFn` | No | LLM for post-meeting summarization |
| `attendeeIntelProvider` | `AttendeeIntelProvider` | No | Enrich attendee profiles |
| `memoryStore` | `MemoryStoreFn` | No | Store key facts in long-term memory |
| `briefingGenerator` | `BriefingGeneratorFn` | No | Pre-meeting briefing generation |

### Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `maxMeetings` | `200` | Max stored meetings |
| `autoSummarize` | `true` | Auto-summarize on end |
| `autoExtractActions` | `true` | Auto-extract action items |
| `retentionDays` | `90` | Days to keep old meetings |

### Lifecycle Methods

| Method | Description |
|--------|-------------|
| `initialize()` | Load from storage, apply crash recovery |
| `createMeeting(opts)` | Create a new meeting |
| `startMeeting(id)` | Transition to active |
| `endMeeting(id, opts?)` | End meeting, trigger processing |
| `cancelMeeting(id)` | Cancel an upcoming meeting |
| `stop()` | Graceful shutdown |

### During-Meeting Methods

| Method | Description |
|--------|-------------|
| `addNote(id, note)` | Add a typed note |
| `addNoteToActive(content, type?)` | Add note to active meeting |
| `setTranscript(id, text)` | Set transcript text |

### Query Methods

| Method | Description |
|--------|-------------|
| `getMeeting(id)` | Get by ID |
| `getActiveMeeting()` | Get current active meeting |
| `listMeetings(opts?)` | Filter by status, search text |
| `searchMeetings(query, limit?)` | Full-text search |
| `getRecentSummaries(count?)` | Recent completed meeting summaries |
| `getStats()` | Aggregate statistics |
| `getContextString()` | System prompt context for active meeting |

---

## Storage Providers

### Built-in: `JsonFileStorage`

```typescript
import { JsonFileStorage } from 'meeting-intelligence';
const storage = new JsonFileStorage('/path/to/meetings.json');
```

### Custom: Implement `StorageProvider`

```typescript
import { StorageProvider, Meeting, MeetingIntelConfig } from 'meeting-intelligence';

class MyDatabaseStorage implements StorageProvider {
  async load() {
    const meetings = await db.query('SELECT * FROM meetings');
    return { meetings };
  }

  async save(meetings: Meeting[], config: MeetingIntelConfig) {
    await db.upsertMeetings(meetings);
    await db.saveConfig(config);
  }
}
```

---

## Attendee Intelligence

Plug in a trust graph, CRM, or contact database:

```typescript
const engine = new MeetingIntelligenceEngine({
  storage,
  attendeeIntelProvider: (name) => {
    const person = trustGraph.resolvePerson(name);
    return {
      name: person?.primaryName || name,
      trustScore: person?.trust.overall,
      domains: person?.domains,
      trustProfile: trustGraph.getContextForPerson(person?.id),
    };
  },
});
```

When a meeting is created, each attendee is automatically enriched with intelligence from your provider. Call `refreshAttendeeIntel(meetingId)` to update if your data changes.

---

## System Prompt Injection

Inject active meeting context into your agent's system prompt:

```typescript
const context = engine.getContextString();
if (context) {
  systemPrompt += `\n\n${context}`;
}
```

This gives the agent awareness of the current meeting, attendees, recent notes, and briefing — so it can participate intelligently.

---

## Design Philosophy

1. **Lifecycle-first** — Meetings are stateful objects with well-defined transitions. The state machine prevents impossible states and handles crash recovery automatically.

2. **Pluggable everything** — Storage, summarization, attendee intelligence, memory, and briefing generation are all pluggable interfaces. Use what you need, ignore what you don't.

3. **Note typing** — Notes aren't just text. They're typed (`decision`, `action-item`, `question`, `insight`, `note`) so your agent and post-processing can distinguish what matters.

4. **Silent failure** — Every optional provider is wrapped in try/catch. Meeting intelligence enhances the agent, but never crashes it.

5. **Context-aware agents** — `getContextString()` is the bridge between meeting data and agent behavior. The agent always knows what meeting it's in, who's there, and what's been discussed.

---

## License

MIT — see [LICENSE](./LICENSE).

Built by [FutureSpeak.AI](https://futurespeak.ai) as part of [Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday), the world's most trustworthy AI assistant.
