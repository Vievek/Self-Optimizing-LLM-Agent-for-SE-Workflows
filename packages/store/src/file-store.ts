import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Store } from './types.js';

export class FileStore implements Store {
  readonly baseDir: string;

  constructor(baseDir: string = 'store') {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
    } catch {
      // Ignore directory creation errors if already exists
    }
  }

  private resolveSafePath(relPath: string): string {
    const fullPath = path.resolve(this.baseDir, relPath);
    if (!fullPath.startsWith(this.baseDir + path.sep) && fullPath !== this.baseDir) {
      throw new Error(`Security error: path "${relPath}" resolves outside store root`);
    }
    return fullPath;
  }

  async write<T>(relPath: string, data: T, schema?: z.ZodType<T>): Promise<void> {
    const validatedData = schema ? schema.parse(data) : data;
    const fullPath = this.resolveSafePath(relPath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    const content =
      typeof validatedData === 'string' ? validatedData : JSON.stringify(validatedData, null, 2);
    await fs.promises.writeFile(fullPath, content, 'utf8');
  }

  async read<T = unknown>(relPath: string, schema?: z.ZodType<T>): Promise<T> {
    const fullPath = this.resolveSafePath(relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${relPath}`);
    }
    const raw = await fs.promises.readFile(fullPath, 'utf8');
    const parsed = JSON.parse(raw);
    return schema ? schema.parse(parsed) : (parsed as T);
  }

  async append<T>(relPath: string, record: T, schema?: z.ZodType<T>): Promise<void> {
    const validatedRecord = schema ? schema.parse(record) : record;
    const fullPath = this.resolveSafePath(relPath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    const line = JSON.stringify(validatedRecord) + '\n';
    await fs.promises.appendFile(fullPath, line, 'utf8');
  }

  async readJsonl<T = unknown>(relPath: string, schema?: z.ZodType<T>): Promise<T[]> {
    const fullPath = this.resolveSafePath(relPath);
    if (!fs.existsSync(fullPath)) {
      return [];
    }
    const raw = await fs.promises.readFile(fullPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);

    const results: T[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      try {
        const parsed = JSON.parse(line);
        const item = schema ? schema.parse(parsed) : (parsed as T);
        results.push(item);
      } catch (err: unknown) {
        throw new Error(
          `Failed parsing record at line ${i + 1} in ${relPath}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return results;
  }

  async list(prefix = ''): Promise<string[]> {
    if (!fs.existsSync(this.baseDir)) {
      return [];
    }

    const results: string[] = [];
    const traverse = async (currentDir: string) => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await traverse(full);
        } else if (entry.isFile()) {
          const rel = path.relative(this.baseDir, full).split(path.sep).join('/');
          if (!prefix || rel.startsWith(prefix)) {
            results.push(rel);
          }
        }
      }
    };

    await traverse(this.baseDir);
    return results.sort();
  }

  async exists(relPath: string): Promise<boolean> {
    const fullPath = this.resolveSafePath(relPath);
    return fs.existsSync(fullPath);
  }

  async delete(relPath: string): Promise<void> {
    const fullPath = this.resolveSafePath(relPath);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }
}
