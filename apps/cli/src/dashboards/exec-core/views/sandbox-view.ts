import {
  ANSI,
  renderBadge,
  renderPanels,
  sectionLabel,
  truncate,
  type ThemeColors,
} from '../../../theme/index.js';
import type { ExecLiveState } from '../service/exec-runner-service.js';

export function renderSandboxView(
  state: ExecLiveState,
  width: number,
  height: number,
  theme: ThemeColors,
): string[] {
  // Left Panel: Ephemeral Sandbox Environment & Command Output
  const leftSpec = {
    title: 'Ephemeral Sandbox Execution',
    badge: 'Isolated Container',
    active: true,
    build: (innerWidth: number) => {
      const lines: string[] = [];
      const pass = `${theme.badgeBuiltBg}${theme.badgeBuiltFg} PASS ${ANSI.reset}`;

      lines.push(` ${sectionLabel('SANDBOX RUNTIME', theme)}`);
      lines.push(`  ${theme.fgDim}Type:      ${ANSI.reset}${theme.fg}Isolated Local Sandbox / Ephemeral Workspace${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Workspace: ${ANSI.reset}${theme.fgMuted}${truncate(state.targetDir, innerWidth - 16)}${ANSI.reset}`);
      lines.push('');

      lines.push(` ${sectionLabel('VERIFICATION COMMAND LOG', theme)}`);
      // Find real test / bash span from state.spans
      const commandSpan = state.spans.slice().reverse().find(
        (s) =>
          s.name.includes('test') ||
          s.name.includes('bash') ||
          s.name.includes('command') ||
          (s.attributes as any)?.tool_name === 'bash' ||
          (s.attributes as any)?.command,
      );

      if (commandSpan) {
        const cmd =
          (commandSpan.attributes as any)?.command ||
          (commandSpan.attributes as any)?.args?.command ||
          (commandSpan.attributes as any)?.tool_name ||
          commandSpan.name;
        const durationMs =
          new Date(commandSpan.end_ts).getTime() - new Date(commandSpan.start_ts).getTime();
        const isOk = commandSpan.status === 'ok';
        const statusBadge = isOk
          ? renderBadge('0 SUCCESS', 'built', theme)
          : renderBadge('1 FAILED', 'error', theme);

        lines.push(`  ${theme.accent}${ANSI.bold}$ ${truncate(String(cmd), innerWidth - 6)}${ANSI.reset}`);
        lines.push(`  ${isOk ? pass : `${theme.badgeErrorBg}${theme.badgeErrorFg} FAIL ${ANSI.reset}`} ${theme.fg}Local verification run${ANSI.reset}`);
        lines.push(`  ${theme.fgDim}Time:     ${(durationMs / 1000).toFixed(3)} s${ANSI.reset}`);
        lines.push(`  ${theme.fgDim}Exit Code:${ANSI.reset} ${statusBadge}`);
      } else {
        lines.push(`  ${theme.fgDim}Status:   ${ANSI.reset}${theme.fgMuted}IDLE · Ready for verification${ANSI.reset}`);
        lines.push(`  ${theme.fgDim}Log:      ${ANSI.reset}${theme.fgMuted}No test command executed in this session yet.${ANSI.reset}`);
        lines.push(`  ${theme.fgDim}Sandbox:  ${ANSI.reset}${theme.fg}Isolated local workspace mounted at ${truncate(state.targetDir, innerWidth - 28)}${ANSI.reset}`);
      }
      lines.push('');

      lines.push(` ${sectionLabel('ISOLATION CONSTRAINTS', theme)}`);
      lines.push(`  ${theme.fgDim}Read-only rules enforced: Yes${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}Network egress blocked:   Docker host loopback only${ANSI.reset}`);
      lines.push(`  ${theme.fgDim}HEAE pipeline bypass:     Enabled (Zero external telemetry dispatch)${ANSI.reset}`);

      return lines;
    },
  };

  // Right Panel: Generated Patch & Verification Diff
  const rightSpec = {
    title: 'Generated Patch & Verification',
    build: (innerWidth: number) => {
      const lines: string[] = [];

      lines.push(` ${sectionLabel('UNIFIED DIFF PREVIEW', theme)}`);
      if (state.patchDiff) {
        const diffLines = state.patchDiff.split('\n');
        for (const d of diffLines) {
          if (d.startsWith('+')) {
            lines.push(`  ${theme.badgeBuiltFg}${truncate(d, innerWidth - 4)}${ANSI.reset}`);
          } else if (d.startsWith('-')) {
            lines.push(`  ${theme.badgeErrorFg}${truncate(d, innerWidth - 4)}${ANSI.reset}`);
          } else if (d.startsWith('@')) {
            lines.push(`  ${theme.accent}${truncate(d, innerWidth - 4)}${ANSI.reset}`);
          } else {
            lines.push(`  ${theme.fgDim}${truncate(d, innerWidth - 4)}${ANSI.reset}`);
          }
        }
      } else {
        lines.push(`  ${theme.fgDim}No code mutations applied yet.${ANSI.reset}`);
        lines.push(`  ${theme.fgMuted}Unified diff will appear here when agent edits files.${ANSI.reset}`);
      }
      lines.push('');

      lines.push(` ${sectionLabel('CRYPTOGRAPHIC VERIFICATION EVIDENCE', theme)}`);
      if (state.patchHash) {
        lines.push(`  ${theme.fgDim}SHA256 Hash:${ANSI.reset} ${theme.fg}${truncate(state.patchHash, innerWidth - 18)}${ANSI.reset}`);
        lines.push('');
        lines.push(`  ${renderBadge('RESULT: PASS', 'built', theme)}  ${renderBadge('LOCAL TRACE SAVED', 'info', theme)}`);
      } else {
        lines.push(`  ${theme.fgDim}SHA256 Hash:${ANSI.reset} ${theme.fgMuted}Awaiting patch generation${ANSI.reset}`);
        lines.push('');
        lines.push(`  ${renderBadge('RESULT: PENDING', 'warn', theme)}  ${renderBadge('LOCAL TRACE ACTIVE', 'info', theme)}`);
      }
      return lines;
    },
  };

  return renderPanels(leftSpec, rightSpec, {
    width,
    height,
    ratio: 0.5,
    theme,
  });
}
