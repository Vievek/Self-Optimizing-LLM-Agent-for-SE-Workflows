import { z } from 'zod';

export interface Store {
  /** Writes data to a JSON file, validating against schema if provided */
  write<T>(relPath: string, data: T, schema?: z.ZodType<T>): Promise<void>;

  /** Reads and parses a JSON file, validating against schema if provided */
  read<T = unknown>(relPath: string, schema?: z.ZodType<T>): Promise<T>;

  /** Appends a single record to a JSONL file, validating against schema if provided */
  append<T>(relPath: string, record: T, schema?: z.ZodType<T>): Promise<void>;

  /** Reads all lines from a JSONL file, validating each record against schema if provided */
  readJsonl<T = unknown>(relPath: string, schema?: z.ZodType<T>): Promise<T[]>;

  /** Lists relative file paths in the store, optionally filtered by prefix */
  list(prefix?: string): Promise<string[]>;

  /** Checks if a file exists */
  exists(relPath: string): Promise<boolean>;

  /** Deletes a file */
  delete(relPath: string): Promise<void>;
}
