import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MemoryStore } from '@soa/store';
import { StoreBus } from './index.js';

const MessageSchema = z.object({
  id: z.string(),
  content: z.string(),
});
type Message = z.infer<typeof MessageSchema>;

describe('StoreBus Tests', () => {
  it('publishes and yields historical records from store', async () => {
    const memoryStore = new MemoryStore();
    const bus = new StoreBus(memoryStore);

    const msg1: Message = { id: 'm1', content: 'First message' };
    const msg2: Message = { id: 'm2', content: 'Second message' };

    await bus.publish('test/events', msg1, MessageSchema);
    await bus.publish('test/events', msg2, MessageSchema);

    const received: Message[] = [];
    for await (const record of bus.subscribe('test/events', MessageSchema)) {
      received.push(record);
      if (received.length === 2) {
        break;
      }
    }

    expect(received.length).toBe(2);
    expect(received[0]?.id).toBe('m1');
    expect(received[1]?.id).toBe('m2');
  });

  it('rejects publishing records that fail Zod validation', async () => {
    const memoryStore = new MemoryStore();
    const bus = new StoreBus(memoryStore);

    const invalid = { id: 123, content: 'bad' } as unknown as Message;
    await expect(bus.publish('test/events', invalid, MessageSchema)).rejects.toThrow();
  });
});
