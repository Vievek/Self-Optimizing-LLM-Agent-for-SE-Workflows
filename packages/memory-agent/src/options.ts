import type { Store } from '@soa/store';
import type { LlmProvider } from '@soa/llm';
import type { SandboxService } from '@soa/sandbox';
import type { CodeVerifier } from './verify/verifier.js';

export interface MemoryAgentOptions {
  store: Store;
  llm: LlmProvider;
  /** Used for verification from day 4. */
  sandbox?: SandboxService;
  /** Model for the agent's own calls. Defaults to the "small" tier of the llm models config. */
  model?: string;
  /**
   * Checks notes against the code at consolidate and retrieve time. Without it, notes keep a
   * placeholder 'unverifiable' status and retrieve() returns them unchecked.
   */
  verifier?: CodeVerifier;
  /** Maximum number of notes returned by retrieve(). Defaults to 5. */
  retrieveLimit?: number;
}

export const DEFAULT_RETRIEVE_LIMIT = 5;
