import { z } from 'zod';
import {
  PlanSpanAttributesSchema,
  ToolCallSpanAttributesSchema,
  PlanningConfig,
  ToolsConfig,
} from '@soa/contracts';
import { SandboxService, WorkspaceId } from '@soa/sandbox';
import { SubtaskType, SubtaskRoutingFeatures } from '../routing/types.js';
import { GraphRetriever } from '../retrieval/graph/graph-retriever.js';

export type PlanSpanAttributes = z.infer<typeof PlanSpanAttributesSchema>;
export type ToolCallSpanAttributes = z.infer<typeof ToolCallSpanAttributesSchema>;

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

export { SubtaskType, SubtaskRoutingFeatures, PlanningConfig, ToolsConfig };
