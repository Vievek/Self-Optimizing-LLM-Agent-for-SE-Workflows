import readline from 'node:readline';
import {
  ANSI,
  DEFAULT_THEME,
  cycleTheme,
  getCurrentThemeName,
  getTheme,
  setTheme,
  type ThemeColors,
  type ThemeName,
} from '../theme/theme.js';
import { keepStyle, visibleLength } from '../theme/text.js';
import { MIN_COLS, MIN_ROWS, centerBlock, fitBlock, overlayBlock } from '../theme/layout.js';
import type { DashboardView, TuiState } from '../dashboards/types.js';
import { ExecCoreDashboardView } from '../dashboards/exec-core/index.js';
import { HeaeDashboardView } from '../dashboards/heae/index.js';
import { MemoryDashboardView } from '../dashboards/memory/index.js';
import { OrchDashboardView } from '../dashboards/orch/index.js';
import { MainMenuView } from '../dashboards/menu/index.js';
import { HelpDashboardView } from '../dashboards/help/index.js';
import { renderTopBar, renderStatusLine, type KeyHint } from '../components/app-bars.js';
import { renderBusyInline, renderBusyPanel, type BusyInfo } from '../components/busy-indicator.js';
import { BOOT_MS, renderBootScreen, type BootInfo } from '../components/boot-sequence.js';
import { runContractHealthCheck, summarizeContractHealth } from '../contract-health.js';
import { renderFrameUpdate } from './screen.js';

/** Animation frame length while busy. */
export const FRAME_MS = 120;
/** How long the boot sequence splash stays up (any key skips it). */
export const SPLASH_MS = BOOT_MS;
/** Resize events are debounced by this much. */
export const RESIZE_DEBOUNCE_MS = 50;
/** How long a toast stays in the status bar. */
export const TOAST_MS = 2500;
/** Tasks at least this long get the overlay box with SOA-BOT. */
export const OVERLAY_MIN_MS = 1000;
/** Simulated time for loading a dashboard. */
export const LOADING_MS = 700;

/** Fallback size when stdout is not a terminal (pipes, tests). */
const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 40;

const MODULE_KEYS: Record<string, string> = {
  '1': 'exec',
  '2': 'heae',
  '3': 'memory',
  '4': 'orch',
};

/** A key as a raw string ('q', '\t', '\x1b') or as a readline keypress object. */
export type KeyInput =
  string | { name?: string; sequence?: string; ctrl?: boolean; shift?: boolean; meta?: boolean };

/**
 * Maps readline keypress info (or a raw character) to one key name:
 * 'q', '?', 'ctrl+c', 'escape', 'tab', 'shift+tab', 'up', 'return', 'space', ...
 */
export function normalizeKey(input: KeyInput): string {
  if (typeof input === 'string') {
    switch (input) {
      case '\u0003':
        return 'ctrl+c';
      case '\x1b':
        return 'escape';
      case '\t':
        return 'tab';
      case '\x1b[Z':
        return 'shift+tab';
      case '\r':
        return 'return';
      case '\n':
        return 'enter';
      case ' ':
        return 'space';
      default:
        return input;
    }
  }
  const { name, sequence, ctrl, shift } = input;
  if (name) {
    if (ctrl) return `ctrl+${name}`;
    if (name === 'tab') return shift ? 'shift+tab' : 'tab';
    // Single characters keep their exact text (so 'Q' is not 'q').
    if (name.length === 1 && sequence && sequence.length === 1) return sequence;
    return name;
  }
  return sequence ? normalizeKey(sequence) : '';
}

export interface TuiAppOptions {
  /**
   * Animate the busy indicator and splash. Defaults to true when stdout is a
   * terminal. With animation off there are no timers: tasks finish at once
   * and a static frame is shown.
   */
  animate?: boolean;
  /** Clock for the status bar (handy in tests). */
  now?: () => Date;
}

export type ToastKind = 'done' | 'fail' | 'info';

const TOAST_TAGS: Record<ToastKind, string> = {
  done: '[ ✔ DONE ]',
  fail: '[ ✖ FAIL ]',
  info: '[ ● INFO ]',
};

interface BusyState {
  verb: string;
  startedAt: number;
  durationMs: number;
  doneMessage: string;
  overlay: boolean;
}

