import type { ConfigProvider, FullAgentConfig } from '@soa/contracts';
import type { ConfigStore } from './config-store.js';

/**
 * GitConfigStore – FR4 / FR6 skeleton
 *
 * Phase 1 will persist each cfg_NNNN snapshot as a commit in an
 * embedded git repo under store/config/ using isomorphic-git
 * (commit message: `cfg(<axis>): <signal_id>`).
 *
 * Until that lands, this wrapper delegates load() to ConfigStore so
 * Execution Core can already call ConfigProvider.load(version?) against
 * the in-memory / file store. No isomorphic-git dependency yet.
 */
export class GitConfigStore implements ConfigProvider {
  constructor(private readonly inner: ConfigStore) {}

  async load(version?: string): Promise<FullAgentConfig> {
    return this.inner.load(version);
  }

  /**
   * Commit the current config tree. Stub: no-op until isomorphic-git is wired.
   */
  async commit(_message: string): Promise<void> {
    return;
  }

  /**
   * Reset HEAD to an earlier cfg_ version. Stub: load-only until git history exists.
   */
  async checkout(version: string): Promise<FullAgentConfig> {
    return this.inner.load(version);
  }
}
