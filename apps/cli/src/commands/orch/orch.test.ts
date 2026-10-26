import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@soa/store';
import { runOrchCommand } from './index.js';
import { SAMPLE_SIGNAL } from '@soa/orchestrator';

describe('soa orch command', () => {
  it('renders the current persisted config, queue, history, audit, and contract status', async () => {
    const result = await runOrchCommand([], { store: new MemoryStore() });

    expect(result).toContain('Active Configuration cfg_0001');
    expect(result).toContain('Signal Queue');
    expect(result).toContain('Config History');
    expect(result).toContain('Audit Log');
    expect(result).toContain('CONTRACT HEALTH CHECK PANEL');
  });

  it('processes a queued signal, records its candidate and activates the new version', async () => {
    const store = new MemoryStore();
    await store.append('store/events/optimization_signals.jsonl', SAMPLE_SIGNAL);

    const result = await runOrchCommand(['process', SAMPLE_SIGNAL.signal_id], { store });

    expect(result).toContain(SAMPLE_SIGNAL.signal_id);
    expect(result).toContain('PASS');
    expect(result).toContain('cfg_0002');

    const restarted = await runOrchCommand(['history'], { store });
    expect(restarted).toContain('cfg_0002');
    expect(restarted).toContain('deploy');

    const rolledBack = await runOrchCommand(['rollback', 'cfg_0001'], { store });
    expect(rolledBack).toContain('load() now returns this version');
    const dashboard = await runOrchCommand([], { store });
    expect(dashboard).toContain('SOA ORCH · active cfg_0001');
  });

  it('logs invalid signals and allows audit search by signal', async () => {
    const store = new MemoryStore();
    const invalidSignal = { signal_id: 'bad_id', schema_version: '2.0' };
    await store.append('store/events/optimization_signals.jsonl', invalidSignal);

    const queue = await runOrchCommand(['queue'], { store });
    expect(queue).toContain('rejected');
    expect(queue).toContain('signal_id');

    const audit = await runOrchCommand(['audit', '--signal', 'bad_id'], { store });
    expect(audit).toContain('bad_id');
    expect(audit).toContain('reject');
  });

  it('rejects an unknown config path and makes the rejection searchable in the audit log', async () => {
    const store = new MemoryStore();
    const invalidPathSignal = {
      ...SAMPLE_SIGNAL,
      signal_id: 'sig_unknown_path',
      group_id: 'grp_unknown_path',
      target: {
        ...SAMPLE_SIGNAL.target,
        axis: 'retrieval' as const,
        config_path: 'retrieval.unknown',
      },
      suggested_action: 'retrieval_param_update' as const,
    };
    await store.append('store/events/optimization_signals.jsonl', invalidPathSignal);

    const candidate = await runOrchCommand(['process', invalidPathSignal.signal_id], { store });
    expect(candidate).toContain('FAIL');
    expect(candidate).toContain('Unknown configuration path');

    const audit = await runOrchCommand(['audit', '--signal', invalidPathSignal.signal_id], {
      store,
    });
    expect(audit).toContain('reject');
    expect(audit).toContain('Unknown configuration path');
  });

  it('supports the documented demo command sequence in order', async () => {
    const store = new MemoryStore();
    const demoSignal = {
      ...SAMPLE_SIGNAL,
      signal_id: 'sig_demo_001',
      group_id: 'grp_demo_001',
      target: {
        ...SAMPLE_SIGNAL.target,
        axis: 'retrieval' as const,
        config_path: 'retrieval.top_k',
      },
      suggested_action: 'retrieval_param_update' as const,
    };
    await store.append('store/events/optimization_signals.jsonl', demoSignal);
    await store.append('store/events/optimization_signals.jsonl', {
      signal_id: 'invalid_demo',
      schema_version: '2.0',
    });

    const dashboard = await runOrchCommand(['dashboard'], { store });
    expect(dashboard).toContain('SOA ORCH · active cfg_0001');
    expect(dashboard).toContain('Signal Queue');
    expect(dashboard).toContain('Config History');
    expect(dashboard).toContain('Audit Log');
    expect(dashboard).toContain('CONTRACT HEALTH CHECK PANEL');

    const check = await runOrchCommand(['check'], { store });
    expect(check).toContain('FullAgentConfig cfg_0001');
    expect(check).toContain('OptimizationSignal sig_demo_001');
    expect(check).toContain('[FAIL] OptimizationSignal invalid_demo');

    const queue = await runOrchCommand(['queue'], { store });
    expect(queue).toContain('sig_demo_001');
    expect(queue).toContain('pending');
    expect(queue).toContain('invalid_demo');
    expect(queue).toContain('rejected');
    expect(queue).toContain('signal_id');

    const candidate = await runOrchCommand(['process', 'sig_demo_001'], { store });
    expect(candidate).toContain('retrieval.top_k');
    expect(candidate).toContain('5');
    expect(candidate).toContain('6');
    expect(candidate).toContain('PASS');
    expect(candidate).toContain('cfg_0002');

    const history = await runOrchCommand(['history'], { store });
    expect(history).toContain('cfg_0001');
    expect(history).toContain('cfg_0002');
    expect(history).toContain('retrieval.top_k');
    expect(history).toContain('sig_demo_001');

    const auditBySignal = await runOrchCommand(['audit', '--signal', 'sig_demo_001'], {
      store,
    });
    expect(auditBySignal).toContain('sig_demo_001');
    expect(auditBySignal).toContain('retrieval.top_k');

    const auditByPath = await runOrchCommand(['audit', '--path', 'retrieval.top_k'], { store });
    expect(auditByPath).toContain('sig_demo_001');
    expect(auditByPath).toContain('retrieval.top_k');

    const rollback = await runOrchCommand(['rollback', 'cfg_0001'], { store });
    expect(rollback).toContain('cfg_0001');
    const rolledBackDashboard = await runOrchCommand(['dashboard'], { store });
    expect(rolledBackDashboard).toContain('SOA ORCH · active cfg_0001');

    const redeploy = await runOrchCommand(['deploy', 'cfg_0002'], { store });
    expect(redeploy).toContain('cfg_0002');
    const redeployedDashboard = await runOrchCommand(['dashboard'], { store });
    expect(redeployedDashboard).toContain('SOA ORCH · active cfg_0002');
  });
});