export class TuiApp {
  private readonly views = new Map<string, DashboardView>();
  private readonly state: TuiState;
  private readonly animate: boolean;
  private readonly now: () => Date;
  private readonly selections = new Map<string, number>();

  private isRunning = false;
  private sizeOverride?: { columns: number; rows: number };
  private busy?: BusyState;
  private splashUntil?: number;
  private bootStartedAt = 0;
  private bootInfo?: BootInfo;
  private toast?: { kind: ToastKind; text: string; until: number };
  private frame = 0;
  private lastFrame?: string[];

  private ticker?: ReturnType<typeof setInterval>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private clockTimer?: ReturnType<typeof setTimeout>;

  constructor(
    initialView = 'exec',
    initialTheme: ThemeName = DEFAULT_THEME,
    options: TuiAppOptions = {},
  ) {
    this.registerView(new ExecCoreDashboardView());
    this.registerView(new HeaeDashboardView());
    this.registerView(new MemoryDashboardView());
    this.registerView(new OrchDashboardView());
    this.registerView(new MainMenuView());
    this.registerView(new HelpDashboardView());

    setTheme(initialTheme);
    this.animate = options.animate ?? Boolean(process.stdout.isTTY);
    this.now = options.now ?? (() => new Date());

    const { columns, rows } = this.getSize();
    this.state = {
      activeView: this.views.has(initialView) ? initialView : 'exec',
      previousView: 'exec',
      activeTab: 0,
      theme: getCurrentThemeName(),
      width: columns,
      height: rows,
      selectedItemIndex: 0,
    };
  }

  registerView(view: DashboardView): void {
    this.views.set(view.id, view);
  }

  getState(): Readonly<TuiState> {
    return this.state;
  }

  /** Renders at a fixed size instead of the real terminal size. */
  setSize(columns: number, rows: number): void {
    this.sizeOverride = { columns, rows };
  }

  getSize(): { columns: number; rows: number } {
    if (this.sizeOverride) return this.sizeOverride;
    return {
      columns: process.stdout.columns || DEFAULT_COLUMNS,
      rows: process.stdout.rows || DEFAULT_ROWS,
    };
  }

  isBusy(): boolean {
    return this.busy !== undefined;
  }

  /** True while the animation interval is running. */
  isAnimating(): boolean {
    return this.ticker !== undefined;
  }

  isSplashVisible(): boolean {
    return this.splashUntil !== undefined;
  }

  /** The toast currently shown in the status bar, e.g. "[ ✔ DONE ] Notes linked". */
  getToast(): string | undefined {
    if (this.toast && this.toast.until > Date.now()) {
      return `${TOAST_TAGS[this.toast.kind]} ${this.toast.text}`;
    }
    return undefined;
  }

