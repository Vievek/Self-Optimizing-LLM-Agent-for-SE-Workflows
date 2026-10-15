import fs from 'node:fs';
import path from 'node:path';

export type TaskSlice = 'pilot' | 'calibration' | 'core-30' | 'sequence';

/**
 * Task view presented to the Agent.
 * CRITICAL: Under Bucket 0 Section 3.10 leakage rules, gold patches and test patches
 * are strictly hidden from the agent.
 */
export interface AgentTaskView {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  created_at: string;
}

/**
 * Full task view reserved for the Grader and Evaluation Harness only.
 */
export interface GraderTaskView extends AgentTaskView {
  slice: TaskSlice;
  patch: string;
  test_patch: string;
  fail_to_pass: string[];
  pass_to_pass: string[];
}

export class TaskLoader {
  private readonly tasks: GraderTaskView[];
  private readonly taskIndex = new Map<string, GraderTaskView>();

  constructor(subsetFilePath?: string) {
    const candidates = [
      subsetFilePath,
      path.resolve(process.cwd(), 'bench/subset-v1.json'),
      path.resolve(process.cwd(), '../bench/subset-v1.json'),
      path.resolve(process.cwd(), '../../bench/subset-v1.json'),
    ].filter(Boolean) as string[];

    let loadedTasks: GraderTaskView[] | null = null;
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        try {
          const raw = fs.readFileSync(cand, 'utf8');
          loadedTasks = JSON.parse(raw);
          break;
        } catch {
          // Continue to next candidate
        }
      }
    }

    if (!loadedTasks) {
      throw new Error('Could not locate bench/subset-v1.json. Make sure the dataset is generated.');
    }

    this.tasks = loadedTasks;

    for (const task of this.tasks) {
      this.taskIndex.set(task.instance_id, task);
    }
  }

  /**
   * Transforms a full task into a sanitized view safe for LLM agent consumption.
   * Strips all answer keys, diffs, and test assertions.
   */
  static sanitizeForAgent(task: GraderTaskView): AgentTaskView {
    return {
      instance_id: task.instance_id,
      repo: task.repo,
      base_commit: task.base_commit,
      problem_statement: task.problem_statement,
      hints_text: task.hints_text,
      created_at: task.created_at,
    };
  }

  getTaskForAgent(instanceId: string): AgentTaskView {
    const task = this.taskIndex.get(instanceId);
    if (!task) {
      throw new Error(`Task instance not found: ${instanceId}`);
    }
    return TaskLoader.sanitizeForAgent(task);
  }

  getTaskForGrader(instanceId: string): GraderTaskView {
    const task = this.taskIndex.get(instanceId);
    if (!task) {
      throw new Error(`Task instance not found: ${instanceId}`);
    }
    return structuredClone(task);
  }

  getAllTasksForAgent(): AgentTaskView[] {
    return this.tasks.map(TaskLoader.sanitizeForAgent);
  }

  getAllTasksForGrader(): GraderTaskView[] {
    return structuredClone(this.tasks);
  }

  getPilotTasks(forAgent = true): (AgentTaskView | GraderTaskView)[] {
    const subset = this.tasks.filter((t) => t.slice === 'pilot');
    return forAgent ? subset.map(TaskLoader.sanitizeForAgent) : structuredClone(subset);
  }

  getCalibrationTasks(forAgent = true): (AgentTaskView | GraderTaskView)[] {
    const subset = this.tasks.filter((t) => t.slice === 'calibration');
    return forAgent ? subset.map(TaskLoader.sanitizeForAgent) : structuredClone(subset);
  }

  getCore30Tasks(forAgent = true): (AgentTaskView | GraderTaskView)[] {
    const subset = this.tasks.filter((t) => t.slice === 'core-30');
    return forAgent ? subset.map(TaskLoader.sanitizeForAgent) : structuredClone(subset);
  }

  getSequenceTasks(forAgent = true): (AgentTaskView | GraderTaskView)[] {
    const subset = this.tasks.filter((t) => t.slice === 'sequence');
    return forAgent ? subset.map(TaskLoader.sanitizeForAgent) : structuredClone(subset);
  }

  getTasksByRepo(repo: string, forAgent = true): (AgentTaskView | GraderTaskView)[] {
    const filtered = this.tasks
      .filter((t) => t.repo === repo)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return forAgent ? filtered.map(TaskLoader.sanitizeForAgent) : structuredClone(filtered);
  }

  get size(): number {
    return this.tasks.length;
  }
}
