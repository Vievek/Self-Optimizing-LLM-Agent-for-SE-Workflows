import {
  ANSI,
  highlightRow,
  renderBadge,
  renderPanels,
  sectionLabel,
  truncate,
  type ThemeColors,
} from '../../../theme/index.js';
import { formatDuration, type ExecLiveState } from '../service/exec-runner-service.js';

function wrapText(text: string, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      result.push('');
      continue;
    }
    const words = trimmed.split(' ');
    let cur = '';
    for (const w of words) {
      if (w.length > maxWidth) {
        if (cur) {
          result.push(cur);
          cur = '';
        }
        let remaining = w;
        while (remaining.length > maxWidth) {
          result.push(remaining.slice(0, maxWidth));
          remaining = remaining.slice(maxWidth);
        }
        cur = remaining;
      } else if (cur.length + w.length + 1 > maxWidth) {
        result.push(cur);
        cur = w;
      } else {
        cur = cur ? `${cur} ${w}` : w;
      }
    }
    if (cur) result.push(cur);
  }
  return result;
}

export function renderTaskStreamView(
  state: ExecLiveState,
  width: number,
  height: number,
  selectedIndex: number,
  theme: ThemeColors,
): string[] {
  const check = `${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✔ ${ANSI.reset}`;
  const running = `${theme.badgeWarnBg}${theme.badgeWarnFg} ● ${ANSI.reset}`;

  // Helper to extract a friendly preview of action inputs
  const formatActionInputPreview = (input?: Record<string, unknown> | string): string => {
    if (!input) return '';
    if (typeof input === 'object') {
      const obj = input as Record<string, any>;
      if (Array.isArray(obj.files)) {
        const names = obj.files.map((f: any) => f.path || f).filter(Boolean);
        return `Files (${names.length}): ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}`;
      }
      if (obj.path) {
        return `Path: ${obj.path}${obj.depth ? ` (depth ${obj.depth})` : ''}`;
      }
      if (obj.command) return `Cmd: ${obj.command}`;
      if (obj.query) return `Query: ${obj.query}`;
      return JSON.stringify(input);
    }
    return String(input);
  };

  // 1. Calculate pipeline stage lines for accurate left panel scrolling
  const leftInnerWidth = Math.max(30, Math.floor(width * 0.58) - 4);
  const stages = (state.stages && state.stages.length > 0)
    ? state.stages
    : [
        { id: 'explore', name: 'Explore', status: 'pending' as const },
        { id: 'localize', name: 'Localize', status: 'pending' as const },
        { id: 'edit', name: 'Edit Patch', status: 'pending' as const },
        { id: 'test', name: 'Test Sandbox', status: 'pending' as const },
        { id: 'verify', name: 'Verify Patch', status: 'pending' as const },
      ];

  let estimatedStageLines = 1;
  let curLen = 2;
  for (let sIdx = 0; sIdx < stages.length; sIdx++) {
    const stage = stages[sIdx]!;
    const itemVisibleLen = 3 + stage.name.length;
    const arrowVisibleLen = sIdx < stages.length - 1 ? 6 : 0;
    if (curLen + itemVisibleLen + arrowVisibleLen > leftInnerWidth && curLen > 2) {
      estimatedStageLines += 1;
      curLen = 8 + itemVisibleLen + arrowVisibleLen;
    } else {
      curLen += itemVisibleLen + arrowVisibleLen;
    }
  }

  // Calculate line offset of selected turn for auto-scrolling
  let currentLine = 1 + estimatedStageLines + 1; // 1 header line + stage stepper lines + blank line
  let focusRange: [number, number] | undefined = undefined;
  for (let i = 0; i < state.turns.length; i++) {
    const t = state.turns[i]!;
    const start = currentLine;
    const inputPrev = formatActionInputPreview(t.actionInput);
    const linesCount = 1 + (inputPrev ? 1 : 0) + 1 + (t.observation ? 1 : 0) + 1;
    if (i === selectedIndex) {
      focusRange = [start, start + linesCount];
    }
    currentLine += linesCount;
  }

  // Left Panel: ReAct Execution Pipeline & Subtask Phase Bar
  const leftSpec = {
    title: 'ReAct Execution Pipeline',
    active: true,
    focus: focusRange,
    build: (innerWidth: number) => {
      const lines: string[] = [];
      const intentLabel = state.taskIntent ? `[${state.taskIntent.toUpperCase()}]` : '[AGENT]';

      lines.push(` ${theme.fgDim}${intentLabel}${ANSI.reset} ${theme.accent}${ANSI.bold}EXECUTION PIPELINE${ANSI.reset}`);

      let currentStageLine = '  ';
      let currentLen = 2;
      for (let sIdx = 0; sIdx < stages.length; sIdx++) {
        const stage = stages[sIdx]!;
        let icon = `${theme.fgDim}○${ANSI.reset}`;
        if (stage.status === 'completed') {
          icon = check;
        } else if (stage.status === 'running') {
          icon = running;
        } else if (stage.status === 'failed') {
          icon = `${theme.badgeWarnBg}${theme.badgeWarnFg} ✖ ${ANSI.reset}`;
        }

        const itemStr = `${icon} ${theme.fg}${stage.name}${ANSI.reset}`;
        const itemVisibleLen = 2 + 1 + stage.name.length;
        const arrow = sIdx < stages.length - 1 ? `  ${theme.border}─>${ANSI.reset}  ` : '';
        const arrowVisibleLen = 6;

        if (currentLen + itemVisibleLen + arrowVisibleLen > innerWidth && currentLen > 2) {
          lines.push(currentStageLine);
          currentStageLine = `    ${theme.border}└──>${ANSI.reset} ${itemStr}${arrow}`;
          currentLen = 8 + itemVisibleLen + arrowVisibleLen;
        } else {
          currentStageLine += `${itemStr}${arrow}`;
          currentLen += itemVisibleLen + arrowVisibleLen;
        }
      }
      if (currentStageLine.trim()) {
        lines.push(currentStageLine);
      }
      lines.push('');

      // 2. Turns Stream (selected turn highlighted)
      if (state.turns.length === 0) {
        lines.push(` ${theme.fgDim}No active turns recorded yet.${ANSI.reset}`);
        lines.push(` ${theme.fgMuted}Type a prompt on [Agent Console] and press [Enter] to run.${ANSI.reset}`);
      } else {
        state.turns.forEach((turn, idx) => {
          const turnTitle = ` ${check} ${theme.fg}${ANSI.bold}Turn ${turn.turnIndex}: ${turn.action ?? 'Reasoning'}${ANSI.reset}  ${renderBadge(turn.status.toUpperCase(), 'built', theme)}`;
          const inputPreview = formatActionInputPreview(turn.actionInput);
          const turnActionInput = inputPreview
            ? `   ${theme.accent}Action Input: ${truncate(inputPreview, innerWidth - 18)}${ANSI.reset}`
            : '';
          const turnThought = `   ${theme.fgMuted}Thought: ${truncate(turn.thought ?? '', innerWidth - 14)}${ANSI.reset}`;
          const turnObs = turn.observation
            ? `   ${theme.fgDim}Observation: ${truncate(turn.observation, innerWidth - 18)}${ANSI.reset}`
            : '';

          if (idx === selectedIndex) {
            lines.push(highlightRow(turnTitle, innerWidth, theme));
          } else {
            lines.push(turnTitle);
          }
          if (turnActionInput) lines.push(turnActionInput);
          lines.push(turnThought);
          if (turnObs) lines.push(turnObs);
          lines.push('');
        });
      }

      return lines;
    },
  };

  // Right Panel: Turn Inspector + Architectural Contract & Plan Queue
  const selectedTurn = state.turns.length > 0 ? (state.turns[selectedIndex] ?? state.turns[0]) : undefined;

  const rightSpec = {
    title: selectedTurn ? `Turn ${selectedTurn.turnIndex} Inspector · Dynamic Model Tier Routing` : 'Dynamic Model Tier Routing & Plan Queue',
    build: (innerWidth: number) => {
      const lines: string[] = [];
      const totalTokens = (state.tokensIn + state.tokensOut).toLocaleString();

      // 1. Turn Detail & Tool Parameters (if turn selected)
      if (selectedTurn) {
        lines.push(` ${sectionLabel('SELECTED TURN DETAIL', theme)}`);
        lines.push(
          `  ${theme.accent}${ANSI.bold}Turn ${selectedTurn.turnIndex}:${ANSI.reset} ${theme.fg}${selectedTurn.action ?? 'Reasoning'}${ANSI.reset}  ${renderBadge(selectedTurn.status.toUpperCase(), 'built', theme)}  ${theme.fgDim}Model:${ANSI.reset} ${theme.fg}${state.activeModel} (${state.activeTier})${ANSI.reset}`,
        );
        lines.push('');

        if (selectedTurn.actionInput) {
          lines.push(` ${sectionLabel('ACTION INPUT', theme)}`);
          if (typeof selectedTurn.actionInput === 'object') {
            const obj = selectedTurn.actionInput as Record<string, any>;
            if (Array.isArray(obj.files)) {
              lines.push(`  ${theme.accent}${ANSI.bold}Target Files (${obj.files.length}):${ANSI.reset}`);
              for (const f of obj.files.slice(0, 6)) {
                lines.push(`  ${theme.fgDim}• ${theme.fg}${f.path || f}${ANSI.reset}`);
              }
              if (obj.files.length > 6) {
                lines.push(`  ${theme.fgDim}  ...and ${obj.files.length - 6} more file(s)${ANSI.reset}`);
              }
            } else {
              const raw = JSON.stringify(selectedTurn.actionInput, null, 2);
              for (const line of wrapText(raw, Math.max(20, innerWidth - 4)).slice(0, 8)) {
                lines.push(`  ${theme.fgDim}${line}${ANSI.reset}`);
              }
            }
          } else {
            for (const line of wrapText(String(selectedTurn.actionInput), Math.max(20, innerWidth - 4)).slice(0, 6)) {
              lines.push(`  ${theme.fgDim}${line}${ANSI.reset}`);
            }
          }
          lines.push('');
        }

        if (selectedTurn.observation) {
          lines.push(` ${sectionLabel('OBSERVATION / RESULT', theme)}`);
          for (const line of wrapText(selectedTurn.observation, Math.max(20, innerWidth - 4)).slice(0, 8)) {
            lines.push(`  ${theme.fg}${line}${ANSI.reset}`);
          }
          lines.push('');
        }

        if (selectedTurn.thought) {
          lines.push(` ${sectionLabel('REASONING THOUGHT', theme)}`);
          const wrappedThought = wrapText(selectedTurn.thought, Math.max(20, innerWidth - 4));
          for (const line of wrappedThought.slice(0, 8)) {
            lines.push(`  ${theme.fgMuted}${line}${ANSI.reset}`);
          }
          if (wrappedThought.length > 8) {
            lines.push(`  ${theme.fgDim}... (${wrappedThought.length - 8} more lines)${ANSI.reset}`);
          }
          lines.push('');
        }
      }

      // 2. Architectural Contract & Scope (Always visible whenever contract summary is available)
      if (state.contractSummary) {
        lines.push(` ${sectionLabel('ARCHITECTURAL CONTRACT & SCOPE', theme)}`);
        if (state.contractSummary.entities && state.contractSummary.entities.length > 0) {
          lines.push(`  ${theme.fgDim}Entities:     ${ANSI.reset}${theme.accent}${ANSI.bold}${state.contractSummary.entities.join(', ')}${ANSI.reset}`);
        }
        if (state.contractSummary.targetFiles && state.contractSummary.targetFiles.length > 0) {
          const filesPreview = state.contractSummary.targetFiles.slice(0, 4).join(', ');
          const more = state.contractSummary.targetFiles.length > 4 ? ` (+${state.contractSummary.targetFiles.length - 4} more)` : '';
          lines.push(`  ${theme.fgDim}Target Files: ${ANSI.reset}${theme.fgMuted}${filesPreview}${more}${ANSI.reset}`);
        }
        if (state.contractSummary.contractText) {
          lines.push(`  ${theme.fgDim}Scope:${ANSI.reset}`);
          for (const line of wrapText(state.contractSummary.contractText, Math.max(20, innerWidth - 4)).slice(0, 4)) {
            lines.push(`   ${theme.fgDim}${line}${ANSI.reset}`);
          }
        }
        lines.push('');
      }

      // 3. Planned Intent & Queued Pipeline Phases
      const curStages = (state.stages && state.stages.length > 0) ? state.stages : [];
      if (curStages.length > 0) {
        lines.push(` ${sectionLabel('PLANNED INTENT & QUEUED PHASES', theme)}`);
        const completedCount = curStages.filter((s) => s.status === 'completed').length;
        lines.push(`  ${theme.fgDim}Intent:  ${ANSI.reset}${renderBadge(state.taskIntent ? state.taskIntent.toUpperCase() : 'GENERAL', 'built', theme)}  ${theme.fgDim}Progress: ${theme.fg}${completedCount}/${curStages.length} phases${ANSI.reset}`);
        for (const st of curStages.slice(0, 8)) {
          const icon = st.status === 'completed'
            ? `${theme.badgeBuiltBg}${theme.badgeBuiltFg} ✔ ${ANSI.reset}`
            : st.status === 'running'
              ? `${theme.badgeWarnBg}${theme.badgeWarnFg} ● ${ANSI.reset}`
              : `${theme.fgDim}○ ${ANSI.reset}`;
          const desc = st.goal ? ` · ${truncate(st.goal, innerWidth - st.name.length - 12)}` : '';
          lines.push(`  ${icon} ${theme.fg}${st.name}${theme.fgDim}${desc}${ANSI.reset}`);
        }
        if (curStages.length > 8) {
          lines.push(`  ${theme.fgDim}   ...and ${curStages.length - 8} more phases in queue${ANSI.reset}`);
        }
        lines.push('');
      }

      // 4. Execution Metrics & Status Summary
      const durationStr = formatDuration(state.durationMs);
      const resolvedBadge = state.resolved === true
        ? renderBadge('RESOLVED', 'built', theme)
        : state.resolved === false
          ? renderBadge('FAILED', 'warn', theme)
          : renderBadge('COMPLETED', 'built', theme);

      lines.push(` ${sectionLabel('TOTAL EXECUTION SUMMARY & METRICS', theme)}`);
      lines.push(`  ${theme.fgDim}Time Taken:   ${ANSI.reset}${theme.accent}${ANSI.bold}${durationStr}${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Tokens In:    ${ANSI.reset}${theme.fg}${state.tokensIn.toLocaleString()}${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Tokens Out:   ${ANSI.reset}${theme.fg}${state.tokensOut.toLocaleString()}${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Total Tokens: ${ANSI.reset}${theme.accent}${ANSI.bold}${totalTokens}${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Total Turns:  ${ANSI.reset}${theme.fg}${state.turns.length} turns recorded${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Status:       ${ANSI.reset}${resolvedBadge} ${theme.fgMuted}${truncate(state.statusText, innerWidth - 22)}${ANSI.reset}`);

      return lines;
    },
  };

  return renderPanels(leftSpec, rightSpec, {
    width,
    height,
    ratio: 0.55,
    theme,
  });
}
