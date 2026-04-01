import {
  Badge,
  Box,
  Button,
  color,
  config,
  Header,
  Icon,
  IconButton,
  Icons,
  Spinner,
  Text,
} from 'folds';
import React, { useCallback, useState } from 'react';
import { MatrixError } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../../room-settings/styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { StateEvent } from '../../../../types/matrix/room';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { useRoom } from '../../../hooks/useRoom';
import { useStateEvent } from '../../../hooks/useStateEvent';
import { NativeDialog } from '../../../components/NativeDialog';
import * as dialogCss from '../../../components/NativeDialog.css';
import { RoomPermissionsAPI } from '../../../hooks/useRoomPermissions';

const ROOM_ENC_ALGO = 'm.megolm.v1.aes-sha2';

type RoomEncryptionProps = {
  permissions: RoomPermissionsAPI;
};
export function RoomEncryption({ permissions }: RoomEncryptionProps) {
  const mx = useMatrixClient();
  const room = useRoom();

  const canEnable = permissions.stateEvent(StateEvent.RoomEncryption, mx.getSafeUserId());
  const content = useStateEvent(room, StateEvent.RoomEncryption)?.getContent<{
    algorithm: string;
  }>();
  const enabled = content?.algorithm === ROOM_ENC_ALGO;

  const [enableState, enable] = useAsyncCallback(
    useCallback(async () => {
      await mx.sendStateEvent(room.roomId, StateEvent.RoomEncryption as any, {
        algorithm: ROOM_ENC_ALGO,
      });
    }, [mx, room.roomId])
  );

  const enabling = enableState.status === AsyncStatus.Loading;

  const [prompt, setPrompt] = useState(false);

  const handleEnable = () => {
    enable();
    setPrompt(false);
  };

  return (
    <SequenceCard
      className={SequenceCardStyle}
      variant="SurfaceVariant"
      direction="Column"
      gap="400"
    >
      <SettingTile
        title="Room Encryption"
        description={
          enabled
            ? 'Messages in this room are protected by end-to-end encryption.'
            : 'Once enabled, encryption cannot be disabled!'
        }
        after={
          enabled ? (
            <Badge size="500" variant="Success" fill="Solid" radii="300">
              <Text size="L400">Enabled</Text>
            </Badge>
          ) : (
            <Button
              size="300"
              variant="Primary"
              fill="Solid"
              radii="300"
              disabled={!canEnable}
              onClick={() => setPrompt(true)}
              before={enabling && <Spinner size="100" variant="Primary" fill="Solid" />}
            >
              <Text size="B300">Enable</Text>
            </Button>
          )
        }
      >
        {enableState.status === AsyncStatus.Error && (
          <Text style={{ color: color.Critical.Main }} size="T200">
            {(enableState.error as MatrixError).message}
          </Text>
        )}
        {prompt && (
          <NativeDialog open={prompt} onClose={() => setPrompt(false)} className={dialogCss.NativeDialog}>
                  <Header
                    style={{
                      padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                      borderBottomWidth: config.borderWidth.B300,
                    }}
                    variant="Surface"
                    size="500"
                  >
                    <Box grow="Yes">
                      <Text size="H4">Enable Encryption</Text>
                    </Box>
                    <IconButton size="300" onClick={() => setPrompt(false)} radii="300">
                      <Icon src={Icons.Cross} />
                    </IconButton>
                  </Header>
                  <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                    <Text priority="400">
                      Are you sure? Once enabled, encryption cannot be disabled!
                    </Text>
                    <Button type="submit" variant="Primary" onClick={handleEnable}>
                      <Text size="B400">Enable E2E Encryption</Text>
                    </Button>
                  </Box>
          </NativeDialog>
        )}
      </SettingTile>
    </SequenceCard>
  );
}
