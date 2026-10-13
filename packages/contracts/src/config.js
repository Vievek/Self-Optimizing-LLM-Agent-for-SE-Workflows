import { z } from 'zod';
export const CONFIG_SCHEMA_VERSION = '1.0';
export const ConfigSchema = z.object({
    schema_version: z.literal(CONFIG_SCHEMA_VERSION),
    version: z.string(),
    parameters: z.record(z.unknown()),
    updated_at: z.string().datetime(),
});
//# sourceMappingURL=config.js.map