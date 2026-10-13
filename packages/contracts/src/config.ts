import { z } from 'zod';

export const CONFIG_SCHEMA_VERSION = '1.0' as const;

export const PlanningConfigSchema = z.object({
  schema_version: z.literal(CONFIG_SCHEMA_VERSION),
  backtrack_depth: z.number().int().min(1).max(5),
  verify_after_edit: z.boolean(),
  subtask_timeout_s: z.number().int().min(30).max(1800),
});

export const PromptsConfigSchema = z.object({
  schema_version: z.literal(CONFIG_SCHEMA_VERSION),
  system_prompt_version: z.string(),
  templates: z.record(
    z.object({
      id: z.string(),
      version: z.string(),
      template: z.string(),
    }),
  ),
});

export const RetrievalConfigSchema = z.object({
  schema_version: z.literal(CONFIG_SCHEMA_VERSION),
  top_k: z.number().int().min(1).max(20),
  min_score: z.number().min(0).max(1),
  hybrid_weight_vector: z.number().min(0).max(1),
  max_depth: z.number().int().min(1).max(5),
});

export const RoutingConfigSchema = z.object({
  schema_version: z.literal(CONFIG_SCHEMA_VERSION),
  small_tier_threshold: z.number().min(0).max(1),
  default_tier: z.enum(['slm', 'llm']),
});

export const WorkflowConfigSchema = z.object({
  schema_version: z.literal(CONFIG_SCHEMA_VERSION),
  max_iterations: z.number().int().min(1).max(50),
  retry_storm_limit: z.number().int().min(1).max(10),
});

export const FullAgentConfigSchema = z.object({
  config_version: z.string().regex(/^cfg_[0-9]{4}$|^[0-9a-f]{40}$/),
  planning: PlanningConfigSchema,
  prompts: PromptsConfigSchema,
  retrieval: RetrievalConfigSchema,
  routing: RoutingConfigSchema,
  workflow: WorkflowConfigSchema,
});

export const ConfigSchema = z.object({
  schema_version: z.literal(CONFIG_SCHEMA_VERSION),
  version: z.string(),
  parameters: z.record(z.unknown()),
  updated_at: z.string().datetime(),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface ConfigProvider {
  load(version?: string): Promise<FullAgentConfig>;
}

export type PlanningConfig = z.infer<typeof PlanningConfigSchema>;
export type PromptsConfig = z.infer<typeof PromptsConfigSchema>;
export type RetrievalConfig = z.infer<typeof RetrievalConfigSchema>;
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
export type FullAgentConfig = z.infer<typeof FullAgentConfigSchema>;