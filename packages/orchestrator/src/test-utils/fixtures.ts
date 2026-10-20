import {
  OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  type FullAgentConfig,
  type OptimizationSignal,
} from '@soa/contracts';

export const BASE_CONFIG: FullAgentConfig = {
  config_version: 'cfg_0001',
  planning: {
    schema_version: '1.0',
    backtrack_depth: 2,
    verify_after_edit: true,
    subtask_timeout_s: 300,
  },
  prompts: {
    schema_version: '1.0',
    system_prompt_version: '1.0',
    templates: {},
  },
  tools: {
    schema_version: '1.0',
    tools: {
      apply_patch: {
        name: 'apply_patch',
        description: 'Apply a unified diff patch.',
        timeout_s: 30,
      },
    },
  },
  retrieval: {
    schema_version: '1.0',
    top_k: 5,
    min_score: 0.25,
    hybrid_weight_vector: 0.5,
    max_depth: 3,
  },
  routing: {
    schema_version: '1.0',
    small_tier_threshold: 0.75,
    default_tier: 'slm',
  },
  workflow: {
    schema_version: '1.0',
    max_iterations: 10,
    retry_storm_limit: 3,
  },
};

export const SAMPLE_SIGNAL: OptimizationSignal = {
  schema_version: OPTIMIZATION_SIGNAL_SCHEMA_VERSION,
  signal_id: 'sig_test_pipeline_01',
  group_id: 'grp_pipeline_01',
  run_id: 'run_20261015T0900_orch_on_01',
  task_id: 'django__django-11099',
  trace_id: 'abcdef1234567890abcdef1234567890',
  failure_class: 'tool',
  root_cause: { summary: 'Tool failure', evidence_node_ids: ['n1'] },
  target: {
    axis: 'tool',
    config_path: 'tools.apply_patch.description',
    affected_subtask: 'patch',
  },
  suggested_action: 'tool_description_refine',
  confidence: 0.9,
  classifier: 'rule',
  config_version_at_failure: 'cfg_0001',
};
