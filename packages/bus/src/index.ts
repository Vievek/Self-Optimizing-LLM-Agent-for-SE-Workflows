import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { Store, FileStore } from '@soa/store';

export interface Bus {
  publish<T>(topic: string, record: T, schema: z.ZodType<T>): Promise<void>;
  subscribe<T>(topic: string, schema: z.ZodType<T>): AsyncIterable<T>;
}

export class StoreBus implements Bus {
  private readonly store: Store;
  private readonly emitter = new EventEmitter();

  constructor(store?: Store) {
    this.store = store ?? new FileStore();
  }

  private topicToPath(topic: string): string {
    const cleanTopic = topic.replace(/^\/+|\/+$/g, '');
    return cleanTopic.endsWith('.jsonl') ? cleanTopic : `${cleanTopic}.jsonl`;
  }

  async publish<T>(topic: string, record: T, schema: z.ZodType<T>): Promise<void> {
    const relPath = this.topicToPath(topic);
    await this.store.append(relPath, record, schema);
    this.emitter.emit(topic, record);
  }

  async *subscribe<T>(topic: string, schema: z.ZodType<T>): AsyncIterable<T> {
    const relPath = this.topicToPath(topic);

    // Yield any existing historical records from the JSONL stream first
    const historical = await this.store.readJsonl<T>(relPath, schema);
    for (const item of historical) {
      yield item;
    }

    // Set up queue for live-streamed records
    const queue: T[] = [];
    let resolveWait: (() => void) | null = null;
    let running = true;

    const listener = (record: unknown) => {
      try {
        const validated = schema.parse(record);
        queue.push(validated);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      } catch {
        // Skip records failing schema validation
      }
    };

    this.emitter.on(topic, listener);

    try {
      while (running) {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item !== undefined) {
            yield item;
          }
        }
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
    } finally {
      running = false;
      this.emitter.off(topic, listener);
    }
  }
}
