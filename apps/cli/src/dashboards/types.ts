import type { ThemeName } from '../theme/theme.js';
import type { KeyHint } from '../components/app-bars.js';

export interface TuiState {
  activeView: string;
  previousView?: string;
  activeTab: number;
  theme: ThemeName;
  /**
   * Size of the area the view must fill. The app passes the body size
   * (terminal size minus the top and status bars) when it calls a view.
   */
  width: number;
  height: number;
  selectedItemIndex: number;
  statusMessage?: string;
}

/** What pressing return on a view should do. */
export type ViewAction =
  /** Run a (simulated) task with the busy indicator. */
  | { type: 'busy'; verb: string; durationMs: number; done?: string }
  /** Behave as if this global key was pressed (e.g. a menu entry). */
  | { type: 'key'; key: string };

export interface TaskOptions {
  /** Toast text when `fn` resolves without a message of its own. */
  done?: string;
  /** Rough length, for the progress meter and whether the SOA-BOT overlay is shown. */
  expectedMs?: number;
}

/** What the app offers a view for work that takes time. */
export interface ViewContext {
  /**
   * Runs `fn` with the busy indicator until its promise settles, then redraws and shows
   * "[ ✔ DONE ] <message>" (the string `fn` resolves with, or options.done) or
   * "[ ✖ FAIL ] <error>". Resolves to true on success. Only one task runs at a time;
   * a second call while one runs returns false at once.
   */
  runTask(verb: string, fn: () => Promise<string | void>, options?: TaskOptions): Promise<boolean>;
  /** Asks for a redraw (no-op when the app is not running interactively). */
  redraw(): void;
  isBusy(): boolean;
}

export interface DashboardView {
  id: string;
  name: string;
  title: string;
  tabs?: string[];
  /** Label for the return key in the status bar hints. */
  actionLabel?: string;
  /** Renders exactly state.width x state.height. */
  render(state: TuiState): string;
  /** Number of selectable items (for up / down). */
  itemCount?(state: TuiState): number;
  /** Called when return is pressed on the selected item. */
  activate?(state: TuiState): ViewAction | void;
  /** Short status text for the middle of the status bar. */
  status?(state: TuiState): string;
  /**
   * Called for keys that are not global (q, esc, ?, h, m, space, 1-4, t), before the app
   * handles tab / arrows / up / down / return. Return true when the view used the key.
   */
  handleKey?(key: string, state: TuiState, ctx: ViewContext): boolean | void;
  /** Key hints for the status bar; when set they replace the default select / return hints. */
  keyHints?(state: TuiState): KeyHint[];
  /** Called when the view is shown in the interactive app (e.g. to load data). */
  enter?(ctx: ViewContext): void;
}
