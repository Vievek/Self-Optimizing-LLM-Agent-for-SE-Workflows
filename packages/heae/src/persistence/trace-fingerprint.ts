import { createHash } from 'node:crypto';

import type { TraceGraph } from '../trace-graph.js';

/**
 * Recursively arrange object keys in a stable order.
 *
 * Array order is intentionally preserved because
 * TraceGraph nodes, edges, and warnings are ordered.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }

  return value;
}

/**
 * Calculate a SHA-256 fingerprint of the complete
 * JSON-representable TraceGraph.
 *
 * Equivalent object-key ordering produces the same
 * fingerprint. Array ordering remains significant.
 */
export function fingerprintTraceGraph(graph: TraceGraph): string {
  // Normalize to JSON-compatible values first.
  const normalized = JSON.parse(JSON.stringify(graph)) as unknown;

  const canonical = JSON.stringify(canonicalize(normalized));

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
