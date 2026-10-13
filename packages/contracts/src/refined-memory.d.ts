import { z } from 'zod';
export declare const REFINED_MEMORY_SCHEMA_VERSION: '1.0';
export declare const RefinedMemorySchema: z.ZodObject<
  {
    schema_version: z.ZodLiteral<'1.0'>;
    memory_id: z.ZodString;
    content: z.ZodString;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, 'many'>>;
    embedding: z.ZodOptional<z.ZodArray<z.ZodNumber, 'many'>>;
    created_at: z.ZodString;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  'strip',
  z.ZodTypeAny,
  {
    schema_version: '1.0';
    metadata: Record<string, unknown>;
    memory_id: string;
    content: string;
    tags: string[];
    created_at: string;
    embedding?: number[] | undefined;
  },
  {
    schema_version: '1.0';
    memory_id: string;
    content: string;
    created_at: string;
    metadata?: Record<string, unknown> | undefined;
    tags?: string[] | undefined;
    embedding?: number[] | undefined;
  }
>;
export type RefinedMemory = z.infer<typeof RefinedMemorySchema>;
//# sourceMappingURL=refined-memory.d.ts.map
