import { ToolHandler } from '../types.js';
import { ReadFileHandler } from './handlers/read-file.js';
import { WriteFileHandler } from './handlers/write-file.js';
import { EditFileHandler } from './handlers/edit-file.js';
import { DeleteFileHandler } from './handlers/delete-file.js';
import { RunCommandHandler } from './handlers/run-command.js';
import { RunTestsHandler } from './handlers/run-tests.js';
import { RetrieveContextHandler } from './handlers/retrieve-context.js';
import { ListDirectoryHandler } from './handlers/list-directory.js';
import { GrepSearchHandler } from './handlers/grep-search.js';

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler): this {
    this.handlers.set(handler.name, handler);
    return this;
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  getAll(): ToolHandler[] {
    return Array.from(this.handlers.values());
  }

  getNames(): string[] {
    return Array.from(this.handlers.keys());
  }
}

/**
 * Creates and initializes a registry with the 8 standard ACI tools.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry
    .register(new ReadFileHandler())
    .register(new WriteFileHandler())
    .register(new EditFileHandler())
    .register(new DeleteFileHandler())
    .register(new RunCommandHandler())
    .register(new RunTestsHandler())
    .register(new RetrieveContextHandler())
    .register(new ListDirectoryHandler())
    .register(new GrepSearchHandler());
  return registry;
}
