import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../../theme/text.js';
import { TuiApp } from '../../tui/app.js';
import { HeaeDataSource } from './heae-data.js';
import { HeaeDashboardView } from './heae-view.js';

const state = {
  activeView: 'heae',
  activeTab: 0,
  theme: 'cyber' as const,
  width: 100,
  height: 30,
  selectedItemIndex: 0,
};

const savedEvaluation = {
  schemaVersion: '1.0' as const,
  traceId: '0123456789abcdef0123456789abcdef',
  traceFingerprint: 'a'.repeat(64),
  result: {
    traceId: '0123456789abcdef0123456789abcdef',
    ruleReport: {
      traceId: '0123456789abcdef0123456789abcdef',
      outcome: 'fail' as const,
      observations: [
        {
          ruleId: 'TOOL-01',
          category: 'tool' as const,
          observation: 'Tool returned a recorded failure',
          evidenceNodeIds: ['span-1'],
          details: {},
        },
      ],
      hypotheses: [
        {
          category: 'tool' as const,
          status: 'unverified' as const,
          summary: 'A tool operation may have contributed',
          supportingRuleIds: ['TOOL-01'],
          evidenceNodeIds: ['span-1'],
          limitations: ['Rule observations do not establish causality'],
        },
      ],
      warnings: [],
      requiresJudge: true,
    },
    judgment: null,
    judgeStatus: 'skipped' as const,
    warnings: [],
  },
};

function allDetailScrollFrames(
  view: HeaeDashboardView,
  currentState: typeof state,
): string {
  const frames: string[] = [];
  for (let index = 0; index < 64; index += 1) {
    frames.push(stripAnsi(view.render(currentState)));
    view.handleKey('down', currentState);
  }
  frames.push(stripAnsi(view.render(currentState)));
  return frames.join('\n');
}

describe('HEAE dashboard view', () => {
  it('renders an explicit empty persisted-history state across Phase 1 tabs', async () => {
    const view = new HeaeDashboardView({ list: async () => [] });
    await view.ready();

    expect(stripAnsi(view.render(state))).toContain('No persisted HEAE evaluations found.');

    for (let tab = 1; tab < 4; tab += 1) {
      expect(stripAnsi(view.render({ ...state, activeTab: tab }))).toContain(
        tab === 1 ? 'No saved evaluations.' : 'Select a persisted evaluation',
      );
    }
  });

  it('reports persistence errors instead of substituting demo data', async () => {
    const view = new HeaeDashboardView({
      list: async () => {
        throw new Error('history unavailable');
      },
    });
    await view.ready();

    const output = stripAnsi(view.render(state));
    expect(output).toContain('history unavailable');
    expect(output).not.toContain('Confidence:');
    expect(output).not.toContain('TOOL-02');
  });

  it('renders persisted observations, evidence IDs, and limitations', async () => {
    const view = new HeaeDashboardView({ list: async () => [savedEvaluation] });
    await view.ready();

    expect(stripAnsi(view.render({ ...state, activeTab: 2 }))).toContain('TOOL-01');
    const detailState = { ...state, activeTab: 3 };
    expect(stripAnsi(view.render(detailState))).toContain('span-1');
    const frames = allDetailScrollFrames(view, detailState);
    expect(frames).toContain('do not establish causality');
    expect(frames).toContain('No completed LLM assessment is recorded.');
  });

  it('keeps the selected saved evaluation when switching attribution tabs', async () => {
    const secondEvaluation = {
      ...savedEvaluation,
      traceId: 'fedcba9876543210fedcba9876543210',
      result: {
        ...savedEvaluation.result,
        traceId: 'fedcba9876543210fedcba9876543210',
        ruleReport: {
          ...savedEvaluation.result.ruleReport,
          traceId: 'fedcba9876543210fedcba9876543210',
          observations: [{ ...savedEvaluation.result.ruleReport.observations[0]!, ruleId: 'WORKFLOW-01' }],
        },
      },
    };
    const view = new HeaeDashboardView({ list: async () => [savedEvaluation, secondEvaluation] });
    await view.ready();

    const selectedState = { ...state, selectedItemIndex: 1 };
    expect(stripAnsi(view.render({ ...selectedState, activeTab: 2 }))).toContain('fedcba9876543210fedcba9876543210');
    const detailState = { ...selectedState, activeTab: 3 };
    expect(stripAnsi(view.render(detailState))).toContain('fedcba9876543210fedcba9876543210');
    expect(allDetailScrollFrames(view, detailState)).toContain('No completed LLM assessment is recorded.');
  });

  it('uses arrows for saved selection but detail scrolling after switching tabs', async () => {
    const secondEvaluation = {
      ...savedEvaluation,
      traceId: 'fedcba9876543210fedcba9876543210',
      result: {
        ...savedEvaluation.result,
        traceId: 'fedcba9876543210fedcba9876543210',
        ruleReport: {
          ...savedEvaluation.result.ruleReport,
          traceId: 'fedcba9876543210fedcba9876543210',
        },
      },
    };
    const view = new HeaeDashboardView({ list: async () => [savedEvaluation, secondEvaluation] });
    const app = new TuiApp('heae', 'cyber', { animate: false });
    app.registerView(view);
    await view.ready();

    app.handleInput('right');
    app.handleInput('down');
    expect(app.getState().selectedItemIndex).toBe(1);

    app.handleInput('right');
    app.handleInput('down');
    app.handleInput('right');
    app.handleInput('down');
    expect(app.getState().selectedItemIndex).toBe(1);
  });

  it('renders the persisted completed Ollama judgment without upgrading it to causality', async () => {
    const evaluations = await new HeaeDataSource().list();
    const target = evaluations.find((item) => item.traceId === '882fc48ada7f4181bdc6dbc94186e44f');
    expect(target?.result.judgeStatus).toBe('completed');
    expect(target?.result.judgment?.findings[0]?.assessment).toBe('insufficient_evidence');

    const view = new HeaeDashboardView({ list: async () => (target ? [target] : []) });
    await view.ready();
    const detailState = { ...state, activeTab: 3 };
    const topOutput = stripAnsi(view.render(detailState));
    const output = allDetailScrollFrames(view, detailState);

    expect(topOutput).toContain('1000000000000006');
    expect(output).toContain('INSUFFICIENT_EVIDENCE');
    expect(output).toContain('PATCH_APPLY_FAILED: context mismatch');
    expect(output).toContain('1000000000000006');
    expect(output).toContain('Insufficient information to determine the exact cause');
    expect(output).toContain('Overall uncertainty:');
    expect(output).toContain('not proof of causality');
  });
});
