import { describe, it, expect } from 'vitest';
import {
  renderRecordTable,
  renderStageProgress,
  renderContractCheckPanel,
  CommandRegistry,
} from './index.js';

describe('CLI Shared TUI Components', () => {
  describe('renderRecordTable', () => {
    it('renders a formatted ASCII table with headers and rows', () => {
      const headers = ['ID', 'Name', 'Status'];
      const rows = [
        ['1', 'Task A', 'PASS'],
        ['2', 'Task B', 'FAIL'],
      ];
      const result = renderRecordTable(headers, rows, 'Test Table');

      expect(result).toContain('=== Test Table ===');
      expect(result).toContain('ID');
      expect(result).toContain('Task A');
      expect(result).toContain('Task B');
      expect(result).toContain('+----+--------+--------+');
    });

    it('handles empty rows gracefully', () => {
      const headers = ['Col1', 'Col2'];
      const result = renderRecordTable(headers, []);

      expect(result).toContain('(no records)');
    });
  });

  describe('renderStageProgress', () => {
    it('renders pipeline stages with icons and details', () => {
      const stages = [
        { name: 'Init', status: 'success' as const },
        { name: 'Build', status: 'running' as const, detail: 'Compiling TS' },
        { name: 'Test', status: 'pending' as const },
      ];
      const result = renderStageProgress(stages);

      expect(result).toContain('[✔] Init');
      expect(result).toContain('[●] Build');
      expect(result).toContain('[ ] Test');
      expect(result).toContain('* Build: Compiling TS');
    });

    it('returns empty string for empty stage list', () => {
      expect(renderStageProgress([])).toBe('');
    });
  });

  describe('renderContractCheckPanel', () => {
    it('renders a bordered health check panel with status summaries', () => {
      const results = [
        { contract: 'TraceSpan', version: '1.0.0', valid: true },
        { contract: 'OutcomeEvidence', version: '1.0.0', valid: false, error: 'Schema mismatch' },
      ];
      const result = renderContractCheckPanel(results);

      expect(result).toContain('CONTRACT HEALTH CHECK PANEL');
      expect(result).toContain('[PASS] TraceSpan (v1.0.0)');
      expect(result).toContain('[FAIL] OutcomeEvidence (v1.0.0)');
      expect(result).toContain('ERR: Schema mismatch');
      expect(result).toContain('Status: 1/2 contracts valid');
    });
  });
});

describe('CommandRegistry', () => {
  const registry = new CommandRegistry();

  it('renders help for unknown commands', async () => {
    const help = await registry.execute('unknown_cmd', []);
    expect(help).toContain('Usage: soa <component>');
    expect(help).toContain('soa check');
    expect(help).toContain('soa exec');
  });

  it('allows registering and invoking custom commands', async () => {
    registry.register('custom', async (args) => `Custom executed: ${args.join(',')}`);
    const output = await registry.execute('custom', ['arg1', 'arg2']);
    expect(output).toBe('Custom executed: arg1,arg2');
  });

  it('executes soa check', async () => {
    const output = await registry.execute('check', []);
    expect(output).toContain('CONTRACT HEALTH CHECK PANEL');
    expect(output).toContain('TraceSpan (OTel Spans)');
    expect(output).toContain('OutcomeEvidence (HEAE -> Memory)');
    expect(output).toContain('OptimizationSignal (HEAE -> Orch)');
    expect(output).toContain('RefinedMemory (Memory -> Store)');
    expect(output).toContain('FullAgentConfig (Orch -> Exec)');
    expect(output).toContain('Status: 5/5 contracts valid');
  });

  it('executes soa exec', async () => {
    const output = await registry.execute('exec', ['django__django-11099']);
    expect(output).toContain('Task Execution: django__django-11099');
    expect(output).toContain('AST Retrieval');
    expect(output).toContain('Patch Generation');
  });

  it('executes soa heae', async () => {
    const output = await registry.execute('heae', ['sympy__sympy-12345']);
    expect(output).toContain('HEAE Failure Attribution: sympy__sympy-12345');
    expect(output).toContain('Signal ID');
    expect(output).toContain('tool_description_refine');
  });

  it('executes soa memory', async () => {
    const output = await registry.execute('memory', ['django', 'trailing', 'newline']);
    expect(output).toContain('Memory Agent Retrieval');
    expect(output).toContain('Memory ID');
    expect(output).toContain('Score');
    expect(output).toContain('KEEP');
  });

  it('executes soa orch', async () => {
    const output = await registry.execute('orch', []);
    expect(output).toContain('Optimization Orchestrator Config');
    expect(output).toContain('retrieval');
    expect(output).toContain('planning');
  });

  it('executes soa bench', async () => {
    const output = await registry.execute('bench', []);
    expect(output).toContain('SWE-bench Lite Dataset');
    expect(output).toContain('pilot');
    expect(output).toContain('calibration');
    expect(output).toContain('core-30');
    expect(output).toContain('sequence');
  });
});
