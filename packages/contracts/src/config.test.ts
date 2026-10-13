import { describe, it, expect } from 'vitest';
import {
  PlanningConfigSchema,
  CONFIG_SCHEMA_VERSION,
} from './config.js';
describe('ConfigSchema Contract Tests', () => {
  it('validates a bounded planning config', () => {
    const validPlanning = {
      schema_version: CONFIG_SCHEMA_VERSION,
      backtrack_depth: 2,
      verify_after_edit: true,
      subtask_timeout_s: 300,
    };
    expect(() => PlanningConfigSchema.parse(validPlanning)).not.toThrow();
  });
  it('rejects planning config exceeding max bounds', () => {
    const outOfBounds = {
      schema_version: CONFIG_SCHEMA_VERSION,
      backtrack_depth: 10, // Max is 5
      verify_after_edit: true,
      subtask_timeout_s: 300,
    };
    expect(() => PlanningConfigSchema.parse(outOfBounds)).toThrow();
  });
});