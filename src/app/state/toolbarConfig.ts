import { atom } from 'jotai';

export type PanelId = 'members' | 'threads' | 'widgets' | 'issues';
export type ToolbarItemId = PanelId | `widget:${string}`;

export type ToolbarItemConfig = {
  pinned: boolean;
  order: number;
  defaultMode: 'sidebar' | 'fullwidth';
  icon?: string;
  label?: string;
};

export type ToolbarConfig = Partial<Record<ToolbarItemId, ToolbarItemConfig>>;

export const PANEL_DEFAULTS: Record<PanelId, ToolbarItemConfig> = {
  members: { pinned: true, order: 40, defaultMode: 'sidebar' },
  threads: { pinned: true, order: 30, defaultMode: 'sidebar' },
  widgets: { pinned: true, order: 20, defaultMode: 'sidebar' },
  issues: { pinned: true, order: 10, defaultMode: 'sidebar' },
};

export function getEffectiveItem(config: ToolbarConfig, id: ToolbarItemId): ToolbarItemConfig {
  const defaults = PANEL_DEFAULTS[id as PanelId] ?? { pinned: true, order: 50, defaultMode: 'sidebar' };
  return { ...defaults, ...config[id] };
}

function loadConfig(): ToolbarConfig {
  try {
    return JSON.parse(localStorage.getItem('wally_toolbar_config') ?? '{}');
  } catch {
    return {};
  }
}

export const toolbarConfigAtom = atom<ToolbarConfig>(loadConfig());
