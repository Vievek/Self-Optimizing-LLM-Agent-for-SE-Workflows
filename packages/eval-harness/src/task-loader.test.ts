import { describe, it, expect } from 'vitest';
import { TaskLoader } from './task-loader.js';

describe('TaskLoader Contract & Leakage Prevention Tests', () => {
  const loader = new TaskLoader();

  it('loads the full 120 tasks from bench/subset-v1.json', () => {
    expect(loader.size).toBe(120);
  });

  it('strictly keeps gold patch and test patch away from AgentTaskView', () => {
    const agentTask = loader.getTaskForAgent('django__django-11000');
    expect(agentTask).toBeDefined();
    expect(agentTask.instance_id).toBe('django__django-11000');
    expect(agentTask.repo).toBe('django/django');
    expect(agentTask.base_commit).toBeDefined();
    expect(agentTask.problem_statement).toBeDefined();

    // Leakage check: agent view must not contain patch or test data
    const rawRecord = agentTask as unknown as Record<string, unknown>;
    expect(rawRecord['patch']).toBeUndefined();
    expect(rawRecord['test_patch']).toBeUndefined();
    expect(rawRecord['fail_to_pass']).toBeUndefined();
    expect(rawRecord['pass_to_pass']).toBeUndefined();
  });

  it('provides complete gold evaluation data to GraderTaskView', () => {
    const graderTask = loader.getTaskForGrader('django__django-11000');
    expect(graderTask).toBeDefined();
    expect(graderTask.patch).toBeDefined();
    expect(graderTask.test_patch).toBeDefined();
    expect(graderTask.fail_to_pass.length).toBeGreaterThan(0);
    expect(graderTask.pass_to_pass.length).toBeGreaterThan(0);
  });

  it('correctly partitions tasks into pilot, calibration, core-30, and sequence', () => {
    const pilot = loader.getPilotTasks();
    expect(pilot.length).toBe(10);

    const calibration = loader.getCalibrationTasks();
    expect(calibration.length).toBe(20);

    const core30 = loader.getCore30Tasks();
    expect(core30.length).toBe(30);

    const sequence = loader.getSequenceTasks();
    expect(sequence.length).toBe(60);

    expect(pilot.length + calibration.length + core30.length + sequence.length).toBe(120);
  });

  it('orders tasks per repository by created_at chronologically', () => {
    const djangoTasks = loader.getTasksByRepo('django/django');
    expect(djangoTasks.length).toBe(24);

    for (let i = 1; i < djangoTasks.length; i++) {
      const prevDate = new Date(djangoTasks[i - 1]!.created_at).getTime();
      const currDate = new Date(djangoTasks[i]!.created_at).getTime();
      expect(currDate).toBeGreaterThanOrEqual(prevDate);
    }
  });
});
