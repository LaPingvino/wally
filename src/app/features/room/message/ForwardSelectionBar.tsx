import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Icon, Icons, Menu, Text, color, config, toRem } from 'folds';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { useAtom } from 'jotai';
import { forwardSelectionAtom } from '../../../state/forwardSelection';
import { ForwardDialog } from './ForwardDialog';

type ForwardSelectionBarProps = {
  room: Room;
};

export function ForwardSelectionBar({ room }: ForwardSelectionBarProps) {
  const [selection, setSelection] = useAtom(forwardSelectionAtom);
  const [dialogOpen, setDialogOpen] = useState(false);

  const active = selection && selection.roomId === room.roomId;

  const events: MatrixEvent[] = useMemo(() => {
    if (!active || !selection) return [];
    return selection.eventIds.flatMap((evtId) => {
      const timeline = room.getTimelineForEvent(evtId);
      const evt = timeline?.getEvents().find((e) => e.getId() === evtId);
      return evt ? [evt] : [];
    });
  }, [active, selection, room]);

  const handleCancel = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

  const handleOpen = useCallback(() => {
    if (events.length === 0) return;
    setDialogOpen(true);
  }, [events.length]);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dialogOpen, handleCancel]);

  if (!active || !selection) return null;

  const count = selection.eventIds.length;
  const missing = count - events.length;

  return (
    <>
      <Menu
        variant="Surface"
        role="region"
        aria-label="Forward selection"
        style={{
          margin: `0 ${config.space.S400}`,
          padding: config.space.S300,
          borderRadius: config.radii.R400,
          borderWidth: config.borderWidth.B300,
        }}
      >
        <Box alignItems="Center" gap="300">
          <Icon src={Icons.ArrowGoRight} size="200" />
          <Text size="T300" style={{ flexGrow: 1 }}>
            {count} selected
            {missing > 0 && (
              <Text
                as="span"
                size="T200"
                style={{ marginLeft: toRem(8), color: color.Warning.Main }}
              >
                ({missing} not loaded)
              </Text>
            )}
          </Text>
          <Button
            size="300"
            variant="Secondary"
            fill="Soft"
            radii="300"
            onClick={handleCancel}
          >
            <Text size="B300">Cancel</Text>
          </Button>
          <Button
            size="300"
            variant="Primary"
            radii="300"
            onClick={handleOpen}
            aria-disabled={events.length === 0}
          >
            <Text size="B300">Forward…</Text>
          </Button>
        </Box>
      </Menu>
      <ForwardDialog
        srcRoom={room}
        mEvents={events}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSent={() => setSelection(null)}
      />
    </>
  );
}
