import type { DashboardView, TuiState, ViewAction } from '../types.js';
import {
  ANSI,
  getTheme,
  highlightRow,
  padText,
  renderBadge,
  renderBox,
  renderTopHeader,
  spacer,
  toLines,
  truncate,
  vstack,
} from '../../theme/index.js';
import { renderControlBar } from '../../components/index.js';
import { ExecRunnerService } from './service/exec-runner-service.js';
import { renderAgentConsoleView } from './views/agent-console-view.js';
import { renderTaskStreamView } from './views/task-stream-view.js';
import { renderToolSpansView } from './views/tool-spans-view.js';
import { getWorkspaceAstNodes, renderAstGraphView } from './views/ast-graph-view.js';
import { renderSandboxView } from './views/sandbox-view.js';
import { copyToClipboard, exportReportToFile } from './service/clipboard-service.js';

export class ExecCoreDashboardView implements DashboardView {
  id = 'exec';
  name = 'Execution Core';
  title = 'Execution Core · Deterministic Sandbox & Agent Runner';
  tabs = ['Agent Console', 'Task Stream', 'Tool Spans', 'AST Graph', 'Sandbox'];
  actionLabel = 'insert / run';

  private isInsertMode = false;
  private isHistoryOpen = false;
  private historyIndex = 0;
  private readonly runnerService = ExecRunnerService.getInstance();

  itemCount(state?: TuiState): number {
    const tabIndex = state ? state.activeTab % this.tabs.length : 0;
    const runnerState = this.runnerService.getState();
    switch (tabIndex) {
      case 0: // Agent Console
        return runnerState.finalAnswer ? Math.max(1, runnerState.finalAnswer.split('\n').length * 4) : 1;
      case 1: // Task Stream
        return Math.max(1, runnerState.turns.length);
      case 2: // Tool Spans
        return Math.max(1, runnerState.spans.length);
      case 3: // AST Graph
        return Math.max(1, getWorkspaceAstNodes(runnerState.targetDir).length);
      case 4: // Sandbox
        return 1;
      default:
        return 1;
    }
  }

  private copyReport(runnerState: any): boolean {
    const textToCopy = runnerState.finalAnswer || runnerState.lastCompletedPrompt;
    if (!textToCopy) return false;

    const res = copyToClipboard(textToCopy);
    // Guarantee REPORT.md is also written to workspace root
    const exp = exportReportToFile(textToCopy, runnerState.targetDir);

    const msg = res.success
      ? `✔ Copied report to clipboard & saved to REPORT.md (${res.charCount.toLocaleString()} chars)`
      : `✔ Saved full report to ${exp.filePath}`;
    this.runnerService.updateStatus(msg);
    return true;
  }

