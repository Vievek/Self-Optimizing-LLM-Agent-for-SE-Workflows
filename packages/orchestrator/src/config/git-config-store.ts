import type { ConfigProvider, FullAgentConfig } from '@soa/contracts';
import type { ConfigStore } from './config-store.js';

/**
 * GitConfigStore – FR4 / FR6
 *
 * Phase 1 uses versioned config snapshots (cfg_NNNN.json)
 * managed by ConfigStore as the source of truth.
 *
 * Git-backed commits and checkout are deferred. The version
 * parameter is resolved by ConfigStore, so Execution Core can
 * load a specific saved configuration without Git history.
 */
export class GitConfigStore implements ConfigProvider {
  constructor(private readonly inner: ConfigStore) {}

  async load(version?: string): Promise<FullAgentConfig> {
    return this.inner.load(version);
  }

  /**
   * Git commit support is deferred in Phase 1.
   * ConfigStore remains responsible for saving config versions.
   */
  async commit(_message: string): Promise<void> {
    // Intentionally deferred: versioned files are the source of truth.
  }

  /**
   * Loads a saved config version.
   * This does not change a Git HEAD because Git integration is deferred.
   */
  async checkout(version: string): Promise<FullAgentConfig> {
    return this.inner.load(version);
  }
}
