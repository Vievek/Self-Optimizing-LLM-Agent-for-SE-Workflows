import { ANSI, type ThemeColors } from './theme.js';
import { visibleLength, sliceAnsi, stripAnsi } from './text.js';

/**
 * Wraps text into lines that do not exceed maxWidth visible columns,
 * preserving ANSI escape sequences.
 */
function wrapAnsiLine(line: string, maxWidth: number, indent: string = ''): string[] {
  if (visibleLength(line) <= maxWidth) return [line];

  const words = line.split(' ');
  const result: string[] = [];
  let cur = '';

  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    const testLine = `${cur} ${w}`;
    if (visibleLength(testLine) <= maxWidth) {
      cur = testLine;
    } else {
      result.push(cur);
      cur = indent ? `${indent}${w}` : w;
    }
  }

  if (cur) result.push(cur);
  return result;
}

/**
 * Replaces markdown inline tokens (bold and inline code) with clean ANSI formatting.
 */
function formatInlines(text: string, theme: ThemeColors): string {
  // 1. Inline code: `code`
  let formatted = text.replace(/`([^`]+)`/g, (_match, code) => {
    return `${theme.accentSecondary}${code}${ANSI.reset}${theme.fg}`;
  });

  // 2. Bold text: **text**
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_match, bold) => {
    return `${ANSI.bold}${theme.fg}${bold}${ANSI.reset}${theme.fg}`;
  });

  return formatted;
}

/**
 * Transforms raw markdown into human-readable, beautifully styled terminal ANSI output.
 */
export function renderTerminalMarkdown(
  markdown: string,
  maxWidth: number,
  theme: ThemeColors,
): string[] {
  const lines = markdown.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  const safeWidth = Math.max(20, maxWidth);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    // 1. Fenced Code Block handling
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = trimmed.replace(/^```/, '').trim() || 'code';
        const banner = `┌─ ${codeLang} `;
        const bannerFill = Math.max(0, safeWidth - banner.length - 8);
        result.push(`   ${theme.border}${banner}${'─'.repeat(bannerFill)}┐${ANSI.reset}`);
      } else {
        inCodeBlock = false;
        const bottomFill = Math.max(4, safeWidth - 8);
        result.push(`   ${theme.border}└${'─'.repeat(bottomFill)}┘${ANSI.reset}`);
      }
      continue;
    }

    if (inCodeBlock) {
      // Indent and frame code line with gutter
      const codeGutter = `   ${theme.border}│${ANSI.reset} `;
      const availWidth = Math.max(10, safeWidth - 8);
      const codeText = rawLine.length > availWidth ? rawLine.slice(0, availWidth - 1) + '…' : rawLine;
      result.push(`${codeGutter}${theme.fgDim}${codeText}${ANSI.reset}`);
      continue;
    }

    // 2. Blank lines
    if (!trimmed) {
      result.push('');
      continue;
    }

    // 3. Headings
    if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) {
      const title = trimmed.replace(/^#+\s*/, '').trim();
      result.push('');
      result.push(` ${theme.accent}${ANSI.bold}█ ${title.toUpperCase()}${ANSI.reset}`);
      result.push('');
      continue;
    }

    if (trimmed.startsWith('### ')) {
      const title = trimmed.replace(/^###\s*/, '').trim();
      result.push('');
      result.push(` ${theme.accentSecondary}${ANSI.bold}◆ ${title}${ANSI.reset}`);
      continue;
    }

    if (trimmed.startsWith('#### ')) {
      const title = trimmed.replace(/^####\s*/, '').trim();
      result.push('');
      result.push(` ${theme.badgeWarnBg}${theme.badgeWarnFg} ${title.toUpperCase()} ${ANSI.reset}`);
      continue;
    }

    // 4. Numbered Items: "1. **Title**" or "1. Title"
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(\*\*([^*]+)\*\*|.*)$/);
    if (numberedMatch) {
      const num = numberedMatch[1];
      const rest = formatInlines(numberedMatch[2] ?? '', theme);
      result.push('');
      result.push(` ${theme.accent}${ANSI.bold}${num}.${ANSI.reset} ${theme.fg}${ANSI.bold}${rest}${ANSI.reset}`);
      continue;
    }

    // 5. Key-Value Bullet: "- **Code Location**: `server/...` (Line 13)"
    const kvMatch = trimmed.match(/^[-*]\s+\*\*([^*]+)\*\*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = formatInlines(kvMatch[2] ?? '', theme);
      const kvLine = `    ${theme.border}•${ANSI.reset} ${theme.fg}${ANSI.bold}${key}:${ANSI.reset} ${theme.fgMuted}${val}${ANSI.reset}`;
      for (const wrapped of wrapAnsiLine(kvLine, safeWidth, '      ')) {
        result.push(wrapped);
      }
      continue;
    }

    // 6. Generic Bullet: "- ..." or "* ..."
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const bulletText = formatInlines(trimmed.replace(/^[-*]\s+/, ''), theme);
      const bulletLine = `    ${theme.border}•${ANSI.reset} ${theme.fg}${bulletText}${ANSI.reset}`;
      for (const wrapped of wrapAnsiLine(bulletLine, safeWidth, '      ')) {
        result.push(wrapped);
      }
      continue;
    }

    // 7. Normal paragraphs
    const formattedParagraph = formatInlines(trimmed, theme);
    const lineWithStyle = ` ${theme.fg}${formattedParagraph}${ANSI.reset}`;
    for (const wrapped of wrapAnsiLine(lineWithStyle, safeWidth)) {
      result.push(wrapped);
    }
  }

  // Ensure trailing code block is closed if input was cut off mid-code
  if (inCodeBlock) {
    const bottomFill = Math.max(4, safeWidth - 8);
    result.push(`   ${theme.border}└${'─'.repeat(bottomFill)}┘${ANSI.reset}`);
  }

  return result;
}
