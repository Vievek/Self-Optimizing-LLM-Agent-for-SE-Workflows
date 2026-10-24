import { describe, expect, it } from 'vitest';
import { HEAE_GRAPH_DATABASE, ReadOnlyHeaeGraphReader } from './heae-data.js';

describe('read-only HEAE graph reader', () => {
  it('loads the persisted verification trace through the existing graph schema', async () => {
    const graph = await new ReadOnlyHeaeGraphReader().loadGraph('882fc48ada7f4181bdc6dbc94186e44f');

    expect(HEAE_GRAPH_DATABASE).toMatch(/store[\\/]graphs[\\/]heae\.kuzu$/);
    expect(graph).not.toBeNull();
    expect(graph?.nodes).toHaveLength(7);
    expect(graph?.edges).toHaveLength(12);
    expect(graph?.edges.some((edge) => edge.type === 'PARENT_OF')).toBe(true);
    expect(graph?.edges.some((edge) => edge.type === 'CAUSED_BY')).toBe(true);
  });

  it('returns missing for a nonexistent database without creating it', async () => {
    const databasePath = `${HEAE_GRAPH_DATABASE}.missing`;
    const graph = await new ReadOnlyHeaeGraphReader(databasePath).loadGraph(
      '882fc48ada7f4181bdc6dbc94186e44f',
    );

    expect(graph).toBeNull();
  });
});