  /**
   * Starts the boot sequence splash (about 1.5 s, any key skips it).
   * Does nothing with animation off (--no-anim or not a terminal).
   */
  startBootSequence(): void {
    if (!this.animate) return;
    this.bootInfo = {
      contracts: summarizeContractHealth(runContractHealthCheck()),
      themeKey: getCurrentThemeName(),
    };
    this.bootStartedAt = Date.now();
    this.splashUntil = this.bootStartedAt + SPLASH_MS;
    this.frame = 0;
    this.syncTicker();
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  private switchTo(viewId: string, resetTab: boolean): void {
    if (!this.views.has(viewId) || viewId === this.state.activeView) return;
    this.selections.set(this.state.activeView, this.state.selectedItemIndex);
    this.state.activeView = viewId;
    this.state.selectedItemIndex = this.selections.get(viewId) ?? 0;
    if (resetTab) this.state.activeTab = 0;
  }

  setView(viewId: string): void {
    if (!this.views.has(viewId)) return;
    if (this.state.activeView !== 'menu' && viewId === 'menu') {
      this.state.previousView = this.state.activeView;
    }
    this.switchTo(viewId, true);
  }

  private toggleOverlayView(viewId: 'menu' | 'help'): void {
    if (this.state.activeView === viewId) {
      this.switchTo(this.state.previousView ?? 'exec', false);
    } else {
      this.state.previousView = this.state.activeView;
      this.switchTo(viewId, false);
    }
  }

  private activeView(): DashboardView {
    return this.views.get(this.state.activeView) ?? this.views.get('exec')!;
  }

  /** The state a view renders with: same as the app state, sized to the body. */
  private viewState(): TuiState {
    const { columns, rows } = this.getSize();
    return { ...this.state, width: columns, height: Math.max(0, rows - 2) };
  }

  private itemCount(): number {
    const view = this.activeView();
    return Math.max(1, view.itemCount?.(this.viewState()) ?? 1);
  }

  // ---------------------------------------------------------------------------
  // Busy indicator, toast and animation
  // ---------------------------------------------------------------------------

  /**
   * Shows the busy indicator for `durationMs`, then a toast. Short tasks show
   * in the status bar; longer ones get an overlay box with the PC buddy.
   */
  startBusy(verb: string, durationMs: number, doneMessage = 'Done'): void {
    if (!this.animate) {
      this.busy = undefined;
      this.showToast(doneMessage);
      return;
    }
    this.busy = {
      verb,
      startedAt: Date.now(),
      durationMs,
      doneMessage,
      overlay: durationMs >= OVERLAY_MIN_MS,
    };
    this.frame = 0;
    this.syncTicker();
    this.requestRedraw();
  }

  /** Stops the busy indicator without the "done" toast. */
  cancelBusy(): void {
    if (!this.busy) return;
    this.busy = undefined;
    this.syncTicker();
    this.showToast('Aborted by user', 'fail');
  }

  private finishBusy(): void {
    const busy = this.busy;
    if (!busy) return;
    this.busy = undefined;
    this.syncTicker();
    this.showToast(busy.doneMessage);
  }

  private showToast(text: string, kind: ToastKind = 'done'): void {
    this.toast = { kind, text, until: Date.now() + TOAST_MS };
    this.state.statusMessage = `${TOAST_TAGS[kind]} ${text}`;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
    if (this.isRunning && this.animate) {
      this.toastTimer = setTimeout(() => {
        this.toastTimer = undefined;
        this.toast = undefined;
        this.state.statusMessage = undefined;
        this.requestRedraw();
      }, TOAST_MS);
    }
    this.requestRedraw();
  }

  /** Runs the single animation interval only while busy or on the splash. */
  private syncTicker(): void {
    const needed = this.animate && (this.busy !== undefined || this.splashUntil !== undefined);
    if (needed && !this.ticker) {
      this.ticker = setInterval(() => this.tick(), FRAME_MS);
    } else if (!needed && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private tick(): void {
    this.frame++;
    const now = Date.now();
    if (this.splashUntil !== undefined && now >= this.splashUntil) this.splashUntil = undefined;
    if (this.busy && now - this.busy.startedAt >= this.busy.durationMs) {
      this.finishBusy();
    }
    this.syncTicker();
    this.requestRedraw();
  }

  private busyInfo(): BusyInfo | undefined {
    if (!this.busy) return undefined;
    const elapsedMs = Date.now() - this.busy.startedAt;
    return {
      verb: this.busy.verb,
      elapsedMs,
      frame: this.frame,
      progress: Math.min(1, elapsedMs / Math.max(1, this.busy.durationMs)),
    };
  }

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------

  /** Handles one key. Returns false when the app should quit. */
  handleInput(input: KeyInput): boolean {
    const key = normalizeKey(input);

    if (key === 'q' || key === 'ctrl+c') return false;

    // Any key skips the splash.
    if (this.splashUntil !== undefined) {
      this.splashUntil = undefined;
      this.syncTicker();
      return true;
    }

    if (key === 'escape') {
      if (this.busy) {
        this.cancelBusy();
      } else if (this.state.activeView === 'menu' || this.state.activeView === 'help') {
        this.switchTo(this.state.previousView ?? 'exec', false);
      }
      return true;
    }

    if (key === '?' || key === 'h') {
      this.toggleOverlayView('help');
      return true;
    }

    if (key === 'm' || key === 'space') {
      this.toggleOverlayView('menu');
      return true;
    }

    const moduleView = MODULE_KEYS[key];
    if (moduleView) {
      if (moduleView !== this.state.activeView) {
        this.setView(moduleView);
        this.startBusy('Loading dashboard', LOADING_MS, 'Dashboard loaded');
      }
      return true;
    }

    if (key === 't') {
      this.state.theme = cycleTheme();
      this.showToast(`Theme: ${getTheme().name}`, 'info');
      return true;
    }

    const tabCount = this.activeView().tabs?.length ?? 0;
    if (key === 'tab' || key === 'right') {
      if (tabCount > 0) this.state.activeTab = (this.state.activeTab + 1) % tabCount;
      return true;
    }
    if (key === 'shift+tab' || key === 'left') {
      if (tabCount > 0) this.state.activeTab = (this.state.activeTab - 1 + tabCount) % tabCount;
      return true;
    }

    if (key === 'up' || key === 'k' || key === 'down' || key === 'j') {
      const step = key === 'up' || key === 'k' ? -1 : 1;
      const max = this.itemCount() - 1;
      this.state.selectedItemIndex = Math.max(
        0,
        Math.min(max, this.state.selectedItemIndex + step),
      );
      return true;
    }

    if (key === 'return' || key === 'enter') {
      const action = this.activeView().activate?.(this.viewState());
      if (action?.type === 'key') return this.handleInput(action.key);
      if (action?.type === 'busy') this.startBusy(action.verb, action.durationMs, action.done);
      return true;
    }

    this.activeView().handleKey?.(key, this.state);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Renders the whole frame: exactly `columns` wide and `rows` tall. */
  renderFrame(): string[] {
    const { columns, rows } = this.getSize();
    this.state.width = columns;
    this.state.height = rows;
    this.state.theme = getCurrentThemeName();
    const theme = getTheme(this.state.theme);

    let lines: string[];
    if (this.splashUntil !== undefined && this.bootInfo) {
      lines = renderBootScreen(
        Date.now() - this.bootStartedAt,
        this.frame,
        this.bootInfo,
        columns,
        rows,
        theme,
      );
    } else if (columns < MIN_COLS || rows < MIN_ROWS) {
      const message = `Please enlarge the terminal (min ${MIN_COLS}x${MIN_ROWS}) · now ${columns}x${rows}`;
      lines = centerBlock([`${theme.warning}${ANSI.bold}${message}${ANSI.reset}`], columns, rows);
    } else {
      lines = this.renderApp(columns, rows, theme);
    }

    // Paint the theme background behind everything, then reset at line end.
    return fitBlock(lines, columns, rows).map((line) => keepStyle(line, theme.bg));
  }

  renderCurrent(): string {
    return this.renderFrame().join('\n');
  }

  private renderApp(columns: number, rows: number, theme: ThemeColors): string[] {
    const view = this.activeView();
    const bodyState = this.viewState();
    this.state.selectedItemIndex = Math.min(this.state.selectedItemIndex, this.itemCount() - 1);
    bodyState.selectedItemIndex = this.state.selectedItemIndex;

    const top = renderTopBar({
      activeView: this.state.activeView,
      viewName: view.name,
      width: columns,
      busy: this.busy !== undefined,
      frame: this.frame,
      theme,
    });
    let body = fitBlock(view.render(bodyState).split('\n'), columns, bodyState.height);

    const busy = this.busyInfo();
    let overlayShown = false;
    if (busy && this.busy?.overlay) {
      const panel = renderBusyPanel(busy, theme);
      const panelWidth = visibleLength(panel[0] ?? '');
      if (panelWidth + 2 <= columns && panel.length <= body.length) {
        body = overlayBlock(body, panel, columns - panelWidth - 1, body.length - panel.length);
        overlayShown = true;
      }
    }

    let message: string;
    if (busy && !overlayShown) {
      message = renderBusyInline(busy, theme);
    } else if (this.toast && this.getToast()) {
      const color = { done: theme.success, fail: theme.danger, info: theme.accent }[
        this.toast.kind
      ];
      message = `${color}${ANSI.bold}${this.getToast()}${ANSI.reset}`;
    } else {
      message = `${theme.fgMuted}${view.status?.(bodyState) ?? view.title}${ANSI.reset}`;
    }

    const status = renderStatusLine({
      hints: this.keyHints(view),
      message,
      time: this.now().toTimeString().slice(0, 5),
      width: columns,
      theme,
    });

    return [top, ...body, status];
  }

  private keyHints(view: DashboardView): KeyHint[] {
    const inOverlay = view.id === 'menu' || view.id === 'help';
    const hints: KeyHint[] = [{ key: '1-4', label: 'module', priority: 5 }];
    if (inOverlay) {
      hints.push({ key: 'esc', label: 'back', priority: 8 });
    } else {
      hints.push({ key: 'tab', label: 'next tab', priority: 4 });
    }
    hints.push({ key: '↑↓', label: view.id === 'help' ? 'scroll' : 'select', priority: 3 });
    if (view.actionLabel) hints.push({ key: '↵', label: view.actionLabel, priority: 6 });
    hints.push(
      { key: 't', label: 'theme', priority: 2 },
      { key: '?', label: 'help', priority: 7 },
      { key: 'q', label: 'quit', priority: 9 },
    );
    return hints;
  }

  // ---------------------------------------------------------------------------
  // Interactive loop
  // ---------------------------------------------------------------------------

  private requestRedraw(): void {
    if (this.isRunning) this.redraw();
  }

  private redraw(): void {
    const frame = this.renderFrame();
    const update = renderFrameUpdate(this.lastFrame, frame);
    if (update) process.stdout.write(update);
    this.lastFrame = frame;
  }

  /** Redraws the clock at the start of each minute. */
  private scheduleClock(): void {
    if (!this.animate || !this.isRunning) return;
    const msToNextMinute = 60_000 - (this.now().getTime() % 60_000) + 50;
    this.clockTimer = setTimeout(() => {
      this.requestRedraw();
      this.scheduleClock();
    }, msToNextMinute);
  }

  async runInteractive(): Promise<void> {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY || !stdout.isTTY) {
      // Not a terminal (CI / pipe): print one static frame.
      stdout.write(this.renderCurrent() + '\n');
      return;
    }

    this.isRunning = true;
    this.lastFrame = undefined;
    stdout.write(ANSI.enterAltScreen + ANSI.hideCursor);

    return new Promise<void>((resolve) => {
      let resizeTimer: ReturnType<typeof setTimeout> | undefined;
      let restored = false;

      const onResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = undefined;
          this.lastFrame = undefined;
          this.requestRedraw();
        }, RESIZE_DEBOUNCE_MS);
      };

      const onKeypress = (str: string | undefined, key: readline.Key | undefined) => {
        const keepGoing = this.handleInput(
          key ? { ...key, sequence: key.sequence ?? str } : (str ?? ''),
        );
        if (!keepGoing) {
          restore();
          resolve();
          return;
        }
        this.requestRedraw();
      };

      const restore = () => {
        if (restored) return;
        restored = true;
        this.isRunning = false;
        this.busy = undefined;
        this.splashUntil = undefined;
        this.syncTicker();
        for (const timer of [resizeTimer, this.toastTimer, this.clockTimer]) {
          if (timer) clearTimeout(timer);
        }
        this.toastTimer = undefined;
        this.clockTimer = undefined;
        stdin.off('keypress', onKeypress);
        stdout.off('resize', onResize);
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        process.off('uncaughtException', onCrash);
        process.off('unhandledRejection', onCrash);
        process.off('exit', restore);
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
        stdout.write(ANSI.reset + ANSI.showCursor + ANSI.exitAltScreen);
      };

      const onSigint = () => {
        restore();
        process.exit(130);
      };
      const onSigterm = () => {
        restore();
        process.exit(143);
      };
      const onCrash = (err: unknown) => {
        restore();
        console.error('soa tui crashed:', err);
        process.exit(1);
      };

      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigterm);
      process.on('uncaughtException', onCrash);
      process.on('unhandledRejection', onCrash);
      process.on('exit', restore);

      // A lone Esc is reported after escapeCodeTimeout (500 ms by default); 50 ms feels instant.
      readline.emitKeypressEvents(stdin, {
        escapeCodeTimeout: 50,
      } as unknown as readline.Interface);
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('keypress', onKeypress);
      stdout.on('resize', onResize);

      this.startBootSequence();
      this.scheduleClock();
      this.redraw();
    });
  }
}