  handleKey(key: string, state: TuiState): boolean | void {
    const runnerState = this.runnerService.getState();

    // 1. Global Copy shortcuts available in ALL modes and on ALL tabs: F2, ctrl+y, ctrl+k
    if (key === 'f2' || key === 'ctrl+y' || key === 'ctrl+k') {
      return this.copyReport(runnerState);
    }

    const tabIndex = state.activeTab % this.tabs.length;
    if (tabIndex !== 0) return false;

    // 2. If currently in Insert Mode:
    if (this.isInsertMode) {
      if (key === 'escape') {
        this.isInsertMode = false;
        this.runnerService.notify();
        return true;
      }
      if (key === 'backspace') {
        this.runnerService.backspacePrompt();
        return true;
      }
      if (key === 'return' || key === 'enter') {
        this.isInsertMode = false;
        const prompt = runnerState.prompt.trim();
        if (prompt.length > 0 && !runnerState.isExecuting) {
          this.runnerService.executeTask(prompt, runnerState.targetDir);
        }
        return true;
      }
      if (key === 'space') {
        this.runnerService.appendPromptChar(' ');
        return true;
      }
      if (key.length === 1 && !key.startsWith('ctrl+')) {
        this.runnerService.appendPromptChar(key);
        return true;
      }
      return false;
    }

    // 3. If History Modal is open:
    if (this.isHistoryOpen) {
      const traces = this.runnerService.listAllTraces(runnerState.targetDir);

      if (key === 'escape' || key === 'q') {
        this.isHistoryOpen = false;
        return true;
      }
      if (key === 'up' || key === 'k') {
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        return true;
      }
      if (key === 'down' || key === 'j') {
        this.historyIndex = Math.min(Math.max(0, traces.length - 1), this.historyIndex + 1);
        return true;
      }
      if (key === 'return' || key === 'enter') {
        if (traces.length > 0 && traces[this.historyIndex]) {
          this.runnerService.loadTraceFile(traces[this.historyIndex]!.filename, runnerState.targetDir);
        }
        this.isHistoryOpen = false;
        return true;
      }
      return true; // Modal captures input
    }

    // 4. Normal Mode on Tab 0:
    if (key === 'i') {
      this.isInsertMode = true;
      return true;
    }

    // Copy Entire Report: Press F2, y, Y, c, C, p, or P to copy full markdown to system clipboard
    if (key === 'y' || key === 'Y' || key === 'c' || key === 'C' || key === 'p' || key === 'P' || key === 'f2') {
      return this.copyReport(runnerState);
    }

    // Export Report: Press 'e' or 'E' to save REPORT.md to workspace
    if (key === 'e' || key === 'E') {
      const textToExport = runnerState.finalAnswer || runnerState.lastCompletedPrompt;
      if (textToExport) {
        const res = exportReportToFile(textToExport, runnerState.targetDir);
        this.runnerService.updateStatus(
          res.success ? `✔ Exported full report to ${res.filePath}` : `Export error: ${res.error ?? 'Save failed'}`,
        );
        return true;
      }
    }

    // History Navigation: Press 'H' (Shift+H) or 'ctrl+r' to open History Picker
    if (key === 'H' || key === 'ctrl+r') {
      this.isHistoryOpen = true;
      this.historyIndex = 0;
      return true;
    }

    // Reset to Fresh: Press 'N' (Shift+N) or 'ctrl+n' to reset to clean hero screen
    if (key === 'N' || key === 'ctrl+n') {
      this.runnerService.resetToFresh();
      return true;
    }

    if (key === 'return' || key === 'enter') {
      const prompt = runnerState.prompt.trim();
      if (prompt.length === 0) {
        this.isInsertMode = true;
        return true;
      }
      if (!runnerState.isExecuting) {
        this.runnerService.executeTask(prompt, runnerState.targetDir);
      }
      return true;
    }

    if (key === 'backspace') {
      this.runnerService.backspacePrompt();
      return true;
    }

    return false;
  }

  activate(state: TuiState): ViewAction {
    const runnerState = this.runnerService.getState();
    const prompt = runnerState.prompt.trim();
    if (prompt.length === 0) {
      this.isInsertMode = true;
      return {
        type: 'busy',
        verb: 'Prompt Input Mode',
        durationMs: 400,
        done: 'Insert mode activated · Type prompt and press Enter',
      };
    }
    // Launch execution asynchronously via runner service without blocking UI
    this.runnerService.executeTask(prompt, runnerState.targetDir);
    return {
      type: 'busy',
      verb: 'Running execution pipeline',
      durationMs: 1200,
      done: 'Task execution started in sandbox',
    };
  }

  status(state: TuiState): string {
    const tab = this.tabs[state.activeTab % this.tabs.length] ?? 'Agent Console';
    const runnerState = this.runnerService.getState();
    const modelPill = `${runnerState.activeTier} (${runnerState.activeModel.split('/').pop() ?? runnerState.activeModel})`;
    return `${tab} · ${modelPill} · ${runnerState.statusText}`;
  }

