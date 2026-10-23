import { PlanningConfig, CONFIG_SCHEMA_VERSION } from '@soa/contracts';
import { AgentTask, SubTask } from '../types.js';
import { SubtaskRoutingFeatures, SubtaskType } from '../../routing/types.js';

export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  schema_version: CONFIG_SCHEMA_VERSION,
  backtrack_depth: 3,
  verify_after_edit: true,
  subtask_timeout_s: 300,
};

export interface PlanGeneratorOptions {
  config?: Partial<PlanningConfig>;
  customDecomposer?: (task: AgentTask) => Promise<SubTask[]> | SubTask[];
}

export class PlanGenerator {
  private readonly config: PlanningConfig;
  private readonly customDecomposer?: (task: AgentTask) => Promise<SubTask[]> | SubTask[];

  constructor(options: PlanGeneratorOptions = {}) {
    this.config = {
      ...DEFAULT_PLANNING_CONFIG,
      ...options.config,
    };
    this.customDecomposer = options.customDecomposer;
  }

  /**
   * Decomposes an AgentTask into an ordered sequence of structured SubTasks.
   */
  async generatePlan(task: AgentTask): Promise<SubTask[]> {
    if (this.customDecomposer) {
      return await this.customDecomposer(task);
    }

    return this.generateDeterministicPlan(task);
  }

