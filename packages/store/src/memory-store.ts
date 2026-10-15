import { z } from 'zod';
import { Store } from './types.js';

export class MemoryStore implements Store {
  private files = new Map<string, unknown>();
  private jsonlStreams = new Map<string, unknown[]>();

  private normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  async write<T>(relPath: string, data: T, schema?: z.ZodType<T>): Promise<void> {
    const validated = schema ? schema.parse(data) : data;
    this.files.set(this.normalize(relPath), structuredClone(validated));
  }

  async read<T = unknown>(relPath: string, schema?: z.ZodType<T>): Promise<T> {
    const key = this.normalize(relPath);
    if (!this.files.has(key)) {
      throw new Error(`File not found: ${relPath}`);
    }
    const raw = this.files.get(key);
    const validated = schema ? schema.parse(raw) : raw;
    return structuredClone(validated) as T;
  }

  async append<T>(relPath: string, record: T, schema?: z.ZodType<T>): Promise<void> {
    const validated = schema ? schema.parse(record) : record;
    const key = this.normalize(relPath);
    if (!this.jsonlStreams.has(key)) {
      this.jsonlStreams.set(key, []);
    }
    this.jsonlStreams.get(key)!.push(structuredClone(validated));
  }

  async readJsonl<T = unknown>(relPath: string, schema?: z.ZodType<T>): Promise<T[]> {
    const key = this.normalize(relPath);
    const list = this.jsonlStreams.get(key) ?? [];
    return list.map((item) => {
      const validated = schema ? schema.parse(item) : item;
      return structuredClone(validated) as T;
    });
  }

  async list(prefix = ''): Promise<string[]> {
    const normPrefix = this.normalize(prefix);
    const keys = new Set<string>();
    for (const k of this.files.keys()) {
      if (!normPrefix || k.startsWith(normPrefix)) {
        keys.add(k);
      }
    }
    for (const k of this.jsonlStreams.keys()) {
      if (!normPrefix || k.startsWith(normPrefix)) {
        keys.add(k);
      }
    }
    return Array.from(keys).sort();
  }

  async exists(relPath: string): Promise<boolean> {
    const key = this.normalize(relPath);
    return this.files.has(key) || this.jsonlStreams.has(key);
  }

  async delete(relPath: string): Promise<void> {
    const key = this.normalize(relPath);
    this.files.delete(key);
    this.jsonlStreams.delete(key);
  }

  clear(): void {
    this.files.clear();
    this.jsonlStreams.clear();
  }
}
