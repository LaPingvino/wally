import React from 'react';
import { useAtomValue } from 'jotai';
import { Switch } from 'folds';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../../room-settings/styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useRoom } from '../../../hooks/useRoom';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useChildSpaceScopeFactory, useSpaceChildren } from '../../../state/hooks/roomList';
import { makeSubspaceFoldersContent, useSubspaceFolders } from '../../../hooks/useSidebarItems';
import { AccountDataEvent } from '../../../../types/matrix/accountData';

// Toggle for rendering a space's subspaces as a Discord-style collapsible sidebar folder
// instead of nested headers in the space's room list. Only shown for spaces that actually
// have direct subspaces.
export function SpaceSidebarDisplay() {
  const room = useRoom();
  const mx = useMatrixClient();
  const roomToParents = useAtomValue(roomToParentsAtom);

  const childSpaces = useSpaceChildren(
    allRoomsAtom,
    room.roomId,
    useChildSpaceScopeFactory(mx, roomToParents)
  );
  const subspaceFolders = useSubspaceFolders();
  const asSubspaceFolder = subspaceFolders.includes(room.roomId);

  if (childSpaces.length === 0) return null;

  const handleToggle = () => {
    const content = makeSubspaceFoldersContent(mx, room.roomId, !asSubspaceFolder);
    mx.setAccountData(AccountDataEvent.CinnySpaces, content).catch((err) =>
      // eslint-disable-next-line no-console
      console.error('sidebar: failed to persist subspace-folder toggle', err)
    );
  };

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <SettingTile
        title="Show subspaces in sidebar"
        description="Show this space as a collapsible folder of its subspaces in the sidebar, instead of nesting the subspaces as headers inside its room list."
        after={<Switch value={asSubspaceFolder} onChange={handleToggle} />}
      />
    </SequenceCard>
  );
}
