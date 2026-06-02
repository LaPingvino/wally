import React, { useEffect, useMemo, useState } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  config,
  Header,
  Icon,
  IconButton,
  Icons,
  Line,
  Spinner,
  Text,
} from 'folds';
import { NativeDialog } from '../NativeDialog';
import * as dialogCss from '../NativeDialog.css';
import { DmRow, detectDmReshape, reshapeDm } from '../../utils/matrix';

type GuessDMDialogProps = {
  mx: MatrixClient;
  onClose: () => void;
};

// Two-way DM reshaper. Lists every joined 1:1 (native or bridged) — both untagged
// candidates AND rooms already tagged as direct — grouped by the bridge bot they
// came through. A checkbox means "this is a Direct Message": check a candidate to
// convert it to a DM, uncheck a current DM to convert it back to a room. Apply
// writes the adds and removes in one shot. Groups can be toggled wholesale, so
// flicking a whole bridge on or off (e.g. an IRC group that looks like 1:1s) is one
// click — sidestepping detection ambiguity by leaving the decision to the user.
export function GuessDMDialog({ mx, onClose }: GuessDMDialogProps) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<DmRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;
    (async () => {
      const found = await detectDmReshape(mx);
      if (disposed) return;
      setRows(found);
      // Default = the suggested final state: candidates default to r.defaultOn (real
      // 1:1s ON, "DM with yourself" candidates OFF), valid current DMs ON (stay), but
      // MISTAGGED current DMs (a group, a bot, or only your own alt as partner) OFF —
      // so Apply cleans them up. The user can override either way.
      setSelected(
        new Set(found.filter((r) => (r.currentlyDM ? r.valid : r.defaultOn)).map((r) => r.roomId))
      );
      setLoading(false);
    })();
    return () => {
      disposed = true;
    };
  }, [mx]);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: DmRow[] }>();
    rows.forEach((r) => {
      const g = m.get(r.groupKey) ?? { label: r.groupLabel, items: [] };
      g.items.push(r);
      m.set(r.groupKey, g);
    });
    return [...m.entries()];
  }, [rows]);

  const toggleRoom = (roomId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });

  const toggleGroup = (items: DmRow[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = items.every((i) => next.has(i.roomId));
      items.forEach((i) => (allOn ? next.delete(i.roomId) : next.add(i.roomId)));
      return next;
    });

  const addCount = rows.filter((r) => !r.currentlyDM && selected.has(r.roomId)).length;
  const removeCount = rows.filter((r) => r.currentlyDM && !selected.has(r.roomId)).length;

  const apply = async () => {
    setApplying(true);
    const add = rows
      .filter((r) => !r.currentlyDM && selected.has(r.roomId))
      .map((r) => ({ roomId: r.roomId, partnerUserId: r.partnerUserId }));
    const removeRoomIds = rows
      .filter((r) => r.currentlyDM && !selected.has(r.roomId))
      .map((r) => r.roomId);
    try {
      await reshapeDm(mx, add, removeRoomIds);
    } finally {
      setApplying(false);
      onClose();
    }
  };

  return (
    <NativeDialog open onClose={onClose} className={dialogCss.NativeDialog}>
      <Box direction="Column" style={{ maxHeight: '80vh', minWidth: '22rem', maxWidth: '90vw' }}>
      <Box shrink="No">
        <Header
          style={{ borderBottomWidth: '1px', paddingInline: config.space.S400 }}
          variant="Surface"
          size="500"
        >
          <Box grow="Yes">
            <Text size="H4">Guess &amp; convert DMs</Text>
          </Box>
          <IconButton size="300" radii="300" onClick={onClose}>
            <Icon src={Icons.Cross} />
          </IconButton>
        </Header>
      </Box>

      <Box
        grow="Yes"
        direction="Column"
        gap="200"
        style={{ padding: config.space.S400, minHeight: 0, overflowY: 'auto' }}
      >
        {loading && (
          <Box direction="Row" gap="200" alignItems="Center">
            <Spinner variant="Secondary" size="200" />
            <Text size="T300">Scanning your rooms…</Text>
          </Box>
        )}

        {!loading && rows.length === 0 && (
          <Text size="T300">No 1:1 chats found.</Text>
        )}

        {!loading && rows.length > 0 && (
          <Text size="T200" priority="300">
            Checked = Direct Message. Check a chat to convert it to a DM; uncheck a current DM to
            turn it back into a room.
          </Text>
        )}

        {!loading &&
          groups.map(([key, group], gi) => {
            const allOn = group.items.every((i) => selected.has(i.roomId));
            return (
              <Box key={key} shrink="No" direction="Column" gap="100">
                {gi > 0 && <Line variant="Surface" size="300" />}
                <Box alignItems="Center" gap="200" style={{ paddingBlock: config.space.S100 }}>
                  <Checkbox
                    checked={allOn}
                    onClick={() => toggleGroup(group.items)}
                    size="50"
                    variant="Primary"
                  />
                  <Box grow="Yes">
                    <Text size="T200" priority="300">
                      {group.label} ({group.items.length})
                    </Text>
                  </Box>
                </Box>
                {group.items.map((r) => (
                  <Box key={r.roomId} shrink="No" alignItems="Center" gap="200" style={{ paddingLeft: config.space.S400, minHeight: '1.75rem' }}>
                    <Checkbox
                      checked={selected.has(r.roomId)}
                      onClick={() => toggleRoom(r.roomId)}
                      size="50"
                      variant="Primary"
                    />
                    <Box grow="Yes" direction="Column">
                      <Text size="T300" truncate>
                        {r.partnerName}
                      </Text>
                      {r.roomName !== r.partnerName && (
                        <Text size="T200" priority="300" truncate>
                          {r.roomName}
                        </Text>
                      )}
                    </Box>
                    {r.currentlyDM && r.valid && (
                      <Badge variant="Secondary" fill="Soft" size="400">
                        <Text size="L400">DM</Text>
                      </Badge>
                    )}
                    {r.currentlyDM && !r.valid && (
                      <Badge variant="Critical" fill="Soft" size="400">
                        <Text size="L400">not 1:1</Text>
                      </Badge>
                    )}
                  </Box>
                ))}
              </Box>
            );
          })}
      </Box>

      <Box
        shrink="No"
        direction="Row"
        gap="200"
        alignItems="Center"
        style={{ padding: config.space.S400, borderTopWidth: '1px' }}
      >
        <Box grow="Yes">
          {!loading && (addCount > 0 || removeCount > 0) && (
            <Text size="T200" priority="300">
              {addCount > 0 && `+${addCount} to DMs`}
              {addCount > 0 && removeCount > 0 && ', '}
              {removeCount > 0 && `−${removeCount} to rooms`}
            </Text>
          )}
        </Box>
        <Button onClick={onClose} variant="Secondary" fill="Soft" disabled={applying}>
          <Text size="B400">Cancel</Text>
        </Button>
        <Button
          onClick={apply}
          variant="Primary"
          disabled={loading || applying || (addCount === 0 && removeCount === 0)}
          before={applying ? <Spinner size="100" variant="Primary" /> : undefined}
        >
          <Text size="B400">Apply</Text>
        </Button>
      </Box>
      </Box>
    </NativeDialog>
  );
}
