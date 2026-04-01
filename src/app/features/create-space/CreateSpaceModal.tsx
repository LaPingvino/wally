import React from 'react';
import {
  Box,
  config,
  Header,
  Icon,
  IconButton,
  Icons,
  Scroll,
  Text,
} from 'folds';
import { useAllJoinedRoomsSet, useGetRoom } from '../../hooks/useGetRoom';
import { SpaceProvider } from '../../hooks/useSpace';
import { CreateSpaceForm } from './CreateSpace';
import {
  useCloseCreateSpaceModal,
  useCreateSpaceModalState,
} from '../../state/hooks/createSpaceModal';
import { CreateSpaceModalState } from '../../state/createSpaceModal';
import { NativeDialog } from '../../components/NativeDialog';
import * as dialogCss from '../../components/NativeDialog.css';

type CreateSpaceModalProps = {
  state: CreateSpaceModalState;
};
function CreateSpaceModal({ state }: CreateSpaceModalProps) {
  const { spaceId } = state;
  const closeDialog = useCloseCreateSpaceModal();

  const allJoinedRooms = useAllJoinedRoomsSet();
  const getRoom = useGetRoom(allJoinedRooms);
  const space = spaceId ? getRoom(spaceId) : undefined;

  return (
    <SpaceProvider value={space ?? null}>
      <NativeDialog open onClose={closeDialog} className={dialogCss.NativeDialog}>
        <Box direction="Column">
          <Header
            size="500"
            style={{
              padding: config.space.S200,
              paddingLeft: config.space.S400,
              borderBottomWidth: config.borderWidth.B300,
            }}
          >
            <Box grow="Yes">
              <Text size="H4">New Space</Text>
            </Box>
            <Box shrink="No">
              <IconButton size="300" radii="300" onClick={closeDialog}>
                <Icon src={Icons.Cross} />
              </IconButton>
            </Box>
          </Header>
          <Scroll size="300" hideTrack>
            <Box
              style={{
                padding: config.space.S400,
                paddingRight: config.space.S200,
              }}
              direction="Column"
              gap="500"
            >
              <CreateSpaceForm space={space} onCreate={closeDialog} />
            </Box>
          </Scroll>
        </Box>
      </NativeDialog>
    </SpaceProvider>
  );
}

export function CreateSpaceModalRenderer() {
  const state = useCreateSpaceModalState();

  if (!state) return null;
  return <CreateSpaceModal state={state} />;
}
