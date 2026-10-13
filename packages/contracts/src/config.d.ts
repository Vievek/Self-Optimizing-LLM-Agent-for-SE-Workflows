import { z } from 'zod';
export declare const CONFIG_SCHEMA_VERSION: '1.0';
export declare const ConfigSchema: z.ZodObject<
  {
    schema_version: z.ZodLiteral<'1.0'>;
    version: z.ZodString;
    parameters: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    updated_at: z.ZodString;
  },
  'strip',
  z.ZodTypeAny,
  {
    schema_version: '1.0';
    version: string;
    parameters: Record<string, unknown>;
    updated_at: string;
  },
  {
    schema_version: '1.0';
    version: string;
    parameters: Record<string, unknown>;
    updated_at: string;
  }
>;
export type Config = z.infer<typeof ConfigSchema>;
//# sourceMappingURL=config.d.ts.map
