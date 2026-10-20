import { FullAgentConfigSchema, type FullAgentConfig } from '@soa/contracts';

export interface ValidationResult {
  valid: boolean;
  config?: FullAgentConfig;
  error?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

const ALLOWED_ROOT_AXES = new Set([
  'planning',
  'prompts',
  'tools',
  'retrieval',
  'routing',
  'workflow',
]);

/**
 * ConfigValidator – FR3
 *
 * Safely applies candidate mutations to a clone of FullAgentConfig,
 * enforces strict range and path constraints, and validates against FullAgentConfigSchema.
 */
export class ConfigValidator {
  /**
   * Applies candidate value at configPath onto a copy of currentConfig
   * and verifies the resulting configuration against FullAgentConfigSchema.
   */
  validateCandidate(
    currentConfig: FullAgentConfig,
    configPath: string,
    proposedValue: unknown,
  ): ValidationResult {
    const segments = configPath.split('.');
    const rootAxis = segments[0] ?? '';

    if (!ALLOWED_ROOT_AXES.has(rootAxis)) {
      return {
        valid: false,
        error: `Unknown configuration path axis: "${rootAxis}"`,
      };
    }

    const cloned: FullAgentConfig = structuredClone(currentConfig);

    // Read oldValue and apply proposedValue
    const oldValue = this.getByPath(cloned, segments);
    const applied = this.setByPath(cloned, segments, proposedValue);

    if (!applied) {
      return {
        valid: false,
        error: `Could not apply candidate to path: "${configPath}"`,
        oldValue,
        newValue: proposedValue,
      };
    }

    // Additional boundary / range checks for specific tunable parameters
    const rangeError = this.checkParameterRanges(configPath, proposedValue);
    if (rangeError) {
      return {
        valid: false,
        error: rangeError,
        oldValue,
        newValue: proposedValue,
      };
    }

    const parseResult = FullAgentConfigSchema.safeParse(cloned);
    if (!parseResult.success) {
      const issueSummary = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return {
        valid: false,
        error: `Schema validation failed: ${issueSummary}`,
        oldValue,
        newValue: proposedValue,
      };
    }

    return {
      valid: true,
      config: parseResult.data,
      oldValue,
      newValue: proposedValue,
    };
  }

  private checkParameterRanges(path: string, val: unknown): string | null {
    if (path === 'retrieval.top_k' && (typeof val !== 'number' || val < 1 || val > 20)) {
      return `retrieval.top_k must be an integer between 1 and 20, got: ${val}`;
    }
    if (path === 'planning.backtrack_depth' && (typeof val !== 'number' || val < 1 || val > 5)) {
      return `planning.backtrack_depth must be an integer between 1 and 5, got: ${val}`;
    }
    if (path === 'workflow.max_iterations' && (typeof val !== 'number' || val < 1 || val > 50)) {
      return `workflow.max_iterations must be an integer between 1 and 50, got: ${val}`;
    }
    if (
      path === 'routing.small_tier_threshold' &&
      (typeof val !== 'number' || val < 0 || val > 1)
    ) {
      return `routing.small_tier_threshold must be between 0 and 1, got: ${val}`;
    }
    return null;
  }

  private getByPath(target: unknown, segments: string[]): unknown {
    let curr: unknown = target;
    const normalized = [...segments];
    if (
      normalized[0] === 'tools' &&
      normalized[1] &&
      normalized[1] !== 'tools' &&
      normalized[1] !== 'schema_version'
    ) {
      normalized.splice(1, 0, 'tools');
    }

    for (const seg of normalized) {
      if (!seg || curr === null || curr === undefined || typeof curr !== 'object') {
        return undefined;
      }
      curr = (curr as Record<string, unknown>)[seg];
    }
    return curr;
  }

  private setByPath(target: unknown, segments: string[], val: unknown): boolean {
    let curr: unknown = target;
    const normalized = [...segments];
    if (
      normalized[0] === 'tools' &&
      normalized[1] &&
      normalized[1] !== 'tools' &&
      normalized[1] !== 'schema_version'
    ) {
      normalized.splice(1, 0, 'tools');
    }

    for (let i = 0; i < normalized.length - 1; i++) {
      const seg = normalized[i];
      if (
        !seg ||
        curr === null ||
        curr === undefined ||
        typeof curr !== 'object' ||
        !(seg in (curr as Record<string, unknown>)) ||
        typeof (curr as Record<string, unknown>)[seg] !== 'object'
      ) {
        return false;
      }
      curr = (curr as Record<string, unknown>)[seg];
    }
    const lastSeg = normalized[normalized.length - 1];
    if (!lastSeg || curr === null || curr === undefined || typeof curr !== 'object') {
      return false;
    }
    (curr as Record<string, unknown>)[lastSeg] = val;
    return true;
  }
}
