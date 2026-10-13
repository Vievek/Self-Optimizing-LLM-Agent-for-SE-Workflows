import { z } from 'zod';

export interface Bus {
  publish<T>(topic: string, record: T, schema: z.ZodType<T>): Promise<void>;
  subscribe<T>(topic: string, schema: z.ZodType<T>): AsyncIterable<T>;
}
