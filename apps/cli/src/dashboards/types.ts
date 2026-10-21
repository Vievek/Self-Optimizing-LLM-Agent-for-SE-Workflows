import type { ThemeName } from '../theme/theme.js';

export interface TuiState {
  activeView: string;
  previousView?: string;
  activeTab: number;
  theme: ThemeName;
  width: number;
  height: number;
  selectedItemIndex: number;
  statusMessage?: string;
}

export interface DashboardView {
  id: string;
  name: string;
  title: string;
  tabs?: string[];
  render(state: TuiState): string;
  handleKey?(key: string, state: TuiState): boolean | void;
}

