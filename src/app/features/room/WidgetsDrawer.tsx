/**
 * WidgetsDrawer — lists and embeds room widgets (im.vector.modular.widgets state events).
 * Reuses the same SmallWidget / SmallWidgetDriver infrastructure used for Element Call.
 * Excludes natively-handled widgets (e.g. issue tracker) from the generic widget list.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Room } from 'matrix-js-sdk';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Text,
  Chip,
  config,
  toRem,
  color,
  PopOut,
  RectCords,
} from 'folds';
import { atom, useAtom } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomWidgets, RoomWidget } from '../../hooks/useRoomWidgets';
import { SmallWidget, createVirtualWidget } from '../call/SmallWidget';
import { useToolbarConfig } from '../../hooks/useToolbarConfig';
import { ToolbarItemId } from '../../state/toolbarConfig';
import { PanelIconPicker } from './PanelIconPicker';

// Global atom — set this to any widget id to auto-select that widget when the drawer opens.
// Toolbar shortcut buttons set this before toggling the drawer open.
export const activeWidgetIdAtom = atom<string | null>(null);

// Substitute Matrix widget template variables in a URL.
// widgetId is passed separately so $matrix_widget_id can also be substituted.
function substituteTemplateVars(
  url: string,
  mx: ReturnType<typeof useMatrixClient>,
  roomId: string,
  widgetId: string,
): string {
  const userId = mx.getUserId() ?? '';
  const displayName = mx.getUser(userId)?.displayName ?? userId;
  const avatarUrl = mx.getUser(userId)?.avatarUrl ?? '';
  return url
    .replace(/\$matrix_room_id/g, encodeURIComponent(roomId))
    .replace(/\$matrix_user_id/g, encodeURIComponent(userId))
    .replace(/\$matrix_display_name/g, encodeURIComponent(displayName))
    .replace(/\$matrix_avatar_url/g, encodeURIComponent(avatarUrl))
    .replace(/\$matrix_widget_id/g, encodeURIComponent(widgetId))
    .replace(/\$matrix_client_origin/g, encodeURIComponent(window.location.origin))
    .replace(/\$org\.matrix\.msc2873\.client_id/g, encodeURIComponent(userId))
    .replace(/\$org\.matrix\.msc2873\.client_origin/g, encodeURIComponent(window.location.origin));
}

type WidgetViewProps = {
  room: Room;
  widget: RoomWidget;
};

function WidgetView({ room, widget }: WidgetViewProps) {
  const mx = useMatrixClient();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const smallWidgetRef = useRef<SmallWidget | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    // Stop any existing widget
    if (smallWidgetRef.current) {
      smallWidgetRef.current.stopMessaging();
      smallWidgetRef.current = null;
    }

    const resolvedUrl = new URL(substituteTemplateVars(widget.url, mx, room.roomId, widget.id));
    // The Matrix Widget API requires widgetId and parentUrl as URL params so the widget's
    // WidgetApi can identify itself and know where to send postMessages.
    resolvedUrl.searchParams.set('widgetId', widget.id);
    resolvedUrl.searchParams.set('parentUrl', window.location.origin);

    const userId = mx.getUserId() ?? '';
    const app = createVirtualWidget(
      mx,
      widget.id,
      userId,
      widget.name,
      widget.type,
      resolvedUrl,
      false, // waitForIframeLoad: false — let widget signal readiness via ContentLoaded
      widget.data ?? {},
      room.roomId,
    );

    const smallWidget = new SmallWidget(app);
    smallWidgetRef.current = smallWidget;
    // Start messaging BEFORE setting iframe.src to avoid ContentLoaded sequence errors.
    smallWidget.startMessaging(iframe);
    iframe.src = resolvedUrl.toString();

    return () => {
      smallWidget.stopMessaging();
      if (smallWidgetRef.current === smallWidget) smallWidgetRef.current = null;
    };
    // Use widget.id + widget.url as deps, not the whole object — useRoomWidgets creates
    // new object references on every RoomStateEvent.Events, which would tear down and
    // recreate the widget messaging even when nothing changed. The already-running iframe
    // never resends ContentLoaded, so the new ClientWidgetApi never completes its handshake.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, room.roomId, widget.id, widget.url]);

  return (
    <iframe
      ref={iframeRef}
      title={widget.name}
      sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"
      allow="microphone; camera; fullscreen"
      style={{
        flexGrow: 1,
        border: 'none',
        minHeight: 0,
        width: '100%',
        background: 'var(--bg-surface)',
      }}
    />
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: `${config.space.S100} ${config.space.S200}`,
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: '6px',
  background: 'var(--bg-surface)',
  color: 'var(--tc-surface-high)',
  fontSize: '14px',
  boxSizing: 'border-box',
};

type WidgetsDrawerProps = {
  room: Room;
  onClose: () => void;
  width?: number;
  isFullWidth?: boolean;
  onToggleFullWidth?: () => void;
};

export function WidgetsDrawer({ room, onClose, width = 420, isFullWidth, onToggleFullWidth }: WidgetsDrawerProps) {
  const mx = useMatrixClient();
  const widgets = useRoomWidgets(room);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addName, setAddName] = useState('');
  const [saving, setSaving] = useState(false);

  // Toolbar config integration
  const { config: toolbarConfig, setItem: setToolbarItem } = useToolbarConfig();
  const [iconPickerAnchor, setIconPickerAnchor] = useState<RectCords | null>(null);
  const [iconPickerWidget, setIconPickerWidget] = useState<RoomWidget | null>(null);

  // Subscribe to activeWidgetIdAtom — when set, auto-select that widget
  const [activeWidgetId, setActiveWidgetId] = useAtom(activeWidgetIdAtom);
  useEffect(() => {
    if (activeWidgetId) {
      setSelectedId(activeWidgetId);
      setActiveWidgetId(null);
    }
  }, [activeWidgetId, setActiveWidgetId]);

  // Permission check: can the user send im.vector.modular.widgets state events?
  const myPL = room.getMember(mx.getSafeUserId() ?? '')?.powerLevel ?? 0;
  const plContent = room.currentState.getStateEvents('m.room.power_levels', '')?.getContent() as Record<string, unknown> | undefined;
  const stateDefaultPL = (plContent?.state_default as number | undefined) ?? 50;
  const canManageWidgets = myPL >= stateDefaultPL;

  // Keep existing selection if widget still exists; otherwise deselect (no auto-select)
  useEffect(() => {
    if (widgets.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev && widgets.some((w) => w.id === prev)) return prev;
      return null;
    });
  }, [widgets]);

  const selectedWidget = widgets.find((w) => w.id === selectedId) ?? null;

  const handleAdd = useCallback(async () => {
    const url = addUrl.trim();
    if (!url) return;
    let name = addName.trim();
    if (!name) {
      try { name = new URL(url).hostname; } catch { name = 'Widget'; }
    }
    const id = `widget-${Date.now()}`;
    setSaving(true);
    try {
      await mx.sendStateEvent(room.roomId, 'im.vector.modular.widgets' as any, {
        type: 'm.custom',
        url,
        name,
        id,
      }, id);
      setAddUrl('');
      setAddName('');
      setIsAdding(false);
    } finally {
      setSaving(false);
    }
  }, [mx, room.roomId, addUrl, addName]);

  const handleRemove = useCallback(async (widgetId: string) => {
    await mx.sendStateEvent(room.roomId, 'im.vector.modular.widgets' as any, {}, widgetId);
  }, [mx, room.roomId]);

  const cancelAdd = useCallback(() => {
    setIsAdding(false);
    setAddUrl('');
    setAddName('');
  }, []);

  const openIconPicker = useCallback((w: RoomWidget, anchor: RectCords) => {
    setIconPickerWidget(w);
    setIconPickerAnchor(anchor);
  }, []);

  const handleIconSelect = useCallback((iconSpec: string | undefined) => {
    if (!iconPickerWidget) return;
    const toolbarId = `widget:${iconPickerWidget.id}` as ToolbarItemId;
    setToolbarItem(toolbarId, {
      pinned: true,
      order: Date.now() % 10000,
      defaultMode: 'sidebar',
      icon: iconSpec,
      label: iconPickerWidget.name,
    });
    setIconPickerAnchor(null);
    setIconPickerWidget(null);
  }, [iconPickerWidget, setToolbarItem]);

  return (
    <Box
      role="region"
      aria-label="Widgets panel"
      tabIndex={-1}
      direction="Column"
      style={
        isFullWidth
          ? { flex: 1, minWidth: 0, overflow: 'hidden', borderLeft: `1px solid ${color.Surface.ContainerLine}` }
          : {
              width: toRem(width),
              minWidth: toRem(280),
              maxWidth: toRem(600),
              flexShrink: 0,
              borderLeft: `1px solid ${color.Surface.ContainerLine}`,
              overflow: 'hidden',
            }
      }
    >
      {/* Header */}
      <Box
        alignItems="Center"
        gap="200"
        style={{
          padding: `${config.space.S200} ${config.space.S300}`,
          borderBottom: `1px solid ${color.Surface.ContainerLine}`,
          flexShrink: 0,
        }}
      >
        <Icon src={Icons.Category} size="200" />
        <Text size="H5" style={{ flexGrow: 1 }}>
          Widgets
        </Text>
        {onToggleFullWidth && (
          <IconButton
            size="300"
            radii="300"
            onClick={onToggleFullWidth}
            aria-label={isFullWidth ? 'Side by side' : 'Full width'}
          >
            <Icon src={isFullWidth ? Icons.ArrowGoRight : Icons.ArrowGoLeft} size="200" />
          </IconButton>
        )}
        <IconButton size="300" radii="300" onClick={onClose} aria-label="Close widgets drawer">
          <Icon src={Icons.Cross} size="200" />
        </IconButton>
      </Box>

      {/* Widget selector tabs — always shown when widgets exist; click active chip to deselect */}
      {widgets.length > 0 && (
        <Box
          gap="100"
          style={{
            padding: `${config.space.S100} ${config.space.S200}`,
            borderBottom: `1px solid ${color.Surface.ContainerLine}`,
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          {widgets.map((w) => {
            const toolbarId = `widget:${w.id}` as ToolbarItemId;
            const isPinned = !!toolbarConfig[toolbarId];
            return (
              <Box key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Chip
                  variant={selectedId === w.id ? 'Primary' : 'Surface'}
                  radii="Pill"
                  onClick={() => setSelectedId((prev) => (prev === w.id ? null : w.id))}
                >
                  <Text size="T200" truncate>
                    {w.name}
                  </Text>
                </Chip>
                {!isPinned && (
                  <IconButton
                    size="300"
                    radii="300"
                    onClick={(e) => {
                      openIconPicker(w, (e.currentTarget as HTMLElement).getBoundingClientRect());
                    }}
                    aria-label={`Add ${w.name} to toolbar`}
                    title="Add to toolbar"
                  >
                    <Icon src={Icons.Pin} size="100" />
                  </IconButton>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Icon picker popout */}
      <PopOut
        anchor={iconPickerAnchor ?? undefined}
        position="Bottom"
        align="Start"
        content={
          iconPickerWidget ? (
            <PanelIconPicker
              onSelect={handleIconSelect}
              onClose={() => { setIconPickerAnchor(null); setIconPickerWidget(null); }}
            />
          ) : <div />
        }
      />

      {/* Add widget form */}
      {isAdding && (
        <Box
          direction="Column"
          gap="200"
          style={{
            padding: config.space.S300,
            borderBottom: `1px solid ${color.Surface.ContainerLine}`,
            flexShrink: 0,
          }}
        >
          <Text size="L400">Add Widget</Text>
          <input
            type="url"
            placeholder="Widget URL (required)"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            style={inputStyle}
            autoFocus
          />
          <input
            type="text"
            placeholder="Name (defaults to hostname)"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            style={inputStyle}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <Box gap="200">
            <Button
              size="300"
              variant="Primary"
              onClick={handleAdd}
              disabled={!addUrl.trim() || saving}
            >
              <Text size="B300">{saving ? 'Adding…' : 'Add'}</Text>
            </Button>
            <Button size="300" variant="Secondary" fill="Soft" onClick={cancelAdd}>
              <Text size="B300">Cancel</Text>
            </Button>
          </Box>
        </Box>
      )}

      {/* Widget iframe or empty state */}
      {selectedWidget ? (
        <Box grow="Yes" direction="Column" style={{ minHeight: 0, overflow: 'hidden' }}>
          <WidgetView key={selectedWidget.id} room={room} widget={selectedWidget} />
        </Box>
      ) : !isAdding ? (
        <Box grow="Yes" justifyContent="Center" alignItems="Center" direction="Column" gap="300">
          <Text size="T300" priority="300">
            {widgets.length > 0 ? 'Select a widget above to load it.' : 'No widgets in this room.'}
          </Text>
          {widgets.length === 0 && canManageWidgets && (
            <Button size="300" variant="Secondary" fill="Soft" onClick={() => setIsAdding(true)}>
              <Icon src={Icons.Plus} size="100" />
              <Text size="B300">Add Widget</Text>
            </Button>
          )}
        </Box>
      ) : null}

      {/* Footer: manage buttons when widgets exist */}
      {widgets.length > 0 && canManageWidgets && !isAdding && (
        <Box
          shrink="No"
          gap="200"
          style={{
            padding: `${config.space.S200} ${config.space.S300}`,
            borderTop: `1px solid ${color.Surface.ContainerLine}`,
          }}
        >
          <Button size="300" variant="Secondary" fill="Soft" onClick={() => setIsAdding(true)}>
            <Icon src={Icons.Plus} size="100" />
            <Text size="B300">Add</Text>
          </Button>
          {selectedWidget && (
            <Button
              size="300"
              variant="Critical"
              fill="Soft"
              onClick={() => handleRemove(selectedWidget.id)}
            >
              <Icon src={Icons.Delete} size="100" />
              <Text size="B300">Remove</Text>
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}
