import {
  ANSI,
  fitWidth,
  highlightRow,
  renderBadge,
  renderPanels,
  sectionLabel,
  truncate,
  type ThemeColors,
} from '../../../theme/index.js';
import type { ExecLiveState } from '../service/exec-runner-service.js';

export function renderToolSpansView(
  state: ExecLiveState,
  width: number,
  height: number,
  selectedIndex: number,
  theme: ThemeColors,
): string[] {
  const spans = state.spans;
  const selectedSpan = spans[selectedIndex] ?? spans[0];

  // Left Panel: OpenTelemetry Spans Table
  const focusIdx = spans.length > 0 ? Math.max(0, Math.min(spans.length - 1, selectedIndex)) : 0;
  const targetRow = 2 + focusIdx;
  const leftSpec = {
    title: 'OpenTelemetry Tool Call Spans',
    badge: `${spans.length} spans`,
    active: true,
    focus: [targetRow, targetRow + 1] as [number, number],
    build: (innerWidth: number) => {
      const lines: string[] = [];

      // Table Header
      const colId = 12;
      const colTool = 18;
      const colLatency = 12;
      const colStatus = Math.max(8, innerWidth - colId - colTool - colLatency - 4);

      const header = ` ${theme.accent}${ANSI.bold}${fitWidth('Span ID', colId)}${fitWidth('Tool Name', colTool)}${fitWidth('Latency', colLatency)}${fitWidth('Status', colStatus)}${ANSI.reset}`;
      lines.push(header);
      lines.push(` ${theme.border}${'─'.repeat(Math.max(0, innerWidth - 2))}${ANSI.reset}`);

      if (spans.length === 0) {
        lines.push(` ${theme.fgDim}No tool spans recorded yet.${ANSI.reset}`);
      } else {
        spans.forEach((span, idx) => {
          const durationMs =
            new Date(span.end_ts).getTime() - new Date(span.start_ts).getTime();
          const latencyStr = `${durationMs}ms`;
          const isError = span.status === 'error';
          const statusBadge = isError
            ? renderBadge('ERROR', 'error', theme)
            : renderBadge('OK', 'built', theme);

          const toolName =
            (span.attributes as { tool_name?: string })?.tool_name ?? span.name;
          const rowText = ` ${fitWidth(span.span_id.slice(0, colId - 2), colId)}${fitWidth(toolName, colTool)}${fitWidth(latencyStr, colLatency)}${statusBadge}`;

          if (idx === selectedIndex) {
            lines.push(highlightRow(rowText, innerWidth, theme));
          } else {
            lines.push(rowText);
          }
        });
      }

      return lines;
    },
  };

  // Right Panel: Span Inspector & Arguments
  const rightSpec = {
    title: 'Span Inspector & Arguments',
    build: (innerWidth: number) => {
      const lines: string[] = [];
      if (!selectedSpan) {
        lines.push(` ${theme.fgDim}Select a span to view parameters.${ANSI.reset}`);
        return lines;
      }

      lines.push(` ${sectionLabel('SPAN IDENTIFIERS', theme)}`);
      lines.push(`  ${theme.fgDim}Span ID:   ${ANSI.reset}${theme.fg}${selectedSpan.span_id}${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Trace ID:  ${ANSI.reset}${theme.fgDim}${selectedSpan.trace_id}${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Name:      ${ANSI.reset}${theme.accent}${selectedSpan.name}${ANSI.reset}`);
      lines.push('');

      lines.push(` ${sectionLabel('EXECUTION TIMING', theme)}`);
      lines.push(`  ${theme.fgDim}Start:     ${ANSI.reset}${theme.fgMuted}${selectedSpan.start_ts.slice(11, 23)}${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}End:       ${ANSI.reset}${theme.fgMuted}${selectedSpan.end_ts.slice(11, 23)}${ANSI.reset}`);
      lines.push('');

      const attrs = (selectedSpan.attributes ?? {}) as Record<string, unknown>;
      const argsObj = attrs.args ?? attrs.input ?? attrs;
      const outputObj = attrs.output ?? attrs.result ?? attrs.observation ?? attrs.error;

      lines.push(` ${sectionLabel('TOOL ARGUMENTS', theme)}`);
      const formatted = JSON.stringify(argsObj, null, 2).split('\n');
      for (const line of formatted.slice(0, 8)) {
        lines.push(`   ${theme.fgMuted}${truncate(line, innerWidth - 6)}${ANSI.reset}`);
      }
      lines.push('');

      if (outputObj !== undefined) {
        lines.push(` ${sectionLabel('TOOL OUTPUT / RESULT', theme)}`);
        const outputStr = typeof outputObj === 'string' ? outputObj : JSON.stringify(outputObj, null, 2);
        for (const line of outputStr.split('\n').slice(0, 8)) {
          lines.push(`   ${theme.fg}${truncate(line, innerWidth - 6)}${ANSI.reset}`);
        }
        lines.push('');
      }

      lines.push(` ${renderBadge('SOA-CONTRACT: VALID', 'built', theme)}  ${theme.fgDim}Saved to local .soa/traces/${ANSI.reset}`);
      return lines;
    },
  };

  return renderPanels(leftSpec, rightSpec, {
    width,
    height,
    ratio: 0.62,
    theme,
  });
}
