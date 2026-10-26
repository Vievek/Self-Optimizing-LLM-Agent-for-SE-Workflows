import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface CopyResult {
  success: boolean;
  method: string;
  charCount: number;
  error?: string;
}

export interface ExportResult {
  success: boolean;
  filePath: string;
  charCount: number;
  error?: string;
}

/**
 * Copies text directly into the system clipboard.
 * Works seamlessly across WSL -> Windows host, native Linux (Wayland/X11), macOS, and SSH via OSC 52.
 */
export function copyToClipboard(text: string): CopyResult {
  const charCount = text.length;

  // 1. Primary for WSL: pipe directly to Windows host clip.exe
  const wslClipPath = '/mnt/c/Windows/System32/clip.exe';
  if (fs.existsSync(wslClipPath)) {
    try {
      const res = spawnSync(wslClipPath, [], {
        input: text,
        encoding: 'utf8',
        timeout: 3000,
      });
      if (!res.error && res.status === 0) {
        // Also emit OSC 52 for terminal clipboard consistency
        emitOsc52(text);
        return { success: true, method: 'Windows Host (clip.exe)', charCount };
      }
    } catch {
      // Fall through to other mechanisms
    }
  }

  // 2. Native Wayland: wl-copy
  try {
    const res = spawnSync('wl-copy', [], { input: text, encoding: 'utf8', timeout: 2000 });
    if (!res.error && res.status === 0) {
      emitOsc52(text);
      return { success: true, method: 'Wayland (wl-copy)', charCount };
    }
  } catch {}

  // 3. Native X11: xclip
  try {
    const res = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf8', timeout: 2000 });
    if (!res.error && res.status === 0) {
      emitOsc52(text);
      return { success: true, method: 'X11 (xclip)', charCount };
    }
  } catch {}

  // 4. macOS: pbcopy
  try {
    const res = spawnSync('pbcopy', [], { input: text, encoding: 'utf8', timeout: 2000 });
    if (!res.error && res.status === 0) {
      emitOsc52(text);
      return { success: true, method: 'macOS (pbcopy)', charCount };
    }
  } catch {}

  // 5. Universal ANSI OSC 52 escape code (supported by Windows Terminal, VS Code, iTerm, Kitty, Alacritty)
  try {
    emitOsc52(text);
    return { success: true, method: 'Terminal (OSC 52)', charCount };
  } catch (err: any) {
    return { success: false, method: 'none', charCount: 0, error: err.message };
  }
}

/**
 * Emits the standard ANSI OSC 52 clipboard escape sequence.
 */
function emitOsc52(text: string): void {
  try {
    const base64 = Buffer.from(text, 'utf8').toString('base64');
    process.stdout.write(`\x1b]52;c;${base64}\x07`);
  } catch {
    // Ignore write failures in non-tty
  }
}

/**
 * Exports the full markdown report to REPORT.md in the target workspace.
 */
export function exportReportToFile(text: string, workspaceDir: string = process.cwd()): ExportResult {
  try {
    const targetPath = path.join(workspaceDir, 'REPORT.md');
    fs.writeFileSync(targetPath, text, 'utf8');

    // Also write archive copy in .soa/reports/
    const archiveDir = path.join(workspaceDir, '.soa', 'reports');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    const archivePath = path.join(archiveDir, `report_${Date.now()}.md`);
    fs.writeFileSync(archivePath, text, 'utf8');

    return { success: true, filePath: targetPath, charCount: text.length };
  } catch (err: any) {
    return { success: false, filePath: '', charCount: 0, error: err.message ?? String(err) };
  }
}