  /**
   * Deterministic software engineering task decomposition based on problem statement analysis.
   */
  generateDeterministicPlan(task: AgentTask): SubTask[] {
    const extractedFiles = this.extractTargetFiles(task.problemStatement);
    const subtasks: SubTask[] = [];

    const isCreationTask = /^(create|build|setup|implement|generate|initialize|scaffold|add|make)\b/i.test(
      task.problemStatement.trim(),
    );

    if (isCreationTask) {
      // Step 0: Reconnaissance (SLM Tier) - discover layout and identify missing files in 1-2 turns max
      const step0Type: SubtaskType = 'explore';
      const exploreFeatures: SubtaskRoutingFeatures = {
        step_type: step0Type,
        estimated_tokens: 500,
        file_count: Math.max(1, extractedFiles.length),
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 1,
      };

      subtasks.push({
        id: `${task.taskId}_step_0_recon`,
        stepIndex: 0,
        type: step0Type,
        goal: `Inspect workspace layout with list_directory once. Identify which required files exist and which are missing. Conclude immediately with Final Answer. Do NOT create or write files in this recon step.`,
        targetFiles: extractedFiles,
        estimatedTokens: exploreFeatures.estimated_tokens,
        status: 'pending',
        retryCount: 0,
        features: exploreFeatures,
      });

      // Step 1: Implementation & Scaffolding (LLM Tier) - write all missing files
      const step1Type: SubtaskType = 'edit_multi_file';
      const scaffoldFeatures: SubtaskRoutingFeatures = {
        step_type: step1Type,
        estimated_tokens: 3500,
        file_count: Math.max(3, extractedFiles.length),
        prior_failures: 0,
        requires_cross_file_reasoning: true,
        symbol_count: 5,
      };

      subtasks.push({
        id: `${task.taskId}_step_1_scaffold`,
        stepIndex: 1,
        type: step1Type,
        goal: `Scaffold and write all missing project files (configs, server/client code, components, .env.example) using write_file in batches of 2-3 files. Do NOT re-explore or read files already checked.`,
        targetFiles: extractedFiles,
        estimatedTokens: scaffoldFeatures.estimated_tokens,
        status: 'pending',
        retryCount: 0,
        features: scaffoldFeatures,
      });

      // Step 2: Verification (SLM Tier) - ensure all required files exist on disk
      if (this.config.verify_after_edit) {
        const step2Type: SubtaskType = 'plan';
        const verifyFeatures: SubtaskRoutingFeatures = {
          step_type: step2Type,
          estimated_tokens: 500,
          file_count: Math.max(1, extractedFiles.length),
          prior_failures: 0,
          requires_cross_file_reasoning: false,
          symbol_count: 1,
        };

        subtasks.push({
          id: `${task.taskId}_step_2_verify`,
          stepIndex: 2,
          type: step2Type,
          goal: `Verify that all requested project files exist on disk using list_directory once, then conclude immediately with Final Answer.`,
          targetFiles: extractedFiles,
          estimatedTokens: verifyFeatures.estimated_tokens,
          status: 'pending',
          retryCount: 0,
          features: verifyFeatures,
        });
      }

      return subtasks;
    }

    // Bug-fixing / SWE-bench workflow: Step 0 (explore) -> Step 1 (localize) -> Step 2 (edit) -> Step 3 (test) -> Step 4 (verify)
    // Step 0: Exploration & Context Retrieval
    const step0Type: SubtaskType = 'explore';
    const retrievalFeatures: SubtaskRoutingFeatures = {
      step_type: step0Type,
      estimated_tokens: 600,
      file_count: Math.max(1, extractedFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 2,
    };

    subtasks.push({
      id: `${task.taskId}_step_0_explore`,
      stepIndex: 0,
      type: step0Type,
      goal: `Retrieve symbol definitions and references for files relevant to: ${task.problemStatement.slice(0, 120)}...`,
      targetFiles: extractedFiles,
      estimatedTokens: retrievalFeatures.estimated_tokens,
      status: 'pending',
      retryCount: 0,
      features: retrievalFeatures,
    });

    // Step 1: Defect Localization & Root-Cause Analysis
    const step1Type: SubtaskType = 'localize';
    const analysisFeatures: SubtaskRoutingFeatures = {
      step_type: step1Type,
      estimated_tokens: 1500,
      file_count: Math.max(1, extractedFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: extractedFiles.length > 1,
      symbol_count: 4,
    };

    subtasks.push({
      id: `${task.taskId}_step_1_localize`,
      stepIndex: 1,
      type: step1Type,
      goal: `Analyze problem cause, identify bug location, and plan code edits.`,
      targetFiles: extractedFiles,
      estimatedTokens: analysisFeatures.estimated_tokens,
      status: 'pending',
      retryCount: 0,
      features: analysisFeatures,
    });

    // Step 2: Code Edit (Single or Multi-file edit)
    const step2Type: SubtaskType =
      extractedFiles.length > 1 ? 'edit_multi_file' : 'edit_single_file';
    const editFeatures: SubtaskRoutingFeatures = {
      step_type: step2Type,
      estimated_tokens: 2500,
      file_count: Math.max(1, extractedFiles.length),
      prior_failures: 0,
      requires_cross_file_reasoning: extractedFiles.length > 1,
      symbol_count: 5,
    };

    subtasks.push({
      id: `${task.taskId}_step_2_edit`,
      stepIndex: 2,
      type: step2Type,
      goal: `Apply code edits to resolve the issue in ${extractedFiles.length > 0 ? extractedFiles.join(', ') : 'target files'}.`,
      targetFiles: extractedFiles,
      estimatedTokens: editFeatures.estimated_tokens,
      status: 'pending',
      retryCount: 0,
      features: editFeatures,
    });

    // Step 3: Test Execution
    const step3Type: SubtaskType = 'test';
    const testFeatures: SubtaskRoutingFeatures = {
      step_type: step3Type,
      estimated_tokens: 800,
      file_count: 1,
      prior_failures: 0,
      requires_cross_file_reasoning: false,
      symbol_count: 2,
    };

    subtasks.push({
      id: `${task.taskId}_step_3_test`,
      stepIndex: 3,
      type: step3Type,
      goal: `Run and verify test cases validating the fix without regressions.`,
      targetFiles: extractedFiles.filter((f) => f.includes('test')),
      estimatedTokens: testFeatures.estimated_tokens,
      status: 'pending',
      retryCount: 0,
      features: testFeatures,
    });

    // Step 4: Verification (if verify_after_edit is true)
    if (this.config.verify_after_edit) {
      const step4Type: SubtaskType = 'plan';
      const verifyFeatures: SubtaskRoutingFeatures = {
        step_type: step4Type,
        estimated_tokens: 900,
        file_count: Math.max(1, extractedFiles.length),
        prior_failures: 0,
        requires_cross_file_reasoning: false,
        symbol_count: 2,
      };

      subtasks.push({
        id: `${task.taskId}_step_4_verify`,
        stepIndex: 4,
        type: step4Type,
        goal: `Inspect git diff and ensure code cleanliness and compliance with problem requirements.`,
        targetFiles: extractedFiles,
        estimatedTokens: verifyFeatures.estimated_tokens,
        status: 'pending',
        retryCount: 0,
        features: verifyFeatures,
      });
    }

    return subtasks;
  }

  /**
   * Extracts probable file paths or module references mentioned in the problem statement.
   */
  private extractTargetFiles(text: string): string[] {
    const fileRegex = /([a-zA-Z0-9_\-./]+\.(?:py|ts|tsx|js|jsx|java|json|yaml|yml|md|rs|go))/g;
    const matches = text.match(fileRegex) || [];
    return Array.from(new Set(matches));
  }
}
