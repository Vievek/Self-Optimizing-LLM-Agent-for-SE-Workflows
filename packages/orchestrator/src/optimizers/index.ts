export * from './axis-optimizer.js';
export * from './prompt-optimizer.js';
export * from './tool-optimizer.js';
export * from './planning-optimizer.js';
export * from './workflow-optimizer.js';
export * from './retrieval-optimizer.js';
export * from './routing-optimizer.js';

import type { AxisOptimizer } from './axis-optimizer.js';
import { PromptOptimizer } from './prompt-optimizer.js';
import { ToolOptimizer } from './tool-optimizer.js';
import { PlanningOptimizer } from './planning-optimizer.js';
import { WorkflowOptimizer } from './workflow-optimizer.js';
import { RetrievalOptimizer } from './retrieval-optimizer.js';
import { RoutingOptimizer } from './routing-optimizer.js';

export function createDefaultOptimizers(): AxisOptimizer[] {
  return [
    new PromptOptimizer(),
    new ToolOptimizer(),
    new PlanningOptimizer(),
    new WorkflowOptimizer(),
    new RetrievalOptimizer(),
    new RoutingOptimizer(),
  ];
}
