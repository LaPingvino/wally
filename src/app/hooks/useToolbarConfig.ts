import { useAtom } from 'jotai';
import { useCallback } from 'react';
import {
  toolbarConfigAtom,
  getEffectiveItem,
  ToolbarItemId,
  ToolbarItemConfig,
  ToolbarConfig,
} from '../state/toolbarConfig';

export function useToolbarConfig() {
  const [config, setConfig] = useAtom(toolbarConfigAtom);

  const setItem = useCallback(
    (id: ToolbarItemId, patch: Partial<ToolbarItemConfig>) => {
      setConfig((prev) => {
        const next = { ...prev, [id]: { ...getEffectiveItem(prev, id), ...patch } };
        localStorage.setItem('wally_toolbar_config', JSON.stringify(next));
        return next;
      });
    },
    [setConfig]
  );

  const removeItem = useCallback(
    (id: ToolbarItemId) => {
      setConfig((prev) => {
        const { [id]: _, ...rest } = prev as Record<string, ToolbarItemConfig>;
        localStorage.setItem('wally_toolbar_config', JSON.stringify(rest));
        return rest as ToolbarConfig;
      });
    },
    [setConfig]
  );

  const getEffective = useCallback(
    (id: ToolbarItemId) => getEffectiveItem(config, id),
    [config]
  );

  return { config, setItem, removeItem, getEffective };
}
