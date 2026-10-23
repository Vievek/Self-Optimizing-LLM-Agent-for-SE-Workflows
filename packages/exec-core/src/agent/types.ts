import { z } from 'zod';
import {
  PlanSpanAttributesSchema,
  ToolCallSpanAttributesSchema,
  PlanningConfig,
  ToolsConfig,
  OutcomeEvidenceSchema,
  TraceSpanSchema,
  FullAgentConfig,
} from '@soa/contracts';
import { ProviderRegistry } from '@soa/llm';
import { SandboxService, WorkspaceId } from '@soa/sandbox';
import { SubtaskType, SubtaskRoutingFeatures, ModelTier } from '../routing/types.js';
import { GraphRetriever } from '../retrieval/graph/graph-retriever.js';
import { CodeGraph } from '../retrieval/graph/code-graph.js';
import { ReActLlmCaller } from './react/types.js';

export type PlanSpanAttributes = z.infer<typeof PlanSpanAttributesSchema>;
export type ToolCallSpanAttributes = z.infer<typeof ToolCallSpanAttributesSchema>;
export type OutcomeEvidence = z.infer<typeof OutcomeEvidenceSchema>;
export type TraceSpan = z.infer<typeof TraceSpanSchema>;

export const SubtaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);

export type SubtaskStatus = z.infer<typeof SubtaskStatusSchema>;

/**
 * Task specification input for the Execution Core Main Agent.
 */
export interface AgentTask {
  taskId: string;
  problemStatement: string;
  repo: string;
  baseCommit?: string;
  workspaceId?: WorkspaceId;
}

/**
 * Structured subtask unit generated during task decomposition.
 */
export interface SubTask {
  id: string;
  stepIndex: number;
  type: SubtaskType;
  goal: string;
  targetFiles: string[];
  estimatedTokens: number;
  status: SubtaskStatus;
  retryCount: number;
  lastError?: string;
  features?: SubtaskRoutingFeatures;
  contract?: string;
}

/**
 * Snapshot of the active planning state.
 */
export interface PlanState {
  taskId: string;
  subtasks: SubTask[];
  activeStepIndex: number;
  replanCount: number;
  replanReason: string | null;
}

/**
 * Runtime execution context provided to every tool invocation.
 */
export interface ToolContext {
  workspaceId: WorkspaceId;
  sandbox: SandboxService;
  taskId: string;
  retriever?: GraphRetriever;
  graph?: CodeGraph;
  workingDir?: string;
}

/**
 * Inbound tool call request matching Claude / Antigravity Agent Computer Interface (ACI).
 */
export interface ToolCallRequest {
  toolName: string;
  args: Record<string, unknown>;
  retryOf?: string | null;
}

/**
 * Deterministic tool execution result with stopwatch timing and error handling.
 */
export interface ToolResult {
  status: 'ok' | 'error';
  output: string;
  error: string | null;
  latencyMs: number;
  data?: unknown;
}

/**
 * Concrete interface for all agent tools.
 */
export interface ToolHandler {
  name: string;
  description: string;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

/**
 * Functional plug for invoking LLMs during subtask execution.
 */
export type LLMCaller = (
  prompt: string,
  subtask: SubTask,
  tier: ModelTier,
  model: string,
) => Promise<ToolCallRequest[]>;

/**
 * Configuration options for executing an agent run.
 */
export interface AgentRunnerOptions {
  runId?: string;
  config?: Partial<FullAgentConfig>;
  condition?: 'baseline' | 'amem' | 'focus' | 'memory_full' | 'orch_off' | 'orch_on';
  llmCaller?: LLMCaller;
  reactLlmCaller?: ReActLlmCaller;
  providerRegistry?: ProviderRegistry;
  maxIterations?: number;
  maxTurnsPerSubtask?: number;
  baseCommit?: string;
}

/**
 * Aggregated run result emitted by AgentRunner for HEAE and Orchestrator.
 */
export interface AgentRunResult {
  runId: string;
  taskId: string;
  traceId: string;
  resolved: boolean;
  outcomeEvidence: OutcomeEvidence;
  spans: TraceSpan[];
  planState: PlanState;
}

export { SubtaskType, SubtaskRoutingFeatures, PlanningConfig, ToolsConfig, ModelTier };
