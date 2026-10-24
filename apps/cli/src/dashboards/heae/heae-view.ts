import type { StoredEvaluation } from '@soa/heae';
import type { DashboardView, TuiState, ViewAction } from '../types.js';
import {
  ANSI,
  getTheme,
  highlightRow,
  renderBadge,
  renderPanels,
  renderTopHeader,
  sectionLabel,
  spacer,
  toLines,
  vstack,
  type ThemeColors,
} from '../../theme/index.js';
import { renderControlBar } from '../../components/index.js';
import { HeaeDataSource, type HeaeDataReader } from './heae-data.js';

function outcomeBadge(
  outcome: StoredEvaluation['result']['ruleReport']['outcome'],
  theme: ThemeColors,
): string {
  const variant = outcome === 'pass' ? 'built' : outcome === 'unknown' ? 'info' : 'error';
  return renderBadge(outcome.toUpperCase(), variant, theme);
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export class HeaeDashboardView implements DashboardView {
  id = 'heae';
  name = 'HEAE Evaluation';
  title = 'HEAE Evaluation · Hierarchical Attribution Engine';
  tabs = ['Overview', 'Saved Evaluations', 'Failure Analysis', 'Evidence & Attribution'];
  actionLabel = 'refresh';

  private readonly source: HeaeDataReader;
  private evaluations: StoredEvaluation[] = [];
  private loading = true;
  private error?: string;
  private refreshPromise: Promise<void>;
  private detailScrollOffset = 0;
  private lastRenderedTab?: number;

  constructor(source: HeaeDataReader = new HeaeDataSource()) {
    this.source = source;
    this.refreshPromise = this.refresh();
  }

  ready(): Promise<void> {
    return this.refreshPromise;
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.error = undefined;
    try {
      this.evaluations = await this.source.list();
    } catch (error) {
      this.evaluations = [];
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  itemCount(): number {
    return Math.max(1, this.evaluations.length);
  }

  activate(): ViewAction {
    this.refreshPromise = this.refresh();
    return { type: 'busy', verb: 'Loading HEAE history', durationMs: 450, done: 'HEAE history refreshed' };
  }

  handleKey(key: string, state: TuiState): boolean {
    if (key === 'r') {
      this.refreshPromise = this.refresh();
      return true;
    }

    const tab = state.activeTab % this.tabs.length;
    if ((tab === 2 || tab === 3) && (key === 'up' || key === 'k' || key === 'down' || key === 'j')) {
      const step = key === 'up' || key === 'k' ? -1 : 1;
      this.detailScrollOffset = Math.max(0, this.detailScrollOffset + step);
      return true;
    }

    return false;
  }

  status(state: TuiState): string {
    const tab = this.tabs[state.activeTab % this.tabs.length] ?? this.tabs[0]!;
    if (this.loading) return `${tab} · loading persisted evaluations`;
    if (this.error) return `${tab} · persistence unavailable`;
    return `${tab} · ${this.evaluations.length} persisted evaluation(s) · read-only`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;
    const activeTab = state.activeTab % this.tabs.length;
    if (this.lastRenderedTab !== activeTab) {
      this.detailScrollOffset = 0;
      this.lastRenderedTab = activeTab;
    }
    const selected = Math.min(state.selectedItemIndex, Math.max(0, this.evaluations.length - 1));
    const evaluation = this.evaluations[selected];
    const header = renderTopHeader(
      'soa heae',
      this.title,
      'PERSISTED DATA · deterministic rules & optional judge results',
      theme,
      width,
    );
    const controls = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      leftBadge: `${theme.accent}${ANSI.bold}SOURCE:${ANSI.reset} ${renderBadge('Local HEAE History', 'info', theme)}`,
      theme,
      width,
    });
    const left = (innerWidth: number): string[] => {
      const tab = activeTab;
      if (tab === 0) return this.overview(theme);
      if (tab === 1) return this.saved(innerWidth, theme, selected);
      if (tab === 2) return this.failures(theme, evaluation);
      return this.evidence(theme, evaluation);
    };
    const right = (innerWidth: number): string[] => {
      const lines = [
        sectionLabel('Persistence', theme),
        '',
        `  ${theme.fgMuted}record source${ANSI.reset}  heae/evaluations/*.json`,
        `  ${theme.fgMuted}graph source${ANSI.reset}   store/graphs/heae.kuzu`,
        '',
      ];
      if (this.loading) lines.push(`  ${renderBadge('LOADING', 'info', theme)} persisted evaluations`);
      else if (this.error) lines.push(`  ${renderBadge('UNAVAILABLE', 'error', theme)} ${this.error}`);
      else lines.push(`  ${renderBadge('CONNECTED', 'built', theme)} ${this.evaluations.length} validated record(s)`);
      lines.push(
        '',
        `${theme.border}${'─'.repeat(Math.max(0, innerWidth))}${ANSI.reset}`,
        '',
        sectionLabel('Data discipline', theme),
        '',
        `  ${theme.fgMuted}Only persisted HEAE records are shown.${ANSI.reset}`,
        `  ${theme.fgMuted}No synthetic values are injected by this view.${ANSI.reset}`,
        `  ${theme.fgMuted}Hypotheses remain unverified unless a${ANSI.reset}`,
        `  ${theme.fgMuted}stored judge result explicitly says otherwise.${ANSI.reset}`,
      );
      return lines;
    };
    const panels = (panelHeight: number) => renderPanels(
      {
        title: this.tabs[activeTab] ?? 'Overview',
        active: true,
        build: left,
        focus: activeTab === 1 ? [selected, selected + 1] : undefined,
        scrollOffset: activeTab === 2 || activeTab === 3 ? this.detailScrollOffset : undefined,
      },
      { title: 'HEAE Data Status', build: right },
      { width, height: panelHeight, ratio: 0.68, theme },
    );
    return vstack(
      [toLines(header), spacer(height), toLines(controls), spacer(height), { grow: 1, render: panels }],
      width,
      height,
    ).join('\n');
  }

  private overview(theme: ThemeColors): string[] {
    if (this.loading) return [`  ${renderBadge('LOADING', 'info', theme)} Reading EvaluationHistory...`];
    if (this.error) return [`  ${renderBadge('ERROR', 'error', theme)} ${this.error}`];
    if (this.evaluations.length === 0) {
      return [
        '  No persisted HEAE evaluations found.',
        '',
        `  ${theme.fgMuted}Run a HEAE evaluation with persistence, then press r to refresh.${ANSI.reset}`,
      ];
    }
    const outcomes = this.evaluations.reduce<Record<string, number>>((counts, item) => {
      const outcome = item.result.ruleReport.outcome;
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      return counts;
    }, {});
    return [
      `  ${theme.fg}${ANSI.bold}Persisted evaluation overview${ANSI.reset}`,
      '',
      `  Evaluations: ${this.evaluations.length}`,
      `  Pass: ${outcomes.pass ?? 0}   Fail: ${outcomes.fail ?? 0}   Error: ${outcomes.error ?? 0}   Unknown: ${outcomes.unknown ?? 0}`,
      '',
      `  ${theme.fgMuted}Records are loaded through EvaluationHistory and retain${ANSI.reset}`,
      `  ${theme.fgMuted}the backend's observations, hypotheses, warnings,${ANSI.reset}`,
      `  ${theme.fgMuted}and judge status without recomputation.${ANSI.reset}`,
    ];
  }

  private saved(innerWidth: number, theme: ThemeColors, selected: number): string[] {
    if (this.loading) return [`  ${renderBadge('LOADING', 'info', theme)} Reading saved evaluations...`];
    if (this.error) return [`  ${renderBadge('ERROR', 'error', theme)} ${this.error}`];
    if (this.evaluations.length === 0) return ['  No saved evaluations.'];
    return this.evaluations.flatMap((item, index) => {
      const report = item.result.ruleReport;
      const row = ` ${index === selected ? '▸' : ' '} ${item.traceId}  ${outcomeBadge(report.outcome, theme)}  ${pluralize(report.observations.length, 'finding', 'findings')} · ${pluralize(report.hypotheses.length, 'hypothesis', 'hypotheses')}`;
      return [index === selected ? highlightRow(row, Math.max(1, innerWidth - 2), theme) : row, `     judge: ${item.result.judgeStatus} · fingerprint: ${item.traceFingerprint ? 'present' : 'legacy/missing'}`];
    });
  }

  private failures(theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const report = evaluation.result.ruleReport;
    const lines = [`  Trace ${evaluation.traceId}  ${outcomeBadge(report.outcome, theme)}`, '', sectionLabel('Rule observations', theme), ''];
    if (report.observations.length === 0) lines.push('  No deterministic rule observations were recorded.');
    for (const finding of report.observations) {
      lines.push(`  ${renderBadge(finding.category.toUpperCase(), 'warn', theme)} ${finding.ruleId}: ${finding.observation}`, `     evidence: ${finding.evidenceNodeIds.join(', ') || 'none recorded'}`);
    }
    lines.push('', sectionLabel('Attribution hypotheses', theme), '');
    if (report.hypotheses.length === 0) lines.push('  No attribution hypotheses were recorded.');
    for (const hypothesis of report.hypotheses) lines.push(`  ${renderBadge(hypothesis.status.toUpperCase(), 'info', theme)} ${hypothesis.category}: ${hypothesis.summary}`);
    return lines;
  }

  private evidence(theme: ThemeColors, evaluation?: StoredEvaluation): string[] {
    if (!evaluation) return ['  Select a persisted evaluation in Saved Evaluations.'];
    const report = evaluation.result.ruleReport;
    const evidence = [...new Set(report.observations.flatMap((finding) => finding.evidenceNodeIds))];
    const judgment = evaluation.result.judgment;
    const lines = [
      `  Trace ${evaluation.traceId}`,
      `  Judge status: ${evaluation.result.judgeStatus}`,
      '',
      sectionLabel('Rule-based attribution', theme),
      '',
      `  ${renderBadge('UNVERIFIED', 'warn', theme)} Hypotheses are not root-cause findings.`,
      `  ${theme.fgMuted}Rule observations identify recorded patterns; they do not establish causality.${ANSI.reset}`,
      '',
      sectionLabel('Rule evidence node IDs', theme),
      '',
    ];
    lines.push(...(evidence.length > 0 ? evidence.map((id) => `  ${renderBadge('SPAN', 'info', theme)} ${id}`) : ['  No evidence node IDs were recorded.']));
    lines.push('', sectionLabel('Rule attribution limits', theme), '');
    const limitations = report.hypotheses.flatMap((hypothesis) => hypothesis.limitations);
    lines.push(...(limitations.length > 0 ? [...new Set(limitations)].map((item) => `  · ${item}`) : ['  No attribution limitations were recorded.']));

    lines.push('', sectionLabel('LLM judgment', theme), '');
    if (evaluation.result.judgeStatus !== 'completed') {
      lines.push(`  ${renderBadge(evaluation.result.judgeStatus.toUpperCase(), 'info', theme)} No completed LLM assessment is recorded.`);
    } else if (!judgment) {
      lines.push(`  ${renderBadge('UNAVAILABLE', 'error', theme)} The record says completed, but contains no judgment payload.`);
    } else if (judgment.findings.length === 0) {
      lines.push('  The completed LLM judgment contains no findings.');
      lines.push(`  ${theme.fgMuted}This does not establish that the task had no failure cause.${ANSI.reset}`);
    } else {
      lines.push(`  ${renderBadge('RECORDED ASSESSMENT', 'built', theme)} Evidence-grounded model assessment; not proof of causality.`);
      for (const finding of judgment.findings) {
        lines.push(
          `  ${renderBadge(finding.assessment.toUpperCase(), finding.assessment === 'supported' ? 'warn' : 'info', theme)} ${finding.category}`,
          `     ${finding.explanation}`,
          `     evidence: ${finding.evidenceNodeIds.join(', ') || 'none recorded'}`,
          ...(finding.limitations.length > 0 ? [`     limitations: ${finding.limitations.join('; ')}`] : []),
        );
      }
    }
    if (judgment) lines.push('', '  Overall uncertainty:', `  ${judgment.overallUncertainty}`);

    if (report.warnings.length > 0) lines.push('', sectionLabel('Warnings', theme), '', ...report.warnings.map((warning) => `  ${renderBadge('WARNING', 'warn', theme)} ${warning}`));
    return lines;
  }
}
