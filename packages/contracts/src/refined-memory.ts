import { z } from 'zod';

export const REFINED_MEMORY_SCHEMA_VERSION = '1.0' as const;

export const RefinedMemorySchema = z.object({
  schema_version: z.literal(REFINED_MEMORY_SCHEMA_VERSION),
  memory_id: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  embedding: z.array(z.number()).optional(),
  created_at: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type RefinedMemory = z.infer<typeof RefinedMemorySchema>;