  render(state: TuiState): string {
    const theme = getTheme(state.theme);
    const { width, height } = state;
    const selected = state.selectedItemIndex;
    const tabIndex = state.activeTab % this.tabs.length;
    const runnerState = this.runnerService.getState();

    // 0. If History Modal is open, render interactive floating trace picker
    if (this.isHistoryOpen) {
      const traces = this.runnerService.listAllTraces(runnerState.targetDir);
      const modalLines: string[] = [];
      modalLines.push(
        ` ${theme.fgMuted}Select an execution trace to inspect [↑/↓ navigate · Enter load · Esc close]:${ANSI.reset}`,
      );
      modalLines.push('');

      if (traces.length === 0) {
        modalLines.push(`  ${theme.fgDim}No saved traces found in .soa/traces/${ANSI.reset}`);
      } else {
        traces.slice(0, 10).forEach((tr, idx) => {
          const isSelected = idx === this.historyIndex;
          const marker = isSelected ? `${theme.accent}❯${ANSI.reset}` : ' ';
          const badge = renderBadge(tr.intent.toUpperCase(), tr.resolved ? 'built' : 'warn', theme);
          const status = tr.resolved
            ? `${theme.badgeBuiltFg}✔ PASS${ANSI.reset}`
            : `${theme.fgDim}● COMPLETED${ANSI.reset}`;
          const promptPreview = truncate(tr.prompt, Math.max(20, width - 42));
          const line = ` ${marker} ${theme.fgDim}[${tr.dateStr}]${ANSI.reset} ${theme.fg}${promptPreview}${ANSI.reset}  ${badge}  ${status}`;
          if (isSelected) {
            modalLines.push(highlightRow(line, Math.max(0, width - 10), theme));
          } else {
            modalLines.push(line);
          }
        });
      }

      const box = renderBox(modalLines, {
        width: Math.min(width, Math.max(60, width - 8)),
        title: `EXECUTION TRACE HISTORY (${traces.length} runs saved)`,
        style: 'hud',
        theme,
        active: true,
      });

      const boxLines = toLines(box);
      const topPad = Math.max(1, Math.floor((height - boxLines.length) / 2));
      const res: string[] = [];
      for (let i = 0; i < topPad; i++) res.push('');
      for (const bl of boxLines) res.push(padText(bl, width, 'center'));
      while (res.length < height) res.push('');
      return res.join('\n');
    }

    // 1. Top Header
    const header = renderTopHeader(
      'soa exec',
      this.title,
      'EXECUTION CORE · interactive agent',
      theme,
      width,
    );

    // 2. Control Row with Tabs and Active Model Badge
    const modelPill = `${theme.accent}${ANSI.bold}MODEL:${ANSI.reset} ${renderBadge(
      runnerState.activeModel.split('/').pop() ?? runnerState.activeModel,
      runnerState.activeTier === 'SLM' ? 'built' : 'headline',
      theme,
    )} ${theme.fgDim}(${runnerState.activeTier})${ANSI.reset}`;

    const controlRow = renderControlBar({
      themeName: state.theme,
      tabs: this.tabs,
      activeTab: state.activeTab,
      leftBadge: modelPill,
      theme,
      width,
    });

    // 3. Dynamic Body based on Active Tab
    const renderBodyContent = (bodyHeight: number): string[] => {
      switch (tabIndex) {
        case 0:
          return renderAgentConsoleView(runnerState, width, bodyHeight, theme, this.isInsertMode, selected);
        case 1:
          return renderTaskStreamView(runnerState, width, bodyHeight, selected, theme);
        case 2:
          return renderToolSpansView(runnerState, width, bodyHeight, selected, theme);
        case 3:
          return renderAstGraphView(runnerState, width, bodyHeight, selected, theme);
        case 4:
          return renderSandboxView(runnerState, width, bodyHeight, theme);
        default:
          return renderAgentConsoleView(runnerState, width, bodyHeight, theme, this.isInsertMode, selected);
      }
    };

    const gap = spacer(height);
    return vstack(
      [
        toLines(header),
        gap,
        toLines(controlRow),
        gap,
        { grow: 1, render: renderBodyContent },
      ],
      width,
      height,
    ).join('\n');
  }
}
