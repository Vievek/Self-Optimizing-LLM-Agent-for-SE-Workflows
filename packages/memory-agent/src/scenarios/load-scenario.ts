import fs from 'node:fs';
import { z } from 'zod';
import type { ConsolidatedTaskSummary } from '@soa/contracts';
import { WorkingMemory } from '../working-memory/working-memory.js';

const StepSchema = z.object({
  action: z.string(),
  observation: z.string(),
  files: z.array(z.string()).optional(),
  tests: z.array(z.object({ id: z.string(), passed: z.boolean() })).optional(),
});

const FocusSchema = z.object({
  topic: z.string(),
  steps: z.array(StepSchema).min(1),
  learned: z.string(),
  outcome: z.enum(['success', 'partial', 'dead_end']),
});

/** A recorded task run: the focus blocks an agent went through, step by step. */
export const ScenarioSchema = z.object({
  taskId: z.string(),
  repo: z.string(),
  baseCommit: z.string(),
  resolved: z.boolean(),
  focus: z.array(FocusSchema).min(1),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

/** Replays a scenario through WorkingMemory and returns the summary finish() produces. */
export function replayScenario(scenario: Scenario): ConsolidatedTaskSummary {
  const wm = new WorkingMemory({
    taskId: scenario.taskId,
    repo: scenario.repo,
    baseCommit: scenario.baseCommit,
  });
  for (const block of scenario.focus) {
    wm.startFocus(block.topic);
    for (const step of block.steps) {
      wm.explore(step);
    }
    wm.completeFocus({ learned: block.learned, outcome: block.outcome });
  }
  return wm.finish({ resolved: scenario.resolved });
}

/** Reads and validates a scenario JSON file, then replays it. */
export async function loadScenario(path: string): Promise<ConsolidatedTaskSummary> {
  const json: unknown = JSON.parse(await fs.promises.readFile(path, 'utf8'));
  return replayScenario(ScenarioSchema.parse(json));
}
