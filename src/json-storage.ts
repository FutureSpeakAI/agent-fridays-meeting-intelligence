/**
 * Built-in JSON file storage provider for meeting-intelligence.
 *
 * Drop-in storage that persists meetings to a JSON file on disk.
 * Use this as a reference for implementing your own StorageProvider.
 *
 * @module meeting-intelligence
 */

import fs from 'fs/promises';
import path from 'path';

import type { Meeting, MeetingIntelConfig, StorageProvider } from './types';

export class JsonFileStorage implements StorageProvider {
  private filePath: string;

  /**
   * @param filePath - Absolute path to the JSON file (e.g., '/data/meetings.json')
   */
  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async load(): Promise<{ meetings: Meeting[]; config?: Partial<MeetingIntelConfig> }> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      return {
        meetings: data.meetings || [],
        config: data.config,
      };
    } catch {
      return { meetings: [] };
    }
  }

  async save(meetings: Meeting[], config: MeetingIntelConfig): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const data = JSON.stringify({ meetings, config }, null, 2);
    await fs.writeFile(this.filePath, data, 'utf-8');
  }
}
