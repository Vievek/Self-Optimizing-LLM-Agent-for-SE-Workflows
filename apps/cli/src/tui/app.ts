import readline from 'node:readline';
import { ANSI, cycleTheme, getCurrentThemeName, type ThemeName } from '../theme/theme.js';
import type { DashboardView, TuiState } from '../dashboards/types.js';
import { ExecCoreDashboardView } from '../dashboards/exec-core/index.js';
import { HeaeDashboardView } from '../dashboards/heae/index.js';
import { MemoryDashboardView } from '../dashboards/memory/index.js';
import { OrchDashboardView } from '../dashboards/orch/index.js';
import { MainMenuView } from '../dashboards/menu/index.js';
import { HelpDashboardView } from '../dashboards/help/index.js';
import { centerCanvas } from '../theme/box.js';

export class TuiApp {
  private readonly views = new Map<string, DashboardView>();
  private readonly state: TuiState;
  private isRunning = false;

  constructor(initialView = 'exec', initialTheme: ThemeName = 'nord') {
    this.registerView(new ExecCoreDashboardView());
    this.registerView(new HeaeDashboardView());
    this.registerView(new MemoryDashboardView());
    this.registerView(new OrchDashboardView());
    this.registerView(new MainMenuView());
    this.registerView(new HelpDashboardView());

    this.state = {
      activeView: initialView,
      previousView: 'exec',
      activeTab: 0,
      theme: initialTheme,
      width: process.stdout.columns || 100,
      height: process.stdout.rows || 30,
      selectedItemIndex: 0,
    };
  }

  registerView(view: DashboardView): void {
    this.views.set(view.id, view);
  }

  getState(): Readonly<TuiState> {
    return this.state;
  }

  setView(viewId: string): void {
    if (this.views.has(viewId)) {
      if (this.state.activeView !== 'menu' && viewId === 'menu') {
        this.state.previousView = this.state.activeView;
      }
      this.state.activeView = viewId;
      this.state.activeTab = 0;
    }
  }

  renderCurrent(): string {
    const view = this.views.get(this.state.activeView) ?? this.views.get('exec')!;
    this.state.width = process.stdout.columns || 100;
    this.state.height = process.stdout.rows || 30;
    this.state.theme = getCurrentThemeName();
    const raw = view.render(this.state);
    return centerCanvas(raw, this.state.width, this.state.height);
  }

  handleInput(key: string): boolean {
    // 1. Exit keys: 'q' or Ctrl+C
    if (key === 'q' || key === '\u0003') {
      return false; // Exit app
    }

    // 2. Help toggle: '?' or 'h'
    if (key === '?' || key === 'h') {
      if (this.state.activeView === 'help') {
        this.state.activeView = this.state.previousView ?? 'exec';
      } else {
        this.state.previousView = this.state.activeView;
        this.state.activeView = 'help';
      }
      return true;
    }

    // 3. Main menu toggle: 'm' or Space
    if (key === 'm' || key === ' ') {
      if (this.state.activeView === 'menu') {
        this.state.activeView = this.state.previousView ?? 'exec';
      } else {
        this.state.previousView = this.state.activeView;
        this.state.activeView = 'menu';
      }
      return true;
    }

    // 4. Escape: return from menu or help
    if (key === '\x1b') {
      if (this.state.activeView === 'menu' || this.state.activeView === 'help') {
        this.state.activeView = this.state.previousView ?? 'exec';
      }
      return true;
    }

    // 4. Number shortcuts to hop between views
    if (key === '1') {
      this.setView('exec');
      return true;
    }
    if (key === '2') {
      this.setView('heae');
      return true;
    }
    if (key === '3') {
      this.setView('memory');
      return true;
    }
    if (key === '4') {
      this.setView('orch');
      return true;
    }

    // 5. Theme toggle: 't'
    if (key === 't') {
      this.state.theme = cycleTheme();
      return true;
    }

    // 6. Tab cycling inside active view: Tab / Shift+Tab
    if (key === '\t') {
      this.state.activeTab = (this.state.activeTab + 1) % 6;
      return true;
    }

    // Pass through to view custom handler
    const view = this.views.get(this.state.activeView);
    if (view?.handleKey) {
      view.handleKey(key, this.state);
    }

    return true;
  }

  async runInteractive(): Promise<void> {
    if (!process.stdin.isTTY) {
      // In non-interactive environment (CI / pipe), output one static frame
      process.stdout.write(this.renderCurrent() + '\n');
      return;
    }

    this.isRunning = true;

    // Enter alternate screen buffer & hide cursor
    process.stdout.write(ANSI.enterAltScreen + ANSI.hideCursor);

    const onResize = () => {
      if (this.isRunning) {
        this.redraw();
      }
    };
    process.stdout.on('resize', onResize);

    const cleanup = () => {
      this.isRunning = false;
      process.stdout.off('resize', onResize);
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.stdout.write(ANSI.showCursor + ANSI.exitAltScreen);
    };

    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });

    process.stdin.setRawMode(true);
    process.stdin.resume();
    readline.emitKeypressEvents(process.stdin);

    this.redraw();

    return new Promise<void>((resolve) => {
      process.stdin.on('keypress', (_str: string, keyInfo: readline.Key) => {
        const keyName = keyInfo?.name || _str;
        const continueRunning = this.handleInput(keyName);

        if (!continueRunning) {
          cleanup();
          resolve();
          return;
        }

        this.redraw();
      });
    });
  }

  private redraw(): void {
    process.stdout.write(ANSI.clearScreen + this.renderCurrent());
  }
}

