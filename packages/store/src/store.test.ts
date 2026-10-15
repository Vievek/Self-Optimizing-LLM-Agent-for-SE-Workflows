import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MemoryStore, FileStore } from './index.js';

const UserRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number().min(0).max(100),
});
type UserRecord = z.infer<typeof UserRecordSchema>;

describe('Store Implementations', () => {
  describe('MemoryStore', () => {
    let store: MemoryStore;

    beforeEach(() => {
      store = new MemoryStore();
    });

    it('writes and reads JSON objects with schema validation', async () => {
      const data: UserRecord = { id: 'u1', name: 'Alice', score: 95 };
      await store.write('users/u1.json', data, UserRecordSchema);

      const readBack = await store.read<UserRecord>('users/u1.json', UserRecordSchema);
      expect(readBack).toEqual(data);
    });

    it('rejects writing invalid data when schema is provided', async () => {
      const invalidData = { id: 'u2', name: 'Bob', score: 150 }; // score > 100
      await expect(store.write('users/u2.json', invalidData, UserRecordSchema)).rejects.toThrow();
    });

    it('appends and reads JSONL streams validating each record', async () => {
      const u1: UserRecord = { id: 'u1', name: 'Alice', score: 95 };
      const u2: UserRecord = { id: 'u2', name: 'Bob', score: 80 };

      await store.append('streams/users.jsonl', u1, UserRecordSchema);
      await store.append('streams/users.jsonl', u2, UserRecordSchema);

      const stream = await store.readJsonl<UserRecord>('streams/users.jsonl', UserRecordSchema);
      expect(stream.length).toBe(2);
      expect(stream[0]).toEqual(u1);
      expect(stream[1]).toEqual(u2);
    });

    it('lists files filtered by prefix', async () => {
      await store.write('traces/run1/t1.json', { a: 1 });
      await store.write('traces/run1/t2.json', { a: 2 });
      await store.write('events/ev1.json', { b: 1 });

      const all = await store.list();
      expect(all).toContain('traces/run1/t1.json');
      expect(all).toContain('events/ev1.json');

      const traces = await store.list('traces/run1');
      expect(traces.length).toBe(2);
      expect(traces).not.toContain('events/ev1.json');
    });

    it('handles exists and delete', async () => {
      await store.write('temp.json', { val: 123 });
      expect(await store.exists('temp.json')).toBe(true);

      await store.delete('temp.json');
      expect(await store.exists('temp.json')).toBe(false);
    });
  });

  describe('FileStore', () => {
    const testDir = path.resolve(process.cwd(), 'scratch/test-store');
    let store: FileStore;

    beforeEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
      store = new FileStore(testDir);
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('writes and reads files to disk with schema validation', async () => {
      const data: UserRecord = { id: 'u1', name: 'Charlie', score: 88 };
      await store.write('records/user.json', data, UserRecordSchema);

      expect(await store.exists('records/user.json')).toBe(true);
      const readBack = await store.read<UserRecord>('records/user.json', UserRecordSchema);
      expect(readBack).toEqual(data);
    });

    it('appends records to JSONL on disk and reads them back', async () => {
      const r1: UserRecord = { id: 'u1', name: 'User 1', score: 50 };
      const r2: UserRecord = { id: 'u2', name: 'User 2', score: 75 };

      await store.append('logs/audit.jsonl', r1, UserRecordSchema);
      await store.append('logs/audit.jsonl', r2, UserRecordSchema);

      const items = await store.readJsonl<UserRecord>('logs/audit.jsonl', UserRecordSchema);
      expect(items.length).toBe(2);
      expect(items[0]).toEqual(r1);
      expect(items[1]).toEqual(r2);
    });

    it('prevents path traversal attacks outside base directory', async () => {
      await expect(store.write('../../../outside.json', { hack: true })).rejects.toThrow(
        'Security error',
      );
    });

    it('lists all relative files recursively', async () => {
      await store.write('a/1.json', { x: 1 });
      await store.write('a/2.json', { x: 2 });
      await store.write('b/3.json', { x: 3 });

      const files = await store.list('a/');
      expect(files).toEqual(['a/1.json', 'a/2.json']);
    });
  });
});
