import { z } from 'zod';

export const OPTIMIZATION_SIGNAL_SCHEMA_VERSION = '2.0' as const;

export const FailureClassSchema = z.enum(['prompt', 'tool', 'retrieval', 'planning', 'workflow']);

export const OptimizationTargetAxisSchema = z.enum([
  'prompt',
  'tool',
  'planning',
  'workflow',
  'retrieval',
  'routing',
]);

export const SuggestedActionSchema = z.enum([
  'prompt_rewrite',
  'tool_description_refine',
  'tool_routing_update',
  'planning_param_update',
  'workflow_param_update',
  'retrieval_param_update',
  'routing_threshold_update',
]);

export const OptimizationSignalSchema = z.object({
  schema_version: z.literal(OPTIMIZATION_SIGNAL_SCHEMA_VERSION),
  signal_id: z.string().regex(/^sig_/),
  group_id: z.string(),
  run_id: z.string(),
  task_id: z.string(),
  trace_id: z.string().regex(/^[0-9a-f]{32}$/),
  failure_class: FailureClassSchema,
  root_cause: z.object({
    summary: z.string(),
    evidence_node_ids: z.array(z.string()),
  }),
  target: z.object({
    axis: OptimizationTargetAxisSchema,
    config_path: z.string(),
    affected_subtask: z.string(),
  }),
  suggested_action: SuggestedActionSchema,
  confidence: z.number().min(0).max(1),
  classifier: z.enum(['rule', 'llm_judge']),
  config_version_at_failure: z.string(),
});

export type FailureClass = z.infer<typeof FailureClassSchema>;
export type OptimizationTargetAxis = z.infer<typeof OptimizationTargetAxisSchema>;
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
export type OptimizationSignal = z.infer<typeof OptimizationSignalSchema>;
