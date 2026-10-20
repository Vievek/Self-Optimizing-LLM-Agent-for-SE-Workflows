import { describe, it, expect } from 'vitest';
import { FullAgentConfigSchema } from '@soa/contracts';
import { ConfigStore, ConfigValidator, BASE_CONFIG } from './index.js';

describe('Optimization Orchestrator Skeleton Tests', () => {
  describe('ConfigStore (FR4)', () => {
    it('initializes with valid BASE_CONFIG adhering to FullAgentConfigSchema', async () => {
      const store = new ConfigStore();
      const cfg = await store.load();

      expect(cfg.config_version).toBe('cfg_0001');
      expect(FullAgentConfigSchema.safeParse(cfg).success).toBe(true);
      expect(cfg.retrieval.top_k).toBe(5);
    });

    it('saves a new version and updates active version', async () => {
      const store = new ConfigStore();
      const nextVer = store.getNextVersionId();
      expect(nextVer).toBe('cfg_0002');

      const updated = structuredClone(BASE_CONFIG);
      updated.config_version = nextVer;
      updated.retrieval.top_k = 7;

      await store.saveVersion(updated);
      expect(store.getActiveVersion()).toBe('cfg_0002');

      const loaded = await store.load();
      expect(loaded.retrieval.top_k).toBe(7);

      const oldVersion = await store.load('cfg_0001');
      expect(oldVersion.retrieval.top_k).toBe(5);
    });

    it('rejects saving config that violates schema', async () => {
      const store = new ConfigStore();
      const bad = structuredClone(BASE_CONFIG) as Record<string, unknown>;
      bad.config_version = 'not_a_valid_version';
      await expect(store.saveVersion(bad as typeof BASE_CONFIG)).rejects.toThrow();
    });
  });

  describe('Validation & Range Checks (FR3)', () => {
    const validator = new ConfigValidator();

    it('accepts valid in-range updates', () => {
      const res = validator.validateCandidate(BASE_CONFIG, 'retrieval.top_k', 8);
      expect(res.valid).toBe(true);
      expect(res.config?.retrieval.top_k).toBe(8);
      expect(res.oldValue).toBe(5);
      expect(res.newValue).toBe(8);
    });

    it('rejects out-of-range top_k (greater than 20)', () => {
      const res = validator.validateCandidate(BASE_CONFIG, 'retrieval.top_k', 99);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('retrieval.top_k must be an integer between 1 and 20');
    });

    it('rejects unknown root axes', () => {
      const res = validator.validateCandidate(BASE_CONFIG, 'unknown_axis.param', 123);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unknown configuration path axis');
    });
  });
});
