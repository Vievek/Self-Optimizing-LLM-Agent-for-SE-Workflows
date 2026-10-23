import type { ThemeName } from '../theme/theme.js';

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
  handleKey?(key: string, state: TuiState): boolean | void;
}
