import React, { useEffect, useMemo, useState } from 'react';
import { MatrixClient } from 'matrix-js-sdk';
import {
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
import { DmCandidate, detectDmCandidates, tagDmRooms } from '../../utils/matrix';

type GuessDMDialogProps = {
  mx: MatrixClient;
  onClose: () => void;
};

// Two-step DM reshaper: detect every joined 1:1 (native or bridged) that isn't
// tagged as direct, group the candidates by the bridge bot they came through, and
// let the user toggle rooms individually or a whole bridge at once before writing.
// This sidesteps unavoidable ambiguity (e.g. a bridge whose room shape is exactly
// a 1:1) by putting the decision in the user's hands instead of guessing.
export function GuessDMDialog({ mx, onClose }: GuessDMDialogProps) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [candidates, setCandidates] = useState<DmCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;
    (async () => {
      const found = await detectDmCandidates(mx);
      if (disposed) return;
      setCandidates(found);
      setSelected(new Set(found.map((c) => c.roomId))); // default: all on
      setLoading(false);
    })();
    return () => {
      disposed = true;
    };
  }, [mx]);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; items: DmCandidate[] }>();
    candidates.forEach((c) => {
      const g = m.get(c.groupKey) ?? { label: c.groupLabel, items: [] };
      g.items.push(c);
      m.set(c.groupKey, g);
    });
    return [...m.entries()];
  }, [candidates]);

  const toggleRoom = (roomId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });

  const toggleGroup = (items: DmCandidate[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = items.every((i) => next.has(i.roomId));
      items.forEach((i) => (allOn ? next.delete(i.roomId) : next.add(i.roomId)));
      return next;
    });

  const selectedCount = selected.size;

  const apply = async () => {
    setApplying(true);
    const picks = candidates
      .filter((c) => selected.has(c.roomId))
      .map((c) => ({ roomId: c.roomId, partnerUserId: c.partnerUserId }));
    try {
      await tagDmRooms(mx, picks);
    } finally {
      setApplying(false);
      onClose();
    }
  };

  return (
    <NativeDialog open onClose={onClose} className={dialogCss.NativeDialog}>
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

      <Box
        direction="Column"
        gap="200"
        style={{ padding: config.space.S400, maxHeight: '60vh', overflowY: 'auto', minWidth: '20rem' }}
      >
        {loading && (
          <Box direction="Row" gap="200" alignItems="Center">
            <Spinner variant="Secondary" size="200" />
            <Text size="T300">Scanning your rooms…</Text>
          </Box>
        )}

        {!loading && candidates.length === 0 && (
          <Text size="T300">No untagged 1:1 chats found — your DM list is already complete.</Text>
        )}

        {!loading &&
          groups.map(([key, group], gi) => {
            const allOn = group.items.every((i) => selected.has(i.roomId));
            return (
              <Box key={key} direction="Column" gap="100">
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
                {group.items.map((c) => (
                  <Box key={c.roomId} alignItems="Center" gap="200" style={{ paddingLeft: config.space.S400 }}>
                    <Checkbox
                      checked={selected.has(c.roomId)}
                      onClick={() => toggleRoom(c.roomId)}
                      size="50"
                      variant="Primary"
                    />
                    <Box grow="Yes" direction="Column">
                      <Text size="T300" truncate>
                        {c.partnerName}
                      </Text>
                      {c.roomName !== c.partnerName && (
                        <Text size="T200" priority="300" truncate>
                          {c.roomName}
                        </Text>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            );
          })}
      </Box>

      <Box
        direction="Row"
        gap="200"
        justifyContent="End"
        style={{ padding: config.space.S400, borderTopWidth: '1px' }}
      >
        <Button onClick={onClose} variant="Secondary" fill="Soft" disabled={applying}>
          <Text size="B400">Cancel</Text>
        </Button>
        <Button
          onClick={apply}
          variant="Primary"
          disabled={loading || applying || selectedCount === 0}
          before={applying ? <Spinner size="100" variant="Primary" /> : undefined}
        >
          <Text size="B400">Convert {selectedCount}</Text>
        </Button>
      </Box>
    </NativeDialog>
  );
}
